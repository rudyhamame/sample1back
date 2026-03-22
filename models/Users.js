import mongoose from "mongoose";
const Schema = mongoose.Schema;

const UserSchema = new Schema({
  info: {
    username: {
      type: String,
      required: true,
      unique: true,
    },
    password: { type: String, required: true },
    firstname: { type: String, required: true },
    lastname: { type: String, required: true },
    email: {
      type: String,
      // match: /(?:[a-z0-9!#$%&'*+/=?^_`{|}~-]+(?:\.[a-z0-9!#$%&'*+/=?^_`{|}~-]+)*|"(?:[\x01-\x08\x0b\x0c\x0e-\x1f\x21\x23-\x5b\x5d-\x7f]|\\[\x01-\x09\x0b\x0c\x0e-\x7f])*")@(?:(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z0-9](?:[a-z0-9-]*[a-z0-9])?|\[(?:(?:(2(5[0-5]|[0-4][0-9])|1[0-9][0-9]|[1-9]?[0-9]))\.){3}(?:(2(5[0-5]|[0-4][0-9])|1[0-9][0-9]|[1-9]?[0-9])|[a-z0-9-]*[a-z0-9]:(?:[\x01-\x08\x0b\x0c\x0e-\x1f\x21-\x5a\x53-\x7f]|\\[\x01-\x09\x0b\x0c\x0e-\x7f])+)\])/,
      required: true,
    },
    dob: { type: Date, required: false },
  },

  friends: [{ type: Schema.Types.ObjectId, ref: "user" }],

  chat: { type: Schema.Types.ObjectId, ref: "chat" },
  schoolPlanner: {
    courses: [
      {
        course_name: {},
        course_component: {},
        course_dayAndTime: [],
        course_year: {},
        course_term: {},
        course_class: {},
        course_status: {},
        course_instructors: [],
        course_grade: {},
        course_fullGrade: {},
        course_exams: [],
        course_length: {},
        course_progress: {},
        course_partOfPlan: {},
        exam_type: {},
        exam_date: {},
        exam_time: {},
      },
    ],
    lectures: [
      {
        lecture_name: {},
        lecture_course: {},
        lecture_instructor: {},
        lecture_writer: {},
        lecture_date: {},
        lecture_length: {},
        lecture_progress: {},
        lecture_pagesFinished: [],
        lecture_outlines: [],
        lecture_partOfPlan: {},
        lecture_hidden: {},
      },
    ],
  },
  study: {
    inMemory: {
      units: [],
      dataTypes: [],
      sets: [],
    },
    propertyObjects: [
      {
        propertyName: {},
        propertyLevel: {},
        propertyDataType: {},
        propertyDomain: {},
        propertyUnit: {},
      },
    ],
    functionNatures: [
      {
        name: {},
      },
    ],
    functionCodes: [
      {
        name: {},
      },
    ],
    changeFactors: [
      {
        name: {},
      },
    ],
    structure_keywords: [
      {
        keyword_structureName: {},
        keyword_structureSource: {},
        keyword_structureStatus: {},
        keyword_structureLevel: {},
        keyword_structureProperties: [],
      },
    ],
    function_keywords: [
      {
        keyword_functionName: {},
        keyword_functionNature: {},
        keyword_functionCode: [],
      },
    ],
    statements: [
      {
        statement_subjectProperty: {},
        statement_verb: {},
        statement_objectProperty: {},
      },
    ],
  },
  status: {
    isConnected: { type: Boolean, default: false },
  },
  notifications: [
    {
      id: { type: String, required: true },
      message: { type: String, required: true },
      status: { type: String, default: "unread" },
    },
  ],
  posts: [{ type: Schema.Types.ObjectId, ref: "posts" }],
  terminology: [
    {
      term: { type: String, required: true },
      meaning: { type: String, required: true },
      category: { type: String, required: true },
      subject: { type: String, required: true },
      date: { type: Date, default: Date.now() },
    },
  ],
  study_session: [
    {
      date: { type: Date, required: true },
      length: { type: Object, required: true },
    },
  ],
  login_record: [
    {
      loggedInAt: { type: Date, required: true, default: Date.now },
    },
  ],
  clinicalReality: {
    html: { type: String, default: "" },
    updatedAt: { type: Date, default: null },
  },
});
const UserModel = mongoose.model("user", UserSchema);
export default UserModel;
