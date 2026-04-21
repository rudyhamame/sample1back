import mongoose from "mongoose";

// Sub-schema only. Do not register a model; `subjects` is the only collection.
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

export default VisitLogSchema;
