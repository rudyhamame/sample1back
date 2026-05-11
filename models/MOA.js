import mongoose from "mongoose";
import { Content } from "openai/resources/skills.js";

const { Schema } = mongoose;

const ContentDocumentSchema = new Schema(
  {
    text: { type: String, default: "" }, // the original text content extracted from the page or source
    normalizedText: { type: String, default: "" }, // e.g., text with normalized whitespace, removed stopwords, etc.
  },
  { _id: false },
);

const TraceMediaIndexSchema = new Schema(
  {
    fileName: { type: String, default: "" },
    mimeType: { type: String, default: "" },
    contentHash: { type: String, default: "" },
    resourceType: { type: String, default: "" },
    MOI: { type: String, default: "" }, // mode of intervention (e.g., "study_planner")
  },
  { _id: false },
);

const TraceImageMetadataSchema = new Schema(
  {
    width: { type: Number, default: null },
    height: { type: Number, default: null },
    aspectRatio: { type: Number, default: null },
    pixels: { type: Number, default: null },
    format: { type: String, default: "" },
    bytes: { type: Number, default: null },
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

const TraceVideoMetadataSchema = new Schema(
  {
    width: { type: Number, default: null },
    height: { type: Number, default: null },
    aspectRatio: { type: Number, default: null },
    pixels: { type: Number, default: null },
    format: { type: String, default: "" },
    bytes: { type: Number, default: null },
    duration: { type: Number, default: null },
    bitrateBps: { type: Number, default: null },
    bitrateKbps: { type: Number, default: null },
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

const TraceTextMetadataSchema = new Schema(
  {
    format: { type: String, default: "" }, // e.g., "txt", "md"
    bytes: { type: Number, default: null }, // file size in bytes
    visibility: {
      // who can see this text file
      type: String,
      enum: ["public", "me", "hidden"],
      default: "public",
    },
    createdAt: { type: Date, default: Date.now }, // when the text file was created
    updatedAt: { type: Date, default: Date.now }, // when the text file was last updated
  },
  { _id: false },
);

const TraceAudioMetadataSchema = new Schema(
  {
    format: { type: String, default: "" }, // e.g., "mp3", "wav"
    bytes: { type: Number, default: null }, // file size in bytes
    duration: { type: Number, default: null }, // duration in seconds
    visibility: {
      //  who can see this audio file
      type: String,
      enum: ["public", "me", "hidden"],
      default: "public",
    },
    createdAt: { type: Date, default: Date.now }, // when the audio file was created
    updatedAt: { type: Date, default: Date.now }, // when the audio file was last updated
  },
  { _id: false },
);

const TraceDocumentMetadataSchema = new Schema(
  {
    width: { type: Number, default: null }, // for documents, this could represent page width or similar measure
    height: { type: Number, default: null }, // for documents, this could represent page height or similar measure
    format: { type: String, default: "" }, // e.g., "pdf", "docx"
    bytes: { type: Number, default: null }, // file size in bytes
    volume: { type: Number, default: null }, //number of pages or similar measure
    content: { type: ContentDocumentSchema, default: [] },
    visibility: {
      // who can see this document
      type: String,
      enum: ["public", "me", "hidden"],
      default: "public",
    },
    createdAt: { type: Date, default: Date.now }, // when the document was created
    updatedAt: { type: Date, default: Date.now }, // when the document was last updated
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

const TraceImageItemSchema = new Schema(
  {
    index: { type: TraceMediaIndexSchema, default: () => ({}) },
    metadata: { type: TraceImageMetadataSchema, default: () => ({}) },
    storageContext: { type: TraceStorageContextSchema, default: () => ({}) },
  },
  { _id: false },
);

const TraceVideoItemSchema = new Schema(
  {
    index: { type: TraceMediaIndexSchema, default: () => ({}) },
    metadata: { type: TraceVideoMetadataSchema, default: () => ({}) },
    storageContext: { type: TraceStorageContextSchema, default: () => ({}) },
  },
  { _id: false },
);

const TraceTextItemSchema = new Schema(
  {
    index: { type: TraceMediaIndexSchema, default: () => ({}) },
    metadata: { type: TraceTextMetadataSchema, default: () => ({}) },
    storageContext: { type: TraceStorageContextSchema, default: () => ({}) },
  },
  { _id: false },
);

const TraceAudioItemSchema = new Schema(
  {
    index: { type: TraceMediaIndexSchema, default: () => ({}) },
    metadata: { type: TraceAudioMetadataSchema, default: () => ({}) },
    storageContext: { type: TraceStorageContextSchema, default: () => ({}) },
  },
  { _id: false },
);

const TraceDocumentItemSchema = new Schema(
  {
    index: { type: TraceMediaIndexSchema, default: () => ({}) },
    metadata: { type: TraceDocumentMetadataSchema, default: () => ({}) },
    storageContext: { type: TraceStorageContextSchema, default: () => ({}) },
  },
  { _id: false },
);

const TraceMoaUserSchema = new Schema(
  {
    images: { type: [TraceImageItemSchema], default: [] },
    videos: { type: [TraceVideoItemSchema], default: [] },
    texts: { type: [TraceTextItemSchema], default: [] },
    audios: { type: [TraceAudioItemSchema], default: [] },
    documents: { type: [TraceDocumentItemSchema], default: [] },
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

const TelegramGroupInfoSchema = new Schema(
  {
    name: { type: String, default: "" },
    groupReference: { type: String, default: "" },
    memberCount: { type: Number, default: 0 },
    description: { type: String, default: "" },
    messageCount: { type: Number, default: 0 },
    pageUrl: { type: String, default: "" },
  },
  { _id: false, strict: "throw" },
);

const TelegramGroupContentBucketSchema = new Schema(
  {
    texts: { type: [Schema.Types.Mixed], default: [] },
    photos: { type: [Schema.Types.Mixed], default: [] },
    images: { type: [Schema.Types.Mixed], default: [] },
    videos: { type: [Schema.Types.Mixed], default: [] },
    audios: { type: [Schema.Types.Mixed], default: [] },
    documents: { type: [Schema.Types.Mixed], default: [] },
  },
  { _id: false, strict: "throw" },
);
const TelegramGroupsSchema = new Schema(
  {
    info: { type: TelegramGroupInfoSchema, default: () => ({}) },
    content: { type: [TelegramGroupContentBucketSchema], default: [] },
  },
  { _id: false, strict: "throw" },
);

const TelegramMemorySchema = new Schema(
  {
    groups: { type: TelegramGroupsSchema, default: () => ({}) },
    predictions: { type: Schema.Types.Mixed, default: () => ({}) },
  },
  { _id: false, strict: "throw" },
);

const MOASchema = new Schema(
  {
    user: { type: TraceMoaUserSchema, default: null },
    telegram: { type: TelegramMemorySchema, default: () => ({}) },
    ai: { type: TraceMoaAiSchema, default: null },
    chat: { type: TraceMoaChatSchema, default: null },
  },
  { _id: false },
);

export default MOASchema;
