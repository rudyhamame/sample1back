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



const lectureDocumentsSchema = new Schema(
  {
    documentSymbol: { type: String, default: "DOC" },
    documentNum: { type: Number, default: null },
    documentID: { type: String, default: "" }, // = lectureID:DOC:documentNum
    documentName: { type: String, default: "" },
    documentSemanticsVolumeUnit: { type: String, default: "" }, // page, image, words, letters
    documentSemanticsVolume: { type: Number, default: null }, // number of pages, number of images ...
    documentSemanticsEditors: { type: [String], default: [] }, // a subset of programEditors
    documentSemanticsConcepts: { type: [String], default: [] },
    documentType: { type: String, default: "" }, // PDF, IMAGE ...
    documentByteSize: { type: Number, default: 0, min: 0 },
    documentURL: { type: String, default: "" },
  },
  { _id: true },
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

const examLecturesSchema = new Schema(
  {
    lectureSymbol: { type: String, default: "LEC" },
    lectureNum: { type: Number },
    lectureID: { type: String, default: "" }, // = examID:LEC:lectureNum
    lectureName: { type: String, default: "" },
    lectureInstructors: { type: [String], default: [] },
    lectureInstructionDate: { type: Date, default: null },
    lectureDocuments: { type: [lectureDocumentsSchema], default: [] },
  },
  { _id: true },
);

const componentExamsSchema = new Schema(
  {
    examSymbol: { type: String, default: "EXM" },
    examNum: { type: Number },
    examID: { type: String, default: "" }, // = componentID:EXM:examNum
    examLocation: { type: locationSchema, default: null },
    examDate: { type: Date },
    examTime: { type: String, default: "" },
    examWeight: { type: Number, default: null },
    examGrade: { type: Number, default: null },
    examsLectures: { type: [examLecturesSchema], default: [] },
  },
  { _id: false },
);

const programIntervalSchema = new Schema(
  {
    intervalSymbol: { type: String, default: "INT" },
    intervalNum: { type: Number },
    intervalID: { type: String, default: "" }, // = programID:INT:intervalNum
    intervalStatus: [{ type: String, default: "Normal" }],
    intervalTry: [
      {
        intervalTrySymbol: { type: String, default: "IT" },
        intervalTryNum: { type: Number },
        intervalTryID: { type: String, default: "" }, // = intervalID:IT:intervalTryNum
        intervalTrysubIntervals: [
          {
            subIntervalSymbol: { type: String, default: "sINT" },
            subIntervalNum: { type: Number },
            subIntervalID: { type: String, default: "" }, // = intervalTryID:sINT:subIntervalNum
            subIntervalCurrent: { type: Boolean, default: false },
            subIntervalTryDates: {
              start:{
                day:{ type: Number },
                month: { type: Number },
                year:{ type: Number },
              },
              end:{
                day:{ type: Number },
                month: { type: Number },
                year:{ type: Number },
              }        
            },
            subIntervalCourses: [
              {
                courseSymbol: { type: String, default: "CRS" },
                courseNum: { type: Number },
                courseID: { type: String, default: "" }, // = subIntervalID:CRS:courseNum
                courseName: { type: String, default: "" },
                courseCode: { type: String, default: "" },
                courseWeight: { type: Number, default: 100 },
                courseComponents: [
                  {
                    componentSymbol: { type: String, default: "COMP" },
                    componentNum: { type: Number },
                    componentID: { type: String, default: "" }, // = courseID:COMP:componentNum
                    componentClass: { type: String, default: "" },
                    componentWeight: { type: Number, default: null },
                    componentLocation: { type: locationSchema, default: null },
                    componentExams: { type: [componentExamsSchema], default: [] },
                  },
                ],
              },
            ],
          },
        ],
      },
    ],
  },
  { _id: false },
);

const programInstructorsSchema = new Schema (
  {
    firstName: {type: String},
    lastName: {type: String},
  },
  { _id: false }
);

const programCoursesNamesCodesSchema = new Schema (
  {
    courseName: {type: String},
    courseCode: {type: String},
  },  
  { _id: false }
);

const programCurrentIntervalTryNumSchema = new Schema(
  {
    intervalNum: { type: Number, default: null },
    intervalTryNum: { type: Number, default: null },
  },
  { _id: false }
);

const programAIExtractionsSchema = new Schema(
  {
    extractionGoal: { type: String, default: null },
    extractionItems: { type: [String], default: [] },
    extractionTimestamp: {type: String},
  }
);
const StudyPlannerSchema = new Schema(
  {
    programID: { type: String, default: "" }, // root of the XID chain
    programName: { type: String, default: "" },
    programCurrentIntervalTryNum: { type: programCurrentIntervalTryNumSchema, default: null },
    programUniversity: { type: String, default: "" },
    programFaculty: { type: String, default: "" },
    programLanguage: { type: String, default: "" },
    programComponentClasses: { type: [String], default: [] },
    programStartYear: { type: Number, default: null },
    programTotalYears: { type: Number, default: null },
    programTermsPerYear: { type: Number, default: null },
    programInstructors: { type: [programInstructorsSchema], default: [] },
    programEditors: { type: [String], default: [] },
    programLocations: { type: [locationSchema], default: [] },
    programCoursesNamesCodes: { type: [programCoursesNamesCodesSchema], default: [] },
    programFailingRules: [{
      thresholdMode: { type: String, default: null }, // "interval" or "course"
      thresholdUnit: { type: String, default: null },
      thresholdNumber: { type: Number, default: null },
      thresholdRule: { type: String, enum: ["less than", "equal", "more than"], default: null }
    }],
    programExamClasses: { type: [String], default: [] },
    programIntervals: { type: [programIntervalSchema], default: [] },
    programAIExtractions: {type: [programAIExtractionsSchema], default: []}
  },
  { _id: true, strict: true },
);

export { StudyPlannerSchema };
export default StudyPlannerSchema;
