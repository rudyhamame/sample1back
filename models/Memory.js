import mongoose from "mongoose";
import MOASchema from "./MOA.js";
import MOISchema from "./MOI/MOI.js";

const { Schema } = mongoose;

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
    MOA: { type: [MOASchema], default: [] },
    MOI: { type: [MOISchema], default: [] },
  },
  { strict: "throw" },
);

MemorySchema.pre("validate", function () {
  this.MOA = normalizeTracesArray(this.MOA);
  this.MOI = Array.isArray(this.MOI)
    ? this.MOI.filter((entry) => entry && typeof entry === "object")
    : [];
});

// Sub-schema only. Memory is embedded inside `subjects.memory`, not a standalone collection.
export { MemorySchema };
