import mongoose from "mongoose";
import StudyOrganizerSchema from "./StudyOrganizer/StudyOrganizer.js";

const { Schema } = mongoose;

const locationSchema = new Schema(
  {
    building: { type: String, default: "" },
    rooms: { type: [String], default: [] },
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

const lectureVolumeSchema = new Schema(
  {
    unit: { type: String, default: "page" },
    total: { type: String, default: "" },
    done: { type: String, default: "" },
    remaining: { type: String, default: "" },
  },
  { _id: false },
);
const programExamsSchema = new Schema(
  {
    //Exam metadata 
    // ID
    examClass: { type: String, default: "" },
    courseName: { type: String, default: "" },
    courseCode: { type: String, default: "" },
    componentId: { type: String, default: "" },
    //logistics (time and location)
    examLocation: { type: locationSchema, default: null },
    //materials
    lectureIds: { type: [String], default: [] },
    //grading
    maxScore: { type: Number, default: "" },
    minScore: { type: Number, default: "" },
    weight: { type: Number, default: "" },
    actualScore: { type: Number, default: "" },
  },
  { _id: false },
);
const componentLecturesSchema = new Schema( 
  {
    lectureName: { type: String, default: "" },
    lectureInstructors: { type: [String], default: [] },
    lectureEditors:{ type: [String], default: [] },
    lectureGivenDate: { type: Date, default: null },
    lectureEditedDate: { type: Date, default: null },
    lectureLocation: { type: locationSchema, default: null },
    lectureVolume: { type: lectureVolumeSchema, default: () => ({}) },
    lecture_pagesFinished: { type: [Number], default: [] },
    lectureContent: [
      {
        contentId: { type: String, default: "" },
        documents: {
          type: [lectureContentDocumentSchema],
          default: [],
        },
      },
    ],
  },{ _id: true }
)
const programIntervalSchema = new Schema( 
  {
        intervalId: { type: String, default: "" },
        intervalNum:{ type: Number, default: null },
        intervalStatus: [{ type: String, default: "Normal" }],
        intervalsubIntervals: [
          {
            subIntervalId: { type: String, default: "" },
            subIntervalDates:{
              start:{type: Date},
              end: {type: Date},
            },
            subIntervalCourses: [
              {//materials to examine
                courseName: { type: String, default: "" },
                courseCode: { type: String, default: "" },
                courseWeight: { type: Number, default: "" },
                courseComponents: [
                  {
                    componentId: { type: String, default: "" },
                    componentWeightPercentage: { type: Number, min: 0, max: 1, default: "" },
                    componentLectures: {type: [componentLecturesSchema], default: []},
                  },
                ],
              },
            ],
          },
        ],
      },
      { _id: false },
    );

const StudyPlannerSchema = new Schema(
  {
    programId: { type: String, default: "" },
    programUniversity: { type: String, default: "" },
    programFaculty: { type: String, default: "" },
    programLanguage: { type: String, default: "" },
    programComponents: { type: [String], default: [] },
    programStartYear: { type: Number, default: null },
    programTotalYears: { type: Number, default: null },
    programTermsPerYear: { type: Number, default: null },
    programInstructors: { type: [String], default: [] },
    programEditors: { type: [String], default: [] },
    programLocations: { type: [locationSchema], default: [] },
    programFailingRules: [{
      thresholdMode: { type: String, default: null }, // "interval" or "course"
      thresholdUnit: { type: String, default: null },
      thresholdNumber: { type: Number, default: null },
    }],
    programIntervals: { type: [programIntervalSchema], default: [] }, //materials to examine
    programExamClasses:{ type: [String], default: [] },
    programExams: { type: [programExamsSchema], default: [] }, //exams
    studyPlanAid: { type: studyPlanAidSchema, default: () => ({}) },
    studyOrganizer: { type: StudyOrganizerSchema, default: () => ({}) },
  },
  { _id: true, strict: true },
);

export { StudyPlannerSchema };
export default StudyPlannerSchema;
