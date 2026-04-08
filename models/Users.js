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
    program: { type: String, default: "" },
    university: { type: String, default: "" },
    studyYear: { type: String, default: "" },
    term: { type: String, default: "" },
    aiProvider: { type: String, default: "openai" },
  },

  friends: [{ type: Schema.Types.ObjectId, ref: "user" }],

  chat: { type: Schema.Types.ObjectId, ref: "chat" },
  schoolPlanner: {
    ringVideo: {
      url: { type: String, default: "" },
      publicId: { type: String, default: "" },
      folder: { type: String, default: "" },
      updatedAt: { type: Date, default: null },
    },
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
        lecture_corrections: [],
        lecture_partOfPlan: {},
        lecture_hidden: {},
      },
    ],
    telegramCourseSuggestions: [
      {
        groupReference: { type: String, default: "" },
        groupTitle: { type: String, default: "" },
        savedAt: { type: Date, default: Date.now },
        analyzedMessagesCount: { type: Number, default: 0 },
        searchedKeys: [],
        suggestions: [],
      },
    ],
    telegramCourseSuggestionFeedback: [
      {
        groupReference: { type: String, default: "" },
        groupTitle: { type: String, default: "" },
        decision: { type: String, default: "" },
        savedAt: { type: Date, default: Date.now },
        suggestionKey: { type: String, default: "" },
        duplicateKey: { type: String, default: "" },
        confidence: { type: Number, default: 0 },
        reasons: [],
        matchedKeys: [],
        sourceMessageIds: [],
        coursePayload: {},
      },
    ],
    telegramCourseSuggestionAccepted: [
      {
        groupReference: { type: String, default: "" },
        groupTitle: { type: String, default: "" },
        sourceMessageId: { type: Number, default: null },
        sourceAttachmentFileName: { type: String, default: "" },
        decision: { type: String, default: "accepted" },
        savedAt: { type: Date, default: Date.now },
        suggestionKey: { type: String, default: "" },
        duplicateKey: { type: String, default: "" },
        confidence: { type: Number, default: 0 },
        reasons: [],
        matchedKeys: [],
        sourceMessageIds: [],
        courseArabic: {},
        courseEnglish: {},
        coursePayload: {},
      },
    ],
    telegramLectureSuggestions: [{}],
    telegramLectureSuggestionFeedback: [{}],
    telegramLectureSuggestionAccepted: [{}],
    telegramInstructorSuggestions: [{}],
    telegramInstructorSuggestionFeedback: [{}],
    telegramInstructorSuggestionAccepted: [{}],
  },
  media: {
    profilePicture: {
      url: { type: String, default: "" },
      publicId: { type: String, default: "" },
      assetId: { type: String, default: "" },
      updatedAt: { type: Date, default: null },
    },
    profilePictureViewport: {
      scale: { type: Number, default: 1 },
      offsetX: { type: Number, default: 0 },
      offsetY: { type: Number, default: 0 },
      updatedAt: { type: Date, default: null },
    },
    homeDrawing: {
      draftPaths: [
        {
          paletteId: { type: String, default: "aurora" },
          stroke: { type: String, default: "" },
          glow: { type: String, default: "" },
          bulb: { type: String, default: "" },
          points: [
            {
              x: { type: Number, default: 0 },
              y: { type: Number, default: 0 },
            },
          ],
        },
      ],
      appliedPaths: [
        {
          paletteId: { type: String, default: "aurora" },
          stroke: { type: String, default: "" },
          glow: { type: String, default: "" },
          bulb: { type: String, default: "" },
          points: [
            {
              x: { type: Number, default: 0 },
              y: { type: Number, default: 0 },
            },
          ],
        },
      ],
      textItems: [
        {
          id: { type: String, default: "" },
          paletteId: { type: String, default: "aurora" },
          text: { type: String, default: "" },
          x: { type: Number, default: 0 },
          y: { type: Number, default: 0 },
        },
      ],
      updatedAt: { type: Date, default: null },
    },
    imageGallery: [
      {
        url: { type: String, default: "" },
        publicId: { type: String, default: "" },
        assetId: { type: String, default: "" },
        folder: { type: String, default: "" },
        resourceType: { type: String, default: "image" },
        mimeType: { type: String, default: "" },
        width: { type: Number, default: 0 },
        height: { type: Number, default: 0 },
        format: { type: String, default: "" },
        bytes: { type: Number, default: 0 },
        duration: { type: Number, default: 0 },
        createdAt: { type: Date, default: Date.now },
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
    lastSeenAt: { type: Date, default: null },
  },
  notifications: [
    {
      id: { type: String, required: true },
      message: { type: String, required: true },
      type: { type: String, default: "friend_request" },
      count: { type: Number, default: 1 },
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
      loggedOutAt: { type: Date, default: null },
    },
  ],
  clinicalReality: {
    html: { type: String, default: "" },
    updatedAt: { type: Date, default: null },
  },
  telegramIntegration: {
    pageUrl: { type: String, default: "" },
    groupReference: { type: String, default: "" },
    syncMode: { type: String, default: "live" },
    historyStartDate: { type: Date, default: null },
    historyEndDate: { type: Date, default: null },
    syncEnabled: { type: Boolean, default: false },
    historyImportedAt: { type: Date, default: null },
    lastSyncedAt: { type: Date, default: null },
    lastStoredMessageId: { type: Number, default: 0 },
    lastStoredMessageDate: { type: Date, default: null },
    lastSyncStatus: { type: String, default: "" },
    lastSyncReason: { type: String, default: "" },
    lastSyncMessage: { type: String, default: "" },
    lastSyncImportedCount: { type: Number, default: 0 },
    lastSyncError: { type: String, default: "" },
    lastSyncScannedCount: { type: Number, default: 0 },
    lastSyncNewestMessageDateSeen: { type: Date, default: null },
    lastSyncOldestMessageDateSeen: { type: Date, default: null },
    lastSyncOldestImportedMessageDate: { type: Date, default: null },
    lastSyncFirstSkippedBeforeStartDate: { type: Date, default: null },
    lastSyncReachedStartBoundary: { type: Boolean, default: false },
    apiIdEncrypted: { type: String, default: "" },
    apiHashEncrypted: { type: String, default: "" },
    stringSessionEncrypted: { type: String, default: "" },
    updatedAt: { type: Date, default: null },
  },
});
const UserModel = mongoose.model("user", UserSchema);
export default UserModel;
