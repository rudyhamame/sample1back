import "dotenv/config";
import morgan from "morgan";
import mongoose from "mongoose";
import cors from "cors";
import express from "express";
import http from "http";
import jwt from "jsonwebtoken";
import { Server } from "socket.io";
const app = express(); // initialie express
const server = http.createServer(app);
////////////////////////////////////////

/////////////////////////////////////////////////////////////
import UserAPI from "./routes/UserAPI.js";
import ChatAPI from "./routes/ChatAPI.js";
import EnquiriesAPI from "./routes/EnquiriesAPI.js";
import ECGAPI from "./routes/ECGAPI.js";
import TelegramAPI, { startTelegramSyncWorker } from "./routes/TelegramAPI.js";
import JamendoAPI from "./routes/JamendoAPI.js";
// import VideoAPI from "./routes/VideoAPI.js";
import UserModel from "./compat/UserModel.js";
import { setUserConnectionState } from "./helpers/connectionStatus.js";
import { emitChatRead, emitUserRefresh } from "./helpers/realtime.js";
import { getUserAndFriendIds } from "./routes/user/helpers/friends.js";

import "dotenv/config";

const allowedOrigins = [
  "http://localhost:5173",
  "http://10.38.149.72:5173",
  process.env.FRONTEND_URL,
].filter(Boolean);

const isPrivateDevelopmentHost = (hostname) => {
  const normalizedHostname = String(hostname || "")
    .trim()
    .toLowerCase();

  if (!normalizedHostname) {
    return false;
  }

  if (
    normalizedHostname === "localhost" ||
    normalizedHostname === "127.0.0.1"
  ) {
    return true;
  }

  return (
    /^10\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(normalizedHostname) ||
    /^192\.168\.\d{1,3}\.\d{1,3}$/.test(normalizedHostname) ||
    /^172\.(1[6-9]|2\d|3[0-1])\.\d{1,3}\.\d{1,3}$/.test(normalizedHostname)
  );
};

const corsOptions = {
  origin(origin, callback) {
    if (isAllowedOrigin(origin)) {
      return callback(null, true);
    }

    return callback(new Error("CORS origin not allowed."));
  },
  methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"],
  credentials: true,
  optionsSuccessStatus: 204,
};

const isAllowedOrigin = (origin) => {
  if (!origin) {
    return true;
  }

  if (allowedOrigins.includes(origin)) {
    return true;
  }

  try {
    const parsedOrigin = new URL(origin);
    const hostname = parsedOrigin.hostname;
    const protocol = String(parsedOrigin.protocol || "").toLowerCase();

  if (
    isPrivateDevelopmentHost(hostname) &&
    (protocol === "http:" || protocol === "https:")
  ) {
    return true;
  }

  return (
      hostname.endsWith(".onrender.com") ||
      hostname.endsWith(".vercel.app") ||
      hostname.endsWith(".trycloudflare.com")
    );
  } catch {
    return false;
  }
};
//////////////////////////connect to mongoDB///////////////////////////////
mongoose.connect(process.env.DB_CONNECTION, {
  dbName: String(process.env.DB_NAME || "phenomed").trim(),
});
const db = mongoose.connection;
db.on("error", console.error.bind(console, "connection error:"));
db.once("open", async function () {
  console.log("database is connected!");
  try {
    await UserModel.collection.createIndex(
      { "auth.username": 1 },
      { name: "subjects_auth_username_idx" },
    );
    console.log("username index is ready.");
  } catch (error) {
    console.error("failed to ensure username index:", error);
  }
  try {
    await UserModel.collection.createIndex(
      { "profile.hometown.City": 1 },
      { name: "subjects_hometown_city_idx", sparse: true },
    );
    console.log("hometown city index is ready.");
  } catch (error) {
    console.error("failed to ensure hometown city index:", error);
  }
});
////////////////////////////////////////////////////////////////////

//we use this middleware to access the body of the request
app.set("trust proxy", true);
app.use(cors(corsOptions));
app.options("*", cors(corsOptions));
app.use(morgan("dev"));
app.use(express.json({ limit: "10mb" }));

const io = new Server(server, {
  cors: {
    origin(origin, callback) {
      if (isAllowedOrigin(origin)) {
        return callback(null, true);
      }

      return callback(new Error("Socket origin not allowed."));
    },
    methods: ["GET", "POST"],
  },
});

