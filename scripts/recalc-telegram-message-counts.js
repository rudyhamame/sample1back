import mongoose from "mongoose";
import "dotenv/config";
import UserModel from "../compat/UserModel.js";

const uri = String(process.env.DB_CONNECTION || process.env.MONGODB_URI || "").trim();
if (!uri) {
  console.error("Missing DB_CONNECTION or MONGODB_URI");
  process.exit(1);
}

const toArray = (v) => (Array.isArray(v) ? v : []);

await mongoose.connect(uri);
const users = await UserModel.find({ "memory.MOA.telegram.groups.0": { $exists: true } }).select("memory");
let touchedUsers = 0;
let touchedGroups = 0;

for (const user of users) {
  const groups = Array.isArray(user?.memory?.MOA?.telegram?.groups)
    ? user.memory.MOA.telegram.groups
    : [];
  let changed = false;

  groups.forEach((group) => {
    const content = group?.content && typeof group.content === "object" ? group.content : {};
    const nextCount =
      toArray(content.texts).length +
      toArray(content.photos).length +
      toArray(content.images).length +
      toArray(content.videos).length +
      toArray(content.audios).length +
      toArray(content.documents).length +
      toArray(content.messages).length;

    if (!group.info || typeof group.info !== "object") {
      group.info = {};
      changed = true;
    }

    const prevCount = Number(group.info.messageCount || 0);
    if (prevCount !== nextCount) {
      group.info.messageCount = nextCount;
      changed = true;
      touchedGroups += 1;
    }
  });

  if (changed) {
    touchedUsers += 1;
    await user.save();
  }
}

console.log(JSON.stringify({ usersScanned: users.length, usersUpdated: touchedUsers, groupsUpdated: touchedGroups }, null, 2));
await mongoose.disconnect();
