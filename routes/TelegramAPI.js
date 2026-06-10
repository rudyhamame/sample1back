import express from "express";
import crypto from "crypto";
import "dotenv/config";
import OpenAI from "openai";
import checkAuth from "../check-auth.js";
import UserModel from "../compat/UserModel.js";
import {
  findAiSettingsLean,
  ensureUserMemoryDoc,
  findTelegramSettings,
  findUserMemoryLean,
} from "../services/userData.js";
import TelegramSettingsModel from "../compat/TelegramSettingsModel.js";
import { Api, TelegramClient } from "telegram";
import { StringSession } from "telegram/sessions/index.js";
import { computeCheck } from "telegram/Password.js";
import { LogLevel } from "telegram/extensions/Logger.js";
import {
  flattenMemoryCoursesForPlanner,
} from "./user/helpers/studyPlannerService.js";
import TelegramStoredMessageModel from "../models/TelegramStoredMessage.js";

const TelegramRouter = express.Router();
const TELEGRAM_ADMIN_USERNAME = "rudyhamame";

const getNormalizedTelegramAdminUsername = (user = {}) =>
  String(
    user?.username ||
      user?.auth?.username ||
      user?.identity?.atSignup?.username ||
      user?.identity?.personal?.username ||
      "",
  )
    .trim()
    .toLowerCase();

const ensureTelegramAdmin = async (req, res, next) => {
  try {
    const authenticatedUserId = String(
      req?.authentication?.userId || req?.authentication?.id || "",
    ).trim();
    if (!authenticatedUserId) {
      return res.status(401).json({
        message: "Missing authenticated user.",
        reason: "missing_authenticated_user",
      });
    }

    const authenticatedUser = await UserModel.findById(authenticatedUserId)
      .select("username auth.username identity.atSignup.username identity.personal.username")
      .lean();
    const normalizedUsername =
      getNormalizedTelegramAdminUsername(authenticatedUser);

    if (normalizedUsername !== TELEGRAM_ADMIN_USERNAME) {
      return res.status(403).json({
        message: "Telegram control is restricted.",
        reason: "telegram_admin_only",
      });
    }

    next();
  } catch (error) {
    next(error);
  }
};

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
  "Telegram API is storage-only now. It stores Telegram group info in user memory and message bodies in dedicated Telegram storage.";
const DEFAULT_GROQ_MODEL =
  process.env.GROQ_MODEL ||
  process.env.OPENAI_MODEL ||
  process.env.OPENAI_OFFICIAL_MODEL ||
  "llama-3.3-70b-versatile";
const DEFAULT_OPENAI_MODEL =
  process.env.OPENAI_OFFICIAL_MODEL ||
  process.env.OPENAI_MODEL ||
  process.env.GROQ_MODEL ||
  "gpt-5-mini";
const DEFAULT_KIMI_MODEL =
  process.env.KIMI_MODEL || process.env.MOONSHOT_MODEL || "kimi-k2.5";
const VALID_AI_PROVIDERS = ["openai", "groq", "gemini", "kimi"];
const DEFAULT_NO_PROVIDER_MESSAGE =
  "Missing GROQ_API_KEY, GEMINI_API_KEY, MOONSHOT_API_KEY, and OPENAI_API_KEY in the backend environment.";

const pendingTelegramAuthByUser = new Map();
const telegramSyncPromisesByUser = new Map();
const telegramSyncStatusByUser = new Map();
const telegramSyncControlsByUser = new Map();
const telegramProcessLoadersByUser = new Map();
const telegramFastResponseCache = new Map();
const telegramStorageSnapshotCache = new Map();
const telegramStorageSnapshotInFlight = new Map();
const TELEGRAM_FAST_CACHE_TTL_MS = 15000;
const TELEGRAM_STORAGE_SNAPSHOT_TTL_MS = 12000;
let telegramSyncWorkerStarted = false;
let telegramSyncWorkerIntervalId = null;
const sleepMs = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

TelegramRouter.use(checkAuth);
TelegramRouter.use(
  [
    "/config",
    "/status",
    "/auth",
    "/groups",
    "/storage/context",
    "/stored-groups/:groupReference/sync",
    "/stored-groups/:groupReference/control",
    "/stored-groups/:groupReference/backfill-photos",
    "/important-messages",
    "/important-message-concept",
    "/send-note",
  ],
  ensureTelegramAdmin,
);

const getTelegramSyncStatus = (userId) =>
  telegramSyncStatusByUser.get(String(userId || "").trim()) || {
    running: false,
    scannedCount: 0,
    importedCount: 0,
    reason: "",
    synced: false,
  };

const setTelegramSyncStatus = (userId, patch = {}) => {
  const userKey = String(userId || "").trim();
  if (!userKey) {
    return;
  }
  const currentValue = getTelegramSyncStatus(userKey);
  telegramSyncStatusByUser.set(userKey, {
    ...currentValue,
    ...patch,
  });
  try {
    clearTelegramFastCachedResponsesForUser(userKey);
  } catch {}
};
const getTelegramProcessLoaders = (userId) => {
  const userKey = String(userId || "").trim();
  const currentValue =
    telegramProcessLoadersByUser.get(userKey) &&
    typeof telegramProcessLoadersByUser.get(userKey) === "object"
      ? telegramProcessLoadersByUser.get(userKey)
      : {};
  const syncStatus = getTelegramSyncStatus(userKey);
  return {
    config: Boolean(currentValue.config),
    groupsLive: Boolean(currentValue.groupsLive),
    storedGroups: Boolean(currentValue.storedGroups),
    deleteGroup: Boolean(currentValue.deleteGroup),
    control: Boolean(currentValue.control),
    backfillPhotos: Boolean(currentValue.backfillPhotos),
    sync: Boolean(syncStatus?.running) || Boolean(currentValue.sync),
  };
};
const setTelegramProcessLoader = (userId, key, active) => {
  const userKey = String(userId || "").trim();
  const loaderKey = normalizeString(key);
  if (!userKey || !loaderKey) {
    return;
  }
  const currentLoaders = getTelegramProcessLoaders(userKey);
  telegramProcessLoadersByUser.set(userKey, {
    ...currentLoaders,
    [loaderKey]: Boolean(active),
  });
  try {
    clearTelegramFastCachedResponsesForUser(userKey);
  } catch {}
};
const getTelegramSyncControl = (userId) =>
  telegramSyncControlsByUser.get(String(userId || "").trim()) || "play";
const setTelegramSyncControl = (userId, control = "play") => {
  const userKey = String(userId || "").trim();
  if (!userKey) {
    return "play";
  }
  const normalized = normalizeString(control).toLowerCase();
  const nextControl = ["play", "pause", "stop"].includes(normalized)
    ? normalized
    : "play";
  telegramSyncControlsByUser.set(userKey, nextControl);
  return nextControl;
};

const getTelegramFastCacheKey = (userId = "", routeKey = "") =>
  `${String(userId || "").trim()}::${String(routeKey || "").trim()}`;

const getTelegramFastCachedResponse = (userId = "", routeKey = "") => {
  const key = getTelegramFastCacheKey(userId, routeKey);
  const entry = telegramFastResponseCache.get(key);
  if (!entry || typeof entry !== "object") {
    return null;
  }
  const createdAt = Number(entry.createdAt || 0);
  if (!createdAt || Date.now() - createdAt > TELEGRAM_FAST_CACHE_TTL_MS) {
    telegramFastResponseCache.delete(key);
    return null;
  }
  return entry.payload && typeof entry.payload === "object" ? entry.payload : null;
};

const setTelegramFastCachedResponse = (userId = "", routeKey = "", payload = {}) => {
  const key = getTelegramFastCacheKey(userId, routeKey);
  telegramFastResponseCache.set(key, {
    createdAt: Date.now(),
    payload: payload && typeof payload === "object" ? payload : {},
  });
};

const clearTelegramFastCachedResponsesForUser = (userId = "") => {
  const normalizedUserId = String(userId || "").trim();
  if (!normalizedUserId) {
    return;
  }
  for (const key of telegramFastResponseCache.keys()) {
    if (key.startsWith(`${normalizedUserId}::`)) {
      telegramFastResponseCache.delete(key);
    }
  }
  for (const key of telegramStorageSnapshotCache.keys()) {
    if (key.startsWith(`${normalizedUserId}::`)) {
      telegramStorageSnapshotCache.delete(key);
    }
  }
};

const getPendingTelegramAuth = (userId) =>
  pendingTelegramAuthByUser.get(String(userId || "").trim()) || null;

const setPendingTelegramAuth = (userId, value) => {
  const normalizedUserId = String(userId || "").trim();

  if (!normalizedUserId) {
    return;
  }

  pendingTelegramAuthByUser.set(normalizedUserId, value);
};

const clearPendingTelegramAuth = async (userId) => {
  const normalizedUserId = String(userId || "").trim();

  if (!normalizedUserId) {
    return;
  }

  const pending = pendingTelegramAuthByUser.get(normalizedUserId);
  pendingTelegramAuthByUser.delete(normalizedUserId);

  if (pending?.client && typeof pending.client.disconnect === "function") {
    try {
      await pending.client.disconnect();
    } catch {}
  }
};

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
const normalizeTelegramStoreContent = (value = {}) => {
  const source = value && typeof value === "object" ? value : {};
  return {
    texts: true,
    photos: true,
    videos: true,
    audios: true,
    documents: true,
    pinnedOnly: Boolean(source.pinnedOnly),
  };
};

const getGroqClient = () => {
  const apiKey = String(process.env.GROQ_API_KEY || "").trim();

  if (!apiKey) {
    return null;
  }

  const baseURL = String(process.env.GROQ_BASE_URL || "").trim();

  return new OpenAI({
    apiKey,
    ...(baseURL ? { baseURL } : {}),
  });
};

const getOpenAIClient = () => {
  const apiKey = String(
    process.env.OPENAI_API_KEY || process.env.OPENAI_OFFICIAL_API_KEY || "",
  ).trim();

  if (!apiKey) {
    return null;
  }

  const baseURL = String(process.env.OPENAI_BASE_URL || "").trim();

  return new OpenAI({
    apiKey,
    ...(baseURL ? { baseURL } : {}),
  });
};

const getKimiClient = () => {
  const apiKey = String(
    process.env.MOONSHOT_API_KEY || process.env.KIMI_API_KEY || "",
  ).trim();

  if (!apiKey) {
    return null;
  }

  const baseURL =
    String(process.env.MOONSHOT_BASE_URL || process.env.KIMI_BASE_URL || "").trim() ||
    "https://api.moonshot.ai/v1";

  return new OpenAI({
    apiKey,
    baseURL,
  });
};

const getGeminiApiKey = () => String(process.env.GEMINI_API_KEY || "").trim();
const getConfiguredAiProviders = (
  groqClient = null,
  openAiClient = null,
  kimiClient = null,
) => {
  const providers = [];

  if (groqClient || getGroqClient()) {
    providers.push("groq");
  }

  if (getGeminiApiKey()) {
    providers.push("gemini");
  }

  if (kimiClient || getKimiClient()) {
    providers.push("kimi");
  }

  if (openAiClient || getOpenAIClient()) {
    providers.push("openai");
  }

  return providers;
};
const getDefaultAiProvider = (
  groqClient = null,
  openAiClient = null,
  kimiClient = null,
) => getConfiguredAiProviders(groqClient, openAiClient, kimiClient)[0] || "openai";
const normalizeAiProvider = (value = "", fallbackProvider = "openai") => {
  const normalizedValue = String(value || "")
    .trim()
    .toLowerCase();

  return VALID_AI_PROVIDERS.includes(normalizedValue)
    ? normalizedValue
    : fallbackProvider;
};
const hasExplicitAiProviderSelection = (value = "") =>
  VALID_AI_PROVIDERS.includes(String(value || "").trim().toLowerCase());
const isProviderConfigured = (provider, groqClient, openAiClient, kimiClient) => {
  if (provider === "groq") {
    return Boolean(groqClient);
  }

  if (provider === "openai") {
    return Boolean(openAiClient);
  }

  if (provider === "kimi") {
    return Boolean(kimiClient);
  }

  if (provider === "gemini") {
    return Boolean(getGeminiApiKey());
  }

  return false;
};
const getMissingProviderConfigurationMessage = (provider) => {
  if (provider === "groq") {
    return "Missing GROQ_API_KEY in the backend environment.";
  }

  if (provider === "gemini") {
    return "Missing GEMINI_API_KEY in the backend environment.";
  }

  if (provider === "kimi") {
    return "Missing MOONSHOT_API_KEY in the backend environment.";
  }

  return "Missing OPENAI_API_KEY in the backend environment.";
};
const isAiQuotaError = (error) => {
  const message = String(error?.message || "").toLowerCase();
  const status = Number(error?.status || error?.code || 0);

  return (
    status === 429 ||
    message.includes("quota") ||
    message.includes("billing") ||
    message.includes("rate limit")
  );
};
const buildAiProviderFailureMessage = (
  providerErrors = [],
  fallbackMessage = "Unable to complete the AI request.",
) => {
  const firstQuotaError = providerErrors.find(({ message }) =>
    isAiQuotaError({ message }),
  );

  if (firstQuotaError) {
    return `The ${String(firstQuotaError.provider || "selected").toUpperCase()} AI provider is out of quota or rate-limited. Add quota or configure another provider key.`;
  }

  return providerErrors[0]?.message || fallbackMessage;
};

const getPreferredAiProvider = (
  userPreferredProvider = "",
  groqClient = null,
  openAiClient = null,
  kimiClient = null,
) => {
  return normalizeAiProvider(
    userPreferredProvider || process.env.APP_AI_PROVIDER || "",
    getDefaultAiProvider(groqClient, openAiClient, kimiClient),
  );
};

const createGeminiResponse = async ({
  model = process.env.GEMINI_MODEL || "gemini-2.5-flash",
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
          temperature: 0.2,
        },
      }),
    },
  );

  const payload = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(
      payload?.error?.message || "Gemini lecture conceptualization failed.",
    );
  }

  return (Array.isArray(payload?.candidates) ? payload.candidates : [])
    .flatMap((candidate) =>
      Array.isArray(candidate?.content?.parts) ? candidate.content.parts : [],
    )
    .map((part) => String(part?.text || "").trim())
    .filter(Boolean)
    .join("\n")
    .trim();
};

const createOpenAiResponse = async ({
  client,
  model = DEFAULT_OPENAI_MODEL,
  provider = "openai",
  instructions = "",
  input = "",
}) => {
  if (!client) {
    throw new Error("Missing OPENAI_API_KEY in the backend environment.");
  }

  if (provider === "kimi") {
    const completion = await client.chat.completions.create({
      model,
      messages: [
        ...(String(instructions || "").trim()
          ? [{ role: "system", content: String(instructions || "") }]
          : []),
        { role: "user", content: String(input || "") },
      ],
    });

    return String(completion?.choices?.[0]?.message?.content || "").trim();
  }

  const response = await client.responses.create({
    model,
    instructions: String(instructions || ""),
    input: String(input || ""),
  });

  return String(response?.output_text || "").trim();
};

const getOpenAiCompatibleClient = (
  provider,
  groqClient,
  openAiClient,
  kimiClient,
) => {
  if (provider === "groq") {
    return groqClient;
  }

  if (provider === "kimi") {
    return kimiClient;
  }

  if (provider === "openai") {
    return openAiClient;
  }

  return null;
};

const getOpenAiCompatibleModel = (provider) =>
  provider === "groq"
    ? DEFAULT_GROQ_MODEL
    : provider === "kimi"
      ? DEFAULT_KIMI_MODEL
      : DEFAULT_OPENAI_MODEL;

const buildProviderAttemptOrder = (
  preferredProvider,
  groqClient,
  openAiClient,
  kimiClient,
  { allowFallback = true } = {},
) => {
  const availableProviders = [];

  if (
    isProviderConfigured(preferredProvider, groqClient, openAiClient, kimiClient)
  ) {
    availableProviders.push(preferredProvider);
  }

  if (!allowFallback) {
    return availableProviders;
  }

  if (groqClient && !availableProviders.includes("groq")) {
    availableProviders.push("groq");
  }

  if (openAiClient && !availableProviders.includes("openai")) {
    availableProviders.push("openai");
  }

  if (kimiClient && !availableProviders.includes("kimi")) {
    availableProviders.push("kimi");
  }

  if (getGeminiApiKey() && !availableProviders.includes("gemini")) {
    availableProviders.push("gemini");
  }

  return availableProviders;
};

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

const withFastTimeout = (promise, timeoutMs = 4000, message = "Timed out.") =>
  runWithTimeout(promise, timeoutMs, message);
const TELEGRAM_BOOTSTRAP_TIMEOUT_MS = Math.max(
  5000,
  Number.parseInt(String(process.env.TELEGRAM_BOOTSTRAP_TIMEOUT_MS || "15000").trim(), 10) ||
    15000,
);

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
    storeContent: normalizeTelegramStoreContent(status.storeContent),
    apiId: Number.isFinite(apiId) && apiId > 0 ? apiId : 0,
    apiHash: decryptValue(status.apiHashEncrypted),
    stringSession: decryptValue(status.stringSessionEncrypted),
  };
};

const getTelegramSyncEligibility = (
  user,
  telegramSettings,
  options = {},
) => {
  const config = getUserTelegramConfig(telegramSettings);
  const requireSyncEnabled = options.requireSyncEnabled !== false;
  const canSync = Boolean(
    (!requireSyncEnabled || config.syncEnabled) &&
    config.groupReference &&
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
      autoReconnect: false,
      connectionRetries: 1,
      requestRetries: 1,
      retryDelay: 500,
      timeout: TELEGRAM_CONNECT_TIMEOUT_MS,
    },
  );

  client.setLogLevel(LogLevel.NONE);
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
    latestMessageDateMs: 0,
  },
  messages: [],
});

const ensureTelegramGroupMemory = (memoryDoc) => {
  if (!memoryDoc) {
    return buildEmptyTelegramGroupMemory();
  }

  memoryDoc.MOA = memoryDoc.MOA || {};
  if (!memoryDoc.MOA.telegram || typeof memoryDoc.MOA.telegram !== "object") {
    memoryDoc.MOA.telegram = {};
  }

  if (!Array.isArray(memoryDoc.MOA.telegram.groups)) {
    const legacyGroups =
      memoryDoc.MOA.telegram.groups &&
      typeof memoryDoc.MOA.telegram.groups === "object"
        ? memoryDoc.MOA.telegram.groups
        : buildEmptyTelegramGroupMemory();
    memoryDoc.MOA.telegram.groups = [legacyGroups];
  }
  if (memoryDoc.MOA.telegram.groups.length === 0) {
    memoryDoc.MOA.telegram.groups.push(buildEmptyTelegramGroupMemory());
  }

  const groups =
    memoryDoc.MOA.telegram.groups[0] &&
    typeof memoryDoc.MOA.telegram.groups[0] === "object"
      ? memoryDoc.MOA.telegram.groups[0]
      : buildEmptyTelegramGroupMemory();
  memoryDoc.MOA.telegram.groups[0] = groups;

  if (!groups.info || typeof groups.info !== "object") {
    groups.info = buildEmptyTelegramGroupMemory().info;
  }

  if (!Array.isArray(groups.messages)) {
    groups.messages = [];
  }
  groups.messages = groups.messages
    .map((messageEntry) => {
      const source = messageEntry && typeof messageEntry === "object" ? messageEntry : {};
      const trace =
        source?.messageTrace && typeof source.messageTrace === "object"
          ? source.messageTrace
          : {};
      return {
        messageTrace: {
          text: normalizeString(trace?.text),
          photos: Array.isArray(trace?.photos) ? trace.photos : [],
          videos: Array.isArray(trace?.videos) ? trace.videos : [],
          audios: Array.isArray(trace?.audios) ? trace.audios : [],
          documents: Array.isArray(trace?.documents) ? trace.documents : [],
        },
        keywords_raw: Array.isArray(source?.keywords_raw)
          ? source.keywords_raw.map((entry) => String(entry || "").trim()).filter(Boolean)
          : [],
        concepts: Array.isArray(source?.concepts) ? source.concepts : [],
      };
    })
    .filter((entry) => entry && typeof entry === "object");
  return groups;
};

const resetTelegramGroupMemory = (memoryDoc) => {
  if (!memoryDoc) {
    return buildEmptyTelegramGroupMemory();
  }

  memoryDoc.MOA = memoryDoc.MOA || {};
  memoryDoc.MOA.telegram = memoryDoc.MOA.telegram || {};
  memoryDoc.MOA.telegram.groups = [buildEmptyTelegramGroupMemory()];
  return memoryDoc.MOA.telegram.groups[0];
};

const normalizeTelegramGroupsForStorage = (groups = []) => {
  const source = Array.isArray(groups) ? groups : [];
  const seenReferences = new Set();
  const cleaned = [];

  source.forEach((entry) => {
    const groupEntry =
      entry && typeof entry === "object"
        ? JSON.parse(JSON.stringify(entry))
        : buildEmptyTelegramGroupMemory();
    const info =
      groupEntry?.info && typeof groupEntry.info === "object" ? groupEntry.info : {};
    const reference = normalizeGroupReference(info?.groupReference);
    const name = normalizeString(info?.name);
    const buckets = getTelegramGroupContentBuckets(groupEntry);
    const hasContent =
      buckets.texts.length > 0 ||
      buckets.photos.length > 0 ||
      buckets.images.length > 0 ||
      buckets.videos.length > 0 ||
      buckets.audios.length > 0 ||
      buckets.documents.length > 0;

    if (!reference) {
      return;
    }

    if (seenReferences.has(reference)) {
      return;
    }
    seenReferences.add(reference);
    groupEntry.info = {
      ...info,
      groupReference: reference,
      name: name || reference,
    };
    cleaned.push(groupEntry);
  });

  return cleaned;
};

const coerceTelegramGroupsArray = (value) =>
  normalizeTelegramGroupsForStorage(
    Array.isArray(value) ? value : value && typeof value === "object" ? [value] : [],
  );

const listTelegramGroupMemoryEntries = (memoryDoc) => {
  const telegramMemory =
    memoryDoc?.MOA?.telegram && typeof memoryDoc.MOA.telegram === "object"
      ? memoryDoc.MOA.telegram
      : {};
  const rawGroups = Array.isArray(telegramMemory.groups) ? telegramMemory.groups : [];

  return normalizeTelegramGroupsForStorage(
    rawGroups
    .map((entry) => (entry && typeof entry === "object" ? entry : null))
    .filter(Boolean),
  );
};

