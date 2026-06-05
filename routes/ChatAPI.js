import express from "express";
import UserModel from "../compat/UserModel.js";
import { emitUserRefresh } from "../helpers/realtime.js";
import { isUserOnline } from "../services/presence.js";
import { sendTelegramSavedMessageForUser } from "./TelegramAPI.js";

const ChatRouter = express.Router();

const normalizeChatMessageBody = (value = {}) => {
  const source =
    value && typeof value === "object" && !Array.isArray(value)
      ? value
      : {};
  const text = String(source?.text ?? source?.message ?? "").trim();
  const images = (Array.isArray(source?.images) ? source.images : [])
    .map((entry) => String(entry || "").trim())
    .filter(Boolean);
  const videos = (Array.isArray(source?.videos) ? source.videos : [])
    .map((entry) => String(entry || "").trim())
    .filter(Boolean);
  const documents = (Array.isArray(source?.documents) ? source.documents : [])
    .map((entry) => String(entry || "").trim())
    .filter(Boolean);

  return {
    text,
    images,
    videos,
    documents,
  };
};

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

const appendRelationshipMessage = (user, friendId, messageBody, status, sentAt) => {
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
      chat: [],
      localStatus: {
        value: null,
        updatedAt: null,
        lastChatAt: null,
        lastTypingAt: null,
      },
    };
    user.connections.push(friendEntry);
  }

  friendEntry.chat = Array.isArray(friendEntry.chat)
    ? friendEntry.chat
    : [];

  const connectionIdValue = friendEntry.id || friendId;
  let chatThread = friendEntry.chat.find(
    (entry) =>
      String(entry?.connectionId || "").trim() === String(connectionIdValue || "").trim(),
  );

  if (!chatThread) {
    chatThread = {
      connectionId: connectionIdValue,
      messages: [],
    };
    friendEntry.chat.push(chatThread);
  }

  chatThread.messages = Array.isArray(chatThread.messages)
    ? chatThread.messages
    : [];

  const senderPerspective = status === "delivered" ? "THEM" : "ME";
  const receiverPerspective = senderPerspective === "ME" ? "THEM" : "ME";
  const normalizedBody = normalizeChatMessageBody(messageBody);

  chatThread.messages.push({
    index: {
      sender: senderPerspective,
      receiver: receiverPerspective,
      timestamp: sentAt,
    },
    body: normalizedBody,
    status: [
      {
        value: status,
        updatedAt: sentAt,
      },
    ],
    reply: [],
    reaction: {},
  });
};

ChatRouter.post(
  "/sendMessage/:friendID/:my_id",
  async function (req, res, next) {
    const senderId = String(req.params.my_id || "").trim();
    const friendId = String(req.params.friendID || "").trim();
    const messageBody = normalizeChatMessageBody({
      text: req.body?.body?.text ?? req.body?.message ?? "",
      images: req.body?.body?.images ?? req.body?.images,
      videos: req.body?.body?.videos ?? req.body?.videos,
      documents: req.body?.body?.documents ?? req.body?.documents,
    });
    const io = req.app.locals.io;
    const sentAt = new Date();

    if (!senderId || !friendId) {
      return res.status(400).json({
        message: "Sender and friend IDs are required.",
      });
    }

    const hasPayload =
      messageBody.text ||
      messageBody.images.length > 0 ||
      messageBody.videos.length > 0 ||
      messageBody.documents.length > 0;

    if (!hasPayload) {
      return res.status(400).json({
        message: "Message body must include text or attachments.",
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
        messageBody,
        "sent",
        sentAt,
      );
      appendRelationshipMessage(
        friendUser,
        senderUser._id,
        messageBody,
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
        const messagePreview = messageBody.text;
        const attachmentLines = [];
        if (messageBody.images.length > 0) {
          attachmentLines.push(
            `${messageBody.images.length} image${messageBody.images.length === 1 ? "" : "s"}`,
          );
        }
        const telegramAlert = [
          `New PhenoMed message for ${recipientLabel}`,
          `From: ${senderName}${senderUsername ? ` (@${senderUsername})` : ""}`,
          "",
          "Received while you were offline.",
          "",
          "Message:",
          messagePreview || "[No text]",
          ...(attachmentLines.length > 0
            ? ["", "Attachments:", ...attachmentLines]
            : []),
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
        chatMessage: {
          _id: friendId,
          from: "me",
          message: messageBody.text,
          images: messageBody.images,
          videos: messageBody.videos,
          documents: messageBody.documents,
          date: sentAt.toISOString(),
          status: "sent",
        },
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
