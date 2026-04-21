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
    sender: { type: String, enum: ["ME", "THEM"], required: true },
    receiver: { type: String, enum: ["ME", "THEM"], required: true },
    timestamp: { type: Date, default: Date.now },
  },
  { _id: false },
);

const MessagesSchema = new Schema({
  index: { type: MessageIndexSchema, required: true },
  body: { type: String, default: "" },
  status: { type: [MessageStatusSchema], default: [] },
  reply: { type: [MessageReplySchema], default: [] },
  reaction: { type: MessageReactionSchema, default: () => ({}) },
});

export default MessagesSchema;