const getTelegramGroupContentBuckets = (groupEntry = {}) => {
  const sourceMessages = Array.isArray(groupEntry?.messages)
    ? groupEntry.messages
    : groupEntry?.messages && typeof groupEntry.messages === "object"
      ? [groupEntry.messages]
      : [];
  const texts = [];
  const photos = [];
  const videos = [];
  const audios = [];
  const documents = [];
  const keywords = [];
  const concepts = [];
  sourceMessages.forEach((messageEntry) => {
    const content = messageEntry && typeof messageEntry === "object" ? messageEntry : {};
    const meta =
      content?.messageMeta && typeof content.messageMeta === "object"
        ? content.messageMeta
        : {};
    const trace =
      content?.messageTrace && typeof content.messageTrace === "object"
        ? content.messageTrace
        : content;
    const textValue = normalizeString(trace?.text);
    if (textValue) {
      texts.push({
        id: Number(meta?.id || 0) || 0,
        text: textValue,
        date: Number(meta?.date || 0) || 0,
        sender: normalizeString(meta?.sender),
        groupReference: normalizeGroupReference(
          meta?.groupReference ||
            groupEntry?.info?.groupReference,
        ),
        attachmentKind: "text",
      });
    }
    photos.push(
      ...toArray(trace?.photos).map((entry) => ({
        ...entry,
        id: Number(entry?.id || meta?.id || 0) || 0,
        date: Number(entry?.date || meta?.date || 0) || 0,
        sender: normalizeString(entry?.sender || meta?.sender),
        groupReference: normalizeGroupReference(
          entry?.groupReference || meta?.groupReference || groupEntry?.info?.groupReference,
        ),
      })),
    );
    videos.push(
      ...toArray(trace?.videos).map((entry) => ({
        ...entry,
        id: Number(entry?.id || meta?.id || 0) || 0,
        date: Number(entry?.date || meta?.date || 0) || 0,
        sender: normalizeString(entry?.sender || meta?.sender),
        groupReference: normalizeGroupReference(
          entry?.groupReference || meta?.groupReference || groupEntry?.info?.groupReference,
        ),
      })),
    );
    audios.push(
      ...toArray(trace?.audios).map((entry) => ({
        ...entry,
        id: Number(entry?.id || meta?.id || 0) || 0,
        date: Number(entry?.date || meta?.date || 0) || 0,
        sender: normalizeString(entry?.sender || meta?.sender),
        groupReference: normalizeGroupReference(
          entry?.groupReference || meta?.groupReference || groupEntry?.info?.groupReference,
        ),
      })),
    );
    documents.push(
      ...toArray(trace?.documents).map((entry) => ({
        ...entry,
        id: Number(entry?.id || meta?.id || 0) || 0,
        date: Number(entry?.date || meta?.date || 0) || 0,
        sender: normalizeString(entry?.sender || meta?.sender),
        groupReference: normalizeGroupReference(
          entry?.groupReference || meta?.groupReference || groupEntry?.info?.groupReference,
        ),
      })),
    );
    keywords.push(
      ...toArray(content?.keywords_raw)
        .map((entry) => String(entry || "").trim())
        .filter(Boolean),
    );
    concepts.push(...toArray(content?.concepts));
  });
  return {
    texts,
    photos,
    images: [],
    videos,
    audios,
    documents,
    keywords_raw: Array.from(new Set(keywords)),
    concepts,
  };
};

const countTelegramGroupBucketMessages = (groupEntry = {}) => {
  const buckets = getTelegramGroupContentBuckets(groupEntry);
  return (
    buckets.texts.length +
    buckets.photos.length +
    buckets.images.length +
    buckets.videos.length +
    buckets.audios.length +
    buckets.documents.length
  );
};

const buildGroupReferenceFromSchemaEntry = (groupEntry = {}) => {
  const info = groupEntry?.info && typeof groupEntry.info === "object" ? groupEntry.info : {};
  const normalizedReference = normalizeGroupReference(info?.groupReference);
  if (normalizedReference) {
    return normalizedReference;
  }
  const normalizedName = normalizeGroupReference(info?.name);
  if (normalizedName) {
    return normalizedName;
  }
  return "";
};

const buildStoredTelegramGroupsFromSchema = (user, memoryDoc, telegramSettings = null) => {
  const groupEntries = listTelegramGroupMemoryEntries(memoryDoc);
  const telegramConfig = telegramSettings ? getUserTelegramConfig(telegramSettings) : null;
  const syncedGroupReference =
    telegramConfig?.syncEnabled && telegramConfig?.groupReference
      ? normalizeGroupReference(telegramConfig.groupReference)
      : "";

  return groupEntries
    .map((groupEntry, index) => {
      const info = groupEntry?.info && typeof groupEntry.info === "object" ? groupEntry.info : {};
      const buckets = getTelegramGroupContentBuckets(groupEntry);
      const groupReference = buildGroupReferenceFromSchemaEntry(groupEntry);
      if (!groupReference) {
        return null;
      }
      const allEntries = [
        ...buckets.texts,
        ...buckets.photos,
        ...buckets.images,
        ...buckets.videos,
        ...buckets.audios,
        ...buckets.documents,
      ].filter(Boolean);
      const latestDateMs = allEntries.reduce(
        (maxDate, entry) => Math.max(maxDate, Number(entry?.date || 0) || 0),
        0,
      );

      return {
        id: null,
        rowKey: `group-${index + 1}-${groupReference}`,
        title: normalizeString(info?.name) || groupReference || "Telegram Group",
        username: "",
        groupReference,
        pageUrl: normalizePageUrl(info?.pageUrl || telegramConfig?.pageUrl),
        memberCount: Number(info?.memberCount || 0),
        description: normalizeString(info?.description),
        storedCount: Number(info?.messageCount || 0) || 0,
        latestDateMs: Math.max(
          Number(info?.latestMessageDateMs || 0) || 0,
          latestDateMs,
        ),
        type: "group",
        synced: syncedGroupReference === groupReference,
      };
    })
    .filter(Boolean)
    .sort(
      (left, right) =>
        Number(right?.latestDateMs || 0) - Number(left?.latestDateMs || 0) ||
        String(left?.title || "").localeCompare(String(right?.title || "")),
    );
};

const listStoredTelegramGroupsFast = (user, memoryDoc, telegramSettings = null) => {
  const groupEntries = listTelegramGroupMemoryEntries(memoryDoc);
  const telegramConfig = telegramSettings ? getUserTelegramConfig(telegramSettings) : null;
  const syncedGroupReference =
    telegramConfig?.syncEnabled && telegramConfig?.groupReference
      ? normalizeGroupReference(telegramConfig.groupReference)
      : "";

  const groups = groupEntries.map((groupEntry, index) => {
    const info = groupEntry?.info && typeof groupEntry.info === "object" ? groupEntry.info : {};
    const groupReference = buildGroupReferenceFromSchemaEntry(groupEntry);
    if (!groupReference) {
      return null;
    }
    return {
      id: null,
      rowKey: `group-${index + 1}-${groupReference}`,
      title: normalizeString(info?.name) || groupReference || "Telegram Group",
      username: "",
      groupReference,
      pageUrl: normalizePageUrl(info?.pageUrl || telegramConfig?.pageUrl),
      memberCount: Number(info?.memberCount || 0),
      description: normalizeString(info?.description),
      storedCount: Number(info?.messageCount || 0) || 0,
      latestDateMs: Number(info?.latestMessageDateMs || 0) || 0,
      type: "group",
      synced: syncedGroupReference === groupReference,
    };
  }).filter(Boolean);
  return groups;
};

const ensureTelegramPredictionStore = (memoryDoc) => {
  if (!memoryDoc) {
    return {
      lectures: { saved: [], rejected: [], accepted: [] },
    };
  }

  memoryDoc.__telegramPredictions =
    memoryDoc.__telegramPredictions &&
    typeof memoryDoc.__telegramPredictions === "object"
      ? memoryDoc.__telegramPredictions
      : {};

  const predictions = memoryDoc.__telegramPredictions;
  predictions.lectures =
    predictions.lectures && typeof predictions.lectures === "object"
      ? predictions.lectures
      : {};

  ["saved", "rejected", "accepted"].forEach((bucketName) => {
    predictions.lectures[bucketName] = Array.isArray(
      predictions.lectures[bucketName],
    )
      ? predictions.lectures[bucketName]
      : [];
  });

  return predictions;
};

const buildLecturePredictionScopeKey = ({
  allGroups = false,
  groupReference = "",
  courseIdentity = "",
  courseName = "",
  courseComponent = "",
} = {}) => {
  const normalizedGroupScope = allGroups
    ? "__all_groups__"
    : normalizeGroupReference(groupReference) || "__no_group__";
  const normalizedCourseIdentity = normalizeLecturePredictionCourseIdentity({
    courseIdentity,
    courseName,
    courseComponent,
  });

  return `${normalizedGroupScope}::${normalizedCourseIdentity}`;
};

function normalizeLecturePredictionCourseIdentity({
  courseIdentity = "",
  courseName = "",
  courseComponent = "",
} = {}) {
  return (
    normalizeString(courseIdentity) ||
    `${normalizeString(courseName)}::${normalizeString(courseComponent) || "-"}`
  );
}

const isAcrossAllLectureGroupsScope = (scope = {}) =>
  Boolean(scope?.acrossAllGroups);

const matchesStoredLecturePredictionScope = (entry = {}, scope = {}) => {
  const normalizedScopeKey = normalizeString(entry?.scopeKey);

  if (!normalizedScopeKey) {
    return false;
  }

  if (isAcrossAllLectureGroupsScope(scope)) {
    const normalizedCourseIdentity = normalizeLecturePredictionCourseIdentity(scope);
    return (
      normalizedCourseIdentity &&
      normalizedScopeKey.endsWith(`::${normalizedCourseIdentity}`)
    );
  }

  return normalizedScopeKey === buildLecturePredictionScopeKey(scope);
};

const listStoredLecturePredictions = (memoryDoc, scope = {}, bucketName = "saved") => {
  const predictions = ensureTelegramPredictionStore(memoryDoc);

  return (Array.isArray(predictions?.lectures?.[bucketName])
    ? predictions.lectures[bucketName]
    : []
  ).filter(
    (entry) => matchesStoredLecturePredictionScope(entry, scope),
  );
};

const replaceStoredLecturePredictions = ({
  memoryDoc,
  scope = {},
  bucketName = "saved",
  lectures = [],
}) => {
  const predictions = ensureTelegramPredictionStore(memoryDoc);
  const scopeKey = buildLecturePredictionScopeKey(scope);
  const bucket = Array.isArray(predictions?.lectures?.[bucketName])
    ? predictions.lectures[bucketName]
    : [];
  const scopedLectures = (Array.isArray(lectures) ? lectures : []).map((lecture) => ({
    ...lecture,
    scopeKey,
  }));

  predictions.lectures[bucketName] = [
    ...bucket.filter((entry) => normalizeString(entry?.scopeKey) !== scopeKey),
    ...scopedLectures,
  ];

  return scopedLectures;
};

const upsertStoredLecturePredictions = ({
  memoryDoc,
  scope = {},
  bucketName = "saved",
  lectures = [],
}) => {
  const existing = listStoredLecturePredictions(memoryDoc, scope, bucketName);
  const existingByKey = new Map(
    existing.map((lecture) => [
      normalizeString(lecture?.suggestionKey || lecture?.lectureName),
      lecture,
    ]),
  );

  (Array.isArray(lectures) ? lectures : []).forEach((lecture) => {
    const suggestionKey = normalizeString(
      lecture?.suggestionKey || lecture?.lectureName,
    );

    if (suggestionKey) {
      existingByKey.set(suggestionKey, lecture);
    }
  });

  return replaceStoredLecturePredictions({
    memoryDoc,
    scope,
    bucketName,
    lectures: Array.from(existingByKey.values()),
  });
};

const listStoredLecturePredictionKeys = (memoryDoc, scope = {}) =>
  ["saved", "accepted", "rejected"].reduce((keys, bucketName) => {
    listStoredLecturePredictions(memoryDoc, scope, bucketName).forEach((lecture) => {
      const suggestionKey = normalizeString(
        lecture?.suggestionKey || lecture?.lectureName,
      );

      if (suggestionKey) {
        keys.add(suggestionKey);
      }
    });

    return keys;
  }, new Set());

const removeStoredLecturePrediction = ({
  memoryDoc,
  scope = {},
  bucketName = "saved",
  suggestionKey = "",
}) => {
  const predictions = ensureTelegramPredictionStore(memoryDoc);
  const scopeKey = buildLecturePredictionScopeKey(scope);
  const normalizedSuggestionKey = normalizeString(suggestionKey);
  const bucket = Array.isArray(predictions?.lectures?.[bucketName])
    ? predictions.lectures[bucketName]
    : [];

  if (!normalizedSuggestionKey) {
    predictions.lectures[bucketName] = bucket.filter(
      (entry) => !matchesStoredLecturePredictionScope(entry, scope),
    );
    return;
  }

  predictions.lectures[bucketName] = bucket.filter(
    (entry) =>
      !(
        matchesStoredLecturePredictionScope(entry, scope) &&
        normalizeString(entry?.suggestionKey || entry?.lectureName) ===
          normalizedSuggestionKey
      ),
  );
};

const moveStoredLecturePrediction = ({
  memoryDoc,
  scope = {},
  fromBucket = "saved",
  toBucket = "rejected",
  suggestion = null,
}) => {
  const normalizedSuggestion =
    suggestion && typeof suggestion === "object" ? suggestion : null;

  if (!normalizedSuggestion) {
    return [];
  }

  removeStoredLecturePrediction({
    memoryDoc,
    scope,
    bucketName: fromBucket,
    suggestionKey:
      normalizedSuggestion?.suggestionKey ||
      normalizedSuggestion?.duplicateKey ||
      normalizedSuggestion?.lectureName,
  });
  removeStoredLecturePrediction({
    memoryDoc,
    scope,
    bucketName: toBucket,
    suggestionKey:
      normalizedSuggestion?.suggestionKey ||
      normalizedSuggestion?.duplicateKey ||
      normalizedSuggestion?.lectureName,
  });

  const existing = listStoredLecturePredictions(memoryDoc, scope, toBucket);

  if (isAcrossAllLectureGroupsScope(scope) && normalizeString(normalizedSuggestion?.scopeKey)) {
    const predictions = ensureTelegramPredictionStore(memoryDoc);
    const bucket = Array.isArray(predictions?.lectures?.[toBucket])
      ? predictions.lectures[toBucket]
      : [];
    predictions.lectures[toBucket] = [
      { ...normalizedSuggestion, scopeKey: normalizeString(normalizedSuggestion.scopeKey) },
      ...bucket.filter(
        (entry) =>
          !(
            normalizeString(entry?.scopeKey) ===
              normalizeString(normalizedSuggestion?.scopeKey) &&
            normalizeString(entry?.suggestionKey || entry?.lectureName) ===
              normalizeString(
                normalizedSuggestion?.suggestionKey ||
                  normalizedSuggestion?.duplicateKey ||
                  normalizedSuggestion?.lectureName,
              )
          ),
      ),
    ];
  } else {
    replaceStoredLecturePredictions({
      memoryDoc,
      scope,
      bucketName: toBucket,
      lectures: [normalizedSuggestion, ...existing],
    });
  }

  return listStoredLecturePredictions(memoryDoc, scope, toBucket);
};

