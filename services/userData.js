import mongoose from "mongoose";
import UserModel from "../compat/UserModel.js";
import AiSettingsModel from "../compat/AiSettingsModel.js";
import TelegramSettingsModel from "../compat/TelegramSettingsModel.js";

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

const normalizeMemoryPayload = (memory) => ({
  traces: Array.isArray(memory?.traces) ? cloneValue(memory.traces) : [],
  studyPlanner:
    memory?.studyPlanner && typeof memory.studyPlanner === "object"
      ? {
          studyOrganizer:
            memory?.studyPlanner?.studyOrganizer &&
            typeof memory.studyPlanner.studyOrganizer === "object"
              ? cloneValue(memory.studyPlanner.studyOrganizer)
              : memory?.studyOrganizer && typeof memory.studyOrganizer === "object"
                ? cloneValue(memory.studyOrganizer)
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
              ? cloneValue(memory.studyOrganizer)
              : {},
          studyPlanAid:
            memory?.studyPlanAid && typeof memory.studyPlanAid === "object"
              ? cloneValue(memory.studyPlanAid)
              : {},
        },
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
        !["traces", "studyPlanner", "studyOrganizer", "studyPlanAid"].includes(key),
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

  return normalizeMemoryPayload(user.memory);
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
