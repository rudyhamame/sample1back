import morgan from "morgan";
import mongoose from "mongoose";
import cors from "cors";
import express from "express";
const app = express(); // initialie express
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

const isAllowedOrigin = (origin) => {
  if (!origin) {
    return true;
  }

  if (allowedOrigins.includes(origin)) {
    return true;
  }

  try {
    const hostname = new URL(origin).hostname;
    return hostname.endsWith(".vercel.app");
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
  cors({
    origin(origin, callback) {
      if (isAllowedOrigin(origin)) {
        return callback(null, true);
      }

      return callback(new Error("CORS origin not allowed."));
    },
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
  }),
);
app.use(morgan("dev"));
app.use(express.json());

//initialize routes
app.use("/api/user", UserAPI);
app.use("/api/chat", ChatAPI);
app.use("/api/posts", PostsAPI);
app.use("/api/atom", AtomAPI);
app.use("/api/keywords", KeywordsAPI);
app.use("/api/enquiries", EnquiriesAPI);

// app.use("/api/posts", PostsAPI);

app.use(function (error, req, res, next) {
  res.status(err.status || 500);
  res.json({
    error: {
      message: error.message,
    },
  });
});

app.listen(process.env.PORT || 4000, function () {
  console.log("now listening on port 4000");
});
