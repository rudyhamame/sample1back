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
// const PostsAPI = require("./routes/PostsAPI");

import "dotenv/config.js";
//////////////////////////connect to mongoDB///////////////////////////////
mongoose.connect(process.env.DB_CONNECTION);
const db = mongoose.connection;
db.on("error", console.error.bind(console, "connection error:"));
db.once("open", function () {
  console.log("database is connected!");
});
////////////////////////////////////////////////////////////////////

//we use this middleware to access the body of the request
app.use(cors());
app.use(morgan("dev"));
app.use(express.json());

//initialize routes
app.use("/api/user", UserAPI);
app.use("/api/chat", ChatAPI);
app.use("/api/posts", PostsAPI);
app.use("/api/atom", AtomAPI);
app.use("/api/keywords", KeywordsAPI);

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
