import "dotenv/config";
import mongoose from "mongoose";

import StudyPlannerModel from "../models/MOI/Study.js";
import PlannerPlanEntryModel from "../models/MOI/PlannerPlanEntry.js";

const getDbConnectionString = () => String(process.env.DB_CONNECTION || "").trim();
const getDbName = () => String(process.env.DB_NAME || "phenomed").trim();

const isPlainObject = (value) =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);

const resolveSubjectId = (doc) =>
  doc?.subject || doc?.user || doc?.ownerUserId || doc?.owner || doc?.subjectId || null;

const main = async () => {
  const connectionString = getDbConnectionString();
  if (!connectionString) {
    throw new Error("Missing DB_CONNECTION in environment.");
  }

  await mongoose.connect(connectionString, { dbName: getDbName() });

  const cursor = StudyPlannerModel.collection.find(
    { components: { $exists: true, $type: "array", $ne: [] } },
    { projection: { components: 1 } },
  );

  let scanned = 0;
  let updated = 0;
  let skipped = 0;
  let errors = 0;

  for await (const doc of cursor) {
    scanned += 1;
    const plannerId = doc?._id;
    const components = Array.isArray(doc?.components) ? doc.components : [];
    const subjectId = resolveSubjectId(doc);

    let changed = false;
    const nextComponents = components.map((component) => {
      if (!isPlainObject(component)) {
        return component;
      }

      changed = true;
      const existingPlan = Array.isArray(component?.plan) ? component.plan : [];
      return { ...component, plan: existingPlan };
    });

    if (!changed) {
      skipped += 1;
      continue;
    }

    try {
      if (!subjectId) {
        throw new Error("Missing subject id on studyplanner document.");
      }

      // Ensure each component has at least one plan entry.
      for (const component of nextComponents) {
        if (!isPlainObject(component)) {
          continue;
        }

        component.plan = Array.isArray(component.plan) ? component.plan : [];
        if (component.plan.length > 0) {
          continue;
        }

        const componentId =
          component?._id || component?.id || new mongoose.Types.ObjectId();
        component._id = componentId;

        const created = await PlannerPlanEntryModel.create({
          subject: subjectId,
          planner: plannerId,
          componentId,
          date: component?.date?.start || null,
          term: String(component?.term || ""),
          tasks: [],
        });

        component.plan.push(created._id);
      }

      await StudyPlannerModel.collection.updateOne(
        { _id: plannerId },
        { $set: { subject: subjectId, components: nextComponents } },
      );
      updated += 1;
    } catch (error) {
      errors += 1;
      console.error("[migrate-component-plan] error", {
        plannerId: String(plannerId || ""),
        message: error?.message || String(error),
      });
    }
  }

  console.log("[migrate-component-plan] done", {
    scanned,
    updated,
    skipped,
    errors,
  });

  await mongoose.disconnect();
  if (errors > 0) {
    process.exit(1);
  }
};

main().catch((error) => {
  console.error(error?.message || error);
  process.exit(1);
});
