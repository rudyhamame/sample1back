import mongoose from "mongoose";
import ConnectionsSchema from "./MOA/Connections.js";
import { MemorySchema } from "./Memory.js";
import SettingsSchema from "./Settings.js";

const { Schema } = mongoose;
const TRACE_KEYS = ["user", "telegram", "ai", "chat"];

const normalizeMoaOnSubject = (value) => {
  if (!Array.isArray(value)) {
    return value && typeof value === "object" ? value : {};
  }
  const traces = value.filter((entry) => entry && typeof entry === "object");
  if (traces.length === 0) {
    return {};
  }
  return traces.reduce((accumulator, traceEntry) => {
    TRACE_KEYS.forEach((traceKey) => {
      const currentValue = traceEntry?.[traceKey];
      if (currentValue === null || currentValue === undefined) {
        return;
      }
      if (typeof currentValue === "object" && !Array.isArray(currentValue)) {
        const previousValue =
          accumulator?.[traceKey] && typeof accumulator[traceKey] === "object"
            ? accumulator[traceKey]
            : {};
        accumulator[traceKey] = {
          ...previousValue,
          ...currentValue,
        };
        return;
      }
      accumulator[traceKey] = currentValue;
    });
    return accumulator;
  }, {});
};

const normalizeEmbeddedChatMessageBody = (value) => {
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return {
      text: String(value || "").trim(),
      audio: "",
      images: [],
      videos: [],
      documents: [],
    };
  }

  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {
      text: "",
      audio: "",
      images: [],
      videos: [],
      documents: [],
    };
  }

  return {
    text: String(value.text ?? value.message ?? "").trim(),
    audio: String(value.audio || "").trim(),
    images: (Array.isArray(value.images) ? value.images : [])
      .map((entry) => String(entry || "").trim())
      .filter(Boolean),
    videos: (Array.isArray(value.videos) ? value.videos : [])
      .map((entry) => String(entry || "").trim())
      .filter(Boolean),
    documents: (Array.isArray(value.documents) ? value.documents : [])
      .map((entry) => String(entry || "").trim())
      .filter(Boolean),
  };
};

const normalizeEmbeddedConnectionChats = (connections) => {
  if (!Array.isArray(connections)) {
    return;
  }

  connections.forEach((connection) => {
    if (connection?.messages !== undefined) {
      if (typeof connection.set === "function") {
        connection.set("messages", undefined);
      } else {
        delete connection.messages;
      }
    }

    const chatThreads = Array.isArray(connection?.chat) ? connection.chat : [];
    chatThreads.forEach((chatThread) => {
      const messages = Array.isArray(chatThread?.messages)
        ? chatThread.messages
        : [];
      messages.forEach((message) => {
        if (!message || typeof message !== "object") {
          return;
        }

        message.body = normalizeEmbeddedChatMessageBody(message.body);
      });
    });
  });
};

const pointOfTime = new Schema(
  {
    yearDate: { type: Number },
    yearNum: { type: Number, min: 1 },
    termNum: { type: Number, min: 1 },
  },
  { _id: false },
);

const ProgramModeTermSchema = new Schema(
  {
    year: { type: Number, default: null },
    order: { type: Number, default: null },
  },
  { _id: false },
);

const ProgramModeSchema = new Schema(
  {
    terms: { type: [ProgramModeTermSchema], default: [] },
  },
  { _id: false },
);

const profileEventsSchema = new Schema ({
  eventClass: {type: String, default: ""},
  eventTitle: {type: String, default: ""},
  studySessionID: {type: String, default: ""},
  eventBody: {
    eventText: {type: String, default: ""},
    eventImagesURLs: {type: [String], default: []},
    eventVideosURLs: {type: [String], default: []},
  },
  eventFooter: {
    eventDatePosted: {type: Date, default: ''},
    eventUserName: {
      firstName:{type: String, default: ""},
      lastName: {type: String, default: ""},
    },
  },
  eventReplies: [{
    eventReplyBody: {
    eventReplyText: {type: String, default: ""},
    eventReplyImagesURLs: {type: [String], default: []},
    eventReplyVideosURLs: {type: [String], default: []},
  },
  eventReplyFooter: {
    eventReplyDatePosted: {type: Date, default: ''},
    eventReplyUserName: {
      firstName:{type: String, default: ""},
      lastName: {type: String, default: ""},
    },
  },
  }],
});

