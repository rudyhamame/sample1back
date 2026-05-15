import mongoose from "mongoose";
import dotenv from "dotenv";

dotenv.config();
const userId = process.argv[2];
const uri = String(process.env.DB_CONNECTION || process.env.MONGODB_URI || "").trim();
if (!uri || !userId) { console.error("Usage: node script <userId>"); process.exit(1); }
await mongoose.connect(uri);
const db = mongoose.connection.db;
const cols = await db.listCollections().toArray();
const out = [];
for (const c of cols) {
  const coll = db.collection(c.name);
  const d = await coll.findOne({ _id: new mongoose.Types.ObjectId(userId) });
  if (d) {
    out.push({
      collection: c.name,
      keys: Object.keys(d),
      hasMemory: !!d.memory,
      hasTelegramTop: !!d.telegram,
      hasSettingsTelegram: !!(d.settings && d.settings.telegram)
    });
  }
}
console.log(JSON.stringify(out, null, 2));
await mongoose.disconnect();
