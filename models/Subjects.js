import mongoose from "mongoose";
import ConnectionsSchema from "./Connections.js";
import { MemorySchema } from "./Memory.js";
import SettingsSchema from "./Settings.js";

const { Schema } = mongoose;

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
        totalYears: { type: Number, default: 0, min: 0 },
        currentAcademicYear: { type: Number, default: null, min: 0 },
        startDate: {
          startYear: { type: Number, default: null },
          startTerm: {
            type: String,
            enum: ["First", "Second", "Third"],
            default: null,
          },
        },
        currentDate: {
          year: { type: Number, default: null },
          term: {
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
    profilePic: {
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
    memory: { type: MemorySchema, default: () => ({}) },
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

const SubjectsModel =
  mongoose.models.subjects || mongoose.model("subjects", SubjectsSchema);

export default SubjectsModel;
export { ProfileSchema };
