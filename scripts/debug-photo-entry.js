import mongoose from "mongoose";
import "dotenv/config";
import UserModel from "../compat/UserModel.js";

const userId = process.argv[2];
const uri = String(process.env.DB_CONNECTION || process.env.MONGODB_URI || "").trim();
if (!uri || !userId) { console.error("Usage: node scripts/debug-photo-entry.js <userId>"); process.exit(1); }
await mongoose.connect(uri);
const user = await UserModel.findById(userId).select("memory").lean();
const groups = Array.isArray(user?.memory?.MOA?.telegram?.groups) ? user.memory.MOA.telegram.groups : [];
const out = [];
for (const [gi,g] of groups.entries()) {
  const c = g?.content && typeof g.content === 'object' ? g.content : {};
  const photos = Array.isArray(c.photos) ? c.photos : [];
  if (photos.length>0) {
    const m = photos[0];
    out.push({
      groupIndex: gi,
      groupInfo: g?.info,
      firstPhoto: {
        id: m?.id,
        groupReference: m?.groupReference,
        groupUsername: m?.groupUsername,
        groupTitle: m?.groupTitle,
        attachmentKind: m?.attachmentKind,
        attachmentMimeType: m?.attachmentMimeType,
        attachmentFileName: m?.attachmentFileName,
        telegramFileId: m?.telegramFileId,
        telegramAccessHash: m?.telegramAccessHash,
        text: String(m?.text||"").slice(0,80)
      },
      photosCount: photos.length
    });
  }
}
console.log(JSON.stringify(out, null, 2));
await mongoose.disconnect();
