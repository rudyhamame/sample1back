import "dotenv/config";
import mongoose from "mongoose";
import SubjectsModel from "../models/Subjects.js";

const getDbConnectionString = () => String(process.env.DB_CONNECTION || "").trim();
const getDbName = () => String(process.env.DB_NAME || "phenomed").trim();

const stripId = (id) =>
  typeof id === "string" ? id.replace(/[-_]/g, "") : id;

const stripStringArray = (arr) =>
  Array.isArray(arr) ? arr.map((entry) => stripId(entry)) : arr;

const migrateStudyPlanner = (sp) => {
  if (!sp || typeof sp !== "object") return { data: sp, changed: false };

  let changed = false;
  const track = (oldVal, newVal) => {
    if (oldVal !== newVal) changed = true;
    return newVal;
  };

  // programCurrentIntervalSelection.subIntervalID
  const cis = sp.programCurrentIntervalSelection;
  if (cis && typeof cis === "object") {
    const next = stripId(cis.subIntervalID);
    if (next !== cis.subIntervalID) {
      cis.subIntervalID = next;
      changed = true;
    }
  }

  // programIntervals → intervalID, subIntervalID, subIntervalCourses refs
  if (Array.isArray(sp.programIntervals)) {
    sp.programIntervals.forEach((interval) => {
      const info = interval?.intervalInfo;
      if (info) {
        info.intervalID = track(info.intervalID, stripId(info.intervalID));
      }
      (Array.isArray(interval?.intervalSubIntervals)
        ? interval.intervalSubIntervals
        : []
      ).forEach((sub) => {
        const subInfo = sub?.subIntervalInfo;
        if (subInfo) {
          subInfo.subIntervalID = track(
            subInfo.subIntervalID,
            stripId(subInfo.subIntervalID),
          );
        }
        if (Array.isArray(sub?.subIntervalCourses)) {
          sub.subIntervalCourses = sub.subIntervalCourses.map((cid) =>
            track(cid, stripId(cid)),
          );
        }
      });
    });
  }

  // programCourses → courseID, componentID, componentLectures refs
  if (Array.isArray(sp.programCourses)) {
    sp.programCourses.forEach((course) => {
      const info = course?.courseInfo;
      if (info) {
        info.courseID = track(info.courseID, stripId(info.courseID));
      }
      (Array.isArray(course?.courseComponents)
        ? course.courseComponents
        : []
      ).forEach((comp) => {
        const compInfo = comp?.componentInfo;
        if (compInfo) {
          compInfo.componentID = track(
            compInfo.componentID,
            stripId(compInfo.componentID),
          );
        }
        if (Array.isArray(comp?.componentLectures)) {
          comp.componentLectures = comp.componentLectures.map((lid) =>
            track(lid, stripId(lid)),
          );
        }
      });
    });
  }

  // programLectures → lectureID, lectureDocuments refs
  if (Array.isArray(sp.programLectures)) {
    sp.programLectures.forEach((lecture) => {
      const info = lecture?.lectureInfo;
      if (info) {
        info.lectureID = track(info.lectureID, stripId(info.lectureID));
      }
      if (Array.isArray(lecture?.lectureDocuments)) {
        lecture.lectureDocuments = lecture.lectureDocuments.map((did) =>
          track(did, stripId(did)),
        );
      }
    });
  }

  // programDocuments → documentID
  if (Array.isArray(sp.programDocuments)) {
    sp.programDocuments.forEach((doc) => {
      const info = doc?.documentInfo;
      if (info) {
        info.documentID = track(info.documentID, stripId(info.documentID));
      }
    });
  }

  // programTasks → taskID, tasksLectures refs
  if (Array.isArray(sp.programTasks)) {
    sp.programTasks.forEach((task) => {
      const info = task?.taskInfo;
      if (info) {
        info.taskID = track(info.taskID, stripId(info.taskID));
      }
      if (Array.isArray(task?.tasksLectures)) {
        task.tasksLectures = task.tasksLectures.map((lid) =>
          track(lid, stripId(lid)),
        );
      }
    });
  }

  // programExams → componentID, examPartID, examlectureIDs refs
  if (Array.isArray(sp.programExams)) {
    sp.programExams.forEach((examGroup) => {
      if (examGroup?.componentID !== undefined) {
        examGroup.componentID = track(
          examGroup.componentID,
          stripId(examGroup.componentID),
        );
      }
      (Array.isArray(examGroup?.examParts) ? examGroup.examParts : []).forEach(
        (part) => {
          if (part?.examPartID !== undefined) {
            part.examPartID = track(part.examPartID, stripId(part.examPartID));
          }
          if (part?.componentID !== undefined) {
            part.componentID = track(
              part.componentID,
              stripId(part.componentID),
            );
          }
          if (Array.isArray(part?.examlectureIDs)) {
            part.examlectureIDs = part.examlectureIDs.map((lid) =>
              track(lid, stripId(lid)),
            );
          }
        },
      );
    });
  }

  return { data: sp, changed };
};

const main = async () => {
  const connectionString = getDbConnectionString();
  if (!connectionString) {
    throw new Error("Missing DB_CONNECTION in environment.");
  }

  await mongoose.connect(connectionString, { dbName: getDbName() });
  console.log("[migrate-strip-ids] connected to db");

  const cursor = SubjectsModel.collection.find(
    { "memory.MOI.studyPlanner": { $exists: true } },
    { projection: { "memory.MOI.studyPlanner": 1 } },
  );

  let scanned = 0;
  let updated = 0;
  let skipped = 0;
  let errors = 0;

  for await (const doc of cursor) {
    scanned += 1;
    const sp = doc?.memory?.MOI?.studyPlanner;
    if (!sp || typeof sp !== "object") {
      skipped += 1;
      continue;
    }

    const { changed } = migrateStudyPlanner(sp);
    if (!changed) {
      skipped += 1;
      continue;
    }

    try {
      await SubjectsModel.collection.updateOne(
        { _id: doc._id },
        { $set: { "memory.MOI.studyPlanner": sp } },
      );
      updated += 1;
      console.log("[migrate-strip-ids] updated", String(doc._id));
    } catch (err) {
      errors += 1;
      console.error("[migrate-strip-ids] error on", String(doc._id), err?.message || err);
    }
  }

  console.log("[migrate-strip-ids] done", { scanned, updated, skipped, errors });
  await mongoose.disconnect();
  if (errors > 0) process.exit(1);
};

main().catch((err) => {
  console.error(err?.message || err);
  process.exit(1);
});
