import express from "express";
import checkAuth from "../check-auth.js";
import "dotenv/config.js";
import crypto from "crypto";
import fs from "fs/promises";
import path from "path";
import OpenAI from "openai";
import { Api, TelegramClient } from "telegram";
import { StringSession } from "telegram/sessions/index.js";
import { computeCheck } from "telegram/Password.js";
import { LogLevel } from "telegram/extensions/Logger.js";
import UserModel from "../models/Users.js";
import TelegramMessageModel from "../models/TelegramMessage.js";

const TelegramRouter = express.Router();

const TELEGRAM_DEFAULT_LIMIT = 25;
const TELEGRAM_MAX_LIMIT = 100;
const TELEGRAM_ALGORITHM = "aes-256-gcm";
const TELEGRAM_AUTH_TTL_MS = 10 * 60 * 1000;
const TELEGRAM_SYNC_INTERVAL_MS = 2 * 60 * 1000;
const TELEGRAM_SYNC_REQUEST_THROTTLE_MS = 30 * 1000;
const TELEGRAM_CLIENT_CONNECT_TIMEOUT_MS = 15 * 1000;
const TELEGRAM_DIALOG_ITERATION_TIMEOUT_MS = 20 * 1000;
const TELEGRAM_AI_REQUEST_TIMEOUT_MS = 60 * 1000;
const TELEGRAM_COURSE_SUGGESTION_AI_TIMEOUT_MS =
  Number(process.env.TELEGRAM_COURSE_SUGGESTION_AI_TIMEOUT_MS || 90 * 1000);
const TELEGRAM_COURSE_SUGGESTION_AI_CONTEXT_LIMIT = 6;
const TELEGRAM_COURSE_SUGGESTION_SNIPPET_MAX_LENGTH = 360;
const TELEGRAM_COURSE_SUGGESTION_FEEDBACK_LIMIT = 6;
const TELEGRAM_COURSE_SUGGESTION_ALL_GROUPS_SCOPE = "__all_groups__";
const TELEGRAM_COURSE_SUGGESTION_MODEL =
  process.env.OPENAI_MODEL || "gpt-5-mini";
const TELEGRAM_GEMINI_MODEL =
  process.env.GEMINI_MODEL || "gemini-2.5-flash";
const TELEGRAM_SEARCH_STOP_WORDS = new Set([
  "the",
  "and",
  "for",
  "with",
  "that",
  "this",
  "from",
  "have",
  "your",
  "about",
  "into",
  "after",
  "before",
]);
const TELEGRAM_PDF_STORAGE_ROOT = path.resolve(
  process.cwd(),
  "storage",
  "telegram-pdfs",
);

const pendingTelegramAuthByUser = new Map();
const telegramSyncPromisesByUser = new Map();
const telegramCourseSuggestionStatusByUser = new Map();
let telegramSyncWorkerStarted = false;
let telegramSyncWorkerIntervalId = null;
const TELEGRAM_COURSE_PAYLOAD_KEYS = [
  "course_name",
  "course_component",
  "course_dayAndTime",
  "course_year",
  "course_term",
  "course_class",
  "course_status",
  "course_instructors",
  "course_grade",
  "course_fullGrade",
  "course_length",
  "course_progress",
  "course_exams",
  "exam_type",
  "exam_date",
  "exam_time",
];
const TELEGRAM_COURSE_NAME_PREDICTION_KEYS = ["course_name"];
const TELEGRAM_COURSE_FIELD_HINTS = {
  course_name: [
    "course",
    "subject",
    "module",
    "مقرر",
    "مادة",
    "اسم المقرر",
  ],
  course_component: [
    "lecture",
    "lab",
    "practical",
    "theory",
    "section",
    "عملي",
    "نظري",
    "محاضرة",
  ],
  course_dayAndTime: [
    "day",
    "time",
    "schedule",
    "monday",
    "tuesday",
    "wednesday",
    "thursday",
    "friday",
    "saturday",
    "sunday",
    "موعد",
    "يوم",
    "الساعة",
  ],
  course_year: ["year", "level", "semester", "السنة", "المستوى"],
  course_term: ["term", "semester", "الفصل", "الترم"],
  course_class: ["mandatory", "elective", "classification", "إجباري", "اختياري"],
  course_status: ["status", "passed", "failed", "ongoing", "الحالة", "ناجح", "راسب"],
  course_instructors: [
    "doctor",
    "dr",
    "professor",
    "instructor",
    "lecturer",
    "دكتور",
    "الدكتور",
    "الأستاذ",
    "المدرس",
  ],
  course_grade: ["grade", "mark", "score", "علامة", "درجة"],
  course_fullGrade: ["full grade", "out of", "full mark", "الدرجة الكاملة"],
  course_exams: ["exam", "midterm", "final", "quiz", "امتحان", "دورة", "ميد"],
  exam_type: ["exam type", "midterm", "final", "quiz", "شفهي", "عملي"],
  exam_date: ["date", "deadline", "تاريخ", "موعد"],
  exam_time: ["time", "hour", "ساعة"],
};

const normalizeGroupReference = (value) => {
  const rawValue = String(value || "").trim();

  if (!rawValue) {
    return "";
  }

  if (rawValue.startsWith("https://t.me/")) {
    return rawValue.replace("https://t.me/", "").replace(/^\/+/, "");
  }

  if (rawValue.startsWith("http://t.me/")) {
    return rawValue.replace("http://t.me/", "").replace(/^\/+/, "");
  }

  if (rawValue.startsWith("@")) {
    return rawValue.slice(1);
  }

  return rawValue;
};

const isNumericTelegramReference = (value) =>
  /^-?\d+$/.test(String(value || "").trim());

const pickLatestUsableTelegramGroupField = (values, groupReference) =>
  (Array.isArray(values) ? values : [])
    .map((value) => String(value || "").trim())
    .find(
      (value) =>
        Boolean(value) &&
        normalizeGroupReference(value) !== groupReference,
    ) || "";

const isTelegramGroupEntity = (entity) => {
  const entityClassName = String(entity?.className || "").trim();

  return (
    entity instanceof Api.Channel ||
    entity instanceof Api.ChannelForbidden ||
    entity instanceof Api.Chat ||
    entity instanceof Api.ChatForbidden ||
    entityClassName === "Channel" ||
    entityClassName === "ChannelForbidden" ||
    entityClassName === "Chat" ||
    entityClassName === "ChatForbidden"
  );
};

const isTelegramUserEntity = (entity) => {
  const entityClassName = String(entity?.className || "").trim();

  return (
    entity instanceof Api.User ||
    entityClassName === "User" ||
    entityClassName === "UserEmpty"
  );
};

const buildTelegramEntityCandidates = (entity, dialog) => {
  const username = normalizeGroupReference(entity?.username || dialog?.entity?.username);
  const id = String(entity?.id || dialog?.id || "").trim();
  const title = String(entity?.title || dialog?.title || "").trim().toLowerCase();

  return [username, id, title].filter(Boolean);
};

const isTelegramTimeoutError = (error) => Number(error?.status || 0) === 504;

const runWithTimeout = async (
  promise,
  timeoutMs,
  errorMessage,
  onTimeout = null,
) => {
  let timeoutId = null;

  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timeoutId = setTimeout(() => {
          if (typeof onTimeout === "function") {
            Promise.resolve(onTimeout()).catch(() => {});
          }

          const error = new Error(errorMessage);
          error.status = 504;
          reject(error);
        }, timeoutMs);
      }),
    ]);
  } finally {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
  }
};

const collectTelegramDialogs = async (
  client,
  archived,
  { returnPartialOnTimeout = false } = {},
) => {
  const dialogs = [];
  const iterator = client
    .iterDialogs({
      ignoreMigrated: false,
      archived,
    })
    [Symbol.asyncIterator]();

  while (true) {
    let nextResult = null;

    try {
      nextResult = await runWithTimeout(
        iterator.next(),
        TELEGRAM_DIALOG_ITERATION_TIMEOUT_MS,
        archived
          ? "Timed out while loading archived Telegram conversations."
          : "Timed out while loading Telegram conversations.",
        async () => {
          try {
            await iterator.return?.();
          } catch {
            // ignore iterator shutdown errors
          }

          try {
            await client.disconnect();
          } catch {
            // ignore disconnect errors
          }
        },
      );
    } catch (error) {
      if (returnPartialOnTimeout && error?.status === 504) {
        break;
      }

      throw error;
    }

    if (nextResult?.done) {
      break;
    }

    dialogs.push(nextResult.value);
  }

  return dialogs;
};

const resolveTelegramGroupEntity = async (client, reference) => {
  const normalizedReference = normalizeGroupReference(reference);

  if (!normalizedReference) {
    const error = new Error("Telegram group reference is required.");
    error.status = 400;
    throw error;
  }

  const normalizedReferenceLower = normalizedReference.toLowerCase();
  const dialogs = [
    ...(await collectTelegramDialogs(client, false)),
    ...(await collectTelegramDialogs(client, true)),
  ];

  const matchingDialog = dialogs.find((dialog) => {
    const entity = dialog?.entity;
    const candidates = buildTelegramEntityCandidates(entity, dialog);

    return candidates.some(
      (candidate) => String(candidate || "").toLowerCase() === normalizedReferenceLower,
    );
  });

  if (matchingDialog?.entity) {
    if (!isTelegramGroupEntity(matchingDialog.entity)) {
      const error = new Error(
        "Saved Telegram reference points to a user chat, not a group or channel.",
      );
      error.status = 400;
      throw error;
    }

    return matchingDialog.entity;
  }

  const fallbackEntity = await client.getEntity(normalizedReference);

  if (isTelegramUserEntity(fallbackEntity) || !isTelegramGroupEntity(fallbackEntity)) {
    const error = new Error(
      "Telegram reference must point to a group or channel that this account can access.",
    );
    error.status = 400;
    throw error;
  }

  return fallbackEntity;
};

const normalizePageUrl = (value) => {
  const rawValue = String(value || "").trim();

  if (!rawValue) {
    return "";
  }

  return /^https?:\/\//i.test(rawValue) ? rawValue : `https://${rawValue}`;
};

const sanitizeFileName = (value, fallback = "telegram-file.pdf") => {
  const normalized = String(value || "")
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  return normalized || fallback;
};

const toAsciiHeaderFileName = (value, fallback = "telegram.pdf") => {
  const sanitized = sanitizeFileName(value, fallback)
    .normalize("NFKD")
    .replace(/[^\x20-\x7e]/g, "")
    .replace(/[";%]/g, "")
    .replace(/\s+/g, " ")
    .trim();

  return /[a-z0-9]/i.test(sanitized) ? sanitized : fallback;
};

const buildContentDispositionHeader = (
  dispositionType,
  fileName,
  fallback = "telegram.pdf",
) => {
  const utf8FileName = sanitizeFileName(fileName, fallback);
  const asciiFileName = toAsciiHeaderFileName(utf8FileName, fallback);

  return `${dispositionType}; filename="${asciiFileName}"; filename*=UTF-8''${encodeURIComponent(
    utf8FileName,
  )}`;
};

const getOpenAIClient = () => {
  if (!process.env.OPENAI_API_KEY) {
    return null;
  }

  return new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
  });
};

const getGeminiApiKey = () => String(process.env.GEMINI_API_KEY || "").trim();

const getTelegramAiProviderPreference = (userPreferredProvider = "") => {
  const preferredProvider = String(
    userPreferredProvider || process.env.TELEGRAM_AI_PROVIDER || "",
  ).trim().toLowerCase();

  if (["gemini", "openai"].includes(preferredProvider)) {
    return preferredProvider;
  }

  if (getGeminiApiKey()) {
    return "gemini";
  }

  return "openai";
};

