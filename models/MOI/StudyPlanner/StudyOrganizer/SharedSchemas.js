import mongoose from "mongoose";

const { Schema } = mongoose;

const createEmptyObject = () => ({});

const StudyLocationSchema = new Schema(
  {
    building: { type: String, default: "" },
    room: { type: String, default: "" },
  },
  { _id: false },
);

const WeeklyScheduleEntrySchema = new Schema(
  {
    day: { type: String, default: "" },
    time: { type: String, default: "" },
    holydays: { type: [Date], default: [] },
    location: { type: StudyLocationSchema, default: createEmptyObject },
  },
  { _id: false },
);

const ExamTimeSchema = new Schema(
  {
    examDate: { type: Date, default: null },
    startTime: { type: String, default: "" },
    endTime: { type: String, default: "" },
  },
  { _id: false },
);

const StudyTimeSchema = new Schema(
  {
    Normative: {
      courseYearNum: { type: Number, default: null, min: 0 },
      courseYearInterval: { type: String, default: null },
      courseTerm: {
        type: String,
        default: null,
      },
    },
    actual: {
      courseYearNum: { type: Number, default: null, min: 0 },
      courseYearInterval: { type: String, default: null },
      courseTerm: {
        type: String,
        default: null,
      },
    },
  },
  { _id: false },
);

const StudyVolumeSchema = new Schema(
  {
    total: { type: Number, default: 0, min: 0 },
    done: { type: Number, default: 0, min: 0 },
    remaining: { type: Number, default: 0, min: 0 },
  },
  { _id: false },
);

const StudyGradeSchema = new Schema(
  {
    value: { type: Number, default: null }, //actual grade value, e.g., 85
    passThreshold: { type: Number, default: null }, //grade required to pass, e.g., 60
    maxGrade: { type: Number, default: null }, //maximum possible grade, e.g., 100
    status: { type: String, default: "" }, //e.g., "passed", "failed", "pending"
  },
  { _id: false },
);

const PageTextDataSchema = new Schema(
  {
    kind: {
      type: String,
      default: "text-already",
    },
    text: { type: String, default: "" },
    normalizedText: { type: String, default: "" },
    source: { type: String, default: "page" },
    isConvertedFromNonText: { type: Boolean, default: false },
    converter: {
      name: { type: String, default: "" },
      version: { type: String, default: "" },
      note: { type: String, default: "" },
    },
  },
  { _id: true },
);

const PageNonTextDataSchema = new Schema(
  {
    kind: {
      type: String,
      default: "unknown",
    },
    source: { type: String, default: "" },
    mimeType: { type: String, default: "" },
    description: { type: String, default: "" },
    extractedTextStatus: {
      type: String,
      default: "none",
    },
    data: { type: Schema.Types.Mixed, default: null },
  },
  { _id: true },
);

const LectureContentSchema = new Schema(
  {
    order: { type: Number, default: 0, min: 0 },
    status: { type: String, default: "" },
    textData: { type: [PageTextDataSchema], default: [] },
    nonTextData: { type: [PageNonTextDataSchema], default: [] },
  },
  { _id: true },
);

const StudyLectureSchema = new Schema(
  {
    title: { type: String, default: "" },
    instructors: { type: [String], default: [] },
    writer: { type: [String], default: [] },
    publishDate: { type: Date, default: null },
    volume: { type: StudyVolumeSchema, default: () => ({}) },
    content: { type: [LectureContentSchema], default: [] },
  },
  { _id: true },
);

export {
  WeeklyScheduleEntrySchema,
  StudyTimeSchema,
  ExamTimeSchema,
  StudyLocationSchema,
  StudyVolumeSchema,
  StudyGradeSchema,
  PageTextDataSchema,
  PageNonTextDataSchema,
  LectureContentSchema,
  StudyLectureSchema,
};
