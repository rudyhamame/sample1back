import mongoose from "mongoose";
import {
  CourseSchema,
  StudyRecommendationSchema,
  StudyTimeSchema,
} from "./Components.js";
import { ExamSchema } from "./Exam.js";

const { Schema } = mongoose;

const createEmptyObject = () => ({});
const LEGACY_COMPONENT_STATUS_ALIASES = {
  new: "new",
  failed: "failed",
  passed: "passed",
  "not started": "new",
  "in progress": "new",
  completed: "passed",
};
const LEGACY_COURSE_STATUS_ALIASES = {
  new: "new",
  failed: "failed",
  incomplete: "incomplete",
  passed: "passed",
  "not started": "new",
  "in progress": "incomplete",
  completed: "passed",
};

const PLAN_ENTRY_STATUS_VALUES = ["draft", "active", "completed", "archived"];

const normalizeLegacyPlannerStatus = (value, aliases, fallback) => {
  const normalizedValue = String(value || "").trim().toLowerCase();
  return aliases[normalizedValue] || fallback;
};

const normalizeCourseComponentStatuses = (courses) =>
  (Array.isArray(courses) ? courses : []).map((course) => {
    if (!course || typeof course !== "object") {
      return course;
    }

    const normalizedComponents = (Array.isArray(course.components) ? course.components : []).map(
      (component) => {
        if (!component || typeof component !== "object") {
          return component;
        }

        component.status = normalizeLegacyPlannerStatus(
          component.status,
          LEGACY_COMPONENT_STATUS_ALIASES,
          "new",
        );
        return component;
      },
    );

    course.status = normalizeLegacyPlannerStatus(
      course.status,
      LEGACY_COURSE_STATUS_ALIASES,
      "new",
    );
    course.components = normalizedComponents;
    return course;
  });

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

StudyOrganizerSchema.pre("validate", function normalizeLegacyStatuses() {
  this.courses = normalizeCourseComponentStatuses(this.courses);
});

export {
  PLAN_ENTRY_STATUS_VALUES,
  StudyPlanEntrySchema,
  StudyOrganizerPlanSchema,
  StudyOrganizerSchema,
};

export default StudyOrganizerSchema;
