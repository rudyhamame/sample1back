import express from "express";
import crypto from "crypto";
import "dotenv/config";
import checkAuth from "../check-auth.js";
import UserModel from "../compat/UserModel.js";
import {
  ensureUserMemoryDoc,
  findTelegramSettings,
  findUserMemoryLean,
} from "../services/userData.js";
import TelegramSettingsModel from "../compat/TelegramSettingsModel.js";
import { Api, TelegramClient } from "telegram";
import { StringSession } from "telegram/sessions/index.js";
import { computeCheck } from "telegram/Password.js";
import { LogLevel } from "telegram/extensions/Logger.js";

const TelegramRouter = express.Router();

const TELEGRAM_ALGORITHM = "aes-256-gcm";
const TELEGRAM_SYNC_INTERVAL_MS = Math.max(
  60 * 1000,
  Number.parseInt(
    String(process.env.TELEGRAM_SYNC_INTERVAL_MS || "300000").trim(),
    10,
  ) || 300000,
);
const TELEGRAM_CONNECT_TIMEOUT_MS = Math.max(
  5000,
  Number.parseInt(
    String(process.env.TELEGRAM_CONNECT_TIMEOUT_MS || "20000").trim(),
    10,
  ) || 20000,
);
const TELEGRAM_DIALOG_LIMIT = Math.max(
  20,
  Number.parseInt(
    String(process.env.TELEGRAM_DIALOG_LIMIT || "200").trim(),
    10,
  ) || 200,
);
const TELEGRAM_FETCH_BATCH_SIZE = 100;
const TELEGRAM_MAX_SYNC_MESSAGES = Math.max(
  100,
  Number.parseInt(
    String(process.env.TELEGRAM_MAX_SYNC_MESSAGES || "2000").trim(),
    10,
  ) || 2000,
);
const STORAGE_ONLY_MESSAGE =
  "Telegram API is storage-only now. It stores Telegram group info and messages in user memory.";

const pendingTelegramAuthByUser = new Map();
const telegramSyncPromisesByUser = new Map();
let telegramSyncWorkerStarted = false;
let telegramSyncWorkerIntervalId = null;

const normalizeString = (value) => String(value || "").trim();
const toArray = (value) => (Array.isArray(value) ? value : []);

const normalizePageUrl = (value) => {
  const normalizedValue = normalizeString(value);

  if (!normalizedValue) {
    return "";
  }

  try {
    return new URL(normalizedValue).toString();
  } catch {
    return normalizedValue;
  }
};

const normalizeGroupReference = (value) => {
  const normalizedValue = normalizeString(value);

  if (!normalizedValue) {
    return "";
  }

  let nextValue = normalizedValue;

  try {
    const parsedUrl = new URL(normalizedValue);
    const hostname = normalizeString(parsedUrl.hostname).toLowerCase();

    if (hostname === "t.me" || hostname.endsWith(".t.me")) {
      nextValue = normalizeString(parsedUrl.pathname).replace(/^\/+/, "");
    }
  } catch {}

  return nextValue
    .replace(/^https?:\/\/t\.me\//i, "")
    .replace(/^@+/, "")
    .replace(/^\/+/, "")
    .trim();
};

const normalizeTelegramSyncMode = (value) =>
  normalizeString(value).toLowerCase() === "one-time" ? "one-time" : "live";

const normalizeTelegramDateMs = (value) => {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value.getTime();
  }

  const numericValue = Number(value);

  if (Number.isFinite(numericValue) && numericValue > 0) {
    return numericValue < 1e12 ? numericValue * 1000 : numericValue;
  }

  if (!value) {
    return null;
  }

  const parsedDateMs = new Date(value).getTime();
  return Number.isNaN(parsedDateMs) ? null : parsedDateMs;
};

const parseDateInput = (value) => {
  if (value === null || typeof value === "undefined" || value === "") {
    return null;
  }

  const parsedDate = new Date(value);
  return Number.isNaN(parsedDate.getTime()) ? null : parsedDate;
};

const parseQueryDateValue = (value) => {
  if (typeof value === "undefined" || value === null || value === "") {
    return null;
  }

  return normalizeTelegramDateMs(value);
};

const runWithTimeout = async (
  promise,
  timeoutMs,
  errorMessage = "Telegram request timed out.",
) =>
  Promise.race([
    promise,
    new Promise((_, reject) => {
      const timeoutId = setTimeout(() => {
        const error = new Error(errorMessage);
        error.code = "TELEGRAM_TIMEOUT";
        reject(error);
      }, timeoutMs);

      if (typeof timeoutId?.unref === "function") {
        timeoutId.unref();
      }
    }),
  ]);

const getTelegramConfigSecret = () => {
  const secret = normalizeString(
    process.env.TELEGRAM_CONFIG_SECRET || process.env.JWT_KEY || "",
  );

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
  const plainText = normalizeString(value);

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
  const serialized = normalizeString(value);

  if (!serialized) {
    return "";
  }

  const [ivBase64, authTagBase64, encryptedBase64] = serialized.split(":");

  if (!ivBase64 || !authTagBase64 || !encryptedBase64) {
    return "";
  }

  try {
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
  } catch {
    return "";
  }
};

