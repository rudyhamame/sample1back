import "dotenv/config";
import mongoose from "mongoose";

import UserModel from "../compat/UserModel.js";

const getDbConnectionString = () => String(process.env.DB_CONNECTION || "").trim();
const getDbName = () => String(process.env.DB_NAME || "phenomed").trim();

const toArray = (value) => (Array.isArray(value) ? value : []);
const INLINE_MEDIA_KEYS = ["photoDataUrl", "videoDataUrl", "documentDataUrl"];

const stripInlineMediaFromEntry = (entry = {}) => {
  if (!entry || typeof entry !== "object") {
    return { nextEntry: entry, removed: 0 };
  }

  const nextEntry = { ...entry };
  let removed = 0;

  INLINE_MEDIA_KEYS.forEach((key) => {
    if (String(nextEntry?.[key] || "").trim()) {
      removed += 1;
    }
    delete nextEntry[key];
  });

  return { nextEntry, removed };
};

const stripInlineMediaFromTelegramGroups = (groups = []) => {
  let removed = 0;

  const nextGroups = toArray(groups).map((groupEntry) => {
    const group = groupEntry && typeof groupEntry === "object" ? groupEntry : {};
    const nextMessages = toArray(group.messages).map((messageEntry) => {
      const source =
        messageEntry && typeof messageEntry === "object" ? messageEntry : {};
      const messageMeta =
        source.messageMeta && typeof source.messageMeta === "object"
          ? source.messageMeta
          : {};
      const messageTrace =
        source.messageTrace && typeof source.messageTrace === "object"
          ? source.messageTrace
          : {};

      const strippedMeta = stripInlineMediaFromEntry(messageMeta);
      removed += strippedMeta.removed;

      const nextTrace = { ...messageTrace };
      ["photos", "videos", "documents"].forEach((bucketKey) => {
        const bucket = toArray(messageTrace?.[bucketKey]);
        nextTrace[bucketKey] = bucket.map((entry) => {
          const stripped = stripInlineMediaFromEntry(entry);
          removed += stripped.removed;
          return stripped.nextEntry;
        });
      });

      return {
        ...source,
        messageMeta: strippedMeta.nextEntry,
        messageTrace: nextTrace,
      };
    });

    return {
      ...group,
      messages: nextMessages,
    };
  });

  return {
    nextGroups,
    removed,
  };
};

const main = async () => {
  const connectionString = getDbConnectionString();
  if (!connectionString) {
    throw new Error("Missing DB_CONNECTION in environment.");
  }

  await mongoose.connect(connectionString, { dbName: getDbName() });

  const cursor = UserModel.collection.find(
    { "memory.MOA.telegram.groups.0": { $exists: true } },
    { projection: { memory: 1 } },
  );

  let scanned = 0;
  let updated = 0;
  let removed = 0;

  for await (const user of cursor) {
    scanned += 1;
    const currentGroups = toArray(user?.memory?.MOA?.telegram?.groups);
    const cleaned = stripInlineMediaFromTelegramGroups(currentGroups);

    if (cleaned.removed <= 0) {
      continue;
    }

    await UserModel.collection.updateOne(
      { _id: user._id },
      {
        $set: {
          "memory.MOA.telegram.groups": cleaned.nextGroups,
        },
      },
    );

    updated += 1;
    removed += cleaned.removed;
  }

  console.log("[cleanup-telegram-inline-media] done", {
    scanned,
    updated,
    removed,
  });

  await mongoose.disconnect();
};

main().catch((error) => {
  console.error(error?.message || error);
  process.exit(1);
});