const createGeminiResponse = async ({
  model = TELEGRAM_GEMINI_MODEL,
  instructions = "",
  input = "",
}) => {
  const apiKey = getGeminiApiKey();

  if (!apiKey) {
    throw new Error("Missing GEMINI_API_KEY in the backend environment.");
  }

  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(
      model,
    )}:generateContent`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": apiKey,
      },
      body: JSON.stringify({
        systemInstruction: {
          parts: [{ text: String(instructions || "") }],
        },
        contents: [
          {
            role: "user",
            parts: [{ text: String(input || "") }],
          },
        ],
        generationConfig: {
          temperature: 0.1,
          responseMimeType: "application/json",
        },
      }),
    },
  );

  const payload = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(
      payload?.error?.message || "Gemini course suggestion request failed.",
    );
  }

  const outputText = (Array.isArray(payload?.candidates)
    ? payload.candidates
    : []
  )
    .flatMap((candidate) =>
      Array.isArray(candidate?.content?.parts) ? candidate.content.parts : [],
    )
    .map((part) => String(part?.text || "").trim())
    .filter(Boolean)
    .join("\n")
    .trim();

  return {
    output_text: outputText,
  };
};

const setTelegramCourseSuggestionStatus = (userId, status = {}) => {
  if (!userId) {
    return null;
  }

  const userKey = String(userId);
  const nextStatus = {
    active: Boolean(status.active),
    phase: String(status.phase || ""),
    message: String(status.message || "").trim(),
    updatedAt: new Date().toISOString(),
  };

  telegramCourseSuggestionStatusByUser.set(userKey, nextStatus);
  return nextStatus;
};

const getTelegramCourseSuggestionStatus = (userId) =>
  telegramCourseSuggestionStatusByUser.get(String(userId || "")) || {
    active: false,
    phase: "",
    message: "",
    updatedAt: "",
  };

const getTelegramPdfStoragePath = ({
  groupReference,
  telegramMessageId,
  fileName,
}) => {
  const safeGroupReference = sanitizeFileName(groupReference, "telegram-group")
    .replace(/\s+/g, "-")
    .toLowerCase();
  const safeFileName = sanitizeFileName(
    fileName,
    `telegram-${String(telegramMessageId || "file")}.pdf`,
  );

  return path.join(
    TELEGRAM_PDF_STORAGE_ROOT,
    safeGroupReference,
    `${String(telegramMessageId || "0")}-${safeFileName}`,
  );
};

const extractPdfTextFromFile = async (filePath) => {
  try {
    const pdfParseModule = await import("pdf-parse");
    const pdfParse = pdfParseModule?.default || pdfParseModule;
    const fileBuffer = await fs.readFile(filePath);
    const parsed = await pdfParse(fileBuffer);

    return String(parsed?.text || "").trim();
  } catch {
    return "";
  }
};

const getTelegramConfigSecret = () => {
  const secret = String(
    process.env.TELEGRAM_CONFIG_SECRET || process.env.JWT_KEY || "",
  ).trim();

  if (!secret) {
    const error = new Error(
      "Telegram config secret is missing. Set TELEGRAM_CONFIG_SECRET or JWT_KEY.",
    );
    error.status = 500;
    throw error;
  }

  return crypto.createHash("sha256").update(secret).digest();
};

const encryptValue = (value) => {
  const plainText = String(value || "").trim();

  if (!plainText) {
    return "";
  }

  const key = getTelegramConfigSecret();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(TELEGRAM_ALGORITHM, key, iv);
  const encrypted = Buffer.concat([
    cipher.update(plainText, "utf8"),
    cipher.final(),
  ]);
  const authTag = cipher.getAuthTag();

  return `${iv.toString("base64")}:${authTag.toString("base64")}:${encrypted.toString("base64")}`;
};

const decryptValue = (value) => {
  const serialized = String(value || "").trim();

  if (!serialized) {
    return "";
  }

  const [ivBase64, authTagBase64, encryptedBase64] = serialized.split(":");

  if (!ivBase64 || !authTagBase64 || !encryptedBase64) {
    return "";
  }

  const key = getTelegramConfigSecret();
  const decipher = crypto.createDecipheriv(
    TELEGRAM_ALGORITHM,
    key,
    Buffer.from(ivBase64, "base64"),
  );
  decipher.setAuthTag(Buffer.from(authTagBase64, "base64"));

  const decrypted = Buffer.concat([
    decipher.update(Buffer.from(encryptedBase64, "base64")),
    decipher.final(),
  ]);

  return decrypted.toString("utf8");
};

const clearPendingTelegramAuth = async (userId) => {
  const pending = pendingTelegramAuthByUser.get(String(userId));

  if (!pending) {
    return;
  }

  pendingTelegramAuthByUser.delete(String(userId));

  if (pending.timeoutId) {
    clearTimeout(pending.timeoutId);
  }

  if (pending.client) {
    try {
      await pending.client.disconnect();
    } catch {
      // ignore disconnect errors
    }
  }
};

const setPendingTelegramAuth = (userId, pendingAuth) => {
  const key = String(userId);
  const timeoutId = setTimeout(() => {
    clearPendingTelegramAuth(key).catch(() => {});
  }, TELEGRAM_AUTH_TTL_MS);

  pendingTelegramAuthByUser.set(key, {
    ...pendingAuth,
    timeoutId,
    startedAt: Date.now(),
  });
};

const getPendingTelegramAuth = (userId) => {
  const pending = pendingTelegramAuthByUser.get(String(userId));

  if (!pending) {
    return null;
  }

  if (Date.now() - Number(pending.startedAt || 0) > TELEGRAM_AUTH_TTL_MS) {
    clearPendingTelegramAuth(userId).catch(() => {});
    return null;
  }

  return pending;
};

const getUserTelegramConfig = (user) => {
  const telegramIntegration = user?.telegramIntegration || {};

  return {
    pageUrl: normalizePageUrl(telegramIntegration.pageUrl),
    groupReference: normalizeGroupReference(telegramIntegration.groupReference),
    apiId: decryptValue(telegramIntegration.apiIdEncrypted),
    apiHash: decryptValue(telegramIntegration.apiHashEncrypted),
    stringSession: decryptValue(telegramIntegration.stringSessionEncrypted),
  };
};

const buildConfigStatusPayload = (user) => {
  const telegramIntegration = user?.telegramIntegration || {};

  return {
    configured: Boolean(
      telegramIntegration.apiIdEncrypted &&
        telegramIntegration.apiHashEncrypted &&
        telegramIntegration.stringSessionEncrypted,
    ),
    hasApiId: Boolean(telegramIntegration.apiIdEncrypted),
    hasApiHash: Boolean(telegramIntegration.apiHashEncrypted),
    hasStringSession: Boolean(telegramIntegration.stringSessionEncrypted),
    pageUrl: normalizePageUrl(telegramIntegration.pageUrl),
    groupReference: normalizeGroupReference(telegramIntegration.groupReference),
    historyStartDate: telegramIntegration.historyStartDate || null,
    syncEnabled: Boolean(telegramIntegration.syncEnabled),
    historyImportedAt: telegramIntegration.historyImportedAt || null,
    lastSyncedAt: telegramIntegration.lastSyncedAt || null,
    lastStoredMessageId: Number(telegramIntegration.lastStoredMessageId || 0),
    lastStoredMessageDate: telegramIntegration.lastStoredMessageDate || null,
    lastSyncStatus: String(telegramIntegration.lastSyncStatus || ""),
    lastSyncReason: String(telegramIntegration.lastSyncReason || ""),
    lastSyncMessage: String(telegramIntegration.lastSyncMessage || ""),
    lastSyncImportedCount: Number(
      telegramIntegration.lastSyncImportedCount || 0,
    ),
    lastSyncError: String(telegramIntegration.lastSyncError || ""),
    lastSyncScannedCount: Number(telegramIntegration.lastSyncScannedCount || 0),
    lastSyncNewestMessageDateSeen:
      telegramIntegration.lastSyncNewestMessageDateSeen || null,
    lastSyncOldestMessageDateSeen:
      telegramIntegration.lastSyncOldestMessageDateSeen || null,
    lastSyncOldestImportedMessageDate:
      telegramIntegration.lastSyncOldestImportedMessageDate || null,
    lastSyncFirstSkippedBeforeStartDate:
      telegramIntegration.lastSyncFirstSkippedBeforeStartDate || null,
    lastSyncReachedStartBoundary: Boolean(
      telegramIntegration.lastSyncReachedStartBoundary,
    ),
  };
};

const applyTelegramSyncResult = (user, syncResult = {}) => {
  if (!user?.telegramIntegration) {
    user.telegramIntegration = {};
  }

  user.telegramIntegration.lastSyncStatus = String(syncResult.status || "");
  user.telegramIntegration.lastSyncReason = String(syncResult.reason || "");
  user.telegramIntegration.lastSyncMessage = String(syncResult.message || "");
  user.telegramIntegration.lastSyncImportedCount = Number(
    syncResult.importedCount || 0,
  );
  user.telegramIntegration.lastSyncError = String(syncResult.error || "");
  user.telegramIntegration.lastSyncScannedCount = Number(
    syncResult.scannedCount || 0,
  );
  user.telegramIntegration.lastSyncNewestMessageDateSeen =
    syncResult.newestMessageDateSeen || null;
  user.telegramIntegration.lastSyncOldestMessageDateSeen =
    syncResult.oldestMessageDateSeen || null;
  user.telegramIntegration.lastSyncOldestImportedMessageDate =
    syncResult.oldestImportedMessageDate || null;
  user.telegramIntegration.lastSyncFirstSkippedBeforeStartDate =
    syncResult.firstSkippedBeforeStartDate || null;
  user.telegramIntegration.lastSyncReachedStartBoundary = Boolean(
    syncResult.reachedStartBoundary,
  );
};

const getStoredMessageCountForUser = async (user) => {
  const groupReference = normalizeGroupReference(
    user?.telegramIntegration?.groupReference,
  );

  if (!user?._id || !groupReference) {
    return 0;
  }

  return TelegramMessageModel.countDocuments({
    ownerUserId: user._id,
    groupReference,
  });
};

const normalizeTelegramDateMs = (value) => {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value.getTime();
  }

  const numericValue = Number(value);

  if (Number.isFinite(numericValue) && numericValue > 0) {
    // Telegram/GramJS dates may arrive as Unix seconds. Convert them to JS ms.
    if (numericValue < 1e12) {
      return numericValue * 1000;
    }

    return numericValue;
  }

  if (!value) {
    return null;
  }

  const parsedDateMs = new Date(value).getTime();
  return Number.isNaN(parsedDateMs) ? null : parsedDateMs;
};

const buildMessagePayload = (message) => {
  const senderId = message?.senderId || message?.peerId || null;
  const sender =
    String(message?.postAuthor || "").trim() ||
    (senderId?.className === "PeerChannel" && senderId?.channelId
      ? `Channel ${String(senderId.channelId)}`
      : "") ||
    (senderId?.className === "PeerChat" && senderId?.chatId
      ? `Chat ${String(senderId.chatId)}`
      : "") ||
    "Unknown";
  const document = message?.media?.document || message?.document || null;
  const attributes = Array.isArray(document?.attributes)
    ? document.attributes
    : [];
  let attachmentFileName = "";

  attributes.forEach((attribute) => {
    const className = String(attribute?.className || "").trim();
    const isFileNameAttribute =
      attribute instanceof Api.DocumentAttributeFilename ||
      className === "DocumentAttributeFilename";

    if (isFileNameAttribute && !attachmentFileName) {
      attachmentFileName = String(attribute?.fileName || "").trim();
    }
  });

  const attachmentMimeType = String(document?.mimeType || "")
    .trim()
    .toLowerCase();
  const attachmentFileExtension = attachmentFileName.includes(".")
    ? String(attachmentFileName.split(".").pop() || "")
      .trim()
      .toLowerCase()
    : "";
  const attachmentIsPdf =
    attachmentMimeType === "application/pdf" ||
    attachmentFileExtension === "pdf";

  return {
    id: message?.id || null,
    text: message?.message || "",
    date: normalizeTelegramDateMs(message?.date),
    sender,
    views: typeof message?.views === "number" ? message.views : null,
    replyToMessageId: message?.replyTo?.replyToMsgId || null,
    attachmentKind: document ? (attachmentIsPdf ? "pdf" : "document") : "",
    attachmentMimeType,
    attachmentFileName,
    attachmentFileExtension,
    attachmentSizeBytes:
      typeof document?.size === "number" ? document.size : null,
    attachmentIsPdf,
  };
};

const enrichTelegramPdfPayload = async ({
  client,
  message,
  groupReference,
  payload,
}) => {
  if (!payload?.attachmentIsPdf || !payload?.id) {
    return payload;
  }

  try {
    const outputPath = getTelegramPdfStoragePath({
      groupReference,
      telegramMessageId: payload.id,
      fileName: payload.attachmentFileName,
    });
    await fs.mkdir(path.dirname(outputPath), {
      recursive: true,
    });

    try {
      await fs.access(outputPath);
    } catch {
      await client.downloadMedia(message, {
        outputFile: outputPath,
      });
    }

    const attachmentTextExtracted = await extractPdfTextFromFile(outputPath);

    return {
      ...payload,
      attachmentStoredPath: outputPath,
      attachmentStoredAt: new Date(),
      attachmentTextExtracted,
    };
  } catch {
    return payload;
  }
};

const normalizeSearchText = (value) =>
  String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9\u0600-\u06ff\s]/gi, " ")
    .replace(/\s+/g, " ")
    .trim();

const tokenizeSearchQuery = (value) =>
  normalizeSearchText(value)
    .split(" ")
    .filter((token) => token.length >= 2)
    .filter((token) => !TELEGRAM_SEARCH_STOP_WORDS.has(token));

const buildNormalizedCourseExamEntry = (value = {}) => ({
  exam_type: String(value?.exam_type || "-").trim() || "-",
  exam_date: String(value?.exam_date || "-").trim() || "-",
  exam_time: String(value?.exam_time || "-").trim() || "-",
  course_grade: String(value?.course_grade || "").trim(),
  course_fullGrade: String(value?.course_fullGrade || "").trim(),
});

const getPrimaryCourseExam = (examEntries = []) => {
  const firstExam = Array.isArray(examEntries) ? examEntries[0] || {} : {};

  return buildNormalizedCourseExamEntry(firstExam);
};

const toCourseArray = (value) =>
  (Array.isArray(value) ? value : [])
    .map((entry) => String(entry || "").trim())
    .filter(Boolean);

const toCourseNumber = (value, fallback = 0) => {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
};

const buildNormalizedCoursePayload = (payload = {}) => {
  const courseExams = (Array.isArray(payload?.course_exams)
    ? payload.course_exams
    : []
  )
    .map((examEntry) => buildNormalizedCourseExamEntry(examEntry))
    .filter(
      (examEntry) =>
        examEntry.exam_type !== "-" ||
        examEntry.exam_date !== "-" ||
        examEntry.exam_time !== "-" ||
        examEntry.course_grade ||
        examEntry.course_fullGrade,
    );
  const primaryExam = getPrimaryCourseExam(courseExams);

  return {
    course_name: String(payload?.course_name || "").trim(),
    course_component: String(payload?.course_component || "-").trim() || "-",
    course_dayAndTime: toCourseArray(payload?.course_dayAndTime),
    course_year: String(payload?.course_year || "-").trim() || "-",
    course_term: String(payload?.course_term || "-").trim() || "-",
    course_class: String(payload?.course_class || "-").trim() || "-",
    course_status: String(payload?.course_status || "-").trim() || "-",
    course_instructors: toCourseArray(payload?.course_instructors),
    course_grade:
      String(primaryExam.course_grade || payload?.course_grade || "").trim(),
    course_fullGrade:
      String(primaryExam.course_fullGrade || payload?.course_fullGrade || "").trim(),
    course_length: Math.max(0, toCourseNumber(payload?.course_length, 0)),
    course_progress: Math.max(0, toCourseNumber(payload?.course_progress, 0)),
    course_exams: courseExams,
    exam_type: String(primaryExam.exam_type || payload?.exam_type || "-").trim() || "-",
    exam_date: String(primaryExam.exam_date || payload?.exam_date || "-").trim() || "-",
    exam_time: String(primaryExam.exam_time || payload?.exam_time || "-").trim() || "-",
  };
};

const buildCourseDuplicateKey = (payload = {}) =>
  [
    normalizeSearchText(payload?.course_name),
    normalizeSearchText(payload?.course_component),
    normalizeSearchText(payload?.course_year),
    normalizeSearchText(payload?.course_term),
  ]
    .filter(Boolean)
    .join("|");

const buildPendingCoursePayload = (courseName = "") => ({
  course_name: String(courseName || "").trim(),
  course_component: "(pending)",
  course_dayAndTime: [
    {
      day: "(pending)",
      time: "(pending)",
    },
  ],
  course_year: "(pending)",
  course_term: "(pending)",
  course_class: "(pending)",
  course_status: "(pending)",
  course_instructors: ["(pending)"],
  course_grade: "(pending)",
  course_fullGrade: "(pending)",
  course_length: "(pending)",
  course_progress: "(pending)",
  course_exams: [
    {
      exam_type: "(pending)",
      exam_date: "(pending)",
      exam_time: "(pending)",
      course_grade: "(pending)",
      course_fullGrade: "(pending)",
    },
  ],
  exam_type: "(pending)",
  exam_date: "(pending)",
  exam_time: "(pending)",
});

const hasArabicCharacters = (value) => /[\u0600-\u06ff]/.test(String(value || ""));

const hasLatinCharacters = (value) => /[a-z]/i.test(String(value || ""));

const resolveCourseBilingualNames = ({
  courseName = "",
  courseArabicName = "",
  courseEnglishName = "",
}) => {
  const normalizedCourseName = String(courseName || "").trim();
  let normalizedArabicName = String(courseArabicName || "").trim();
  let normalizedEnglishName = String(courseEnglishName || "").trim();

  if (!normalizedArabicName && hasArabicCharacters(normalizedCourseName)) {
    normalizedArabicName = normalizedCourseName;
  }

  if (!normalizedEnglishName && hasLatinCharacters(normalizedCourseName)) {
    normalizedEnglishName = normalizedCourseName;
  }

  if (!normalizedArabicName) {
    normalizedArabicName = normalizedEnglishName || normalizedCourseName;
  }

  if (!normalizedEnglishName) {
    normalizedEnglishName = normalizedArabicName || normalizedCourseName;
  }

  return {
    courseArabicName: normalizedArabicName,
    courseEnglishName: normalizedEnglishName,
  };
};

const buildNameOnlyCourseSuggestion = ({
  suggestionKey = "",
  duplicateKey = "",
  confidence = 0,
  reasons = [],
  matchedKeys = ["course_name"],
  sourceMessageIds = [],
  sources = [],
  conceptualSummary = "",
  courseArabicName = "",
  courseEnglishName = "",
  coursePayload = {},
}) => {
  const normalizedPrimaryPayload = buildNormalizedCoursePayload(coursePayload);
  const resolvedNames = resolveCourseBilingualNames({
    courseName: normalizedPrimaryPayload.course_name,
    courseArabicName,
    courseEnglishName,
  });

  return buildBilingualCourseSuggestion({
    suggestionKey,
    duplicateKey,
    confidence,
    reasons,
    matchedKeys,
    sourceMessageIds,
    sources,
    conceptualSummary,
    courseArabicName: resolvedNames.courseArabicName,
    courseEnglishName: resolvedNames.courseEnglishName,
    coursePayload: {
      course_name:
        resolvedNames.courseArabicName ||
        resolvedNames.courseEnglishName ||
        normalizedPrimaryPayload.course_name,
    },
    suggestionStage: "name_prediction",
  });
};

const buildBilingualCourseSuggestion = ({
  suggestionKey = "",
  duplicateKey = "",
  confidence = 0,
  reasons = [],
  matchedKeys = ["course_name"],
  sourceMessageIds = [],
  sources = [],
  conceptualSummary = "",
  courseArabicName = "",
  courseEnglishName = "",
  coursePayload = {},
  suggestionStage = "name_prediction",
}) => {
  const normalizedPrimaryPayload = buildNormalizedCoursePayload(coursePayload);
  const normalizedArabicName = String(
    courseArabicName || normalizedPrimaryPayload.course_name || "",
  ).trim();
  const normalizedEnglishName = String(courseEnglishName || "").trim();

  return {
    suggestionKey: String(suggestionKey || "").trim(),
    duplicateKey: String(duplicateKey || "").trim(),
    suggestionStage,
    confidence: Math.max(0, Math.min(100, Number(confidence || 0))),
    reasons: Array.isArray(reasons) ? reasons : [],
    matchedKeys: Array.isArray(matchedKeys) ? matchedKeys : [],
    sourceMessageIds: Array.isArray(sourceMessageIds) ? sourceMessageIds : [],
    conceptualSummary: String(conceptualSummary || "").trim(),
    sources: Array.isArray(sources) ? sources : [],
    courseArabic:
      suggestionStage === "name_prediction"
        ? buildPendingCoursePayload(normalizedArabicName)
        : {
            ...buildPendingCoursePayload(normalizedArabicName),
            ...normalizedPrimaryPayload,
            course_name: normalizedArabicName || normalizedPrimaryPayload.course_name,
          },
    courseEnglish:
      suggestionStage === "name_prediction"
        ? buildPendingCoursePayload(
            normalizedEnglishName || normalizedArabicName,
          )
        : {
            ...buildPendingCoursePayload(
              normalizedEnglishName || normalizedArabicName,
            ),
            ...normalizedPrimaryPayload,
            course_name:
              normalizedEnglishName ||
              normalizedArabicName ||
              normalizedPrimaryPayload.course_name,
          },
    coursePayload:
      suggestionStage === "name_prediction"
        ? buildPendingCoursePayload(normalizedArabicName)
        : normalizedPrimaryPayload,
  };
};

const buildExistingCourseIndex = (courses = []) => {
  const index = new Map();

  (Array.isArray(courses) ? courses : []).forEach((course) => {
    const normalizedCourse = buildNormalizedCoursePayload(course);
    const duplicateKey = buildCourseDuplicateKey(normalizedCourse);

    if (!duplicateKey || index.has(duplicateKey)) {
      return;
    }

    index.set(duplicateKey, {
      courseId: String(course?._id || ""),
      courseName: normalizedCourse.course_name,
    });
  });

  return index;
};

const scoreContextEntryForCourseName = (
  contextEntry,
  normalizedCourseName,
  courseNameTokens = [],
) => {
  const searchableText = normalizeSearchText([
    contextEntry?.snippet,
    contextEntry?.attachmentFileName,
    contextEntry?.sender,
  ].join(" "));

  if (!searchableText) {
    return 0;
  }

  let score = 0;

  if (normalizedCourseName && searchableText.includes(normalizedCourseName)) {
    score += 9;
  }

  courseNameTokens.forEach((token) => {
    if (searchableText.includes(token)) {
      score += 2;
    }
  });

  if (String(contextEntry?.attachmentFileName || "").trim()) {
    score += 1;
  }

  return score;
};

const selectCourseContextEntries = (contextEntries = [], courseName = "") => {
  const normalizedCourseName = normalizeSearchText(courseName);
  const courseNameTokens = tokenizeSearchQuery(courseName);

  return (Array.isArray(contextEntries) ? contextEntries : [])
    .map((contextEntry) => ({
      contextEntry,
      score: scoreContextEntryForCourseName(
        contextEntry,
        normalizedCourseName,
        courseNameTokens,
      ),
    }))
    .filter((entry) => entry.score > 0)
    .sort((left, right) => right.score - left.score)
    .slice(0, 28)
    .map((entry) => entry.contextEntry);
};

const buildMessageSnippet = (
  message,
  maxLength = TELEGRAM_COURSE_SUGGESTION_SNIPPET_MAX_LENGTH,
) => {
  const content = [
    String(message?.attachmentTextExtracted || "").trim(),
    String(message?.attachmentFileName || "").trim(),
    String(message?.text || "").trim(),
  ]
    .filter(Boolean)
    .join("\n\n");

  if (content.length <= maxLength) {
    return content;
  }

  return `${content.slice(0, maxLength)}...`;
};

const isMeaningfulExtractedCourseText = (value) => {
  const nextValue = String(value || "").trim();

  if (!nextValue) {
    return false;
  }

  const normalizedValue = normalizeSearchText(nextValue);
  const tokens = normalizedValue.split(" ").filter(Boolean);
  const uniqueTokens = new Set(tokens);
  const alphaNumericChars = (nextValue.match(/[A-Za-z0-9\u0600-\u06FF]/g) || [])
    .length;
  const totalChars = nextValue.length || 1;
  const alphaNumericRatio = alphaNumericChars / totalChars;

  if (nextValue.length < 80) {
    return false;
  }

  if (tokens.length < 12 || uniqueTokens.size < 6) {
    return false;
  }

  if (alphaNumericRatio < 0.45) {
    return false;
  }

  return true;
};

const scoreMessageForCourseSuggestion = (message) => {
  const extractedText = String(message?.attachmentTextExtracted || "").trim();
  const hasMeaningfulExtractedText =
    isMeaningfulExtractedCourseText(extractedText);
  const fileNameText = String(message?.attachmentFileName || "").trim();
  const messageText = String(message?.text || "").trim();
  const normalizedExtractedText = normalizeSearchText(extractedText);
  const normalizedFileNameText = normalizeSearchText(fileNameText);
  const normalizedMessageText = normalizeSearchText(messageText);
  const normalizedContent = [
    normalizedExtractedText,
    normalizedFileNameText,
    normalizedMessageText,
  ]
    .filter(Boolean)
    .join(" ");

  if (!normalizedContent) {
    return {
      score: 0,
      matchedKeys: [],
      hasTitleLikeSurface: false,
    };
  }

  const hasTitleLikeSurface = [fileNameText, messageText].some(
    (value) => Boolean(String(value || "").trim()) && !isLikelyCourseMetaOnlyText(value),
  );

  if (!hasMeaningfulExtractedText && !hasTitleLikeSurface) {
    return {
      score: 0,
      matchedKeys: [],
      hasTitleLikeSurface: false,
    };
  }

  const matchedKeys = Object.entries(TELEGRAM_COURSE_FIELD_HINTS)
    .filter(([, hints]) =>
      hints.some((hint) => {
        const normalizedHint = normalizeSearchText(hint);

        return (
          normalizedExtractedText.includes(normalizedHint) ||
          normalizedFileNameText.includes(normalizedHint) ||
          normalizedMessageText.includes(normalizedHint)
        );
      }),
    )
    .map(([key]) => key);

  let score = matchedKeys.length * 4;

  if (message?.attachmentIsPdf) {
    score += 3;
  }

  if (hasMeaningfulExtractedText) {
    score += 10;
  }

  if (
    hasMeaningfulExtractedText &&
    (matchedKeys.includes("course_name") ||
      matchedKeys.includes("course_instructors") ||
      matchedKeys.includes("course_year") ||
      matchedKeys.includes("course_term"))
  ) {
    score += 8;
  }

  return {
    score,
    matchedKeys,
    hasTitleLikeSurface,
  };
};

const buildCourseSuggestionContextEntries = (messages = []) =>
  (Array.isArray(messages) ? messages : [])
    .map((message) => {
      const scoreResult = scoreMessageForCourseSuggestion(message);

      return {
        messageId: Number(message?.id || 0),
        date: message?.date || null,
        sender: String(message?.sender || "").trim(),
        attachmentFileName: String(message?.attachmentFileName || "").trim(),
        matchedKeys: scoreResult.matchedKeys,
        score: scoreResult.score,
        hasTitleLikeSurface: Boolean(scoreResult.hasTitleLikeSurface),
        snippet: buildMessageSnippet(message),
      };
    })
    .filter(
      (entry) =>
        entry.messageId &&
        entry.snippet &&
        (entry.score > 0 || (entry.attachmentFileName && entry.hasTitleLikeSurface)),
    )
    .sort(
      (firstEntry, secondEntry) =>
        Number(secondEntry.score || 0) - Number(firstEntry.score || 0) ||
        Number(secondEntry.date || 0) - Number(firstEntry.date || 0),
    )
    .slice(0, 36);

const buildCourseSuggestionAiContextEntries = (contextEntries = []) =>
  (Array.isArray(contextEntries) ? contextEntries : [])
    .filter(
      (entry) =>
        Number(entry?.score || 0) >= 10 ||
        Boolean(String(entry?.attachmentFileName || "").trim()),
    )
    .map((entry) => ({
      messageId: Number(entry?.messageId || 0),
      date: entry?.date || null,
      attachmentFileName: String(entry?.attachmentFileName || "").trim(),
      matchedKeys: Array.isArray(entry?.matchedKeys) ? entry.matchedKeys : [],
      snippet: String(entry?.snippet || "")
        .replace(/\s{3,}/g, "  ")
        .trim()
        .slice(0, TELEGRAM_COURSE_SUGGESTION_SNIPPET_MAX_LENGTH),
    }))
    .slice(0, TELEGRAM_COURSE_SUGGESTION_AI_CONTEXT_LIMIT);

const parseJsonObjectFromText = (value) => {
  const rawText = String(value || "").trim();

  if (!rawText) {
    return null;
  }

  try {
    return JSON.parse(rawText);
  } catch {}

  const firstBraceIndex = rawText.indexOf("{");
  const lastBraceIndex = rawText.lastIndexOf("}");

  if (firstBraceIndex === -1 || lastBraceIndex === -1 || lastBraceIndex <= firstBraceIndex) {
    return null;
  }

  try {
    return JSON.parse(rawText.slice(firstBraceIndex, lastBraceIndex + 1));
  } catch {
    return null;
  }
};

const TELEGRAM_COURSE_TITLE_NOISE_PATTERNS = [
  /\.pdf$/i,
  /success\s*team/gi,
  /official/gi,
  /التقسي.?م الإمتحاني/gi,
  /التقسيم الامتحاني/gi,
  /تصويبات/gi,
  /تقسيم/gi,
  /حل دورة/gi,
  /حل/gi,
  /ملف/gi,
  /مادة/gi,
  /المادة/gi,
  /محاضرات?/gi,
  /ملحق(?:ين)?/gi,
];

const isLikelyAbbreviatedCourseTitle = (value) => {
  const nextValue = String(value || "").trim();
  const compactValue = nextValue.replace(/\s+/g, "");

  if (!compactValue) {
    return false;
  }

  if (/^[A-Z]{2,10}$/.test(compactValue)) {
    return true;
  }

  if (/^(?:[A-Za-z]\.?){2,10}$/.test(compactValue)) {
    return true;
  }

  if (/^[A-Za-z0-9]{2,12}$/.test(compactValue)) {
    return true;
  }

  return false;
};

const TELEGRAM_COURSE_TITLE_CHAT_NOISE_PATTERNS = [
  /^مساء الخير$/i,
  /^صباح الخير$/i,
  /^يعطيكم العافية$/i,
  /^مرحبا$/i,
  /^أهلا$/i,
  /^اهلا$/i,
  /^هاي$/i,
  /^hello$/i,
  /^hi$/i,
  /^good morning$/i,
  /^good evening$/i,
  /^يا مساء الخير$/i,
  /^يا صباح الخير$/i,
  /^بآخر توصاية.*$/i,
  /^كلشي .*$/i,
  /^أي حدا .*$/i,
];
const TELEGRAM_COURSE_TITLE_ADMIN_NOISE_PATTERNS = [
  /^برنامج\s+الدوام$/i,
  /^مثبت(?:ة)?\s+الفصل\s+(?:الأول|الاول|الثاني|الثالث|الرابع|الخامس|السادس|1|2|3|4|5|6)$/i,
  /^الفصل\s+الدراسي\s+(?:الأول|الاول|الثاني|الثالث|الرابع|الخامس|السادس|1|2|3|4|5|6)$/i,
  /^#?سنة\s+(?:أولى|اولى|ثانية|ثالثة|رابعة|خامسة|سادسة|1|2|3|4|5|6)$/i,
  /^فئات\s+السنة\s+(?:الأولى|الاولى|الثانية|الثالثة|الرابعة|الخامسة|السادسة|1|2|3|4|5|6)(?:\s+الفصل\s+(?:الأول|الاول|الثاني|1|2))?$/i,
  /^بخصوص\s+سلم\s+.+$/i,
  /^سلم\s+.+$/i,
];
const TELEGRAM_COURSE_META_ONLY_WORD_PATTERN = /^(?:مثبت(?:ة)?|مثبت|الفصل|الترم|السمستر|semester|term|year|level|first|second|third|fourth|fifth|sixth|الاول|الأول|الثاني|الثالث|الرابع|الخامس|السادس|اول|ثاني|ثالث|رابع|خامس|سادس|السنة|الأولى|الثانية|الثالثة|الرابعة|الخامسة|السادسة|1st|2nd|3rd|4th|5th|6th|1|2|3|4|5|6|عملي|نظري|lecture|lab|practical|theory)$/i;

const TELEGRAM_ARABIC_DIACRITICS_PATTERN =
  /[\u0610-\u061A\u064B-\u065F\u0670\u06D6-\u06ED]/g;

const stripArabicDiacritics = (value = "") =>
  String(value || "").replace(TELEGRAM_ARABIC_DIACRITICS_PATTERN, "");

const hasMeaningfulCourseTitleStructure = (value = "") => {
  const rawValue = String(value || "").trim();
  const plainValue = stripArabicDiacritics(rawValue)
    .replace(/\s+/g, " ")
    .trim();

  if (!plainValue) {
    return false;
  }

  if (isLikelyAbbreviatedCourseTitle(plainValue)) {
    return true;
  }

  const rawDiacriticsCount = (
    rawValue.match(TELEGRAM_ARABIC_DIACRITICS_PATTERN) || []
  ).length;
  const words = plainValue
    .split(/\s+/)
    .map((word) => word.trim())
    .filter(Boolean);
  const longWords = words.filter((word) => word.length >= 4);
  const shortWords = words.filter((word) => word.length <= 2);

  if (rawDiacriticsCount > 0) {
    return false;
  }

  if ((plainValue.match(/[\u0621-\u064A]/g) || []).length > 0 && longWords.length === 0) {
    return false;
  }

  if (words.length > 1 && shortWords.length >= words.length - 1) {
    return false;
  }

  if (words.length >= 3 && words.every((word) => word.length <= 3)) {
    return false;
  }

  return true;
};

const normalizeTelegramCourseSuggestionMatchedKeys = (matchedKeys = []) => {
  const uniqueKeys = [
    ...new Set(
      (Array.isArray(matchedKeys) ? matchedKeys : [])
        .map((key) => String(key || "").trim())
        .filter((key) => TELEGRAM_COURSE_PAYLOAD_KEYS.includes(key)),
    ),
  ];

  if (!uniqueKeys.includes("course_name")) {
    return [];
  }

  return [
    "course_name",
    ...uniqueKeys.filter((key) => key !== "course_name"),
  ];
};

const isLikelyCourseMetaOnlyText = (value = "") => {
  const plainValue = stripArabicDiacritics(String(value || ""))
    .replace(/[_\-–—:]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  if (!plainValue) {
    return false;
  }

  const words = plainValue
    .split(/\s+/)
    .map((word) => word.trim())
    .filter(Boolean);

  if (words.length === 0) {
    return false;
  }

  const hasSemesterOrYearSignal = /الفصل|الترم|السمستر|semester|term|year|السنة|level|اول|أول|ثاني|ثالث|رابع|خامس|سادس|first|second|third|fourth|fifth|sixth|1st|2nd|3rd|4th|5th|6th|1|2|3|4|5|6/i.test(
    plainValue,
  );
  const nonMetaWords = words.filter(
    (word) => word.length >= 3 && !TELEGRAM_COURSE_META_ONLY_WORD_PATTERN.test(word),
  );

  return hasSemesterOrYearSignal && nonMetaWords.length === 0;
};

const finalizeAiCourseSuggestions = ({
  rawSuggestions = [],
  existingCourseIndex,
  contextEntries = [],
}) => {
  const seenSuggestionKeys = new Set();

  return (Array.isArray(rawSuggestions) ? rawSuggestions : [])
    .map((suggestion, index) => {
      const coursePayload = buildNormalizedCoursePayload(
        suggestion?.coursePayload,
      );

      if (!coursePayload.course_name) {
        return null;
      }

      const duplicateKey = buildCourseDuplicateKey(coursePayload);

      if (!duplicateKey) {
        return null;
      }

      if (
        existingCourseIndex.has(duplicateKey) ||
        seenSuggestionKeys.has(duplicateKey)
      ) {
        return null;
      }

      seenSuggestionKeys.add(duplicateKey);

      const sourceMessageIds = (Array.isArray(suggestion?.sourceMessageIds)
        ? suggestion.sourceMessageIds
        : []
      )
        .map((messageId) => Number(messageId || 0))
        .filter(Boolean);
      const matchedKeys = normalizeTelegramCourseSuggestionMatchedKeys(
        suggestion?.matchedKeys,
      );

      if (matchedKeys.length === 0) {
        return null;
      }

      return buildNameOnlyCourseSuggestion({
        suggestionKey: `${duplicateKey}|${index}`,
        duplicateKey,
        confidence: Math.max(0, Math.min(100, Number(suggestion?.confidence || 0))),
        reasons: (Array.isArray(suggestion?.reasons) ? suggestion.reasons : [])
          .map((reason) => String(reason || "").trim())
          .filter(Boolean)
          .slice(0, 4),
        matchedKeys,
        sourceMessageIds,
        conceptualSummary: String(suggestion?.conceptualSummary || "").trim(),
        courseArabicName: String(suggestion?.courseArabicName || "").trim(),
        courseEnglishName: String(suggestion?.courseEnglishName || "").trim(),
        coursePayload,
        sources: contextEntries
          .filter((entry) => sourceMessageIds.includes(entry.messageId))
          .slice(0, 4),
      });
    })
    .filter(
      (entry) =>
        Boolean(entry) &&
        hasMeaningfulCourseTitleStructure(entry?.coursePayload?.course_name || ""),
    );
};

const buildPersistedTelegramCourseSuggestionsRecord = ({
  groupReference = "",
  groupTitle = "",
  sourceMessageId = null,
  sourceAttachmentFileName = "",
  suggestions = [],
  analyzedMessagesCount = 0,
  searchedKeys = [],
}) => ({
  groupReference: String(groupReference || "").trim(),
  groupTitle: String(groupTitle || "").trim(),
  sourceMessageId:
    sourceMessageId !== null && Number.isFinite(Number(sourceMessageId))
      ? Number(sourceMessageId)
      : null,
  sourceAttachmentFileName: String(sourceAttachmentFileName || "").trim(),
  savedAt: new Date(),
  analyzedMessagesCount: Math.max(0, Number(analyzedMessagesCount || 0)),
  searchedKeys: Array.isArray(searchedKeys) ? searchedKeys : [],
  suggestions: (Array.isArray(suggestions) ? suggestions : [])
    .filter((suggestion) =>
      hasMeaningfulCourseTitleStructure(
        suggestion?.coursePayload?.course_name || "",
      ) &&
      normalizeTelegramCourseSuggestionMatchedKeys(
        suggestion?.matchedKeys,
      ).length > 0,
    )
    .map((suggestion) => ({
      suggestionKey: String(suggestion?.suggestionKey || "").trim(),
      duplicateKey: String(suggestion?.duplicateKey || "").trim(),
      suggestionStage: String(suggestion?.suggestionStage || "name_prediction").trim(),
      confidence: Math.max(0, Math.min(100, Number(suggestion?.confidence || 0))),
      reasons: Array.isArray(suggestion?.reasons) ? suggestion.reasons : [],
      matchedKeys: normalizeTelegramCourseSuggestionMatchedKeys(
        suggestion?.matchedKeys,
      ),
      sourceMessageIds: Array.isArray(suggestion?.sourceMessageIds)
        ? suggestion.sourceMessageIds
        : [],
      conceptualSummary: String(suggestion?.conceptualSummary || "").trim(),
      courseArabic: suggestion?.courseArabic || buildPendingCoursePayload(""),
      courseEnglish: suggestion?.courseEnglish || buildPendingCoursePayload(""),
      coursePayload: buildNormalizedCoursePayload(suggestion?.coursePayload),
      sources: Array.isArray(suggestion?.sources) ? suggestion.sources : [],
    })),
});

const upsertTelegramCourseSuggestionsRecord = ({
  user,
  groupReference = "",
  groupTitle = "",
  sourceMessageId = null,
  sourceAttachmentFileName = "",
  suggestions = [],
  analyzedMessagesCount = 0,
  searchedKeys = [],
}) => {
  if (!user?.schoolPlanner) {
    user.schoolPlanner = {};
  }

  if (!Array.isArray(user.schoolPlanner.telegramCourseSuggestions)) {
    user.schoolPlanner.telegramCourseSuggestions = [];
  }

  const record = buildPersistedTelegramCourseSuggestionsRecord({
    groupReference,
    groupTitle,
    sourceMessageId,
    sourceAttachmentFileName,
    suggestions,
    analyzedMessagesCount,
    searchedKeys,
  });
  const recordIndex = user.schoolPlanner.telegramCourseSuggestions.findIndex(
    (entry) =>
      String(entry?.groupReference || "").trim() ===
        String(groupReference || "").trim() &&
      Number(entry?.sourceMessageId || 0) ===
        Number(sourceMessageId !== null ? sourceMessageId : 0),
  );

  if (recordIndex === -1) {
    user.schoolPlanner.telegramCourseSuggestions.push(record);
  } else {
    user.schoolPlanner.telegramCourseSuggestions.splice(recordIndex, 1, record);
  }

  return record;
};

const mergeTelegramCourseSuggestions = (...suggestionSets) => {
  const mergedSuggestions = [];
  const seenDuplicateKeys = new Set();

  suggestionSets.forEach((suggestions) => {
    (Array.isArray(suggestions) ? suggestions : []).forEach((suggestion) => {
      const duplicateKey =
        String(suggestion?.duplicateKey || "").trim() ||
        buildCourseDuplicateKey(suggestion?.coursePayload);

      if (!duplicateKey || seenDuplicateKeys.has(duplicateKey)) {
        return;
      }

      seenDuplicateKeys.add(duplicateKey);
      mergedSuggestions.push(suggestion);
    });
  });

  return mergedSuggestions;
};

const isTelegramCourseSuggestionAllGroupsScope = (
  groupReference = "",
  sourceMessageId = null,
) =>
  String(groupReference || "").trim() ===
    TELEGRAM_COURSE_SUGGESTION_ALL_GROUPS_SCOPE &&
  Number(sourceMessageId || 0) === 0;

const getSavedTelegramCourseSuggestionsRecords = (
  user,
  groupReference = "",
  sourceMessageId = null,
) =>
  (Array.isArray(user?.schoolPlanner?.telegramCourseSuggestions)
    ? user.schoolPlanner.telegramCourseSuggestions
    : []
  ).filter((entry) => {
    if (
      isTelegramCourseSuggestionAllGroupsScope(groupReference, sourceMessageId)
    ) {
      return Number(entry?.sourceMessageId || 0) === 0;
    }

    return (
      String(entry?.groupReference || "").trim() ===
        String(groupReference || "").trim() &&
      Number(entry?.sourceMessageId || 0) ===
        Number(sourceMessageId !== null ? sourceMessageId : 0)
    );
  });

const getSavedTelegramCourseSuggestionsRecord = (
  user,
  groupReference = "",
  sourceMessageId = null,
) => {
  const matchingRecords = getSavedTelegramCourseSuggestionsRecords(
    user,
    groupReference,
    sourceMessageId,
  );

  if (matchingRecords.length === 0) {
    return null;
  }

  if (
    !isTelegramCourseSuggestionAllGroupsScope(groupReference, sourceMessageId)
  ) {
    return matchingRecords[0] || null;
  }

  const latestSavedAtRecord = matchingRecords
    .slice()
    .sort(
      (firstEntry, secondEntry) =>
        new Date(secondEntry?.savedAt || 0).getTime() -
        new Date(firstEntry?.savedAt || 0).getTime(),
    )[0];

  return {
    groupReference: TELEGRAM_COURSE_SUGGESTION_ALL_GROUPS_SCOPE,
    groupTitle: "All stored groups",
    sourceMessageId: null,
    sourceAttachmentFileName: "",
    savedAt: latestSavedAtRecord?.savedAt || null,
    analyzedMessagesCount: matchingRecords.reduce(
      (total, entry) =>
        total + Math.max(0, Number(entry?.analyzedMessagesCount || 0)),
      0,
    ),
    searchedKeys: [
      ...new Set(
        matchingRecords.flatMap((entry) =>
          Array.isArray(entry?.searchedKeys) ? entry.searchedKeys : [],
        ),
      ),
    ],
    suggestions: mergeTelegramCourseSuggestions(
      ...matchingRecords.map((entry) =>
        (Array.isArray(entry?.suggestions) ? entry.suggestions : []).map(
          (suggestion) => ({
            ...suggestion,
            originGroupReference: String(entry?.groupReference || "").trim(),
            originGroupTitle: String(entry?.groupTitle || "").trim(),
            originSourceMessageId: Number(entry?.sourceMessageId || 0) || null,
            originSourceAttachmentFileName: String(
              entry?.sourceAttachmentFileName || "",
            ).trim(),
          }),
        ),
      ),
    ),
  };
};

const removeTelegramCourseSuggestionFromSavedRecord = ({
  user,
  groupReference = "",
  sourceMessageId = null,
  suggestion = {},
}) => {
  const savedRecords = getSavedTelegramCourseSuggestionsRecords(
    user,
    groupReference,
    sourceMessageId,
  );

  if (savedRecords.length === 0) {
    return null;
  }

  const suggestionKey = String(suggestion?.suggestionKey || "").trim();
  const duplicateKey =
    String(suggestion?.duplicateKey || "").trim() ||
    buildCourseDuplicateKey(suggestion?.coursePayload);
  const originGroupReference = String(
    suggestion?.originGroupReference || "",
  ).trim();
  const originSourceMessageId =
    Number(suggestion?.originSourceMessageId || 0) || null;

  savedRecords.forEach((savedRecord) => {
    if (!Array.isArray(savedRecord?.suggestions)) {
      return;
    }

    if (
      originGroupReference &&
      String(savedRecord?.groupReference || "").trim() !== originGroupReference
    ) {
      return;
    }

    if (
      originGroupReference &&
      Number(savedRecord?.sourceMessageId || 0) !== Number(originSourceMessageId || 0)
    ) {
      return;
    }

    savedRecord.suggestions = savedRecord.suggestions.filter((entry) => {
      const entrySuggestionKey = String(entry?.suggestionKey || "").trim();
      const entryDuplicateKey =
        String(entry?.duplicateKey || "").trim() ||
        buildCourseDuplicateKey(entry?.coursePayload);

      if (suggestionKey && entrySuggestionKey === suggestionKey) {
        return false;
      }

      if (duplicateKey && entryDuplicateKey === duplicateKey) {
        return false;
      }

      return true;
    });
  });

  return savedRecords[0] || null;
};

const saveTelegramCourseSuggestionFeedback = ({
  user,
  groupReference = "",
  groupTitle = "",
  sourceMessageId = null,
  sourceAttachmentFileName = "",
  decision = "",
  suggestion = {},
}) => {
  if (!user?.schoolPlanner) {
    user.schoolPlanner = {};
  }

  if (!Array.isArray(user.schoolPlanner.telegramCourseSuggestionFeedback)) {
    user.schoolPlanner.telegramCourseSuggestionFeedback = [];
  }

  user.schoolPlanner.telegramCourseSuggestionFeedback.unshift({
    groupReference: String(groupReference || "").trim(),
    groupTitle: String(groupTitle || "").trim(),
    sourceMessageId:
      sourceMessageId !== null && Number.isFinite(Number(sourceMessageId))
        ? Number(sourceMessageId)
        : null,
    sourceAttachmentFileName: String(sourceAttachmentFileName || "").trim(),
    decision: String(decision || "").trim(),
    savedAt: new Date(),
    suggestionKey: String(suggestion?.suggestionKey || "").trim(),
    duplicateKey: String(suggestion?.duplicateKey || "").trim(),
    confidence: Math.max(0, Math.min(100, Number(suggestion?.confidence || 0))),
    reasons: Array.isArray(suggestion?.reasons) ? suggestion.reasons : [],
    matchedKeys: Array.isArray(suggestion?.matchedKeys) ? suggestion.matchedKeys : [],
    sourceMessageIds: Array.isArray(suggestion?.sourceMessageIds)
      ? suggestion.sourceMessageIds
      : [],
    courseArabic: suggestion?.courseArabic || buildPendingCoursePayload(""),
    courseEnglish: suggestion?.courseEnglish || buildPendingCoursePayload(""),
    coursePayload: buildNormalizedCoursePayload(suggestion?.coursePayload),
  });

  user.schoolPlanner.telegramCourseSuggestionFeedback =
    user.schoolPlanner.telegramCourseSuggestionFeedback.slice(0, 120);
};

const buildTelegramCourseSuggestionFeedbackContext = (
  feedbackEntries = [],
  groupReference = "",
  sourceMessageId = null,
) =>
  (Array.isArray(feedbackEntries) ? feedbackEntries : [])
    .filter((entry) => {
      if (
        isTelegramCourseSuggestionAllGroupsScope(groupReference, sourceMessageId)
      ) {
        return Number(entry?.sourceMessageId || 0) === 0;
      }

      return (
        String(entry?.groupReference || "").trim() ===
          String(groupReference || "").trim() &&
        Number(entry?.sourceMessageId || 0) ===
          Number(sourceMessageId !== null ? sourceMessageId : 0)
      );
    })
    .sort(
      (firstEntry, secondEntry) =>
        new Date(secondEntry?.savedAt || 0).getTime() -
        new Date(firstEntry?.savedAt || 0).getTime(),
    )
    .slice(0, TELEGRAM_COURSE_SUGGESTION_FEEDBACK_LIMIT)
    .map((entry) => ({
      decision: String(entry?.decision || "").trim(),
      confidence: Math.max(0, Math.min(100, Number(entry?.confidence || 0))),
      matchedKeys: Array.isArray(entry?.matchedKeys) ? entry.matchedKeys : [],
      reasons: (Array.isArray(entry?.reasons) ? entry.reasons : [])
        .map((reason) => String(reason || "").trim())
        .filter(Boolean)
        .slice(0, 2),
      sourceMessageIds: Array.isArray(entry?.sourceMessageIds)
        ? entry.sourceMessageIds
        : [],
      coursePayload: {
        course_name: String(entry?.coursePayload?.course_name || "").trim(),
      },
    }));

const removeTelegramCourseSuggestionFeedbackByScope = ({
  user,
  groupReference = "",
  sourceMessageId = null,
}) => {
  if (!user?.schoolPlanner) {
    user.schoolPlanner = {};
  }

  user.schoolPlanner.telegramCourseSuggestionFeedback = (
    Array.isArray(user?.schoolPlanner?.telegramCourseSuggestionFeedback)
      ? user.schoolPlanner.telegramCourseSuggestionFeedback
      : []
  ).filter((entry) => {
    if (
      isTelegramCourseSuggestionAllGroupsScope(groupReference, sourceMessageId)
    ) {
      return Number(entry?.sourceMessageId || 0) !== 0;
    }

    return !(
      String(entry?.groupReference || "").trim() ===
        String(groupReference || "").trim() &&
      Number(entry?.sourceMessageId || 0) ===
        Number(sourceMessageId !== null ? sourceMessageId : 0)
    );
  });
};

const parseQueryDateValue = (value, mode = "start") => {
  const rawValue = String(value || "").trim();

  if (!rawValue) {
    return null;
  }

  const hasExplicitTime = /t/i.test(rawValue) || /\d{1,2}:\d{2}/.test(rawValue);
  const normalizedValue =
    hasExplicitTime || mode === "start"
      ? rawValue
      : `${rawValue}T23:59:59.999`;
  const nextDate = new Date(normalizedValue);

  return Number.isNaN(nextDate.getTime()) ? null : nextDate.getTime();
};

const scoreMessageAgainstQuery = (messageText, queryText) => {
  const normalizedMessage = normalizeSearchText(messageText);
  const normalizedQuery = normalizeSearchText(queryText);

  if (!normalizedQuery) {
    return {
      matched: true,
      score: 0,
      matchedTerms: [],
    };
  }

  if (!normalizedMessage) {
    return {
      matched: false,
      score: 0,
      matchedTerms: [],
    };
  }

  const queryTokens = tokenizeSearchQuery(queryText);

  if (queryTokens.length === 0) {
    return {
      matched: normalizedMessage.includes(normalizedQuery),
      score: normalizedMessage.includes(normalizedQuery) ? 4 : 0,
      matchedTerms: normalizedMessage.includes(normalizedQuery)
        ? [normalizedQuery]
        : [],
    };
  }

  const matchedTerms = queryTokens.filter((token) =>
    normalizedMessage.includes(token),
  );
  let score = matchedTerms.length;

  if (normalizedMessage.includes(normalizedQuery)) {
    score += 5;
  }

  return {
    matched: matchedTerms.length > 0 || normalizedMessage.includes(normalizedQuery),
    score,
    matchedTerms,
  };
};

const buildStoredMessageWrite = ({
  ownerUserId,
  groupReference,
  groupInfo,
  message,
}) => {
  const normalizedReference = normalizeGroupReference(groupReference);
  const nextDateMs = Number(message?.date) || null;

  return {
    updateOne: {
      filter: {
        ownerUserId,
        groupReference: normalizedReference,
        telegramMessageId: Number(message?.id || 0),
      },
      update: {
        $set: {
          ownerUserId,
          groupReference: normalizedReference,
          groupId: String(groupInfo?.id || ""),
          groupTitle: String(groupInfo?.title || ""),
          groupUsername: String(groupInfo?.username || ""),
          telegramMessageId: Number(message?.id || 0),
          text: String(message?.text || ""),
          textNormalized: normalizeSearchText(message?.text || ""),
          dateMs: nextDateMs,
          date: nextDateMs ? new Date(nextDateMs) : null,
          sender: String(message?.sender || "Unknown"),
          views: typeof message?.views === "number" ? message.views : null,
          replyToMessageId:
            typeof message?.replyToMessageId === "number"
              ? message.replyToMessageId
              : null,
          attachmentKind: String(message?.attachmentKind || "").trim(),
          attachmentMimeType: String(message?.attachmentMimeType || "").trim(),
          attachmentFileName: String(message?.attachmentFileName || "").trim(),
          attachmentFileExtension: String(
            message?.attachmentFileExtension || "",
          ).trim(),
          attachmentSizeBytes:
            typeof message?.attachmentSizeBytes === "number"
              ? message.attachmentSizeBytes
              : null,
          attachmentIsPdf: Boolean(message?.attachmentIsPdf),
          attachmentStoredPath: String(message?.attachmentStoredPath || "").trim(),
          attachmentStoredAt: message?.attachmentStoredAt || null,
          attachmentTextExtracted: String(
            message?.attachmentTextExtracted || "",
          ),
          attachmentTextNormalized: normalizeSearchText(
            message?.attachmentTextExtracted || "",
          ),
          storedAt: new Date(),
        },
      },
      upsert: true,
    },
  };
};

const parseHistoryStartDate = (value) => {
  const rawValue = String(value || "").trim();

  if (!rawValue) {
    return null;
  }

  const nextDate = new Date(rawValue);
  return Number.isNaN(nextDate.getTime()) ? null : nextDate;
};

const getTelegramSyncEligibility = (user) => {
  const config = getUserTelegramConfig(user);
  const integration = user?.telegramIntegration || {};
  const historyStartDate = integration.historyStartDate
    ? new Date(integration.historyStartDate)
    : null;

  return {
    config,
    historyStartDate,
    canSync: Boolean(
      config.groupReference &&
        config.apiId &&
        config.apiHash &&
        config.stringSession &&
        integration.syncEnabled &&
        historyStartDate &&
        !Number.isNaN(historyStartDate.getTime()),
    ),
  };
};

const queryStoredTelegramMessages = async ({
  ownerUserId,
  groupReference,
  groupReferences = [],
  messageId = null,
  limit,
  searchQuery,
  startDateMs,
  endDateMs,
  pdfOnly = false,
}) => {
  const normalizedGroupReferences = [
    ...new Set(
      (Array.isArray(groupReferences) ? groupReferences : [])
        .map((value) => normalizeGroupReference(value))
        .filter(Boolean),
    ),
  ];
  const normalizedGroupReference = normalizeGroupReference(groupReference);
  const query = {};

  if (normalizedGroupReferences.length > 0) {
    query.groupReference = { $in: normalizedGroupReferences };
  } else {
    query.groupReference = normalizedGroupReference;
  }

  if (ownerUserId) {
    query.ownerUserId = ownerUserId;
  }

  if (messageId !== null && Number.isFinite(Number(messageId))) {
    query.id = Number(messageId);
  }

  if (startDateMs !== null || endDateMs !== null) {
    query.dateMs = {};

    if (startDateMs !== null) {
      query.dateMs.$gte = startDateMs;
    }

    if (endDateMs !== null) {
      query.dateMs.$lte = endDateMs;
    }
  }

  if (pdfOnly) {
    query.attachmentIsPdf = true;
  }

  const baseLimit = searchQuery ? Math.max(limit * 8, 200) : limit;
  const storedMessages = await TelegramMessageModel.find(query)
    .sort({ dateMs: -1 })
    .limit(Math.min(2000, baseLimit))
    .lean();

  const filteredMessages = storedMessages
    .map((message) => {
      const searchResult = scoreMessageAgainstQuery(
        [
          message?.text,
          message?.attachmentFileName,
          message?.attachmentTextExtracted,
        ]
          .filter(Boolean)
          .join(" "),
        searchQuery,
      );

      if (searchQuery && !searchResult.matched) {
        return null;
      }

      return {
        id: message.telegramMessageId,
        groupReference: String(message.groupReference || "").trim(),
        text: message.text || "",
        date: message.dateMs || null,
        sender: message.sender || "Unknown",
        views: typeof message.views === "number" ? message.views : null,
        replyToMessageId:
          typeof message.replyToMessageId === "number"
            ? message.replyToMessageId
            : null,
        attachmentKind: String(message.attachmentKind || "").trim(),
        attachmentMimeType: String(message.attachmentMimeType || "").trim(),
        attachmentFileName: String(message.attachmentFileName || "").trim(),
        attachmentFileExtension: String(
          message.attachmentFileExtension || "",
        ).trim(),
        attachmentSizeBytes:
          typeof message.attachmentSizeBytes === "number"
            ? message.attachmentSizeBytes
            : null,
        attachmentIsPdf: Boolean(message.attachmentIsPdf),
        attachmentStoredPath: String(message.attachmentStoredPath || "").trim(),
        attachmentTextExtracted: String(
          message.attachmentTextExtracted || "",
        ),
        score: searchResult.score,
        matchedTerms: searchResult.matchedTerms,
      };
    })
    .filter(Boolean)
    .sort((firstMessage, secondMessage) => {
      if (searchQuery && secondMessage.score !== firstMessage.score) {
        return secondMessage.score - firstMessage.score;
      }

      return (Number(secondMessage.date) || 0) - (Number(firstMessage.date) || 0);
    })
    .slice(0, limit);

  return {
    filteredMessages,
    rawCount: storedMessages.length,
    storedCount: await TelegramMessageModel.countDocuments(query),
  };
};

const findOwnedStoredPdfMessage = async ({
  userId,
  groupReference,
  messageId,
}) => {
  if (!userId || !groupReference || !messageId) {
    return null;
  }

  return TelegramMessageModel.findOne({
    ownerUserId: userId,
    groupReference: normalizeGroupReference(groupReference),
    telegramMessageId: Number(messageId),
    attachmentIsPdf: true,
  }).lean();
};

const listJoinedTelegramGroupsForUser = async (user) => {
  if (!user) {
    return [];
  }

  const storedSummaries = await TelegramMessageModel.aggregate([
    {
      $match: {
        ownerUserId: user._id,
      },
    },
    {
      $group: {
        _id: "$groupReference",
        storedCount: { $sum: 1 },
        latestDateMs: { $max: "$dateMs" },
        latestStoredAt: { $max: "$storedAt" },
        title: { $last: "$groupTitle" },
        username: { $last: "$groupUsername" },
      },
    },
  ]);
  const storedSummariesByReference = new Map(
    storedSummaries
      .map((entry) => {
        const groupReference = normalizeGroupReference(entry?._id);

        if (!groupReference) {
          return null;
        }

        return [
          groupReference,
          {
            groupReference,
            storedCount: Number(entry?.storedCount || 0),
            latestDateMs:
              Number(entry?.latestDateMs || 0) ||
              (entry?.latestStoredAt instanceof Date
                ? entry.latestStoredAt.getTime()
                : 0),
            title: String(entry?.title || "").trim(),
            username: String(entry?.username || "").trim(),
          },
        ];
      })
      .filter(Boolean),
  );

  const userConfig = getUserTelegramConfig(user);
  let client = null;

  try {
    client = await ensureTelegramClient(userConfig);
    const dialogs = [];

    dialogs.push(
      ...(await collectTelegramDialogs(client, false, {
        returnPartialOnTimeout: true,
      })),
    );

    try {
      dialogs.push(
        ...(await collectTelegramDialogs(client, true, {
          returnPartialOnTimeout: true,
        })),
      );
    } catch (error) {
      if (!isTelegramTimeoutError(error)) {
        throw error;
      }
    }

    const dialogEntriesByReference = new Map();

    dialogs.forEach((dialog) => {
      const entity = dialog?.entity;
      const entityClassName = String(entity?.className || "").trim();
      const isChannelEntity =
        entity instanceof Api.Channel ||
        entity instanceof Api.ChannelForbidden ||
        entityClassName === "Channel" ||
        entityClassName === "ChannelForbidden";
      const isChatEntity =
        entity instanceof Api.Chat ||
        entity instanceof Api.ChatForbidden ||
        entityClassName === "Chat" ||
        entityClassName === "ChatForbidden";

      if (!isChannelEntity && !isChatEntity) {
        return;
      }

      const username = String(
        entity?.username || dialog?.entity?.username || "",
      ).trim();
      const title = String(
        entity?.title || dialog?.title || username || "Telegram Group",
      ).trim();
      const groupReference = normalizeGroupReference(
        username || String(entity?.id || dialog?.id || "").trim(),
      );

      if (!groupReference) {
        return;
      }

      const entryType = isChannelEntity
        ? Boolean(entity?.megagroup)
          ? "supergroup"
          : "channel"
        : "group";
      const latestDateMs =
        dialog?.date instanceof Date && !Number.isNaN(dialog.date.getTime())
          ? dialog.date.getTime()
          : null;
      const previousEntry = dialogEntriesByReference.get(groupReference);

      if (
        !previousEntry ||
        Number(latestDateMs || 0) > Number(previousEntry.latestDateMs || 0)
      ) {
        const storedSummary =
          storedSummariesByReference.get(groupReference) || null;

        dialogEntriesByReference.set(groupReference, {
          groupReference,
          title: title || storedSummary?.title || groupReference,
          username: username || storedSummary?.username || "",
          type: entryType,
          storedCount: Number(storedSummary?.storedCount || 0),
          latestDateMs: Number(
            latestDateMs || storedSummary?.latestDateMs || 0,
          ),
        });
      }
    });

    storedSummariesByReference.forEach((storedSummary, groupReference) => {
      if (dialogEntriesByReference.has(groupReference)) {
        return;
      }

      dialogEntriesByReference.set(groupReference, {
        groupReference,
        title:
          storedSummary.title ||
          storedSummary.username ||
          groupReference,
        username: storedSummary.username || "",
        type: "group",
        storedCount: Number(storedSummary.storedCount || 0),
        latestDateMs: Number(storedSummary.latestDateMs || 0),
      });
    });

    return Array.from(dialogEntriesByReference.values()).sort(
      (firstGroup, secondGroup) =>
        Number(secondGroup.latestDateMs || 0) -
          Number(firstGroup.latestDateMs || 0) ||
        String(firstGroup.title || "").localeCompare(
          String(secondGroup.title || ""),
        ),
    );
  } finally {
    if (client) {
      try {
        await client.disconnect();
      } catch {
        // ignore disconnect errors
      }
    }
  }
};

const listStoredTelegramGroupsForUser = async (user) => {
  const storedSummaries = await TelegramMessageModel.aggregate([
    {
      $match: {
        ownerUserId: user._id,
      },
    },
    {
      $sort: {
        dateMs: -1,
        storedAt: -1,
        _id: -1,
      },
    },
    {
      $group: {
        _id: "$groupReference",
        storedCount: { $sum: 1 },
        latestDateMs: { $max: "$dateMs" },
        latestStoredAt: { $max: "$storedAt" },
        titles: { $push: "$groupTitle" },
        usernames: { $push: "$groupUsername" },
      },
    },
  ]);

  return storedSummaries
    .map((entry) => {
      const groupReference = normalizeGroupReference(entry?._id);

      if (!groupReference) {
        return null;
      }

      const title = pickLatestUsableTelegramGroupField(
        entry?.titles,
        groupReference,
      );
      const username = pickLatestUsableTelegramGroupField(
        entry?.usernames,
        groupReference,
      );
      const isUnnamedNumericReference =
        !title && !username && isNumericTelegramReference(groupReference);

      if (isUnnamedNumericReference) {
        return null;
      }

      return {
        groupReference,
        title,
        username,
        type: "group",
        storedCount: Number(entry?.storedCount || 0),
        latestDateMs:
          Number(entry?.latestDateMs || 0) ||
          (entry?.latestStoredAt instanceof Date
            ? entry.latestStoredAt.getTime()
            : 0),
      };
    })
    .filter(Boolean)
    .sort(
      (firstGroup, secondGroup) =>
        Number(secondGroup.latestDateMs || 0) -
          Number(firstGroup.latestDateMs || 0) ||
        String(
          firstGroup.title ||
            firstGroup.username ||
            firstGroup.groupReference ||
            "",
        ).localeCompare(
          String(
            secondGroup.title ||
              secondGroup.username ||
              secondGroup.groupReference ||
              "",
          ),
        ),
    );
};

const syncTelegramMessagesForUser = async (userId, options = {}) => {
  const userKey = String(userId);

  if (telegramSyncPromisesByUser.has(userKey)) {
    return telegramSyncPromisesByUser.get(userKey);
  }

  const syncPromise = (async () => {
    let client = null;

    try {
      const user = await UserModel.findById(userId).select("telegramIntegration");

      if (!user) {
        return { synced: false, reason: "user-not-found" };
      }

      const { config, historyStartDate, canSync } = getTelegramSyncEligibility(
        user,
      );

      if (!canSync) {
        applyTelegramSyncResult(user, {
          status: "idle",
          reason: "sync-not-configured",
          message: "Telegram history sync is not configured yet.",
        });
        await user.save();
        return { synced: false, reason: "sync-not-configured" };
      }

      const lastSyncedAtMs = user.telegramIntegration?.lastSyncedAt
        ? new Date(user.telegramIntegration.lastSyncedAt).getTime()
        : 0;

      if (
        !options.force &&
        lastSyncedAtMs &&
        Date.now() - lastSyncedAtMs < TELEGRAM_SYNC_REQUEST_THROTTLE_MS
      ) {
        applyTelegramSyncResult(user, {
          status: "idle",
          reason: "recently-synced",
          message: "Telegram history sync was skipped because a sync ran very recently.",
        });
        await user.save();
        return { synced: false, reason: "recently-synced" };
      }

      applyTelegramSyncResult(user, {
        status: "running",
        reason: "sync-running",
        message: "Telegram history sync is running.",
      });
      await user.save();

      client = await ensureTelegramClient(config);
      const entity = await resolveTelegramGroupEntity(
        client,
        config.groupReference,
      );
      const groupInfo = {
        id: entity?.id ? String(entity.id) : "",
        title: entity?.title || entity?.username || config.groupReference,
        username: entity?.username || "",
      };
      const historyStartMs = historyStartDate.getTime();
      const lastStoredMessageId = Number(
        user.telegramIntegration?.lastStoredMessageId || 0,
      );
      const writes = [];
      let newestStoredMessageId = lastStoredMessageId;
      let newestStoredMessageDateMs = user.telegramIntegration?.lastStoredMessageDate
        ? new Date(user.telegramIntegration.lastStoredMessageDate).getTime()
        : 0;
      let importedCount = 0;
      let scannedMessageCount = 0;
      let reachedOlderThanStartDate = false;
      let newestMessageDateSeenMs = 0;
      let oldestMessageDateSeenMs = 0;
      let oldestImportedMessageDateMs = 0;
      let firstSkippedBeforeStartDateMs = 0;

      if (lastStoredMessageId > 0) {
        for await (const message of client.iterMessages(entity, {
          minId: lastStoredMessageId,
          reverse: true,
        })) {
          scannedMessageCount += 1;
          const payload = await enrichTelegramPdfPayload({
            client,
            message,
            groupReference: config.groupReference,
            payload: buildMessagePayload(message),
          });
          const messageDateMs = Number(payload.date) || 0;

          if (messageDateMs) {
            newestMessageDateSeenMs = Math.max(newestMessageDateSeenMs, messageDateMs);
            oldestMessageDateSeenMs = oldestMessageDateSeenMs
              ? Math.min(oldestMessageDateSeenMs, messageDateMs)
              : messageDateMs;
          }

          if (!payload.id) {
            continue;
          }

          writes.push(
            buildStoredMessageWrite({
              ownerUserId: user._id,
              groupReference: config.groupReference,
              groupInfo,
              message: payload,
            }),
          );
          if (messageDateMs) {
            oldestImportedMessageDateMs = oldestImportedMessageDateMs
              ? Math.min(oldestImportedMessageDateMs, messageDateMs)
              : messageDateMs;
          }
          newestStoredMessageId = Math.max(newestStoredMessageId, Number(payload.id));
          newestStoredMessageDateMs = Math.max(
            newestStoredMessageDateMs,
            Number(payload.date) || 0,
          );
          importedCount += 1;
        }
      } else {
        for await (const message of client.iterMessages(entity, {
          limit: undefined,
        })) {
          scannedMessageCount += 1;
          const payload = await enrichTelegramPdfPayload({
            client,
            message,
            groupReference: config.groupReference,
            payload: buildMessagePayload(message),
          });
          const messageDateMs = Number(payload.date) || 0;

          if (messageDateMs) {
            newestMessageDateSeenMs = Math.max(newestMessageDateSeenMs, messageDateMs);
            oldestMessageDateSeenMs = oldestMessageDateSeenMs
              ? Math.min(oldestMessageDateSeenMs, messageDateMs)
              : messageDateMs;
          }

          if (messageDateMs && messageDateMs < historyStartMs) {
            reachedOlderThanStartDate = true;
            firstSkippedBeforeStartDateMs = messageDateMs;
            break;
          }

          if (!payload.id) {
            continue;
          }

          writes.push(
            buildStoredMessageWrite({
              ownerUserId: user._id,
              groupReference: config.groupReference,
              groupInfo,
              message: payload,
            }),
          );
          if (messageDateMs) {
            oldestImportedMessageDateMs = oldestImportedMessageDateMs
              ? Math.min(oldestImportedMessageDateMs, messageDateMs)
              : messageDateMs;
          }
          newestStoredMessageId = Math.max(newestStoredMessageId, Number(payload.id));
          newestStoredMessageDateMs = Math.max(
            newestStoredMessageDateMs,
            messageDateMs,
          );
          importedCount += 1;
        }
      }

      if (writes.length > 0) {
        await TelegramMessageModel.bulkWrite(writes, {
          ordered: false,
        });
      }

      let syncReason = "messages-imported";
      let syncMessage = `Telegram history sync imported ${importedCount} message(s).`;

      if (importedCount === 0) {
        if (lastStoredMessageId > 0) {
          syncReason = "no-new-messages";
          syncMessage =
            "Telegram history sync found no new messages after the last stored message.";
        } else if (reachedOlderThanStartDate) {
          syncReason = "no-messages-after-start-date";
          syncMessage =
            "Group found, but no messages were available after the chosen history start date.";
        } else if (scannedMessageCount === 0) {
          syncReason = "group-history-unavailable";
          syncMessage =
            "Group was found, but its message history was unavailable or empty for this Telegram session.";
        } else {
          syncReason = "no-importable-messages";
          syncMessage =
            "Group was found, but no importable messages were returned for the current sync window.";
        }
      }

      user.telegramIntegration.lastSyncedAt = new Date();
      user.telegramIntegration.historyImportedAt =
        user.telegramIntegration.historyImportedAt || new Date();
      user.telegramIntegration.lastStoredMessageId = newestStoredMessageId;
      user.telegramIntegration.lastStoredMessageDate = newestStoredMessageDateMs
        ? new Date(newestStoredMessageDateMs)
        : user.telegramIntegration.lastStoredMessageDate || null;
      applyTelegramSyncResult(user, {
        status: "completed",
        reason: syncReason,
        message: syncMessage,
        importedCount,
        scannedCount: scannedMessageCount,
        newestMessageDateSeen: newestMessageDateSeenMs
          ? new Date(newestMessageDateSeenMs)
          : null,
        oldestMessageDateSeen: oldestMessageDateSeenMs
          ? new Date(oldestMessageDateSeenMs)
          : null,
        oldestImportedMessageDate: oldestImportedMessageDateMs
          ? new Date(oldestImportedMessageDateMs)
          : null,
        firstSkippedBeforeStartDate: firstSkippedBeforeStartDateMs
          ? new Date(firstSkippedBeforeStartDateMs)
          : null,
        reachedStartBoundary: reachedOlderThanStartDate,
      });
      await user.save();

      return {
        synced: true,
        reason: syncReason,
        message: syncMessage,
        importedCount,
        scannedCount: scannedMessageCount,
      };
    } catch (error) {
      try {
        const user = await UserModel.findById(userId).select("telegramIntegration");

        if (user) {
          user.telegramIntegration.lastSyncedAt = new Date();
          applyTelegramSyncResult(user, {
            status: "error",
            reason: "sync-error",
            message: "Telegram history sync failed.",
            error: error?.message || "Unknown Telegram sync error.",
          });
          await user.save();
        }
      } catch {
        // ignore secondary persistence errors
      }
      return Promise.reject(error);
    } finally {
      if (client) {
        try {
          await client.disconnect();
        } catch {
          // ignore disconnect errors
        }
      }

      telegramSyncPromisesByUser.delete(userKey);
    }
  })();

  telegramSyncPromisesByUser.set(userKey, syncPromise);
  return syncPromise;
};

const syncAllTelegramUsers = async () => {
  const users = await UserModel.find({
    "telegramIntegration.syncEnabled": true,
    "telegramIntegration.groupReference": { $ne: "" },
    "telegramIntegration.historyStartDate": { $ne: null },
    "telegramIntegration.apiIdEncrypted": { $ne: "" },
    "telegramIntegration.apiHashEncrypted": { $ne: "" },
    "telegramIntegration.stringSessionEncrypted": { $ne: "" },
  }).select("_id");

  for (const user of users) {
    try {
      await syncTelegramMessagesForUser(user._id);
    } catch {
      // keep worker resilient
    }
  }
};

export const startTelegramSyncWorker = () => {
  if (telegramSyncWorkerStarted) {
    return;
  }

  telegramSyncWorkerStarted = true;
  telegramSyncWorkerIntervalId = setInterval(() => {
    syncAllTelegramUsers().catch(() => {});
  }, TELEGRAM_SYNC_INTERVAL_MS);

  setTimeout(() => {
    syncAllTelegramUsers().catch(() => {});
  }, 4000);

  if (typeof telegramSyncWorkerIntervalId?.unref === "function") {
    telegramSyncWorkerIntervalId.unref();
  }
};

const persistTelegramCredentials = async ({
  userId,
  apiId,
  apiHash,
  stringSession,
}) => {
  const user = await UserModel.findById(userId);

  if (!user) {
    const error = new Error("User not found.");
    error.status = 404;
    throw error;
  }

  if (!user.telegramIntegration) {
    user.telegramIntegration = {};
  }

  user.telegramIntegration.apiIdEncrypted = encryptValue(apiId);
  user.telegramIntegration.apiHashEncrypted = encryptValue(apiHash);
  user.telegramIntegration.stringSessionEncrypted = encryptValue(stringSession);
  user.telegramIntegration.updatedAt = new Date();

  await user.save();
  return user;
};

const connectTelegramClient = async (
  stringSession,
  apiId,
  apiHash,
  clientOptions = {},
) => {
  const client = new TelegramClient(
    new StringSession(stringSession),
    apiId,
    apiHash,
    {
      connectionRetries: 5,
      ...clientOptions,
    },
  );

  client.setLogLevel(LogLevel.NONE);
  client.onError = async () => {};

  try {
    await runWithTimeout(
      client.connect(),
      TELEGRAM_CLIENT_CONNECT_TIMEOUT_MS,
      "Timed out while connecting to Telegram.",
      async () => {
        try {
          await client.disconnect();
        } catch {
          // ignore disconnect errors
        }
      },
    );

    return client;
  } catch (error) {
    try {
      await client.disconnect();
    } catch {
      // ignore disconnect errors
    }

    throw error;
  }
};

const ensureTelegramClient = async (userConfig) => {
  const apiId = Number(userConfig.apiId || 0);
  const apiHash = String(userConfig.apiHash || "").trim();
  const stringSession = String(userConfig.stringSession || "").trim();

  if (!apiId || !apiHash || !stringSession) {
    const error = new Error(
      "Telegram MTProto is not configured for this user.",
    );
    error.status = 503;
    throw error;
  }

  try {
    return await connectTelegramClient(stringSession, apiId, apiHash);
  } catch (error) {
    if (!isTelegramTimeoutError(error)) {
      throw error;
    }

    return connectTelegramClient(stringSession, apiId, apiHash, {
      useWSS: true,
    });
  }
};

TelegramRouter.get("/config", checkAuth, async (req, res, next) => {
  try {
    const user = await UserModel.findById(req.authentication.userId).select(
      "telegramIntegration",
    );

    if (!user) {
      return res.status(404).json({
        message: "User not found.",
      });
    }

    const storedCount = await getStoredMessageCountForUser(user);

    return res.status(200).json({
      ...buildConfigStatusPayload(user),
      storedCount,
    });
  } catch (error) {
    next(error);
  }
});

TelegramRouter.get("/groups", checkAuth, async (req, res, next) => {
  try {
    const user = await UserModel.findById(req.authentication.userId).select(
      "telegramIntegration",
    );

    if (!user) {
      return res.status(404).json({
        message: "User not found.",
      });
    }

    const groups = await listJoinedTelegramGroupsForUser(user);

    return res.status(200).json({
      groups,
    });
  } catch (error) {
    next(error);
  }
});

TelegramRouter.get("/stored-groups", checkAuth, async (req, res, next) => {
  try {
    const user = await UserModel.findById(req.authentication.userId).select(
      "telegramIntegration",
    );

    if (!user) {
      return res.status(404).json({
        message: "User not found.",
      });
    }

    const groups = await listStoredTelegramGroupsForUser(user);

    return res.status(200).json({
      groups,
    });
  } catch (error) {
    next(error);
  }
});

TelegramRouter.delete("/stored-groups/:groupReference", checkAuth, async (req, res, next) => {
  try {
    const user = await UserModel.findById(req.authentication.userId).select(
      "telegramIntegration",
    );

    if (!user) {
      return res.status(404).json({
        message: "User not found.",
      });
    }

    const normalizedReference = normalizeGroupReference(
      req.params.groupReference,
    );

    if (!normalizedReference) {
      return res.status(400).json({
        message: "Stored conversation reference is required.",
      });
    }

    const deleteResult = await TelegramMessageModel.deleteMany({
      ownerUserId: user._id,
      groupReference: normalizedReference,
    });

    return res.status(200).json({
      message: "Stored conversation deleted.",
      groupReference: normalizedReference,
      deletedCount: Number(deleteResult?.deletedCount || 0),
      groups: await listStoredTelegramGroupsForUser(user),
    });
  } catch (error) {
    next(error);
  }
});

TelegramRouter.get(
  "/stored-group-pdfs/:groupReference/:messageId/open",
  checkAuth,
  async (req, res, next) => {
    try {
      const groupReference = normalizeGroupReference(req.params.groupReference);
      const messageId = Number(req.params.messageId || 0);

      if (!groupReference || !messageId) {
        return res.status(400).json({
          message: "Stored PDF reference is invalid.",
        });
      }

      const messageRecord = await findOwnedStoredPdfMessage({
        userId: req.authentication.userId,
        groupReference,
        messageId,
      });

      if (!messageRecord?.attachmentStoredPath) {
        return res.status(404).json({
          message: "Stored PDF file was not found.",
        });
      }

      const resolvedPath = path.resolve(messageRecord.attachmentStoredPath);

      if (!resolvedPath.startsWith(TELEGRAM_PDF_STORAGE_ROOT)) {
        return res.status(400).json({
          message: "Stored PDF path is invalid.",
        });
      }

      await fs.access(resolvedPath);
      res.setHeader("Content-Type", "application/pdf");
      res.setHeader(
        "Content-Disposition",
        buildContentDispositionHeader(
          "inline",
          messageRecord.attachmentFileName,
          "telegram.pdf",
        ),
      );
      res.setHeader("Cache-Control", "private, max-age=300");

      return res.sendFile(resolvedPath);
    } catch (error) {
      next(error);
    }
  },
);

TelegramRouter.get(
  "/stored-group-pdfs/:groupReference/:messageId/metadata",
  checkAuth,
  async (req, res, next) => {
    try {
      const groupReference = normalizeGroupReference(req.params.groupReference);
      const messageId = Number(req.params.messageId || 0);

      if (!groupReference || !messageId) {
        return res.status(400).json({
          message: "Stored PDF reference is invalid.",
        });
      }

      const messageRecord = await findOwnedStoredPdfMessage({
        userId: req.authentication.userId,
        groupReference,
        messageId,
      });

      if (!messageRecord) {
        return res.status(404).json({
          message: "Stored PDF file was not found.",
        });
      }

      return res.status(200).json({
        id: messageRecord.telegramMessageId,
        groupReference,
        fileName: sanitizeFileName(messageRecord.attachmentFileName, "telegram.pdf"),
        mimeType: String(messageRecord.attachmentMimeType || "application/pdf"),
        sizeBytes:
          typeof messageRecord.attachmentSizeBytes === "number"
            ? messageRecord.attachmentSizeBytes
            : null,
        sender: String(messageRecord.sender || "Unknown"),
        dateMs:
          typeof messageRecord.dateMs === "number" ? messageRecord.dateMs : null,
        hasExtractedText: Boolean(
          String(messageRecord.attachmentTextExtracted || "").trim(),
        ),
      });
    } catch (error) {
      next(error);
    }
  },
);

TelegramRouter.get(
  "/stored-group-pdfs/:groupReference/:messageId/download",
  checkAuth,
  async (req, res, next) => {
    try {
      const groupReference = normalizeGroupReference(req.params.groupReference);
      const messageId = Number(req.params.messageId || 0);

      if (!groupReference || !messageId) {
        return res.status(400).json({
          message: "Stored PDF reference is invalid.",
        });
      }

      const messageRecord = await findOwnedStoredPdfMessage({
        userId: req.authentication.userId,
        groupReference,
        messageId,
      });

      if (!messageRecord?.attachmentStoredPath) {
        return res.status(404).json({
          message: "Stored PDF file was not found.",
        });
      }

      const resolvedPath = path.resolve(messageRecord.attachmentStoredPath);

      if (!resolvedPath.startsWith(TELEGRAM_PDF_STORAGE_ROOT)) {
        return res.status(400).json({
          message: "Stored PDF path is invalid.",
        });
      }

      await fs.access(resolvedPath);
      res.setHeader("Content-Type", "application/pdf");
      res.setHeader(
        "Content-Disposition",
        buildContentDispositionHeader(
          "attachment",
          messageRecord.attachmentFileName,
          "telegram.pdf",
        ),
      );
      res.setHeader("Cache-Control", "private, max-age=300");

      return res.sendFile(resolvedPath);
    } catch (error) {
      next(error);
    }
  },
);

TelegramRouter.get("/stored-group-messages", checkAuth, async (req, res, next) => {
  try {
    const user = await UserModel.findById(req.authentication.userId).select(
      "telegramIntegration info.username",
    );

    if (!user) {
      return res.status(404).json({
        message: "User not found.",
      });
    }

    const userConfig = getUserTelegramConfig(user);
    const groupReference = normalizeGroupReference(
      req.query.group || userConfig.groupReference,
    );
    const rawLimitValue = String(req.query.limit || "").trim().toLowerCase();
    const requestedLimit =
      rawLimitValue === "all"
        ? Number.MAX_SAFE_INTEGER
        : Number(req.query.limit || TELEGRAM_DEFAULT_LIMIT);
    const limit =
      rawLimitValue === "all"
        ? Number.MAX_SAFE_INTEGER
        : Math.min(
            TELEGRAM_MAX_LIMIT,
            Math.max(
              1,
              Number.isFinite(requestedLimit)
                ? requestedLimit
                : TELEGRAM_DEFAULT_LIMIT,
            ),
          );
    const searchQuery = String(req.query.q || "").trim();
    const viewMode = String(req.query.view || "messages").trim().toLowerCase();
    const pdfOnly = viewMode === "pdfs";
    const startDateMs = parseQueryDateValue(req.query.start, "start");
    const endDateMs = parseQueryDateValue(req.query.end, "end");

    if (req.query.start && startDateMs === null) {
      return res.status(400).json({
        message: "Stored conversation start date is invalid.",
      });
    }

    if (req.query.end && endDateMs === null) {
      return res.status(400).json({
        message: "Stored conversation end date is invalid.",
      });
    }

    if (
      startDateMs !== null &&
      endDateMs !== null &&
      startDateMs > endDateMs
    ) {
      return res.status(400).json({
        message: "Stored conversation start date must be before end date.",
      });
    }

    if (!groupReference) {
      return res.status(400).json({
        message: "Please choose a stored conversation first.",
      });
    }

    const {
      filteredMessages,
      rawCount,
      storedCount,
    } = await queryStoredTelegramMessages({
      ownerUserId: user._id,
      groupReference,
      limit,
      searchQuery,
      startDateMs,
      endDateMs,
      pdfOnly,
    });

    const groupSnapshot = await TelegramMessageModel.findOne({
      ownerUserId: user._id,
      groupReference,
    })
      .sort({ dateMs: -1 })
      .lean();

    return res.status(200).json({
      group: {
        id: groupSnapshot?.groupId || null,
        title: groupSnapshot?.groupTitle || groupReference,
        username: groupSnapshot?.groupUsername || null,
        pageUrl: userConfig.pageUrl,
      },
      count: filteredMessages.length,
      rawCount,
      storedCount,
      searched: {
        q: searchQuery,
        start: startDateMs,
        end: endDateMs,
        limit,
        view: viewMode,
      },
      messages: filteredMessages,
      sync: buildConfigStatusPayload(user),
    });
  } catch (error) {
    if (!error.status) {
      error.status = 500;
    }

    if (error.message?.includes("Cannot cast")) {
      error.status = 400;
      error.message = "Stored conversation reference is invalid.";
    }

    next(error);
  }
});

TelegramRouter.post("/ai/course-suggestions", checkAuth, async (req, res, next) => {
  const userId = req.authentication.userId;
  try {
    const searchSelectedPdfs = Boolean(req.body?.searchSelectedPdfs);
    const allGroups = !searchSelectedPdfs;
    const selectedPdfMessageId = searchSelectedPdfs
      ? Number(req.body?.sourceMessageId || 0) || null
      : null;
    const selectedPdfFileName = searchSelectedPdfs
      ? String(req.body?.sourceAttachmentFileName || "").trim()
      : "";
    const appendSuggestions = Boolean(req.body?.appendSuggestions);
    setTelegramCourseSuggestionStatus(userId, {
      active: true,
      phase: "starting",
      message: appendSuggestions
        ? "Requesting additional AI course suggestion analysis."
        : "Starting AI course suggestion analysis.",
    });
    const openAiClient = getOpenAIClient();
    const requestGroupReference = normalizeGroupReference(req.body?.groupReference);
    const groupReference = allGroups
      ? TELEGRAM_COURSE_SUGGESTION_ALL_GROUPS_SCOPE
      : requestGroupReference;

    if (!requestGroupReference) {
      setTelegramCourseSuggestionStatus(userId, {
        active: false,
        phase: "error",
        message: "Stored conversation reference is required.",
      });
      return res.status(400).json({
        message: "Stored conversation reference is required.",
      });
    }

    setTelegramCourseSuggestionStatus(userId, {
      active: true,
      phase: "loading-user",
      message: "Loading current user and existing courses.",
    });

    const user = await UserModel.findById(userId).select(
      "schoolPlanner.courses schoolPlanner.telegramCourseSuggestions schoolPlanner.telegramCourseSuggestionFeedback info.username info.program info.university info.studyYear info.aiProvider telegramIntegration.groupReference",
    );

    if (!user) {
      setTelegramCourseSuggestionStatus(userId, {
        active: false,
        phase: "error",
        message: "User not found.",
      });
      return res.status(404).json({
        message: "User not found.",
      });
    }

    setTelegramCourseSuggestionStatus(userId, {
      active: true,
      phase: "loading-messages",
      message: selectedPdfMessageId
        ? selectedPdfFileName
          ? `Loading the selected PDF: ${selectedPdfFileName}.`
          : `Loading the selected PDF #${selectedPdfMessageId}.`
        : "Loading stored messages across all saved Telegram groups.",
    });

    const storedGroupReferences = searchSelectedPdfs
      ? [groupReference]
      : (
          await TelegramMessageModel.distinct("groupReference", {
            ownerUserId: user._id,
          })
        )
          .map((value) => normalizeGroupReference(value))
          .filter(Boolean);

    const { filteredMessages } = await queryStoredTelegramMessages({
      ownerUserId: user._id,
      groupReference,
      groupReferences: storedGroupReferences,
      messageId: selectedPdfMessageId,
      limit: searchSelectedPdfs ? 320 : 240,
      searchQuery: "",
      startDateMs: null,
      endDateMs: null,
      pdfOnly: searchSelectedPdfs && Boolean(selectedPdfMessageId),
    });
    const contextEntries = buildCourseSuggestionContextEntries(filteredMessages);
    const aiContextEntries = buildCourseSuggestionAiContextEntries(
      contextEntries,
    );

    setTelegramCourseSuggestionStatus(userId, {
      active: true,
      phase: "building-context",
      message:
        contextEntries.length > aiContextEntries.length
          ? `Prepared ${contextEntries.length} candidate message chunks and selected the top ${aiContextEntries.length} for AI analysis.`
          : `Prepared ${contextEntries.length} candidate message chunks for analysis.`,
    });

    if (contextEntries.length === 0) {
      upsertTelegramCourseSuggestionsRecord({
        user,
        groupReference,
        groupTitle: String(req.body?.groupTitle || "").trim(),
        sourceMessageId: selectedPdfMessageId,
        sourceAttachmentFileName: selectedPdfFileName,
        suggestions: [],
        analyzedMessagesCount: 0,
        searchedKeys: TELEGRAM_COURSE_NAME_PREDICTION_KEYS,
      });
      await user.save();
      setTelegramCourseSuggestionStatus(userId, {
        active: false,
        phase: "completed",
        message: "No stored message content was available for course suggestions.",
      });
      return res.status(200).json({
        suggestions: [],
        analyzedMessagesCount: 0,
        searchedKeys: TELEGRAM_COURSE_NAME_PREDICTION_KEYS,
        savedAt: new Date().toISOString(),
      });
    }

    const existingCourseIndex = buildExistingCourseIndex(
      user?.schoolPlanner?.courses,
    );
    const savedRecord = getSavedTelegramCourseSuggestionsRecord(
      user,
      groupReference,
      selectedPdfMessageId,
    );
    const priorSuggestions = Array.isArray(savedRecord?.suggestions)
      ? savedRecord.suggestions.filter((suggestion) =>
          hasMeaningfulCourseTitleStructure(
            suggestion?.coursePayload?.course_name || "",
          ),
        )
      : [];
    const priorSuggestedCourses = priorSuggestions
      .map((suggestion) => ({
        duplicateKey: String(suggestion?.duplicateKey || "").trim(),
        course_name: String(suggestion?.coursePayload?.course_name || "").trim(),
        courseArabicName: String(
          suggestion?.courseArabic?.course_name || "",
        ).trim(),
        courseEnglishName: String(
          suggestion?.courseEnglish?.course_name || "",
        ).trim(),
      }))
      .filter(
        (suggestion) =>
          Boolean(suggestion.duplicateKey) || Boolean(suggestion.course_name),
      );

    priorSuggestedCourses.forEach((suggestion) => {
      if (suggestion.duplicateKey && !existingCourseIndex.has(suggestion.duplicateKey)) {
        existingCourseIndex.set(suggestion.duplicateKey, {
          courseId: "",
          courseName:
            suggestion.course_name ||
            suggestion.courseEnglishName ||
            suggestion.courseArabicName,
        });
      }
    });

    const existingCourses = (Array.isArray(user?.schoolPlanner?.courses)
      ? user.schoolPlanner.courses
      : []
    ).map((course) => {
      const normalizedCourse = buildNormalizedCoursePayload(course);

      return {
        duplicateKey: buildCourseDuplicateKey(normalizedCourse),
        course_name: normalizedCourse.course_name,
        course_component: normalizedCourse.course_component,
        course_year: normalizedCourse.course_year,
        course_term: normalizedCourse.course_term,
      };
    });
    const persistedGroupTitle = allGroups
      ? "All stored groups"
      : String(
          req.body?.groupTitle || user?.telegramIntegration?.groupReference || "",
        ).trim();
    const feedbackExamples = buildTelegramCourseSuggestionFeedbackContext(
      user?.schoolPlanner?.telegramCourseSuggestionFeedback,
      groupReference,
      selectedPdfMessageId,
    );

    let aiProvider = "";
    const preferredAiProvider = getTelegramAiProviderPreference(
      user?.info?.aiProvider,
    );

    if (preferredAiProvider === "gemini" && getGeminiApiKey()) {
      aiProvider = "gemini";
    } else if (preferredAiProvider === "openai" && openAiClient) {
      aiProvider = "openai";
    } else if (getGeminiApiKey()) {
      aiProvider = "gemini";
    } else if (openAiClient) {
      aiProvider = "openai";
    }

    if (!aiProvider) {
      setTelegramCourseSuggestionStatus(userId, {
        active: false,
        phase: "failed",
        message:
          "No AI provider key is configured for Telegram AI course predictions.",
      });
      return res.status(503).json({
        message:
          "AI course predictions are unavailable because no AI provider key is configured.",
        code: "TELEGRAM_AI_PROVIDER_UNAVAILABLE",
      });
    }

    setTelegramCourseSuggestionStatus(userId, {
      active: true,
      phase: "calling-ai",
      message:
        aiProvider === "gemini"
          ? "Sending the course-name prediction request to Gemini."
          : "Sending the course-name prediction request to OpenAI.",
    });

    let response = null;
    const aiInstructions = `You extract only course-name predictions from stored Telegram messages.
Return JSON only.
Your task is to find real course names only for this user.
Use a conservative-first strategy.
Prefer returning fewer suggestions rather than returning uncertain ones.
If the evidence is ambiguous, weak, incomplete, or borderline, return no suggestion for that case.
Do not guess the most likely course when evidence is not strong enough.
Start with the user's registered study year. Search previous years only if no reliable evidence is found for that year.
The course-name trace must be meaningful and must refer to a real course, not another meaning.
Use the user's academic profile as the main filter: program, university, and study year must all strongly support the prediction.
Do not invent unsupported facts.
Do not return course details yet. This stage is name prediction only.
If a course appears in English and Arabic and both refer to the same course, return one suggestion only.
For each suggestion, provide both courseArabicName and courseEnglishName.
If evidence exists in only one language, translate the same course name into the other language.
Course names may appear in abbreviated form. Accept them only when the surrounding evidence clearly supports the same course.
Use attachmentTextExtracted from stored PDFs as evidence when useful, but do not treat it as automatically stronger than other evidence.
You are learning from this user's past feedback. Reuse accepted patterns and avoid repeating rejected patterns when the evidence is similar.
Never return a course that already exists in existingCourses or alreadySuggestedCourses.
When appendSuggestions is true, focus on additional valid courses that were not suggested before.
Every suggestion must include matchedKeys and the master key must always be "course_name".
Do not return any suggestion unless "course_name" is present and strongly supported.
Require at least 2 independent evidence signals before returning a course name.
Valid independent signals can include:
- a strong course-like filename surface,
- extracted PDF text that supports the same course,
- message text that supports the same course,
- academic-profile alignment with program, university, and study year,
- repeated support across separate stored messages.
One weak signal alone is not enough.
When possible, add other corroborating matched keys alongside "course_name", but never omit "course_name".
Do not include source-trace formatting or raw message references inside reasons or summaries.
Use high confidence only when the course is clearly supported by multiple independent signals.
If two or more courses are plausible, return none unless one course is clearly better supported.
Each suggestion must follow this JSON shape:
{
  "suggestions": [
    {
      "courseArabicName": "",
      "courseEnglishName": "",
      "coursePayload": {
        "course_name": ""
      },
      "confidence": 0,
      "reasons": [],
      "matchedKeys": ["course_name"],
      "sourceMessageIds": [],
      "conceptualSummary": ""
    }
  ]
}`;
    const buildCourseSuggestionAiInput = (messageCandidates) =>
      JSON.stringify({
        user: {
          username: user?.info?.username || "",
          program: user?.info?.program || "",
          university: user?.info?.university || "",
          studyYear: user?.info?.studyYear || "",
        },
        groupReference,
        appendSuggestions,
        coursePayloadKeys: TELEGRAM_COURSE_NAME_PREDICTION_KEYS,
        existingCourses,
        alreadySuggestedCourses: priorSuggestedCourses,
        feedbackExamples,
        messageCandidates,
      });

    const attemptSizes = [
      aiContextEntries.length,
      4,
      2,
      1,
    ].filter((value, index, values) => value > 0 && values.indexOf(value) === index);
    let lastAiError = null;

    for (const attemptSize of attemptSizes) {
      const attemptCandidates = aiContextEntries.slice(0, attemptSize);
      const aiInput = buildCourseSuggestionAiInput(attemptCandidates);

      try {
        setTelegramCourseSuggestionStatus(userId, {
          active: true,
          phase: "calling-ai",
          message:
            attemptSize === aiContextEntries.length
              ? aiProvider === "gemini"
                ? "Sending the course-name prediction request to Gemini."
                : "Sending the course-name prediction request to OpenAI."
              : `Retrying course-name prediction with a smaller evidence set (${attemptSize}).`,
        });

        response = await runWithTimeout(
          aiProvider === "gemini"
            ? createGeminiResponse({
                model: TELEGRAM_GEMINI_MODEL,
                instructions: aiInstructions,
                input: aiInput,
              })
            : openAiClient.responses.create({
                model: TELEGRAM_COURSE_SUGGESTION_MODEL,
                instructions: aiInstructions,
                input: aiInput,
              }),
          TELEGRAM_COURSE_SUGGESTION_AI_TIMEOUT_MS,
          "AI request timed out while generating course name predictions.",
        );
        break;
      } catch (error) {
        lastAiError = error;
        const errorMessage =
          error?.message || "Unable to complete the AI request.";
        const isTimeout = /timed out/i.test(errorMessage);

        if (!isTimeout || attemptSize === attemptSizes[attemptSizes.length - 1]) {
          setTelegramCourseSuggestionStatus(userId, {
            active: false,
            phase: "failed",
            message:
              errorMessage || "AI request failed while generating course name predictions.",
          });
          return res.status(isTimeout ? 504 : 502).json({
            message: errorMessage,
            code: isTimeout
              ? "TELEGRAM_AI_REQUEST_TIMEOUT"
              : "TELEGRAM_AI_REQUEST_FAILED",
            aiProvider,
          });
        }
      }
    }

    if (!response) {
      const errorMessage =
        lastAiError?.message || "Unable to complete the AI request.";
      setTelegramCourseSuggestionStatus(userId, {
        active: false,
        phase: "failed",
        message: errorMessage,
      });
      return res.status(504).json({
        message: errorMessage,
        code: "TELEGRAM_AI_REQUEST_TIMEOUT",
        aiProvider,
      });
    }

    setTelegramCourseSuggestionStatus(userId, {
      active: true,
      phase: "normalizing-results",
      message: "Normalizing course-name predictions and removing duplicates.",
    });

    const parsed = parseJsonObjectFromText(response.output_text || "");
    const rawSuggestions = Array.isArray(parsed?.suggestions)
      ? parsed.suggestions
      : [];
    const finalSuggestions = finalizeAiCourseSuggestions({
      rawSuggestions,
      existingCourseIndex,
      contextEntries,
    });

    if (finalSuggestions.length === 0) {
      setTelegramCourseSuggestionStatus(userId, {
        active: false,
        phase: "failed",
        message: "AI returned no usable course name predictions.",
      });
      return res.status(422).json({
        message: "AI returned no usable course name predictions.",
        code: "TELEGRAM_AI_EMPTY_RESULT",
        aiProvider,
      });
    }

    setTelegramCourseSuggestionStatus(userId, {
      active: false,
      phase: "completed",
      message: appendSuggestions
        ? `Added ${finalSuggestions.length} new course name prediction(s) for review.`
        : `Built ${finalSuggestions.length} course name prediction(s) for review.`,
    });

    const mergedSuggestions = appendSuggestions
      ? mergeTelegramCourseSuggestions(priorSuggestions, finalSuggestions)
      : finalSuggestions;

    upsertTelegramCourseSuggestionsRecord({
      user,
      groupReference,
      groupTitle: persistedGroupTitle,
      sourceMessageId: selectedPdfMessageId,
      sourceAttachmentFileName: selectedPdfFileName,
      suggestions: mergedSuggestions,
      analyzedMessagesCount: aiContextEntries.length,
      searchedKeys: TELEGRAM_COURSE_NAME_PREDICTION_KEYS,
    });

    await user.save();

    return res.status(200).json({
      suggestions: mergedSuggestions,
      newSuggestions: finalSuggestions,
      newSuggestionsCount: finalSuggestions.length,
      totalSuggestionsCount: mergedSuggestions.length,
      analyzedMessagesCount: aiContextEntries.length,
      searchedKeys: TELEGRAM_COURSE_NAME_PREDICTION_KEYS,
      aiProvider,
      sourceMessageId: selectedPdfMessageId,
      sourceAttachmentFileName: selectedPdfFileName,
      allGroups,
      savedAt: new Date().toISOString(),
    });
  } catch (error) {
    setTelegramCourseSuggestionStatus(userId, {
      active: false,
      phase: "error",
      message: error?.message || "Unable to generate course name predictions.",
    });
    next(error);
  }
});