const getUserTelegramConfig = (telegramSettings) => {
  const status = telegramSettings?.status || {};
  const apiId = Number(decryptValue(status.apiIdEncrypted));

  return {
    pageUrl: normalizePageUrl(status.pageUrl),
    groupReference: normalizeGroupReference(status.groupReference),
    syncMode: normalizeTelegramSyncMode(status.syncMode),
    historyStartDate: status.historyStartDate || null,
    historyEndDate: status.historyEndDate || null,
    syncEnabled: Boolean(status.syncEnabled),
    apiId: Number.isFinite(apiId) && apiId > 0 ? apiId : 0,
    apiHash: decryptValue(status.apiHashEncrypted),
    stringSession: decryptValue(status.stringSessionEncrypted),
  };
};

const getTelegramSyncEligibility = (user, telegramSettings) => {
  const config = getUserTelegramConfig(telegramSettings);
  const canSync = Boolean(
    config.syncEnabled &&
    config.groupReference &&
    config.historyStartDate &&
    config.apiId &&
    config.apiHash &&
    config.stringSession,
  );

  return { config, canSync };
};

const ensureTelegramClient = async (config) => {
  if (!config?.apiId || !config?.apiHash || !config?.stringSession) {
    const error = new Error("Telegram credentials are not configured.");
    error.status = 400;
    throw error;
  }

  const client = new TelegramClient(
    new StringSession(config.stringSession),
    config.apiId,
    config.apiHash,
    {
      connectionRetries: 1,
      requestRetries: 1,
      retryDelay: 500,
      timeout: TELEGRAM_CONNECT_TIMEOUT_MS,
    },
  );

  client.setLogLevel(LogLevel.ERROR);
  await runWithTimeout(client.connect(), TELEGRAM_CONNECT_TIMEOUT_MS);

  return client;
};

const buildEmptyTelegramGroupMemory = () => ({
  info: {
    name: "",
    groupReference: "",
    memberCount: 0,
    description: "",
    messageCount: 0,
  },
  content: [
    {
      texts: [],
      photos: [],
      videos: [],
      audios: [],
      documents: [],
    },
  ],
});

const ensureTelegramGroupMemory = (memoryDoc) => {
  if (!memoryDoc) {
    return buildEmptyTelegramGroupMemory();
  }

  if (!memoryDoc.telegram || typeof memoryDoc.telegram !== "object") {
    memoryDoc.telegram = {};
  }

  if (!memoryDoc.telegram.groups || typeof memoryDoc.telegram.groups !== "object") {
    memoryDoc.telegram.groups = buildEmptyTelegramGroupMemory();
  }

  const groups = memoryDoc.telegram.groups;

  if (!groups.info || typeof groups.info !== "object") {
    groups.info = buildEmptyTelegramGroupMemory().info;
  }

  if (!Array.isArray(groups.content)) {
    groups.content = [];
  }

  if (groups.content.length === 0) {
    groups.content.push(buildEmptyTelegramGroupMemory().content[0]);
  }

  const primaryContent = groups.content[0];
  primaryContent.texts = Array.isArray(primaryContent.texts)
    ? primaryContent.texts
    : [];
  primaryContent.photos = Array.isArray(primaryContent.photos)
    ? primaryContent.photos
    : [];
  primaryContent.videos = Array.isArray(primaryContent.videos)
    ? primaryContent.videos
    : [];
  primaryContent.audios = Array.isArray(primaryContent.audios)
    ? primaryContent.audios
    : [];
  primaryContent.documents = Array.isArray(primaryContent.documents)
    ? primaryContent.documents
    : [];

  groups.content[0] = primaryContent;
  return groups;
};

const resetTelegramGroupMemory = (memoryDoc) => {
  if (!memoryDoc) {
    return buildEmptyTelegramGroupMemory();
  }

  memoryDoc.telegram = memoryDoc.telegram || {};
  memoryDoc.telegram.groups = buildEmptyTelegramGroupMemory();
  return memoryDoc.telegram.groups;
};

const getTelegramGroupPrimaryContent = (memoryDoc) =>
  ensureTelegramGroupMemory(memoryDoc).content[0];

const listStoredTelegramMessages = (memoryDoc, groupReference = "") => {
  const normalizedReference = normalizeGroupReference(groupReference);
  const primaryContent = getTelegramGroupPrimaryContent(memoryDoc);
  const messages = [
    ...toArray(primaryContent.texts),
    ...toArray(primaryContent.photos),
    ...toArray(primaryContent.images),
    ...toArray(primaryContent.videos),
    ...toArray(primaryContent.audios),
    ...toArray(primaryContent.documents),
  ].filter(Boolean);

  return messages
    .filter(
      (entry) =>
        !normalizedReference ||
        normalizeGroupReference(entry?.groupReference) === normalizedReference,
    )
    .sort(
      (firstEntry, secondEntry) =>
        Number(secondEntry?.date || 0) - Number(firstEntry?.date || 0),
    );
};

const getStoredMessageCountForUser = async (memoryDoc, user) =>
  listStoredTelegramMessages(
    memoryDoc,
    user?.settings?.telegram?.status?.groupReference,
  ).length;

const buildStoredTelegramGroupSummary = (user, memoryDoc) => {
  const groups = ensureTelegramGroupMemory(memoryDoc);
  const groupReference = normalizeGroupReference(groups.info.groupReference);
  const storedMessages = listStoredTelegramMessages(memoryDoc, groupReference);

  if (!groupReference && storedMessages.length === 0) {
    return null;
  }

  return {
    id: null,
    title: groups.info.name || groupReference || "Telegram Group",
    username: "",
    groupReference,
    pageUrl: normalizePageUrl(
      groups.info.pageUrl || user?.settings?.telegram?.status?.pageUrl,
    ),
    memberCount: Number(groups.info.memberCount || 0),
    description: normalizeString(groups.info.description),
    storedCount: storedMessages.length,
  };
};

