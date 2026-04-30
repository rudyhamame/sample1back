import mongoose from "mongoose";

const { Schema } = mongoose;

const TraceMediaIndexSchema = new Schema(
  {
    fileName: { type: String, default: "" },
    mimeType: { type: String, default: "" },
    contentHash: { type: String, default: "" },
    resourceType: { type: String, default: "" },
  },
  { _id: false },
);

const TraceMediaMetadataSchema = new Schema(
  {
    width: { type: Number, default: null },
    height: { type: Number, default: null },
    format: { type: String, default: "" },
    bytes: { type: Number, default: null },
    duration: { type: Number, default: null },
    totalPages: { type: Number, default: null },
    visibility: {
      type: String,
      enum: ["public", "me", "hidden"],
      default: "public",
    },
    createdAt: { type: Date, default: Date.now },
    updatedAt: { type: Date, default: Date.now },
  },
  { _id: false },
);

const TraceStorageContextSchema = new Schema(
  {
    url: { type: String, default: "" },
    publicId: { type: String, default: "" },
    assetId: { type: String, default: "" },
    folder: { type: String, default: "" },
  },
  { _id: false },
);

const TraceMediaItemSchema = new Schema(
  {
    index: { type: TraceMediaIndexSchema, default: () => ({}) },
    metadata: { type: TraceMediaMetadataSchema, default: () => ({}) },
    storageContext: { type: TraceStorageContextSchema, default: () => ({}) },
  },
  { _id: false },
);

const TraceMoaUserSchema = new Schema(
  {
    images: { type: [TraceMediaItemSchema], default: [] },
    patterns: { type: [TraceMediaItemSchema], default: [] },
    videos: { type: [TraceMediaItemSchema], default: [] },
    texts: { type: [TraceMediaItemSchema], default: [] },
    audios: { type: [TraceMediaItemSchema], default: [] },
    documents: { type: [TraceMediaItemSchema], default: [] },
  },
  { _id: false },
);

const TraceMoaTelegramSchema = new Schema(
  {
    messageId: { type: Number, default: null },
    chatId: { type: Number, default: null },
    senderId: { type: Number, default: null },
    senderUsername: { type: String, default: "" },
    senderFirstName: { type: String, default: "" },
    senderLastName: { type: String, default: "" },
    messageText: { type: String, default: "" },
  },
  { _id: false },
);

const TraceMoaAiSchema = new Schema(
  {
    provider: { type: String, default: "" },
    model: { type: String, default: "" },
    promptId: { type: String, default: "" },
    responseId: { type: String, default: "" },
    responseText: { type: String, default: "" },
  },
  { _id: false },
);

const TraceMoaChatSchema = new Schema(
  {
    sourceType: { type: String, default: "chat" },
    messageId: { type: Schema.Types.ObjectId, default: null },
    senderId: { type: Schema.Types.ObjectId, default: null },
    connectionId: { type: Schema.Types.ObjectId, default: null },
  },
  { _id: false },
);

const TraceSchema = new Schema(
  {
    user: { type: TraceMoaUserSchema, default: null },
    telegram: { type: TraceMoaTelegramSchema, default: null },
    ai: { type: TraceMoaAiSchema, default: null },
    chat: { type: TraceMoaChatSchema, default: null },
  },
  { _id: false },
);

export default TraceSchema;
