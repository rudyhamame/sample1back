import mongoose from "mongoose";
import StudyOrganizerSchema from "../StudyOrganizer/StudyOrganizer.js";
import StudyPlanAidSchema from "../StudyPlanAid/StudyPlanAid.js";

const { Schema } = mongoose;

const StudyPlannerSchema = new Schema(
  {
    studyOrganizer: { type: StudyOrganizerSchema, default: () => ({}) },
    studyPlanAid: { type: StudyPlanAidSchema, default: () => ({}) },
  },
  { _id: true },
);

export { StudyPlannerSchema };
export default StudyPlannerSchema;
