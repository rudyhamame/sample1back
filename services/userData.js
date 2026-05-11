import mongoose from "mongoose";
import UserModel from "../compat/UserModel.js";
import { normalizeStudyOrganizerSettings } from "../models/MOI/StudyPlanner/StudyOrganizer/settings.js";
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
  normalizedStudyOrganizer.settings = normalizeStudyOrganizerSettings(
    normalizedStudyOrganizer?.settings,
  );
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

const resolveTelegramMemorySource = (memory = {}) => {
  if (memory?.telegram && typeof memory.telegram === "object") {
    return memory.telegram;
  }
  const moaEntries = Array.isArray(memory?.MOA)
    ? memory.MOA
    : [];
  const traceTelegram =
    moaEntries.find((entry) => entry?.telegram && typeof entry.telegram === "object")
      ?.telegram || null;
  return traceTelegram || {};
};

const mergeTelegramIntoTraces = (memory = {}, normalizedTelegram = {}) => {
  const traces = Array.isArray(memory?.MOA)
    ? cloneValue(memory.MOA)
    : [];
  const traceIndex = traces.findIndex(
    (entry) => entry?.telegram && typeof entry.telegram === "object",
  );

  if (traceIndex >= 0) {
    traces[traceIndex] = {
      ...(traces[traceIndex] && typeof traces[traceIndex] === "object"
        ? traces[traceIndex]
        : {}),
      telegram: cloneValue(normalizedTelegram),
    };
    return traces;
  }

  traces.push({
    telegram: cloneValue(normalizedTelegram),
  });
  return traces;
};

const resolveStudyPlannerSource = (memory = {}) => {
  if (memory?.studyPlanner && typeof memory.studyPlanner === "object") {
    return memory.studyPlanner;
  }
  const moiEntries = Array.isArray(memory?.MOI) ? memory.MOI : [];
  const plannerFromMoi =
    moiEntries.find(
      (entry) => entry?.studyPlanner && typeof entry.studyPlanner === "object",
    )?.studyPlanner || null;
  return plannerFromMoi || {};
};

const mergeStudyPlannerIntoMoi = (memory = {}, studyPlanner = {}) => {
  const moiEntries = Array.isArray(memory?.MOI) ? cloneValue(memory.MOI) : [];
  if (moiEntries.length === 0) {
    return [{ studyPlanner: cloneValue(studyPlanner) }];
  }
  const first = moiEntries[0] && typeof moiEntries[0] === "object" ? moiEntries[0] : {};
  moiEntries[0] = {
    ...first,
    studyPlanner: cloneValue(studyPlanner),
  };
  return moiEntries;
};

const normalizeMemoryPayload = (memory) => {
  const sourceMemory =
    memory && typeof memory?.toObject === "function" ? memory.toObject() : memory;
  const normalizedTelegram = normalizeTelegramMemory(
    resolveTelegramMemorySource(sourceMemory),
  );
  const sourceStudyPlanner = resolveStudyPlannerSource(sourceMemory);
  const studyPlanner =
    sourceStudyPlanner && typeof sourceStudyPlanner === "object"
      ? {
          studyOrganizer:
            sourceStudyPlanner?.studyOrganizer &&
            typeof sourceStudyPlanner.studyOrganizer === "object"
              ? normalizeStudyOrganizerStatuses(sourceStudyPlanner.studyOrganizer)
              : memory?.studyOrganizer && typeof memory.studyOrganizer === "object"
                ? normalizeStudyOrganizerStatuses(memory.studyOrganizer)
                : {},
          studyPlanAid:
            sourceStudyPlanner?.studyPlanAid &&
            typeof sourceStudyPlanner.studyPlanAid === "object"
              ? cloneValue(sourceStudyPlanner.studyPlanAid)
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
        };

  return {
    MOA: mergeTelegramIntoTraces(sourceMemory, normalizedTelegram),
    MOI: mergeStudyPlannerIntoMoi(sourceMemory, studyPlanner),
  };
};

class EmbeddedMemoryDocument {
  constructor(user) {
    this._user = user;
    const normalizedPayload = normalizeMemoryPayload(user?.memory);
    Object.assign(this, normalizedPayload);
    this.telegram = normalizeTelegramMemory(resolveTelegramMemorySource(user?.memory));
    this.studyPlanner = resolveStudyPlannerSource(normalizedPayload);
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
    !Array.isArray(user?.memory?.MOA) ||
    !Array.isArray(user?.memory?.MOI) ||
    currentMemoryKeys.some(
      (key) =>
        ![
          "MOA",
          "MOI",
          "studyOrganizer",
          "studyPlanAid",
        ].includes(key),
    );

  if (needsInitialization) {
    user.memory = normalizedMemory;
    await user.save();
  }

  return new EmbeddedMemoryDocument(user);
};

export const buildUserMemoryLean = (
  memory,
  { includeCourses = true, includeLectures = true } = {},
) => {
  const normalizedMemory = normalizeMemoryPayload(memory);
  const studyPlanner = resolveStudyPlannerSource(normalizedMemory);
  const plannerCourses = Array.isArray(
    studyPlanner?.studyOrganizer?.courses,
  )
    ? studyPlanner.studyOrganizer.courses
    : [];

  return {
    ...normalizedMemory,
    studyPlanner,
    courses: includeCourses
      ? flattenMemoryCoursesForPlanner(plannerCourses)
      : [],
    lectures: includeLectures
      ? flattenMemoryLecturesForPlanner(plannerCourses)
      : [],
  };
};

export const findUserMemoryLean = async (
  userId,
  { includeCourses = true, includeLectures = true } = {},
) => {
  if (!userId) {
    return null;
  }

  const user = await UserModel.findById(userId).select("memory");
  if (!user) {
    return null;
  }

  return buildUserMemoryLean(user.memory, {
    includeCourses,
    includeLectures,
  });
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