const listEmbeddedStoredTelegramMessages = (memoryDoc, groupReference = "") => {
  const normalizedReference = normalizeGroupReference(groupReference);
  const groupEntries = listTelegramGroupMemoryEntries(memoryDoc);
  const messages = groupEntries.flatMap((groupEntry, index) => {
    const schemaGroupReference = buildGroupReferenceFromSchemaEntry(groupEntry, index);
    if (normalizedReference && schemaGroupReference !== normalizedReference) {
      return [];
    }
    const buckets = getTelegramGroupContentBuckets(groupEntry);
    return [
      ...buckets.texts,
      ...buckets.photos,
      ...buckets.images,
      ...buckets.videos,
      ...buckets.audios,
      ...buckets.documents,
    ];
  }).filter(Boolean);

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

const findEmbeddedStoredTelegramMessage = (memoryDoc, groupReference = "", messageId = 0) => {
  const normalizedReference = normalizeGroupReference(groupReference);
  const normalizedMessageId = Number(messageId || 0);
  if (!normalizedMessageId) {
    return null;
  }

  return (
    listEmbeddedStoredTelegramMessages(memoryDoc, normalizedReference).find(
      (entry) => Number(entry?.id || 0) === normalizedMessageId,
    ) || null
  );
};

// Legacy synchronous helper kept for unreachable/deprecated code paths that still
// expect embedded-memory reads. Active routes use collection-backed helpers.
const listStoredTelegramMessages = (memoryDoc, groupReference = "") =>
  listEmbeddedStoredTelegramMessages(memoryDoc, groupReference);

const buildStoredTelegramMessageDocument = (userId, entry = {}) => {
  const normalizedMessage = normalizeStoredMessage(
    entry,
    getTelegramMessageBucketName(entry),
  );
  return {
    groupReference: normalizeGroupReference(normalizedMessage.groupReference),
    messageId: Number(normalizedMessage.id || 0),
    groupTitle: normalizeString(normalizedMessage.groupTitle),
    groupUsername: normalizeString(normalizedMessage.groupUsername),
    groupType: normalizeString(normalizedMessage.groupType || "group") || "group",
    text: normalizeString(normalizedMessage.text),
    date: Number(normalizedMessage.date || 0) || 0,
    sender: normalizeString(normalizedMessage.sender || "Unknown") || "Unknown",
    views:
      typeof normalizedMessage?.views === "number" &&
      Number.isFinite(normalizedMessage.views)
        ? normalizedMessage.views
        : null,
    replyToMessageId:
      typeof normalizedMessage?.replyToMessageId === "number" &&
      Number.isFinite(normalizedMessage.replyToMessageId)
        ? normalizedMessage.replyToMessageId
        : null,
    attachmentKind:
      normalizeString(normalizedMessage.attachmentKind || "text").toLowerCase() || "text",
    attachmentMimeType: normalizeString(normalizedMessage.attachmentMimeType),
    attachmentFileName: normalizeString(normalizedMessage.attachmentFileName),
    attachmentFileExtension: normalizeString(normalizedMessage.attachmentFileExtension),
    attachmentSizeBytes:
      typeof normalizedMessage?.attachmentSizeBytes === "number" &&
      Number.isFinite(normalizedMessage.attachmentSizeBytes)
        ? normalizedMessage.attachmentSizeBytes
        : null,
    attachmentIsPdf: Boolean(normalizedMessage.attachmentIsPdf),
    telegramFileId:
      typeof normalizedMessage?.telegramFileId === "number" &&
      Number.isFinite(normalizedMessage.telegramFileId)
        ? normalizedMessage.telegramFileId
        : null,
    telegramAccessHash: normalizeString(normalizedMessage.telegramAccessHash),
    telegramFileName: normalizeString(normalizedMessage.telegramFileName),
    photoDataUrl: normalizeString(normalizedMessage.photoDataUrl),
    videoDataUrl: normalizeString(normalizedMessage.videoDataUrl),
    documentDataUrl: normalizeString(normalizedMessage.documentDataUrl),
    keywords_raw: Array.isArray(entry?.keywords_raw)
      ? entry.keywords_raw.map((value) => String(value || "").trim()).filter(Boolean)
      : [],
    concepts: normalizeTelegramConceptEntries(entry?.concepts),
  };
};

// Builds a message subdocument (no group-level fields) for the embedded array.
const buildStoredTelegramMessageSubdoc = (entry = {}) => {
  const normalizedMessage = normalizeStoredMessage(
    entry,
    getTelegramMessageBucketName(entry),
  );
  return {
    messageId: Number(normalizedMessage.id || 0),
    text: normalizeString(normalizedMessage.text),
    date: Number(normalizedMessage.date || 0) || 0,
    sender: normalizeString(normalizedMessage.sender || "Unknown") || "Unknown",
    views:
      typeof normalizedMessage?.views === "number" &&
      Number.isFinite(normalizedMessage.views)
        ? normalizedMessage.views
        : null,
    replyToMessageId:
      typeof normalizedMessage?.replyToMessageId === "number" &&
      Number.isFinite(normalizedMessage.replyToMessageId)
        ? normalizedMessage.replyToMessageId
        : null,
    attachmentKind:
      normalizeString(normalizedMessage.attachmentKind || "text").toLowerCase() || "text",
    attachmentMimeType: normalizeString(normalizedMessage.attachmentMimeType),
    attachmentFileName: normalizeString(normalizedMessage.attachmentFileName),
    attachmentFileExtension: normalizeString(normalizedMessage.attachmentFileExtension),
    attachmentSizeBytes:
      typeof normalizedMessage?.attachmentSizeBytes === "number" &&
      Number.isFinite(normalizedMessage.attachmentSizeBytes)
        ? normalizedMessage.attachmentSizeBytes
        : null,
    attachmentIsPdf: Boolean(normalizedMessage.attachmentIsPdf),
    telegramFileId:
      typeof normalizedMessage?.telegramFileId === "number" &&
      Number.isFinite(normalizedMessage.telegramFileId)
        ? normalizedMessage.telegramFileId
        : null,
    telegramAccessHash: normalizeString(normalizedMessage.telegramAccessHash),
    telegramFileName: normalizeString(normalizedMessage.telegramFileName),
    photoDataUrl: normalizeString(normalizedMessage.photoDataUrl),
    videoDataUrl: normalizeString(normalizedMessage.videoDataUrl),
    documentDataUrl: normalizeString(normalizedMessage.documentDataUrl),
    keywords_raw: Array.isArray(entry?.keywords_raw)
      ? entry.keywords_raw.map((value) => String(value || "").trim()).filter(Boolean)
      : [],
    concepts: normalizeTelegramConceptEntries(entry?.concepts),
    entities: Array.isArray(entry?.entities)
      ? entry.entities
          .filter((e) => e && typeof e === "object")
          .map((e) => ({
            offset: Number(e.offset || 0),
            length: Number(e.length || 0),
            type: String(e.type || "").trim(),
          }))
          .filter((e) => e.type)
      : [],
  };
};

const buildGroupStatsFromMessages = (messages = []) =>
  (Array.isArray(messages) ? messages : []).reduce((statsMap, message) => {
    const groupReference = normalizeGroupReference(message?.groupReference);
    if (!groupReference) {
      return statsMap;
    }
    const currentStats = statsMap.get(groupReference) || {
      count: 0,
      latestDateMs: 0,
      groupTitle: normalizeString(message?.groupTitle),
      groupUsername: normalizeString(message?.groupUsername),
      groupType: normalizeString(message?.groupType || "group") || "group",
    };
    currentStats.count += 1;
    currentStats.latestDateMs = Math.max(
      Number(currentStats.latestDateMs || 0) || 0,
      Number(message?.date || 0) || 0,
    );
    if (!currentStats.groupTitle) {
      currentStats.groupTitle = normalizeString(message?.groupTitle);
    }
    if (!currentStats.groupUsername) {
      currentStats.groupUsername = normalizeString(message?.groupUsername);
    }
    if (!currentStats.groupType) {
      currentStats.groupType = normalizeString(message?.groupType || "group") || "group";
    }
    statsMap.set(groupReference, currentStats);
    return statsMap;
  }, new Map());

const getExpectedStoredMessageCount = (memoryDoc, groupReference = "") => {
  const normalizedReference = normalizeGroupReference(groupReference);
  const groupEntries = listTelegramGroupMemoryEntries(memoryDoc);
  const matchingGroups = normalizedReference
    ? groupEntries.filter(
        (groupEntry, index) =>
          buildGroupReferenceFromSchemaEntry(groupEntry, index) === normalizedReference,
      )
    : groupEntries;
  return matchingGroups.reduce((count, groupEntry) => {
    const infoCount = Number(groupEntry?.info?.messageCount || 0);
    if (Number.isFinite(infoCount) && infoCount > 0) {
      return count + infoCount;
    }
    return count + countTelegramGroupBucketMessages(groupEntry);
  }, 0);
};

const getEmbeddedStoredMessageCount = (memoryDoc, groupReference = "") =>
  listEmbeddedStoredTelegramMessages(memoryDoc, groupReference).length;

const hasEmbeddedStoredTelegramMessages = (memoryDoc, groupReference = "") =>
  getEmbeddedStoredMessageCount(memoryDoc, groupReference) > 0;

// One-time migration: reads flat documents from the legacy telegram_stored_messages
// collection and writes them into telegram_stored_groups as embedded arrays.
const migrateFlatCollectionToGroupCollection = async (userId) => {
  const normalizedUserId = String(userId || "").trim();
  if (!normalizedUserId) {
    return 0;
  }

  const ObjectId = TelegramStoredMessageModel.db.base.Types.ObjectId;
  const userObjectId = ObjectId.isValid(normalizedUserId)
    ? new ObjectId(normalizedUserId)
    : normalizedUserId;

  let oldDocs;
  try {
    const oldCollection = TelegramStoredMessageModel.db.collection("telegram_stored_messages");
    oldDocs = await oldCollection.find({ user: userObjectId }).toArray();
  } catch {
    return 0;
  }

  if (!oldDocs || oldDocs.length === 0) {
    return 0;
  }

  // Group flat documents by groupReference.
  const byGroup = new Map();
  for (const doc of oldDocs) {
    const groupRef = normalizeGroupReference(doc.groupReference);
    if (!groupRef || !Number(doc.messageId || 0)) {
      continue;
    }
    if (!byGroup.has(groupRef)) {
      byGroup.set(groupRef, {
        groupTitle: normalizeString(doc.groupTitle),
        groupUsername: normalizeString(doc.groupUsername),
        groupType: normalizeString(doc.groupType || "group") || "group",
        subdocs: [],
      });
    }
    const entry = byGroup.get(groupRef);
    entry.subdocs.push({
      messageId: Number(doc.messageId),
      text: normalizeString(doc.text),
      date: Number(doc.date || 0) || 0,
      sender: normalizeString(doc.sender || "Unknown") || "Unknown",
      views: typeof doc.views === "number" ? doc.views : null,
      replyToMessageId: typeof doc.replyToMessageId === "number" ? doc.replyToMessageId : null,
      attachmentKind: normalizeString(doc.attachmentKind || "text").toLowerCase() || "text",
      attachmentMimeType: normalizeString(doc.attachmentMimeType),
      attachmentFileName: normalizeString(doc.attachmentFileName),
      attachmentFileExtension: normalizeString(doc.attachmentFileExtension),
      attachmentSizeBytes: typeof doc.attachmentSizeBytes === "number" ? doc.attachmentSizeBytes : null,
      attachmentIsPdf: Boolean(doc.attachmentIsPdf),
      telegramFileId: typeof doc.telegramFileId === "number" ? doc.telegramFileId : null,
      telegramAccessHash: normalizeString(doc.telegramAccessHash),
      telegramFileName: normalizeString(doc.telegramFileName),
      photoDataUrl: normalizeString(doc.photoDataUrl),
      videoDataUrl: normalizeString(doc.videoDataUrl),
      documentDataUrl: normalizeString(doc.documentDataUrl),
      keywords_raw: Array.isArray(doc.keywords_raw) ? doc.keywords_raw : [],
      concepts: normalizeTelegramConceptEntries(doc.concepts),
      entities: Array.isArray(doc.entities) ? doc.entities : [],
    });
  }

  if (byGroup.size === 0) {
    return 0;
  }

  const bulkOps = [];
  for (const [groupRef, { groupTitle, groupUsername, groupType, subdocs }] of byGroup) {
    bulkOps.push({
      updateOne: {
        filter: { groupReference: groupRef },
        update: [
          {
            $set: {
              groupReference: groupRef,
              groupTitle,
              groupUsername,
              groupType,
              messages: {
                $reduce: {
                  input: subdocs,
                  initialValue: { $ifNull: ["$messages", []] },
                  in: {
                    $cond: {
                      if: {
                        $in: [
                          "$$this.messageId",
                          { $map: { input: "$$value", as: "m", in: "$$m.messageId" } },
                        ],
                      },
                      then: {
                        $map: {
                          input: "$$value",
                          as: "m",
                          in: {
                            $cond: [
                              { $eq: ["$$m.messageId", "$$this.messageId"] },
                              "$$this",
                              "$$m",
                            ],
                          },
                        },
                      },
                      else: { $concatArrays: ["$$value", ["$$this"]] },
                    },
                  },
                },
              },
            },
          },
        ],
        upsert: true,
      },
    });
  }

  await TelegramStoredMessageModel.bulkWrite(bulkOps, { ordered: false });
  return oldDocs.length;
};

const migrateStoredTelegramMessagesToCollection = async ({
  userId,
  memoryDoc = null,
} = {}) => {
  const normalizedUserId = String(userId || "").trim();
  if (!normalizedUserId) {
    return {
      migrated: false,
      migratedCount: 0,
      memoryDoc,
    };
  }

  const fullMemoryDoc =
    memoryDoc && hasEmbeddedStoredTelegramMessages(memoryDoc)
      ? memoryDoc
      : await findUserMemoryLean(normalizedUserId, {
          includeTelegramMessages: true,
        });

  if (!fullMemoryDoc || !hasEmbeddedStoredTelegramMessages(fullMemoryDoc)) {
    return {
      migrated: false,
      migratedCount: 0,
      memoryDoc: fullMemoryDoc || memoryDoc || {},
    };
  }

  const embeddedMessages = listEmbeddedStoredTelegramMessages(fullMemoryDoc, "");
  if (embeddedMessages.length === 0) {
    return {
      migrated: false,
      migratedCount: 0,
      memoryDoc: fullMemoryDoc,
    };
  }

  // Group embedded messages by groupReference for per-group upserts.
  const subdocsByGroup = new Map();
  for (const entry of embeddedMessages) {
    const doc = buildStoredTelegramMessageDocument(normalizedUserId, entry);
    if (!doc || !doc.groupReference || Number(doc.messageId || 0) <= 0) {
      continue;
    }
    const key = normalizeGroupReference(doc.groupReference);
    if (!subdocsByGroup.has(key)) {
      subdocsByGroup.set(key, { groupTitle: doc.groupTitle, groupUsername: doc.groupUsername, groupType: doc.groupType, subdocs: [] });
    }
    const { subdocs } = subdocsByGroup.get(key);
    subdocs.push(buildStoredTelegramMessageSubdoc(entry));
  }

  const bulkOperations = [];
  for (const [groupRef, { groupTitle, groupUsername, groupType, subdocs }] of subdocsByGroup) {
    bulkOperations.push({
      updateOne: {
        filter: { groupReference: groupRef },
        update: [
          {
            $set: {
              groupReference: groupRef,
              groupTitle,
              groupUsername,
              groupType,
              messages: {
                $reduce: {
                  input: subdocs,
                  initialValue: { $ifNull: ["$messages", []] },
                  in: {
                    $cond: {
                      if: {
                        $in: [
                          "$$this.messageId",
                          { $map: { input: "$$value", as: "m", in: "$$m.messageId" } },
                        ],
                      },
                      then: {
                        $map: {
                          input: "$$value",
                          as: "m",
                          in: {
                            $cond: [
                              { $eq: ["$$m.messageId", "$$this.messageId"] },
                              "$$this",
                              "$$m",
                            ],
                          },
                        },
                      },
                      else: { $concatArrays: ["$$value", ["$$this"]] },
                    },
                  },
                },
              },
            },
          },
        ],
        upsert: true,
      },
    });
  }

  if (bulkOperations.length > 0) {
    await TelegramStoredMessageModel.bulkWrite(bulkOperations, { ordered: false });
  }

  return {
    migrated: true,
    migratedCount: bulkOperations.length,
    memoryDoc: fullMemoryDoc,
  };
};

const listStoredTelegramMessagesFromCollection = async (userId, groupReference = "") => {
  const normalizedUserId = String(userId || "").trim();
  if (!normalizedUserId) {
    return [];
  }

  const match = {};
  const normalizedReference = normalizeGroupReference(groupReference);
  if (normalizedReference) {
    match.groupReference = normalizedReference;
  }

  // Each document is a group; its messages are in the embedded array.
  let groupDocs = await TelegramStoredMessageModel.find(match).lean();

  if (groupDocs.length === 0) {
    const flatMigrated = await migrateFlatCollectionToGroupCollection(normalizedUserId);
    if (flatMigrated > 0) {
      groupDocs = await TelegramStoredMessageModel.find(match).lean();
    }
  }

  const allMessages = [];
  for (const doc of groupDocs) {
    const groupRef = normalizeGroupReference(doc.groupReference);
    const groupTitle = normalizeString(doc.groupTitle);
    const groupUsername = normalizeString(doc.groupUsername);
    const groupType = normalizeString(doc.groupType || "group") || "group";

    for (const message of (Array.isArray(doc.messages) ? doc.messages : [])) {
      allMessages.push(
        normalizeStoredMessage(
          {
            id: Number(message.messageId || 0),
            groupReference: groupRef,
            groupTitle,
            groupUsername,
            groupType,
            text: normalizeString(message.text),
            date: Number(message.date || 0) || 0,
            sender: normalizeString(message.sender || "Unknown") || "Unknown",
            views:
              typeof message.views === "number" && Number.isFinite(message.views)
                ? message.views
                : null,
            replyToMessageId:
              typeof message.replyToMessageId === "number" &&
              Number.isFinite(message.replyToMessageId)
                ? message.replyToMessageId
                : null,
            attachmentKind: normalizeString(message.attachmentKind || "text"),
            attachmentMimeType: normalizeString(message.attachmentMimeType),
            attachmentFileName: normalizeString(message.attachmentFileName),
            attachmentFileExtension: normalizeString(message.attachmentFileExtension),
            attachmentSizeBytes:
              typeof message.attachmentSizeBytes === "number" &&
              Number.isFinite(message.attachmentSizeBytes)
                ? message.attachmentSizeBytes
                : null,
            attachmentIsPdf: Boolean(message.attachmentIsPdf),
            telegramFileId:
              typeof message.telegramFileId === "number" &&
              Number.isFinite(message.telegramFileId)
                ? message.telegramFileId
                : null,
            telegramAccessHash: normalizeString(message.telegramAccessHash),
            telegramFileName: normalizeString(message.telegramFileName),
            photoDataUrl: normalizeString(message.photoDataUrl),
            videoDataUrl: normalizeString(message.videoDataUrl),
            documentDataUrl: normalizeString(message.documentDataUrl),
          },
          getTelegramMessageBucketName({ ...message, groupReference: groupRef }),
        ),
      );
    }
  }

  // Sort descending by date, then by messageId.
  allMessages.sort((a, b) => {
    const dateDiff = Number(b.date || 0) - Number(a.date || 0);
    return dateDiff !== 0 ? dateDiff : Number(b.id || 0) - Number(a.id || 0);
  });

  return allMessages;
};

const findStoredTelegramMessage = async (
  userId,
  memoryDoc,
  groupReference = "",
  messageId = 0,
) => {
  const normalizedMessageId = Number(messageId || 0);
  if (!normalizedMessageId) {
    return null;
  }

  const normalizedReference = normalizeGroupReference(groupReference);
  const findMessageInGroup = async () => {
    const groupDoc = await TelegramStoredMessageModel.findOne(
      { groupReference: normalizedReference },
      { groupReference: 1, groupTitle: 1, groupUsername: 1, groupType: 1, messages: { $elemMatch: { messageId: normalizedMessageId } } },
    ).lean();
    return groupDoc?.messages?.[0]
      ? { message: groupDoc.messages[0], doc: groupDoc }
      : null;
  };

  let found = await findMessageInGroup();

  if (!found) {
    await migrateFlatCollectionToGroupCollection(String(userId || "").trim());
    found = await findMessageInGroup();
  }

  if (!found && getExpectedStoredMessageCount(memoryDoc, normalizedReference) > 0) {
    await migrateStoredTelegramMessagesToCollection({ userId, memoryDoc });
    found = await findMessageInGroup();
  }

  if (found) {
    const { message, doc } = found;
    return normalizeStoredMessage(
      {
        id: Number(message.messageId || 0),
        groupReference: normalizeGroupReference(doc.groupReference),
        groupTitle: normalizeString(doc.groupTitle),
        groupUsername: normalizeString(doc.groupUsername),
        groupType: normalizeString(doc.groupType || "group") || "group",
        text: normalizeString(message.text),
        date: Number(message.date || 0) || 0,
        sender: normalizeString(message.sender || "Unknown") || "Unknown",
        views: message.views,
        replyToMessageId: message.replyToMessageId,
        attachmentKind: normalizeString(message.attachmentKind),
        attachmentMimeType: normalizeString(message.attachmentMimeType),
        attachmentFileName: normalizeString(message.attachmentFileName),
        attachmentFileExtension: normalizeString(message.attachmentFileExtension),
        attachmentSizeBytes: message.attachmentSizeBytes,
        attachmentIsPdf: Boolean(message.attachmentIsPdf),
        telegramFileId: message.telegramFileId,
        telegramAccessHash: normalizeString(message.telegramAccessHash),
        telegramFileName: normalizeString(message.telegramFileName),
        photoDataUrl: normalizeString(message.photoDataUrl),
        videoDataUrl: normalizeString(message.videoDataUrl),
        documentDataUrl: normalizeString(message.documentDataUrl),
      },
      getTelegramMessageBucketName({ ...message, groupReference: normalizeGroupReference(doc.groupReference) }),
    );
  }

  return findEmbeddedStoredTelegramMessage(memoryDoc, normalizedReference, normalizedMessageId);
};

const getStoredMessageCountForUser = async (userId, memoryDoc, configSource) => {
  const groupReference = normalizeGroupReference(
    typeof configSource === "string"
      ? configSource
      : configSource?.status?.groupReference,
  );

  const normalizedUserId = String(userId || "").trim();
  if (normalizedUserId) {
    const match = {};
    if (groupReference) {
      match.groupReference = groupReference;
    }
    const countAgg = await TelegramStoredMessageModel.aggregate([
      { $match: match },
      { $project: { count: { $size: { $ifNull: ["$messages", []] } } } },
      { $group: { _id: null, total: { $sum: "$count" } } },
    ]);
    const collectionCount = Number(countAgg[0]?.total || 0);
    if (collectionCount > 0) {
      return collectionCount;
    }
    if (getExpectedStoredMessageCount(memoryDoc, groupReference) > 0) {
      const migrationResult = await migrateStoredTelegramMessagesToCollection({
        userId: normalizedUserId,
        memoryDoc,
      });
      const migratedAgg = await TelegramStoredMessageModel.aggregate([
        { $match: match },
        { $project: { count: { $size: { $ifNull: ["$messages", []] } } } },
        { $group: { _id: null, total: { $sum: "$count" } } },
      ]);
      const migratedCount = Number(migratedAgg[0]?.total || 0);
      if (migratedCount > 0) {
        return migratedCount;
      }
      if (migrationResult?.migrated) {
        memoryDoc = migrationResult.memoryDoc || memoryDoc;
      }
    }
  }

  const groupEntries = listTelegramGroupMemoryEntries(memoryDoc);
  const countGroupEntryFast = (groupEntry = {}) => {
    const messageCount = Number(groupEntry?.info?.messageCount);
    if (Number.isFinite(messageCount) && messageCount >= 0) {
      return messageCount;
    }
    return countTelegramGroupBucketMessages(groupEntry);
  };
  if (!groupReference) {
    return groupEntries.reduce((count, groupEntry) => count + countGroupEntryFast(groupEntry), 0);
  }
  const matchingGroup =
    groupEntries.find(
      (groupEntry, index) =>
        buildGroupReferenceFromSchemaEntry(groupEntry, index) === groupReference,
    ) || null;
  return matchingGroup ? countGroupEntryFast(matchingGroup) : 0;
};

const buildStoredTelegramGroupSummary = async (user, memoryDoc) => {
  const groups = listTelegramGroupMemoryEntries(memoryDoc);
  const firstGroup = groups[0] && typeof groups[0] === "object" ? groups[0] : null;
  const groupReference = buildGroupReferenceFromSchemaEntry(firstGroup, 0);
  let storedMessages = await listStoredTelegramMessagesFromCollection(user?._id, groupReference);

  if (storedMessages.length === 0 && getExpectedStoredMessageCount(memoryDoc, groupReference) > 0) {
    const migrationResult = await migrateStoredTelegramMessagesToCollection({
      userId: user?._id,
      memoryDoc,
    });
    storedMessages = await listStoredTelegramMessagesFromCollection(
      user?._id,
      groupReference,
    );
    if (migrationResult?.migrated) {
      memoryDoc = migrationResult.memoryDoc || memoryDoc;
    }
  }

  if (storedMessages.length === 0) {
    storedMessages = listEmbeddedStoredTelegramMessages(memoryDoc, groupReference);
  }

  if (!groupReference && storedMessages.length === 0 && groups.length === 0) {
    return null;
  }

  return {
    id: null,
    title: firstGroup?.info?.name || groupReference || "Telegram Group",
    username: "",
    groupReference,
    pageUrl: normalizePageUrl(firstGroup?.info?.pageUrl),
    memberCount: Number(firstGroup?.info?.memberCount || 0),
    description: normalizeString(firstGroup?.info?.description),
    storedCount: storedMessages.length,
  };
};

const listStoredTelegramGroups = async (user, memoryDoc, telegramSettings = null) => {
  const normalizedUserId = String(user?._id || "").trim();
  let statsByReference = new Map();

  const buildStatsFromCollectionAgg = async () => {
    // Each document is a group; compute storedCount and latestDateMs from the messages array.
    // Match by both ObjectId and string form to handle any previously mis-migrated documents.
    const rows = await TelegramStoredMessageModel.aggregate([
      { $match: {} },
      {
        $project: {
          groupReference: 1,
          groupTitle: 1,
          groupUsername: 1,
          groupType: 1,
          memberCount: 1,
          description: 1,
          pageUrl: 1,
          storedCount: { $size: { $ifNull: ["$messages", []] } },
          latestDateMs: { $max: "$messages.date" },
        },
      },
    ]);
    return new Map(
      rows.map((entry) => [
        normalizeGroupReference(entry.groupReference),
        {
          storedCount: Number(entry.storedCount || 0),
          latestDateMs: Number(entry.latestDateMs || 0),
          groupTitle: normalizeString(entry.groupTitle),
          groupUsername: normalizeString(entry.groupUsername),
          groupType: normalizeString(entry.groupType || "group") || "group",
          memberCount: Number(entry.memberCount || 0),
          description: normalizeString(entry.description),
          pageUrl: normalizeString(entry.pageUrl),
        },
      ]),
    );
  };

  if (normalizedUserId) {
    statsByReference = await buildStatsFromCollectionAgg();

    if (statsByReference.size === 0) {
      // Try migrating from old flat telegram_stored_messages collection first.
      const flatMigrated = await migrateFlatCollectionToGroupCollection(normalizedUserId);
      if (flatMigrated > 0) {
        statsByReference = await buildStatsFromCollectionAgg();
      }
    }

    if (statsByReference.size === 0 && getExpectedStoredMessageCount(memoryDoc) > 0) {
      // Fall back to migrating from embedded memory doc.
      const migrationResult = await migrateStoredTelegramMessagesToCollection({
        userId: normalizedUserId,
        memoryDoc,
      });
      memoryDoc = migrationResult.memoryDoc || memoryDoc;
      const migratedMessages = listEmbeddedStoredTelegramMessages(memoryDoc, "");
      if (migratedMessages.length > 0) {
        statsByReference = buildGroupStatsFromMessages(migratedMessages);
      } else {
        statsByReference = await buildStatsFromCollectionAgg();
      }
    }
  }

  const schemaGroups = buildStoredTelegramGroupsFromSchema(user, memoryDoc, telegramSettings).map(
    (group) => {
      const stats = statsByReference.get(normalizeGroupReference(group?.groupReference)) || null;
      return {
        ...group,
        title:
          normalizeString(group?.title) ||
          normalizeString(stats?.groupTitle) ||
          normalizeString(group?.groupReference),
        username: normalizeString(group?.username) || normalizeString(stats?.groupUsername),
        type: normalizeString(group?.type || stats?.groupType || "group") || "group",
        storedCount:
          Number(stats?.storedCount || group?.storedCount || 0) || 0,
        latestDateMs:
          Number(stats?.latestDateMs || group?.latestDateMs || 0) || 0,
      };
    },
  );
  const seenReferences = new Set(
    schemaGroups.map((group) => normalizeGroupReference(group?.groupReference)).filter(Boolean),
  );
  const collectionOnlyGroups = Array.from(statsByReference.entries())
    .filter(([groupReference]) => groupReference && !seenReferences.has(groupReference))
    .map(([groupReference, stats], index) => ({
      id: null,
      rowKey: `group-collection-${index + 1}-${groupReference}`,
      title: normalizeString(stats?.groupTitle) || groupReference || "Telegram Group",
      username: normalizeString(stats?.groupUsername),
      groupReference,
      pageUrl: normalizeString(stats?.pageUrl),
      memberCount: Number(stats?.memberCount || 0),
      description: normalizeString(stats?.description),
      storedCount: Number(stats?.storedCount || 0) || 0,
      latestDateMs: Number(stats?.latestDateMs || 0) || 0,
      type: normalizeString(stats?.groupType || "group") || "group",
      synced: false,
    }));

  return [...schemaGroups, ...collectionOnlyGroups].sort(
    (left, right) =>
      Number(right?.latestDateMs || 0) - Number(left?.latestDateMs || 0) ||
      String(left?.title || "").localeCompare(String(right?.title || "")),
  );
};

const getStoredPlannerCoursesPayload = (memoryDoc) => {
  if (Array.isArray(memoryDoc?.courses)) {
    return memoryDoc.courses;
  }

  const plannerCourses = Array.isArray(memoryDoc?.studyPlanner?.studyOrganizer?.courses)
    ? memoryDoc.studyPlanner.studyOrganizer.courses
    : [];
  return flattenMemoryCoursesForPlanner(plannerCourses);
};

const getTelegramStorageSnapshotCacheKey = (userId = "", includeCourses = true) =>
  `${String(userId || "").trim()}::${includeCourses ? "courses" : "nocourses"}`;

const getTelegramStorageSnapshot = async ({
  user,
  telegramSettings,
  includeCourses = true,
  timeoutMs = 5000,
} = {}) => {
  const userId = String(user?._id || "").trim();
  if (!userId) {
    return { memoryDoc: {}, groups: [], courses: [] };
  }

  const cacheKey = getTelegramStorageSnapshotCacheKey(userId, includeCourses);
  const now = Date.now();
  const cached = telegramStorageSnapshotCache.get(cacheKey);
  if (
    cached &&
    typeof cached === "object" &&
    Number(cached.createdAt || 0) > 0 &&
    now - Number(cached.createdAt || 0) <= TELEGRAM_STORAGE_SNAPSHOT_TTL_MS
  ) {
    return cached.payload || { memoryDoc: {}, groups: [], courses: [] };
  }

  const inFlight = telegramStorageSnapshotInFlight.get(cacheKey);
  if (inFlight) {
    return inFlight;
  }

  const requestPromise = (async () => {
    let memoryDoc = {};
    try {
      memoryDoc = await withFastTimeout(
        findUserMemoryLean(userId, {
          includeCourses,
          includeLectures: false,
        }),
        timeoutMs,
        "Telegram storage snapshot memory request timed out.",
      );
    } catch {
      memoryDoc = {};
    }
    const payload = {
      memoryDoc: memoryDoc && typeof memoryDoc === "object" ? memoryDoc : {},
      groups: listStoredTelegramGroupsFast(user, memoryDoc, telegramSettings),
      courses: includeCourses ? getStoredPlannerCoursesPayload(memoryDoc) : [],
    };
    telegramStorageSnapshotCache.set(cacheKey, {
      createdAt: Date.now(),
      payload,
    });
    return payload;
  })();

  telegramStorageSnapshotInFlight.set(cacheKey, requestPromise);
  try {
    return await requestPromise;
  } finally {
    telegramStorageSnapshotInFlight.delete(cacheKey);
  }
};

const removeStoredTelegramGroupMessages = (memoryDoc, groupReference = "") => {
  const normalizedReference = normalizeGroupReference(groupReference);

  if (!normalizedReference) {
    return 0;
  }

  const groups = ensureTelegramGroupMemory(memoryDoc);
  const currentMessages = Array.isArray(groups?.messages) ? groups.messages : [];
  const nextMessages = currentMessages.filter((messageEntry) => {
    const meta =
      messageEntry?.messageMeta && typeof messageEntry.messageMeta === "object"
        ? messageEntry.messageMeta
        : {};
    return normalizeGroupReference(meta?.groupReference) !== normalizedReference;
  });
  const removedCount = currentMessages.length - nextMessages.length;
  groups.messages = nextMessages;
  if (Object.prototype.hasOwnProperty.call(groups, "content")) {
    delete groups.content;
  }

  if (normalizeGroupReference(groups.info.groupReference) === normalizedReference) {
    groups.info.messageCount = 0;
  }

  return removedCount;
};

const removeStoredTelegramGroupEntry = (memoryDoc, groupReference = "") => {
  const normalizedReference = normalizeGroupReference(groupReference);

  if (!normalizedReference) {
    return { deletedGroup: false, deletedMessages: 0 };
  }

  const telegramMemory =
    memoryDoc?.MOA?.telegram && typeof memoryDoc.MOA.telegram === "object"
      ? memoryDoc.MOA.telegram
      : null;

  if (!telegramMemory) {
    return { deletedGroup: false, deletedMessages: 0 };
  }

  const currentGroups = Array.isArray(telegramMemory.groups)
    ? telegramMemory.groups
    : [];
  let deletedMessages = 0;
  const nextGroups = currentGroups.filter((groupEntry, index) => {
    const derivedReference = buildGroupReferenceFromSchemaEntry(groupEntry, index);
    const isMatch = normalizeGroupReference(derivedReference) === normalizedReference;
    if (!isMatch) {
      return true;
    }
    const buckets = getTelegramGroupContentBuckets(groupEntry);
    deletedMessages +=
      buckets.texts.length +
      buckets.photos.length +
      buckets.images.length +
      buckets.videos.length +
      buckets.audios.length +
      buckets.documents.length;
    return false;
  });

  telegramMemory.groups = nextGroups;
  if (memoryDoc?.MOA?.telegram && typeof memoryDoc.MOA.telegram === "object") {
    memoryDoc.MOA.telegram.groups = nextGroups;
  }

  return {
    deletedGroup: nextGroups.length !== currentGroups.length,
    deletedMessages,
  };
};

const persistStoredMediaDataUrl = ({
  memoryDoc,
  groupReference = "",
  messageId = 0,
  bucketName = "",
  dataUrlField = "",
  dataUrlValue = "",
}) => {
  const normalizedReference = normalizeGroupReference(groupReference);
  const normalizedMessageId = Number(messageId || 0);
  const normalizedBucketName = normalizeString(bucketName).toLowerCase();
  const normalizedDataUrlField = normalizeString(dataUrlField);
  const normalizedDataUrlValue = normalizeString(dataUrlValue);

  if (
    !normalizedReference ||
    !normalizedMessageId ||
    !normalizedBucketName ||
    !normalizedDataUrlField ||
    !normalizedDataUrlValue
  ) {
    return false;
  }

  const telegramMemory =
    memoryDoc?.MOA?.telegram && typeof memoryDoc.MOA.telegram === "object"
      ? memoryDoc.MOA.telegram
      : null;

  if (!telegramMemory || !Array.isArray(telegramMemory.groups)) {
    return false;
  }

  for (const groupEntry of telegramMemory.groups) {
    const messageEntries = Array.isArray(groupEntry?.messages) ? groupEntry.messages : [];
    for (let index = 0; index < messageEntries.length; index += 1) {
      const messageEntry = messageEntries[index] && typeof messageEntries[index] === "object"
        ? messageEntries[index]
        : {};
      const trace =
        messageEntry?.messageTrace && typeof messageEntry.messageTrace === "object"
          ? messageEntry.messageTrace
          : {};
      const mediaBucket = Array.isArray(trace?.[normalizedBucketName])
        ? trace[normalizedBucketName]
        : [];
      const mediaIndex = mediaBucket.findIndex((entry) => {
        const meta =
          messageEntry?.messageMeta && typeof messageEntry.messageMeta === "object"
            ? messageEntry.messageMeta
            : {};
        return (
          Number(entry?.id || meta?.id || 0) === normalizedMessageId &&
          normalizeGroupReference(entry?.groupReference || meta?.groupReference) === normalizedReference
        );
      });
      if (mediaIndex === -1) {
        continue;
      }
      mediaBucket[mediaIndex] = {
        ...mediaBucket[mediaIndex],
        [normalizedDataUrlField]: normalizedDataUrlValue,
      };
      trace[normalizedBucketName] = mediaBucket;
      messageEntry.messageTrace = trace;
      messageEntries[index] = messageEntry;
      groupEntry.messages = messageEntries;
      return true;
    }
  }

  return false;
};
const persistStoredPhotoDataUrl = ({
  memoryDoc,
  groupReference = "",
  messageId = 0,
  photoDataUrl = "",
}) =>
  persistStoredMediaDataUrl({
    memoryDoc,
    groupReference,
    messageId,
    bucketName: "photos",
    dataUrlField: "photoDataUrl",
    dataUrlValue: photoDataUrl,
  });

const queryStoredTelegramMessages = async ({
  userId,
  memoryDoc,
  groupReference = "",
  limit = 100,
  offset = 0,
  searchQuery = "",
  startDateMs = null,
  endDateMs = null,
}) => {
  const normalizedSearch = normalizeString(searchQuery).toLowerCase();
  let messages = await listStoredTelegramMessagesFromCollection(userId, groupReference);
  if (messages.length === 0 && getExpectedStoredMessageCount(memoryDoc, groupReference) > 0) {
    const migrationResult = await migrateStoredTelegramMessagesToCollection({
      userId,
      memoryDoc,
    });
    messages = await listStoredTelegramMessagesFromCollection(userId, groupReference);
    if (messages.length === 0 && migrationResult?.memoryDoc) {
      messages = listEmbeddedStoredTelegramMessages(migrationResult.memoryDoc, groupReference);
    }
  }
  if (messages.length === 0) {
    messages = listEmbeddedStoredTelegramMessages(memoryDoc, groupReference);
  }
  const buildSearchableMessageText = (message = {}) =>
    [
      message?.text,
      message?.sender,
      message?.groupTitle,
      message?.groupReference,
      message?.attachmentKind,
      message?.attachmentFileName,
      message?.attachmentFileExtension,
      message?.attachmentMimeType,
    ]
      .map((value) => normalizeString(value).toLowerCase())
      .filter(Boolean)
      .join(" ");
  const toLightweightStoredMessage = (message = {}) => {
    const normalizedMessage = normalizeStoredMessage(
      {
        ...message,
        photoDataUrl: "",
        videoDataUrl: "",
        documentDataUrl: "",
      },
      getTelegramMessageBucketName(message),
    );
    return {
      ...normalizedMessage,
      photoDataUrl: "",
      videoDataUrl: "",
      documentDataUrl: "",
    };
  };
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

    return buildSearchableMessageText(message).includes(normalizedSearch);
  });

  const safeOffset = Math.max(0, Number(offset || 0) || 0);
  const totalFilteredCount = filteredMessages.length;
  const pagedMessages =
    limit === "all"
      ? filteredMessages
      : filteredMessages.slice(safeOffset, safeOffset + Number(limit || 0));
  const nextOffset =
    limit === "all" ? totalFilteredCount : safeOffset + pagedMessages.length;
  const hasMore =
    limit === "all" ? false : nextOffset < totalFilteredCount;

  const classifyDocumentType = (message = {}) => {
    const attachmentKind = normalizeString(message?.attachmentKind).toLowerCase();
    const mimeType = normalizeString(message?.attachmentMimeType).toLowerCase();
    const rawExtension = normalizeString(message?.attachmentFileExtension).toLowerCase().replace(/^\./, "");
    const fileNameExtension = normalizeString(message?.attachmentFileName).toLowerCase().includes(".")
      ? normalizeString(message?.attachmentFileName).toLowerCase().split(".").pop()
      : "";
    const extension = rawExtension || fileNameExtension;
    if (attachmentKind === "photo" || mimeType.startsWith("image/")) return "image";
    if (extension === "pdf" || mimeType === "application/pdf") return "pdf";
    if (["doc","docx","odt","rtf"].includes(extension) || mimeType.includes("word") || mimeType.includes("officedocument.wordprocessingml") || mimeType.includes("opendocument.text") || mimeType.includes("rtf")) return "word";
    if (["xls","xlsx","csv","ods"].includes(extension) || mimeType.includes("excel") || mimeType.includes("spreadsheet") || mimeType.includes("csv")) return "excel";
    if (["ppt","pptx","odp"].includes(extension) || mimeType.includes("powerpoint") || mimeType.includes("presentation")) return "powerpoint";
    if (["zip","rar","7z","tar","gz"].includes(extension) || mimeType.includes("zip") || mimeType.includes("rar") || mimeType.includes("compressed")) return "archive";
    if (["js","ts","jsx","tsx","py","java","c","cpp","cs","php","html","css","json","xml","yml","yaml","md","sql","sh"].includes(extension) || mimeType.startsWith("text/") || mimeType.includes("json") || mimeType.includes("xml")) return "code";
    if (attachmentKind === "document" || attachmentKind === "pdf") return "pdf";
    return "other";
  };
  const typeCounts = { all: messages.length, image: 0, pdf: 0, word: 0, excel: 0, powerpoint: 0, archive: 0, code: 0, other: 0 };
  messages.forEach((message) => {
    const kind = String(message?.attachmentKind || "").trim().toLowerCase();
    if (!kind || kind === "text" || kind === "video" || kind === "audio") return;
    const typeKey = classifyDocumentType(message);
    typeCounts[typeKey] = (typeCounts[typeKey] || 0) + 1;
  });

  return {
    filteredMessages: pagedMessages.map((message) => toLightweightStoredMessage(message)),
    rawCount: messages.length,
    storedCount: messages.length,
    totalFilteredCount,
    typeCounts,
    offset: safeOffset,
    nextOffset,
    hasMore,
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
    storeContent: normalizeTelegramStoreContent(status.storeContent),
    connected: Boolean(config.apiId && config.apiHash && config.stringSession),
  };
};

