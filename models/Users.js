import mongoose from "mongoose";
const Schema = mongoose.Schema;

const UserSchema = new Schema({
  identity: {
    atSignup: {
      username: {
        type: String,
        required: true,
        unique: true,
      },
      password: { type: String, required: true },
    },
    personal: {
      firstname: { type: String, required: true },
      lastname: { type: String, required: true },
      dob: { type: Date, required: true },
      email_address: { type: String, required: true },
      program: { type: String, default: "" },
      university: { type: String, default: "" },
      studyYear: { type: String, default: "" },
      term: { type: String, default: "" },
      gallery: {
        images: [
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
        videos: [],
        audios: [],
        documents: [],
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
          updatedAt: { type: Date, default: null },
        },
      },
      profilePicture: {
        picture: {
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
      },
    },
    status: {
      isLoggedIn: { type: Boolean, default: false },
      listeningToMusic: { type: Boolean, default: false },
      whichComponentIsActive: { type: String, default: "" },
      lastSeenAt: { type: Date, default: null },
      loggedInAt: { type: Date, required: true, default: Date.now },
      loggedOutAt: { type: Date, default: null },
    },
  },
  notifications: [
    {
      id: { type: String, required: true },
      message: { type: String, required: true },
      type: {
        type: String,
        enum: ["friend_request", "message", "alert"],
        required: true,
      },
      status: { type: String, enum: ["unread", "read"], default: "unread" },
    },
  ],
  memory: {
    courses: [
      {
        name: {},
        components: [
          {
            info: {
              name: {},
              date: { start: {}, end: {} },
              schedule: [{ day: {}, time: {} }],
              year: {},
              term: {},
              status: {},
              instructors: [],
              weight: {},
              grade: {},
              volume: {},
              progress: {},
              creationNote: {
                type: String,
                enum: ["manual", "accepted", "conceptualized", "rejected"],
              },
            },
            exams: [
              {
                exam_schedule: { date: {}, time: {} },
                exam_weight: {},
                exam_grade: {},
                creationNote: {
                  type: String,
                  enum: ["manual", "accepted", "conceptualized", "rejected"],
                },
              },
            ],
          },
        ],
      },
    ],
    lectures: [
      {
        name: {},
        course: {},
        component: {},
        instructor: {},
        writer: {},
        publishDate: {},
        volume: { finished: {}, total: {} },
        corrections: [],
        ai: [{ question: {}, answer: {} }],
        creationNote: {
          type: String,
          enum: ["manual", "accepted", "conceptualized", "rejected"],
        },
      },
    ],
    instructors: [
      {
        name: {},
        university: {},
        courses: [
          {
            name: {},
            components: [{ name: {}, lectures: [{ name: {}, volume: {} }] }],
          },
        ],
        personality: {},
        creationNote: {
          type: String,
          enum: ["manual", "accepted", "conceptualized", "rejected"],
        },
      },
    ],
    telegram: {
      groups: {
        info: {
          name: { type: String, default: "" },
          groupReference: { type: String, default: "" },
          memberCount: { type: Number, default: 0 },
          description: { type: String, default: "" },
          messageCount: { type: Number, default: 0 },
        },
        content: [
          {
            texts: [],
            photos: [],
            videos: [],
            audios: [],
            documents: [],
          },
        ],
      },
    },
    mediaOCR: [
      {
        source: {
          groupReference: { type: String, default: "" },
          messageId: { type: Number, default: 0 },
          attachmentFileName: { type: String, default: "" },
          sourceType: { type: String, default: "" }, // photo, pdf, video-frame, document
          page: { type: Number, default: 0 },
          frame: { type: Number, default: 0 },
          url: { type: String, default: "" },
        },
        ocr: {
          rawText: { type: String, default: "" },
          normalizedText: { type: String, default: "" },
          language: { type: String, default: "en" },
          confidence: { type: Number, default: 0 },
          blocks: [
            {
              text: { type: String, default: "" },
              confidence: { type: Number, default: 0 },
            },
          ],
        },
        quality: {
          readable: { type: Boolean, default: true },
          issues: [{ type: String, default: "" }], // blurry, cropped, duplicate, rotated
        },
        ai: {
          conceptualized: { type: Boolean, default: false },
          conceptIds: [{ type: String, default: "" }],
          lastConceptualizedAt: { type: Date, default: null },
        },
        createdAt: { type: Date, default: Date.now },
      },
    ],
  },
  AI: {
    settings: {
      aiProvider: { type: String, default: "openai" },
      languageOfReply: { type: String, default: "english" },
      inputType: { type: String, default: "text" }, // text, voice, image
      outputType: { type: String, default: "text" }, // text, voice, image
    },
  },
  telegram: {
    status: {
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
  },
  friends: [{ type: Schema.Types.ObjectId, ref: "user" }],
  chat: [
    {
      from: { type: String, required: true },
      status: { type: String, enum: ["isTyping", "inChat"] },
      body: {
        message: { type: String, required: true },
        date: { type: Date, default: Date.now },
        status: {
          type: String,
          enum: ["sent", "delivered", "read", "deleted", "edited"],
          default: "sent",
        },
      },
    },
  ],
  // clinicalReality: {
  //   html: { type: String, default: "" },
  //   updatedAt: { type: Date, default: null },
  // },
});
const UserModel = mongoose.model("user", UserSchema);
export default UserModel;
