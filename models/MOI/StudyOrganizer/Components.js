import mongoose from "mongoose";
import {
  WeeklyScheduleEntrySchema,
  StudyTimeSchema,
  ExamTimeSchema,
  StudyLocationSchema,
  StudyVolumeSchema,
  StudyGradeSchema,
  PageTextDataSchema,
  PageNonTextDataSchema,
  StudyPageSchema,
  StudyLectureSchema,
} from "./SharedSchemas.js";

const { Schema } = mongoose;

const createEmptyObject = () => ({});

const ExamSchema = new Schema(
  {
    type: { type: String, default: "" },
    time: { type: ExamTimeSchema, default: createEmptyObject },
    location: { type: StudyLocationSchema, default: createEmptyObject },
    lectures: { type: [Schema.Types.ObjectId], default: [] },
    grade: { type: StudyGradeSchema, default: createEmptyObject },
  },
  { _id: true },
);

const ComponentSchema = new Schema(
  {
    order: { type: Number, default: 0, min: 0 },
    class: { type: String },
    time: { type: StudyTimeSchema, default: createEmptyObject },
    location: { type: StudyLocationSchema, default: createEmptyObject },
    status: {
      type: String,
    },
    schedule: { type: [WeeklyScheduleEntrySchema], default: [] },
    lectures: { type: [StudyLectureSchema], default: [] },
    weight: { type: Number },
    exams: { type: [ExamSchema], default: [] },
  },
  { _id: true },
);

const CourseSchema = new Schema(
  {
    code: { type: String, default: "" },
    name: { type: String, default: "" },
    status: {
      type: String,
    },
    totalWeight: { type: Number },
    components: { type: [ComponentSchema], default: [] },
  },
  { _id: true },
);

const ComponentLecturePageSchema = StudyPageSchema;
const ComponentLectureSchema = StudyLectureSchema;

export {
  WeeklyScheduleEntrySchema,
  StudyTimeSchema,
  StudyLocationSchema,
  StudyVolumeSchema,
  StudyGradeSchema,
  ExamSchema,
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
