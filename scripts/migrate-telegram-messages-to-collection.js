import mongoose from "mongoose";
import "dotenv/config";
import UserModel from "../compat/UserModel.js";
import TelegramStoredMessageModel from "../models/TelegramStoredMessage.js";

const uri = String(process.env.DB_CONNECTION || process.env.MONGODB_URI || "").trim();
if (!uri) {
  console.error("Missing DB_CONNECTION or MONGODB_URI");
  process.exit(1);
}

const usernameFilter = String(process.argv[2] || "").trim().toLowerCase();

const normalizeString = (value = "") => String(value ?? "").trim();
const normalizeGroupReference = (value = "") =>
  normalizeString(value).replace(/^@+/, "").toLowerCase();

const normalizeDateMs = (value) => {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value.getTime();
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return value > 1e12 ? value : value * 1000;
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) {
      return 0;
    }
    const asNumber = Number(trimmed);
    if (Number.isFinite(asNumber)) {
      return asNumber > 1e12 ? asNumber : asNumber * 1000;
    }
    const parsed = Date.parse(trimmed);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
};

const inferAttachmentKind = (meta = {}, trace = {}) => {
  const explicitKind = normalizeString(meta?.attachmentKind).toLowerCase();
  if (explicitKind) {
    return explicitKind;
  }
  if (Array.isArray(trace?.photos) && trace.photos.length > 0) {
    return "photo";
  }
  if (Array.isArray(trace?.videos) && trace.videos.length > 0) {
    return "video";
  }
  if (Array.isArray(trace?.audios) && trace.audios.length > 0) {
    return "audio";
  }
  if (Array.isArray(trace?.documents) && trace.documents.length > 0) {
    return "document";
  }
  return "text";
};

const buildStoredDocument = (userId, groupInfo = {}, messageEntry = {}) => {
  const meta =
    messageEntry?.messageMeta && typeof messageEntry.messageMeta === "object"
      ? messageEntry.messageMeta
      : {};
  const trace =
    messageEntry?.messageTrace && typeof messageEntry.messageTrace === "object"
      ? messageEntry.messageTrace
      : {};
  const attachmentKind = inferAttachmentKind(meta, trace);
  const firstPhoto = Array.isArray(trace.photos) ? trace.photos[0] || null : null;
  const firstVideo = Array.isArray(trace.videos) ? trace.videos[0] || null : null;
  const firstDocument = Array.isArray(trace.documents) ? trace.documents[0] || null : null;
  const chosenMedia = firstPhoto || firstVideo || firstDocument || null;
  const messageId = Number(meta?.id || chosenMedia?.id || 0) || 0;
  const groupReference = normalizeGroupReference(
    meta?.groupReference || groupInfo?.groupReference,
  );

  if (!messageId || !groupReference) {
    return null;
  }

  return {
    user: userId,
    groupReference,
    messageId,
    groupTitle: normalizeString(meta?.groupTitle || groupInfo?.name || groupReference),
    groupUsername: normalizeString(meta?.groupUsername),
    groupType: normalizeString(meta?.groupType || "group") || "group",
    text: normalizeString(trace?.text),
    date: normalizeDateMs(meta?.date || chosenMedia?.date),
    sender: normalizeString(meta?.sender || chosenMedia?.sender || "Unknown") || "Unknown",
    views:
      typeof meta?.views === "number" && Number.isFinite(meta.views) ? meta.views : null,
    replyToMessageId:
      typeof meta?.replyToMessageId === "number" && Number.isFinite(meta.replyToMessageId)
        ? meta.replyToMessageId
        : null,
    attachmentKind,
    attachmentMimeType: normalizeString(meta?.attachmentMimeType || chosenMedia?.attachmentMimeType),
    attachmentFileName: normalizeString(meta?.attachmentFileName || chosenMedia?.attachmentFileName),
    attachmentFileExtension: normalizeString(
      meta?.attachmentFileExtension || chosenMedia?.attachmentFileExtension,
    ),
    attachmentSizeBytes:
      typeof meta?.attachmentSizeBytes === "number" && Number.isFinite(meta.attachmentSizeBytes)
        ? meta.attachmentSizeBytes
        : typeof chosenMedia?.attachmentSizeBytes === "number" &&
            Number.isFinite(chosenMedia.attachmentSizeBytes)
          ? chosenMedia.attachmentSizeBytes
          : null,
    attachmentIsPdf: Boolean(meta?.attachmentIsPdf),
    telegramFileId:
      typeof meta?.telegramFileId === "number" && Number.isFinite(meta.telegramFileId)
        ? meta.telegramFileId
        : typeof chosenMedia?.telegramFileId === "number" &&
            Number.isFinite(chosenMedia.telegramFileId)
          ? chosenMedia.telegramFileId
          : null,
    telegramAccessHash: normalizeString(
      meta?.telegramAccessHash || chosenMedia?.telegramAccessHash,
    ),
    telegramFileName: normalizeString(meta?.telegramFileName || chosenMedia?.telegramFileName),
    photoDataUrl:
      attachmentKind === "photo" ? normalizeString(meta?.photoDataUrl || chosenMedia?.photoDataUrl) : "",
    videoDataUrl:
      attachmentKind === "video" ? normalizeString(meta?.videoDataUrl || chosenMedia?.videoDataUrl) : "",
    documentDataUrl:
      attachmentKind === "document" || attachmentKind === "pdf"
        ? normalizeString(meta?.documentDataUrl || chosenMedia?.documentDataUrl)
        : "",
    keywords_raw: Array.isArray(messageEntry?.keywords_raw)
      ? messageEntry.keywords_raw.map((value) => String(value || "").trim()).filter(Boolean)
      : [],
    concepts: Array.isArray(messageEntry?.concepts) ? messageEntry.concepts : [],
  };
};

