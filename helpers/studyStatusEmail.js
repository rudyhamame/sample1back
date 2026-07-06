import UserModel from "../compat/UserModel.js";
import { sendBrevoEmail } from "./sendBrevoEmail.js";

const sentAtByRecipientKey = new Map();
const inFlightRecipientKeys = new Set();
const DEFAULT_COOLDOWN_MS = 10 * 60 * 1000;
const DEFAULT_RECIPIENT_USERNAME = "rudyhamame";

const trimText = (value) => String(value ?? "").trim();

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

const hasBrevoEmailConfig = () =>
  trimText(
    process.env.BREVO_API_KEY ||
      process.env.EMAIL_BREVO_API_KEY ||
      process.env.BREVO_TRANSACTIONAL_API_KEY,
  ) !== "";

const sendStudyStatusMail = async ({
  recipientEmail,
  subjectName,
  sentAtIso,
}) => {
  return sendBrevoEmail({
    to: recipientEmail,
    subject: `${subjectName} is studying now`,
    text: [
      `${subjectName} is studying now.`,
      "",
      `This is an automated update from NogaPlanner.`,
      `Time: ${sentAtIso}`,
    ].join("\n"),
    replyTo: process.env.EMAIL_FROM_ADDRESS || process.env.SMTP_FROM || "",
  });
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

  if (!hasBrevoEmailConfig()) {
    return { sent: 0, skipped: "missing-email-config" };
  }

  const recipientUsername = getRecipientUsername();
  if (!recipientUsername) {
    return { sent: 0, skipped: "missing-recipient-username" };
  }

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
