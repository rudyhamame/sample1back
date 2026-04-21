import "dotenv/config";
import mongoose from "mongoose";

import StudyPlannerModel from "../models/MOI/Study.js";
import PlannerPlanEntryModel from "../models/MOI/PlannerPlanEntry.js";

const getDbConnectionString = () => String(process.env.DB_CONNECTION || "").trim();
const getDbName = () => String(process.env.DB_NAME || "phenomed").trim();

const isPlainObject = (value) =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);

const main = async () => {
  const connectionString = getDbConnectionString();
  if (!connectionString) {
    throw new Error("Missing DB_CONNECTION in environment.");
  }

  await mongoose.connect(connectionString, { dbName: getDbName() });

  const cursor = StudyPlannerModel.collection.find(
    { plan: { $exists: true, $type: "array", $ne: [] } },
    { projection: { plan: 1 } },
  );

  let scanned = 0;
  let migrated = 0;
  let skipped = 0;
  let errors = 0;

  for await (const doc of cursor) {
    scanned += 1;
    const plannerId = doc?._id;
    const plan = Array.isArray(doc?.plan) ? doc.plan : [];

    // Already migrated if the plan holds ObjectIds.
    const hasObjects = plan.some((entry) => isPlainObject(entry));
    if (!hasObjects) {
      skipped += 1;
      continue;
    }

    try {
      const createdIds = [];

      for (const entry of plan) {
        if (!isPlainObject(entry)) {
          continue;
        }

        const subjectId =
          entry?.subject || entry?.user || entry?.owner || entry?.subjectId || null;

        if (!subjectId) {
          // Can't backfill ownership if it wasn't stored.
          continue;
        }

        const created = await PlannerPlanEntryModel.create({
          subject: subjectId,
          planner: plannerId,
          date: entry?.date || null,
          term: String(entry?.term || ""),
          tasks: Array.isArray(entry?.tasks) ? entry.tasks : [],
        });
        createdIds.push(created._id);
      }

      await StudyPlannerModel.collection.updateOne(
        { _id: plannerId },
        { $set: { plan: createdIds } },
      );

      migrated += 1;
    } catch (error) {
      errors += 1;
      console.error("[migrate-plan] error", {
        plannerId: String(plannerId || ""),
        message: error?.message || String(error),
      });
    }
  }

  console.log("[migrate-plan] done", { scanned, migrated, skipped, errors });
  await mongoose.disconnect();
  if (errors > 0) {
    process.exit(1);
  }
};

main().catch((error) => {
  console.error(error?.message || error);
  process.exit(1);
});

