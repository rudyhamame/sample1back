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

const dayEventsSchema = new Schema({
  attending:[{
    componentID: {type: String},
  }],
  examining:[{
    examIDs:[{type: String}],
  }],
  studying: [{
    lectureIDs: [{type: String}],
  }],
});

const programIntervalSchema = new Schema(
  {
    intervalSymbol: { type: String, default: "INT" },
    intervalNum: { type: Number },
    intervalID: { type: String, default: "" }, // = programID: INT{n}
    intervalStatus: [{ type: String, default: "Normal" }],
    intervalTry: [
      {
        intervalTrySymbol: { type: String, default: "IT" },
        intervalTryNum: { type: Number },
        intervalTryID: { type: String, default: "" }, // = intervalID + IT{n}
        intervalTrysubIntervals: [
          {
            subIntervalSymbol: { type: String, default: "sINT" },
            subIntervalNum: { type: Number },
            subIntervalID: { type: String, default: "" }, // = intervalTryID + sINT{n}
            subIntervalCurrent: { type: Boolean, default: false },
            subIntervalTryDates: {
              start: { 
                day:{type: Number}, 
                month:{type: Number}, 
                year:{type: Number},
                date: {type: Date, default: ""}   
              },
              end: { 
                day:{type: Number}, 
                month:{type: Number}, 
                year:{type: Number},
                date: {type: Date, default: ""}   
              },
              calender: [
                {
                  daySymbol:{type: String},
                  dayNum:{type: String},
                  dayID: {type: String},
                  dayName: {type: String},
                  dayHours:{
                    1:  { type: [dayEventsSchema], default: [] },
                    2:  { type: [dayEventsSchema], default: [] },
                    3:  { type: [dayEventsSchema], default: [] },
                    4:  { type: [dayEventsSchema], default: [] },
                    5:  { type: [dayEventsSchema], default: [] },
                    6:  { type: [dayEventsSchema], default: [] },
                    7:  { type: [dayEventsSchema], default: [] },
                    8:  { type: [dayEventsSchema], default: [] },
                    9:  { type: [dayEventsSchema], default: [] },
                    10: { type: [dayEventsSchema], default: [] },
                    11: { type: [dayEventsSchema], default: [] },
                    12: { type: [dayEventsSchema], default: [] },
                    13: { type: [dayEventsSchema], default: [] },
                    14: { type: [dayEventsSchema], default: [] },
                    15: { type: [dayEventsSchema], default: [] },
                    16: { type: [dayEventsSchema], default: [] },
                    17: { type: [dayEventsSchema], default: [] },
                    18: { type: [dayEventsSchema], default: [] },
                    19: { type: [dayEventsSchema], default: [] },
                    20: { type: [dayEventsSchema], default: [] },
                    21: { type: [dayEventsSchema], default: [] },
                    22: { type: [dayEventsSchema], default: [] },
                    23: { type: [dayEventsSchema], default: [] },
                    24: { type: [dayEventsSchema], default: [] },
                    25: { type: [dayEventsSchema], default: [] },
                    26: { type: [dayEventsSchema], default: [] },
                    27: { type: [dayEventsSchema], default: [] },
                    28: { type: [dayEventsSchema], default: [] },
                    29: { type: [dayEventsSchema], default: [] },
                    30: { type: [dayEventsSchema], default: [] },
                    31: { type: [dayEventsSchema], default: [] },
                    32: { type: [dayEventsSchema], default: [] },
                    33: { type: [dayEventsSchema], default: [] },
                    34: { type: [dayEventsSchema], default: [] },
                    35: { type: [dayEventsSchema], default: [] },
                    36: { type: [dayEventsSchema], default: [] },
                    37: { type: [dayEventsSchema], default: [] },
                    38: { type: [dayEventsSchema], default: [] },
                    39: { type: [dayEventsSchema], default: [] },
                    40: { type: [dayEventsSchema], default: [] },
                    41: { type: [dayEventsSchema], default: [] },
                    42: { type: [dayEventsSchema], default: [] },
                    43: { type: [dayEventsSchema], default: [] },
                    44: { type: [dayEventsSchema], default: [] },
                    45: { type: [dayEventsSchema], default: [] },
                    46: { type: [dayEventsSchema], default: [] },
                    47: { type: [dayEventsSchema], default: [] },
                    48: { type: [dayEventsSchema], default: [] },
                    49: { type: [dayEventsSchema], default: [] },
                    50: { type: [dayEventsSchema], default: [] },
                    51: { type: [dayEventsSchema], default: [] },
                    52: { type: [dayEventsSchema], default: [] },
                    53: { type: [dayEventsSchema], default: [] },
                    54: { type: [dayEventsSchema], default: [] },
                    55: { type: [dayEventsSchema], default: [] },
                    56: { type: [dayEventsSchema], default: [] },
                    57: { type: [dayEventsSchema], default: [] },
                    58: { type: [dayEventsSchema], default: [] },
                    59: { type: [dayEventsSchema], default: [] },
                    60: { type: [dayEventsSchema], default: [] },
                    61: { type: [dayEventsSchema], default: [] },
                    62: { type: [dayEventsSchema], default: [] },
                    63: { type: [dayEventsSchema], default: [] },
                    64: { type: [dayEventsSchema], default: [] },
                    65: { type: [dayEventsSchema], default: [] },
                    66: { type: [dayEventsSchema], default: [] },
                    67: { type: [dayEventsSchema], default: [] },
                    68: { type: [dayEventsSchema], default: [] },
                    69: { type: [dayEventsSchema], default: [] },
                    70: { type: [dayEventsSchema], default: [] },
                    71: { type: [dayEventsSchema], default: [] },
                    72: { type: [dayEventsSchema], default: [] },
                    73: { type: [dayEventsSchema], default: [] },
                    74: { type: [dayEventsSchema], default: [] },
                    75: { type: [dayEventsSchema], default: [] },
                    76: { type: [dayEventsSchema], default: [] },
                    77: { type: [dayEventsSchema], default: [] },
                    78: { type: [dayEventsSchema], default: [] },
                    79: { type: [dayEventsSchema], default: [] },
                    80: { type: [dayEventsSchema], default: [] },
                    81: { type: [dayEventsSchema], default: [] },
                    82: { type: [dayEventsSchema], default: [] },
                    83: { type: [dayEventsSchema], default: [] },
                    84: { type: [dayEventsSchema], default: [] },
                    85: { type: [dayEventsSchema], default: [] },
                    86: { type: [dayEventsSchema], default: [] },
                    87: { type: [dayEventsSchema], default: [] },
                    88: { type: [dayEventsSchema], default: [] },
                    89: { type: [dayEventsSchema], default: [] },
                    90: { type: [dayEventsSchema], default: [] },
                    91: { type: [dayEventsSchema], default: [] },
                    92: { type: [dayEventsSchema], default: [] },
                    93: { type: [dayEventsSchema], default: [] },
                    94: { type: [dayEventsSchema], default: [] },
                    95: { type: [dayEventsSchema], default: [] },
                    96: { type: [dayEventsSchema], default: [] },
                  } 
                },
              ],
            },
            subIntervalCourses: [
              {
                courseSymbol: { type: String, default: "CRS" },
                courseNum: { type: Number },
                courseID: { type: String, default: "" }, // = subIntervalID + CRS{n}
                courseName: { type: String, default: "" },
                courseCode: { type: String, default: "" },
                courseWeight: { type: Number, default: 100 },
                courseComponents: [
                  {
                    componentSymbol: { type: String, default: "COMP" },
                    componentNum: { type: Number },
                    componentID: { type: String, default: "" }, // = courseID + COMP{n}
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
  { _id: false, strict: "throw" },
);

// Instructor entries now track lecture IDs alongside names and personality.
const programInstructorsSchema = new Schema (
  {
    firstName: {type: String},
    lastName: {type: String},
    fullName: {type: String},
    personality: {type: String},
    lectureIDs:{type: [String]}
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
    subIntervalNum: { type: Number, default: null },
  },
  { _id: false }
);

const programAIExtractionsSchema = new Schema(
  {
    coursesNameCode:[
      {
      courseName: { type: String, default: "" },
      courseCode: { type: String, default: "" },
      confidence: { type: String, default: "low" },
      status: { type: String, enum:['accepted','rejected'] }
      }
    ],
    programInstructorNames: [{
      firstName: { type: String, default: null },
      lastName: { type: String, default: null },
      fullName: { type: String, default: "" },
      personality: { type: String, default: null },
      evidence: { type: [String], default: [] },
      confidence: { type: String, default: "low" },
      status: { type: String, enum:['accepted','rejected'] }
    }],
    subIntervalCourses: [
      {
        courseSymbol: { type: String, default: "CRS" },
        courseNum: { type: Number },
        courseID: { type: String, default: "" }, // = subIntervalID + CRS{n}
        courseName: { type: String, default: "" },
        courseCode: { type: String, default: "" },
        courseWeight: { type: Number, default: 100 },
        courseComponents: [
          {
            componentSymbol: { type: String, default: "COMP" },
            componentNum: { type: Number },
            componentID: { type: String, default: "" }, // = courseID + COMP{n}
            componentClass: { type: String, default: "" },
            componentWeight: { type: Number, default: null },
            // componentLocation: { type: locationSchema, default: null },
            // componentExams: { type: [componentExamsSchema], default: [] },
          },
        ],
        status: { type: String, enum:['accepted','rejected'] }
      },
    ],
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
    programAIExtractions: { type: [programAIExtractionsSchema], default: []}
  },
  { _id: true, strict: true },
);

export { StudyPlannerSchema };
export default StudyPlannerSchema;