// Profile Sub-Schema
const ProfileSchema = new Schema(
  {
    firstname: { type: String, default: "" },
    lastname: { type: String, default: "" },
    email: { type: String, default: "" },
    phone: { type: String, default: "" },
    dob: { type: Date, default: null },
    hometown: {
      Country: { type: String, default: "" },
      City: { type: String, default: "" },
    },
    working: {
      company: { type: String, default: "" },
      position: { type: String, default: "" },
    },
    bio: { type: String, default: "" },
    picture: {
      profilePic: {
        index: {
          url: { type: String, default: "" },
          publicId: { type: String, default: "" },
          mimeType: { type: String, default: "" },
          width: { type: Number, default: null },
          height: { type: Number, default: null },
        },
        viewport: {
          x: { type: Number, default: 0 },
          y: { type: Number, default: 0 },
          zoom: { type: Number, default: 1 },
          width: { type: Number, default: null },
          height: { type: Number, default: null },
        },
        wallpaper: {
          index: {
            url: { type: String, default: "" },
            publicId: { type: String, default: "" },
            mimeType: { type: String, default: "" },
            width: { type: Number, default: null },
            height: { type: Number, default: null },
          },
          viewport: {
            x: { type: Number, default: 0 },
            y: { type: Number, default: 0 },
            zoom: { type: Number, default: 1 },
            width: { type: Number, default: null },
            height: { type: Number, default: null },
          },
        },
      },
    },
    events: {type: [profileEventsSchema], default: []}
  },
  { _id: false },
); // _id: false prevents creating sub-document IDs


const SubjectsSchema = new Schema(
  {
    auth: {
      username: { type: String, default: "" },
      password: { type: String, default: "" },
    },
    profile: { type: ProfileSchema, default: () => ({}) },
    connections: { type: [ConnectionsSchema], default: [] },
    memory: MemorySchema,
    settings: { type: SettingsSchema, default: () => ({}) },
    status: {
      value: {
        type: String,
        enum: ["online", "offline", "studying", "busy"],
        default: "offline",
      },
      updatedAt: { type: Date, default: Date.now },
      lastSeenAt: { type: Date, default: null },
      loggedInAt: { type: Date, default: null },
      loggedOutAt: { type: Date, default: null },
    },
  },
  { strict: "throw" },
);

SubjectsSchema.index(
  { "auth.username": 1 },
  { name: "subjects_auth_username_idx" },
);

SubjectsSchema.index(
  { "profile.hometown.City": 1 },
  { name: "subjects_hometown_city_idx", sparse: true },
);

SubjectsSchema.pre("validate", function () {
  normalizeEmbeddedConnectionChats(this.connections);

  const profileStudying =
    this?.profile?.studying && typeof this.profile.studying === "object"
      ? this.profile.studying
      : null;
  if (profileStudying) {
    const totalModes = Number(profileStudying.programTotalModes);
    if (Number.isInteger(totalModes) && totalModes >= 1) {
      const currentModes = Array.isArray(profileStudying.programModes)
        ? profileStudying.programModes
        : [];
      profileStudying.programModes = Array.from(
        { length: totalModes },
        (_, index) => {
          const existingMode =
            currentModes[index] && typeof currentModes[index] === "object"
              ? currentModes[index]
              : {};
          const existingTerms = Array.isArray(existingMode.terms)
            ? existingMode.terms
                .map((termEntry) => ({
                  year:
                    termEntry?.year === null || termEntry?.year === undefined
                      ? null
                      : Number(termEntry.year),
                  order:
                    termEntry?.order === null || termEntry?.order === undefined
                      ? null
                      : Number(termEntry.order),
                }))
                .filter(
                  (termEntry) =>
                    termEntry.year === null ||
                    Number.isFinite(termEntry.year) ||
                    termEntry.order === null ||
                    Number.isFinite(termEntry.order),
                )
            : [];
          return {
            terms: existingTerms,
          };
        },
      );
    }
  }

  if (!this.memory || typeof this.memory !== "object") {
    return;
  }
  this.memory.MOA = normalizeMoaOnSubject(this.memory.MOA);
});

const SubjectsModel =
  mongoose.models.subjects || mongoose.model("subjects", SubjectsSchema);

export default SubjectsModel;
export { ProfileSchema };