const queryStoredTelegramMessages = async ({
  memoryDoc,
  groupReference = "",
  limit = 100,
  searchQuery = "",
  startDateMs = null,
  endDateMs = null,
}) => {
  const normalizedSearch = normalizeString(searchQuery).toLowerCase();
  const messages = listStoredTelegramMessages(memoryDoc, groupReference);
  const filteredMessages = messages.filter((message) => {
    const messageDateMs = Number(message?.date || 0) || 0;

    if (startDateMs !== null && messageDateMs < startDateMs) {
      return false;
    }

    if (endDateMs !== null && messageDateMs > endDateMs) {
      return false;
    }

    if (!normalizedSearch) {
      return true;
    }

    return JSON.stringify(message).toLowerCase().includes(normalizedSearch);
  });

  return {
    filteredMessages:
      limit === "all" ? filteredMessages : filteredMessages.slice(0, limit),
    rawCount: messages.length,
    storedCount: messages.length,
  };
};

const buildConfigStatusPayload = (telegramSettings) => {
  const status = telegramSettings?.status || {};
  const config = getUserTelegramConfig(telegramSettings);

  return {
    pageUrl: config.pageUrl,
    groupReference: config.groupReference,
    syncMode: config.syncMode,
    historyStartDate: status.historyStartDate || null,
    historyEndDate: status.historyEndDate || null,
    syncEnabled: Boolean(status.syncEnabled),
    connected: Boolean(config.apiId && config.apiHash && config.stringSession),
  };
};

const getTelegramMessageBucketName = (entry = {}) => {
  const attachmentKind = normalizeString(entry?.attachmentKind).toLowerCase();

  if (attachmentKind === "photo") {
    return "photos";
  }

  if (attachmentKind === "video") {
    return "videos";
  }

  if (attachmentKind === "audio") {
    return "audios";
  }

  if (attachmentKind === "document" || attachmentKind === "pdf") {
    return "documents";
  }

  return "texts";
};

const normalizeStoredMessage = (entry, bucketName = "texts") => ({
  id: Number(entry?.id || 0),
  groupReference: normalizeGroupReference(entry?.groupReference),
  groupTitle: normalizeString(entry?.groupTitle),
  groupUsername: normalizeString(entry?.groupUsername),
  groupType: normalizeString(entry?.groupType || "group") || "group",
  text: normalizeString(entry?.text),
  date: normalizeTelegramDateMs(entry?.date),
  sender: normalizeString(entry?.sender || "Unknown") || "Unknown",
  views:
    typeof entry?.views === "number" && Number.isFinite(entry.views)
      ? entry.views
      : null,
  replyToMessageId:
    typeof entry?.replyToMessageId === "number" &&
    Number.isFinite(entry.replyToMessageId)
      ? entry.replyToMessageId
      : null,
  attachmentKind:
    normalizeString(entry?.attachmentKind) ||
    (bucketName === "documents" ? "document" : bucketName.slice(0, -1)),
  attachmentMimeType: normalizeString(entry?.attachmentMimeType),
  attachmentFileName: normalizeString(entry?.attachmentFileName),
  attachmentFileExtension: normalizeString(entry?.attachmentFileExtension),
  attachmentSizeBytes:
    typeof entry?.attachmentSizeBytes === "number" &&
    Number.isFinite(entry.attachmentSizeBytes)
      ? entry.attachmentSizeBytes
      : null,
  attachmentIsPdf: Boolean(entry?.attachmentIsPdf),
  telegramFileId:
    typeof entry?.telegramFileId === "number" &&
    Number.isFinite(entry.telegramFileId)
      ? entry.telegramFileId
      : null,
  telegramAccessHash:
    typeof entry?.telegramAccessHash === "number" ||
    typeof entry?.telegramAccessHash === "bigint"
      ? String(entry.telegramAccessHash)
      : normalizeString(entry?.telegramAccessHash),
  telegramFileName: normalizeString(entry?.telegramFileName),
});

const persistTelegramCredentials = async ({
  userId,
  apiId,
  apiHash,
  stringSession,
}) => {
  let telegramSettings = await findTelegramSettings(userId);

  if (!telegramSettings) {
    telegramSettings = new TelegramSettingsModel({
      user: userId,
      groups: [],
      status: {},
    });
  }

  telegramSettings.status = telegramSettings.status || {};
  telegramSettings.status.apiIdEncrypted = encryptValue(apiId);
  telegramSettings.status.apiHashEncrypted = encryptValue(apiHash);
  telegramSettings.status.stringSessionEncrypted = encryptValue(stringSession);
  telegramSettings.status.updatedAt = new Date();

  await telegramSettings.save();
  return telegramSettings;
};

const resolveTelegramGroupEntity = async (client, groupReference) => {
  const normalizedReference = normalizeGroupReference(groupReference);

  if (!normalizedReference) {
    const error = new Error("Telegram group reference is required.");
    error.status = 400;
    throw error;
  }

  try {
    return await client.getEntity(normalizedReference);
  } catch (firstError) {
    if (/^\d+$/.test(normalizedReference)) {
      try {
        return await client.getEntity(Number(normalizedReference));
      } catch {}
    }

    const error = new Error(
      "Unable to resolve the Telegram group/channel from the saved reference.",
    );
    error.status = 404;
    error.cause = firstError;
    throw error;
  }
};

