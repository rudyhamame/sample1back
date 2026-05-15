import mongoose from "mongoose";
import dotenv from "dotenv";
import UserModel from "../compat/UserModel.js";

dotenv.config();
const uri = String(process.env.DB_CONNECTION || process.env.MONGODB_URI || "").trim();
if (!uri) { console.error("Missing DB URI"); process.exit(1); }
await mongoose.connect(uri);

const users = await UserModel.find({}).select("username email memory").lean();
const rows = [];
for (const u of users) {
  const m = u?.memory || {};
  const tgA = m?.MOA?.telegram;
  const groups = Array.isArray(tgA?.groups) ? tgA.groups : [];
  let count = 0;
  for (const g of groups) {
    const c = g?.content && typeof g.content === 'object' ? g.content : {};
    count += (Array.isArray(c.texts)?c.texts.length:0)
      + (Array.isArray(c.photos)?c.photos.length:0)
      + (Array.isArray(c.images)?c.images.length:0)
      + (Array.isArray(c.videos)?c.videos.length:0)
      + (Array.isArray(c.audios)?c.audios.length:0)
      + (Array.isArray(c.documents)?c.documents.length:0)
      + (Array.isArray(c.messages)?c.messages.length:0);
  }
  const legacyMoaArr = Array.isArray(m?.MOA) ? m.MOA : [];
  let legacyCount = 0;
  for (const e of legacyMoaArr) {
    const tg = e?.telegram;
    const lg = Array.isArray(tg?.groups) ? tg.groups : [];
    for (const g of lg) {
      const c = g?.content && typeof g.content === 'object' ? g.content : {};
      legacyCount += (Array.isArray(c.texts)?c.texts.length:0)
      + (Array.isArray(c.photos)?c.photos.length:0)
      + (Array.isArray(c.images)?c.images.length:0)
      + (Array.isArray(c.videos)?c.videos.length:0)
      + (Array.isArray(c.audios)?c.audios.length:0)
      + (Array.isArray(c.documents)?c.documents.length:0)
      + (Array.isArray(c.messages)?c.messages.length:0);
    }
  }
  if (count > 0 || legacyCount > 0) {
    rows.push({ id: String(u._id), username: u.username, email: u.email, count, legacyCount });
  }
}
console.log(JSON.stringify(rows, null, 2));
await mongoose.disconnect();
