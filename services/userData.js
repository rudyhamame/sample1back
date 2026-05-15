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
  const rawGroups = Array.isArray(telegram?.groups)
    ? telegram.groups
    : telegram?.groups && typeof telegram.groups === "object"
      ? [telegram.groups]
      : [];
  const predictions =
    telegram?.predictions && typeof telegram.predictions === "object"
      ? cloneValue(telegram.predictions)
      : {};

  return {
    groups: rawGroups.map((groupEntry) => {
      const group =
        groupEntry && typeof groupEntry === "object" ? groupEntry : {};
      const info =
        group?.info && typeof group.info === "object" ? group.info : {};
      const contentEntry = Array.isArray(group?.content)
        ? group.content[0] || {}
        : group?.content && typeof group.content === "object"
          ? group.content
          : {};

      return {
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
        content: {
          texts: Array.isArray(contentEntry?.texts) ? cloneValue(contentEntry.texts) : [],
          photos: Array.isArray(contentEntry?.photos) ? cloneValue(contentEntry.photos) : [],
          images: Array.isArray(contentEntry?.images) ? cloneValue(contentEntry.images) : [],
          videos: Array.isArray(contentEntry?.videos) ? cloneValue(contentEntry.videos) : [],
          audios: Array.isArray(contentEntry?.audios) ? cloneValue(contentEntry.audios) : [],
          documents: Array.isArray(contentEntry?.documents) ? cloneValue(contentEntry.documents) : [],
          messages: Array.isArray(contentEntry?.messages) ? cloneValue(contentEntry.messages) : [],
        },
      };
    }),
    predictions,
  };
};

const resolveTelegramMemorySource = (memory = {}) => {
  if (memory?.telegram && typeof memory.telegram === "object") {
    return memory.telegram;
  }
  const moaObject =
    memory?.MOA && typeof memory.MOA === "object" && !Array.isArray(memory.MOA)
      ? memory.MOA
      : null;
  if (moaObject?.telegram && typeof moaObject.telegram === "object") {
    return moaObject.telegram;
  }
  const moaEntries = Array.isArray(memory?.MOA) ? memory.MOA : [];
  const traceTelegram =
    moaEntries.find((entry) => entry?.telegram && typeof entry.telegram === "object")
      ?.telegram || null;
  return traceTelegram || {};
};

const mergeTelegramIntoTraces = (memory = {}, normalizedTelegram = {}) => {
  const moaObject =
    memory?.MOA && typeof memory.MOA === "object" && !Array.isArray(memory.MOA)
      ? cloneValue(memory.MOA)
      : Array.isArray(memory?.MOA)
        ? cloneValue(memory.MOA).find((entry) => entry && typeof entry === "object") || {}
        : {};
  return {
    ...moaObject,
    telegram: cloneValue(normalizedTelegram),
  };
};

const resolveStudyPlannerSource = (memory = {}) => {
  if (memory?.studyPlanner && typeof memory.studyPlanner === "object") {
    return memory.studyPlanner;
  }
  const moiObject =
    memory?.MOI && typeof memory.MOI === "object" && !Array.isArray(memory.MOI)
      ? memory.MOI
      : null;
  if (moiObject?.studyPlanner && typeof moiObject.studyPlanner === "object") {
    return moiObject.studyPlanner;
  }
  const legacyMoiEntries = Array.isArray(memory?.MOI) ? memory.MOI : [];
  const plannerFromMoi =
    legacyMoiEntries.find(
      (entry) => entry?.studyPlanner && typeof entry.studyPlanner === "object",
    )?.studyPlanner || null;
  return plannerFromMoi || {};
};

const mergeStudyPlannerIntoMoi = (memory = {}, studyPlanner = {}) => {
  const nextStudyPlanner = cloneValue(studyPlanner);
  const moiObject =
    memory?.MOI && typeof memory.MOI === "object" && !Array.isArray(memory.MOI)
      ? cloneValue(memory.MOI)
      : {};
  if (Object.keys(moiObject).length > 0) {
    return {
      ...moiObject,
      studyPlanner: nextStudyPlanner,
    };
  }
  const legacyMoiEntries = Array.isArray(memory?.MOI) ? cloneValue(memory.MOI) : [];
  const firstLegacyEntry =
    legacyMoiEntries.find((entry) => entry && typeof entry === "object") || {};
  return {
    ...firstLegacyEntry,
    studyPlanner: nextStudyPlanner,
  };
};

const hasLegacyOnlyMemoryKeys = (memoryObject = {}) =>
  Object.keys(memoryObject).filter((key) => key !== "_id").some(
    (key) =>
      ![
        "MOA",
        "MOI",
        "studyOrganizer",
        "studyPlanAid",
      ].includes(key),
  );

const isMoiInitialized = (memoryObject = {}) => {
  const moiObject = memoryObject?.MOI;
  if (moiObject && typeof moiObject === "object" && !Array.isArray(moiObject)) {
    return true;
  }
  if (Array.isArray(moiObject)) {
    return false;
  }
  return false;
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
  const needsInitialization =
    !user.memory ||
    typeof user.memory !== "object" ||
    !user?.memory?.MOA ||
    typeof user.memory.MOA !== "object" ||
    Array.isArray(user.memory.MOA) ||
    !isMoiInitialized(user?.memory) ||
    hasLegacyOnlyMemoryKeys(
      user?.memory?.toObject?.() ||
        (user?.memory && typeof user.memory === "object" ? user.memory : {}),
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
