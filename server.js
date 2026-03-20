import morgan from "morgan";
import mongoose from "mongoose";
import cors from "cors";
import express from "express";
import http from "http";
import { Server } from "socket.io";
const app = express(); // initialie express
const server = http.createServer(app);
////////////////////////////////////////

/////////////////////////////////////////////////////////////
import UserAPI from "./routes/UserAPI.js";
import ChatAPI from "./routes/ChatAPI.js";
import PostsAPI from "./routes/PostsAPI.js";
import AtomAPI from "./routes/AtomAPI.js";
import KeywordsAPI from "./routes/KeywordsAPI.js";
import EnquiriesAPI from "./routes/EnquiriesAPI.js";
// const PostsAPI = require("./routes/PostsAPI");

import "dotenv/config.js";

const allowedOrigins = [
  "http://localhost:3000",
  "http://localhost:5173",
  process.env.FRONTEND_URL,
].filter(Boolean);

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
    const hostname = new URL(origin).hostname;
    return (
      hostname.endsWith(".vercel.app") ||
      hostname.endsWith(".trycloudflare.com")
    );
  } catch {
    return false;
  }
};
//////////////////////////connect to mongoDB///////////////////////////////
mongoose.connect(process.env.DB_CONNECTION);
const db = mongoose.connection;
db.on("error", console.error.bind(console, "connection error:"));
db.once("open", function () {
  console.log("database is connected!");
});
////////////////////////////////////////////////////////////////////

//we use this middleware to access the body of the request
app.use(
  cors(corsOptions),
);
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

const emitChatPresence = ({ userId, friendId, isChatting }) => {
  if (!userId || !friendId) {
    return;
  }

  io.to(`user:${userId}`).emit("chat:presence", {
    userId,
    friendId,
    isChatting,
  });
  io.to(`user:${friendId}`).emit("chat:presence", {
    userId,
    friendId,
    isChatting,
  });
};

const emitTypingPresence = ({ userId, friendId, isTyping }) => {
  if (!userId || !friendId) {
    return;
  }

  io.to(`user:${userId}`).emit("chat:typing", {
    userId,
    friendId,
    isTyping,
  });
  io.to(`user:${friendId}`).emit("chat:typing", {
    userId,
    friendId,
    isTyping,
  });
};

io.on("connection", (socket) => {
  socket.on("user:join", ({ userId }) => {
    if (!userId) {
      return;
    }

    socket.data.userId = userId;
    socket.join(`user:${userId}`);
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

    emitChatPresence({
      userId: String(userId),
      friendId: String(friendId),
      isChatting: Boolean(isChatting),
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

    emitTypingPresence({
      userId: String(userId),
      friendId: String(friendId),
      isTyping: Boolean(isTyping),
    });
  });

  socket.on("disconnect", () => {
    const userId = socket.data.userId ? String(socket.data.userId) : "";
    const friendId = activeChatPartnersByUser.get(userId);
    const typingFriendId = activeTypingPartnersByUser.get(userId);

    if (userId && friendId) {
      activeChatPartnersByUser.delete(userId);
      emitChatPresence({
        userId,
        friendId,
        isChatting: false,
      });
    }

    if (userId && typingFriendId) {
      activeTypingPartnersByUser.delete(userId);
      emitTypingPresence({
        userId,
        friendId: typingFriendId,
        isTyping: false,
      });
    }
  });
});

//initialize routes
app.use("/api/user", UserAPI);
app.use("/api/chat", ChatAPI);
app.use("/api/posts", PostsAPI);
app.use("/api/atom", AtomAPI);
app.use("/api/keywords", KeywordsAPI);
app.use("/api/enquiries", EnquiriesAPI);

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
  console.log("now listening on port 4000");
});
