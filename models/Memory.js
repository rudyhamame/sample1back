import mongoose from "mongoose";
import MOASchema from "./MOA.js";
import MOISchema from "./MOI/MOI.js";

const { Schema } = mongoose;

const TRACE_KEYS = ["user", "telegram", "ai", "chat"];

const hasMeaningfulTracePayload = (trace = {}) =>
  TRACE_KEYS.some((key) => {
    const value = trace?.[key];
    if (value === null || value === undefined) {
      return false;
    }
    if (Array.isArray(value)) {
      return value.length > 0;
    }
    if (typeof value === "object") {
      return Object.keys(value).length > 0;
    }
    return Boolean(value);
  });

const normalizeMoaObject = (value) => {
  if (Array.isArray(value)) {
    const traces = value.filter((entry) => entry && typeof entry === "object");
    if (traces.length === 0) {
      return {};
    }
    return traces.reduce((accumulator, traceEntry) => {
      TRACE_KEYS.forEach((traceKey) => {
        const currentValue = traceEntry?.[traceKey];
        if (currentValue === null || currentValue === undefined) {
          return;
        }
        if (typeof currentValue === "object" && !Array.isArray(currentValue)) {
          const previousValue =
            accumulator?.[traceKey] && typeof accumulator[traceKey] === "object"
              ? accumulator[traceKey]
              : {};
          accumulator[traceKey] = {
            ...previousValue,
            ...currentValue,
          };
          return;
        }
        accumulator[traceKey] = currentValue;
      });
      return accumulator;
    }, {});
  }

  if (value && typeof value === "object") {
    return hasMeaningfulTracePayload(value) ? value : {};
  }

  return {};
};

const MemorySchema = new Schema(
  {
    //layers of meaning processing and storage for the subject, including:
    // - raw traces of data received through MOA channels
    // - processed and enriched memories derived from those traces
    // - connections to other subjects, with associated metadata and context
    MOA: { type: MOASchema, default: () => ({}) },
    MOI: { type: MOISchema, default: () => ({}) },
  },
  { strict: "throw" },
);

MemorySchema.pre("validate", function () {
  this.MOA = normalizeMoaObject(this.MOA);
  if (Array.isArray(this.MOI)) {
    const firstEntry = this.MOI.find((entry) => entry && typeof entry === "object");
    this.MOI = firstEntry || {};
  } else if (!this.MOI || typeof this.MOI !== "object") {
    this.MOI = {};
  }
});

// Sub-schema only. Memory is embedded inside `subjects.memory`, not a standalone collection.
export { MemorySchema };
