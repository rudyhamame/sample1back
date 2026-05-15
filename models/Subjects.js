import mongoose from "mongoose";
import ConnectionsSchema from "./MOA/Connections.js";
import { MemorySchema } from "./Memory.js";
import SettingsSchema from "./Settings.js";

const { Schema } = mongoose;
const TRACE_KEYS = ["user", "telegram", "ai", "chat"];

const normalizeMoaOnSubject = (value) => {
  if (!Array.isArray(value)) {
    return value && typeof value === "object" ? value : {};
  }
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
};

const ClinicalRealitySchema = new Schema(
  {
    html: { type: String, default: "" },
    updatedAt: { type: Date, default: null },
  },
  { _id: false },
);

// Profile Sub-Schema
const ProfileSchema = new Schema(
  {
    firstname: { type: String, default: "" },
    lastname: { type: String, default: "" },
    email: { type: String, default: "" },
    phone: { type: String, default: "" },
    dob: { type: Date, default: null },
    hometown: {
      Country: { type: String, default: "" },
      City: { type: String, default: "" },
    },
    studying: {
      university: { type: String, default: "" },
      program: { type: String, default: "" },
      faculty: { type: String, default: "" },
      time: {
        totalYearsNum: { type: Number, default: 0, min: 0 },
        start: {
          programYearInterval: { type: String, default: null },
          programTerm: {
            type: String,
            enum: ["First", "Second", "Third"],
            default: null,
          },
        },
        current: {
          programYearNum: { type: Number, default: null, min: 0 },
          programYearInterval: { type: String, default: null },
          programTerm: {
            type: String,
            enum: ["First", "Second", "Third"],
            default: null,
          },
        },
      },
      language: { type: String, default: "" },
    },
    working: {
      company: { type: String, default: "" },
      position: { type: String, default: "" },
    },
    bio: { type: String, default: "" },
    picture: {
      profilePic: {
        index: {
          url: { type: String, default: "" },
          publicId: { type: String, default: "" },
          mimeType: { type: String, default: "" },
          width: { type: Number, default: null },
          height: { type: Number, default: null },
        },
        viewport: {
          x: { type: Number, default: 0 },
          y: { type: Number, default: 0 },
          zoom: { type: Number, default: 1 },
          width: { type: Number, default: null },
          height: { type: Number, default: null },
        },
        wallpaper: {
          index: {
            url: { type: String, default: "" },
            publicId: { type: String, default: "" },
            mimeType: { type: String, default: "" },
            width: { type: Number, default: null },
            height: { type: Number, default: null },
          },
          viewport: {
            x: { type: Number, default: 0 },
            y: { type: Number, default: 0 },
            zoom: { type: Number, default: 1 },
            width: { type: Number, default: null },
            height: { type: Number, default: null },
          },
        },
      },
    },
  },
  { _id: false },
); // _id: false prevents creating sub-document IDs

const SubjectsSchema = new Schema(
  {
    auth: {
      username: { type: String, default: "" },
      password: { type: String, default: "" },
    },
    profile: { type: ProfileSchema, default: () => ({}) },
    connections: { type: [ConnectionsSchema], default: [] },
    memory: MemorySchema,
    clinicalReality: { type: ClinicalRealitySchema, default: () => ({}) },
    settings: { type: SettingsSchema, default: () => ({}) },
    status: {
      value: {
        type: String,
        enum: ["online", "offline"],
        default: "online",
      },
      updatedAt: { type: Date, default: Date.now },
    },
  },
  { strict: "throw" },
);

SubjectsSchema.pre("validate", function () {
  if (!this.memory || typeof this.memory !== "object") {
    return;
  }
  this.memory.MOA = normalizeMoaOnSubject(this.memory.MOA);
});

const SubjectsModel =
  mongoose.models.subjects || mongoose.model("subjects", SubjectsSchema);

export default SubjectsModel;
export { ProfileSchema };