app.locals.io = io;

const activeChatPartnersByUser = new Map();
const activeTypingPartnersByUser = new Map();
const activeTypingDraftStateByUser = new Map();
const activeSocketIdsByUser = new Map();
const getUserRoom = (userId) => `user:${userId}`;
const USER_STALE_OFFLINE_AFTER_MS = 90 * 1000;
const USER_STALE_CHECK_INTERVAL_MS = 30 * 1000;

const getCloudinaryHealthConfig = () => {
  const envCloudName = String(process.env.CLOUDINARY_CLOUD_NAME || "").trim();
  const envApiKey = String(process.env.CLOUDINARY_API_KEY || "").trim();
  const envApiSecret = String(process.env.CLOUDINARY_API_SECRET || "").trim();
  const cloudinaryUrl = String(process.env.CLOUDINARY_URL || "").trim();

  let urlCloudName = "";
  let urlApiKey = "";
  let urlApiSecret = "";

  if (cloudinaryUrl) {
    try {
      const parsedUrl = new URL(cloudinaryUrl);
      if (parsedUrl.protocol === "cloudinary:") {
        urlCloudName = String(parsedUrl.hostname || "").trim();
        urlApiKey = decodeURIComponent(String(parsedUrl.username || "").trim());
        urlApiSecret = decodeURIComponent(
          String(parsedUrl.password || "").trim(),
        );
      }
    } catch {
      const normalizedCloudinaryUrl = cloudinaryUrl.replace(
        /^cloudinary:\/\//i,
        "",
      );
      const cloudinaryUrlMatch = normalizedCloudinaryUrl.match(
        /^([^:]+):([^@]+)@(.+)$/,
      );

      if (cloudinaryUrlMatch) {
        urlApiKey = decodeURIComponent(
          String(cloudinaryUrlMatch[1] || "").trim(),
        );
        urlApiSecret = decodeURIComponent(
          String(cloudinaryUrlMatch[2] || "").trim(),
        );
        urlCloudName = String(cloudinaryUrlMatch[3] || "").trim();
      }
    }
  }

  const cloudName = envCloudName || urlCloudName;
  const apiKey = envApiKey || urlApiKey;
  const apiSecret = envApiSecret || urlApiSecret;

  return {
    isReady: Boolean(cloudName && apiKey && apiSecret),
  };
};

app.get("/api/health", async function (req, res) {
  const dbReadyState = mongoose.connection?.readyState ?? 0;
  const dbHealthy = dbReadyState === 1;
  const openAiConnected = Boolean(
    String(process.env.OPENAI_API_KEY || "").trim(),
  );
  const groqConnected = Boolean(String(process.env.GROQ_API_KEY || "").trim());
  const geminiConnected = Boolean(
    String(process.env.GEMINI_API_KEY || "").trim(),
  );
  const kimiConnected = Boolean(
    String(process.env.MOONSHOT_API_KEY || process.env.KIMI_API_KEY || "").trim(),
  );
  const cloudinaryConnected = getCloudinaryHealthConfig().isReady;
  let telegramConnected = false;

  try {
    const authorizationHeader = String(req.headers?.authorization || "").trim();
    const token = authorizationHeader.startsWith("Bearer ")
      ? authorizationHeader.slice(7).trim()
      : "";

    if (token && process.env.JWT_KEY) {
      const decoded = jwt.verify(token, process.env.JWT_KEY);
      const user = await UserModel.findById(decoded?.userId).select(
        "settings.telegram.status.apiIdEncrypted settings.telegram.status.apiHashEncrypted settings.telegram.status.stringSessionEncrypted",
      );
      const telegramStatus = user?.settings?.telegram?.status || {};
      telegramConnected = Boolean(
        telegramStatus.apiIdEncrypted &&
        telegramStatus.apiHashEncrypted &&
        telegramStatus.stringSessionEncrypted,
      );
    }
  } catch {}

  return res.status(dbHealthy ? 200 : 503).json({
    status: dbHealthy ? "healthy" : "degraded",
    app: "ready",
    database: dbHealthy ? "connected" : "disconnected",
    ai: {
      openai: openAiConnected ? "connected" : "offline",
      groq: groqConnected ? "connected" : "offline",
      gemini: geminiConnected ? "connected" : "offline",
      kimi: kimiConnected ? "connected" : "offline",
      telegram: telegramConnected ? "connected" : "offline",
      cloudinary: cloudinaryConnected ? "connected" : "offline",
    },
    uptimeSeconds: Math.round(process.uptime()),
    timestamp: new Date().toISOString(),
  });
});

