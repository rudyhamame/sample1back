import mongoose from "mongoose";
import ChatSchema from "./Chat.js";

const { Schema } = mongoose;

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
});

export default ConnectionsSchema;
