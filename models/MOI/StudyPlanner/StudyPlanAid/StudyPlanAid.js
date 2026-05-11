import mongoose from "mongoose";

const { Schema } = mongoose;

const StudyPlanAidLectureSchema = new Schema(
  {
    lectureId: { type: Schema.Types.ObjectId, default: null },
    pageIds: { type: [Schema.Types.ObjectId], default: [] },
    normalizedPageText: { type: [String], default: [] },
    studyNotes: { type: String, default: "" },
    memorizationTips: { type: String, default: "" },
    practiceQuestions: { type: [String], default: [] },
    note: { type: String, default: "" },
  },
  { _id: true },
);

const StudyPlanAidSchema = new Schema(
  {
    enabled: { type: Boolean, default: false },
    source: { type: String, default: "normalized-page-text" },
    goal: {
      type: String,
      default: "Help make the study plan more achievable from lecture page text.",
    },
    lectureAids: { type: [StudyPlanAidLectureSchema], default: [] },
    note: { type: String, default: "" },
  },
  { _id: true },
);

export { StudyPlanAidLectureSchema, StudyPlanAidSchema };
export default StudyPlanAidSchema;
