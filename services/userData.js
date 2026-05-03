import mongoose from "mongoose";
import UserModel from "../compat/UserModel.js";
import AiSettingsModel from "../compat/AiSettingsModel.js";
import TelegramSettingsModel from "../compat/TelegramSettingsModel.js";
import {
  flattenMemoryCoursesForPlanner,
  flattenMemoryLecturesForPlanner,
} from "../routes/user/helpers/studyPlannerService.js";

const { Types } = mongoose;

const normalizeObjectIdLikeValue = (value) => {
  if (value === null || value === undefined || value === "") {
    return value;
  }

  if (value instanceof Types.ObjectId) {
    return new Types.ObjectId(value.toHexString());
  }

  const normalizedString = String(value || "").trim();
  if (normalizedString && Types.ObjectId.isValid(normalizedString)) {
    return new Types.ObjectId(normalizedString);
  }

  const rawBuffer =
    value?.buffer && typeof value.buffer === "object" ? value.buffer : null;
  if (!rawBuffer) {
    return null;
  }

  const orderedBytes = Object.keys(rawBuffer)
    .sort((left, right) => Number(left) - Number(right))
    .map((key) => Number(rawBuffer[key]))
    .filter((byte) => Number.isInteger(byte) && byte >= 0 && byte <= 255);

  if (orderedBytes.length !== 12) {
    return null;
  }

  try {
    return new Types.ObjectId(Buffer.from(orderedBytes));
  } catch {
    return null;
  }
};

const toPlainValue = (value) => {
  if (Array.isArray(value)) {
    return value.map((item) => toPlainValue(item));
  }

  if (value instanceof Date) {
    return new Date(value.getTime());
  }

  const normalizedObjectId = normalizeObjectIdLikeValue(value);
  if (normalizedObjectId) {
    return normalizedObjectId;
  }

  if (value && typeof value?.toObject === "function") {
    return toPlainValue(value.toObject());
  }

  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, nestedValue]) => [
        key,
        toPlainValue(nestedValue),
      ]),
    );
  }

  return value;
};

const cloneValue = (value) => JSON.parse(JSON.stringify(toPlainValue(value)));

const normalizePlannerComponentStatus = (value) => {
  const normalizedValue = String(value || "").trim().toLowerCase();
  const aliases = {
    new: "new",
    failed: "failed",
    passed: "passed",
    "not started": "new",
    "in progress": "new",
    completed: "passed",
  };

  return aliases[normalizedValue] || "new";
};

const normalizePlannerCourseStatus = (value) => {
  const normalizedValue = String(value || "").trim().toLowerCase();
  const aliases = {
    new: "new",
    failed: "failed",
    incomplete: "incomplete",
    passed: "passed",
    "not started": "new",
    "in progress": "incomplete",
    completed: "passed",
  };

  return aliases[normalizedValue] || "new";
};

const normalizeStudyOrganizerStatuses = (studyOrganizer) => {
  if (!studyOrganizer || typeof studyOrganizer !== "object") {
    return {};
  }

  const normalizedStudyOrganizer = cloneValue(studyOrganizer);
  normalizedStudyOrganizer.courses = (Array.isArray(normalizedStudyOrganizer.courses)
    ? normalizedStudyOrganizer.courses
    : []
  ).map((course) => {
    if (!course || typeof course !== "object") {
      return course;
    }

    return {
      ...course,
      status: normalizePlannerCourseStatus(course.status),
      components: (Array.isArray(course.components) ? course.components : []).map(
        (component) => ({
          ...component,
          status: normalizePlannerComponentStatus(component?.status),
        }),
      ),
    };
  });

  return normalizedStudyOrganizer;
};

const normalizeTelegramMemory = (telegram) => {
  const groups = telegram?.groups;
  const info = groups?.info;
  const contentEntries = Array.isArray(groups?.content) ? groups.content : [];
  const predictions =
    telegram?.predictions && typeof telegram.predictions === "object"
      ? cloneValue(telegram.predictions)
      : {};

  return {
    groups: {
      info: {
        name: typeof info?.name === "string" ? info.name : "",
        groupReference:
          typeof info?.groupReference === "string" ? info.groupReference : "",
        memberCount:
          typeof info?.memberCount === "number" && Number.isFinite(info.memberCount)
            ? info.memberCount
            : 0,
        description:
          typeof info?.description === "string" ? info.description : "",
        messageCount:
          typeof info?.messageCount === "number" && Number.isFinite(info.messageCount)
            ? info.messageCount
            : 0,
        pageUrl: typeof info?.pageUrl === "string" ? info.pageUrl : "",
      },
      content: (contentEntries.length > 0 ? contentEntries : [{}]).map((entry) => ({
        texts: Array.isArray(entry?.texts) ? cloneValue(entry.texts) : [],
        photos: Array.isArray(entry?.photos) ? cloneValue(entry.photos) : [],
        images: Array.isArray(entry?.images) ? cloneValue(entry.images) : [],
        videos: Array.isArray(entry?.videos) ? cloneValue(entry.videos) : [],
        audios: Array.isArray(entry?.audios) ? cloneValue(entry.audios) : [],
        documents: Array.isArray(entry?.documents) ? cloneValue(entry.documents) : [],
      })),
    },
    predictions,
  };
};

