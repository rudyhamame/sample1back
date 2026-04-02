import mongoose from "mongoose";
const Schema = mongoose.Schema;
const ChatSchema = new Schema({
  _id: { type: Schema.Types.ObjectId, required: true },
  conversation: [
    {
      _id: { type: Schema.Types.ObjectId, required: true },
      message: { type: String, required: true },
      date: { type: Date, default: Date.now },
      status: { type: String, default: "sent" },
      from: { type: String, required: true },
    },
  ],
  isTyping: { type: Boolean, default: false },
});

const ChatModel = mongoose.model("chat", ChatSchema);
export default ChatModel;
