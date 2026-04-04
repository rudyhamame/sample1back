import mongoose from "mongoose";

const TelegramMessageSchema = new mongoose.Schema(
  {
    ownerUserId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "user",
      required: true,
      index: true,
    },
    groupReference: {
      type: String,
      required: true,
      trim: true,
      index: true,
    },
    groupId: {
      type: String,
      default: "",
      trim: true,
    },
    groupTitle: {
      type: String,
      default: "",
      trim: true,
    },
    groupUsername: {
      type: String,
      default: "",
      trim: true,
    },
    telegramMessageId: {
      type: Number,
      required: true,
    },
    text: {
      type: String,
      default: "",
    },
    textNormalized: {
      type: String,
      default: "",
      index: true,
    },
    dateMs: {
      type: Number,
      default: null,
      index: true,
    },
    date: {
      type: Date,
      default: null,
    },
    sender: {
      type: String,
      default: "Unknown",
      trim: true,
    },
    views: {
      type: Number,
      default: null,
    },
    replyToMessageId: {
      type: Number,
      default: null,
    },
    attachmentKind: {
      type: String,
      default: "",
      trim: true,
      index: true,
    },
    attachmentMimeType: {
      type: String,
      default: "",
      trim: true,
    },
    attachmentFileName: {
      type: String,
      default: "",
      trim: true,
    },
    attachmentFileExtension: {
      type: String,
      default: "",
      trim: true,
    },
    attachmentSizeBytes: {
      type: Number,
      default: null,
    },
    attachmentIsPdf: {
      type: Boolean,
      default: false,
      index: true,
    },
    attachmentStoredPath: {
      type: String,
      default: "",
      trim: true,
    },
    attachmentStoredAt: {
      type: Date,
      default: null,
    },
    attachmentTextExtracted: {
      type: String,
      default: "",
    },
    attachmentTextNormalized: {
      type: String,
      default: "",
      index: true,
    },
    matchedTerms: {
      type: [String],
      default: [],
    },
    isPinned: {
      type: Boolean,
      default: false,
      index: true,
    },
    pinnedAt: {
      type: Date,
      default: null,
    },
    aiConceptSummary: {
      type: String,
      default: "",
    },
    aiConceptSummaryUpdatedAt: {
      type: Date,
      default: null,
    },
    storedAt: {
      type: Date,
      default: Date.now,
    },
  },
  {
    timestamps: true,
  },
);

TelegramMessageSchema.index(
  {
    ownerUserId: 1,
    groupReference: 1,
    telegramMessageId: 1,
  },
  {
    unique: true,
  },
);

TelegramMessageSchema.index({
  ownerUserId: 1,
  groupReference: 1,
  dateMs: -1,
});

const TelegramMessageModel = mongoose.model(
  "telegram_message",
  TelegramMessageSchema,
);

export default TelegramMessageModel;
