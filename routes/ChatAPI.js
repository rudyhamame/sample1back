import express from "express";
import UserModel from "../models/Users.js";
import { emitUserRefresh } from "../helpers/realtime.js";
import { sendTelegramSavedMessageForUser } from "./TelegramAPI.js";

const ChatRouter = express.Router();

const getUserNameParts = (user) => {
  const firstname = String(user?.identity?.personal?.firstname || "").trim();
  const lastname = String(user?.identity?.personal?.lastname || "").trim();
  const username = String(user?.identity?.atSignup?.username || "").trim();

  return {
    firstname,
    lastname,
    username,
    fullName: `${firstname} ${lastname}`.trim(),
  };
};

const buildChatMessage = ({ counterpartId, message, sentAt, from, status }) => ({
  _id: counterpartId,
  message,
  date: sentAt,
  from,
  status,
});

ChatRouter.post("/sendMessage/:friendID/:my_id", async function (req, res, next) {
  const senderId = String(req.params.my_id || "").trim();
  const friendId = String(req.params.friendID || "").trim();
  const message = String(req.body?.message || "");
  const io = req.app.locals.io;
  const sentAt = new Date();

  if (!senderId || !friendId) {
    return res.status(400).json({
      message: "Sender and friend IDs are required.",
    });
  }

  try {
    const [senderUser, friendUser] = await Promise.all([
      UserModel.findById(senderId).select(
        "chat identity.personal.firstname identity.personal.lastname identity.atSignup.username",
      ),
      UserModel.findById(friendId).select(
        "chat notifications identity.status.isLoggedIn telegram.status identity.personal.firstname identity.personal.lastname identity.atSignup.username",
      ),
    ]);

    if (!senderUser || !friendUser) {
      return res.status(404).json({
        message: "One or both chat users were not found.",
      });
    }

    senderUser.chat = Array.isArray(senderUser.chat) ? senderUser.chat : [];
    friendUser.chat = Array.isArray(friendUser.chat) ? friendUser.chat : [];

    senderUser.chat.push(
      buildChatMessage({
        counterpartId: friendId,
        message,
        sentAt,
        from: "me",
        status: "received",
      }),
    );
    friendUser.chat.push(
      buildChatMessage({
        counterpartId: senderId,
        message,
        sentAt,
        from: "them",
        status: "received",
      }),
    );

    const senderIdentity = getUserNameParts(senderUser);
    const friendIdentity = getUserNameParts(friendUser);
    const senderName =
      senderIdentity.fullName || senderIdentity.username || "a contact";
    const recipientLabel =
      friendIdentity.fullName || friendIdentity.username || "you";

    const existingNotification = (friendUser.notifications || []).find(
      (notification) =>
        String(notification?.id || "") === senderId &&
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
        id: senderId,
        type: "chat_message",
        count: 1,
        message: `You have 1 new message from ${senderName}`,
        status: "unread",
      });
    }

    await Promise.all([senderUser.save(), friendUser.save()]);

    if (!friendUser?.identity?.status?.isLoggedIn) {
      const senderUsername = senderIdentity.username;
      const messagePreview = message.trim();
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

    emitUserRefresh(io, [senderId, friendId], "chat:message", {
      friendId,
    });

    return res.status(201).json({
      message: "Message sent.",
    });
  } catch (error) {
    return next(error);
  }
});

ChatRouter.post("/prepareChat/:my_id", async function (req, res, next) {
  try {
    const user = await UserModel.findById(req.params.my_id).select("chat");

    if (!user) {
      return res.status(404).json({
        message: "User not found.",
      });
    }

    if (!Array.isArray(user.chat)) {
      user.chat = [];
      await user.save();
    }

    return res.status(201).json();
  } catch (error) {
    return next(error);
  }
});

export default ChatRouter;