await mongoose.connect(uri, {
  dbName: String(process.env.DB_NAME || "phenomed").trim(),
});

const userQuery = usernameFilter
  ? { "auth.username": usernameFilter }
  : { "memory.MOA.telegram.groups.messages.0": { $exists: true } };

const users = await UserModel.find(userQuery).select("auth.username memory");

let usersUpdated = 0;
let messagesMigrated = 0;

for (const user of users) {
  const groups = Array.isArray(user?.memory?.MOA?.telegram?.groups)
    ? user.memory.MOA.telegram.groups
    : [];
  if (groups.length === 0) {
    continue;
  }

  const bulkOperations = [];
  let userHasChanges = false;

  groups.forEach((groupEntry) => {
    const info =
      groupEntry?.info && typeof groupEntry.info === "object" ? groupEntry.info : {};
    const messages = Array.isArray(groupEntry?.messages) ? groupEntry.messages : [];
    let groupCount = 0;
    let latestMessageDateMs = Number(info?.latestMessageDateMs || 0) || 0;
    let derivedGroupReference = normalizeGroupReference(info?.groupReference);
    let derivedGroupTitle = normalizeString(info?.name);

    messages.forEach((messageEntry) => {
      const nextDocument = buildStoredDocument(user._id, info, messageEntry);
      if (!nextDocument) {
        return;
      }
      groupCount += 1;
      if (!derivedGroupReference) {
        derivedGroupReference = normalizeGroupReference(nextDocument.groupReference);
      }
      if (!derivedGroupTitle) {
        derivedGroupTitle = normalizeString(nextDocument.groupTitle);
      }
      latestMessageDateMs = Math.max(
        latestMessageDateMs,
        Number(nextDocument.date || 0) || 0,
      );
      bulkOperations.push({
        updateOne: {
          filter: {
            user: nextDocument.user,
            groupReference: nextDocument.groupReference,
            messageId: nextDocument.messageId,
          },
          update: { $set: nextDocument },
          upsert: true,
        },
      });
    });

    if (messages.length > 0) {
      groupEntry.messages = [];
      groupEntry.info = {
        ...info,
        name: derivedGroupTitle || normalizeString(info?.name),
        groupReference: derivedGroupReference || normalizeGroupReference(info?.groupReference),
        messageCount: groupCount,
        latestMessageDateMs,
      };
      userHasChanges = true;
    }
  });

  if (bulkOperations.length > 0) {
    await TelegramStoredMessageModel.bulkWrite(bulkOperations, { ordered: false });
    messagesMigrated += bulkOperations.length;
  }

  if (userHasChanges) {
    await user.save();
    usersUpdated += 1;
  }
}

console.log(
  JSON.stringify(
    {
      scannedUsers: users.length,
      usersUpdated,
      messagesMigrated,
      usernameFilter: usernameFilter || null,
    },
    null,
    2,
  ),
);

await mongoose.disconnect();
