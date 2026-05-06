import mongoose from "mongoose";
import { CourseSchema, StudyTimeSchema } from "./Components.js";

const { Schema } = mongoose;

const createEmptyObject = () => ({});

const StudyOrganizerSchema = new Schema(
  {
    courses: { type: [CourseSchema], default: [] },
    settings: {
      selectOptions: {
        type: Schema.Types.Mixed,
        default: createEmptyObject,
      },
      fieldsRelationships: {
        type: Schema.Types.Mixed,
        default: createEmptyObject,
      },
    },
  },
  { _id: true },
);

export { StudyOrganizerSchema };

export default StudyOrganizerSchema;
