import mongoose from "mongoose";

const { Schema, model, models } = mongoose;

const TelegramEntitySchema = new Schema(
  {
    offset: { type: Number, required: true },
    length: { type: Number, required: true },
    type: { type: String, trim: true, required: true },
  },
  { _id: false, strict: "throw" },
);

const TelegramStoredConceptSchema = new Schema(
  {
    key: { type: String, trim: true, default: "" },
    value: { type: String, trim: true, default: "" },
    confidence: { type: Number, min: 0, max: 1, default: 0 },
    method: { type: String, trim: true, default: "" },
  },
  { _id: false, strict: "throw" },
);

// Subdocument schema for each message stored inside a group document.
const TelegramStoredMessageSubdocSchema = new Schema(
  {
    messageId: { type: Number, required: true },
    text: { type: String, default: "" },
    date: { type: Number, default: 0 },
    sender: { type: String, trim: true, default: "Unknown" },
    views: { type: Number, default: null },
    replyToMessageId: { type: Number, default: null },
    attachmentKind: { type: String, trim: true, default: "text" },
    attachmentMimeType: { type: String, trim: true, default: "" },
    attachmentFileName: { type: String, trim: true, default: "" },
    attachmentFileExtension: { type: String, trim: true, default: "" },
    attachmentSizeBytes: { type: Number, default: null },
    attachmentIsPdf: { type: Boolean, default: false },
    telegramFileId: { type: Number, default: null },
    telegramAccessHash: { type: String, trim: true, default: "" },
    telegramFileName: { type: String, trim: true, default: "" },
    groupedId: { type: String, trim: true, default: null },
    pinned: { type: Boolean, default: false },
    photoDataUrl: { type: String, default: "" },
    videoDataUrl: { type: String, default: "" },
    documentDataUrl: { type: String, default: "" },
    keywords_raw: { type: [String], default: [] },
    concepts: { type: [TelegramStoredConceptSchema], default: [] },
    entities: { type: [TelegramEntitySchema], default: [] },
  },
  { _id: false, strict: "throw" },
);

// Top-level document: one per (user, groupReference) pair.
// All messages for the group are stored in the embedded `messages` array.
const TelegramStoredGroupSchema = new Schema(
  {
    groupReference: { type: String, trim: true, required: true },
    groupTitle: { type: String, trim: true, default: "" },
    groupUsername: { type: String, trim: true, default: "" },
    groupType: { type: String, trim: true, default: "group" },
    memberCount: { type: Number, default: 0 },
    description: { type: String, trim: true, default: "" },
    pageUrl: { type: String, trim: true, default: "" },
    messages: { type: [TelegramStoredMessageSubdocSchema], default: [] },
  },
  {
    collection: "telegram_stored_groups",
    timestamps: true,
    strict: "throw",
  },
);

TelegramStoredGroupSchema.index(
  { groupReference: 1 },
  { unique: true, name: "telegram_stored_groups_unique_group_idx" },
);

const TelegramStoredMessageModel =
  models.TelegramStoredGroup ||
  model("TelegramStoredGroup", TelegramStoredGroupSchema);

export default TelegramStoredMessageModel;