const getTelegramGroupMetadata = async (client, entity, groupReference) => {
  const username = normalizeString(entity?.username);
  const fallbackReference = normalizeGroupReference(
    groupReference || username || entity?.id,
  );
  const metadata = {
    name:
      normalizeString(entity?.title) ||
      username ||
      fallbackReference ||
      "Telegram Group",
    groupReference: fallbackReference,
    memberCount: 0,
    description: "",
    type:
      entity instanceof Api.Channel ||
      normalizeString(entity?.className).toLowerCase().includes("channel")
        ? "channel"
        : "group",
    username,
  };

  try {
    if (
      entity instanceof Api.Channel ||
      normalizeString(entity?.className).toLowerCase().includes("channel")
    ) {
      const fullChannel = await client.invoke(
        new Api.channels.GetFullChannel({
          channel: entity,
        }),
      );

      metadata.memberCount = Number(
        fullChannel?.fullChat?.participantsCount || 0,
      );
      metadata.description = normalizeString(fullChannel?.fullChat?.about);
    } else if (
      entity instanceof Api.Chat ||
      normalizeString(entity?.className).toLowerCase().includes("chat")
    ) {
      const fullChat = await client.invoke(
        new Api.messages.GetFullChat({
          chatId: entity.id,
        }),
      );

      metadata.memberCount = Number(fullChat?.fullChat?.participantsCount || 0);
      metadata.description = normalizeString(fullChat?.fullChat?.about);
    }
  } catch {}

  return metadata;
};

const collectTelegramDialogs = async (client) => {
  const dialogs = [];

  for await (const dialog of client.iterDialogs({
    limit: TELEGRAM_DIALOG_LIMIT,
  })) {
    dialogs.push(dialog);
  }

  return dialogs;
};

const buildMessagePayload = (message) => {
  const senderId = message?.senderId || message?.peerId || null;
  const sender =
    normalizeString(message?.postAuthor) ||
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
    const className = normalizeString(attribute?.className);
    const isFileNameAttribute =
      attribute instanceof Api.DocumentAttributeFilename ||
      className === "DocumentAttributeFilename";

    if (isFileNameAttribute && !attachmentFileName) {
      attachmentFileName = normalizeString(attribute?.fileName);
    }
  });

  const attachmentMimeType = normalizeString(document?.mimeType).toLowerCase();
  const attachmentFileExtension = attachmentFileName.includes(".")
    ? normalizeString(attachmentFileName.split(".").pop()).toLowerCase()
    : "";
  const attachmentIsPdf =
    attachmentMimeType === "application/pdf" ||
    attachmentFileExtension === "pdf";
  const isPhotoMessage = Boolean(message?.media?.photo || message?.photo);
  const hasVideoAttribute = attributes.some((attribute) => {
    const className = normalizeString(attribute?.className);
    return (
      attribute instanceof Api.DocumentAttributeVideo ||
      className === "DocumentAttributeVideo"
    );
  });
  const hasAudioAttribute = attributes.some((attribute) => {
    const className = normalizeString(attribute?.className);
    return (
      attribute instanceof Api.DocumentAttributeAudio ||
      className === "DocumentAttributeAudio"
    );
  });

  const attachmentKind = isPhotoMessage
    ? "photo"
    : document
      ? attachmentIsPdf
        ? "pdf"
        : hasVideoAttribute
          ? "video"
          : hasAudioAttribute
            ? "audio"
            : "document"
      : "";

  return {
    id: Number(message?.id || 0),
    text: normalizeString(message?.message),
    date: normalizeTelegramDateMs(message?.date),
    sender,
    views:
      typeof message?.views === "number" && Number.isFinite(message.views)
        ? message.views
        : null,
    replyToMessageId:
      typeof message?.replyTo?.replyToMsgId === "number"
        ? message.replyTo.replyToMsgId
        : null,
    attachmentKind,
    attachmentMimeType,
    attachmentFileName,
    attachmentFileExtension,
    attachmentSizeBytes:
      typeof document?.size === "number" && Number.isFinite(document.size)
        ? document.size
        : null,
    attachmentIsPdf,
    telegramFileId:
      typeof document?.id === "number" && Number.isFinite(document.id)
        ? document.id
        : null,
    telegramAccessHash:
      typeof document?.accessHash === "number" ||
      typeof document?.accessHash === "bigint"
        ? String(document.accessHash)
        : "",
    telegramFileName: attachmentFileName,
  };
};
const upsertTelegramMessagesIntoMemory = ({
  memoryDoc,
  groupMetadata,
  messages = [],
}) => {
  const groups = ensureTelegramGroupMemory(memoryDoc);
  const primaryContent = getTelegramGroupPrimaryContent(memoryDoc);
  const normalizedReference = normalizeGroupReference(
    groupMetadata.groupReference,
  );

  groups.info.name = normalizeString(groupMetadata.name);
  groups.info.groupReference = normalizedReference;
  groups.info.memberCount = Number(groupMetadata.memberCount || 0);
  groups.info.description = normalizeString(groupMetadata.description);

  let insertedCount = 0;

  (Array.isArray(messages) ? messages : []).forEach((message) => {
    const nextEntry = {
      ...message,
      groupReference: normalizedReference,
      groupTitle: groups.info.name,
      groupUsername: normalizeString(groupMetadata.username),
      groupType: normalizeString(groupMetadata.type || "group") || "group",
    };
    const bucketName = getTelegramMessageBucketName(nextEntry);
    const bucket = Array.isArray(primaryContent[bucketName])
      ? primaryContent[bucketName]
      : [];
    const messageId = Number(nextEntry.id || 0);

    if (!messageId) {
      return;
    }

    const existingIndex = bucket.findIndex(
      (entry) => Number(entry?.id || 0) === messageId,
    );

    if (existingIndex === -1) {
      bucket.push(nextEntry);
      insertedCount += 1;
    } else {
      bucket.splice(existingIndex, 1, {
        ...bucket[existingIndex],
        ...nextEntry,
      });
    }

    bucket.sort(
      (firstEntry, secondEntry) =>
        Number(secondEntry?.date || 0) - Number(firstEntry?.date || 0),
    );
    primaryContent[bucketName] = bucket;
  });

  groups.info.messageCount = listStoredTelegramMessages(
    memoryDoc,
    normalizedReference,
  ).length;
  return insertedCount;
};

