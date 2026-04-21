import mongoose from "mongoose";

const { Schema } = mongoose;

const createEmptyObject = () => ({});

const PAGE_TEXT_KIND_VALUES = ["text-already", "text-converted"];
const NON_TEXT_KIND_VALUES = [
  "image",
  "diagram",
  "table",
  "formula",
  "chart",
  "handwriting",
  "scan",
  "unknown",
];
const EXTRACTED_TEXT_STATUS_VALUES = ["none", "pending", "converted"];
const STUDY_TIMING_VALUES = ["now", "soon", "later", "review"];
const STUDY_INTENSITY_VALUES = ["low", "medium", "high"];

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

const StudyTimeSchema = new Schema(
  {
    academicYear: { type: String, default: null },
    term: { type: String, enum: ["First", "Second", "Third"], default: null },
  },
  { _id: false },
);

const StudyVolumeSchema = new Schema(
  {
    value: { type: Number, default: 0, min: 0 },
    unit: { type: String, default: "pages" },
    scope: { type: String, default: "" },
    note: { type: String, default: "" },
  },
  { _id: false },
);

const StudyWeightSchema = new Schema(
  {
    value: { type: Number, default: 0, min: 0 },
    unit: { type: String, default: "percent" },
  },
  { _id: false },
);

const StudyGradeSchema = new Schema(
  {
    value: { type: Number, default: null },
    min: { type: Number, default: null },
    max: { type: Number, default: null },
    unit: { type: String, default: "points" },
  },
  { _id: false },
);

const StudyRecommendationSchema = new Schema(
  {
    timing: {
      type: String,
      enum: STUDY_TIMING_VALUES,
      default: "later",
    },
    intensity: {
      type: String,
      enum: STUDY_INTENSITY_VALUES,
      default: "medium",
    },
    suggestedHours: { type: Number, default: 0, min: 0 },
    reason: { type: String, default: "" },
    note: { type: String, default: "" },
  },
  { _id: false },
);

const PageTextDataSchema = new Schema(
  {
    kind: {
      type: String,
      enum: PAGE_TEXT_KIND_VALUES,
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
      enum: NON_TEXT_KIND_VALUES,
      default: "unknown",
    },
    source: { type: String, default: "" },
    mimeType: { type: String, default: "" },
    description: { type: String, default: "" },
    extractedTextStatus: {
      type: String,
      enum: EXTRACTED_TEXT_STATUS_VALUES,
      default: "none",
    },
    data: { type: Schema.Types.Mixed, default: null },
  },
  { _id: true },
);

const StudyPageSchema = new Schema(
  {
    order: { type: Number, default: 0, min: 0 },
    textData: { type: [PageTextDataSchema], default: [] },
    nonTextData: { type: [PageNonTextDataSchema], default: [] },
    studyRecommendation: {
      type: StudyRecommendationSchema,
      default: createEmptyObject,
    },
  },
  { _id: true },
);

const StudyLectureSchema = new Schema(
  {
    title: { type: String, default: "" },
    instructors: { type: [String], default: [] },
    writer: { type: [String], default: [] },
    publishDate: { type: Date, default: null },
    pages: { type: [StudyPageSchema], default: [] },
  },
  { _id: true },
);

const ComponentSchema = new Schema(
  {
    class: { type: String, default: "" },
    time: { type: StudyTimeSchema, default: createEmptyObject },
    location: { type: StudyLocationSchema, default: createEmptyObject },
    schedule: { type: [WeeklyScheduleEntrySchema], default: [] },
    weight: { type: StudyWeightSchema, default: createEmptyObject },
    lectures: { type: [StudyLectureSchema], default: [] },
  },
  { _id: true },
);

const CourseSchema = new Schema(
  {
    code: { type: String, default: "" },
    name: { type: String, default: "" },
    components: { type: [ComponentSchema], default: [] },
  },
  { _id: true },
);

const ComponentLecturePageSchema = StudyPageSchema;
const ComponentLectureSchema = StudyLectureSchema;

export {
  PAGE_TEXT_KIND_VALUES,
  NON_TEXT_KIND_VALUES,
  EXTRACTED_TEXT_STATUS_VALUES,
  STUDY_TIMING_VALUES,
  STUDY_INTENSITY_VALUES,
  WeeklyScheduleEntrySchema,
  StudyTimeSchema,
  StudyLocationSchema,
  StudyVolumeSchema,
  StudyWeightSchema,
  StudyGradeSchema,
  StudyRecommendationSchema,
  PageTextDataSchema,
  PageNonTextDataSchema,
  StudyPageSchema,
  StudyLectureSchema,
  ComponentSchema,
  CourseSchema,
  ComponentLecturePageSchema,
  ComponentLectureSchema,
};

export default ComponentSchema;
