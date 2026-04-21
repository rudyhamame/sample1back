import express from "express";
import multer from "multer";
import path from "path";
import fs from "fs";
import { Server } from "socket.io";
import compressVideo from "../helpers/compressVideo.js";

const router = express.Router();

// Use disk storage to track upload progress
const upload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => {
      const uploadDir = path.join(__dirname, "../storage/uploads");
      fs.mkdirSync(uploadDir, { recursive: true });
      cb(null, uploadDir);
    },
    filename: (req, file, cb) => {
      cb(null, Date.now() + "-" + file.originalname);
    },
  }),
  limits: { fileSize: 200 * 1024 * 1024 }, // 200MB max
});

// Helper to emit progress
function emitProgress(io, socketId, stage, percent) {
  if (io && socketId) {
    io.to(socketId).emit("video:progress", { stage, percent });
  }
}

router.post("/upload", upload.single("video"), async (req, res) => {
  const io = req.app.locals.io;
  const socketId = req.headers["x-socket-id"];
  const file = req.file;
  if (!file) {
    return res.status(400).json({ message: "No file uploaded" });
  }

  // Emit 100% upload complete
  emitProgress(io, socketId, "upload", 100);

  // Only compress if file is 100MB or larger
  const ONE_HUNDRED_MB = 100 * 1024 * 1024;
  if (file.size >= ONE_HUNDRED_MB) {
    emitProgress(io, socketId, "compression", 0);
    const outputPath = file.path.replace(/\.[^.]+$/, "-compressed.mp4");
    try {
      await compressVideo(file.path, outputPath);
      emitProgress(io, socketId, "compression", 100);
      res.json({
        message: "Upload and compression complete (compressed)",
        videoUrl: `/uploads/${path.basename(outputPath)}`,
      });
    } catch (err) {
      res
        .status(500)
        .json({ message: "Compression failed", error: String(err) });
    }
  } else {
    // No compression needed, return original file
    res.json({
      message: "Upload complete (no compression needed)",
      videoUrl: `/uploads/${path.basename(file.path)}`,
    });
  }
});

export default router;
