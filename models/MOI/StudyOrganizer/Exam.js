import mongoose from "mongoose";
import {
  StudyTimeSchema,
  StudyLocationSchema,
  StudyVolumeSchema,
  StudyWeightSchema,
  StudyGradeSchema,
  StudyRecommendationSchema,
} from "./Components.js";

const { Schema } = mongoose;

const createEmptyObject = () => ({});

const ExamSchema = new Schema(
  {
    componentId: { type: Schema.Types.ObjectId, default: null, index: true },
    type: { type: String, default: "" },
    time: { type: StudyTimeSchema, default: createEmptyObject },
    location: { type: StudyLocationSchema, default: createEmptyObject },
    lectures: { type: [Schema.Types.ObjectId], default: [] },
    weight: { type: StudyWeightSchema, default: createEmptyObject },
    passGrade: { type: StudyGradeSchema, default: createEmptyObject },
    grade: { type: StudyGradeSchema, default: createEmptyObject },
  },
  { _id: true },
);

export { ExamSchema };
export default ExamSchema;