const isTelegramAttachmentKindAllowed = (attachmentKind = "", storeContent = {}) => {
  // Content type filtering is disabled: migrate all message types.
  // Pinned-only filtering is handled separately at message-level.
  void attachmentKind;
  void storeContent;
  return true;
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
    (() => {
      const kind = normalizeString(entry?.attachmentKind).toLowerCase();
      if (kind === "photo" && !normalizeString(entry?.photoDataUrl)) {
        const hasKnownMediaHandle =
          Number.isFinite(Number(entry?.telegramFileId)) ||
          normalizeString(entry?.telegramAccessHash) !== "";
        if (!hasKnownMediaHandle) {
          return "text";
        }
      }
      return (
        kind ||
        (bucketName === "documents" ? "document" : bucketName.slice(0, -1))
      );
    })(),
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
  photoDataUrl:
    normalizeString(entry?.attachmentKind).toLowerCase() === "photo" &&
    normalizeString(entry?.photoDataUrl)
      ? normalizeString(entry?.photoDataUrl)
      : "",
  videoDataUrl:
    normalizeString(entry?.attachmentKind).toLowerCase() === "video" &&
    normalizeString(entry?.videoDataUrl)
      ? normalizeString(entry?.videoDataUrl)
      : "",
  documentDataUrl:
    (normalizeString(entry?.attachmentKind).toLowerCase() === "document" ||
      normalizeString(entry?.attachmentKind).toLowerCase() === "pdf") &&
    normalizeString(entry?.documentDataUrl)
      ? normalizeString(entry?.documentDataUrl)
      : "",
  entities: Array.isArray(entry?.entities)
    ? entry.entities
        .filter((e) => e && typeof e === "object" && String(e.type || "").trim())
        .map((e) => ({
          offset: Number(e.offset || 0),
          length: Number(e.length || 0),
          type: String(e.type || "").trim(),
        }))
    : [],
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
    if (/^-?\d+$/.test(normalizedReference)) {
      try {
        return await client.getEntity(Number(normalizedReference));
      } catch {}
    }

    try {
      const dialogs = await collectTelegramDialogs(client);
      const matchingDialog = dialogs.find((dialog) => {
        const entity = dialog?.entity;
        const username = normalizeString(entity?.username);
        const title = normalizeString(entity?.title || dialog?.title);
        const entityReference = normalizeGroupReference(
          username || entity?.id || dialog?.id,
        );

        return (
          entityReference === normalizedReference ||
          username === normalizedReference ||
          title === normalizedReference
        );
      });

      if (matchingDialog?.entity) {
        return matchingDialog.entity;
      }
    } catch {}

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

const buildMessagePayload = (message, options = {}) => {
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
  const mediaClassName = normalizeString(message?.media?.className);
  const hasNativePhoto = mediaClassName === "MessageMediaPhoto" || Boolean(message?.media?.photo);
  const hasWebPreviewPhoto =
    mediaClassName === "MessageMediaWebPage" &&
    Boolean(message?.media?.webpage?.photo);
  const isPhotoMessage = Boolean(hasNativePhoto || hasWebPreviewPhoto);
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
    attachmentMimeType:
      isPhotoMessage && !attachmentMimeType ? "image/jpeg" : attachmentMimeType,
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
    photoDataUrl:
      normalizeString(attachmentKind).toLowerCase() === "photo"
        ? normalizeString(options?.photoDataUrl)
        : "",
    entities: Array.isArray(message?.entities)
      ? message.entities
          .filter((e) => e && typeof e === "object")
          .map((e) => ({
            offset: Number(e.offset || 0),
            length: Number(e.length || 0),
            type: normalizeString(
              e.className
                ? e.className.replace(/^MessageEntity/, "").toLowerCase()
                : e.type || "",
            ),
          }))
          .filter((e) => e.type && e.length > 0)
      : [],
    pinned: Boolean(message?.pinned),
  };
};

const ARABIC_KEYWORD_STOPWORDS = new Set([
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "the",
  "and",
  "for",
]);

const normalizeArabicConceptText = (value = "") =>
  String(value || "")
    .toLowerCase()
    // Remove Arabic diacritics and tatweel.
    .replace(/[\u064B-\u0652\u0670\u0640]/g, "")
    // Normalize common Arabic letter variants.
    .replace(/[أإآٱ]/g, "ا")
    .replace(/ى/g, "ي")
    .replace(/ة/g, "ه")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
const normalizeTelegramConceptEntries = (value = []) =>
  (Array.isArray(value) ? value : [])
    .map((entry) => {
      const source = entry && typeof entry === "object" ? entry : {};
      const key = normalizeString(source?.key);
      const conceptValue = normalizeString(source?.value);
      const confidenceRaw = Number(source?.confidence);
      const confidence = Number.isFinite(confidenceRaw)
        ? Math.min(1, Math.max(0, confidenceRaw))
        : 0;
      const method = normalizeString(source?.method);
      return { key, value: conceptValue, confidence, method };
    })
    .filter((entry) => entry.key && entry.value);

const extractDeterministicKeywords = (text = "", limit = 12) => {
  const normalized = normalizeArabicConceptText(text);
  if (!normalized) {
    return [];
  }
  const tokens = normalized
    .split(" ")
    .map((token) => token.trim())
    .filter(
      (token) =>
        token.length >= 2 &&
        !ARABIC_KEYWORD_STOPWORDS.has(token) &&
        !/^\d+$/.test(token),
    );
  return Array.from(new Set(tokens)).slice(0, Math.max(1, limit));
};

const buildPlannerOntologyFromMemory = (memoryDoc) => {
  const courses = getStoredPlannerCoursesPayload(memoryDoc);
  const ontology = {
    course_name: new Map(),
    course_class: new Map(),
    course_instructors: new Map(),
    course_writers: new Map(),
  };
  const fuzzyIndex = {
    course_name: [],
    course_class: [],
    course_instructors: [],
    course_writers: [],
  };
  const relations = {
    courseToComponents: new Map(),
    componentToCourses: new Map(),
  };

  const splitConceptList = (value) =>
    String(value || "")
      .split(/[|,;/]+/g)
      .map((entry) => normalizeString(entry))
      .filter(Boolean);
  const registerConcept = (key, rawValue) => {
    const value = normalizeString(rawValue);
    const normalized = normalizeArabicConceptText(value);
    if (!value || !normalized) {
      return;
    }
    if (!ontology[key].has(normalized)) {
      ontology[key].set(normalized, value);
      fuzzyIndex[key].push({ normalized, value });
    }
  };

  (Array.isArray(courses) ? courses : []).forEach((course) => {
    const courseName = normalizeString(course?.course_name);
    const componentClass = normalizeString(course?.course_class);
    registerConcept("course_name", courseName);
    registerConcept("course_class", componentClass);
    const normalizedCourse = normalizeArabicConceptText(courseName);
    const normalizedComponent = normalizeArabicConceptText(componentClass);
    if (normalizedCourse && normalizedComponent) {
      if (!relations.courseToComponents.has(normalizedCourse)) {
        relations.courseToComponents.set(normalizedCourse, new Set());
      }
      relations.courseToComponents.get(normalizedCourse).add(normalizedComponent);
      if (!relations.componentToCourses.has(normalizedComponent)) {
        relations.componentToCourses.set(normalizedComponent, new Set());
      }
      relations.componentToCourses.get(normalizedComponent).add(normalizedCourse);
    }
    splitConceptList(course?.course_instructors).forEach((value) =>
      registerConcept("course_instructors", value),
    );
    splitConceptList(course?.course_writers || course?.course_writer).forEach(
      (value) => registerConcept("course_writers", value),
    );
  });

  return { exact: ontology, fuzzy: fuzzyIndex, relations };
};

const tagMessageConcepts = (messageText = "", ontology = {}) => {
  const keywords = extractDeterministicKeywords(messageText);
  const concepts = [];
  const normalizedMessage = normalizeArabicConceptText(messageText);
  const conceptDebug = [];
  const pushConcept = (entry = {}) => {
    const key = normalizeString(entry?.key);
    const value = normalizeString(entry?.value);
    if (!key || !value) {
      return;
    }
    const duplicateIndex = concepts.findIndex(
      (concept) => concept.key === key && concept.value === value,
    );
    if (duplicateIndex === -1) {
      concepts.push(entry);
      conceptDebug.push({
        action: "add_concept",
        key,
        value,
        confidence: Number(entry?.confidence || 0),
        method: normalizeString(entry?.method),
      });
      return;
    }
    if (Number(entry?.confidence || 0) > Number(concepts[duplicateIndex]?.confidence || 0)) {
      conceptDebug.push({
        action: "replace_concept",
        key,
        value,
        previousConfidence: Number(concepts[duplicateIndex]?.confidence || 0),
        nextConfidence: Number(entry?.confidence || 0),
        method: normalizeString(entry?.method),
      });
      concepts[duplicateIndex] = entry;
    }
  };

  const getContextBoost = (key, token = "", fullText = "") => {
    const normalizedToken = normalizeArabicConceptText(token);
    const normalizedText = normalizeArabicConceptText(fullText);
    const hasContextWord = (patterns = []) =>
      patterns.some((pattern) => normalizedText.includes(pattern));
    if (key === "course_name") {
      return hasContextWord(["", "", "", "", "course"]) ? 0.1 : 0;
    }
    if (key === "course_class") {
      return hasContextWord(["", "", "", "", "section"]) ||
        ["", "", ""].includes(normalizedToken)
        ? 0.12
        : 0;
    }
    if (key === "course_instructors") {
      return hasContextWord(["", "", "", ""]) ? 0.1 : 0;
    }
    if (key === "course_writers") {
      return hasContextWord(["", "", "", ""]) ? 0.1 : 0;
    }
    return 0;
  };

  const fuzzyMatchValue = (key, token) => {
    const normalizedToken = normalizeArabicConceptText(token);
    if (!normalizedToken || normalizedToken.length < 3) {
      return null;
    }
    const source = Array.isArray(ontology?.fuzzy?.[key]) ? ontology.fuzzy[key] : [];
    const match =
      source.find(
        (entry) =>
          entry.normalized.includes(normalizedToken) ||
          normalizedToken.includes(entry.normalized),
      ) || null;
    return match;
  };

  keywords.forEach((keyword) => {
    const courseValue = ontology?.exact?.course_name?.get(keyword);
    if (courseValue) {
      pushConcept({
        key: "course_name",
        value: courseValue,
        confidence: Math.min(1, 0.9 + getContextBoost("course_name", keyword, normalizedMessage)),
        method: "exact_keyword_match",
      });
    } else {
      const fuzzy = fuzzyMatchValue("course_name", keyword);
      if (fuzzy) {
        pushConcept({
          key: "course_name",
          value: fuzzy.value,
          confidence: Math.min(0.89, 0.72 + getContextBoost("course_name", keyword, normalizedMessage)),
          method: "fuzzy_keyword_match",
        });
      }
    }
    const componentValue = ontology?.exact?.course_class?.get(keyword);
    if (componentValue) {
      pushConcept({
        key: "course_class",
        value: componentValue,
        confidence: Math.min(1, 0.9 + getContextBoost("course_class", keyword, normalizedMessage)),
        method: "exact_keyword_match",
      });
    } else {
      const fuzzy = fuzzyMatchValue("course_class", keyword);
      if (fuzzy) {
        pushConcept({
          key: "course_class",
          value: fuzzy.value,
          confidence: Math.min(0.89, 0.72 + getContextBoost("course_class", keyword, normalizedMessage)),
          method: "fuzzy_keyword_match",
        });
      }
    }

    const instructorValue = ontology?.exact?.course_instructors?.get(keyword);
    if (instructorValue) {
      pushConcept({
        key: "course_instructors",
        value: instructorValue,
        confidence: Math.min(1, 0.9 + getContextBoost("course_instructors", keyword, normalizedMessage)),
        method: "exact_keyword_match",
      });
    } else {
      const fuzzy = fuzzyMatchValue("course_instructors", keyword);
      if (fuzzy) {
        pushConcept({
          key: "course_instructors",
          value: fuzzy.value,
          confidence: Math.min(0.89, 0.72 + getContextBoost("course_instructors", keyword, normalizedMessage)),
          method: "fuzzy_keyword_match",
        });
      }
    }

    const writerValue = ontology?.exact?.course_writers?.get(keyword);
    if (writerValue) {
      pushConcept({
        key: "course_writers",
        value: writerValue,
        confidence: Math.min(1, 0.9 + getContextBoost("course_writers", keyword, normalizedMessage)),
        method: "exact_keyword_match",
      });
    } else {
      const fuzzy = fuzzyMatchValue("course_writers", keyword);
      if (fuzzy) {
        pushConcept({
          key: "course_writers",
          value: fuzzy.value,
          confidence: Math.min(0.89, 0.72 + getContextBoost("course_writers", keyword, normalizedMessage)),
          method: "fuzzy_keyword_match",
        });
      }
    }
  });

  const applyRelationBoost = () => {
    const relationMap = ontology?.relations || {};
    const courseConcepts = concepts.filter((entry) => entry.key === "course_name");
    const componentConcepts = concepts.filter(
      (entry) => entry.key === "course_class",
    );
    if (courseConcepts.length === 0 || componentConcepts.length === 0) {
      return;
    }

    courseConcepts.forEach((courseEntry) => {
      const normalizedCourse = normalizeArabicConceptText(courseEntry.value);
      const allowedComponents = relationMap?.courseToComponents?.get?.(
        normalizedCourse,
      );
      if (!allowedComponents || allowedComponents.size === 0) {
        return;
      }
      componentConcepts.forEach((componentEntry) => {
        const normalizedComponent = normalizeArabicConceptText(
          componentEntry.value,
        );
        if (!allowedComponents.has(normalizedComponent)) {
          return;
        }
        const relationBoost = 0.08;
        courseEntry.confidence = Math.min(
          1,
          Number(courseEntry.confidence || 0) + relationBoost,
        );
        componentEntry.confidence = Math.min(
          1,
          Number(componentEntry.confidence || 0) + relationBoost,
        );
        courseEntry.method = String(courseEntry.method || "").includes("relation")
          ? courseEntry.method
          : `${courseEntry.method}+relation_pair`;
        componentEntry.method = String(componentEntry.method || "").includes("relation")
          ? componentEntry.method
          : `${componentEntry.method}+relation_pair`;
        conceptDebug.push({
          action: "relation_boost",
          course: normalizeString(courseEntry.value),
          component: normalizeString(componentEntry.value),
          boost: relationBoost,
        });
      });
    });
  };

  applyRelationBoost();
  const applyRelationPenalty = () => {
    const relationMap = ontology?.relations || {};
    const courseConcepts = concepts.filter((entry) => entry.key === "course_name");
    const componentConcepts = concepts.filter(
      (entry) => entry.key === "course_class",
    );
    if (courseConcepts.length === 0 || componentConcepts.length === 0) {
      return;
    }

    const pairScores = [];
    courseConcepts.forEach((courseEntry) => {
      const normalizedCourse = normalizeArabicConceptText(courseEntry.value);
      const allowedComponents = relationMap?.courseToComponents?.get?.(
        normalizedCourse,
      );
      componentConcepts.forEach((componentEntry) => {
        const normalizedComponent = normalizeArabicConceptText(
          componentEntry.value,
        );
        const isValidPair = Boolean(
          allowedComponents &&
            allowedComponents.size > 0 &&
            allowedComponents.has(normalizedComponent),
        );
        pairScores.push({
          courseEntry,
          componentEntry,
          isValidPair,
          score:
            Number(courseEntry?.confidence || 0) +
            Number(componentEntry?.confidence || 0) +
            (isValidPair ? 0.1 : -0.1),
        });
      });
    });

    if (pairScores.length === 0) {
      return;
    }
    const bestPair = pairScores.reduce((best, current) =>
      !best || current.score > best.score ? current : best,
    null);
    if (!bestPair) {
      return;
    }

    pairScores.forEach((entry) => {
      if (entry.courseEntry === bestPair.courseEntry && entry.componentEntry === bestPair.componentEntry) {
        return;
      }
      const penalty = entry.isValidPair ? 0.03 : 0.14;
      const previousCourseConfidence = Number(entry.courseEntry.confidence || 0);
      const previousComponentConfidence = Number(entry.componentEntry.confidence || 0);
      entry.courseEntry.confidence = Math.max(
        0,
        previousCourseConfidence - penalty,
      );
      entry.componentEntry.confidence = Math.max(
        0,
        previousComponentConfidence - penalty,
      );
      if (!entry.isValidPair) {
        entry.courseEntry.method = String(entry.courseEntry.method || "").includes("relation_penalty")
          ? entry.courseEntry.method
          : `${entry.courseEntry.method}+relation_penalty`;
        entry.componentEntry.method = String(entry.componentEntry.method || "").includes("relation_penalty")
          ? entry.componentEntry.method
          : `${entry.componentEntry.method}+relation_penalty`;
      }
      conceptDebug.push({
        action: "relation_penalty",
        course: normalizeString(entry.courseEntry.value),
        component: normalizeString(entry.componentEntry.value),
        validPair: Boolean(entry.isValidPair),
        penalty,
        previousCourseConfidence,
        nextCourseConfidence: Number(entry.courseEntry.confidence || 0),
        previousComponentConfidence,
        nextComponentConfidence: Number(entry.componentEntry.confidence || 0),
      });
    });

    for (let index = concepts.length - 1; index >= 0; index -= 1) {
      if (Number(concepts[index]?.confidence || 0) < 0.4) {
        conceptDebug.push({
          action: "drop_low_confidence",
          key: normalizeString(concepts[index]?.key),
          value: normalizeString(concepts[index]?.value),
          confidence: Number(concepts[index]?.confidence || 0),
        });
        concepts.splice(index, 1);
      }
    }
  };

  applyRelationPenalty();

  return {
    keywords_raw: keywords,
    concepts: normalizeTelegramConceptEntries(concepts),
    concept_debug: conceptDebug,
  };
};

