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
  componentStatus: { type: String, default: "" },
  componentDates: { type: componentDatesSchema, default: () => ({}) },
  componentLocation: { type: locationSchema, default: null },
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
  lectureOrder: { type: Number, default: "" },
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
  documentLectureID: { type: String, default: "" },
  documentLectureName: { type: String, default: "" },
  documentName: { type: String, default: "" }, 
  documentType: { type: String, default: "" }, // PDF, IMAGE, Video, Youtube Video ...
  documentVolumeUnit: { type: String, default: "" }, // page, image, words, letters
  documentVolume: { type: Number, default: null },
  documentPages:[{
    pageOrder: {type: Number, default: null },
    pageStatus: {type: String, default: null },
    pageNotes: [{type: String, default: null}],
  }],
  documentEditors: { type: [String], default: [] }, // a subset of programEditors
  documentConcepts: { type: [String], default: [] },
  documentByteSize: { type: Number, default: 0 },
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
  lectureInfo: {type: lectureInfoSchema, default: () => ({})},
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

const programStudySessionsSchema = new Schema ({
  studySessionID:{ type: String, default: "" },
  studySessionSymbol: { type: String, default: "SS" },
  studySessionNum: { type: Number, default: "" },
  studySessionStartDate:{ type: Date, default: "" },
  studySessionEndDate: { type: Date, default: "" },
  studySessionAchievements: [{
    documentID:  { type: String, default: "" }, // what I studied
    pagesDone: [{ type: Number }],
  }],
  studySessionPosted:{ type: Boolean, default:false },
  pausedTotalMs: { type: Number, default: 0 },
},{ _id: false, strict: 'throw' });

const normalizeStudySessionAchievementForStorage = (entry = {}) => {
  const source = entry && typeof entry === "object" ? entry : {};
  const pagesDone = Array.isArray(source?.pagesDone) ? source.pagesDone : [];
  return {
    documentID: String(source?.documentID || source?.documentId || "").trim(),
    pagesDone: Array.from(
      new Set(
        pagesDone
          .map((value) => Number(value))
          .filter((value) => Number.isFinite(value) && value > 0),
      ),
    ).sort((left, right) => left - right),
  };
};

const normalizeStudySessionForStorage = (entry = {}, index = 0) => {
  const source = entry && typeof entry === "object" ? entry : {};
  const rawSessionID = String(source?.studySessionID || source?.studySessionId || "").trim();
  const rawSessionSymbol = String(source?.studySessionSymbol || source?.sessionSymbol || "SS").trim() || "SS";
  const rawSessionNum = Number(source?.studySessionNum);
  const rawStartDate = source?.studySessionStartDate || source?.startDate || source?.start_date || null;
  const rawEndDate = source?.studySessionEndDate || source?.endDate || source?.end_date || null;
  const rawAchievements = Array.isArray(source?.studySessionAchievements)
    ? source.studySessionAchievements
    : Array.isArray(source?.achievements)
      ? source.achievements
      : Array.isArray(source?.sessionAchievements)
        ? source.sessionAchievements
        : [];
  return {
    studySessionID: rawSessionID,
    studySessionSymbol: rawSessionSymbol,
    studySessionNum: Number.isFinite(rawSessionNum) ? rawSessionNum : index + 1,
    studySessionStartDate: rawStartDate ? new Date(rawStartDate) : null,
    studySessionEndDate: rawEndDate ? new Date(rawEndDate) : null,
    studySessionAchievements: rawAchievements
      .map((achievementEntry) => normalizeStudySessionAchievementForStorage(achievementEntry))
      .filter((achievementEntry) => Boolean(achievementEntry.documentID)),
    pausedTotalMs: Math.max(0, Number(source?.pausedTotalMs) || 0),
    studySessionPosted: Boolean(source?.studySessionPosted),
  };
};

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
    programComponentNames: [{
      componentName:{ type: String, default: "" },
      componentNum: { type: Number, default: "" },
    }],
    programDocumentTypes: { type: [String], default: [] },
    programDocumentVolumeUnit : { type: [String], default: [] },
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
    programStudySessions: { type: [programStudySessionsSchema], default: [] },
    programRewards:{
      targetPagesDone: { type: Number, default: null },
      programRewardImagesURLs: { type: [String], default: [] },
    },
    exams: { type: [Schema.Types.Mixed], default: [] },
    studyOrganizer: { type: studyOrganizerSchema, default: () => ({ courses: [] }) },
    studyPlanAid: { type: StudyLecturePlanAidSchema, default: () => ({}) },
  },
  { _id: true, strict: "throw" },
);

StudyPlannerSchema.pre("validate", function (next) {
  try {
    if (Array.isArray(this.programStudySessions)) {
      this.programStudySessions = this.programStudySessions.map(
        (entry, index) => normalizeStudySessionForStorage(entry, index),
      );
    }
    next();
  } catch (error) {
    next(error);
  }
});

export { StudyPlannerSchema };
export default StudyPlannerSchema;