TelegramRouter.get("/ai/course-suggestions", checkAuth, async (req, res, next) => {
  try {
    const allGroups = String(req.query?.allGroups || "").trim() === "true";
    const groupReference = allGroups
      ? TELEGRAM_COURSE_SUGGESTION_ALL_GROUPS_SCOPE
      : normalizeGroupReference(req.query?.groupReference);
    const sourceMessageId = Number(req.query?.sourceMessageId || 0) || null;

    if (!groupReference) {
      return res.status(400).json({
        message: "Stored conversation reference is required.",
      });
    }

    const user = await UserModel.findById(req.authentication.userId).select(
      "schoolPlanner.telegramCourseSuggestions",
    );

    if (!user) {
      return res.status(404).json({
        message: "User not found.",
      });
    }

    const savedRecord = getSavedTelegramCourseSuggestionsRecord(
      user,
      groupReference,
      sourceMessageId,
    );

    return res.status(200).json({
      suggestions: Array.isArray(savedRecord?.suggestions)
        ? savedRecord.suggestions.filter((suggestion) =>
            hasMeaningfulCourseTitleStructure(
              suggestion?.coursePayload?.course_name || "",
            ) &&
            normalizeTelegramCourseSuggestionMatchedKeys(
              suggestion?.matchedKeys,
            ).length > 0,
          )
        : [],
      aiProvider: "saved",
      analyzedMessagesCount: Number(savedRecord?.analyzedMessagesCount || 0),
      searchedKeys: Array.isArray(savedRecord?.searchedKeys)
        ? savedRecord.searchedKeys
        : [],
      savedAt: savedRecord?.savedAt || null,
      groupTitle: String(savedRecord?.groupTitle || "").trim(),
      sourceMessageId: Number(savedRecord?.sourceMessageId || 0) || null,
      sourceAttachmentFileName: String(savedRecord?.sourceAttachmentFileName || "").trim(),
      allGroups,
    });
  } catch (error) {
    next(error);
  }
});

