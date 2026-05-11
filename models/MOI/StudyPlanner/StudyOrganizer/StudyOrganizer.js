import mongoose from "mongoose";
import { CourseSchema } from "./Components.js";
import {
  PlannerRelationshipConditionSchema,
  PlannerRelationshipSchema,
  PlannerSettingsSchema,
} from "./settings.js";

const { Schema } = mongoose;

const createEmptyObject = () => ({});

const StudyOrganizerSchema = new Schema(
  {
    courses: { type: [CourseSchema], default: [] },
    settings: { type: PlannerSettingsSchema, default: createEmptyObject },
  },
  { _id: true },
);

export {
  PlannerRelationshipConditionSchema,
  PlannerRelationshipSchema,
  PlannerSettingsSchema,
  StudyOrganizerSchema,
};

export default StudyOrganizerSchema;