const upsertTelegramMessagesIntoMemory = async ({
  userId,
  memoryDoc,
  groupMetadata,
  messages = [],
}) => {
  const normalizedReference = normalizeGroupReference(groupMetadata.groupReference);
  const plannerOntology = buildPlannerOntologyFromMemory(memoryDoc);

  let insertedCount = 0;
  const messageSubdocs = [];

  (Array.isArray(messages) ? messages : []).forEach((message) => {
    const taggedConcepts = tagMessageConcepts(message?.text || "", plannerOntology);
    const nextEntry = {
      ...message,
      ...taggedConcepts,
      groupReference: normalizedReference,
      groupTitle: normalizeString(groupMetadata.name),
      groupUsername: normalizeString(groupMetadata.username),
      groupType: normalizeString(groupMetadata.type || "group") || "group",
    };
    const messageId = Number(nextEntry.id || 0);

    if (!messageId) {
      return;
    }

    messageSubdocs.push(
      buildStoredTelegramMessageSubdoc({
        ...nextEntry,
        keywords_raw: Array.isArray(taggedConcepts?.keywords_raw)
          ? taggedConcepts.keywords_raw
          : [],
        concepts: normalizeTelegramConceptEntries(taggedConcepts?.concepts),
      }),
    );
  });

  if (messageSubdocs.length > 0) {
    // Upsert all messages for this group atomically.
    // The aggregation pipeline merges incoming subdocs into the existing array,
    // updating in-place by messageId or appending new ones.
    await TelegramStoredMessageModel.updateOne(
      { groupReference: normalizedReference },
      [
        {
          $set: {
            groupReference: normalizedReference,
            groupTitle: normalizeString(groupMetadata.name),
            groupUsername: normalizeString(groupMetadata.username),
            groupType: normalizeString(groupMetadata.type || "group") || "group",
            messages: {
              $reduce: {
                input: messageSubdocs,
                initialValue: { $ifNull: ["$messages", []] },
                in: {
                  $cond: {
                    if: {
                      $in: [
                        "$$this.messageId",
                        { $map: { input: "$$value", as: "m", in: "$$m.messageId" } },
                      ],
                    },
                    then: {
                      $map: {
                        input: "$$value",
                        as: "m",
                        in: {
                          $cond: [
                            { $eq: ["$$m.messageId", "$$this.messageId"] },
                            "$$this",
                            "$$m",
                          ],
                        },
                      },
                    },
                    else: { $concatArrays: ["$$value", ["$$this"]] },
                  },
                },
              },
            },
          },
        },
      ],
      { upsert: true },
    );
    insertedCount = messageSubdocs.length;
  }

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
    setTelegramSyncControl(userKey, "play");
    setTelegramSyncStatus(userKey, {
      running: true,
      startedAt: Date.now(),
      finishedAt: null,
      scannedCount: 0,
      importedCount: 0,
      reason: "running",
      synced: false,
      error: "",
    });

    try {
      const [user, memoryDoc, telegramSettings] = await Promise.all([
        UserModel.findById(userId).select("settings.telegram.status").lean(),
        findUserMemoryLean(userId),
        findTelegramSettings(userId),
      ]);

      if (!user) {
        const error = new Error("User not found.");
        error.status = 404;
        throw error;
      }

      const { config, canSync } = getTelegramSyncEligibility(
        user,
        telegramSettings,
        { requireSyncEnabled: !options.force },
      );
      const normalizedSyncGroupReference = normalizeGroupReference(
        config?.groupReference,
      );
      let importedCountTotal = 0;
      const flushImportedMessages = async (batchMessages = []) => {
        const safeBatch = Array.isArray(batchMessages) ? batchMessages : [];
        if (safeBatch.length === 0) {
          return 0;
        }
        return upsertTelegramMessagesIntoMemory({
          userId,
          memoryDoc,
          groupMetadata,
          messages: safeBatch,
        });
      };

      if (!canSync) {
        const result = {
          synced: false,
          reason: "import-not-configured",
          message: "Telegram import is not configured for this user.",
          importedCount: 0,
          scannedCount: 0,
        };
        setTelegramSyncStatus(userKey, {
          running: false,
          finishedAt: Date.now(),
          scannedCount: result.scannedCount,
          importedCount: result.importedCount,
          reason: result.reason,
          synced: result.synced,
          groupReference: normalizedSyncGroupReference,
        });
        return result;
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
      const toMessageDateMs = (message = null) => {
        if (!message || typeof message !== "object") {
          return null;
        }
        return normalizeTelegramDateMs(message.date);
      };
      const pickFirstMessage = (result) =>
        Array.isArray(result) ? result.find(Boolean) || null : result || null;
      const [latestMessageProbe, oldestMessageProbe] = await Promise.all([
        client
          .getMessages(entity, {
            limit: 1,
          })
          .then((result) => pickFirstMessage(result))
          .catch(() => null),
        client
          .getMessages(entity, {
            limit: 1,
            reverse: true,
          })
          .then((result) => pickFirstMessage(result))
          .catch(() => null),
      ]);
      const firstEverMessageDateMs = toMessageDateMs(oldestMessageProbe);
      const lastEverMessageDateMs = toMessageDateMs(latestMessageProbe);
      const hasFullInterval = Boolean(historyStartMs && historyEndMs);
      const canCompareDistances = Boolean(
        hasFullInterval && firstEverMessageDateMs && lastEverMessageDateMs,
      );
      const distanceFromFirstToFrom = canCompareDistances
        ? Math.abs(historyStartMs - firstEverMessageDateMs)
        : Number.POSITIVE_INFINITY;
      const distanceFromLastToTo = canCompareDistances
        ? Math.abs(lastEverMessageDateMs - historyEndMs)
        : Number.POSITIVE_INFINITY;
      const scanDirection =
        canCompareDistances && distanceFromFirstToFrom < distanceFromLastToTo
          ? "forward"
          : "backward";
      let existingStoredMessages = await listStoredTelegramMessagesFromCollection(
        user._id,
        groupMetadata.groupReference,
      );
      if (
        existingStoredMessages.length === 0 &&
        getExpectedStoredMessageCount(memoryDoc, groupMetadata.groupReference) > 0
      ) {
        const migrationResult = await migrateStoredTelegramMessagesToCollection({
          userId: user._id,
          memoryDoc,
        });
        existingStoredMessages = await listStoredTelegramMessagesFromCollection(
          user._id,
          groupMetadata.groupReference,
        );
        if (migrationResult?.migrated) {
          memoryDoc.MOA = migrationResult.memoryDoc?.MOA || memoryDoc.MOA;
          memoryDoc.MOI = migrationResult.memoryDoc?.MOI || memoryDoc.MOI;
        }
      }
      const lastStoredMessageId = existingStoredMessages.reduce(
        (maxValue, entry) => Math.max(maxValue, Number(entry?.id || 0) || 0),
        0,
      );

      const importedMessages = [];
      let scannedCount = 0;
      let offsetId = 0;
      let shouldStopByInterval = false;

      while (
        scannedCount < TELEGRAM_MAX_SYNC_MESSAGES &&
        importedMessages.length < TELEGRAM_MAX_SYNC_MESSAGES
      ) {
        setTelegramSyncControl(userKey, "play");
        const nextLimit = Math.min(
          TELEGRAM_FETCH_BATCH_SIZE,
          TELEGRAM_MAX_SYNC_MESSAGES - scannedCount,
        );
        const fetchOptions = {
          limit: nextLimit,
          offsetId,
          reverse: scanDirection === "forward",
        };
        const telegramMessages = await client.getMessages(entity, fetchOptions);
        const batch = Array.isArray(telegramMessages)
          ? telegramMessages.filter(Boolean)
          : [];

        if (batch.length === 0) {
          break;
        }

        for (const telegramMessage of batch) {
          const payload = buildMessagePayload(telegramMessage);
          scannedCount += 1;
          setTelegramSyncStatus(userKey, {
            scannedCount,
            importedCount: importedCountTotal + importedMessages.length,
            groupReference: normalizedSyncGroupReference,
          });
          if (Boolean(config?.storeContent?.pinnedOnly) && !payload?.pinned) {
            continue;
          }
          if (
            !isTelegramAttachmentKindAllowed(
              payload?.attachmentKind,
              config.storeContent,
            )
          ) {
            continue;
          }
          const messageDateMs = Number(payload.date || 0) || 0;

          if (historyEndMs && messageDateMs > historyEndMs) {
            if (scanDirection === "forward") {
              shouldStopByInterval = true;
              break;
            }
            continue;
          }

          if (
            historyStartMs &&
            messageDateMs &&
            messageDateMs < historyStartMs
          ) {
            if (scanDirection === "backward") {
              shouldStopByInterval = true;
              break;
            }
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
          setTelegramSyncStatus(userKey, {
            scannedCount,
            importedCount: importedCountTotal + importedMessages.length,
            groupReference: normalizedSyncGroupReference,
          });

          if (importedMessages.length >= TELEGRAM_MAX_SYNC_MESSAGES) {
            break;
          }
        }

        if (importedMessages.length > 0) {
          const insertedNow = await flushImportedMessages(importedMessages.splice(0));
          importedCountTotal += insertedNow;
          setTelegramSyncStatus(userKey, {
            scannedCount,
            importedCount: importedCountTotal,
            groupReference: normalizedSyncGroupReference,
          });
        }

        if (shouldStopByInterval) {
          break;
        }
        const nextOffsetId = Number(batch[batch.length - 1]?.id || 0);
        if (!nextOffsetId || batch.length < TELEGRAM_FETCH_BATCH_SIZE) {
          break;
        }

        if (nextOffsetId === offsetId) {
          break;
        }
        offsetId = nextOffsetId;
      }

      const importedCount = importedCountTotal;

      if (config.syncMode === "one-time") {
        telegramSettings.status.syncEnabled = false;
        telegramSettings.status.updatedAt = new Date();
        await telegramSettings.save();
      }

      const result = {
        synced: true,
        reason: importedCount > 0 ? "messages-imported" : "no-new-messages",
        message:
          importedCount > 0
            ? `Telegram import stored ${importedCount} message(s).`
            : "Telegram import found no new messages.",
        importedCount,
        scannedCount,
      };
      setTelegramSyncStatus(userKey, {
        running: false,
        finishedAt: Date.now(),
        scannedCount: result.scannedCount,
        importedCount: result.importedCount,
        reason: result.reason,
        synced: result.synced,
        error: "",
        groupReference: normalizedSyncGroupReference,
      });
      return result;
    } catch (error) {
      try {
        await UserModel.findById(userId).select("_id");
      } catch {}

      setTelegramSyncStatus(userKey, {
        running: false,
        finishedAt: Date.now(),
        reason: "error",
        synced: false,
        error: normalizeString(error?.message || "Telegram sync failed."),
        groupReference: getTelegramSyncStatus(userKey)?.groupReference || "",
      });

      throw error;
    } finally {
      telegramSyncControlsByUser.delete(userKey);
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
  const telegramSettingsRows = await TelegramSettingsModel.find({
    "status.syncEnabled": true,
    "status.groupReference": { $ne: "" },
    "status.historyStartDate": { $ne: null },
    "status.apiIdEncrypted": { $ne: "" },
    "status.apiHashEncrypted": { $ne: "" },
    "status.stringSessionEncrypted": { $ne: "" },
  }).select("user");

  for (const row of telegramSettingsRows) {
    const userId = String(row?.user || "").trim();
    if (!userId) {
      continue;
    }
    try {
      await syncTelegramMessagesForUser(userId);
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
      groups: [],
      warning,
    };
  }

  let client = null;

  try {
    client = await ensureTelegramClient(userConfig);
    const dialogs = await collectTelegramDialogs(client);
    const debug = {
      dialogsCount: Array.isArray(dialogs) ? dialogs.length : 0,
      groupLikeCount: 0,
      userDialogsCount: 0,
      missingReferenceCount: 0,
    };

    const groups = dialogs
      .map((dialog) => {
        const entity = dialog?.entity;
        const className = normalizeString(
          entity?.className || dialog?.entity?.className,
        );
        const dialogIsChannel = Boolean(
          dialog?.isChannel || dialog?.isBroadcast,
        );
        const dialogIsGroup = Boolean(
          dialog?.isGroup || dialog?.isForum || dialog?.isMegagroup,
        );
        const dialogIsUser = Boolean(dialog?.isUser);
        const isGroupLike =
          entity instanceof Api.Channel ||
          entity instanceof Api.Chat ||
          className === "Channel" ||
          className === "Chat" ||
          className === "ChannelForbidden" ||
          className === "ChatForbidden" ||
          dialogIsChannel ||
          dialogIsGroup;
        if (isGroupLike) {
          debug.groupLikeCount += 1;
        }

        if (dialogIsUser) {
          debug.userDialogsCount += 1;
        }
        if (!isGroupLike || dialogIsUser) {
          return null;
        }

        const username = normalizeString(entity?.username);
        const groupReference = normalizeGroupReference(
          username || entity?.id || dialog?.id || dialog?.peerId?.channelId || dialog?.peerId?.chatId,
        );

        if (!groupReference) {
          debug.missingReferenceCount += 1;
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
            className.toLowerCase().includes("channel") ||
            dialogIsChannel
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

    return {
      groups,
      warning:
        warning ||
        (groups.length === 0
          ? "No Telegram group/channel dialogs were detected for this session."
          : ""),
      debug,
    };
  } catch (error) {
    warning = normalizeString(
      error?.message || "Unable to load live Telegram groups.",
    );

    return {
      groups: [],
      warning,
      debug: {
        dialogsCount: 0,
        groupLikeCount: 0,
        userDialogsCount: 0,
        missingReferenceCount: 0,
      },
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

    const allGroups = String(req.query?.allGroups || "").trim().toLowerCase() === "true";
    const groupReference = normalizeGroupReference(
      req.query.group ||
        req.query.groupReference,
    );
    if (!allGroups && !groupReference) {
      return res.status(400).json({
        message: "groupReference is required.",
      });
    }
    const searchQuery = normalizeString(req.query.q || req.query.search);
    const startDateMs = parseQueryDateValue(req.query.start);
    const endDateMs = parseQueryDateValue(req.query.end);
    const requestedLimit = normalizeString(req.query.limit || "100");
    const requestedOffset = Math.max(
      0,
      Number.parseInt(String(req.query.offset || "0").trim(), 10) || 0,
    );
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

    const {
      filteredMessages,
      rawCount,
      storedCount,
      totalFilteredCount,
      typeCounts,
      offset,
      nextOffset,
      hasMore,
    } =
      await queryStoredTelegramMessages({
        userId: user._id,
        memoryDoc,
        groupReference: allGroups ? "" : groupReference,
        limit,
        offset: requestedOffset,
        searchQuery,
        startDateMs,
        endDateMs,
      });
    const storedSummary = await buildStoredTelegramGroupSummary(user, memoryDoc);
    const responseGroupReference = allGroups ? "" : groupReference;
    const responseGroupTitle = allGroups
      ? "All Stored Groups"
      : storedSummary?.title || groupReference || "Telegram Group";

    return res.status(200).json({
      group: {
        id: null,
        title: responseGroupTitle,
        username: "",
        pageUrl: normalizePageUrl(storedSummary?.pageUrl || ""),
        groupReference: responseGroupReference,
      },
      count: filteredMessages.length,
      rawCount,
      storedCount,
      filteredTotalCount: totalFilteredCount,
      typeCounts,
      offset,
      nextOffset,
      hasMore,
      searched: {
        q: searchQuery,
        start: startDateMs,
        end: endDateMs,
        limit,
        offset,
      },
      messages: filteredMessages,
      sync: buildConfigStatusPayload(telegramSettings),
    });
  } catch (error) {
    next(error);
  }
};

const buildSelectedLectureCourseLabel = (courseName = "", courseComponent = "") => {
  const normalizedCourseName = normalizeString(courseName);
  const normalizedComponent = normalizeString(courseComponent);

  if (!normalizedCourseName) {
    return "";
  }

  if (
    !normalizedComponent ||
    normalizedComponent === "-" ||
    normalizedComponent === normalizedCourseName
  ) {
    return normalizedCourseName;
  }

  return `${normalizedCourseName} (${normalizedComponent})`;
};

const findPlannerCourseForLectureSelection = (
  plannerCourses = [],
  courseName = "",
  courseComponent = "",
  courseIdentity = "",
) => {
  const normalizedCourseName = normalizeString(courseName);
  const normalizedCourseComponent = normalizeString(courseComponent);
  const normalizedIdentity = normalizeString(courseIdentity);

  return (Array.isArray(plannerCourses) ? plannerCourses : []).find((course) => {
    const normalizedCourse = course && typeof course === "object" ? course : {};
    const currentCourseName = normalizeString(normalizedCourse?.name);
    const components = Array.isArray(normalizedCourse?.components)
      ? normalizedCourse.components
      : [];

    return components.some((component) => {
      const normalizedComponent = component && typeof component === "object"
        ? component
        : {};
      const componentLabel =
        normalizeString(normalizedComponent?.class) ||
        normalizeString(normalizedComponent?.name) ||
        "-";
      const componentIdentity = `${currentCourseName}::${componentLabel || "-"}`;

      if (normalizedIdentity && componentIdentity === normalizedIdentity) {
        return true;
      }

      return (
        currentCourseName === normalizedCourseName &&
        componentLabel === (normalizedCourseComponent || "-")
      );
    });
  }) || null;
};

const buildSelectedCourseObjectForAi = (
  plannerCourse = null,
  courseName = "",
  courseComponent = "",
) => {
  const normalizedPlannerCourse =
    plannerCourse && typeof plannerCourse === "object" ? plannerCourse : null;
  const courseComponents = Array.isArray(normalizedPlannerCourse?.components)
    ? normalizedPlannerCourse.components
    : [];
  const selectedComponent =
    courseComponents.find((component) => {
      const normalizedComponent = component && typeof component === "object"
        ? component
        : {};
      const componentLabel =
        normalizeString(normalizedComponent?.class) ||
        normalizeString(normalizedComponent?.name) ||
        "-";

      return componentLabel === (normalizeString(courseComponent) || "-");
    }) || null;

  const courseObject = {
    code: normalizeString(normalizedPlannerCourse?.code),
    name: normalizeString(normalizedPlannerCourse?.name) || normalizeString(courseName),
    components: selectedComponent ? [selectedComponent] : [],
  };

  return courseObject;
};

const getSelectedPlannerComponentForLectureSelection = (
  plannerCourse = null,
  courseComponent = "",
) => {
  const normalizedPlannerCourse =
    plannerCourse && typeof plannerCourse === "object" ? plannerCourse : null;
  const courseComponents = Array.isArray(normalizedPlannerCourse?.components)
    ? normalizedPlannerCourse.components
    : [];

  return (
    courseComponents.find((component) => {
      const normalizedComponent = component && typeof component === "object"
        ? component
        : {};
      const componentLabel =
        normalizeString(normalizedComponent?.class) ||
        normalizeString(normalizedComponent?.name) ||
        "-";

      return componentLabel === (normalizeString(courseComponent) || "-");
    }) || null
  );
};

const buildLectureSuggestionIdentity = (lecture = {}) =>
  [
    normalizeString(lecture?.lecture_course || lecture?.lecture_courseName),
    normalizeString(lecture?.lecture_name),
  ]
    .filter(Boolean)
    .join("::");

const parseJsonArrayFromAiReply = (reply = "") => {
  const normalizedReply = String(reply || "").trim();
  if (!normalizedReply) {
    return [];
  }

  const fencedMatch = normalizedReply.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fencedMatch ? fencedMatch[1].trim() : normalizedReply;
  const arrayMatch = candidate.match(/\[[\s\S]*\]/);
  const jsonText = arrayMatch ? arrayMatch[0] : candidate;

  try {
    const parsed = JSON.parse(jsonText);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
};

const buildLectureTranslationPayload = (lecture = {}) => {
  const payload = lecture?.lecturePayload || {};

  return {
    id: normalizeString(lecture?.suggestionKey || lecture?.lectureName),
    lectureName: normalizeString(lecture?.lectureName),
    instructors: Array.isArray(payload?.lecture_instructors)
      ? payload.lecture_instructors.map((value) => normalizeString(value)).filter(Boolean)
      : [],
    writerGroup: normalizeString(payload?.prediction_writer_group),
    volume: normalizeString(payload?.prediction_volume),
    reference: normalizeString(payload?.prediction_reference),
    logic: normalizeString(payload?.prediction_logic),
  };
};

const normalizePredictionSourceMessageNumbers = (value) => {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((entry) => Number.parseInt(String(entry || "").trim(), 10))
    .filter((entry) => Number.isInteger(entry) && entry > 0);
};

const normalizeComparableLectureText = (value = "") =>
  normalizeString(value)
    .toLowerCase()
    .replace(/\.pdf$/i, "")
    .replace(/[()[\]{}:;,.!?/\\|_\-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

const isTelegramPdfMessage = (message = {}) =>
  Boolean(
    message?.attachmentIsPdf ||
      normalizeString(message?.attachmentMimeType).toLowerCase() ===
        "application/pdf" ||
      normalizeString(message?.attachmentFileName).toLowerCase().endsWith(".pdf"),
  );

const findCandidatePdfMessagesForLecture = ({
  lectureTitle = "",
  sourceMessages = [],
  corpusMessages = [],
}) => {
  const normalizedLectureTitle = normalizeComparableLectureText(lectureTitle);
  const pdfSourceMessages = (Array.isArray(sourceMessages) ? sourceMessages : []).filter(
    (message) => isTelegramPdfMessage(message),
  );

  if (!normalizedLectureTitle) {
    return pdfSourceMessages;
  }

  const matchesLectureTitle = (message) => {
    const normalizedFileName = normalizeComparableLectureText(
      message?.attachmentFileName,
    );
    const normalizedText = normalizeComparableLectureText(message?.text);

    return (
      (normalizedFileName &&
        (normalizedFileName.includes(normalizedLectureTitle) ||
          normalizedLectureTitle.includes(normalizedFileName))) ||
      (normalizedText &&
        (normalizedText.includes(normalizedLectureTitle) ||
          normalizedLectureTitle.includes(normalizedText)))
    );
  };

  const matchingSourceMessages = pdfSourceMessages.filter(matchesLectureTitle);
  if (matchingSourceMessages.length > 0) {
    return matchingSourceMessages;
  }

  if (pdfSourceMessages.length === 1) {
    return pdfSourceMessages;
  }

  return (Array.isArray(corpusMessages) ? corpusMessages : [])
    .filter((message) => isTelegramPdfMessage(message))
    .filter(matchesLectureTitle);
};

const buildTelegramMessageUrl = (message = {}) => {
  const groupUsername = normalizeString(message?.groupUsername).replace(/^@+/, "");
  const groupReference = normalizeGroupReference(message?.groupReference);
  const messageId = Number(message?.id || message?.messageId || 0);

  if (!messageId) {
    return "";
  }

  if (groupUsername) {
    return `https://t.me/${encodeURIComponent(groupUsername)}/${messageId}`;
  }

  if (/^-100\d+$/.test(groupReference)) {
    return `https://t.me/c/${groupReference.slice(4)}/${messageId}`;
  }

  if (/^\d+$/.test(groupReference)) {
    return `https://t.me/c/${groupReference}/${messageId}`;
  }

  return "";
};

const buildPdfAttachmentFromMessage = (message = {}) => {
  if (!isTelegramPdfMessage(message)) {
    return null;
  }

  const messageUrl = buildTelegramMessageUrl(message);

  return {
    messageId: Number(message?.id || 0),
    groupReference: normalizeString(message?.groupReference),
    groupTitle: normalizeString(message?.groupTitle),
    groupUsername: normalizeString(message?.groupUsername),
    fileName: normalizeString(message?.attachmentFileName),
    mimeType: normalizeString(message?.attachmentMimeType),
    pageCount: 0,
    sizeBytes: Number(message?.attachmentSizeBytes || 0) || null,
    messageUrl,
    downloadUrl: messageUrl,
    telegramFileId:
      typeof message?.telegramFileId === "number" && Number.isFinite(message.telegramFileId)
        ? message.telegramFileId
        : null,
  };
};

const LECTURE_SUGGESTION_MAX_MESSAGES = 120;
const LECTURE_SUGGESTION_MAX_TEXT_LENGTH = 500;
const LECTURE_SUGGESTION_MAX_ATTACHMENT_LENGTH = 120;

const truncateTelegramAiField = (value = "", maxLength = 500) => {
  const normalizedValue = normalizeString(value);

  if (!normalizedValue || normalizedValue.length <= maxLength) {
    return normalizedValue;
  }

  return `${normalizedValue.slice(0, Math.max(0, maxLength - 3)).trim()}...`;
};

const downloadTelegramPdfBuffer = async ({
  client,
  groupReference = "",
  messageId = 0,
  entityCache = new Map(),
}) => {
  const normalizedGroupReference = normalizeGroupReference(groupReference);
  const normalizedMessageId = Number(messageId || 0);

  if (!client || !normalizedGroupReference || !normalizedMessageId) {
    return null;
  }

  const cacheKey = normalizedGroupReference;
  let entity = entityCache.get(cacheKey) || null;

  if (!entity) {
    entity = await resolveTelegramGroupEntity(client, normalizedGroupReference);
    entityCache.set(cacheKey, entity);
  }

  const telegramMessageResult = await client.getMessages(entity, {
    ids: [normalizedMessageId],
  });
  const telegramMessage = Array.isArray(telegramMessageResult)
    ? telegramMessageResult.find(Boolean)
    : telegramMessageResult;

  if (!telegramMessage) {
    return null;
  }

  const pdfContent = await client.downloadMedia(telegramMessage, {
    workers: 1,
  });

  if (!pdfContent) {
    return null;
  }

  if (Buffer.isBuffer(pdfContent)) {
    return pdfContent;
  }

  if (pdfContent instanceof Uint8Array) {
    return Buffer.from(pdfContent);
  }

  if (typeof pdfContent === "string") {
    return Buffer.from(pdfContent, "binary");
  }

  return null;
};

const downloadTelegramMessageMedia = async ({
  client,
  groupReference = "",
  messageId = 0,
  groupUsername = "",
  entityCache = new Map(),
}) => {
  const normalizedGroupReference = normalizeGroupReference(groupReference);
  const normalizedMessageId = Number(messageId || 0);

  if (!client || !normalizedMessageId) {
    return null;
  }

  const candidateReferences = [
    normalizedGroupReference,
    normalizeGroupReference(groupUsername),
  ].filter(Boolean);
  let telegramMessage = null;

  for (const reference of candidateReferences) {
    const cacheKey = reference;
    let entity = entityCache.get(cacheKey) || null;

    if (!entity) {
      try {
        entity = await resolveTelegramGroupEntity(client, reference);
        entityCache.set(cacheKey, entity);
      } catch {
        entity = null;
      }
    }

    if (!entity) {
      continue;
    }

    const telegramMessageResult = await client.getMessages(entity, {
      ids: [normalizedMessageId],
    });
    telegramMessage = Array.isArray(telegramMessageResult)
      ? telegramMessageResult.find(Boolean)
      : telegramMessageResult;
    if (telegramMessage) {
      break;
    }
  }

  if (!telegramMessage) {
    return null;
  }

  const toMediaBuffer = (value) => {
    if (!value) {
      return null;
    }
    if (Buffer.isBuffer(value)) {
      return value.length > 0 ? value : null;
    }
    if (value instanceof Uint8Array) {
      const converted = Buffer.from(value);
      return converted.length > 0 ? converted : null;
    }
    if (typeof value === "string") {
      const converted = Buffer.from(value, "binary");
      return converted.length > 0 ? converted : null;
    }
    return null;
  };

  const mediaCandidates = [];
  const mediaClassName = normalizeString(telegramMessage?.media?.className);
  const webPreviewPhoto =
    mediaClassName === "MessageMediaWebPage"
      ? telegramMessage?.media?.webpage?.photo || null
      : null;
  try {
    mediaCandidates.push(
      await client.downloadMedia(telegramMessage, {
        workers: 1,
      }),
    );
  } catch {}
  try {
    mediaCandidates.push(
      await client.downloadMedia(telegramMessage?.media || telegramMessage?.photo, {
        workers: 1,
      }),
    );
  } catch {}
  try {
    if (webPreviewPhoto) {
      mediaCandidates.push(
        await client.downloadMedia(webPreviewPhoto, {
          workers: 1,
        }),
      );
    }
  } catch {}
  try {
    if (typeof telegramMessage?.downloadMedia === "function") {
      mediaCandidates.push(await telegramMessage.downloadMedia({ workers: 1 }));
    }
  } catch {}

  let buffer = null;
  for (const candidate of mediaCandidates) {
    buffer = toMediaBuffer(candidate);
    if (buffer) {
      break;
    }
  }

  if (!buffer) {
    return null;
  }

  const messagePayload = buildMessagePayload(telegramMessage);
  const mimeType =
    normalizeString(messagePayload?.attachmentMimeType) ||
    (normalizeString(messagePayload?.attachmentKind) === "photo"
      ? "image/jpeg"
      : "application/octet-stream");

  return {
    buffer,
    mimeType,
    fileName: normalizeString(messagePayload?.attachmentFileName),
  };
};

const isCourseLikeLectureTitle = (
  title = "",
  courseName = "",
  courseComponent = "",
) => {
  const normalizedTitle = normalizeComparableLectureText(title);

  if (!normalizedTitle) {
    return true;
  }

  const blockedTitles = new Set(
    [
      courseName,
      courseComponent,
      buildSelectedLectureCourseLabel(courseName, courseComponent),
      `${courseName} ${courseComponent}`,
      `${courseComponent} ${courseName}`,
    ]
      .map((value) => normalizeComparableLectureText(value))
      .filter(Boolean),
  );

  if (blockedTitles.has(normalizedTitle)) {
    return true;
  }

  return (
    blockedTitles.size > 0 &&
    Array.from(blockedTitles).some(
      (blockedTitle) =>
        blockedTitle &&
        normalizedTitle.includes(blockedTitle) &&
        normalizedTitle.split(" ").length <= blockedTitle.split(" ").length + 1,
    )
  );
};

const findStoredLectureForPrediction = (
  selectedComponent = null,
  lectureTitle = "",
) => {
  const lectures = Array.isArray(selectedComponent?.lectures)
    ? selectedComponent.lectures
    : [];
  const normalizedLectureTitle = normalizeComparableLectureText(lectureTitle);

  if (!normalizedLectureTitle) {
    return null;
  }

  return (
    lectures.find((lecture) => {
      const lectureName =
        normalizeString(lecture?.title) || normalizeString(lecture?.name);

      return (
        normalizeComparableLectureText(lectureName) === normalizedLectureTitle
      );
    }) || null
  );
};

const buildLectureSuggestionPayload = ({
  lecture = {},
  matchingMessages = [],
  courseName = "",
  courseComponent = "",
  storedLecture = null,
  fallbackGroupLabels = [],
  sourceMessages = [],
  pdfAttachment = null,
}) => {
  const lectureName = normalizeString(lecture?.lecture_name) || "Unnamed lecture";
  const lectureCourse =
    normalizeString(lecture?.lecture_course) ||
    buildSelectedLectureCourseLabel(courseName, courseComponent) ||
    normalizeString(lecture?.lecture_courseName) ||
    normalizeString(courseName) ||
    "-";
  const writerGroupNames = (
    Array.isArray(lecture?.prediction_writer_groups)
      ? lecture.prediction_writer_groups
      : []
  )
    .map((value) => normalizeString(value))
    .filter(Boolean);
  const resolvedWriterGroupNames =
    writerGroupNames.length > 0
      ? writerGroupNames
      : (Array.isArray(fallbackGroupLabels) ? fallbackGroupLabels : []);
  const referenceCodes = (Array.isArray(sourceMessages) ? sourceMessages : [])
    .map((message) => normalizeString(message?.predictionReferenceCode))
    .filter(Boolean);

  return {
    suggestionKey: buildLectureSuggestionIdentity(lecture) || lectureName,
    duplicateKey: buildLectureSuggestionIdentity(lecture) || lectureName,
    lectureName,
    pdfAttachment:
      pdfAttachment && typeof pdfAttachment === "object"
        ? {
            messageId: Number(pdfAttachment?.messageId || 0),
            groupReference: normalizeString(pdfAttachment?.groupReference),
            groupTitle: normalizeString(pdfAttachment?.groupTitle),
            groupUsername: normalizeString(pdfAttachment?.groupUsername),
            fileName: normalizeString(pdfAttachment?.fileName),
            mimeType: normalizeString(pdfAttachment?.mimeType),
            pageCount: Number(pdfAttachment?.pageCount || 0),
            sizeBytes: Number(pdfAttachment?.sizeBytes || 0) || null,
            messageUrl: normalizeString(pdfAttachment?.messageUrl),
            downloadUrl: normalizeString(pdfAttachment?.downloadUrl),
            telegramFileId: Number(pdfAttachment?.telegramFileId || 0) || null,
          }
        : null,
    lecturePayload: {
      lecture_name: lectureName,
      lecture_course: lectureCourse,
      lecture_courseName:
        normalizeString(lecture?.lecture_courseName) || normalizeString(courseName) || "-",
      lecture_component: normalizeString(courseComponent) || "-",
      lecture_instructor:
        normalizeString(lecture?.lecture_instructorName || lecture?.lecture_instructor) || "-",
      lecture_instructors: Array.isArray(lecture?.lecture_instructors)
        ? lecture.lecture_instructors
        : [],
      lecture_writer:
        normalizeString(lecture?.lecture_writerName || lecture?.lecture_writer) || "-",
      lecture_writers: Array.isArray(lecture?.lecture_writers)
        ? lecture.lecture_writers
        : [],
      lecture_date: normalizeString(lecture?.lecture_date),
      lecture_length: Number(lecture?.lecture_length || 0),
      lecture_progress: Number(lecture?.lecture_progress || 0),
      matched_messages: matchingMessages.length,
      lecture_storage_status: storedLecture ? "already stored" : "not stored yet",
      lecture_storage_label: storedLecture
        ? "This lecture is already stored in the selected component."
        : "This lecture is not stored in the selected component yet.",
      lecture_alreadyStored: storedLecture ? "yes" : "no",
      prediction_writer_group: resolvedWriterGroupNames.join(" | ") || "-",
      prediction_volume: normalizeString(lecture?.prediction_volume) || "-",
      prediction_reference:
        referenceCodes.join(" | ") ||
        normalizeString(lecture?.prediction_reference) ||
        "-",
      prediction_logic: normalizeString(lecture?.prediction_logic) || "-",
      lecture_pdf_attachment:
        pdfAttachment && typeof pdfAttachment === "object"
          ? {
              messageId: Number(pdfAttachment?.messageId || 0),
              groupReference: normalizeString(pdfAttachment?.groupReference),
              groupTitle: normalizeString(pdfAttachment?.groupTitle),
              groupUsername: normalizeString(pdfAttachment?.groupUsername),
              fileName: normalizeString(pdfAttachment?.fileName),
              mimeType: normalizeString(pdfAttachment?.mimeType),
              pageCount: Number(pdfAttachment?.pageCount || 0),
              sizeBytes: Number(pdfAttachment?.sizeBytes || 0) || null,
              messageUrl: normalizeString(pdfAttachment?.messageUrl),
              downloadUrl: normalizeString(pdfAttachment?.downloadUrl),
              telegramFileId: Number(pdfAttachment?.telegramFileId || 0) || null,
            }
          : null,
    },
    referenceMessages: (Array.isArray(sourceMessages) ? sourceMessages : []).map(
      (message) => ({
        code: normalizeString(message?.predictionReferenceCode),
        id: Number(message?.id || 0),
        groupReference: normalizeString(message?.groupReference),
        groupTitle: normalizeString(message?.groupTitle),
        date: Number(message?.date || 0) || null,
        sender: normalizeString(message?.sender),
        text: normalizeString(message?.text),
        attachmentFileName: normalizeString(message?.attachmentFileName),
      }),
    ),
    matches: matchingMessages.slice(0, 5).map((message) => ({
      id: Number(message?.id || 0),
      text: normalizeString(message?.text),
      date: Number(message?.date || 0) || null,
    })),
  };
};

TelegramRouter.use("/ai", checkAuth, (_req, res) =>
  res.status(410).json({
    message:
      "Conceptualization methods were removed. Telegram API is storage-only.",
  }),
);

TelegramRouter.post(
  "/ai/lecture-suggestions",
  checkAuth,
  async (req, res, next) => {
    let telegramClient = null;

    try {
      const user = await UserModel.findById(req.authentication.userId).select(
        "settings.telegram.status memory",
      );

      if (!user) {
        return res.status(404).json({
          message: "User not found.",
        });
      }

      const [memoryDoc, aiSettingsDoc, telegramSettings] = await Promise.all([
        ensureUserMemoryDoc(user),
        findAiSettingsLean(user._id, "settings.aiProvider"),
        findTelegramSettings(user._id),
      ]);
      const courseName = normalizeString(req.body?.courseName);
      const courseComponent = normalizeString(req.body?.courseComponent);
      const courseIdentity = normalizeString(req.body?.courseIdentity);
      const chatLanguage =
        normalizeString(req.body?.chatLanguage).toLowerCase() === "ar"
          ? "ar"
          : "en";
      const lecturePredictionScope = {
        allGroups: Boolean(req.body?.allGroups),
        groupReference: req.body?.groupReference,
        courseIdentity,
        courseName,
        courseComponent,
      };
      const groupReferences = Array.isArray(req.body?.groupReferences)
        ? req.body.groupReferences.map((value) => normalizeGroupReference(value)).filter(Boolean)
        : [];

      if (!courseName) {
        return res.status(400).json({
          message: "Course name is required.",
        });
      }

      const storedMessages =
        groupReferences.length > 0
          ? groupReferences.flatMap((groupReference) =>
              listStoredTelegramMessages(memoryDoc, groupReference),
            )
          : listStoredTelegramMessages(memoryDoc, "");
      const plannerCourses = Array.isArray(
        memoryDoc?.studyPlanner?.studyOrganizer?.courses,
      )
        ? memoryDoc.studyPlanner.studyOrganizer.courses
        : [];
      const selectedPlannerCourse = findPlannerCourseForLectureSelection(
        plannerCourses,
        courseName,
        courseComponent,
        courseIdentity,
      );
      const selectedPlannerComponent = getSelectedPlannerComponentForLectureSelection(
        selectedPlannerCourse,
        courseComponent,
      );
      const selectedCourseObject = buildSelectedCourseObjectForAi(
        selectedPlannerCourse,
        courseName,
        courseComponent,
      );
      const selectedCorpusMessages = storedMessages.filter((message) =>
        Boolean(normalizeString(message?.text)),
      );
      const selectedGroupLabels = Array.from(
        new Set(
          selectedCorpusMessages
            .map((message) =>
              normalizeString(message?.groupTitle || message?.groupReference),
            )
            .filter(Boolean),
        ),
      );
      const groqClient = getGroqClient();
      const openAiClient = getOpenAIClient();
      const kimiClient = getKimiClient();
      const preferredProvider = getPreferredAiProvider(
        req.body?.aiProvider || aiSettingsDoc?.settings?.aiProvider,
        groqClient,
        openAiClient,
        kimiClient,
      );
      const hasExplicitProvider = hasExplicitAiProviderSelection(
        req.body?.aiProvider || aiSettingsDoc?.settings?.aiProvider,
      );
      const providerAttemptOrder = buildProviderAttemptOrder(
        preferredProvider,
        groqClient,
        openAiClient,
        kimiClient,
        { allowFallback: !hasExplicitProvider },
      );

      if (providerAttemptOrder.length === 0) {
        return res.status(500).json({
          message: hasExplicitProvider
            ? getMissingProviderConfigurationMessage(preferredProvider)
            : DEFAULT_NO_PROVIDER_MESSAGE,
        });
      }

      const aiInstructions = [
        "You extract and predict lecture entities from the full Telegram message corpus for one selected course component.",
        `Write explanatory natural-language fields in ${
          chatLanguage === "ar" ? "Arabic" : "English"
        }.`,
        "Keep source names such as lecture titles, instructor names, writer names, and file names as they appear in the evidence unless direct translation is obvious.",
        "Return only JSON.",
        "Return an array of objects matching this shape:",
        '[{"title":"", "instructors":[""], "writer":[""], "publishDate":"YYYY-MM-DD or null", "content":[], "sourceGroups":[""], "sourceMessageNumbers":[1], "volume":"", "reference":"", "predictionLogic":""}]',
        "Use only evidence present in the provided messages.",
        "You must do the course-specific reasoning yourself from the full selected group corpus.",
        "Do not assume the backend prefiltered lecture-related messages for you.",
        "Deduplicate lectures by title.",
        "A title must be the lecture/session/topic name, not the course name and not the component name.",
        "Never return the selected course name or course label as a lecture title.",
        "If a message only names the course without a distinct lecture/session/topic, omit it.",
        "Prefer titles that look like lecture/session/unit/chapter/topic names inside the selected course.",
        "sourceGroups must list the Telegram group names that support the prediction.",
        "sourceMessageNumbers must list the prompt message numbers that directly support the prediction.",
        "volume must be a short evidence-volume summary such as low, medium, high, or a concise amount phrase.",
        "reference must be a short supporting reference from the corpus, such as dates, file names, or repeated phrases.",
        "predictionLogic must be one concise sentence explaining why the lecture was predicted.",
        "Do not invent content; always return content as [].",
        "If a date is missing, use null.",
        "Return at most 20 lectures.",
      ].join(" ");
      const limitedCorpusMessages = selectedCorpusMessages
        .slice(0, LECTURE_SUGGESTION_MAX_MESSAGES)
        .map((message) => ({
          ...message,
          text: truncateTelegramAiField(
            message?.text,
            LECTURE_SUGGESTION_MAX_TEXT_LENGTH,
          ),
          attachmentFileName: truncateTelegramAiField(
            message?.attachmentFileName,
            LECTURE_SUGGESTION_MAX_ATTACHMENT_LENGTH,
          ),
        }));
      const aiPrompt = [
        "Selected course object:",
        JSON.stringify(selectedCourseObject, null, 2),
        `Selected stored groups: ${groupReferences.length > 0 ? groupReferences.join(", ") : "all stored groups"}`,
        `Corpus summary: ${selectedCorpusMessages.length} stored messages matched scope; only the first ${limitedCorpusMessages.length} are included below for token control.`,
        "",
        "Full Telegram stored message corpus for the selected group scope:",
        ...limitedCorpusMessages.map((message, index) => {
          const dateLabel =
            Number(message?.date || 0) > 0
              ? new Date(Number(message.date)).toISOString()
              : "unknown";
          return [
            `Message ${index + 1}:`,
            `Date: ${dateLabel}`,
            `Group: ${normalizeString(message?.groupTitle || message?.groupReference) || "-"}`,
            `Text: ${normalizeString(message?.text) || "-"}`,
            `Attachment: ${normalizeString(message?.attachmentFileName) || "-"}`,
          ].join("\n");
        }),
      ].join("\n\n");

      const providerErrors = [];
      let provider = "";
      let aiReply = "[]";

      for (const candidateProvider of providerAttemptOrder) {
        try {
          aiReply =
            candidateProvider === "gemini"
              ? await createGeminiResponse({
                  instructions: aiInstructions,
                  input: aiPrompt,
                })
              : await createOpenAiResponse({
                  client: getOpenAiCompatibleClient(
                    candidateProvider,
                    groqClient,
                    openAiClient,
                    kimiClient,
                  ),
                  model: getOpenAiCompatibleModel(candidateProvider),
                  provider: candidateProvider,
                  instructions: aiInstructions,
                  input: aiPrompt,
                });
          provider = candidateProvider;
          break;
        } catch (error) {
          providerErrors.push({
            provider: candidateProvider,
            message: error?.message || "Unknown AI provider error.",
          });
        }
      }

      if (!provider) {
        return res.status(502).json({
          message: buildAiProviderFailureMessage(
            providerErrors,
            "Unable to complete lecture conceptualization.",
          ),
          provider: preferredProvider,
          attemptedProviders: providerErrors.map(({ provider: name }) => name),
        });
      }

      const aiLectures = parseJsonArrayFromAiReply(aiReply);
      const existingLectureKeys = listStoredLecturePredictionKeys(
        memoryDoc,
        lecturePredictionScope,
      );
      const lectureCandidates = await Promise.all(
        aiLectures.map(async (entry) => {
          const lectureTitle = normalizeString(entry?.title);
          const storedLecture = findStoredLectureForPrediction(
            selectedPlannerComponent,
            lectureTitle,
          );
          const lecturePages = Array.isArray(storedLecture?.content)
            ? storedLecture.content
            : Array.isArray(storedLecture?.pages)
              ? storedLecture.pages
              : Array.isArray(entry?.content)
                ? entry.content
                : Array.isArray(entry?.pages)
                  ? entry.pages
                  : [];
          const sourceMessageNumbers = normalizePredictionSourceMessageNumbers(
            entry?.sourceMessageNumbers,
          );
          const sourceMessages = sourceMessageNumbers
            .map((messageNumber) => {
              const sourceMessage = selectedCorpusMessages[messageNumber - 1];

              if (!sourceMessage) {
                return null;
              }

              return {
                ...sourceMessage,
                predictionReferenceCode: `MSG-${String(messageNumber).padStart(4, "0")}`,
              };
            })
            .filter(Boolean);
          const matchedPdfMessage =
            findCandidatePdfMessagesForLecture({
              lectureTitle,
              sourceMessages,
              corpusMessages: selectedCorpusMessages,
            })[0] || null;
          const pdfAttachment = buildPdfAttachmentFromMessage(matchedPdfMessage);

          if (isCourseLikeLectureTitle(lectureTitle, courseName, courseComponent)) {
            return null;
          }

          return buildLectureSuggestionPayload({
            lecture: {
              lecture_name: lectureTitle,
              lecture_course:
                buildSelectedLectureCourseLabel(courseName, courseComponent) ||
                courseName ||
                "-",
              lecture_courseName: courseName || "-",
              lecture_component: courseComponent || "-",
              lecture_instructors: Array.isArray(entry?.instructors)
                ? entry.instructors.map((value) => normalizeString(value)).filter(Boolean)
                : [],
              lecture_instructor: Array.isArray(entry?.instructors)
                ? entry.instructors.map((value) => normalizeString(value)).filter(Boolean)[0] || "-"
                : "-",
              lecture_writers: Array.isArray(entry?.writer)
                ? entry.writer.map((value) => normalizeString(value)).filter(Boolean)
                : [],
              lecture_writer: Array.isArray(entry?.writer)
                ? entry.writer.map((value) => normalizeString(value)).filter(Boolean)[0] || "-"
                : "-",
              prediction_writer_groups: Array.isArray(entry?.sourceGroups)
                ? entry.sourceGroups
                    .map((value) => normalizeString(value))
                    .filter(Boolean)
                : [],
              prediction_volume: normalizeString(entry?.volume),
              prediction_reference: normalizeString(entry?.reference),
              prediction_logic: normalizeString(entry?.predictionLogic),
              lecture_date:
                entry?.publishDate === null
                  ? ""
                  : normalizeString(entry?.publishDate),
              lecture_length: lecturePages.length,
              lecture_progress: 0,
            },
            matchingMessages: [],
            courseName,
            courseComponent,
            storedLecture,
            fallbackGroupLabels: selectedGroupLabels,
            sourceMessages,
            pdfAttachment,
          });
        }),
      );
      const lectures = lectureCandidates
        .filter((entry) => normalizeString(entry?.lectureName))
        .filter((entry) => {
          const suggestionKey = normalizeString(
            entry?.suggestionKey || entry?.lectureName,
          );

          if (!suggestionKey || existingLectureKeys.has(suggestionKey)) {
            return false;
          }

          existingLectureKeys.add(suggestionKey);
          return true;
        });

      const savedLectures = upsertStoredLecturePredictions({
        memoryDoc,
        scope: lecturePredictionScope,
        bucketName: "saved",
        lectures,
      });
      await memoryDoc.save();

      return res.status(200).json({
        provider,
        lectures: savedLectures.sort(
          (left, right) =>
            String(left?.lectureName || "").localeCompare(
              String(right?.lectureName || ""),
            ),
        ),
      });
    } catch (error) {
      return next(error);
    } finally {
      if (telegramClient) {
        try {
          await telegramClient.disconnect();
        } catch {}
      }
    }
  },
);

TelegramRouter.post(
  "/ai/lecture-suggestions/translate",
  checkAuth,
  async (req, res, next) => {
    try {
      const user = await UserModel.findById(req.authentication.userId).select("_id");

      if (!user) {
        return res.status(404).json({ message: "User not found." });
      }

      const targetLanguage = normalizeString(req.body?.language).toLowerCase();
      const lectures = Array.isArray(req.body?.lectures) ? req.body.lectures : [];

      if (targetLanguage !== "ar") {
        return res.status(200).json({ translations: [] });
      }

      const normalizedLectures = lectures
        .map((lecture) => buildLectureTranslationPayload(lecture))
        .filter((lecture) => lecture.id);

      if (normalizedLectures.length === 0) {
        return res.status(200).json({ translations: [] });
      }

      const aiSettingsDoc = await findAiSettingsLean(
        user._id,
        "settings.aiProvider",
      );
      const groqClient = getGroqClient();
      const openAiClient = getOpenAIClient();
      const kimiClient = getKimiClient();
      const preferredProvider = getPreferredAiProvider(
        req.body?.aiProvider || aiSettingsDoc?.settings?.aiProvider,
        groqClient,
        openAiClient,
        kimiClient,
      );
      const hasExplicitProvider = hasExplicitAiProviderSelection(
        req.body?.aiProvider || aiSettingsDoc?.settings?.aiProvider,
      );
      const providerAttemptOrder = buildProviderAttemptOrder(
        preferredProvider,
        groqClient,
        openAiClient,
        kimiClient,
        { allowFallback: !hasExplicitProvider },
      );

      if (providerAttemptOrder.length === 0) {
        return res.status(500).json({
          message: hasExplicitProvider
            ? getMissingProviderConfigurationMessage(preferredProvider)
            : DEFAULT_NO_PROVIDER_MESSAGE,
        });
      }

      const aiInstructions = [
        "Translate lecture table values into Arabic.",
        "Return only JSON.",
        "Return an array of objects with this exact shape:",
        '[{"id":"","lectureName":"","instructors":[""],"writerGroup":"","volume":"","reference":"","logic":""}]',
        "Translate human-readable text into Arabic.",
        "Keep ids unchanged.",
        "Keep course codes, filenames, abbreviations, and proper nouns when translation would be misleading.",
        "Do not add explanations.",
      ].join(" ");
      const aiPrompt = JSON.stringify(normalizedLectures, null, 2);

      const providerErrors = [];
      let aiReply = "[]";
      for (const candidateProvider of providerAttemptOrder) {
        try {
          aiReply =
            candidateProvider === "gemini"
              ? await createGeminiResponse({
                  instructions: aiInstructions,
                  input: aiPrompt,
                })
              : await createOpenAiResponse({
                  client: getOpenAiCompatibleClient(
                    candidateProvider,
                    groqClient,
                    openAiClient,
                    kimiClient,
                  ),
                  model: getOpenAiCompatibleModel(candidateProvider),
                  provider: candidateProvider,
                  instructions: aiInstructions,
                  input: aiPrompt,
                });
          break;
        } catch (error) {
          providerErrors.push({
            provider: candidateProvider,
            message: error?.message || "Unknown AI provider error.",
          });
        }
      }

      const translations = parseJsonArrayFromAiReply(aiReply)
        .map((entry) => ({
          id: normalizeString(entry?.id),
          lectureName: normalizeString(entry?.lectureName),
          instructors: Array.isArray(entry?.instructors)
            ? entry.instructors.map((value) => normalizeString(value)).filter(Boolean)
            : [],
          writerGroup: normalizeString(entry?.writerGroup),
          volume: normalizeString(entry?.volume),
          reference: normalizeString(entry?.reference),
          logic: normalizeString(entry?.logic),
        }))
        .filter((entry) => entry.id);

      if (translations.length === 0 && providerErrors.length > 0) {
        return res.status(502).json({
          message: buildAiProviderFailureMessage(
            providerErrors,
            "Unable to translate lecture conceptualizations.",
          ),
          translations: [],
        });
      }

      return res.status(200).json({ translations });
    } catch (error) {
      return next(error);
    }
  },
);

TelegramRouter.get("/storage/context", checkAuth, async (req, res, next) => {
  try {
    const cachedPayload = getTelegramFastCachedResponse(
      req.authentication.userId,
      "storage-context",
    );
    if (cachedPayload) {
      return res.status(200).json(cachedPayload);
    }
    const [user, telegramSettings] = await Promise.all([
      UserModel.findById(req.authentication.userId)
        .select("settings.telegram.status")
        .lean(),
      findTelegramSettings(req.authentication.userId),
    ]);

    if (!user) {
      return res.status(404).json({
        message: "User not found.",
      });
    }

    let memorySource = {};
    let flattenedCourses = [];
    let storedGroups = [];
    try {
      const [snapshot, groupsFromCollection] = await Promise.all([
        getTelegramStorageSnapshot({
          user,
          telegramSettings,
          includeCourses: true,
          timeoutMs: 5000,
        }),
        listStoredTelegramGroups(user, {}, telegramSettings),
      ]);
      memorySource = snapshot?.memoryDoc && typeof snapshot.memoryDoc === "object"
        ? snapshot.memoryDoc
        : {};
      flattenedCourses = Array.isArray(snapshot?.courses) ? snapshot.courses : [];
      storedGroups = groupsFromCollection;
    } catch (snapshotError) {
      const timeoutLike =
        String(snapshotError?.code || "").trim() === "TELEGRAM_TIMEOUT" ||
        String(snapshotError?.message || "").toLowerCase().includes("timed out");
      if (!timeoutLike) {
        throw snapshotError;
      }
      return res.status(200).json({
        groups: [],
        courses: [],
        importantMessages: [],
        sync: buildConfigStatusPayload(telegramSettings),
        processLoaders: getTelegramProcessLoaders(req.authentication.userId),
        warning: normalizeString(snapshotError?.message) || "Telegram storage context timed out.",
      });
    }
    const includeDebug = String(req.query?.debug || "").trim().toLowerCase() === "true";
    const rawTelegram =
      memorySource?.MOA?.telegram && typeof memorySource.MOA.telegram === "object"
        ? memorySource.MOA.telegram
        : {};
    const rawGroups = rawTelegram?.groups;
    const rawGroupEntries = Array.isArray(rawGroups)
      ? rawGroups.filter((entry) => entry && typeof entry === "object")
      : rawGroups && typeof rawGroups === "object"
        ? [rawGroups]
        : [];
    const rawMessagesCount = includeDebug
      ? rawGroupEntries.reduce((count, groupEntry) => {
          const buckets = getTelegramGroupContentBuckets(groupEntry);
          return (
            count +
            buckets.texts.length +
            buckets.photos.length +
            buckets.images.length +
            buckets.videos.length +
            buckets.audios.length +
            buckets.documents.length
          );
        }, 0)
      : 0;

    let storedMessagesCount = 0;
    if (includeDebug) {
      try {
        storedMessagesCount = await withFastTimeout(
          getStoredMessageCountForUser(user?._id, memorySource, telegramSettings),
          2000,
          "Telegram storage count request timed out.",
        );
      } catch {
        storedMessagesCount = 0;
      }
    }

    const payload = {
      groups: storedGroups,
      courses: flattenedCourses,
      importantMessages: [],
      sync: buildConfigStatusPayload(telegramSettings),
      processLoaders: getTelegramProcessLoaders(req.authentication.userId),
      debug: {
        userId: String(req.authentication.userId || ""),
        storedGroupsCount: Array.isArray(storedGroups) ? storedGroups.length : 0,
        storedMessagesCount,
        rawGroupsType: Array.isArray(rawGroups) ? "array" : typeof rawGroups,
        rawGroupsCount: rawGroupEntries.length,
        rawMessagesCount,
      },
    };
    setTelegramFastCachedResponse(
      req.authentication.userId,
      "storage-context",
      payload,
    );
    return res.status(200).json(payload);
  } catch (error) {
    return next(error);
  }
});

TelegramRouter.get(
  "/ai/lecture-suggestions",
  checkAuth,
  async (req, res, next) => {
    try {
      const user = await UserModel.findById(req.authentication.userId).select("_id");

      if (!user) {
        return res.status(404).json({ message: "User not found." });
      }

      const memoryDoc = await findUserMemoryLean(user._id, {
        includeTelegramMessages: true,
      });
      const scope = {
        allGroups: String(req.query?.allGroups || "").trim() === "true",
        acrossAllGroups:
          String(req.query?.acrossAllGroups || "").trim() === "true",
        groupReference: req.query?.groupReference,
        courseIdentity: req.query?.courseIdentity,
        courseName: req.query?.courseName,
        courseComponent: req.query?.courseComponent,
      };

      return res.status(200).json({
        lectures: listStoredLecturePredictions(memoryDoc, scope, "saved"),
      });
    } catch (error) {
      return next(error);
    }
  },
);

TelegramRouter.get(
  "/ai/lecture-suggestions/rejected",
  checkAuth,
  async (req, res, next) => {
    try {
      const user = await UserModel.findById(req.authentication.userId).select("_id");

      if (!user) {
        return res.status(404).json({ message: "User not found." });
      }

      const memoryDoc = await findUserMemoryLean(user._id, {
        includeTelegramMessages: true,
      });
      const scope = {
        allGroups: String(req.query?.allGroups || "").trim() === "true",
        acrossAllGroups:
          String(req.query?.acrossAllGroups || "").trim() === "true",
        groupReference: req.query?.groupReference,
        courseIdentity: req.query?.courseIdentity,
        courseName: req.query?.courseName,
        courseComponent: req.query?.courseComponent,
      };

      return res.status(200).json({
        lectures: listStoredLecturePredictions(memoryDoc, scope, "rejected"),
      });
    } catch (error) {
      return next(error);
    }
  },
);

TelegramRouter.get(
  "/ai/lecture-suggestions/accepted",
  checkAuth,
  async (req, res, next) => {
    try {
      const user = await UserModel.findById(req.authentication.userId).select("_id");

      if (!user) {
        return res.status(404).json({ message: "User not found." });
      }

      const memoryDoc = await findUserMemoryLean(user._id, {
        includeTelegramMessages: true,
      });
      const scope = {
        allGroups: String(req.query?.allGroups || "").trim() === "true",
        acrossAllGroups:
          String(req.query?.acrossAllGroups || "").trim() === "true",
        groupReference: req.query?.groupReference,
        courseIdentity: req.query?.courseIdentity,
        courseName: req.query?.courseName,
        courseComponent: req.query?.courseComponent,
      };

      return res.status(200).json({
        lectures: listStoredLecturePredictions(memoryDoc, scope, "accepted"),
      });
    } catch (error) {
      return next(error);
    }
  },
);

TelegramRouter.delete(
  "/ai/lecture-suggestions",
  checkAuth,
  async (req, res, next) => {
    try {
      const user = await UserModel.findById(req.authentication.userId).select(
        "memory",
      );

      if (!user) {
        return res.status(404).json({ message: "User not found." });
      }

      const [memoryDoc, telegramSettings] = await Promise.all([
        ensureUserMemoryDoc(user),
        findTelegramSettings(user._id),
      ]);
      const scope = {
        allGroups: String(req.query?.allGroups || "").trim() === "true",
        acrossAllGroups:
          String(req.query?.acrossAllGroups || "").trim() === "true",
        groupReference: req.query?.groupReference,
        courseIdentity: req.query?.courseIdentity,
        courseName: req.query?.courseName,
        courseComponent: req.query?.courseComponent,
      };
      const suggestionKey = normalizeString(
        req.query?.suggestionKey || req.body?.suggestionKey,
      );

      removeStoredLecturePrediction({
        memoryDoc,
        scope,
        bucketName: "saved",
        suggestionKey,
      });
      await memoryDoc.save();

      return res.status(200).json({
        message: suggestionKey
          ? "Stored lecture prediction deleted."
          : "Stored lecture predictions cleared.",
        lectures: listStoredLecturePredictions(memoryDoc, scope, "saved"),
      });
    } catch (error) {
      return next(error);
    }
  },
);

TelegramRouter.delete(
  "/ai/lecture-suggestions/rejected",
  checkAuth,
  async (req, res, next) => {
    try {
      const user = await UserModel.findById(req.authentication.userId).select(
        "memory",
      );

      if (!user) {
        return res.status(404).json({ message: "User not found." });
      }

      const memoryDoc = await ensureUserMemoryDoc(user);
      const scope = {
        allGroups: String(req.query?.allGroups || "").trim() === "true",
        acrossAllGroups:
          String(req.query?.acrossAllGroups || "").trim() === "true",
        groupReference: req.query?.groupReference,
        courseIdentity: req.query?.courseIdentity,
        courseName: req.query?.courseName,
        courseComponent: req.query?.courseComponent,
      };

      removeStoredLecturePrediction({
        memoryDoc,
        scope,
        bucketName: "rejected",
      });
      await memoryDoc.save();

      return res.status(200).json({
        lectures: [],
      });
    } catch (error) {
      return next(error);
    }
  },
);

TelegramRouter.delete(
  "/ai/lecture-suggestions/accepted",
  checkAuth,
  async (req, res, next) => {
    try {
      const user = await UserModel.findById(req.authentication.userId).select(
        "memory",
      );

      if (!user) {
        return res.status(404).json({ message: "User not found." });
      }

      const memoryDoc = await ensureUserMemoryDoc(user);
      const scope = {
        allGroups: String(req.query?.allGroups || "").trim() === "true",
        acrossAllGroups:
          String(req.query?.acrossAllGroups || "").trim() === "true",
        groupReference: req.query?.groupReference,
        courseIdentity: req.query?.courseIdentity,
        courseName: req.query?.courseName,
        courseComponent: req.query?.courseComponent,
      };

      removeStoredLecturePrediction({
        memoryDoc,
        scope,
        bucketName: "accepted",
      });
      await memoryDoc.save();

      return res.status(200).json({
        lectures: [],
      });
    } catch (error) {
      return next(error);
    }
  },
);

TelegramRouter.post(
  "/ai/lecture-suggestions/feedback",
  checkAuth,
  async (req, res, next) => {
    try {
      const user = await UserModel.findById(req.authentication.userId).select(
        "memory",
      );

      if (!user) {
        return res.status(404).json({ message: "User not found." });
      }

      const memoryDoc = await ensureUserMemoryDoc(user);
      const decision = normalizeString(req.body?.decision).toLowerCase();
      const suggestion =
        req.body?.suggestion && typeof req.body.suggestion === "object"
          ? req.body.suggestion
          : null;
      const scope = {
        allGroups: Boolean(req.body?.allGroups),
        acrossAllGroups: Boolean(req.body?.acrossAllGroups),
        groupReference: req.body?.groupReference,
        courseIdentity: req.body?.courseIdentity,
        courseName: req.body?.courseName,
        courseComponent: req.body?.courseComponent,
      };

      if (!suggestion) {
        return res.status(400).json({ message: "Lecture suggestion is required." });
      }

      if (!["accepted", "rejected"].includes(decision)) {
        return res.status(400).json({ message: "Invalid lecture decision." });
      }

      const targetBucket = decision === "accepted" ? "accepted" : "rejected";

      moveStoredLecturePrediction({
        memoryDoc,
        scope,
        fromBucket: "saved",
        toBucket: targetBucket,
        suggestion,
      });
      await memoryDoc.save();

      return res.status(200).json({
        message:
          decision === "accepted"
            ? "Lecture prediction accepted."
            : "Lecture prediction rejected.",
        lectures: listStoredLecturePredictions(memoryDoc, scope, targetBucket),
      });
    } catch (error) {
      return next(error);
    }
  },
);

TelegramRouter.get("/config", checkAuth, async (req, res, next) => {
  try {
    const cachedPayload = getTelegramFastCachedResponse(
      req.authentication.userId,
      "config",
    );
    if (cachedPayload) {
      return res.status(200).json(cachedPayload);
    }
    const [user, telegramSettings] = await Promise.all([
      UserModel.findById(req.authentication.userId)
        .select("_id settings.telegram.status")
        .lean(),
      findTelegramSettings(req.authentication.userId),
    ]);

    if (!user) {
      return res.status(404).json({
        message: "User not found.",
      });
    }

    let storedCount = 0;
    try {
      const memoryDoc = await withFastTimeout(
        findUserMemoryLean(req.authentication.userId, {
          includeCourses: false,
          includeLectures: false,
        }),
        3500,
        "Telegram stored count request timed out.",
      );
      storedCount = await getStoredMessageCountForUser(
        req.authentication.userId,
        memoryDoc,
        telegramSettings,
      );
    } catch {
      storedCount = 0;
    }

    const payload = {
      ...buildConfigStatusPayload(telegramSettings),
      storedCount,
      processLoaders: getTelegramProcessLoaders(req.authentication.userId),
    };
    setTelegramFastCachedResponse(req.authentication.userId, "config", payload);
    return res.status(200).json(payload);
  } catch (error) {
    if (String(error?.code || "").trim() === "TELEGRAM_TIMEOUT") {
      return res.status(200).json({
        configured: false,
        hasApiId: false,
        hasApiHash: false,
        hasStringSession: false,
        pageUrl: "",
        groupReference: "",
        syncMode: "live",
        syncEnabled: false,
        historyStartDate: null,
        historyEndDate: null,
        storeContent: normalizeTelegramStoreContent({}),
        storedCount: 0,
        processLoaders: getTelegramProcessLoaders(req.authentication.userId),
        warning: normalizeString(error?.message) || "Telegram config timed out.",
      });
    }
    next(error);
  }
});

TelegramRouter.get("/status", checkAuth, async (req, res, next) => {
  try {
    const liveSyncStatus = getTelegramSyncStatus(req.authentication.userId);
    const shouldBypassCache = Boolean(liveSyncStatus?.running);
    const cachedPayload = getTelegramFastCachedResponse(
      req.authentication.userId,
      "status",
    );
    if (cachedPayload && !shouldBypassCache) {
      return res.status(200).json(cachedPayload);
    }
    const [user, telegramSettings] = await Promise.all([
      UserModel.findById(req.authentication.userId)
        .select("_id settings.telegram.status")
        .lean(),
      findTelegramSettings(req.authentication.userId),
    ]);

    if (!user) {
      return res.status(404).json({
        message: "User not found.",
      });
    }

    let storedCount = 0;
    let storedGroupsCount = 0;
    try {
      const memoryDoc = await withFastTimeout(
        findUserMemoryLean(req.authentication.userId, {
          includeCourses: false,
          includeLectures: false,
        }),
        3500,
        "Telegram status memory request timed out.",
      );
      storedCount = await getStoredMessageCountForUser(
        req.authentication.userId,
        memoryDoc,
        telegramSettings,
      );
      storedGroupsCount = listTelegramGroupMemoryEntries(memoryDoc).length;
    } catch {
      storedCount = 0;
      storedGroupsCount = 0;
    }

    const payload = {
      ...buildConfigStatusPayload(telegramSettings),
      storedCount,
      storedGroups: storedGroupsCount,
      syncStatus: liveSyncStatus,
      processLoaders: getTelegramProcessLoaders(req.authentication.userId),
    };
    if (!shouldBypassCache) {
      setTelegramFastCachedResponse(req.authentication.userId, "status", payload);
    }
    return res.status(200).json(payload);
  } catch (error) {
    if (String(error?.code || "").trim() === "TELEGRAM_TIMEOUT") {
      return res.status(200).json({
        configured: false,
        hasApiId: false,
        hasApiHash: false,
        hasStringSession: false,
        pageUrl: "",
        groupReference: "",
        syncMode: "live",
        syncEnabled: false,
        historyStartDate: null,
        historyEndDate: null,
        storeContent: normalizeTelegramStoreContent({}),
        storedCount: 0,
        storedGroups: 0,
        syncStatus: getTelegramSyncStatus(req.authentication.userId),
        processLoaders: getTelegramProcessLoaders(req.authentication.userId),
        warning: normalizeString(error?.message) || "Telegram status timed out.",
      });
    }
    next(error);
  }
});

TelegramRouter.post("/config", checkAuth, async (req, res, next) => {
  setTelegramProcessLoader(req.authentication.userId, "config", true);
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
    const nextSyncEnabled = Boolean(req.body?.syncEnabled);
    const nextHistoryStartDate = parseDateInput(req.body?.historyStartDate);
    const nextHistoryEndDate = parseDateInput(req.body?.historyEndDate);
    const nextStoreContent = normalizeTelegramStoreContent(req.body?.storeContent);
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

    telegramStatus.pageUrl = nextPageUrl;
    telegramStatus.groupReference = nextGroupReference;
    telegramStatus.syncMode = nextSyncMode;
    telegramStatus.historyStartDate = nextHistoryStartDate;
    telegramStatus.historyEndDate = nextHistoryEndDate;
    telegramStatus.storeContent = nextStoreContent;

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
      nextSyncEnabled && nextGroupReference && hasCredentials,
    );
    telegramStatus.updatedAt = new Date();

    if (nextGroupReference) {
      let groupMetadata = null;
      if (hasCredentials) {
        let metadataClient = null;
        try {
          metadataClient = await ensureTelegramClient(
            getUserTelegramConfig(telegramSettings),
          );
          const metadataEntity = await resolveTelegramGroupEntity(
            metadataClient,
            nextGroupReference,
          );
          groupMetadata = await getTelegramGroupMetadata(
            metadataClient,
            metadataEntity,
            nextGroupReference,
          );
        } catch (error) {
          return res.status(400).json({
            message:
              normalizeString(error?.message) ||
              "Unable to fetch Telegram group metadata for this reference.",
          });
        } finally {
          if (metadataClient) {
            try {
              await metadataClient.disconnect();
            } catch {}
          }
        }
      }

      // Upsert group metadata into telegram_stored_groups (no messages yet).
      await TelegramStoredMessageModel.updateOne(
        { groupReference: nextGroupReference },
        {
          $set: {
            groupTitle: normalizeString(groupMetadata?.name) || nextGroupReference,
            groupUsername: normalizeString(groupMetadata?.username),
            groupType: normalizeString(groupMetadata?.type || "group") || "group",
            memberCount: Number.isFinite(Number(groupMetadata?.memberCount))
              ? Number(groupMetadata.memberCount)
              : 0,
            description: normalizeString(groupMetadata?.description),
            pageUrl: normalizePageUrl(nextPageUrl || groupMetadata?.pageUrl || ""),
          },
          $setOnInsert: {
            groupReference: nextGroupReference,
            messages: [],
          },
        },
        { upsert: true },
      );
    }

    await telegramSettings.save();
    clearTelegramFastCachedResponsesForUser(req.authentication.userId);

    return res.status(200).json({
      message: "Telegram settings saved for this user.",
      importStarted: false,
      importSucceeded: false,
      importReason: "",
      syncStarted: false,
      syncSucceeded: false,
      syncReason: "",
      importedCount: 0,
      scannedCount: 0,
      ...buildConfigStatusPayload(telegramSettings),
      storedCount: await getStoredMessageCountForUser(user._id, memoryDoc, telegramSettings),
      syncStatus: getTelegramSyncStatus(user._id),
      processLoaders: getTelegramProcessLoaders(req.authentication.userId),
    });
  } catch (error) {
    next(error);
  } finally {
    setTelegramProcessLoader(req.authentication.userId, "config", false);
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
      autoReconnect: false,
      connectionRetries: 5,
      timeout: TELEGRAM_CONNECT_TIMEOUT_MS,
    });
    client.setLogLevel(LogLevel.NONE);

    try {
      await runWithTimeout(
        client.connect(),
        TELEGRAM_CONNECT_TIMEOUT_MS,
        "Telegram connection timed out while starting login.",
      );
      const sendCodeResult = await runWithTimeout(
        client.sendCode({ apiId, apiHash }, phoneNumber, false),
        TELEGRAM_CONNECT_TIMEOUT_MS,
        "Telegram took too long to send the login code.",
      );

      setPendingTelegramAuth(req.authentication.userId, {
        client,
        apiId,
        apiHash,
        phoneNumber,
        phoneCodeHash: sendCodeResult.phoneCodeHash,
        isCodeViaApp: Boolean(sendCodeResult.isCodeViaApp),
      });
      clearTelegramFastCachedResponsesForUser(req.authentication.userId);

      return res.status(200).json({
        message: "Telegram login code sent.",
        isCodeViaApp: Boolean(sendCodeResult.isCodeViaApp),
        requiresPassword: false,
      });
    } catch (error) {
      try {
        await client.disconnect();
      } catch {}
      throw error;
    }
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
        clearTelegramFastCachedResponsesForUser(req.authentication.userId);

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
      clearTelegramFastCachedResponsesForUser(req.authentication.userId);
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
  const includeLiveScan = String(req.query?.live || "").trim().toLowerCase() === "true";
  if (includeLiveScan) {
    setTelegramProcessLoader(req.authentication.userId, "groupsLive", true);
  }
  try {
    if (!includeLiveScan) {
      const cachedPayload = getTelegramFastCachedResponse(
        req.authentication.userId,
        "groups",
      );
      if (cachedPayload) {
        return res.status(200).json(cachedPayload);
      }
    }
    const [user, telegramSettings] = await Promise.all([
      UserModel.findById(req.authentication.userId)
        .select("settings.telegram.status")
        .lean(),
      findTelegramSettings(req.authentication.userId),
    ]);

    if (!user) {
      return res.status(404).json({
        message: "User not found.",
      });
    }

    const snapshot = await getTelegramStorageSnapshot({
      user,
      telegramSettings,
      includeCourses: true,
      timeoutMs: 5000,
    });
    const memoryDoc =
      snapshot?.memoryDoc && typeof snapshot.memoryDoc === "object"
        ? snapshot.memoryDoc
        : {};
    const storedGroups = Array.isArray(snapshot?.groups) ? snapshot.groups : [];
    const storedGroupOptions = (Array.isArray(storedGroups) ? storedGroups : []).map(
      (group) => ({
        groupReference: normalizeGroupReference(group?.groupReference),
        title: normalizeString(group?.title) || normalizeString(group?.groupReference),
        username: normalizeString(group?.username),
        type: normalizeString(group?.type || "group") || "group",
        storedCount: Number(group?.storedCount || 0),
        latestDateMs: Number(group?.latestDateMs || 0),
      }),
    );

    let result = { groups: storedGroupOptions, warning: "" };
    if (includeLiveScan) {
      try {
        result = await withFastTimeout(
          buildLiveGroupsResponse(user, telegramSettings),
          TELEGRAM_BOOTSTRAP_TIMEOUT_MS,
          "Telegram live groups request timed out.",
        );
      } catch (error) {
        result = {
          groups: storedGroupOptions,
          warning:
            normalizeString(error?.message) ||
            "Live Telegram groups are currently unavailable. Showing stored groups.",
        };
      }
    }
    const mergedGroups = Array.isArray(result?.groups) ? result.groups : [];
    const knownReferences = new Set(
      mergedGroups.map((group) => normalizeGroupReference(group?.groupReference)).filter(Boolean),
    );
    const nextGroups = [
      ...mergedGroups,
      ...storedGroupOptions.filter(
        (group) => !knownReferences.has(normalizeGroupReference(group?.groupReference)),
      ),
    ];
    const payload = {
      ...result,
      groups: nextGroups,
      courses: Array.isArray(snapshot?.courses) ? snapshot.courses : [],
      processLoaders: getTelegramProcessLoaders(req.authentication.userId),
    };
    if (!includeLiveScan) {
      setTelegramFastCachedResponse(req.authentication.userId, "groups", payload);
    }
    return res.status(200).json(payload);
  } catch (error) {
    next(error);
  } finally {
    if (includeLiveScan) {
      setTelegramProcessLoader(req.authentication.userId, "groupsLive", false);
    }
  }
});

TelegramRouter.get("/stored-groups", checkAuth, async (req, res, next) => {
  setTelegramProcessLoader(req.authentication.userId, "storedGroups", true);
  try {
    const [user, telegramSettings] = await Promise.all([
      UserModel.findById(req.authentication.userId)
        .select("settings.telegram.status")
        .lean(),
      findTelegramSettings(req.authentication.userId),
    ]);

    if (!user) {
      return res.status(404).json({
        message: "User not found.",
      });
    }

    const snapshot = await getTelegramStorageSnapshot({
      user,
      telegramSettings,
      includeCourses: true,
      timeoutMs: 5000,
    });
    const memoryDoc =
      snapshot?.memoryDoc && typeof snapshot.memoryDoc === "object"
        ? snapshot.memoryDoc
        : {};

    // Use the full async listing so groups stored in telegram_stored_groups
    // are always included, not just those tracked in the memory doc.
    const groups = await listStoredTelegramGroups(user, memoryDoc, telegramSettings);

    return res.status(200).json({
      groups,
      courses: Array.isArray(snapshot?.courses)
        ? snapshot.courses
        : getStoredPlannerCoursesPayload(memoryDoc),
      processLoaders: getTelegramProcessLoaders(req.authentication.userId),
    });
  } catch (error) {
    next(error);
  } finally {
    setTelegramProcessLoader(req.authentication.userId, "storedGroups", false);
  }
});

TelegramRouter.delete(
  "/stored-groups/:groupReference",
  checkAuth,
  async (req, res, next) => {
    setTelegramProcessLoader(req.authentication.userId, "deleteGroup", true);
    try {
      const user = await UserModel.findById(req.authentication.userId).select(
        "settings.telegram.status memory",
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

      let deletedGroup = false;
      let deletedMessages = 0;

      const groupDocToDelete = await TelegramStoredMessageModel.findOne(
        { groupReference: normalizedReference },
        { messages: 1 },
      ).lean();
      const deletedMessageResult = await TelegramStoredMessageModel.deleteOne({
        groupReference: normalizedReference,
      });
      deletedMessages = groupDocToDelete?.messages?.length || 0;
      if (!deletedMessages && Number(deletedMessageResult?.deletedCount || 0) > 0) {
        deletedMessages = 1;
      }
      deletedGroup = Number(deletedMessageResult?.deletedCount || 0) > 0 || deletedMessages > 0;

      const responseMemoryDoc = await findUserMemoryLean(user._id);
      const telegramSettings = await findTelegramSettings(user._id);

      clearTelegramFastCachedResponsesForUser(req.authentication.userId);
      return res.status(200).json({
        message: deletedGroup ? "Stored group deleted." : "Stored group not found.",
        groupReference: normalizedReference,
        deletedCount: deletedMessages,
        groups: await listStoredTelegramGroups(user, responseMemoryDoc, telegramSettings),
        courses: getStoredPlannerCoursesPayload(responseMemoryDoc),
        processLoaders: getTelegramProcessLoaders(req.authentication.userId),
      });
    } catch (error) {
      const message = normalizeString(error?.message || "");
      const isDatabaseConnectivityError =
        message.toLowerCase().includes("timed out") ||
        message.toLowerCase().includes("replicasetnoprimary") ||
        message.toLowerCase().includes("mongonetwork");

      if (isDatabaseConnectivityError) {
        return res.status(503).json({
          message:
            "Database connection timed out while deleting the stored group. Retry the request.",
        });
      }

      next(error);
    } finally {
      setTelegramProcessLoader(req.authentication.userId, "deleteGroup", false);
    }
  },
);

TelegramRouter.post(
  "/stored-groups/:groupReference/sync",
  checkAuth,
  async (req, res, next) => {
    setTelegramProcessLoader(req.authentication.userId, "sync", true);
    try {
      const [user, telegramSettings] = await Promise.all([
        UserModel.findById(req.authentication.userId).select("settings.telegram.status memory"),
        findTelegramSettings(req.authentication.userId),
      ]);

      if (!user) {
        return res.status(404).json({
          message: "User not found.",
        });
      }

      const normalizedReference = normalizeGroupReference(req.params.groupReference);
      const continueMigration = Boolean(
        req.body?.continueMigration ?? req.body?.syncEnabled,
      );

      if (!normalizedReference) {
        return res.status(400).json({
          message: "Stored conversation reference is required.",
        });
      }

      if (!telegramSettings) {
        return res.status(404).json({
          message: "Telegram settings not found.",
        });
      }

      const memoryDoc = await findUserMemoryLean(user._id);
      const storedGroups = await listStoredTelegramGroups(
        user,
        memoryDoc,
        telegramSettings,
      );

      const telegramStatus = telegramSettings.status;
      const hasCredentials = Boolean(
        telegramStatus.apiIdEncrypted &&
          telegramStatus.apiHashEncrypted &&
          telegramStatus.stringSessionEncrypted,
      );

      if (continueMigration && !hasCredentials) {
        return res.status(400).json({
          message: "Telegram credentials are required before enabling sync.",
        });
      }

      telegramStatus.groupReference = normalizedReference;
      telegramStatus.syncMode = "one-time";
      telegramStatus.syncEnabled = false;
      telegramStatus.updatedAt = new Date();
      await telegramSettings.save();

      let syncResult = null;
      let responseMessage = "Stored group sync disabled.";

      if (continueMigration) {
        try {
          syncResult = await syncTelegramMessagesForUser(user._id, { force: true });
          responseMessage =
            normalizeString(syncResult?.message) || "Stored group migration completed.";
        } catch (error) {
          responseMessage = `Stored group migration failed: ${normalizeString(
            error?.message || "Unknown Telegram sync error.",
          )}`;
        }
      }

      const responseMemoryDoc = continueMigration
        ? await findUserMemoryLean(user._id)
        : memoryDoc;

      clearTelegramFastCachedResponsesForUser(req.authentication.userId);
      return res.status(200).json({
        message: responseMessage,
        groupReference: normalizedReference,
        syncEnabled: false,
        syncStarted: Boolean(continueMigration),
        syncSucceeded: Boolean(syncResult?.synced),
        syncReason: normalizeString(syncResult?.reason),
        importedCount: Number(syncResult?.importedCount || 0),
        scannedCount: Number(syncResult?.scannedCount || 0),
        storedCount: await getStoredMessageCountForUser(
          user._id,
          responseMemoryDoc,
          telegramSettings,
        ),
        groups: await listStoredTelegramGroups(user, responseMemoryDoc, telegramSettings),
        courses: getStoredPlannerCoursesPayload(responseMemoryDoc),
        processLoaders: getTelegramProcessLoaders(req.authentication.userId),
      });
    } catch (error) {
      next(error);
    } finally {
      setTelegramProcessLoader(req.authentication.userId, "sync", false);
    }
  },
);

TelegramRouter.post(
  "/stored-groups/:groupReference/control",
  checkAuth,
  async (req, res, next) => {
    setTelegramProcessLoader(req.authentication.userId, "control", true);
    try {
      const user = await UserModel.findById(req.authentication.userId).select("_id");
      if (!user) {
        return res.status(404).json({ message: "User not found." });
      }

      const normalizedReference = normalizeGroupReference(req.params.groupReference);
      const action = normalizeString(req.body?.action).toLowerCase();
      if (!normalizedReference) {
        return res.status(400).json({
          message: "Stored conversation reference is required.",
        });
      }
      if (!["play", "pause", "stop"].includes(action)) {
        return res.status(400).json({
          message: "Invalid control action.",
        });
      }

      const currentStatus = getTelegramSyncStatus(user._id);
      const statusReference = normalizeGroupReference(currentStatus?.groupReference);
      if (statusReference && statusReference !== normalizedReference) {
        return res.status(409).json({
          message: "Another group is currently targeted by sync.",
        });
      }

      const control = setTelegramSyncControl(user._id, action);
      if (action === "pause") {
        setTelegramSyncStatus(user._id, { running: true, reason: "paused" });
      } else if (action === "play") {
        setTelegramSyncStatus(user._id, { running: true, reason: "running" });
      } else if (action === "stop") {
        setTelegramSyncStatus(user._id, { reason: "stopping" });
      }

      clearTelegramFastCachedResponsesForUser(req.authentication.userId);
      return res.status(200).json({
        message: `Sync control set to ${control}.`,
        control,
        syncStatus: getTelegramSyncStatus(user._id),
        processLoaders: getTelegramProcessLoaders(req.authentication.userId),
      });
    } catch (error) {
      return next(error);
    } finally {
      setTelegramProcessLoader(req.authentication.userId, "control", false);
    }
  },
);

TelegramRouter.post(
  "/stored-groups/:groupReference/backfill-photos",
  checkAuth,
  async (req, res, next) => {
    setTelegramProcessLoader(req.authentication.userId, "backfillPhotos", true);
    try {
      const user = await UserModel.findById(req.authentication.userId).select(
        "memory",
      );

      if (!user) {
        return res.status(404).json({ message: "User not found." });
      }

      const normalizedReference = normalizeGroupReference(req.params.groupReference);
      if (!normalizedReference) {
        return res.status(400).json({
          message: "Stored conversation reference is required.",
        });
      }

      const memoryDoc = await findUserMemoryLean(user._id);
      let photoMessages = (
        await listStoredTelegramMessagesFromCollection(user._id, normalizedReference)
      ).filter((entry) => normalizeString(entry?.attachmentKind).toLowerCase() === "photo");
      if (photoMessages.length === 0 && getExpectedStoredMessageCount(memoryDoc, normalizedReference) > 0) {
        await migrateStoredTelegramMessagesToCollection({
          userId: user._id,
          memoryDoc,
        });
        photoMessages = (
          await listStoredTelegramMessagesFromCollection(user._id, normalizedReference)
        ).filter((entry) => normalizeString(entry?.attachmentKind).toLowerCase() === "photo");
      }

      return res.status(200).json({
        message:
          "Inline photo backfill is disabled. Telegram media is fetched on demand via stored-media.",
        groupReference: normalizedReference,
        attempted: photoMessages.length,
        filled: 0,
        failed: 0,
        processLoaders: getTelegramProcessLoaders(req.authentication.userId),
      });
    } catch (error) {
      next(error);
    } finally {
      setTelegramProcessLoader(req.authentication.userId, "backfillPhotos", false);
    }
  },
);

TelegramRouter.get("/group-messages", checkAuth, handleStoredMessagesRequest);
TelegramRouter.get(
  "/stored-group-messages",
  checkAuth,
  handleStoredMessagesRequest,
);

TelegramRouter.get("/stored-media", checkAuth, async (req, res, next) => {
  let client = null;
  try {
    const user = await UserModel.findById(req.authentication.userId).select(
      "settings.telegram.status memory",
    );
    const telegramSettings = await findTelegramSettings(req.authentication.userId);

    if (!user) {
      return res.status(404).json({ message: "User not found." });
    }

    const groupReference = normalizeGroupReference(
      req.query.group || req.query.groupReference,
    );
    const messageId = Number.parseInt(String(req.query.messageId || "").trim(), 10);

    if (!groupReference || !Number.isInteger(messageId) || messageId <= 0) {
      return res.status(400).json({
        message: "groupReference and messageId are required.",
      });
    }

    const memoryDoc = await findUserMemoryLean(user._id);
    const storedMessage = await findStoredTelegramMessage(
      user._id,
      memoryDoc,
      groupReference,
      messageId,
    );
    if (!storedMessage) {
      return res.status(404).json({
        message: "Media not found.",
        reason: "stored-message-mismatch",
        groupReference,
        messageId,
      });
    }

    const attachmentKind = normalizeString(storedMessage?.attachmentKind).toLowerCase();
    const inlineMediaDataUrl =
      attachmentKind === "photo"
        ? normalizeString(storedMessage?.photoDataUrl)
        : attachmentKind === "video"
          ? normalizeString(storedMessage?.videoDataUrl)
          : attachmentKind === "document" || attachmentKind === "pdf"
            ? normalizeString(storedMessage?.documentDataUrl)
            : "";
    if (inlineMediaDataUrl.startsWith("data:")) {
      const separatorIndex = inlineMediaDataUrl.indexOf(",");
      if (separatorIndex > -1) {
        const header = inlineMediaDataUrl.slice(0, separatorIndex);
        const base64Payload = inlineMediaDataUrl.slice(separatorIndex + 1);
        const headerMatch = header.match(/^data:([^;]+);base64$/i);
        if (headerMatch && base64Payload) {
          const inlineBuffer = Buffer.from(base64Payload, "base64");
          if (inlineBuffer.length > 0) {
            res.setHeader("Content-Type", headerMatch[1] || "application/octet-stream");
            res.setHeader("Cache-Control", "private, max-age=120");
            return res.status(200).send(inlineBuffer);
          }
        }
      }
    }

    const config = getUserTelegramConfig(telegramSettings);
    const hasCredentials = Boolean(
      config.apiId && config.apiHash && config.stringSession,
    );

    if (!hasCredentials) {
      return res.status(400).json({
        message: "Telegram credentials are required to render media.",
      });
    }

    client = await withFastTimeout(
      ensureTelegramClient(config),
      25000,
      "Telegram connection timed out.",
    );
    const mediaTimeoutMs = attachmentKind === "photo" ? 30000 : 45000;
    const media = await withFastTimeout(
      downloadTelegramMessageMedia({
        client,
        groupReference,
        messageId,
        groupUsername: normalizeString(storedMessage?.groupUsername),
      }),
      mediaTimeoutMs,
      "Telegram media fetch timed out.",
    );

    if (!media?.buffer) {
      return res.status(404).json({
        message: "Media not found.",
        reason: "telegram-download-empty",
        groupReference,
        messageId,
      });
    }

    res.setHeader("Content-Type", media.mimeType || "application/octet-stream");
    res.setHeader("Cache-Control", "private, max-age=120");
    return res.status(200).send(media.buffer);
  } catch (error) {
    const normalizedErrorCode = normalizeString(error?.code || "").toLowerCase();
    const reason =
      normalizedErrorCode === "telegram_timeout"
        ? "telegram-timeout"
        : normalizedErrorCode || "telegram-download-failed";
    return res.status(404).json({
      message: normalizeString(error?.message) || "Media not found.",
      reason,
    });
  } finally {
    if (client) {
      try {
        await client.disconnect();
      } catch {}
    }
  }
});

TelegramRouter.use("/stored-group-pdfs", checkAuth, respondStorageOnly);
TelegramRouter.use("/storage", checkAuth, respondStorageOnly);
TelegramRouter.use("/ai", checkAuth, respondStorageOnly);
TelegramRouter.use("/important-messages", checkAuth, respondStorageOnly);
TelegramRouter.use("/important-message-concept", checkAuth, respondStorageOnly);
TelegramRouter.use("/send-note", checkAuth, respondStorageOnly);

export default TelegramRouter;
