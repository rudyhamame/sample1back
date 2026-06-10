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

const byteArraySemanticsSchema = new Schema({
  byteArraySemanticsVolumeUnit: { type: String, default: "" }, //page, image, words, letters
  byteArraySemanticsVolume: { type: Number, default: null }, // number of pages, number of images ...
  byteArraySemanticsEditors: { type: [String], default: [] }, // a subset of programEditors
  byteArraySemanticsConcepts: { type: [String], default: [] },
});

const lectureByteArraysSchema = new Schema(
  {
    //morphe
    byteArrayName: { type: String, default: "" }, //Bacteria
    byteArraySemantics: { type: [byteArraySemanticsSchema], default: [] }, // morphe
    byteArraySyntax: { type: String, default: "" }, //PDF, IMAGE ...
    byteArrayLength: { type: Number, default: 0, min: 0 },
    // Hyle
    byteArray: { type: String, default: "" },
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
const examPartSchema = new Schema(
  {
    examPartID: { type: String, default: "" },
    componentID: { type: String, default: "" },
    examClass: { type: String, default: "" },
    examLocation: { type: locationSchema, default: null },
    examDate: { type: Date },
    examTime: { type: String, default: "" },
    examlectureIDs: { type: [String], default: [] },
    examWeight: { type: Number, default: null },
    examGrade: { type: Number, default: null },
  },
  { _id: false },
);

const programExamsSchema = new Schema(
  {
    componentID: { type: String, default: "" },
    examParts: { type: [examPartSchema], default: [] },
  },
  { _id: false },
);
const componentLecturesSchema = new Schema( 
  {
    lectureID: { type: String, default: "" },
    lectureNum: { type: Number, default: ""},
    lectureName: { type: String, default: "" },
    lectureInstructors: { type: [String], default: [] },
    lectureInstructionDate: { type: Date, default: null },
    lectureBytes: { type: [lectureByteArraysSchema], default: [] },
  },
  { _id: true },
);
const programIntervalSchema = new Schema( 
  {
        intervalNum:{ type: Number, default: null },
        intervalStatus: [{ type: String, default: "Normal" }],
        intervalsubIntervals: [
          {
            subIntervalID: { type: String, default: "" },
            subIntervalNum:{ type: Number},
            subIntervalDates:{
              start:{type: Date},
              end: {type: Date},
            },
            subIntervalCurrent: {type: Boolean, default: false},
            subIntervalCourses: [
              {//materials to examine
                courseID: { type: String, default: "" },
                courseNum: { type: Number},
                courseName: { type: String, default: "" },
                courseCode: { type: String, default: "" },
                courseWeight: { type: Number, default: 100},
                courseComponents: [
                  {
                    componentID: { type: String, default: "" },
                    componentClass: { type: String, default: "" },
                    componentWeight: { type: Number, default: null },
                    componentLocation: { type: locationSchema, default: null },
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
  },
  { _id: true, strict: true },
);

export { StudyPlannerSchema };
export default StudyPlannerSchema;
