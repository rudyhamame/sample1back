import mongoose from "mongoose";
import {
  CourseSchema,
  StudyRecommendationSchema,
  StudyTimeSchema,
} from "./Components.js";
import { ExamSchema } from "./Exam.js";

const { Schema } = mongoose;

const createEmptyObject = () => ({});

const PLAN_ENTRY_STATUS_VALUES = ["draft", "active", "completed", "archived"];

const StudyPlanEntrySchema = new Schema(
  {
    title: { type: String, default: "" },
    targetPath: { type: String, default: "" },
    examTitle: { type: String, default: "" },
    deadline: { type: StudyTimeSchema, default: createEmptyObject },
    recommendation: {
      type: StudyRecommendationSchema,
      default: createEmptyObject,
    },
    status: {
      type: String,
      enum: PLAN_ENTRY_STATUS_VALUES,
      default: "draft",
    },
    note: { type: String, default: "" },
  },
  { _id: true },
);

const StudyOrganizerPlanSchema = new Schema(
  {
    dailyStudyHoursTarget: { type: Number, default: 0, min: 0 },
    objectives: {
      type: [String],
      default: () => [
        "Prioritize studying according to exam deadlines.",
        "Suggest which pages should be studied more, less, now, or later.",
        "Estimate how many hours should be studied daily to pass exams.",
      ],
    },
    entries: { type: [StudyPlanEntrySchema], default: [] },
    note: { type: String, default: "" },
  },
  { _id: false },
);

const StudyOrganizerSchema = new Schema(
  {
    courses: { type: [CourseSchema], default: [] },
    exams: { type: [ExamSchema], default: [] },
  },
  { _id: true },
);

export {
  PLAN_ENTRY_STATUS_VALUES,
  StudyPlanEntrySchema,
  StudyOrganizerPlanSchema,
  StudyOrganizerSchema,
};

export default StudyOrganizerSchema;