const emitChatPresenceForPair = ({ userId, friendId }) => {
  if (!userId || !friendId) {
    return;
  }

  const userIsChattingWithFriend =
    activeChatPartnersByUser.get(String(userId)) === String(friendId);
  const friendIsChattingWithUser =
    activeChatPartnersByUser.get(String(friendId)) === String(userId);

  io.to(`user:${userId}`).emit("chat:presence", {
    userId: String(friendId),
    friendId: String(userId),
    isChatting: friendIsChattingWithUser,
  });
  io.to(`user:${friendId}`).emit("chat:presence", {
    userId: String(userId),
    friendId: String(friendId),
    isChatting: userIsChattingWithFriend,
  });
};

const emitTypingPresenceForPair = ({ userId, friendId }) => {
  if (!userId || !friendId) {
    return;
  }

  const userIsTypingToFriend =
    activeTypingPartnersByUser.get(String(userId)) === String(friendId);
  const friendIsTypingToUser =
    activeTypingPartnersByUser.get(String(friendId)) === String(userId);
  const userHasTextForFriend =
    activeTypingDraftStateByUser.get(String(userId))?.get(String(friendId)) === true;
  const friendHasTextForUser =
    activeTypingDraftStateByUser.get(String(friendId))?.get(String(userId)) === true;

  io.to(`user:${userId}`).emit("chat:typing", {
    userId: String(friendId),
    friendId: String(userId),
    isTyping: friendIsTypingToUser,
    hasText: friendHasTextForUser,
  });
  io.to(`user:${friendId}`).emit("chat:typing", {
    userId: String(userId),
    friendId: String(friendId),
    isTyping: userIsTypingToFriend,
    hasText: userHasTextForFriend,
  });
};

const getRecipientLocalStatusForPair = ({ userId, friendId }) => {
  if (!userId || !friendId) {
    return null;
  }

  const normalizedUserId = String(userId);
  const normalizedFriendId = String(friendId);

  if (activeTypingPartnersByUser.get(normalizedUserId) === normalizedFriendId) {
    return "typing";
  }

  if (activeChatPartnersByUser.get(normalizedUserId) === normalizedFriendId) {
    return "in my chat";
  }

  return null;
};

const updateConnectionLocalStatus = async ({
  userId,
  friendId,
  value = null,
  updatedAt = new Date(),
}) => {
  const normalizedUserId = String(userId || "").trim();
  const normalizedFriendId = String(friendId || "").trim();
  const normalizedValue = String(value || "").trim().toLowerCase();
  const nextValue = ["in my chat", "typing"].includes(normalizedValue)
    ? normalizedValue
    : null;

  if (!normalizedUserId || !normalizedFriendId) {
    return;
  }

  try {
    const userDoc = await UserModel.findById(normalizedUserId)
      .select("connections")
      .maxTimeMS(4000);

    if (!userDoc || !Array.isArray(userDoc.connections)) {
      return;
    }

    let mutated = false;

    userDoc.connections.forEach((connectionEntry) => {
      if (
        String(connectionEntry?.kind || "").trim().toLowerCase() !== "friend" ||
        String(connectionEntry?.id || "").trim() !== normalizedFriendId
      ) {
        return;
      }

      connectionEntry.localStatus =
        connectionEntry.localStatus &&
        typeof connectionEntry.localStatus === "object"
          ? connectionEntry.localStatus
          : {};

      connectionEntry.localStatus.value = nextValue;
      connectionEntry.localStatus.updatedAt = updatedAt;
      if (nextValue === "in my chat") {
        connectionEntry.localStatus.lastChatAt = updatedAt;
      }
      if (nextValue === "typing") {
        connectionEntry.localStatus.lastTypingAt = updatedAt;
      }
      mutated = true;
    });

    if (mutated) {
      userDoc.markModified("connections");
      await userDoc.save();
      emitUserRefresh(io, normalizedUserId, "connection:changed", {
        friendId: normalizedFriendId,
        localStatus: nextValue,
        targetUserId: normalizedUserId,
      });
    }
  } catch (error) {
    console.error(
      "[presence] failed to update local connection status:",
      error?.message || error,
    );
  }
};

