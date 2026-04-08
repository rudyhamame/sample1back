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
import UserModel from "./models/Users.js";

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
    const port = String(parsedOrigin.port || "").trim();

    if (port === "5173" && isPrivateDevelopmentHost(hostname)) {
      return true;
    }

    return (
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
db.once("open", function () {
  console.log("database is connected!");
});
////////////////////////////////////////////////////////////////////

//we use this middleware to access the body of the request
app.set("trust proxy", true);
app.use(cors(corsOptions));
app.options("*", cors(corsOptions));
app.use(morgan("dev"));
app.use(express.json());

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
        "telegram.status.apiIdEncrypted telegram.status.apiHashEncrypted telegram.status.stringSessionEncrypted",
      );
      telegramConnected = Boolean(
        user?.telegram.status?.apiIdEncrypted &&
        user?.telegram.status?.apiHashEncrypted &&
        user?.telegram.status?.stringSessionEncrypted,
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

  io.to(`user:${userId}`).emit("chat:typing", {
    userId: String(friendId),
    friendId: String(userId),
    isTyping: friendIsTypingToUser,
  });
  io.to(`user:${friendId}`).emit("chat:typing", {
    userId: String(userId),
    friendId: String(friendId),
    isTyping: userIsTypingToFriend,
  });
};

io.on("connection", (socket) => {
  socket.on("user:join", ({ userId }) => {
    if (!userId) {
      return;
    }

    const normalizedUserId = String(userId).trim();

    socket.data.userId = normalizedUserId;
    socket.join(getUserRoom(normalizedUserId));

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
  });

  socket.on("user:typing-status", ({ userId, friendId, isTyping }) => {
    if (!userId || !friendId) {
      return;
    }

    if (isTyping) {
      activeTypingPartnersByUser.set(String(userId), String(friendId));
    } else {
      activeTypingPartnersByUser.delete(String(userId));
    }

    emitTypingPresenceForPair({
      userId: String(userId),
      friendId: String(friendId),
    });
  });

  socket.on("user:message-read", async ({ userId, friendId }) => {
    const readerUserId = String(userId || socket.data.userId || "").trim();
    const senderUserId = String(friendId || "").trim();

    if (!readerUserId || !senderUserId) {
      return;
    }

    try {
      await UserModel.updateOne(
        { _id: senderUserId },
        {
          $set: {
            "chat.$[message].status": "read",
          },
        },
        {
          arrayFilters: [
            {
              "message._id": readerUserId,
              "message.from": "me",
              "message.status": { $ne: "read" },
            },
          ],
        },
      );

      await UserModel.updateOne(
        { _id: readerUserId },
        {
          $set: {
            "notifications.$[notification].status": "read",
          },
        },
        {
          arrayFilters: [
            {
              "notification.type": "chat_message",
              "notification.id": senderUserId,
            },
          ],
        },
      );

      emitUserRefresh(io, [readerUserId, senderUserId], "chat:read", {
        friendId: readerUserId,
        readerUserId,
        senderUserId,
      });
    } catch (error) {
      console.error("Failed to mark messages as read", error);
    }
  });

  socket.on("call:offer", ({ toUserId, offer, callType, metadata }) => {
    const fromUserId = String(socket.data.userId || "").trim();
    const targetUserId = String(toUserId || "").trim();

    if (!fromUserId || !targetUserId || !offer) {
      return;
    }

    io.to(getUserRoom(targetUserId)).emit("call:offer", {
      fromUserId,
      toUserId: targetUserId,
      callType: callType === "video" ? "video" : "audio",
      offer,
      metadata: metadata && typeof metadata === "object" ? metadata : {},
    });
  });

  socket.on("call:answer", ({ toUserId, answer }) => {
    const fromUserId = String(socket.data.userId || "").trim();
    const targetUserId = String(toUserId || "").trim();

    if (!fromUserId || !targetUserId || !answer) {
      return;
    }

    io.to(getUserRoom(targetUserId)).emit("call:answer", {
      fromUserId,
      toUserId: targetUserId,
      answer,
    });
  });

  socket.on("call:ice-candidate", ({ toUserId, candidate }) => {
    const fromUserId = String(socket.data.userId || "").trim();
    const targetUserId = String(toUserId || "").trim();

    if (!fromUserId || !targetUserId || !candidate) {
      return;
    }

    io.to(getUserRoom(targetUserId)).emit("call:ice-candidate", {
      fromUserId,
      toUserId: targetUserId,
      candidate,
    });
  });

  socket.on("call:reject", ({ toUserId, reason }) => {
    const fromUserId = String(socket.data.userId || "").trim();
    const targetUserId = String(toUserId || "").trim();

    if (!fromUserId || !targetUserId) {
      return;
    }

    io.to(getUserRoom(targetUserId)).emit("call:reject", {
      fromUserId,
      toUserId: targetUserId,
      reason: String(reason || "rejected").trim() || "rejected",
    });
  });

  socket.on("call:end", ({ toUserId, reason }) => {
    const fromUserId = String(socket.data.userId || "").trim();
    const targetUserId = String(toUserId || "").trim();

    if (!fromUserId || !targetUserId) {
      return;
    }

    io.to(getUserRoom(targetUserId)).emit("call:end", {
      fromUserId,
      toUserId: targetUserId,
      reason: String(reason || "ended").trim() || "ended",
    });
  });

  socket.on("disconnect", () => {
    const userId = socket.data.userId ? String(socket.data.userId) : "";
    const friendId = activeChatPartnersByUser.get(userId);
    const typingFriendId = activeTypingPartnersByUser.get(userId);

    if (userId && friendId) {
      activeChatPartnersByUser.delete(userId);
      emitChatPresenceForPair({
        userId,
        friendId,
      });
    }

    if (userId && typingFriendId) {
      activeTypingPartnersByUser.delete(userId);
      emitTypingPresenceForPair({
        userId,
        friendId: typingFriendId,
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

// app.use("/api/posts", PostsAPI);

app.use(function (error, req, res, next) {
  res.status(error.status || 500);
  res.json({
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
      "identity.status.isLoggedIn": true,
      "identity.status.lastSeenAt": { $lt: staleThreshold },
    }).select("_id friends login_record status");

    for (const staleUser of staleUsers) {
      staleUser.identity.status.isLoggedIn = false;
      staleUser.identity.status.lastSeenAt = new Date();

      if (Array.isArray(staleUser.login_record)) {
        for (let i = staleUser.login_record.length - 1; i >= 0; i -= 1) {
          if (!staleUser.login_record[i].loggedOutAt) {
            staleUser.login_record[i].loggedOutAt = new Date();
            break;
          }
        }
      }

      await staleUser.save();

      emitUserRefresh(
        io,
        [
          String(staleUser._id),
          ...(staleUser.friends || []).map((friend) => String(friend)),
        ],
        "connection:changed",
        {
          isConnected: false,
          targetUserId: String(staleUser._id),
        },
      );
    }
  } catch (error) {
    console.error("Failed to reconcile stale online users", error);
  }
}, USER_STALE_CHECK_INTERVAL_MS);
