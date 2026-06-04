import mongoose from "mongoose";
import ChatSchema from "./Chat.js";

const { Schema } = mongoose;

const createDefaultLocalStatus = () => ({
  value: null,
  updatedAt: null,
  lastChatAt: null,
  lastTypingAt: null,
});

const LocalStatusSchema = new Schema(
  {
    value: {
      type: String,
      enum: ["in my chat", "typing"],
      default: null,
    },
    updatedAt: { type: Date, default: null },
    lastChatAt: { type: Date, default: null },
    lastTypingAt: { type: Date, default: null },
  },
  { _id: false },
);

const ConnectionsSchema = new Schema({
  id: {
    type: Schema.Types.ObjectId,
    ref: "subjects",
    default: null,
  },
  kind: {
    type: String,
    enum: ["friend", "group", "page", "other"],
    default: "friend",
  },
  mode: {
    type: String,
    enum: ["stranger", "requestSent", "requestReceived", "friend", "blocked"],
    default: "stranger",
  },
  chat: { type: [ChatSchema], default: [] },
  localStatus: { type: LocalStatusSchema, default: createDefaultLocalStatus },
}, {
  _id: true,
  minimize: false, strict: "throw",
});

export default ConnectionsSchema;