const messageHasStatusValue = (messageEntry, statusValue) =>
  Array.isArray(messageEntry?.status) &&
  messageEntry.status.some(
    (statusEntry) =>
      String(statusEntry?.value || "")
        .trim()
        .toLowerCase() === String(statusValue || "").trim().toLowerCase(),
  );

const appendMessageStatusIfMissing = (messageEntry, statusValue, updatedAt) => {
  if (!messageEntry) {
    return false;
  }

  if (messageHasStatusValue(messageEntry, statusValue)) {
    return false;
  }

  if (!Array.isArray(messageEntry.status)) {
    messageEntry.status = [];
  }

  messageEntry.status.push({
    value: statusValue,
    updatedAt,
  });
  return true;
};

const markDeliveredMessagesForOnlineUser = async (onlineUserId) => {
  const normalizedOnlineUserId = String(onlineUserId || "").trim();
  if (!normalizedOnlineUserId) {
    return;
  }

  try {
    const senderUsers = await UserModel.find({
      connections: {
        $elemMatch: {
          kind: "friend",
          id: normalizedOnlineUserId,
        },
      },
    })
      .select("connections")
      .maxTimeMS(4000);

    const now = new Date();
    const refreshedUserIds = new Set([normalizedOnlineUserId]);

    await Promise.all(
      (Array.isArray(senderUsers) ? senderUsers : []).map(async (senderUser) => {
        if (!senderUser || !Array.isArray(senderUser.connections)) {
          return;
        }

        let mutated = false;

        senderUser.connections.forEach((connectionEntry) => {
          if (
            String(connectionEntry?.kind || "").trim().toLowerCase() !== "friend" ||
            String(connectionEntry?.id || "").trim() !== normalizedOnlineUserId
          ) {
            return;
          }

          const chatThreads = Array.isArray(connectionEntry.chat)
            ? connectionEntry.chat
            : [];

          chatThreads.forEach((thread) => {
            const messages = Array.isArray(thread?.messages) ? thread.messages : [];
            messages.forEach((messageEntry) => {
              const senderRole = String(messageEntry?.index?.sender || "")
                .trim()
                .toUpperCase();
              if (senderRole !== "ME") {
                return;
              }

              if (
                messageHasStatusValue(messageEntry, "read") ||
                messageHasStatusValue(messageEntry, "delivered") ||
                messageHasStatusValue(messageEntry, "deleted") ||
                !messageHasStatusValue(messageEntry, "sent")
              ) {
                return;
              }

              if (appendMessageStatusIfMissing(messageEntry, "delivered", now)) {
                mutated = true;
              }
            });
          });
        });

        if (!mutated) {
          return;
        }

        senderUser.markModified("connections");
        await senderUser.save();
        refreshedUserIds.add(String(senderUser._id || "").trim());
      }),
    );

    if (refreshedUserIds.size > 1) {
      emitUserRefresh(io, [...refreshedUserIds], "chat:delivery", {
        userId: normalizedOnlineUserId,
      });
    }
  } catch (error) {
    console.error("Failed to mark messages as delivered", error);
  }
};

