import "dotenv/config";
import mongoose from "mongoose";

const getDbConnectionString = () =>
  String(process.env.DB_CONNECTION || process.env.MONGODB_URI || "").trim();
const getDbName = () => String(process.env.DB_NAME || "phenomed").trim();

const parseArgs = (argv) => {
  const args = {
    list: false,
    yes: false,
    collections: [],
  };

  for (let index = 0; index < argv.length; index += 1) {
    const token = String(argv[index] || "").trim();

    if (!token) continue;

    if (token === "--list") {
      args.list = true;
      continue;
    }

    if (token === "--yes") {
      args.yes = true;
      continue;
    }

    if (token === "--collections" || token === "--drop") {
      const nextValue = String(argv[index + 1] || "").trim();
      index += 1;
      if (!nextValue) continue;

      const parts = nextValue
        .split(",")
        .map((value) => value.trim())
        .filter(Boolean);
      args.collections.push(...parts);
      continue;
    }
  }

  args.collections = Array.from(new Set(args.collections));

  return args;
};

const main = async () => {
  const args = parseArgs(process.argv.slice(2));
  const connectionString = getDbConnectionString();

  if (!connectionString) {
    throw new Error(
      "Missing DB_CONNECTION (or MONGODB_URI) in environment variables.",
    );
  }

  await mongoose.connect(connectionString, { dbName: getDbName() });

  try {
    const db = mongoose.connection.db;
    const existingCollections = await db
      .listCollections({}, { nameOnly: true })
      .toArray();
    const existingNames = existingCollections
      .map((entry) => String(entry?.name || "").trim())
      .filter(Boolean)
      .sort((a, b) => a.localeCompare(b));

    if (args.list || args.collections.length === 0) {
      console.log(
        JSON.stringify(
          {
            dbName: getDbName(),
            collections: existingNames,
          },
          null,
          2,
        ),
      );
      return;
    }

    if (!args.yes) {
      console.error(
        [
          "Refusing to drop collections without explicit confirmation.",
          `Requested: ${args.collections.join(", ")}`,
          "Re-run with --yes to actually drop them.",
        ].join("\n"),
      );
      process.exitCode = 2;
      return;
    }

    const results = [];
    for (const name of args.collections) {
      const exists = existingNames.includes(name);
      if (!exists) {
        results.push({ name, dropped: false, reason: "not_found" });
        continue;
      }

      try {
        await db.dropCollection(name);
        results.push({ name, dropped: true });
      } catch (error) {
        // Mongo returns "ns not found" when the collection disappeared between list & drop.
        if (
          error?.codeName === "NamespaceNotFound" ||
          String(error?.message || "").toLowerCase().includes("ns not found")
        ) {
          results.push({ name, dropped: false, reason: "not_found" });
          continue;
        }

        results.push({
          name,
          dropped: false,
          reason: "error",
          message: String(error?.message || error),
        });
      }
    }

    console.log(
      JSON.stringify(
        {
          dbName: getDbName(),
          requested: args.collections,
          results,
        },
        null,
        2,
      ),
    );
  } finally {
    await mongoose.disconnect();
  }
};

main().catch((error) => {
  console.error(String(error?.stack || error?.message || error));
  process.exitCode = 1;
});