TelegramRouter.get(
  "/ai/course-suggestions/rejected",
  checkAuth,
  async (req, res, next) => {
    try {
      const allGroups = String(req.query?.allGroups || "").trim() === "true";
      const groupReference = allGroups
        ? TELEGRAM_COURSE_SUGGESTION_ALL_GROUPS_SCOPE
        : normalizeGroupReference(req.query?.groupReference);
      const sourceMessageId = Number(req.query?.sourceMessageId || 0) || null;

      if (!groupReference) {
        return res.status(400).json({
          message: "Stored conversation reference is required.",
        });
      }

      const user = await UserModel.findById(req.authentication.userId).select(
        "schoolPlanner.telegramCourseSuggestionFeedback",
      );

      if (!user) {
        return res.status(404).json({
          message: "User not found.",
        });
      }

      const suggestions = (Array.isArray(
        user?.schoolPlanner?.telegramCourseSuggestionFeedback,
      )
        ? user.schoolPlanner.telegramCourseSuggestionFeedback
        : []
      )
        .filter((entry) => {
          const isRejected =
            String(entry?.decision || "").trim().toLowerCase() === "rejected";
          const matchesScope = allGroups
            ? Number(entry?.sourceMessageId || 0) === 0
            : String(entry?.groupReference || "").trim() ===
                String(groupReference || "").trim() &&
              Number(entry?.sourceMessageId || 0) ===
                Number(sourceMessageId !== null ? sourceMessageId : 0);

          return (
            isRejected &&
            matchesScope &&
            hasMeaningfulCourseTitleStructure(
              entry?.coursePayload?.course_name || "",
            ) &&
            normalizeTelegramCourseSuggestionMatchedKeys(
              entry?.matchedKeys,
            ).length > 0
          );
        })
        .map((entry, index) => ({
          suggestionKey:
            String(entry?.suggestionKey || "").trim() ||
            `rejected-${String(entry?.duplicateKey || "").trim()}-${index}`,
          duplicateKey: String(entry?.duplicateKey || "").trim(),
          suggestionStage: "name_prediction",
          confidence: Math.max(
            0,
            Math.min(100, Number(entry?.confidence || 0)),
          ),
          reasons: Array.isArray(entry?.reasons) ? entry.reasons : [],
          matchedKeys: normalizeTelegramCourseSuggestionMatchedKeys(
            entry?.matchedKeys,
          ),
          sourceMessageIds: Array.isArray(entry?.sourceMessageIds)
            ? entry.sourceMessageIds
            : [],
          courseArabic:
            entry?.courseArabic ||
            buildPendingCoursePayload(
              String(entry?.coursePayload?.course_name || "").trim(),
            ),
          courseEnglish:
            entry?.courseEnglish ||
            buildPendingCoursePayload(
              String(entry?.coursePayload?.course_name || "").trim(),
            ),
          coursePayload: buildNormalizedCoursePayload(entry?.coursePayload),
          savedAt: entry?.savedAt || null,
          decision: "rejected",
        }));

      return res.status(200).json({
        suggestions,
        count: suggestions.length,
        aiProvider: "rejected_feedback",
        allGroups,
      });
    } catch (error) {
      next(error);
    }
  },
);

