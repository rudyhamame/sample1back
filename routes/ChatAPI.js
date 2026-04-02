import express from "express";
import ChatModel from "../models/Chat.js";
import UserModel from "../models/Users.js";
import { emitUserRefresh } from "../helpers/realtime.js";
import { sendTelegramSavedMessageForUser } from "./TelegramAPI.js";
const ChatRouter = express.Router();

const ensureChatDocument = async (userId) => {
  await ChatModel.findOneAndUpdate(
    { _id: userId },
    { $setOnInsert: { _id: userId, conversation: [] } },
    { upsert: true, new: true },
  );

  await UserModel.findByIdAndUpdate(
    userId,
    { chat: userId },
    { useFindAndModify: false },
  );

  return ChatModel.findOne({ _id: userId });
};

// ///Add your chat
// ChatRouter.post("/addNew/:my_id", function (req, res, next) {
//   ChatModel.findOne({ _id: req.params.my_id })
//     .then((result) => {
//       if (!result) {
//         ChatModel.create({ _id: req.params.my_id });
//       }
//     })
//     .then((result) => {
//       return res.json(result);
//     });
// });

//Send to me chat
// ChatRouter.post("/sendMessage/:friendID/:my_id", function (req, res, next) {
//   UserModel.findByIdAndUpdate(
//     { _id: req.params.my_id },
//     { chat: req.params.my_id }
//   ).then(() => {
//     ChatModel.findOne({ _id: req.params.friendID })
//       .then((chatObject) => {
//         if (!chatObject) {
//           ChatModel.create({ _id: req.params.friendID })
//             .then(() => {
//               ChatModel.findOne({
//                 _id: req.params.friendID,
//               });
//             })
//             .then((chatObject) => {
//               chatObject.conversation.push(req.body);
//               return chatObject.save();
//             })
//             .then((result) => {
//               return res.status(201).json(result.conversation);
//             })
//             .catch(next);
//         } else {
//           chatObject.conversation.push(req.body);
//           return chatObject.save();
//         }
//       })
//       .then((result) => {
//         return res.status(201).json(result.conversation);
//       })
//       .catch(next);
//   });
// });

//Send to friend chat
ChatRouter.post("/sendMessage/:friendID/:my_id", function (req, res, next) {
  const senderId = req.params.my_id;
  const friendId = req.params.friendID;
  const { message } = req.body;
  const io = req.app.locals.io;
  const sentAt = new Date();

  Promise.all([
    ensureChatDocument(senderId).then((chatObject) => {
      chatObject.conversation.push({
        _id: friendId,
        message,
        date: sentAt,
        from: "me",
        status: "received",
      });
      return chatObject.save();
    }),
    ensureChatDocument(friendId).then((chatObject) => {
      chatObject.conversation.push({
        _id: senderId,
        message,
        date: sentAt,
        from: "them",
        status: "received",
      });
      return chatObject.save();
    }),
    UserModel.findById(senderId).select(
      "info.firstname info.lastname info.username",
    ),
    UserModel.findById(friendId).select(
      "notifications status.isConnected telegramIntegration info.firstname info.lastname info.username",
    ),
  ])
    .then(async ([, , senderUser, friendUser]) => {
      if (friendUser && senderUser) {
        const senderName =
          `${senderUser.info?.firstname || ""} ${senderUser.info?.lastname || ""}`.trim() ||
          senderUser.info?.username ||
          "a contact";
        const existingNotification = (friendUser.notifications || []).find(
          (notification) =>
            String(notification?.id) === String(senderId) &&
            notification?.type === "chat_message" &&
            notification?.status !== "read",
        );

        if (existingNotification) {
          const nextCount = Number(existingNotification.count || 0) + 1;
          existingNotification.count = nextCount;
          existingNotification.message = `You have ${nextCount} new ${nextCount === 1 ? "message" : "messages"} from ${senderName}`;
          existingNotification.status = "unread";
        } else {
          friendUser.notifications.push({
            id: String(senderId),
            type: "chat_message",
            count: 1,
            message: `You have 1 new message from ${senderName}`,
            status: "unread",
          });
        }

        await friendUser.save();

        if (!friendUser.status?.isConnected) {
          const senderUsername = String(senderUser.info?.username || "").trim();
          const recipientLabel =
            `${friendUser.info?.firstname || ""} ${friendUser.info?.lastname || ""}`.trim() ||
            friendUser.info?.username ||
            "you";
          const messagePreview = String(message || "").trim();
          const telegramAlert = [
            `New PhenoMed message for ${recipientLabel}`,
            `From: ${senderName}${senderUsername ? ` (@${senderUsername})` : ""}`,
            "",
            "Received while you were offline.",
            "",
            "Message:",
            messagePreview || "[No text]",
          ].join("\n");

          await sendTelegramSavedMessageForUser({
            user: friendUser,
            text: telegramAlert,
          });
        }
      }

      return null;
    })
    .then(() => {
      emitUserRefresh(io, [senderId, friendId], "chat:message", {
        friendId,
      });
      res.status(201).json({
        message: "Message sent.",
      });
    })
    .catch(next);
});

//////////////////////Preparing chat
ChatRouter.post("/prepareChat/:my_id", function (req, res, next) {
  ensureChatDocument(req.params.my_id)
    .then(() => {
      return res.status(201).json();
    })
    .catch(next);
});

//Attach all the routes to router\
export default ChatRouter;
