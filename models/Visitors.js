import mongoose from "mongoose";

const { Schema } = mongoose;

const VisitorVisitSchema = new Schema(
  {
    visitedAt: { type: Date, default: Date.now },
    country: { type: String, default: "" },
    path: { type: String, default: "/" },
    referrer: { type: String, default: "" },
    userAgent: { type: String, default: "" },
  },
  { _id: false },
);

const VisitorsSchema = new Schema(
  {
    ip: {
      type: String,
      required: true,
    },
    fingerprint: {
      type: String,
      default: "",
    },
    geo: {
      country: { type: String, default: "" },
      city: { type: String, default: "" },
      region: { type: String, default: "" },
    },
    status: {
      type: String,
      enum: ["allowed", "blocked", "flagged"],
      default: "allowed",
    },
    note: {
      type: String,
      default: "",
    },
    videoInfoAutho: {
      type: String,
      default: "",
    },
    visitCount: {
      type: Number,
      default: 1,
      min: 0,
    },
    firstSeenAt: {
      type: Date,
      default: Date.now,
    },
    lastSeenAt: {
      type: Date,
      default: Date.now,
    },
    convertedAt: {
      type: Date,
      default: null,
    },
    visits: {
      type: [VisitorVisitSchema],
      default: [],
    },
  },
  {
    strict: "throw",
    timestamps: false,
  },
);

VisitorsSchema.index(
  { ip: 1 },
  { name: "visitors_ip_idx", unique: true },
);

VisitorsSchema.index(
  { fingerprint: 1 },
  { name: "visitors_fingerprint_idx", sparse: true },
);

VisitorsSchema.index(
  { status: 1 },
  { name: "visitors_status_idx" },
);

VisitorsSchema.index(
  { lastSeenAt: -1 },
  { name: "visitors_last_seen_idx" },
);

const VisitorsModel =
  mongoose.models.visitors || mongoose.model("visitors", VisitorsSchema);

export default VisitorsModel;