const syncTelegramMessagesForUser = async (userId, options = {}) => {
  const userKey = normalizeString(userId);

  if (!userKey) {
    const error = new Error("User ID is required for Telegram sync.");
    error.status = 400;
    throw error;
  }

  if (!options.force && telegramSyncPromisesByUser.has(userKey)) {
    return telegramSyncPromisesByUser.get(userKey);
  }

  const syncPromise = (async () => {
    let client = null;

    try {
      const user = await UserModel.findById(userId).select(
        "settings.telegram.status memory",
      );

      if (!user) {
        const error = new Error("User not found.");
        error.status = 404;
        throw error;
      }

      const memoryDoc = await ensureUserMemoryDoc(user);
      if (!memoryDoc) {
        const error = new Error("Failed to access user memory.");
        error.status = 500;
        throw error;
      }

      const { config, canSync } = getTelegramSyncEligibility(user);

      if (!canSync) {
        return {
          synced: false,
          reason: "sync-disabled",
          message: "Telegram sync is not configured for this user.",
          importedCount: 0,
          scannedCount: 0,
        };
      }

      client = await ensureTelegramClient(config);
      const entity = await resolveTelegramGroupEntity(
        client,
        config.groupReference,
      );
      const groupMetadata = await getTelegramGroupMetadata(
        client,
        entity,
        config.groupReference,
      );
      const historyStartMs = normalizeTelegramDateMs(config.historyStartDate);
      const historyEndMs = normalizeTelegramDateMs(config.historyEndDate);
      const existingStoredMessages = listStoredTelegramMessages(
        memoryDoc,
        groupMetadata.groupReference,
      );
      const lastStoredMessageId = existingStoredMessages.reduce(
        (maxValue, entry) => Math.max(maxValue, Number(entry?.id || 0) || 0),
        0,
      );

      const importedMessages = [];
      let scannedCount = 0;
      let offsetId = 0;

      while (
        scannedCount < TELEGRAM_MAX_SYNC_MESSAGES &&
        importedMessages.length < TELEGRAM_MAX_SYNC_MESSAGES
      ) {
        const telegramMessages = await client.getMessages(entity, {
          limit: Math.min(
            TELEGRAM_FETCH_BATCH_SIZE,
            TELEGRAM_MAX_SYNC_MESSAGES - scannedCount,
          ),
          offsetId,
        });

        const batch = Array.isArray(telegramMessages)
          ? telegramMessages.filter(Boolean)
          : [];

        if (batch.length === 0) {
          break;
        }

        for (const telegramMessage of batch) {
          const payload = buildMessagePayload(telegramMessage);
          const messageDateMs = Number(payload.date || 0) || 0;

          scannedCount += 1;

          if (historyEndMs && messageDateMs > historyEndMs) {
            continue;
          }

          if (
            historyStartMs &&
            messageDateMs &&
            messageDateMs < historyStartMs
          ) {
            continue;
          }

          if (
            !options.force &&
            lastStoredMessageId > 0 &&
            payload.id <= lastStoredMessageId
          ) {
            continue;
          }

          if (!payload.id) {
            continue;
          }

          importedMessages.push(payload);

          if (importedMessages.length >= TELEGRAM_MAX_SYNC_MESSAGES) {
            break;
          }
        }

        offsetId = Number(batch[batch.length - 1]?.id || 0);

        if (!offsetId || batch.length < TELEGRAM_FETCH_BATCH_SIZE) {
          break;
        }
      }

      const importedCount = upsertTelegramMessagesIntoMemory({
        memoryDoc,
        groupMetadata,
        messages: importedMessages,
      });

      if (config.syncMode === "one-time") {
        user.settings.telegram.status.syncEnabled = false;
      }

      await Promise.all([memoryDoc.save(), user.save()]);

      return {
        synced: true,
        reason: importedCount > 0 ? "messages-imported" : "no-new-messages",
        message:
          importedCount > 0
            ? `Telegram sync imported ${importedCount} message(s).`
            : "Telegram sync found no new messages.",
        importedCount,
        scannedCount,
      };
    } catch (error) {
      try {
        await UserModel.findById(userId).select("_id");
      } catch {}

      throw error;
    } finally {
      if (client) {
        try {
          await client.disconnect();
        } catch {}
      }

      telegramSyncPromisesByUser.delete(userKey);
    }
  })();

  telegramSyncPromisesByUser.set(userKey, syncPromise);
  return syncPromise;
};

