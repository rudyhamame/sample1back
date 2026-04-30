import mongoose from "mongoose";
import TraceSchema from "./Trace.js";
import StudyPlannerSchema from "./MOI/StudyPlanner/StudyPlanner.js";

const { Schema } = mongoose;

const TelegramGroupInfoSchema = new Schema(
  {
    name: { type: String, default: "" },
    groupReference: { type: String, default: "" },
    memberCount: { type: Number, default: 0 },
    description: { type: String, default: "" },
    messageCount: { type: Number, default: 0 },
    pageUrl: { type: String, default: "" },
  },
  { _id: false, strict: "throw" },
);

const TelegramGroupContentBucketSchema = new Schema(
  {
    texts: { type: [Schema.Types.Mixed], default: [] },
    photos: { type: [Schema.Types.Mixed], default: [] },
    videos: { type: [Schema.Types.Mixed], default: [] },
    audios: { type: [Schema.Types.Mixed], default: [] },
    documents: { type: [Schema.Types.Mixed], default: [] },
  },
  { _id: false, strict: "throw" },
);

const TelegramGroupsSchema = new Schema(
  {
    info: { type: TelegramGroupInfoSchema, default: () => ({}) },
    content: { type: [TelegramGroupContentBucketSchema], default: [] },
  },
  { _id: false, strict: "throw" },
);

const TelegramMemorySchema = new Schema(
  {
    groups: { type: TelegramGroupsSchema, default: () => ({}) },
  },
  { _id: false, strict: "throw" },
);

const normalizeTracesArray = (value) => {
  if (Array.isArray(value)) {
    return value.filter((entry) => entry && typeof entry === "object");
  }

  if (value && typeof value === "object") {
    const hasMeaningfulTraceKey = ["user", "telegram", "ai", "chat"].some(
      (key) => Boolean(value?.[key]),
    );
    return hasMeaningfulTraceKey ? [value] : [];
  }

  return [];
};

const MemorySchema = new Schema(
  {
    //layers of meaning processing and storage for the subject, including:
    // - raw traces of data received through MOA channels
    // - processed and enriched memories derived from those traces
    // - connections to other subjects, with associated metadata and context
    traces: { type: [TraceSchema], default: [] },
    studyPlanner: { type: StudyPlannerSchema, default: () => ({}) },
    telegram: { type: TelegramMemorySchema, default: () => ({}) },
  },
  { strict: "throw" },
);

MemorySchema.pre("validate", function () {
  this.traces = normalizeTracesArray(this.traces);
});

// Sub-schema only. Memory is embedded inside `subjects.memory`, not a standalone collection.
export { MemorySchema };
