import nodemailer from "nodemailer";
import UserModel from "../compat/UserModel.js";

const sentAtByRecipientKey = new Map();
const inFlightRecipientKeys = new Set();
const DEFAULT_COOLDOWN_MS = 10 * 60 * 1000;
const DEFAULT_RECIPIENT_USERNAME = "rudyhamame";
const DEFAULT_SMTP_CONNECTION_TIMEOUT_MS = 30 * 1000;
const DEFAULT_SMTP_GREETING_TIMEOUT_MS = 30 * 1000;
const DEFAULT_SMTP_SOCKET_TIMEOUT_MS = 60 * 1000;

const trimText = (value) => String(value ?? "").trim();
const getTimeoutMs = (value, fallback) => {
  const normalized = Number(value);
  return Number.isFinite(normalized) && normalized > 0 ? normalized : fallback;
};

const normalizeUserId = (value) => trimText(value);

const getRelationshipEntries = (user) => {
  if (!user || typeof user !== "object") {
    return [];
  }

  if (Array.isArray(user.connections) && user.connections.length > 0) {
    return user.connections;
  }

  if (Array.isArray(user.friends) && user.friends.length > 0) {
    return user.friends;
  }

  return [];
};

const getFriendIds = (user) =>
  Array.from(
    new Set(
      getRelationshipEntries(user)
        .map((entry) => {
          if (!entry) {
            return "";
          }

          const candidate =
            typeof entry === "object" && entry !== null
              ? entry.id || entry.userID || entry._id || entry
              : entry;
          const normalized =
            typeof candidate === "object" && candidate !== null
              ? candidate._id || candidate
              : candidate;

          return normalizeUserId(normalized);
        })
        .filter(Boolean),
    ),
  );

const getRecipientUsername = () =>
  trimText(
    process.env.STUDY_STATUS_EMAIL_RECIPIENT_USERNAME ||
      DEFAULT_RECIPIENT_USERNAME,
  ).toLowerCase();

const getDisplayName = (user) => {
  const firstname = trimText(user?.profile?.firstname);
  const lastname = trimText(user?.profile?.lastname);
  const fullName = [firstname, lastname].filter(Boolean).join(" ").trim();
  if (fullName) {
    return fullName;
  }

  const username = trimText(user?.auth?.username);
  if (username) {
    return username;
  }

  const email = trimText(user?.profile?.email);
  if (email) {
    return email;
  }

  return "A friend";
};

const resolveCooldownMs = () => {
  const rawValue = Number(process.env.STUDY_STATUS_EMAIL_COOLDOWN_MS);
  return Number.isFinite(rawValue) && rawValue >= 0
    ? rawValue
    : DEFAULT_COOLDOWN_MS;
};

const resolveTransportConfig = () => {
  const host = trimText(process.env.EMAIL_SMTP_HOST || process.env.SMTP_HOST);
  const port = Number(process.env.EMAIL_SMTP_PORT || process.env.SMTP_PORT || 587);
  const username = trimText(process.env.EMAIL_SMTP_USER || process.env.SMTP_USER);
  const password = trimText(process.env.EMAIL_SMTP_PASS || process.env.SMTP_PASS);
  const fromAddress = trimText(
    process.env.EMAIL_FROM_ADDRESS ||
      process.env.SMTP_FROM ||
      process.env.EMAIL_SMTP_USER ||
      process.env.SMTP_USER,
  );

  if (!host || !username || !password || !fromAddress) {
    return null;
  }

  const secureEnv = String(
    process.env.EMAIL_SMTP_SECURE ?? process.env.SMTP_SECURE ?? "",
  )
    .trim()
    .toLowerCase();
  const secure =
    secureEnv === "true"
      ? true
      : secureEnv === "false"
        ? false
        : port === 465;

  return {
    host,
    port,
    secure,
    auth: {
      user: username,
      pass: password,
    },
    fromAddress,
  };
};

let cachedTransport = null;
let cachedTransportSignature = "";

const getTransporter = () => {
  const transportConfig = resolveTransportConfig();
  if (!transportConfig) {
    return null;
  }

  const signature = JSON.stringify({
    host: transportConfig.host,
    port: transportConfig.port,
    secure: transportConfig.secure,
    user: transportConfig.auth.user,
    fromAddress: transportConfig.fromAddress,
  });

  if (cachedTransport && cachedTransportSignature === signature) {
    return cachedTransport;
  }

  cachedTransportSignature = signature;
  cachedTransport = nodemailer.createTransport({
    host: transportConfig.host,
    port: transportConfig.port,
    secure: transportConfig.secure,
    auth: transportConfig.auth,
    connectionTimeout: getTimeoutMs(
      process.env.EMAIL_SMTP_CONNECTION_TIMEOUT_MS ||
        process.env.SMTP_CONNECTION_TIMEOUT_MS,
      DEFAULT_SMTP_CONNECTION_TIMEOUT_MS,
    ),
    greetingTimeout: getTimeoutMs(
      process.env.EMAIL_SMTP_GREETING_TIMEOUT_MS ||
        process.env.SMTP_GREETING_TIMEOUT_MS,
      DEFAULT_SMTP_GREETING_TIMEOUT_MS,
    ),
    socketTimeout: getTimeoutMs(
      process.env.EMAIL_SMTP_SOCKET_TIMEOUT_MS ||
        process.env.SMTP_SOCKET_TIMEOUT_MS,
      DEFAULT_SMTP_SOCKET_TIMEOUT_MS,
    ),
  });

  return cachedTransport;
};

