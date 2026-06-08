import mongoose from "mongoose";

const VisitLogEntrySchema = new mongoose.Schema(
  {
    ip: {
      type: String,
      required: true,
      index: true,
    },
    country: {
      type: String,
      default: "Unknown",
    },
    visitedAt: {
      type: Date,
      required: true,
      default: Date.now,
      index: true,
    },
  },
  {
    collection: "visit_logs",
    timestamps: true,
  },
);

const VisitLogEntryModel =
  mongoose.models.visit_logs ||
  mongoose.model("visit_logs", VisitLogEntrySchema, "visit_logs");

export default VisitLogEntryModel;
