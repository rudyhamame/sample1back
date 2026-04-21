// compressVideo.js
// Node.js utility for video compression using ffmpeg CLI and @ffmpeg-installer/ffmpeg
// Requires: npm install @ffmpeg-installer/ffmpeg

import { spawn } from "child_process";
import ffmpegInstaller from "@ffmpeg-installer/ffmpeg";
const ffmpegPath = ffmpegInstaller.path;
import { emitCompressionProgress } from "./progressSocket.js";

/**
 * Compress a video file using ffmpeg CLI.
 * @param {string} inputPath - Path to the input video file.
 * @param {string} outputPath - Path to save the compressed video.
 * @param {Object} [options] - Compression options.
 * @param {string} [options.resolution] - e.g. '1280x720' for 720p, '854x480' for 480p, etc.
 * @param {string} [options.videoBitrate] - e.g. '1200k' for 1.2Mbps.
 * @param {string} [options.audioBitrate] - e.g. '128k'.
 * @param {string} [options.format] - Output format, e.g. 'mp4'.
 * @param {function} [options.onProgress] - Optional callback(percent) for progress updates.
 * @returns {Promise<string>} - Resolves with outputPath when done.
 */
export default function compressVideo(inputPath, outputPath, options = {}) {
  return new Promise((resolve, reject) => {
    const {
      resolution = "854:480",
      videoBitrate = "800k",
      audioBitrate = "128k",
      format = "mp4",
    } = options;

    // Use scale with force_original_aspect_ratio=decrease to preserve aspect ratio
    const args = [
      "-i",
      inputPath,
      "-vf",
      `scale=${resolution}:force_original_aspect_ratio=decrease`,
      "-b:v",
      videoBitrate,
      "-b:a",
      audioBitrate,
      "-preset",
      "veryfast",
      "-movflags",
      "+faststart",
      "-pix_fmt",
      "yuv420p",
      "-f",
      format,
      outputPath,
    ];

    const ffmpeg = spawn(ffmpegPath, args);

    ffmpeg.stdout.on("data", (data) => {
      process.stdout.write(data.toString());
    });
    ffmpeg.stderr.on("data", (data) => {
      process.stderr.write(data.toString());
    });

    let durationSeconds = 0;
    let lastPercent = 0;

    ffmpeg.stderr.on("data", (data) => {
      const str = data.toString();
      process.stderr.write(str);
      // Parse duration from ffmpeg output
      const durMatch = str.match(/Duration: (\d+):(\d+):(\d+\.\d+)/);
      if (durMatch) {
        const hours = parseInt(durMatch[1], 10);
        const minutes = parseInt(durMatch[2], 10);
        const seconds = parseFloat(durMatch[3]);
        durationSeconds = hours * 3600 + minutes * 60 + seconds;
      }
      // Parse time progress
      const timeMatch = str.match(/time=(\d+):(\d+):(\d+\.\d+)/);
      if (timeMatch && durationSeconds > 0) {
        const hours = parseInt(timeMatch[1], 10);
        const minutes = parseInt(timeMatch[2], 10);
        const seconds = parseFloat(timeMatch[3]);
        const currentSeconds = hours * 3600 + minutes * 60 + seconds;
        let percent = Math.min(
          100,
          Math.round((currentSeconds / durationSeconds) * 100),
        );
        if (percent !== lastPercent) {
          lastPercent = percent;
          if (typeof options.onProgress === "function") {
            options.onProgress(percent);
          }
        }
      }
    });

    ffmpeg.on("close", (code) => {
      if (code === 0) {
        resolve(outputPath);
      } else {
        reject(new Error(`ffmpeg exited with code ${code}`));
      }
    });
    ffmpeg.on("error", (err) => {
      reject(err);
    });

    // Emit progress updates during compression
    ffmpeg.stdout.on("data", (data) => {
      emitCompressionProgress(inputPath, data);
    });
  });
}