TelegramRouter.delete(
  "/ai/course-suggestions",
  checkAuth,
  async (req, res, next) => {
    try {
      const allGroups = String(req.query?.allGroups || "").trim() === "true";
      const groupReference = allGroups
        ? TELEGRAM_COURSE_SUGGESTION_ALL_GROUPS_SCOPE
        : normalizeGroupReference(req.query?.groupReference);
      const sourceMessageId = Number(req.query?.sourceMessageId || 0) || null;

      if (!groupReference) {
        return res.status(400).json({
          message: "Stored conversation reference is required.",
        });
      }

      const user = await UserModel.findById(req.authentication.userId).select(
        "schoolPlanner.telegramCourseSuggestions",
      );

      if (!user) {
        return res.status(404).json({
          message: "User not found.",
        });
      }

      if (!user.schoolPlanner) {
        user.schoolPlanner = {};
      }

      user.schoolPlanner.telegramCourseSuggestions = (
        Array.isArray(user.schoolPlanner.telegramCourseSuggestions)
          ? user.schoolPlanner.telegramCourseSuggestions
          : []
      ).filter((entry) => {
        if (allGroups) {
          return Number(entry?.sourceMessageId || 0) !== 0;
        }

        return !(
          String(entry?.groupReference || "").trim() ===
            String(groupReference || "").trim() &&
          Number(entry?.sourceMessageId || 0) === Number(sourceMessageId || 0)
        );
      });

      await user.save();

      return res.status(200).json({
        message: "Saved course suggestions cleared.",
        allGroups,
      });
    } catch (error) {
      next(error);
    }
  },
);

