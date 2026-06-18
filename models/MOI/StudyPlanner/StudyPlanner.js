import mongoose from "mongoose";
import { PlannerSettingsSchema } from "./StudyOrganizer/settings.js";
import { CourseSchema } from "./StudyOrganizer/Components.js";
import { StudyLecturePlanAidSchema } from "./StudyOrganizer/SharedSchemas.js";

const { Schema } = mongoose;
const createEmptyObject = () => ({});

const locationSchema = new Schema(
  {
    building: { type: String, default: "" },
    rooms: { type: [String], default: [] },
  },
    { _id: false, strict: "throw" }
,
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

const lectureVolumeSchema = new Schema(
  {
    unit: { type: String, default: "page" },
    total: { type: String, default: "" },
    done: { type: String, default: "" },
    remaining: { type: String, default: "" },
  },
    { _id: false, strict: "throw" }
,
);

const intervalDatePartsSchema = new Schema(
  {
    day: { type: Number, default: null },
    month: { type: Number, default: null },
    year: { type: Number, default: null },
    date: { type: Date, default: null },
  },
    { _id: false, strict: "throw" }
,
);

const subIntervalDatesSchema = new Schema(
  {
    start: { type: intervalDatePartsSchema, default: () => ({}) },
    end: { type: intervalDatePartsSchema, default: () => ({}) },
  },
    { _id: false, strict: "throw" }
,
);

const componentDatesSchema = new Schema(
  {
    start: { type: intervalDatePartsSchema, default: () => ({}) },
    end: { type: intervalDatePartsSchema, default: () => ({}) },
  },
    { _id: false, strict: "throw" }
,
);



const dayEventsSchema = new Schema({
  attending:[{
    componentID: {type: String},
  }],
  tasks:[{
    taskIDs:[{type: String}],
  }],
  studying: [{
    lectureIDs: [{type: String}],
  }],
});

const intervalInfoSchema = new Schema ({
  intervalSymbol: { type: String, default: "INT" },
  intervalNum: { type: Number },
  intervalID: { type: String, default: "" }, // = programID: INT{n}
  intervalStatus: [{ type: String, default: "Normal" }],
},
{_id: false, strict: "throw"},
);

const subIntervalInfoSchema = new Schema ({
  subIntervalSymbol: { type: String, default: "sINT" },
  subIntervalNum: { type: Number },
  subIntervalID: { type: String, default: "" }, // = intervalID + sINT{n}
  subIntervalCurrent: {type: Boolean, default: false},
}, {_id: false, strict: "throw"},
);

const courseInfoSchema = new Schema ({
  courseSymbol: { type: String, default: "CRS" },
  courseNum: { type: Number },
  courseID: { type: String, default: "" }, // = subIntervalID + CRS{n}
  courseName: { type: String, default: "" },
  courseCode: { type: String, default: "" },
  courseWeight: { type: Number, default: 100 },
  courseGrade: { type: Number, default: 100 },
  courseStatus: { type: String, default: "" }, //new, failed, passed
},{_id: false, strict: 'throw'},
);

const componentScheduleSchema= new Schema ({
      day:{ type: String, default: "" },
      time: { type: String, default: "" },
      location: { type: locationSchema, default: null },
},{_id: false, strict: 'throw'},
);

const componentInfoSchema = new Schema ({
  componentSymbol: { type: String, default: "COMP" },
  componentName: { type: String, default: "" },
  componentNum: { type: Number },
  componentID: { type: String, default: "" }, // = courseID + COMP{n}
  componentWeight: { type: Number, default: null },
  componentDates: { type: componentDatesSchema, default: () => ({}) },
  componentSchedule: { type: componentScheduleSchema, default: () => ({}) },
  componentInstructors: [{
    firstName: {type: String},
    lastName: {type: String},
  }]
},{_id: false, strict: 'throw'},
);

const taskInfoSchema = new Schema ({
  taskSymbol: { type: String, default: "TSK" },
  taskNum: { type: Number }, // Final Exam, Midterm Exam, Homework, Quiz...
  taskID: { type: String, default: "" }, // = componentID:EXM:taskNum
  taskName:{ type: String, default: "" },
  taskLocation: { type: locationSchema, default: null },
  taskDate: { type: Date },
  taskTime: { type: String, default: "" },
  taskWeight: { type: Number, default: null },
  taskGrade: { type: Number, default: null },
},{_id: false, strict: 'throw'},
);

const lectureConceptsSchema = new Schema ({
  lectureTags: [{ //4D| Abstraction
    phenomenaNames: [],
    moleculesNames: [],
    cellsNames: [],
    tissuesNames: [],
    organsNames: [],
    systemsNames: [],
    humansNames:[],
    symptomsNames: [],
    signsNames: [],
    conditionsNames: [],
    diseasesNames: [],
    descriptorsNames: [],
  }],
  lectureConditions:[{ //3D| instantiation
    tag: {type: String},
    descriptor: {type: String},
    value: {type: String},
  }]
});

const lectureInfoSchema = new Schema ({
  lectureSymbol: { type: String, default: "LEC" },
  lectureNum: { type: Number },
  lectureID: { type: String, default: "" }, // = taskID:LEC:lectureNum
  lectureName: { type: String, default: "" },
  lectureCourseName: { type: String, default: "" },
  lectureComponentName: { type: String, default: "" },
  lectureInstructors: { type: [String], default: [] },
  lectureInstructionDate: { type: Date, default: null },
},{_id: false, strict: 'throw'},
);

const documentInfoSchema = new Schema ({
  documentSymbol: { type: String, default: "DOC" },
  documentNum: { type: Number, default: null }, // documentNum++ starts from 1
  documentID: { type: String, default: "" }, //documentID = documentSymbol + documentNum
  documentName: { type: String, default: "" }, 
  documentType: { type: String, default: "" }, // PDF, IMAGE, Video, Youtube Video ...
  documentVolumeUnit: { type: String, default: "" }, // page, image, words, letters
  documentVolume: { type: Number, default: null }, // number of pages, number of images ...
  documentEditors: { type: [String], default: [] }, // a subset of programEditors
  documentByteSize: { type: Number, default: 0, min: 0 },
},{_id: false, strict: 'throw'},
);

const programIntervalsSchema = new Schema(
  {
    intervalInfo: { type: intervalInfoSchema, default: {} },
    intervalSubIntervals: [
      {
        subIntervalInfo: { type: subIntervalInfoSchema, default: {} },
        subIntervalCourses: {type: [String], default: []},
      },
    ]
  },
  { _id: false, strict: "throw" },
);

const programCoursesInfoSchema = new Schema (
  {
    subIntervalID: {type: String},
    courseName: {type: String},
    courseCode: {type: String},
    courseWeight:{type: Number},
  },  
  { _id: false, strict: "throw" },
);

const programCurrentIntervalSelectionSchema = new Schema(
  {
    intervalNum: { type: Number, default: null },
    subIntervalNum: { type: Number, default: null },
    subIntervalID: { type: String, default: "" },
  },
{ _id: false, strict: "throw" },
);

const programLecturesSchema = new Schema ({
  lectureInfo: {type: lectureInfoSchema, default: ''},
  lectureDocuments: { type: [String], default: [] },
  // lectureConcepts: { type: [lectureConceptsSchema], default: [] },
},{ _id: false, strict: "throw" });

const programDocumentsSchema = new Schema ({
 documentInfo: {type: documentInfoSchema, default:{}},
 documentURL: {type: String, default: ''},
},{ _id: false, strict: "throw" });

const programTasksSchema = new Schema ({
  taskInfo: { type: taskInfoSchema, default: {} },
  tasksLectures: [{ type: String, default: '' }], // the lectures ID
},{ _id: false, strict: "throw" });

const programCoursesSchema = new Schema ({
  courseInfo: { type: courseInfoSchema, default: {} },
  courseComponents: [
    {
      componentInfo: { type: componentInfoSchema, default: {} },
      componentLectures:[{type: String, default:''}],
    },
  ],
},{ _id: false, strict: "throw" });

const programExamPartSchema = new Schema(
  {
    examPartID: { type: String, default: "" },
    componentID: { type: String, default: "" },
    examClass: { type: String, default: "" },
    taskLocation: { type: locationSchema, default: null },
    taskDate: { type: Date, default: null },
    taskTime: { type: String, default: "" },
    examlectureIDs: { type: [String], default: [] },
    taskWeight: { type: Number, default: null },
    taskGrade: { type: Number, default: null },
  },
  { _id: false, strict: "throw" },
);

const programExamGroupSchema = new Schema(
  {
    componentID: { type: String, default: "" },
    examParts: { type: [programExamPartSchema], default: [] },
  },
  { _id: false, strict: "throw" },
);

const studyOrganizerSchema = new Schema(
  {
    courses: { type: [CourseSchema], default: [] },
  },
  { _id: false },
);

const StudyPlannerSchema = new Schema(
  {
    programID: { type: String, default: "" }, // root of the XID chain
    programName: { type: String, default: "" },
    programCurrentIntervalSelection: { type: programCurrentIntervalSelectionSchema, default: null },
    programUniversity: { type: String, default: "" },
    programFaculty: { type: String, default: "" },
    programLanguage: { type: String, default: "" },
    programStartYear: { type: Number, default: null },
    programTotalYears: { type: Number, default: null },
    programTermsPerYear: { type: Number, default: null },
     programFailingRules: [{
      thresholdMode: { type: String, default: null }, // "interval" or "course"
      thresholdUnit: { type: String, default: null },
      thresholdNumber: { type: Number, default: null },
      thresholdRule: { type: String, enum: ["less than", "equal", "more than"], default: null }
    }],
    settings: { type: PlannerSettingsSchema, default: createEmptyObject },
    // Helper
    programComponentNames: { type: [String], default: [] },
    programDocumentTypes: { type: [String], default: [] },
    programEditors: { type: [String], default: [] },
    programLocations: { type: [locationSchema], default: [] },
    programTaskNames: { type: [String], default: [] },
    // Organizer
    programIntervals: { type: [programIntervalsSchema], default: [] },
    programCourses: {type: [programCoursesSchema], default: [] },
    programLectures:  { type: [programLecturesSchema], default: [] },
    programDocuments: { type: [programDocumentsSchema], default: [] },
    programTasks: { type: [programTasksSchema], default: [] },
    programExams: { type: [programExamGroupSchema], default: [] },
    exams: { type: [Schema.Types.Mixed], default: [] },
    studyOrganizer: { type: studyOrganizerSchema, default: () => ({ courses: [] }) },
    studyPlanAid: { type: StudyLecturePlanAidSchema, default: () => ({}) },
  },
  { _id: true, strict: "throw" },
);

export { StudyPlannerSchema };
export default StudyPlannerSchema;
