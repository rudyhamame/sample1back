import mongoose from "mongoose";

const { Schema } = mongoose;

const MessageReplySchema = new Schema(
  {
    order: { type: Number, default: 0 },
    body: { type: String, default: "" },
  },
  { _id: false },
);

const MessageReactionSchema = new Schema(
  {
    type: {
      type: String,
      enum: ["like", "dislike", "laugh", "sad", "angry"],
      default: null,
    },
  },
  { _id: false },
);

const MessageStatusSchema = new Schema(
  {
    value: {
      type: String,
      enum: ["sent", "delivered", "read", "deleted", "edited"],
      default: "sent",
    },
    updatedAt: { type: Date, default: Date.now },
  },
  { _id: false },
);

const MessageIndexSchema = new Schema(
  {
    messageId: { type: String, default: "" },
    sender: { type: String, enum: ["ME", "THEM"], required: true },
    receiver: { type: String, enum: ["ME", "THEM"], required: true },
    timestamp: { type: Date, default: Date.now },
  },
  { _id: false },
);

const normalizeMessageBody = (value) => {
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return {
      text: String(value || "").trim(),
      images: [],
      videos: [],
      documents: [],
    };
  }

  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {
      text: "",
      images: [],
      videos: [],
      documents: [],
    };
  }

  return {
    text: String(value.text ?? value.message ?? "").trim(),
    images: (Array.isArray(value.images) ? value.images : [])
      .map((entry) => String(entry || "").trim())
      .filter(Boolean),
    videos: (Array.isArray(value.videos) ? value.videos : [])
      .map((entry) => String(entry || "").trim())
      .filter(Boolean),
    documents: (Array.isArray(value.documents) ? value.documents : [])
      .map((entry) => String(entry || "").trim())
      .filter(Boolean),
  };
};

const MessageBody = new Schema(
  {
    text: { type: String, default: "" },
    images: { type: [String], default: [] },
    videos: { type: [String], default: [] },
    documents: { type: [String], default: [] },
  },
  { _id: false, strict: "throw" },
);

const MessagesSchema = new Schema({
  index: { type: MessageIndexSchema, required: true },
  body: {
    type: MessageBody,
    default: () => ({}),
    set: normalizeMessageBody,
  },
  status: { type: [MessageStatusSchema], default: [] },
  reply: { type: [MessageReplySchema], default: [] },
  reaction: { type: MessageReactionSchema, default: () => ({}) },
});

MessagesSchema.pre("validate", function () {
  this.body = normalizeMessageBody(this.body);
});

const ChatSchema = new Schema(
  {
    connectionId: { type: Schema.Types.ObjectId, required: true },
    messages: { type: [MessagesSchema], default: [] },
  },
  { _id: false },
);

export default ChatSchema;