const sendStudyStatusMail = async ({
  transporter,
  transportConfig,
  recipientEmail,
  subjectName,
  sentAtIso,
}) => {
  const primaryMessage = {
    from: transportConfig.fromAddress,
    to: recipientEmail,
    subject: `${subjectName} is studying now`,
    text: [
      `${subjectName} is studying now.`,
      "",
      `This is an automated update from NogaPlanner.`,
      `Time: ${sentAtIso}`,
    ].join("\n"),
  };

  try {
    await transporter.sendMail(primaryMessage);
    return { sent: true, sender: "configured-from-address" };
  } catch (primaryError) {
    const fallbackMessage = {
      from: {
        name: "MCTOSH",
        address: transportConfig.auth.user,
      },
      replyTo: transportConfig.fromAddress,
      to: recipientEmail,
      subject: `${subjectName} is studying now`,
      text: [
        `${subjectName} is studying now.`,
        "",
        `This is an automated update from NogaPlanner.`,
        `Time: ${sentAtIso}`,
      ].join("\n"),
    };

    try {
      await transporter.sendMail(fallbackMessage);
      return { sent: true, sender: "smtp-auth-user" };
    } catch (fallbackError) {
      fallbackError.cause = primaryError;
      throw fallbackError;
    }
  }
};

export const queueStudyStatusNotifications = async ({
  subjectUser,
  previousStatusValue,
  nextStatusValue,
  at = new Date(),
} = {}) => {
  const normalizedPreviousStatus = trimText(previousStatusValue).toLowerCase();
  const normalizedNextStatus = trimText(nextStatusValue).toLowerCase();
  const subjectUserId = normalizeUserId(subjectUser?._id);

  if (normalizedPreviousStatus === normalizedNextStatus) {
    return { sent: 0, skipped: "unchanged-status" };
  }

  if (normalizedNextStatus !== "studying") {
    return { sent: 0, skipped: "not-studying" };
  }

  if (!subjectUserId) {
    return { sent: 0, skipped: "missing-subject-user" };
  }

  const transporter = getTransporter();
  if (!transporter) {
    return { sent: 0, skipped: "missing-email-config" };
  }

  const recipientUsername = getRecipientUsername();
  if (!recipientUsername) {
    return { sent: 0, skipped: "missing-recipient-username" };
  }

  const fromAddress = resolveTransportConfig()?.fromAddress || "";
  const recipientUser = await UserModel.findOne({
    "auth.username": recipientUsername,
  })
    .select(
      "profile.firstname profile.lastname profile.email auth.username connections friends",
    )
    .lean()
    .maxTimeMS(4000);

  if (!recipientUser?._id) {
    return { sent: 0, skipped: "recipient-not-found" };
  }

  const recipientEmail = trimText(recipientUser?.profile?.email);
  if (!recipientEmail) {
    return { sent: 0, skipped: "recipient-email-missing" };
  }

  const recipientFriendIds = getFriendIds(recipientUser);
  if (!recipientFriendIds.includes(subjectUserId)) {
    return { sent: 0, skipped: "subject-not-recipient-friend" };
  }

  const subjectName = getDisplayName(subjectUser);
  const sentAtIso = new Date(at || Date.now()).toISOString();
  const recipientKey = `${subjectUserId}:${normalizeUserId(recipientUser._id)}:studying`;
  const lastSentAt = sentAtByRecipientKey.get(recipientKey);
  const cooldownMs = resolveCooldownMs();
  if (Number.isFinite(lastSentAt) && Date.now() - lastSentAt < cooldownMs) {
    return { sent: 0, skipped: "cooldown" };
  }

  if (inFlightRecipientKeys.has(recipientKey)) {
    return { sent: 0, skipped: "in-flight" };
  }

  inFlightRecipientKeys.add(recipientKey);
  try {
    const sendResult = await sendStudyStatusMail({
      transporter,
      transportConfig: {
        ...resolveTransportConfig(),
        fromAddress,
      },
      recipientEmail,
      subjectName,
      sentAtIso,
    });

    sentAtByRecipientKey.set(recipientKey, Date.now());
    return { sent: 1, skipped: 0, sender: sendResult.sender };
  } finally {
    inFlightRecipientKeys.delete(recipientKey);
  }
};
