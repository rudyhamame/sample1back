import express from "express";
import UserModel from "../compat/UserModel.js";
import { emitUserRefresh } from "../helpers/realtime.js";
import { isUserOnline } from "../services/presence.js";
import { sendTelegramSavedMessageForUser } from "./TelegramAPI.js";

const ChatRouter = express.Router();

const getUserNameParts = (user) => {
  const firstname = String(user?.bio?.firstname || "").trim();
  const lastname = String(user?.bio?.lastname || "").trim();
  const username = String(user?.auth?.username || "").trim();

  return {
    firstname,
    lastname,
    username,
    fullName: `${firstname} ${lastname}`.trim(),
  };
};

const ensureConnections = (user) => {
  user.connections = Array.isArray(user.connections)
    ? user.connections
    : user.connections?.toObject?.() || [];
};

const appendRelationshipMessage = (user, friendId, message, status, sentAt) => {
  ensureConnections(user);

  const friendIdString = String(friendId);
  let friendEntry = user.connections.find(
    (entry) => entry?.kind === "friend" && String(entry?.id) === friendIdString,
  );

  if (!friendEntry) {
    friendEntry = {
      kind: "friend",
      id: friendId,
      mode: "stranger",
      messages: [],
    };
    user.connections.push(friendEntry);
  }

  friendEntry.messages = Array.isArray(friendEntry.messages)
    ? friendEntry.messages
    : [];

  friendEntry.messages.push({
    messageBody: message,
    messageStatus: [
      {
        value: status,
        updatedAt: sentAt,
      },
    ],
  });
};

ChatRouter.post(
  "/sendMessage/:friendID/:my_id",
  async function (req, res, next) {
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
          "connections profile.firstname profile.lastname auth.username",
        ),
        UserModel.findById(friendId).select(
          "connections status settings.telegram.status profile.firstname profile.lastname auth.username",
        ),
      ]);

      if (!senderUser || !friendUser) {
        return res.status(404).json({
          message: "One or both chat users were not found.",
        });
      }

      appendRelationshipMessage(
        senderUser,
        friendUser._id,
        message,
        "sent",
        sentAt,
      );
      appendRelationshipMessage(
        friendUser,
        senderUser._id,
        message,
        "delivered",
        sentAt,
      );

      const senderIdentity = getUserNameParts(senderUser);
      const friendIdentity = getUserNameParts(friendUser);
      const senderName =
        senderIdentity.fullName || senderIdentity.username || "a contact";
      const recipientLabel =
        friendIdentity.fullName || friendIdentity.username || "you";

      await Promise.all([senderUser.save(), friendUser.save()]);

      if (!isUserOnline(friendUser)) {
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
  },
);

ChatRouter.post("/prepareChat/:my_id", async function (req, res, next) {
  try {
    const user = await UserModel.findById(req.params.my_id).select(
      "connections",
    );

    if (!user) {
      return res.status(404).json({ message: "User not found." });
    }

    ensureConnections(user);
    await user.save();
    return res.status(201).json();
  } catch (error) {
    return next(error);
  }
});

export default ChatRouter;