TelegramRouter.delete(
  "/ai/course-suggestions/rejected",
  checkAuth,
  async (req, res, next) => {
    try {
      const allGroups = String(req.query?.allGroups || "").trim() === "true";
      const groupReference = allGroups
        ? TELEGRAM_COURSE_SUGGESTION_ALL_GROUPS_SCOPE
        : normalizeGroupReference(req.query?.groupReference);
      const sourceMessageId = Number(req.query?.sourceMessageId || 0) || null;

      if (!groupReference) {
        return res.status(400).json({
          message: "Stored conversation reference is required.",
        });
      }

      const user = await UserModel.findById(req.authentication.userId).select(
        "schoolPlanner.telegramCourseSuggestionFeedback",
      );

      if (!user) {
        return res.status(404).json({
          message: "User not found.",
        });
      }

      removeTelegramCourseSuggestionFeedbackByScope({
        user,
        groupReference,
        sourceMessageId,
      });

      await user.save();

      return res.status(200).json({
        message: "Rejected course suggestions cleared.",
        allGroups,
      });
    } catch (error) {
      next(error);
    }
  },
);

TelegramRouter.post("/ai/course-details", checkAuth, async (req, res, next) => {
  try {
    const groupReference = normalizeGroupReference(req.body?.groupReference);
    const sourceMessageId = Number(req.body?.sourceMessageId || 0) || null;
    const sourceAttachmentFileName = String(
      req.body?.sourceAttachmentFileName || "",
    ).trim();
    const courseName = String(req.body?.courseName || "").trim();
    const currentCoursePayload = req.body?.coursePayload || {};

    if (!groupReference) {
      return res.status(400).json({
        message: "Stored conversation reference is required.",
      });
    }

    if (!courseName) {
      return res.status(400).json({
        message: "Course name is required.",
      });
    }

    const openAiClient = getOpenAIClient();
    const user = await UserModel.findById(req.authentication.userId).select(
      "info.username info.program info.university info.studyYear info.aiProvider",
    );

    if (!user) {
      return res.status(404).json({
        message: "User not found.",
      });
    }

    const { filteredMessages } = await queryStoredTelegramMessages({
      ownerUserId: req.authentication.userId,
      groupReference,
      messageId: sourceMessageId,
      limit: 400,
      searchQuery: "",
      startDateMs: null,
      endDateMs: null,
      pdfOnly: Boolean(sourceMessageId),
    });
    const contextEntries = buildCourseSuggestionContextEntries(filteredMessages);
    const focusedContextEntries = selectCourseContextEntries(
      contextEntries,
      courseName,
    );

    if (focusedContextEntries.length === 0) {
      return res.status(404).json({
        message: "No stored Telegram evidence matched this course name.",
      });
    }

    let aiProvider = "";
    const preferredAiProvider = getTelegramAiProviderPreference(
      user?.info?.aiProvider,
    );

    if (preferredAiProvider === "gemini" && getGeminiApiKey()) {
      aiProvider = "gemini";
    } else if (preferredAiProvider === "openai" && openAiClient) {
      aiProvider = "openai";
    } else if (getGeminiApiKey()) {
      aiProvider = "gemini";
    } else if (openAiClient) {
      aiProvider = "openai";
    }

    if (!aiProvider) {
      return res.status(503).json({
        message:
          "AI course-detail fill is unavailable because no AI provider key is configured.",
        code: "TELEGRAM_AI_PROVIDER_UNAVAILABLE",
      });
    }

    let response = null;
    const aiInstructions = `You enrich a single SchoolPlanner course from stored Telegram messages.
Return JSON only.
The target course name is \"${courseName}\".
Search first within the user's registered study year. Search previous years only if that year does not provide reliable evidence.
Only extract facts that clearly belong to this exact course in this user's program and university.
Do not rename the course to a different course.
If Arabic and English variants appear and refer to the same course, treat them as one course.
Never invent unsupported facts.
For unknown string fields use "-".
For unknown arrays use [].
For unknown numeric fields use 0.
For course_exams use an array of objects with keys: exam_type, exam_date, exam_time, course_grade, course_fullGrade.
Return this JSON shape:
{
  "coursePayload": {
    "course_name": "",
    "course_component": "-",
    "course_dayAndTime": [],
    "course_year": "-",
    "course_term": "-",
    "course_class": "-",
    "course_status": "-",
    "course_instructors": [],
    "course_grade": "",
    "course_fullGrade": "",
    "course_length": 0,
    "course_progress": 0,
    "course_exams": [],
    "exam_type": "-",
    "exam_date": "-",
    "exam_time": "-"
  },
  "confidence": 0,
  "reasons": [],
  "sourceMessageIds": []
}`;
    const aiInput = JSON.stringify({
      user: {
        username: user?.info?.username || "",
        program: user?.info?.program || "",
        university: user?.info?.university || "",
        studyYear: user?.info?.studyYear || "",
      },
      groupReference,
      sourceMessageId,
      sourceAttachmentFileName,
      targetCourseName: courseName,
      currentCoursePayload,
      messageCandidates: focusedContextEntries,
    });

    try {
      response = await runWithTimeout(
        aiProvider === "gemini"
          ? createGeminiResponse({
              model: TELEGRAM_GEMINI_MODEL,
              instructions: aiInstructions,
              input: aiInput,
            })
          : openAiClient.responses.create({
              model: TELEGRAM_COURSE_SUGGESTION_MODEL,
              instructions: aiInstructions,
              input: aiInput,
            }),
        TELEGRAM_AI_REQUEST_TIMEOUT_MS,
        "AI request timed out while filling course details.",
      );
    } catch (error) {
      const errorMessage =
        error?.message || "Unable to complete the AI request.";
      const isTimeout = /timed out/i.test(errorMessage);
      return res.status(isTimeout ? 504 : 502).json({
        message: errorMessage,
        code: isTimeout
          ? "TELEGRAM_AI_REQUEST_TIMEOUT"
          : "TELEGRAM_AI_REQUEST_FAILED",
        aiProvider,
      });
    }

    const parsed = parseJsonObjectFromText(response.output_text || "");
    const coursePayload = buildNormalizedCoursePayload({
      ...parsed?.coursePayload,
      course_name:
        String(parsed?.coursePayload?.course_name || "").trim() || courseName,
    });

    return res.status(200).json({
      coursePayload,
      confidence: Math.max(0, Math.min(100, Number(parsed?.confidence || 0))),
      reasons: Array.isArray(parsed?.reasons) ? parsed.reasons : [],
      sourceMessageIds: Array.isArray(parsed?.sourceMessageIds)
        ? parsed.sourceMessageIds
        : [],
      analyzedMessagesCount: focusedContextEntries.length,
      searchedKeys: TELEGRAM_COURSE_PAYLOAD_KEYS,
      sourceMessageId,
      sourceAttachmentFileName,
    });
  } catch (error) {
    next(error);
  }
});

