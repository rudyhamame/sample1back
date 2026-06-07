import mongoose from "mongoose";

const { Schema, model, models } = mongoose;

const TelegramStoredConceptSchema = new Schema(
  {
    key: { type: String, trim: true, default: "" },
    value: { type: String, trim: true, default: "" },
    confidence: { type: Number, min: 0, max: 1, default: 0 },
    method: { type: String, trim: true, default: "" },
  },
  { _id: false, strict: "throw" },
);

const TelegramStoredMessageSchema = new Schema(
  {
    user: {
      type: Schema.Types.ObjectId,
      ref: "subjects",
      required: true,
      index: true,
    },
    groupReference: { type: String, trim: true, required: true },
    messageId: { type: Number, required: true },
    groupTitle: { type: String, trim: true, default: "" },
    groupUsername: { type: String, trim: true, default: "" },
    groupType: { type: String, trim: true, default: "group" },
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
    photoDataUrl: { type: String, default: "" },
    videoDataUrl: { type: String, default: "" },
    documentDataUrl: { type: String, default: "" },
    keywords_raw: { type: [String], default: [] },
    concepts: { type: [TelegramStoredConceptSchema], default: [] },
  },
  {
    collection: "telegram_stored_messages",
    timestamps: true,
    strict: "throw",
  },
);

TelegramStoredMessageSchema.index(
  { user: 1, groupReference: 1, messageId: 1 },
  { unique: true, name: "telegram_stored_messages_unique_message_idx" },
);
TelegramStoredMessageSchema.index(
  { user: 1, groupReference: 1, date: -1 },
  { name: "telegram_stored_messages_group_date_idx" },
);

const TelegramStoredMessageModel =
  models.TelegramStoredMessage ||
  model("TelegramStoredMessage", TelegramStoredMessageSchema);

export default TelegramStoredMessageModel;
