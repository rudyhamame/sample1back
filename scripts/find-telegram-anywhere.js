import mongoose from "mongoose";
import dotenv from "dotenv";

dotenv.config();
const uri = String(process.env.DB_CONNECTION || process.env.MONGODB_URI || "").trim();
if (!uri) { console.error("Missing DB URI"); process.exit(1); }

await mongoose.connect(uri);
const db = mongoose.connection.db;
const collections = await db.listCollections().toArray();

const hits = [];
for (const c of collections) {
  const name = c.name;
  const coll = db.collection(name);
  const sample = await coll.findOne({
    $or: [
      { "memory.MOA.telegram": { $exists: true } },
      { "telegram.groups": { $exists: true } },
      { "settings.telegram": { $exists: true } },
      { "messages": { $exists: true } },
      { "content.texts.0": { $exists: true } },
      { "content.photos.0": { $exists: true } },
      { "content.videos.0": { $exists: true } },
      { "content.documents.0": { $exists: true } }
    ]
  });
  if (sample) {
    hits.push({ collection: name, sampleId: String(sample._id) });
  }
}

const detailed = [];
for (const hit of hits) {
  const coll = db.collection(hit.collection);
  const docs = await coll.find({
    $or: [
      { "memory.MOA.telegram.groups.0.content.texts.0": { $exists: true } },
      { "memory.MOA.telegram.groups.0.content.photos.0": { $exists: true } },
      { "memory.MOA.telegram.groups.0.content.images.0": { $exists: true } },
      { "memory.MOA.telegram.groups.0.content.videos.0": { $exists: true } },
      { "memory.MOA.telegram.groups.0.content.audios.0": { $exists: true } },
      { "memory.MOA.telegram.groups.0.content.documents.0": { $exists: true } },
      { "memory.MOA.telegram.groups.0.content.messages.0": { $exists: true } },
      { "telegram.groups.0.content.texts.0": { $exists: true } },
      { "telegram.groups.0.content.photos.0": { $exists: true } },
      { "telegram.groups.0.content.images.0": { $exists: true } },
      { "telegram.groups.0.content.videos.0": { $exists: true } },
      { "telegram.groups.0.content.audios.0": { $exists: true } },
      { "telegram.groups.0.content.documents.0": { $exists: true } },
      { "telegram.groups.0.content.messages.0": { $exists: true } }
    ]
  }).project({ _id:1, username:1, email:1, memory:1, telegram:1 }).limit(3).toArray();

  if (docs.length > 0) {
    detailed.push({ collection: hit.collection, count: docs.length, ids: docs.map(d=>String(d._id)) });
  }
}

console.log(JSON.stringify({ collections: hits, withMessageBuckets: detailed }, null, 2));
await mongoose.disconnect();
