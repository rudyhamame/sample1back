import mongoose from "mongoose";

const VisitLogSchema = new mongoose.Schema({
  ip: {
    type: String,
    required: true,
  },
  country: {
    type: String,
    default: "Unknown",
  },
  visitedAt: {
    type: Date,
    required: true,
    default: Date.now,
  },
});

const VisitLogModel = mongoose.model("visit_log", VisitLogSchema);

export default VisitLogModel;
