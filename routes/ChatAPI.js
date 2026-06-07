import express from "express";
import mongoose from "mongoose";
import UserModel from "../compat/UserModel.js";
import {
  emitChatMessage,
  emitChatMessageUpdated,
} from "../helpers/realtime.js";
import { isUserOnline } from "../services/presence.js";
import { sendTelegramSavedMessageForUser } from "./TelegramAPI.js";

const ChatRouter = express.Router();

const normalizeChatMessageBody = (value = {}) => {
  const source =
    value && typeof value === "object" && !Array.isArray(value)
      ? value
      : {};
  const text = String(source?.text ?? source?.message ?? "").trim();
  const audio = String(source?.audio || "").trim();
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
    audio,
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

const createChatMessageId = () => new mongoose.Types.ObjectId().toString();

const getOrCreateFriendThread = (user, friendId) => {
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

  return chatThread;
};

const appendMessageStatus = (messageEntry, status, updatedAt) => {
  messageEntry.status = Array.isArray(messageEntry.status) ? messageEntry.status : [];
  messageEntry.status.push({
    value: status,
    updatedAt,
  });
};

const appendRelationshipMessage = (
  user,
  friendId,
  messageBody,
  status,
  sentAt,
  senderPerspective = "ME",
  messageId = createChatMessageId(),
) => {
  const chatThread = getOrCreateFriendThread(user, friendId);
  const receiverPerspective = senderPerspective === "ME" ? "THEM" : "ME";
  const normalizedBody = normalizeChatMessageBody(messageBody);

  const messageEntry = {
    index: {
      messageId,
      sender: senderPerspective,
      receiver: receiverPerspective,
      timestamp: sentAt,
    },
    body: normalizedBody,
    status: [],
    reply: [],
    reaction: {},
  };
  appendMessageStatus(messageEntry, status, sentAt);
  chatThread.messages.push(messageEntry);
  return messageEntry;
};

const getStableMessageId = (messageEntry) =>
  String(messageEntry?.index?.messageId || messageEntry?._id || "")
    .trim();

const findMessageEntry = (user, friendId, messageId, expectedSender) => {
  const normalizedMessageId = String(messageId || "").trim();
  if (!normalizedMessageId) {
    return null;
  }

  const chatThread = getOrCreateFriendThread(user, friendId);
  return (
    (Array.isArray(chatThread.messages) ? chatThread.messages : []).find(
      (entry) =>
        getStableMessageId(entry) === normalizedMessageId &&
        String(entry?.index?.sender || "").trim().toUpperCase() === expectedSender,
    ) || null
  );
};

const findMessageEntryById = (user, friendId, messageId) => {
  const normalizedMessageId = String(messageId || "").trim();
  if (!normalizedMessageId) {
    return null;
  }

  const chatThread = getOrCreateFriendThread(user, friendId);
  return (
    (Array.isArray(chatThread.messages) ? chatThread.messages : []).find(
      (entry) => getStableMessageId(entry) === normalizedMessageId,
    ) || null
  );
};

const getLatestDeliveryStatus = (statusEntries = []) => {
  const reversedEntries = [...(Array.isArray(statusEntries) ? statusEntries : [])].reverse();
  const deliveryEntry = reversedEntries.find((entry) =>
    ["sent", "delivered", "read"].includes(
      String(entry?.value || "")
        .trim()
        .toLowerCase(),
    ),
  );

  return String(deliveryEntry?.value || "sent")
    .trim()
    .toLowerCase();
};

const buildChatMessagePayload = ({
  counterpartId = "",
  from = "me",
  messageId = "",
  body = {},
  date = new Date(),
  status = "sent",
  edited = false,
  deleted = false,
  deleteScope = null,
} = {}) => {
  const normalizedBody = normalizeChatMessageBody(body);

  return {
    id: String(messageId || "").trim(),
    _id: String(counterpartId || "").trim(),
    from: from === "them" ? "them" : "me",
    message: normalizedBody.text,
    audio: normalizedBody.audio,
    images: normalizedBody.images,
    videos: normalizedBody.videos,
    documents: normalizedBody.documents,
    date:
      date instanceof Date
        ? date.toISOString()
        : new Date(date || Date.now()).toISOString(),
    status: String(status || "sent").trim().toLowerCase() || "sent",
    edited: Boolean(edited),
    deleted: Boolean(deleted),
    ...(deleteScope ? { deleteScope } : {}),
  };
};

const notifyOfflineRecipientInBackground = ({
  user = null,
  text = "",
  senderId = "",
  friendId = "",
} = {}) => {
  Promise.resolve()
    .then(async () => {
      if (!user || !text) {
        return;
      }
      await sendTelegramSavedMessageForUser({
        user,
        text,
      });
    })
    .catch((error) => {
      console.error("[chat] offline telegram notification failed", {
        senderId: String(senderId || "").trim(),
        friendId: String(friendId || "").trim(),
        message: error?.message || "Unknown error.",
      });
    });
};

ChatRouter.post(
  "/sendMessage/:friendID/:my_id",
  async function (req, res, next) {
    const senderId = String(req.params.my_id || "").trim();
    const friendId = String(req.params.friendID || "").trim();
    const messageBody = normalizeChatMessageBody({
      text: req.body?.body?.text ?? req.body?.message ?? "",
      audio: req.body?.body?.audio ?? req.body?.audio,
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
      messageBody.audio ||
      messageBody.images.length > 0 ||
      messageBody.videos.length > 0 ||
      messageBody.documents.length > 0;

    if (!hasPayload) {
      return res.status(400).json({
        message: "Message body must include text or attachments.",
      });
    }

    try {
      const messageId = createChatMessageId();
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

      const recipientIsOnline = isUserOnline(friendUser);
      const senderInitialStatus = recipientIsOnline ? "delivered" : "sent";

      appendRelationshipMessage(
        senderUser,
        friendUser._id,
        messageBody,
        senderInitialStatus,
        sentAt,
        "ME",
        messageId,
      );
      appendRelationshipMessage(
        friendUser,
        senderUser._id,
        messageBody,
        "delivered",
        sentAt,
        "THEM",
        messageId,
      );

      const senderIdentity = getUserNameParts(senderUser);
      const friendIdentity = getUserNameParts(friendUser);
      const senderName =
        senderIdentity.fullName || senderIdentity.username || "a contact";
      const recipientLabel =
        friendIdentity.fullName || friendIdentity.username || "you";

      await Promise.all([senderUser.save(), friendUser.save()]);

      if (!recipientIsOnline) {
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
          ...(messageBody.audio ? ["", "Voice note: 1 audio attachment"] : []),
          ...(attachmentLines.length > 0
            ? ["", "Attachments:", ...attachmentLines]
            : []),
        ].join("\n");
        notifyOfflineRecipientInBackground({
          user: friendUser,
          text: telegramAlert,
          senderId,
          friendId,
        });
      }

      emitChatMessage(io, senderId, {
        friendId,
        chatMessage: buildChatMessagePayload({
          counterpartId: friendId,
          from: "me",
          messageId,
          body: messageBody,
          date: sentAt,
          status: senderInitialStatus,
        }),
      });
      emitChatMessage(io, friendId, {
        friendId: senderId,
        chatMessage: buildChatMessagePayload({
          counterpartId: senderId,
          from: "them",
          messageId,
          body: messageBody,
          date: sentAt,
          status: "delivered",
        }),
      });

      return res.status(201).json({
        message: "Message sent.",
        chatMessage: buildChatMessagePayload({
          counterpartId: friendId,
          from: "me",
          messageId,
          body: messageBody,
          date: sentAt,
          status: senderInitialStatus,
        }),
      });
    } catch (error) {
      return next(error);
    }
  },
);

ChatRouter.patch(
  "/message/:friendID/:my_id/:messageId",
  async function (req, res, next) {
    const senderId = String(req.params.my_id || "").trim();
    const friendId = String(req.params.friendID || "").trim();
    const messageId = String(req.params.messageId || "").trim();
    const nextText = String(req.body?.body?.text ?? req.body?.text ?? "").trim();
    const updatedAt = new Date();

    if (!senderId || !friendId || !messageId) {
      return res.status(400).json({
        message: "Sender, friend, and message IDs are required.",
      });
    }

    try {
      const [senderUser, friendUser] = await Promise.all([
        UserModel.findById(senderId).select("connections"),
        UserModel.findById(friendId).select("connections"),
      ]);

      if (!senderUser || !friendUser) {
        return res.status(404).json({
          message: "One or both chat users were not found.",
        });
      }

      const senderMessage = findMessageEntry(senderUser, friendUser._id, messageId, "ME");
      const friendMessage = findMessageEntry(friendUser, senderUser._id, messageId, "THEM");

      if (!senderMessage || !friendMessage) {
        return res.status(404).json({
          message: "Chat message not found.",
        });
      }

      const senderBody = normalizeChatMessageBody(senderMessage.body);
      const hasExistingAttachments =
        Boolean(senderBody.audio) ||
        senderBody.images.length > 0 ||
        senderBody.videos.length > 0 ||
        senderBody.documents.length > 0;

      if (!nextText && !hasExistingAttachments) {
        return res.status(400).json({
          message: "Updated message text is required.",
        });
      }

      const senderDeleted = Array.isArray(senderMessage.status)
        ? senderMessage.status.some(
            (entry) =>
              String(entry?.value || "")
                .trim()
                .toLowerCase() === "deleted",
          )
        : false;

      if (senderDeleted) {
        return res.status(400).json({
          message: "Deleted messages cannot be edited.",
        });
      }

      senderMessage.body = {
        ...senderBody,
        text: nextText,
      };
      friendMessage.body = {
        ...normalizeChatMessageBody(friendMessage.body),
        text: nextText,
      };

      appendMessageStatus(senderMessage, "edited", updatedAt);
      appendMessageStatus(friendMessage, "edited", updatedAt);

      await Promise.all([senderUser.save(), friendUser.save()]);

      emitChatMessageUpdated(req.app.locals.io, senderId, {
        friendId,
        messageId,
        chatMessage: buildChatMessagePayload({
          counterpartId: friendId,
          from: "me",
          messageId,
          body: senderMessage.body,
          date: senderMessage?.index?.timestamp || updatedAt,
          status: getLatestDeliveryStatus(senderMessage.status),
          edited: true,
          deleted: false,
        }),
      });
      emitChatMessageUpdated(req.app.locals.io, friendId, {
        friendId: senderId,
        messageId,
        chatMessage: buildChatMessagePayload({
          counterpartId: senderId,
          from: "them",
          messageId,
          body: friendMessage.body,
          date: friendMessage?.index?.timestamp || updatedAt,
          status: getLatestDeliveryStatus(friendMessage.status),
          edited: true,
          deleted: false,
        }),
      });

      return res.status(200).json({
        message: "Message updated.",
        chatMessage: buildChatMessagePayload({
          counterpartId: friendId,
          from: "me",
          messageId,
          body: senderMessage.body,
          date: senderMessage?.index?.timestamp || updatedAt,
          status: getLatestDeliveryStatus(senderMessage.status),
          edited: true,
          deleted: false,
        }),
      });
    } catch (error) {
      return next(error);
    }
  },
);

ChatRouter.delete(
  "/message/:friendID/:my_id/:messageId",
  async function (req, res, next) {
    const senderId = String(req.params.my_id || "").trim();
    const friendId = String(req.params.friendID || "").trim();
    const messageId = String(req.params.messageId || "").trim();
    const scope = String(req.query?.scope || "everyone")
      .trim()
      .toLowerCase();
    const updatedAt = new Date();

    if (!senderId || !friendId || !messageId) {
      return res.status(400).json({
        message: "Sender, friend, and message IDs are required.",
      });
    }

    try {
      const senderUser = await UserModel.findById(senderId).select("connections");

      if (!senderUser) {
        return res.status(404).json({
          message: "One or both chat users were not found.",
        });
      }

      if (scope === "me") {
        const senderThread = getOrCreateFriendThread(senderUser, friendId);
        const currentMessages = Array.isArray(senderThread.messages) ? senderThread.messages : [];
        const nextMessages = currentMessages.filter(
          (entry) => getStableMessageId(entry) !== messageId,
        );

        if (nextMessages.length === currentMessages.length) {
          return res.status(404).json({
            message: "Chat message not found.",
          });
        }

        senderThread.messages = nextMessages;
        await senderUser.save();

        emitChatMessageUpdated(req.app.locals.io, senderId, {
          friendId,
          messageId,
          scope: "me",
          chatMessage: {
            id: messageId,
            _id: friendId,
            deleteScope: "me",
          },
        });

        return res.status(200).json({
          message: "Message deleted for you.",
          chatMessage: {
            id: messageId,
            _id: friendId,
            deleteScope: "me",
          },
        });
      }

      const friendUser = await UserModel.findById(friendId).select("connections");

      if (!friendUser) {
        return res.status(404).json({
          message: "One or both chat users were not found.",
        });
      }

      const senderMessage = findMessageEntry(senderUser, friendUser._id, messageId, "ME");
      const friendMessage = findMessageEntry(friendUser, senderUser._id, messageId, "THEM");

      if (!senderMessage || !friendMessage) {
        return res.status(404).json({
          message: "Chat message not found.",
        });
      }

      senderMessage.body = {
        text: "",
        audio: "",
        images: [],
        videos: [],
        documents: [],
      };
      friendMessage.body = {
        text: "",
        audio: "",
        images: [],
        videos: [],
        documents: [],
      };

      appendMessageStatus(senderMessage, "deleted", updatedAt);
      appendMessageStatus(friendMessage, "deleted", updatedAt);

      await Promise.all([senderUser.save(), friendUser.save()]);

      emitChatMessageUpdated(req.app.locals.io, senderId, {
        friendId,
        messageId,
        chatMessage: buildChatMessagePayload({
          counterpartId: friendId,
          from: "me",
          messageId,
          body: senderMessage.body,
          date: senderMessage?.index?.timestamp || updatedAt,
          status: getLatestDeliveryStatus(senderMessage.status),
          edited: false,
          deleted: true,
        }),
      });
      emitChatMessageUpdated(req.app.locals.io, friendId, {
        friendId: senderId,
        messageId,
        chatMessage: buildChatMessagePayload({
          counterpartId: senderId,
          from: "them",
          messageId,
          body: friendMessage.body,
          date: friendMessage?.index?.timestamp || updatedAt,
          status: getLatestDeliveryStatus(friendMessage.status),
          edited: false,
          deleted: true,
        }),
      });

      return res.status(200).json({
        message: "Message deleted.",
        chatMessage: buildChatMessagePayload({
          counterpartId: friendId,
          from: "me",
          messageId,
          body: senderMessage.body,
          date: senderMessage?.index?.timestamp || updatedAt,
          status: getLatestDeliveryStatus(senderMessage.status),
          edited: false,
          deleted: true,
        }),
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
    if (user.isModified("connections")) {
      await user.save();
    }
    return res.status(201).json();
  } catch (error) {
    return next(error);
  }
});

export default ChatRouter;
