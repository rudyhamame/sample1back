import mongoose from "mongoose";
import StudyOrganizerSchema from "./StudyOrganizer/StudyOrganizer.js";

const { Schema } = mongoose;

const attendanceLocationSchema = new Schema(
  {
    building: { type: String, default: "" },
    room: { type: String, default: "" },
  },
  { _id: false },
);

const lectureContentDocumentSchema = new Schema(
  {
    documentId: { type: String, default: "" },
    name: { type: String, default: "" },
    type: { type: String, default: "" },
    url: { type: String, default: "" },
    storageKey: { type: String, default: "" },
    mimeType: { type: String, default: "" },
    size: { type: Number, default: 0, min: 0 },
    uploadedAt: { type: Date, default: null },
    source: {
      type: String,
      enum: ["telegram", "upload", "manual", "camera-scan"],
      default: "upload",
    },
    telegram: {
      groupReference: { type: String, default: "" },
      messageId: { type: String, default: "" },
      messageDate: { type: Date, default: null },
      senderName: { type: String, default: "" },
      attachmentKind: { type: String, default: "" },
      caption: { type: String, default: "" },
    },
    upload: {
      uploadedByUserId: { type: String, default: "" },
      originalFileName: { type: String, default: "" },
      uploadDate: { type: Date, default: null },
    },
    manual: {
      title: { type: String, default: "" },
      volume: { type: String, default: "" },
      note: { type: String, default: "" },
      referenceCode: { type: String, default: "" },
      createdByUserId: { type: String, default: "" },
      createdAt: { type: Date, default: null },
    },
    cameraScan: {
      capturedByUserId: { type: String, default: "" },
      imageUrls: { type: [String], default: [] },
      imageCount: { type: Number, default: 0, min: 0 },
      scannedAt: { type: Date, default: null },
      // Generated PDF from captured camera images
      pdfUrl: { type: String, default: "" },
      pdfStorageKey: { type: String, default: "" },
      pdfFileName: { type: String, default: "" },
      pdfMimeType: { type: String, default: "application/pdf" },
      pdfSize: { type: Number, default: 0, min: 0 },
      pdfGeneratedAt: { type: Date, default: null },
    },
  },
  { _id: false },
);

const programModesTermSchema = new Schema(
  {
    year: { type: Number, default: null },
    order: { type: Number, default: null },
  },
  { _id: true },
);

const programModesSchema = new Schema(
  {
    terms: { type: [programModesTermSchema], default: [] },
  },
  { _id: true },
);

const programTermsSchema = new Schema(
  {
    year: { type: Number, default: null },
    order: { type: Number, default: null },
    label: { type: String, default: "" },
  },
  { _id: true },
);

const studyPlanAidIntervalSchema = new Schema(
  {
    intervalId: { type: String, default: "" },
    intervalCourses: { type: [], default: [] },
    year: { type: String, default: "" },
    term: { type: String, default: "" },
    start: { type: Date, default: null },
    end: { type: Date, default: null },
    startDate: { type: String, default: "" },
    endDate: { type: String, default: "" },
    componentClass: { type: String, default: "" },
  },
  { _id: false },
);

const studyPlanAidSchema = new Schema(
  {
    intervals: { type: [studyPlanAidIntervalSchema], default: [] },
  },
  { _id: true },
);

const programComponentIntervalSchema = new Schema(
  {
    intervalId: { type: String, default: "" },
    intervalWeight: { type: String, default: "" },
  },
  { _id: false },
);

const courseWeightSchema = new Schema(
  {
    componentId: { type: String, default: "" },
    weight: { type: String, default: "" },
  },
  { _id: false },
);

const StudyPlannerSchema = new Schema(
  {
    programId: { type: String, default: "" },
    programUniversity: { type: String, default: "" },
    programFaculty: { type: String, default: "" },
    programLanguage: { type: String, default: "" },
    programExams: { type: [String], default: [] },
    programComponents: { type: [String], default: [] },
    programStartYear: { type: Number, default: null },
    programTotalYears: { type: Number, default: null },
    programTermsPerYear: { type: Number, default: null },
    programFailingRules: [{
      thresholdMode: { type: String, default: null }, // "interval" or "course"
      thresholdUnit: { type: String, default: null },
      thresholdNumber: { type: Number, default: null },
    }],
    programIntervals: [
      {
        intervalId: { type: String, default: "" },
        intervalStatus: [{ type: String, default: "TBD" }],
        intervalsubIntervals: [
          {
            subIntervalId: { type: String, default: "" },
            subIntervalCourses: [
              {
                courseId: { type: String, default: "" },
                courseCode: { type: String, default: "" },
                courseTotalWeight: { type: String, default: "" },
                courseWeight: {type: [courseWeightSchema], default: []},
                courseComponents: [
                  {
                    componentId: { type: String, default: "" },
                    componentLectures: [
                      {
                        lectureId: { type: String, default: "" },
                        lectureContent: [
                          {
                            contentId: { type: String, default: "" },
                            documents: {
                              type: [lectureContentDocumentSchema],
                              default: [],
                            },
                          },
                        ],
                      },
                    ],
                  },
                ],
              },
            ],
          },
        ],
      },
    ],
    studyPlanAid: { type: studyPlanAidSchema, default: () => ({}) },
    studyOrganizer: { type: StudyOrganizerSchema, default: () => ({}) },
  },
  { _id: true, strict: true },
);

export { StudyPlannerSchema };
export default StudyPlannerSchema;