const normalizeMemoryPayload = (memory) => ({
  traces: Array.isArray(memory?.traces) ? cloneValue(memory.traces) : [],
  studyPlanner:
    memory?.studyPlanner && typeof memory.studyPlanner === "object"
      ? {
          studyOrganizer:
            memory?.studyPlanner?.studyOrganizer &&
            typeof memory.studyPlanner.studyOrganizer === "object"
              ? normalizeStudyOrganizerStatuses(memory.studyPlanner.studyOrganizer)
              : memory?.studyOrganizer && typeof memory.studyOrganizer === "object"
                ? normalizeStudyOrganizerStatuses(memory.studyOrganizer)
                : {},
          studyPlanAid:
            memory?.studyPlanner?.studyPlanAid &&
            typeof memory.studyPlanner.studyPlanAid === "object"
              ? cloneValue(memory.studyPlanner.studyPlanAid)
              : memory?.studyPlanAid && typeof memory.studyPlanAid === "object"
                ? cloneValue(memory.studyPlanAid)
                : {},
        }
      : {
          studyOrganizer:
            memory?.studyOrganizer && typeof memory.studyOrganizer === "object"
              ? normalizeStudyOrganizerStatuses(memory.studyOrganizer)
              : {},
          studyPlanAid:
            memory?.studyPlanAid && typeof memory.studyPlanAid === "object"
              ? cloneValue(memory.studyPlanAid)
              : {},
        },
  telegram:
    memory?.telegram && typeof memory.telegram === "object"
      ? normalizeTelegramMemory(memory.telegram)
      : normalizeTelegramMemory({}),
});

class EmbeddedMemoryDocument {
  constructor(user) {
    this._user = user;
    Object.assign(this, normalizeMemoryPayload(user?.memory));
  }

  toObject() {
    const { _user, ...rest } = this;
    return cloneValue(rest);
  }

  async save() {
    if (!this._user) {
      return this;
    }

    this._user.memory = normalizeMemoryPayload(this);
    await this._user.save();
    return this;
  }
}

export const ensureUserMemoryDoc = async (user) => {
  if (!user?._id) {
    return null;
  }

  const normalizedMemory = normalizeMemoryPayload(user.memory);
  const currentMemoryKeys = Object.keys(
    user?.memory?.toObject?.() ||
      (user?.memory && typeof user.memory === "object" ? user.memory : {}),
  ).filter((key) => key !== "_id");
  const needsInitialization =
    !user.memory ||
    typeof user.memory !== "object" ||
    !Array.isArray(user?.memory?.traces) ||
    currentMemoryKeys.some(
      (key) =>
        ![
          "traces",
          "studyPlanner",
          "studyOrganizer",
          "studyPlanAid",
          "telegram",
        ].includes(key),
    );

  if (needsInitialization) {
    user.memory = normalizedMemory;
    await user.save();
  }

  return new EmbeddedMemoryDocument(user);
};

export const findUserMemoryLean = async (userId) => {
  if (!userId) {
    return null;
  }

  const user = await UserModel.findById(userId).select("memory");
  if (!user) {
    return null;
  }

  const normalizedMemory = normalizeMemoryPayload(user.memory);
  const plannerCourses = Array.isArray(
    normalizedMemory?.studyPlanner?.studyOrganizer?.courses,
  )
    ? normalizedMemory.studyPlanner.studyOrganizer.courses
    : [];
  const plannerExams = Array.isArray(
    normalizedMemory?.studyPlanner?.studyOrganizer?.exams,
  )
    ? normalizedMemory.studyPlanner.studyOrganizer.exams
    : [];

  return {
    ...normalizedMemory,
    courses: flattenMemoryCoursesForPlanner(plannerCourses, plannerExams),
    lectures: flattenMemoryLecturesForPlanner(plannerCourses),
  };
};

export const findAiSettingsLean = async (subjectId, select = "") => {
  const query = AiSettingsModel.findOne({ subject: subjectId });
  if (select) {
    query.select(select);
  }
  return query.lean();
};

export const upsertAiSettings = async (subjectId, settings = {}) =>
  AiSettingsModel.findOneAndUpdate(
    { subject: subjectId },
    {
      $set: Object.fromEntries(
        Object.entries(settings).map(([key, value]) => [`settings.${key}`, value]),
      ),
      $setOnInsert: { subject: subjectId },
    },
    { upsert: true },
  );

export const findTelegramSettings = async (userId) =>
  TelegramSettingsModel.findOne({ user: userId });

export const findTelegramSettingsLean = async (userId) =>
  TelegramSettingsModel.findOne({ user: userId }).lean();