TelegramRouter.post(
  "/ai/course-suggestions/feedback",
  checkAuth,
  async (req, res, next) => {
    try {
      const allGroups = Boolean(req.body?.allGroups);
      const groupReference = allGroups
        ? TELEGRAM_COURSE_SUGGESTION_ALL_GROUPS_SCOPE
        : normalizeGroupReference(req.body?.groupReference);
      const sourceMessageId = Number(req.body?.sourceMessageId || 0) || null;
      const sourceAttachmentFileName = String(req.body?.sourceAttachmentFileName || "").trim();
      const decision = String(req.body?.decision || "").trim().toLowerCase();
      const suggestion = req.body?.suggestion || {};

      if (!groupReference) {
        return res.status(400).json({
          message: "Stored conversation reference is required.",
        });
      }

      if (!["accepted", "rejected"].includes(decision)) {
        return res.status(400).json({
          message: "Suggestion feedback decision is invalid.",
        });
      }

      const user = await UserModel.findById(req.authentication.userId).select(
        "schoolPlanner.telegramCourseSuggestionFeedback schoolPlanner.telegramCourseSuggestions",
      );

      if (!user) {
        return res.status(404).json({
          message: "User not found.",
        });
      }

      saveTelegramCourseSuggestionFeedback({
        user,
        groupReference,
        groupTitle: allGroups
          ? "All stored groups"
          : String(req.body?.groupTitle || "").trim(),
        sourceMessageId,
        sourceAttachmentFileName,
        decision,
        suggestion,
      });
      removeTelegramCourseSuggestionFromSavedRecord({
        user,
        groupReference,
        sourceMessageId,
        suggestion,
      });
      await user.save();

      return res.status(200).json({
        message: "Suggestion feedback saved.",
        allGroups,
      });
    } catch (error) {
      next(error);
    }
  },
);