io.on("connection", (socket) => {
  socket.on("user:join", ({ userId }) => {
    if (!userId) {
      return;
    }

    const normalizedUserId = String(userId).trim();
    const previousUserId = socket.data.userId ? String(socket.data.userId) : "";

    if (previousUserId && previousUserId !== normalizedUserId) {
      const previousSockets = activeSocketIdsByUser.get(previousUserId);

      if (previousSockets) {
        previousSockets.delete(socket.id);

        if (previousSockets.size === 0) {
          activeSocketIdsByUser.delete(previousUserId);
        }
      }
    }

    socket.data.userId = normalizedUserId;
    socket.join(getUserRoom(normalizedUserId));
    const userSocketIds = activeSocketIdsByUser.get(normalizedUserId) || new Set();
    userSocketIds.add(socket.id);
    activeSocketIdsByUser.set(normalizedUserId, userSocketIds);

    const activeFriendId = activeChatPartnersByUser.get(normalizedUserId);
    if (activeFriendId) {
      emitChatPresenceForPair({
        userId: normalizedUserId,
        friendId: activeFriendId,
      });
    }

    const activeTypingFriendId =
      activeTypingPartnersByUser.get(normalizedUserId);
    if (activeTypingFriendId) {
      emitTypingPresenceForPair({
        userId: normalizedUserId,
        friendId: activeTypingFriendId,
      });
    }

    activeChatPartnersByUser.forEach((partnerId, activeUserId) => {
      if (
        String(activeUserId) !== normalizedUserId &&
        String(partnerId) === normalizedUserId
      ) {
        emitChatPresenceForPair({
          userId: normalizedUserId,
          friendId: String(activeUserId),
        });
      }
    });

    activeTypingPartnersByUser.forEach((partnerId, activeUserId) => {
      if (
        String(activeUserId) !== normalizedUserId &&
        String(partnerId) === normalizedUserId
      ) {
        emitTypingPresenceForPair({
          userId: normalizedUserId,
          friendId: String(activeUserId),
        });
      }
    });

    markDeliveredMessagesForOnlineUser(normalizedUserId);
  });

  socket.on("user:chat-status", ({ userId, friendId, isChatting }) => {
    if (!userId || !friendId) {
      return;
    }

    if (isChatting) {
      activeChatPartnersByUser.set(String(userId), String(friendId));
    } else {
      activeChatPartnersByUser.delete(String(userId));
    }

    emitChatPresenceForPair({
      userId: String(userId),
      friendId: String(friendId),
    });

    updateConnectionLocalStatus({
      userId,
      friendId,
      value: null,
    });

    updateConnectionLocalStatus({
      userId: friendId,
      friendId: userId,
      value: getRecipientLocalStatusForPair({
        userId,
        friendId,
      }),
    });
  });

  socket.on("user:typing-status", ({ userId, friendId, isTyping, hasText }) => {
    if (!userId || !friendId) {
      return;
    }

    const normalizedUserId = String(userId);
    const normalizedFriendId = String(friendId);
    let draftStateForUser = activeTypingDraftStateByUser.get(normalizedUserId);

    if (!draftStateForUser) {
      draftStateForUser = new Map();
      activeTypingDraftStateByUser.set(normalizedUserId, draftStateForUser);
    }

    draftStateForUser.set(normalizedFriendId, Boolean(hasText));

    if (isTyping) {
      activeTypingPartnersByUser.set(normalizedUserId, normalizedFriendId);
    } else {
      activeTypingPartnersByUser.delete(normalizedUserId);
    }

    emitTypingPresenceForPair({
      userId: normalizedUserId,
      friendId: normalizedFriendId,
    });

    updateConnectionLocalStatus({
      userId: normalizedUserId,
      friendId: normalizedFriendId,
      value: null,
    });

    updateConnectionLocalStatus({
      userId: normalizedFriendId,
      friendId: normalizedUserId,
      value: getRecipientLocalStatusForPair({
        userId: normalizedUserId,
        friendId: normalizedFriendId,
      }),
    });
  });

  socket.on("user:message-read", async ({ userId, friendId }) => {
    const readerUserId = String(userId || socket.data.userId || "").trim();
    const senderUserId = String(friendId || "").trim();

    if (!readerUserId || !senderUserId) {
      return;
    }

    try {
      const [readerUser, senderUser] = await Promise.all([
        UserModel.findById(readerUserId).select("connections"),
        UserModel.findById(senderUserId).select("connections"),
      ]);

      if (!readerUser || !senderUser) {
        return;
      }

      const now = new Date();
      let senderMutated = false;
      let readerMutated = false;

      const markThreadMessagesRead = (userDoc, counterpartId, expectedSenderRole) => {
        const connections = Array.isArray(userDoc?.connections) ? userDoc.connections : [];

        connections.forEach((connectionEntry) => {
          if (
            String(connectionEntry?.kind || "").trim().toLowerCase() !== "friend" ||
            String(connectionEntry?.id || "").trim() !== String(counterpartId || "").trim()
          ) {
            return;
          }

          const chatThreads = Array.isArray(connectionEntry.chat)
            ? connectionEntry.chat
            : [];

          chatThreads.forEach((thread) => {
            const messages = Array.isArray(thread?.messages) ? thread.messages : [];
            messages.forEach((messageEntry) => {
              const senderRole = String(messageEntry?.index?.sender || "")
                .trim()
                .toUpperCase();

              if (senderRole !== expectedSenderRole) {
                return;
              }

              if (messageHasStatusValue(messageEntry, "deleted")) {
                return;
              }

              const didAppendRead = appendMessageStatusIfMissing(
                messageEntry,
                "read",
                now,
              );

              if (expectedSenderRole === "ME" && didAppendRead) {
                senderMutated = true;
              }

              if (expectedSenderRole === "THEM" && didAppendRead) {
                readerMutated = true;
              }
            });
          });
        });
      };

      markThreadMessagesRead(senderUser, readerUserId, "ME");
      markThreadMessagesRead(readerUser, senderUserId, "THEM");

      const saveTasks = [];
      if (senderMutated) {
        senderUser.markModified("connections");
        saveTasks.push(senderUser.save());
      }
      if (readerMutated) {
        readerUser.markModified("connections");
        saveTasks.push(readerUser.save());
      }
      if (saveTasks.length > 0) {
        await Promise.all(saveTasks);
      }

      emitChatRead(io, [readerUserId, senderUserId], {
        friendId: readerUserId,
        readerUserId,
        senderUserId,
      });
    } catch (error) {
      console.error("Failed to mark messages as read", error);
    }
  });

  socket.on("call:offer", ({ toUserId, fromUserId, offer, callType, metadata, callId }) => {
    const callerUserId = String(socket.data.userId || fromUserId || "").trim();
    const targetUserId = String(toUserId || "").trim();

    if (!callerUserId || !targetUserId || !offer) {
      return;
    }

    io.to(getUserRoom(targetUserId)).emit("call:offer", {
      fromUserId: callerUserId,
      toUserId: targetUserId,
      callType: callType === "video" ? "video" : "audio",
      offer,
      callId: String(callId || "").trim(),
      metadata: metadata && typeof metadata === "object" ? metadata : {},
    });
  });

  socket.on("call:offer-received", ({ toUserId, fromUserId, callId, callType }) => {
    const receiverUserId = String(socket.data.userId || fromUserId || "").trim();
    const targetUserId = String(toUserId || "").trim();
    const normalizedCallId = String(callId || "").trim();

    if (!receiverUserId || !targetUserId || !normalizedCallId) {
      return;
    }

    io.to(getUserRoom(targetUserId)).emit("call:offer-received", {
      fromUserId: receiverUserId,
      toUserId: targetUserId,
      callId: normalizedCallId,
      callType: callType === "video" ? "video" : "audio",
    });
  });

  socket.on("call:answer", ({ toUserId, fromUserId, answer }) => {
    const callerUserId = String(socket.data.userId || fromUserId || "").trim();
    const targetUserId = String(toUserId || "").trim();

    if (!callerUserId || !targetUserId || !answer) {
      return;
    }

    io.to(getUserRoom(targetUserId)).emit("call:answer", {
      fromUserId: callerUserId,
      toUserId: targetUserId,
      answer,
    });
  });

  socket.on("call:ice-candidate", ({ toUserId, fromUserId, candidate }) => {
    const callerUserId = String(socket.data.userId || fromUserId || "").trim();
    const targetUserId = String(toUserId || "").trim();

    if (!callerUserId || !targetUserId || !candidate) {
      return;
    }

    io.to(getUserRoom(targetUserId)).emit("call:ice-candidate", {
      fromUserId: callerUserId,
      toUserId: targetUserId,
      candidate,
    });
  });

  socket.on("call:reject", ({ toUserId, fromUserId, reason }) => {
    const callerUserId = String(socket.data.userId || fromUserId || "").trim();
    const targetUserId = String(toUserId || "").trim();

    if (!callerUserId || !targetUserId) {
      return;
    }

    io.to(getUserRoom(targetUserId)).emit("call:reject", {
      fromUserId: callerUserId,
      toUserId: targetUserId,
      reason: String(reason || "rejected").trim() || "rejected",
    });
  });

  socket.on("call:end", ({ toUserId, fromUserId, reason }) => {
    const callerUserId = String(socket.data.userId || fromUserId || "").trim();
    const targetUserId = String(toUserId || "").trim();

    if (!callerUserId || !targetUserId) {
      return;
    }

    io.to(getUserRoom(targetUserId)).emit("call:end", {
      fromUserId: callerUserId,
      toUserId: targetUserId,
      reason: String(reason || "ended").trim() || "ended",
    });
  });

  socket.on("disconnect", () => {
    const userId = socket.data.userId ? String(socket.data.userId) : "";
    const userSocketIds = userId ? activeSocketIdsByUser.get(userId) : null;

    if (userSocketIds) {
      userSocketIds.delete(socket.id);

      if (userSocketIds.size === 0) {
        activeSocketIdsByUser.delete(userId);
      }
    }

    const userStillConnected =
      Boolean(userId) &&
      activeSocketIdsByUser.has(userId) &&
      activeSocketIdsByUser.get(userId)?.size > 0;

    if (userStillConnected) {
      return;
    }

    const friendId = activeChatPartnersByUser.get(userId);
    const typingFriendId = activeTypingPartnersByUser.get(userId);

    if (userId && friendId) {
      activeChatPartnersByUser.delete(userId);
      emitChatPresenceForPair({
        userId,
        friendId,
      });
      updateConnectionLocalStatus({
        userId,
        friendId,
        value: null,
      });
      updateConnectionLocalStatus({
        userId: friendId,
        friendId: userId,
        value: null,
      });
    }

    if (userId && typingFriendId) {
      activeTypingPartnersByUser.delete(userId);
      activeTypingDraftStateByUser.delete(userId);
      emitTypingPresenceForPair({
        userId,
        friendId: typingFriendId,
      });
      updateConnectionLocalStatus({
        userId,
        friendId: typingFriendId,
        value: null,
      });
      updateConnectionLocalStatus({
        userId: typingFriendId,
        friendId: userId,
        value: getRecipientLocalStatusForPair({
          userId,
          friendId: typingFriendId,
        }),
      });
    }

    if (userId) {
      activeTypingDraftStateByUser.delete(userId);
    }

    if (userId) {
      setImmediate(async () => {
        try {
          const disconnectedUser = await UserModel.findById(userId)
            .select("_id connections friends status")
            .maxTimeMS(4000);

          if (!disconnectedUser) {
            return;
          }

          setUserConnectionState(disconnectedUser, {
            statusValue: "offline",
            at: new Date(),
          });

          await disconnectedUser.save();

          emitUserRefresh(
            io,
            getUserAndFriendIds(disconnectedUser),
            "connection:changed",
            {
              statusValue: "offline",
              targetUserId: String(disconnectedUser._id),
            },
          );
        } catch (error) {
          console.error(
            "[disconnect] offline reconciliation failed:",
            error?.message || error,
          );
        }
      });
    }
  });
});

