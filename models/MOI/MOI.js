import mongoose from "mongoose";
import StudyPlannerSchema from "./StudyPlanner/StudyPlanner.js";

const { Schema } = mongoose;

const MOISchema = new Schema(
  {
    studyPlanner: { type: StudyPlannerSchema, default: () => ({}) },
  },
  { _id: false, strict: false },
);

export default MOISchema;
