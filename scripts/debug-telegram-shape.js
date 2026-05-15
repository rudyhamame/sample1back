import mongoose from "mongoose";
import dotenv from "dotenv";
import UserModel from "../compat/UserModel.js";

dotenv.config();

const userId = process.argv[2];
if (!userId) {
  console.error("Usage: node scripts/debug-telegram-shape.js <userId>");
  process.exit(1);
}

const uri = String(process.env.DB_CONNECTION || process.env.MONGODB_URI || "").trim();
if (!uri) {
  console.error("Missing DB_CONNECTION or MONGODB_URI");
  process.exit(1);
}

await mongoose.connect(uri);
const user = await UserModel.findById(userId).select("memory").lean();
if (!user) {
  console.error("User not found");
  await mongoose.disconnect();
  process.exit(1);
}

const moa = user?.memory?.MOA;
const telegram = moa?.telegram;
const groups = telegram?.groups;

console.log("MOA type:", Array.isArray(moa) ? "array" : typeof moa);
console.log("telegram keys:", telegram && typeof telegram === "object" ? Object.keys(telegram) : null);
console.log("groups type:", Array.isArray(groups) ? "array" : typeof groups);
console.log("groups length:", Array.isArray(groups) ? groups.length : null);

const g0 = Array.isArray(groups) ? groups[0] : groups;
console.log("group0 keys:", g0 && typeof g0 === "object" ? Object.keys(g0) : null);
console.log("group0.content type:", Array.isArray(g0?.content) ? "array" : typeof g0?.content);
console.log("group0.content keys:", g0?.content && typeof g0.content === "object" ? Object.keys(g0.content) : null);

const sample = {
  texts: g0?.texts?.length,
  photos: g0?.photos?.length,
  images: g0?.images?.length,
  videos: g0?.videos?.length,
  audios: g0?.audios?.length,
  documents: g0?.documents?.length,
  messages: g0?.messages?.length,
  content_texts: g0?.content?.texts?.length,
  content_photos: g0?.content?.photos?.length,
  content_images: g0?.content?.images?.length,
  content_videos: g0?.content?.videos?.length,
  content_audios: g0?.content?.audios?.length,
  content_documents: g0?.content?.documents?.length,
  content_messages: g0?.content?.messages?.length,
};
console.log("lengths:", sample);

await mongoose.disconnect();