TelegramRouter.get(
  "/ai/course-suggestions/status",
  checkAuth,
  async (req, res) => {
    return res.status(200).json({
      status: getTelegramCourseSuggestionStatus(req.authentication.userId),
    });
  },
);

TelegramRouter.post("/config", checkAuth, async (req, res, next) => {
  try {
    const user = await UserModel.findById(req.authentication.userId);

    if (!user) {
      return res.status(404).json({
        message: "User not found.",
      });
    }

    const nextPageUrl = normalizePageUrl(req.body?.pageUrl);
    const nextGroupReference = normalizeGroupReference(req.body?.groupReference);
    const nextApiId = String(req.body?.apiId || "").trim();
    const nextApiHash = String(req.body?.apiHash || "").trim();
    const nextStringSession = String(req.body?.stringSession || "").trim();
    const nextHistoryStartDate = parseHistoryStartDate(req.body?.historyStartDate);

    if (req.body?.historyStartDate && !nextHistoryStartDate) {
      return res.status(400).json({
        message: "Telegram history start date is invalid.",
      });
    }

    if (!user.telegramIntegration) {
      user.telegramIntegration = {};
    }

    const previousGroupReference = normalizeGroupReference(
      user.telegramIntegration.groupReference,
    );
    const previousHistoryStartDate = user.telegramIntegration.historyStartDate
      ? new Date(user.telegramIntegration.historyStartDate).getTime()
      : null;
    const nextHistoryStartMs = nextHistoryStartDate
      ? nextHistoryStartDate.getTime()
      : null;
    const shouldResetStoredHistory =
      previousGroupReference !== nextGroupReference ||
      previousHistoryStartDate !== nextHistoryStartMs;

    user.telegramIntegration.pageUrl = nextPageUrl;
    user.telegramIntegration.groupReference = nextGroupReference;
    user.telegramIntegration.historyStartDate = nextHistoryStartDate;
    user.telegramIntegration.syncEnabled = Boolean(
      nextGroupReference && nextHistoryStartDate,
    );

    if (nextApiId) {
      user.telegramIntegration.apiIdEncrypted = encryptValue(nextApiId);
    }

    if (nextApiHash) {
      user.telegramIntegration.apiHashEncrypted = encryptValue(nextApiHash);
    }

    if (nextStringSession) {
      user.telegramIntegration.stringSessionEncrypted =
        encryptValue(nextStringSession);
    }

    user.telegramIntegration.updatedAt = new Date();

    if (shouldResetStoredHistory) {
      user.telegramIntegration.historyImportedAt = null;
      user.telegramIntegration.lastSyncedAt = null;
      user.telegramIntegration.lastStoredMessageId = 0;
      user.telegramIntegration.lastStoredMessageDate = null;
      user.telegramIntegration.lastSyncStatus = "";
      user.telegramIntegration.lastSyncReason = "";
      user.telegramIntegration.lastSyncMessage = "";
      user.telegramIntegration.lastSyncImportedCount = 0;
      user.telegramIntegration.lastSyncError = "";
      user.telegramIntegration.lastSyncScannedCount = 0;
      user.telegramIntegration.lastSyncNewestMessageDateSeen = null;
      user.telegramIntegration.lastSyncOldestMessageDateSeen = null;
      user.telegramIntegration.lastSyncOldestImportedMessageDate = null;
      user.telegramIntegration.lastSyncFirstSkippedBeforeStartDate = null;
      user.telegramIntegration.lastSyncReachedStartBoundary = false;
    }

    if (user.telegramIntegration.syncEnabled) {
      applyTelegramSyncResult(user, {
        status: "running",
        reason: "sync-running",
        message: "Telegram settings saved. Background history sync started.",
      });
    }

    await user.save();

    if (user.telegramIntegration.syncEnabled) {
      syncTelegramMessagesForUser(user._id, {
        force: true,
      }).catch(() => {});
    }

    const storedCount = await getStoredMessageCountForUser(user);

    return res.status(200).json({
      message: user.telegramIntegration.syncEnabled
        ? "Telegram settings saved. Background history sync started."
        : "Telegram settings saved for this user.",
      ...buildConfigStatusPayload(user),
      storedCount,
    });
  } catch (error) {
    next(error);
  }
});

TelegramRouter.post("/auth/start", checkAuth, async (req, res, next) => {
  try {
    const apiId = Number(req.body?.apiId || 0);
    const apiHash = String(req.body?.apiHash || "").trim();
    const phoneNumber = String(req.body?.phoneNumber || "").trim();

    if (!apiId || !apiHash || !phoneNumber) {
      return res.status(400).json({
        message: "Please provide Telegram API ID, API Hash, and phone number.",
      });
    }

    await clearPendingTelegramAuth(req.authentication.userId);

    const client = new TelegramClient(
      new StringSession(""),
      apiId,
      apiHash,
      {
        connectionRetries: 5,
      },
    );

    await client.connect();
    const sendCodeResult = await client.sendCode(
      { apiId, apiHash },
      phoneNumber,
      false,
    );

    setPendingTelegramAuth(req.authentication.userId, {
      client,
      apiId,
      apiHash,
      phoneNumber,
      phoneCodeHash: sendCodeResult.phoneCodeHash,
      isCodeViaApp: Boolean(sendCodeResult.isCodeViaApp),
    });

    return res.status(200).json({
      message: "Telegram login code sent.",
      isCodeViaApp: Boolean(sendCodeResult.isCodeViaApp),
      requiresPassword: false,
    });
  } catch (error) {
    next(error);
  }
});

TelegramRouter.post("/auth/verify-code", checkAuth, async (req, res, next) => {
  try {
    const pending = getPendingTelegramAuth(req.authentication.userId);
    const phoneCode = String(req.body?.phoneCode || "").trim();

    if (!pending) {
      return res.status(400).json({
        message: "Telegram login session expired. Start again.",
      });
    }

    if (!phoneCode) {
      return res.status(400).json({
        message: "Please enter the Telegram login code.",
      });
    }

    try {
      await pending.client.invoke(
        new Api.auth.SignIn({
          phoneNumber: pending.phoneNumber,
          phoneCodeHash: pending.phoneCodeHash,
          phoneCode,
        }),
      );

      const stringSession = pending.client.session.save();
      const user = await persistTelegramCredentials({
        userId: req.authentication.userId,
        apiId: pending.apiId,
        apiHash: pending.apiHash,
        stringSession,
      });

      await clearPendingTelegramAuth(req.authentication.userId);

      return res.status(200).json({
        message: "Telegram connected successfully.",
        requiresPassword: false,
        ...buildConfigStatusPayload(user),
      });
    } catch (error) {
      if (error?.errorMessage === "SESSION_PASSWORD_NEEDED") {
        return res.status(200).json({
          message: "Telegram account needs the 2-step verification password.",
          requiresPassword: true,
        });
      }

      throw error;
    }
  } catch (error) {
    next(error);
  }
});

TelegramRouter.post(
  "/auth/verify-password",
  checkAuth,
  async (req, res, next) => {
    try {
      const pending = getPendingTelegramAuth(req.authentication.userId);
      const password = String(req.body?.password || "").trim();

      if (!pending) {
        return res.status(400).json({
          message: "Telegram login session expired. Start again.",
        });
      }

      if (!password) {
        return res.status(400).json({
          message: "Please enter the Telegram 2-step verification password.",
        });
      }

      const passwordSrpResult = await pending.client.invoke(
        new Api.account.GetPassword(),
      );
      const passwordSrpCheck = await computeCheck(passwordSrpResult, password);

      await pending.client.invoke(
        new Api.auth.CheckPassword({
          password: passwordSrpCheck,
        }),
      );

      const stringSession = pending.client.session.save();
      const user = await persistTelegramCredentials({
        userId: req.authentication.userId,
        apiId: pending.apiId,
        apiHash: pending.apiHash,
        stringSession,
      });

      await clearPendingTelegramAuth(req.authentication.userId);

      return res.status(200).json({
        message: "Telegram connected successfully.",
        requiresPassword: false,
        ...buildConfigStatusPayload(user),
      });
    } catch (error) {
      next(error);
    }
  },
);

TelegramRouter.get("/status", checkAuth, async (req, res, next) => {
  try {
    const user = await UserModel.findById(req.authentication.userId).select(
      "telegramIntegration",
    );

    if (!user) {
      return res.status(404).json({
        message: "User not found.",
      });
    }

    return res.status(200).json({
      configured: buildConfigStatusPayload(user).configured,
    });
  } catch (error) {
    next(error);
  }
});

TelegramRouter.get("/group-messages", checkAuth, async (req, res, next) => {
  try {
    const user = await UserModel.findById(req.authentication.userId).select(
      "telegramIntegration info.username",
    );

    if (!user) {
      return res.status(404).json({
        message: "User not found.",
      });
    }

    const userConfig = getUserTelegramConfig(user);
    const groupReference = normalizeGroupReference(
      req.query.group || userConfig.groupReference,
    );
    const requestedLimit = Number(req.query.limit || TELEGRAM_DEFAULT_LIMIT);
    const limit = Math.min(
      TELEGRAM_MAX_LIMIT,
      Math.max(
        1,
        Number.isFinite(requestedLimit)
          ? requestedLimit
          : TELEGRAM_DEFAULT_LIMIT,
      ),
    );
    const searchQuery = String(req.query.q || "").trim();
    const startDateMs = parseQueryDateValue(req.query.start, "start");
    const endDateMs = parseQueryDateValue(req.query.end, "end");

    if (req.query.start && startDateMs === null) {
      return res.status(400).json({
        message: "Telegram search start date is invalid.",
      });
    }

    if (req.query.end && endDateMs === null) {
      return res.status(400).json({
        message: "Telegram search end date is invalid.",
      });
    }

    if (
      startDateMs !== null &&
      endDateMs !== null &&
      startDateMs > endDateMs
    ) {
      return res.status(400).json({
        message: "Telegram search start date must be before end date.",
      });
    }

    if (!groupReference) {
      return res.status(400).json({
        message:
          "Please save a Telegram group reference first, or provide ?group=group_username_or_link",
      });
    }

    const { canSync } = getTelegramSyncEligibility(user);

    if (canSync) {
      syncTelegramMessagesForUser(user._id).catch(() => {});
    }

    const {
      filteredMessages,
      rawCount,
      storedCount,
    } = await queryStoredTelegramMessages({
      ownerUserId: user._id,
      groupReference,
      limit,
      searchQuery,
      startDateMs,
      endDateMs,
    });

    const groupSnapshot = await TelegramMessageModel.findOne({
      ownerUserId: user._id,
      groupReference,
    })
      .sort({ dateMs: -1 })
      .lean();

    return res.status(200).json({
      group: {
        id: groupSnapshot?.groupId || null,
        title:
          groupSnapshot?.groupTitle || userConfig.groupReference || "Telegram Group",
        username: groupSnapshot?.groupUsername || null,
        pageUrl: userConfig.pageUrl,
      },
      count: filteredMessages.length,
      rawCount,
      storedCount,
      searched: {
        q: searchQuery,
        start: startDateMs,
        end: endDateMs,
        limit,
      },
      messages: filteredMessages,
      sync: buildConfigStatusPayload(user),
    });
  } catch (error) {
    if (!error.status) {
      error.status = 500;
    }

    if (error.message?.includes("Cannot cast")) {
      error.status = 400;
      error.message = "Telegram group reference is invalid.";
    }

    next(error);
  }
});

TelegramRouter.post("/send-note", checkAuth, async (req, res, next) => {
  let client = null;

  try {
    const user = await UserModel.findById(req.authentication.userId).select(
      "telegramIntegration info.username",
    );

    if (!user) {
      return res.status(404).json({
        message: "User not found.",
      });
    }

    const userConfig = getUserTelegramConfig(user);
    const noteText = String(req.body?.text || "").trim();
    const requestedTargetMode = String(req.body?.targetMode || "saved").trim();
    const targetMode =
      requestedTargetMode === "group" ? "group" : "saved";
    const targetReference =
      targetMode === "group"
        ? normalizeGroupReference(req.body?.target || userConfig.groupReference)
        : "me";

    if (!noteText) {
      return res.status(400).json({
        message: "Telegram note text is required.",
      });
    }

    if (targetMode === "group" && !targetReference) {
      return res.status(400).json({
        message: "Telegram group reference is required for group sends.",
      });
    }

    client = await ensureTelegramClient(userConfig);
    const entity =
      targetMode === "group"
        ? await resolveTelegramGroupEntity(client, targetReference)
        : "me";

    await client.sendMessage(entity, {
      message: noteText,
    });

    return res.status(200).json({
      message:
        targetMode === "group"
          ? "Planner note sent to Telegram group."
          : "Planner note sent to Telegram saved messages.",
      targetMode,
      target:
        targetMode === "group"
          ? targetReference
          : "me",
    });
  } catch (error) {
    next(error);
  } finally {
    if (client) {
      try {
        await client.disconnect();
      } catch {
        // ignore disconnect errors
      }
    }
  }
});

export default TelegramRouter;
