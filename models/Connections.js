import mongoose from "mongoose";
import ChatSchema from "./Chat.js";

const { Schema } = mongoose;

const ConnectionsSchema = new Schema({
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