//initialize routes
app.use("/api/user", UserAPI);
app.use("/api/chat", ChatAPI);
app.use("/api/enquiries", EnquiriesAPI);
app.use("/api/ecg", ECGAPI);
app.use("/api/telegram", TelegramAPI);
app.use("/api/jamendo", JamendoAPI);
// app.use("/api/video", VideoAPI);

// app.use("/api/posts", PostsAPI);

app.use(function (error, req, res, next) {
  if (res.headersSent) {
    return next(error);
  }

  res.status(error.status || 500);
  return res.json({
    error: {
      message: error.message,
    },
  });
});

server.listen(process.env.PORT || 4000, function () {
  startTelegramSyncWorker();
  console.log("now listening on port 4000");
});

setInterval(async () => {
  try {
    const staleThreshold = new Date(Date.now() - USER_STALE_OFFLINE_AFTER_MS);
    const staleUsers = await UserModel.find({
      "status.value": { $in: ["online", "busy", "studying"] },
      "status.updatedAt": { $lt: staleThreshold },
    }).select("_id connections status");

    for (const staleUser of staleUsers) {
      setUserConnectionState(staleUser, {
        statusValue: "offline",
        at: new Date(),
      });

      await staleUser.save();

      emitUserRefresh(
        io,
        [
          String(staleUser._id),
          ...((Array.isArray(staleUser.connections)
            ? staleUser.connections
            : []
          )
            .map((entry) => String(entry?.id || "").trim())
            .filter(Boolean)),
        ],
        "connection:changed",
        {
          statusValue: "offline",
          targetUserId: String(staleUser._id),
        },
      );
    }
  } catch (error) {
    console.error("Failed to reconcile stale online users", error);
  }
}, USER_STALE_CHECK_INTERVAL_MS);
