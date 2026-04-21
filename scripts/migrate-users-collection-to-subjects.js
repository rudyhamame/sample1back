import "dotenv/config";
import mongoose from "mongoose";

const getDbConnectionString = () => String(process.env.DB_CONNECTION || "").trim();
const getDbName = () => String(process.env.DB_NAME || "phenomed").trim();

const main = async () => {
  const connectionString = getDbConnectionString();
  if (!connectionString) {
    throw new Error("Missing DB_CONNECTION in environment.");
  }

  await mongoose.connect(connectionString, { dbName: getDbName() });

  const db = mongoose.connection.db;
  const collections = await db
    .listCollections({}, { nameOnly: true })
    .toArray()
    .then((entries) => entries.map((entry) => String(entry?.name || "").trim()).filter(Boolean));

  const hasUsers = collections.includes("users");
  const hasSubjects = collections.includes("subjects");

  if (!hasUsers && hasSubjects) {
    console.log("[migrate-subjects] subjects collection already exists.");
    await mongoose.disconnect();
    return;
  }

  if (!hasUsers && !hasSubjects) {
    console.log("[migrate-subjects] no users/subjects collection found.");
    await mongoose.disconnect();
    return;
  }

  if (hasSubjects) {
    throw new Error(
      "Both `users` and `subjects` collections exist. Refusing to rename automatically.",
    );
  }

  await db.collection("users").rename("subjects");
  console.log("[migrate-subjects] renamed users -> subjects");

  await mongoose.disconnect();
};

main().catch((error) => {
  console.error(error?.message || error);
  process.exit(1);
});

