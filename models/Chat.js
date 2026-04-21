import mongoose from "mongoose";
import MessagesSchema from "./Messages.js";

const { Schema } = mongoose;

const ChatSchema = new Schema(
  {
    connectionId: { type: Schema.Types.ObjectId, required: true },
    messages: { type: [MessagesSchema], default: [] },
  },
  { _id: false },
);

export default ChatSchema;
