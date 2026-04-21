import compressVideo from "./compressVideo.js";
import cloudinary from "./cloudinary.js";
import fs from "fs";
import mongoose from "mongoose";
// import VideoModel from "../models/Video.js";
import path from "path";

// Connect to MongoDB (adjust URI as needed)
const MONGODB_URI =
  process.env.MONGODB_URI || "mongodb://localhost:27017/step1-backend";
mongoose.connect(MONGODB_URI, {
  useNewUrlParser: true,
  useUnifiedTopology: true,
});

// Accept input/output filenames as command-line arguments
const [, , input, output] = process.argv;

if (!input || !output) {
  console.error("Usage: node helpers/testCompress.js <inputFile> <outputFile>");
  process.exit(1);
}

compressVideo(input, output, { resolution: "854x480", videoBitrate: "800k" })
  .then(() => {
    console.log("Compression done! Uploading to Cloudinary...");
    return cloudinary.uploader.upload(output, {
      resource_type: "video",
      folder: "compressed_videos",
    });
  })
  .then(async (result) => {
    console.log("Uploaded to Cloudinary:", result.secure_url);
    // Store in DB: You should now update the user's memory.local.videos array in Users.js
    // Example (pseudo-code, adjust as needed):
    // const user = await UserModel.findById(userId);
    // user.memory.local.videos.push({
    //   identity: {
    //     fileName: path.basename(input),
    //     url: result.secure_url,
    //     publicId: result.public_id,
    //     mimeType: result.resource_type,
    //     assetId: result.asset_id,
    //     folder: result.folder,
    //     resourceType: result.resource_type,
    //     width: result.width,
    //     height: result.height,
    //     format: result.format,
    //     bytes: result.bytes,
    //     duration: result.duration,
    //     createdAt: new Date(),
    //     updatedAt: new Date(),
    //     shared: false,
    //   }
    // });
    // await user.save();
    // console.log("Video metadata saved to user.memory.local.videos.");
    // Optionally, delete the local file after upload
    // fs.unlinkSync(output);
    mongoose.disconnect();
  })
  .catch((err) => {
    console.error(err);
    mongoose.disconnect();
  });
