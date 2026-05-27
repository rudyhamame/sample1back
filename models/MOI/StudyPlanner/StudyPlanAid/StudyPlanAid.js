import mongoose from "mongoose";
import { StudyLecturePlanAidSchema } from "../StudyOrganizer/SharedSchemas.js";

const { Schema } = mongoose;

const StudyPlanAidLectureOverrideSchema = new Schema(
  {
    lectureId: { type: Schema.Types.ObjectId, default: null },
    ...StudyLecturePlanAidSchema.obj,
  },
  { _id: true },
);

const StudyPlanAidDayPlanSchema = new Schema(
  {
    periodType: { type: String, trim: true, default: "" },
    groupKey: { type: String, trim: true, default: "" },
    label: { type: String, trim: true, default: "" },
    dayNumber: { type: Number, default: 0, min: 0 },
    dailyHoursCap: { type: Number, default: 0, min: 0 },
    lectureIds: {
      type: [Schema.Types.ObjectId],
      default: [],
    },
  },
  { _id: true },
);

const StudyPlanAidComponentPlanSchema = new Schema(
  {
    componentId: { type: Schema.Types.ObjectId, default: null },
    targetHours: { type: Number, default: 0, min: 0 },
    difficulty: { type: String, trim: true, default: "" },
    mastery: { type: String, trim: true, default: "" },
    priority: { type: String, trim: true, default: "" },
    dailyHoursCap: { type: Number, default: 0, min: 0 },
    note: { type: String, trim: true, default: "" },
    lectureOverrides: {
      type: [StudyPlanAidLectureOverrideSchema],
      default: [],
    },
  },
  { _id: true },
);

const StudyPlanAidCoursePlanSchema = new Schema(
  {
    courseId: { type: Schema.Types.ObjectId, default: null },
    note: { type: String, trim: true, default: "" },
    componentPlans: { type: [StudyPlanAidComponentPlanSchema], default: [] },
  },
  { _id: true },
);

const StudyPlanAidDefaultsSchema = new Schema(
  {
    defaultDailyHours: { type: Number, default: 0, min: 0 },
    defaultDifficulty: { type: String, trim: true, default: "" },
    defaultMastery: { type: String, trim: true, default: "" },
    defaultPriority: { type: String, trim: true, default: "" },
  },
  { _id: false },
);

const StudyPlanAidSchema = new Schema(
  {
    enabled: { type: Boolean, default: false },
    viewMode: { type: String, trim: true, default: "timeline" },
    timelineUnit: { type: String, trim: true, default: "day" },
    defaults: { type: StudyPlanAidDefaultsSchema },
    coursePlans: { type: [StudyPlanAidCoursePlanSchema], default: [] },
    dayPlans: { type: [StudyPlanAidDayPlanSchema], default: [] },
    note: { type: String, trim: true, default: "" },
  },
  { _id: true },
);

export {
  StudyPlanAidLectureOverrideSchema,
  StudyPlanAidDayPlanSchema,
  StudyPlanAidComponentPlanSchema,
  StudyPlanAidCoursePlanSchema,
  StudyPlanAidDefaultsSchema,
  StudyPlanAidSchema,
};
export default StudyPlanAidSchema;