const syncAllTelegramUsers = async () => {
  const users = await UserModel.find({
    "settings.telegram.status.syncEnabled": true,
    "settings.telegram.status.groupReference": { $ne: "" },
    "settings.telegram.status.historyStartDate": { $ne: null },
    "settings.telegram.status.apiIdEncrypted": { $ne: "" },
    "settings.telegram.status.apiHashEncrypted": { $ne: "" },
    "settings.telegram.status.stringSessionEncrypted": { $ne: "" },
  }).select("_id");

  for (const user of users) {
    try {
      await syncTelegramMessagesForUser(user._id);
    } catch {}
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

export const sendTelegramSavedMessageForUser = async ({ user, text }) => {
  const noteText = normalizeString(text);

  if (!user || !noteText) {
    return false;
  }

  const userConfig = getUserTelegramConfig(user);
  let client = null;

  try {
    client = await ensureTelegramClient(userConfig);
    await client.sendMessage("me", {
      message: noteText,
    });
    return true;
  } catch {
    return false;
  } finally {
    if (client) {
      try {
        await client.disconnect();
      } catch {}
    }
  }
};
const respondStorageOnly = (req, res) =>
  res.status(410).json({
    message: STORAGE_ONLY_MESSAGE,
    route: req.originalUrl,
  });

const buildLiveGroupsResponse = async (user, telegramSettings) => {
  const storedSummary = buildStoredTelegramGroupSummary(user);
  const userConfig = getUserTelegramConfig(telegramSettings);
  let warning = "";

  if (!userConfig.apiId || !userConfig.apiHash || !userConfig.stringSession) {
    return {
      groups: storedSummary ? [storedSummary] : [],
      warning,
    };
  }

  let client = null;

  try {
    client = await ensureTelegramClient(userConfig);
    const dialogs = await collectTelegramDialogs(client);

    const groups = dialogs
      .map((dialog) => {
        const entity = dialog?.entity;
        const className = normalizeString(entity?.className);
        const isGroupLike =
          entity instanceof Api.Channel ||
          entity instanceof Api.Chat ||
          className === "Channel" ||
          className === "Chat" ||
          className === "ChannelForbidden" ||
          className === "ChatForbidden";

        if (!isGroupLike) {
          return null;
        }

        const username = normalizeString(entity?.username);
        const groupReference = normalizeGroupReference(
          username || entity?.id || dialog?.id,
        );

        if (!groupReference) {
          return null;
        }

        return {
          groupReference,
          title:
            normalizeString(entity?.title) ||
            normalizeString(dialog?.title) ||
            username ||
            groupReference,
          username,
          type:
            entity instanceof Api.Channel ||
            className.toLowerCase().includes("channel")
              ? "channel"
              : "group",
          storedCount:
            storedSummary?.groupReference === groupReference
              ? Number(storedSummary.storedCount || 0)
              : 0,
          latestDateMs:
            storedSummary?.groupReference === groupReference
              ? Number(storedSummary.latestDateMs || 0)
              : 0,
        };
      })
      .filter(Boolean)
      .sort(
        (firstGroup, secondGroup) =>
          Number(secondGroup.latestDateMs || 0) -
            Number(firstGroup.latestDateMs || 0) ||
          String(firstGroup.title || "").localeCompare(
            String(secondGroup.title || ""),
          ),
      );

    if (
      storedSummary &&
      !groups.some(
        (group) => group.groupReference === storedSummary.groupReference,
      )
    ) {
      groups.unshift(storedSummary);
    }

    return {
      groups,
      warning,
    };
  } catch (error) {
    warning = normalizeString(
      error?.message || "Unable to load live Telegram groups.",
    );

    return {
      groups: storedSummary ? [storedSummary] : [],
      warning,
    };
  } finally {
    if (client) {
      try {
        await client.disconnect();
      } catch {}
    }
  }
};

const handleStoredMessagesRequest = async (req, res, next) => {
  try {
    const [user, telegramSettings] = await Promise.all([
      UserModel.findById(req.authentication.userId),
      findTelegramSettings(req.authentication.userId),
    ]);

    if (!user) {
      return res.status(404).json({
        message: "User not found.",
      });
    }

    const groupReference = normalizeGroupReference(
      req.query.group ||
        req.query.groupReference ||
        telegramSettings?.status?.groupReference,
    );
    const searchQuery = normalizeString(req.query.q || req.query.search);
    const startDateMs = parseQueryDateValue(req.query.start);
    const endDateMs = parseQueryDateValue(req.query.end);
    const requestedLimit = normalizeString(req.query.limit || "100");
    const limit =
      requestedLimit.toLowerCase() === "all"
        ? "all"
        : Math.max(1, Math.min(2000, Number(requestedLimit || 100) || 100));

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

    if (startDateMs !== null && endDateMs !== null && startDateMs > endDateMs) {
      return res.status(400).json({
        message: "Telegram search start date must be before end date.",
      });
    }

    const memoryDoc = await findUserMemoryLean(user._id);
    const { canSync } = getTelegramSyncEligibility(user, telegramSettings);

    if (canSync) {
      syncTelegramMessagesForUser(user._id).catch(() => {});
    }

    const { filteredMessages, rawCount, storedCount } =
      await queryStoredTelegramMessages({
        memoryDoc,
        groupReference,
        limit,
        searchQuery,
        startDateMs,
        endDateMs,
      });
    const storedSummary = buildStoredTelegramGroupSummary(user, memoryDoc);

    return res.status(200).json({
      group: {
        id: null,
        title: storedSummary?.title || groupReference || "Telegram Group",
        username: "",
        pageUrl: normalizePageUrl(user?.settings?.telegram?.status?.pageUrl),
        groupReference,
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
      sync: buildConfigStatusPayload(telegramSettings),
    });
  } catch (error) {
    next(error);
  }
};

TelegramRouter.get("/config", checkAuth, async (req, res, next) => {
  try {
    const [user, telegramSettings, memoryDoc] = await Promise.all([
      UserModel.findById(req.authentication.userId),
      findTelegramSettings(req.authentication.userId),
      findUserMemoryLean(req.authentication.userId),
    ]);

    if (!user) {
      return res.status(404).json({
        message: "User not found.",
      });
    }

    return res.status(200).json({
      ...buildConfigStatusPayload(telegramSettings),
      storedCount: await getStoredMessageCountForUser(memoryDoc, user),
    });
  } catch (error) {
    next(error);
  }
});

TelegramRouter.get("/status", checkAuth, async (req, res, next) => {
  try {
    const [user, telegramSettings, memoryDoc] = await Promise.all([
      UserModel.findById(req.authentication.userId),
      findTelegramSettings(req.authentication.userId),
      findUserMemoryLean(req.authentication.userId),
    ]);

    if (!user) {
      return res.status(404).json({
        message: "User not found.",
      });
    }

    return res.status(200).json({
      ...buildConfigStatusPayload(telegramSettings),
      storedCount: await getStoredMessageCountForUser(memoryDoc, user),
      storedGroups: buildStoredTelegramGroupSummary(user, memoryDoc) ? 1 : 0,
    });
  } catch (error) {
    next(error);
  }
});

TelegramRouter.post("/config", checkAuth, async (req, res, next) => {
  try {
    const user = await UserModel.findById(req.authentication.userId);

    if (!user) {
      return res.status(404).json({
        message: "User not found.",
      });
    }

    const memoryDoc = await ensureUserMemoryDoc(user);

    let telegramSettings = await findTelegramSettings(req.authentication.userId);

    if (!telegramSettings) {
      telegramSettings = new TelegramSettingsModel({
        user: req.authentication.userId,
        groups: [],
        status: {},
      });
    }

    const telegramStatus = telegramSettings.status;

    const nextPageUrl = normalizePageUrl(req.body?.pageUrl);
    const nextGroupReference = normalizeGroupReference(
      req.body?.groupReference,
    );
    const nextSyncMode = normalizeTelegramSyncMode(req.body?.syncMode);
    const nextHistoryStartDate = parseDateInput(req.body?.historyStartDate);
    const nextHistoryEndDate = parseDateInput(req.body?.historyEndDate);
    const nextApiId = normalizeString(req.body?.apiId);
    const nextApiHash = normalizeString(req.body?.apiHash);
    const nextStringSession = normalizeString(req.body?.stringSession);

    if (req.body?.historyStartDate && !nextHistoryStartDate) {
      return res.status(400).json({
        message: "Telegram history start date is invalid.",
      });
    }

    if (req.body?.historyEndDate && !nextHistoryEndDate) {
      return res.status(400).json({
        message: "Telegram history end date is invalid.",
      });
    }

    if (
      nextHistoryStartDate &&
      nextHistoryEndDate &&
      nextHistoryStartDate.getTime() > nextHistoryEndDate.getTime()
    ) {
      return res.status(400).json({
        message: "Telegram history start date must be before end date.",
      });
    }

    const previousGroupReference = normalizeGroupReference(
      telegramStatus.groupReference,
    );
    const previousHistoryStartMs = normalizeTelegramDateMs(
      telegramStatus.historyStartDate,
    );
    const previousHistoryEndMs = normalizeTelegramDateMs(
      telegramStatus.historyEndDate,
    );
    const nextHistoryStartMs = normalizeTelegramDateMs(nextHistoryStartDate);
    const nextHistoryEndMs = normalizeTelegramDateMs(nextHistoryEndDate);
    const shouldResetStoredHistory =
      previousGroupReference !== nextGroupReference ||
      previousHistoryStartMs !== nextHistoryStartMs ||
      previousHistoryEndMs !== nextHistoryEndMs;

    telegramStatus.pageUrl = nextPageUrl;
    telegramStatus.groupReference = nextGroupReference;
    telegramStatus.syncMode = nextSyncMode;
    telegramStatus.historyStartDate = nextHistoryStartDate;
    telegramStatus.historyEndDate = nextHistoryEndDate;

    if (nextApiId) {
      telegramStatus.apiIdEncrypted = encryptValue(nextApiId);
    }

    if (nextApiHash) {
      telegramStatus.apiHashEncrypted = encryptValue(nextApiHash);
    }

    if (nextStringSession) {
      telegramStatus.stringSessionEncrypted = encryptValue(nextStringSession);
    }

    const hasCredentials = Boolean(
      telegramStatus.apiIdEncrypted &&
      telegramStatus.apiHashEncrypted &&
      telegramStatus.stringSessionEncrypted,
    );

    telegramStatus.syncEnabled = Boolean(
      nextGroupReference && nextHistoryStartDate && hasCredentials,
    );
    telegramStatus.updatedAt = new Date();

    if (shouldResetStoredHistory) {
      resetTelegramGroupMemory(memoryDoc);
    }

    await Promise.all([telegramSettings.save(), memoryDoc?.save?.()]);

    if (telegramStatus.syncEnabled) {
      syncTelegramMessagesForUser(user._id, {
        force: true,
      }).catch(() => {});
    }

    return res.status(200).json({
      message: telegramStatus.syncEnabled
        ? "Telegram settings saved and sync started."
        : "Telegram settings saved for this user.",
      ...buildConfigStatusPayload(telegramSettings),
      storedCount: await getStoredMessageCountForUser(memoryDoc, user),
    });
  } catch (error) {
    next(error);
  }
});
TelegramRouter.post("/auth/start", checkAuth, async (req, res, next) => {
  try {
    const apiId = Number(req.body?.apiId || 0);
    const apiHash = normalizeString(req.body?.apiHash);
    const phoneNumber = normalizeString(req.body?.phoneNumber);

    if (!apiId || !apiHash || !phoneNumber) {
      return res.status(400).json({
        message: "Please provide Telegram API ID, API Hash, and phone number.",
      });
    }

    await clearPendingTelegramAuth(req.authentication.userId);

    const client = new TelegramClient(new StringSession(""), apiId, apiHash, {
      connectionRetries: 5,
    });

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
    const phoneCode = normalizeString(req.body?.phoneCode);

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
      const telegramSettings = await persistTelegramCredentials({
        userId: req.authentication.userId,
        apiId: pending.apiId,
        apiHash: pending.apiHash,
        stringSession,
      });

      await clearPendingTelegramAuth(req.authentication.userId);

      return res.status(200).json({
        message: "Telegram connected successfully.",
        requiresPassword: false,
        ...buildConfigStatusPayload(telegramSettings),
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
      const password = normalizeString(req.body?.password);

      if (!pending) {
        return res.status(400).json({
          message: "Telegram login session expired. Start again.",
        });
      }

      if (!password) {
        return res.status(400).json({
          message: "Telegram password is required.",
        });
      }

      const passwordInfo = await pending.client.invoke(
        new Api.account.GetPassword(),
      );
      const passwordCheck = await computeCheck(passwordInfo, password);

      await pending.client.invoke(
        new Api.auth.CheckPassword({
          password: passwordCheck,
        }),
      );

      const stringSession = pending.client.session.save();
      const telegramSettings = await persistTelegramCredentials({
        userId: req.authentication.userId,
        apiId: pending.apiId,
        apiHash: pending.apiHash,
        stringSession,
      });

      await clearPendingTelegramAuth(req.authentication.userId);

      return res.status(200).json({
        message: "Telegram connected successfully.",
        requiresPassword: false,
        ...buildConfigStatusPayload(telegramSettings),
      });
    } catch (error) {
      next(error);
    }
  },
);

TelegramRouter.get("/groups", checkAuth, async (req, res, next) => {
  try {
    const [user, telegramSettings] = await Promise.all([
      UserModel.findById(req.authentication.userId),
      findTelegramSettings(req.authentication.userId),
    ]);

    if (!user) {
      return res.status(404).json({
        message: "User not found.",
      });
    }

    const result = await buildLiveGroupsResponse(user, telegramSettings);
    return res.status(200).json(result);
  } catch (error) {
    next(error);
  }
});

TelegramRouter.get("/stored-groups", checkAuth, async (req, res, next) => {
  try {
    const user = await UserModel.findById(req.authentication.userId).select(
      "settings.telegram.status memory",
    );

    if (!user) {
      return res.status(404).json({
        message: "User not found.",
      });
    }

    const memoryDoc = await findUserMemoryLean(user._id);
    const summary = buildStoredTelegramGroupSummary(user, memoryDoc);

    return res.status(200).json({
      groups: summary ? [summary] : [],
    });
  } catch (error) {
    next(error);
  }
});

TelegramRouter.delete(
  "/stored-groups/:groupReference",
  checkAuth,
  async (req, res, next) => {
    try {
      const user = await UserModel.findById(req.authentication.userId).select(
        "settings.telegram.status memory",
      );

      if (!user) {
        return res.status(404).json({
          message: "User not found.",
        });
      }

      const memoryDoc = await ensureUserMemoryDoc(user);

      const normalizedReference = normalizeGroupReference(
        req.params.groupReference,
      );
      const currentSummary = buildStoredTelegramGroupSummary(user, memoryDoc);

      if (!normalizedReference) {
        return res.status(400).json({
          message: "Stored conversation reference is required.",
        });
      }

      const deletedCount =
        currentSummary?.groupReference === normalizedReference
          ? Number(currentSummary.storedCount || 0)
          : 0;

      if (deletedCount > 0) {
        resetTelegramGroupMemory(memoryDoc);
        await memoryDoc.save();
      }

      return res.status(200).json({
        message: "Stored conversation deleted.",
        groupReference: normalizedReference,
        deletedCount,
        groups: [],
      });
    } catch (error) {
      next(error);
    }
  },
);

TelegramRouter.get("/group-messages", checkAuth, handleStoredMessagesRequest);
TelegramRouter.get(
  "/stored-group-messages",
  checkAuth,
  handleStoredMessagesRequest,
);

TelegramRouter.use("/stored-group-pdfs", checkAuth, respondStorageOnly);
TelegramRouter.use("/storage", checkAuth, respondStorageOnly);
TelegramRouter.use("/ai", checkAuth, respondStorageOnly);
TelegramRouter.use("/important-messages", checkAuth, respondStorageOnly);
TelegramRouter.use("/important-message-concept", checkAuth, respondStorageOnly);
TelegramRouter.use("/send-note", checkAuth, respondStorageOnly);

export default TelegramRouter;
