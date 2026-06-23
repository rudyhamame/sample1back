// --- Video Upload Route for /api/user/videoUpload ---
import multer from "multer";
import fs from "fs";
import compressVideo from "../helpers/compressVideo.js";
import { emitCompressionProgress } from "../helpers/progressSocket.js";
// ...existing code...
const upload = multer({ dest: "uploads/" });
//For user data
import OpenAI from "openai";
import express from "express";
import { execFileSync } from "child_process";
import crypto from "crypto";
import cloudinary from "../helpers/cloudinary.js";
import path from "path";
import { fileURLToPath } from "url";
import UserModel from "../compat/UserModel.js";
import VisitorsModel from "../models/Visitors.js";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import "dotenv/config";
import checkAuth from "../check-auth.js";
import { AccessToken } from "livekit-server-sdk";
import geoip from "geoip-lite";
import { emitUserRefresh } from "../helpers/realtime.js";
import { setUserConnectionState } from "../helpers/connectionStatus.js";
import {
  findAiSettingsLean,
  buildUserMemoryLean,
  findUserMemoryLean,
  ensureUserMemoryDoc,
  upsertAiSettings,
} from "../services/userData.js";
import {
  addComponentToPlanner,
  addCourseInfoToPlanner,
  addLectureToPlanner,
  flattenMemoryCoursesForPlanner,
  flattenMemoryLecturesForPlanner,
  getStudyPlanAid,
  recalculateCourseLectureTotals,
  removeCourseOrComponentFromPlanner,
  replaceCourseBundleInPlanner,
  removeLectureFromPlanner,
  repairStudyPlannerCourseIdsInPlanner,
  updateCourseInPlanner,
  updateCoursePagesInPlanner,
  updateStudyPlannerComponentsInPlanner,
  updateStudyPlannerMetaInPlanner,
  updateStudyPlannerProgramInPlanner,
  updateStudyPlannerIntervalsInPlanner,
  updateStudyPlannerIntervalStatusInPlanner,
  updateStudyPlannerCoursesInPlanner,
  updateStudyPlannerDocumentsInPlanner,
  updateStudyPlannerLecturesInPlanner,
  updateStudyPlannerStudySessionsInPlanner,
  updateStudyPlanAidInPlanner,
  updateLectureInPlanner,
  normalizeProgramComponentsForPlanner,
  normalizeProgramExamsForPlanner,
  normalizeProgramFailingRulesForPlanner,
} from "./user/helpers/studyPlannerService.js";
import {
  normalizePlannerSettingsFieldDefaults,
  normalizeStudyOrganizerSettings,
  removeHardcodedPlannerSelectOptions,
  resolvePlannerSelectOptionsKey,
  serializeStudyOrganizerSettingsForStorage,
} from "../models/MOI/StudyPlanner/StudyOrganizer/settings.js";

const plannerFieldDefaultsToEntries = (fieldDefaults = {}) =>
  Object.entries(
    fieldDefaults && typeof fieldDefaults === "object" ? fieldDefaults : {},
  ).flatMap(([programMode, fields]) =>
    Object.entries(fields && typeof fields === "object" ? fields : {}).map(
      ([field, value]) => ({
        programMode: String(programMode || "").trim(),
        field: String(field || "").trim(),
        value: String(value ?? "").trim(),
      }),
    ),
  ).filter((entry) => Boolean(entry.programMode) && Boolean(entry.field));

const mergePlannerFieldDefaults = (baseValue = {}, incomingValue = {}) => {
  const merged = normalizePlannerSettingsFieldDefaults(baseValue);
  const incoming = normalizePlannerSettingsFieldDefaults(incomingValue);
  return normalizePlannerSettingsFieldDefaults({
    ...merged,
    ...incoming,
    course: {
      ...(merged.course || {}),
      ...(incoming.course || {}),
    },
    components: {
      ...(merged.components || {}),
      ...(incoming.components || {}),
    },
    exams: {
      ...(merged.exams || {}),
      ...(incoming.exams || {}),
    },
    lectures: {
      ...(merged.lectures || {}),
      ...(incoming.lectures || {}),
    },
  });
};
const UserRouter = express.Router();
const resolveDefaultAiProvider = () => {
  const appProvider = String(process.env.APP_AI_PROVIDER || "")
    .trim()
    .toLowerCase();

  if (["openai", "groq", "gemini", "kimi"].includes(appProvider)) {
    return appProvider;
  }

  if (String(process.env.GROQ_API_KEY || "").trim()) {
    return "groq";
  }

  if (String(process.env.GEMINI_API_KEY || "").trim()) {
    return "gemini";
  }

  return "openai";
};

const getAiClientForProvider = (provider) => {
  if (provider === "groq") {
    const apiKey = String(process.env.GROQ_API_KEY || "").trim();
    if (!apiKey) return null;
    return new OpenAI({
      apiKey,
      baseURL: String(process.env.GROQ_BASE_URL || "").trim() || undefined,
    });
  }
  if (provider === "kimi") {
    const apiKey = String(process.env.MOONSHOT_API_KEY || process.env.KIMI_API_KEY || "").trim();
    if (!apiKey) return null;
    return new OpenAI({
      apiKey,
      baseURL:
        String(process.env.MOONSHOT_BASE_URL || process.env.KIMI_BASE_URL || "").trim() ||
        "https://api.moonshot.ai/v1",
    });
  }
  const apiKey = String(process.env.OPENAI_API_KEY || process.env.OPENAI_OFFICIAL_API_KEY || "").trim();
  if (!apiKey) return null;
  return new OpenAI({
    apiKey,
    baseURL: String(process.env.OPENAI_BASE_URL || "").trim() || undefined,
  });
};

const getAiModelForProvider = (provider) => {
  if (provider === "groq") return process.env.GROQ_MODEL || "llama-3.3-70b-versatile";
  if (provider === "kimi") return process.env.KIMI_MODEL || "kimi-k2.5";
  return process.env.OPENAI_OFFICIAL_MODEL || process.env.OPENAI_MODEL || "gpt-4o-mini";
};

const callAiCompletion = async (prompt, provider = resolveDefaultAiProvider()) => {
  const orderedProviders =
    provider !== resolveDefaultAiProvider()
      ? [provider, resolveDefaultAiProvider(), "groq", "openai"]
      : [provider, "groq", "openai"];
  const uniqueProviders = [...new Set(orderedProviders)];

  for (const p of uniqueProviders) {
    const client = getAiClientForProvider(p);
    if (!client) continue;
    const model = getAiModelForProvider(p);
    try {
      if (p === "kimi" || p === "groq") {
        const completion = await client.chat.completions.create({
          model,
          messages: [{ role: "user", content: prompt }],
        });
        return String(completion?.choices?.[0]?.message?.content || "").trim();
      }
      const response = await client.responses.create({
        model,
        instructions: "",
        input: prompt,
      });
      return String(response?.output_text || "").trim();
    } catch (_err) {
      continue;
    }
  }
  throw new Error("No AI provider available.");
};

const requireSelfParam = (paramName) => (req, res, next) => {
  const authenticatedUserId = String(req.authentication?.userId || "").trim();
  const paramValue = String(req.params?.[paramName] || "").trim();

  if (!authenticatedUserId) {
    return res.status(401).json({
      message: "Missing login session.",
    });
  }

  if (!paramValue) {
    return res.status(400).json({
      message: `Missing parameter: ${paramName}.`,
    });
  }

  if (authenticatedUserId !== paramValue) {
    return res.status(403).json({
      message: "You are not allowed to perform this action.",
    });
  }

  return next();
};

const SUPADATA_BASE_URL =
  String(process.env.SUPADATA_BASE_URL || "https://api.supadata.ai/v1").trim() ||
  "https://api.supadata.ai/v1";

const getSupadataApiKey = () => String(process.env.SUPADATA_API_KEY || "").trim();

const normalizeSupadataMode = (value = "") => {
  const normalizedValue = String(value || "").trim().toLowerCase();
  return ["native", "auto", "generate"].includes(normalizedValue)
    ? normalizedValue
    : "auto";
};

const buildSupadataUrl = (pathname = "/", query = {}) => {
  const nextUrl = new URL(pathname.replace(/^\/+/, ""), `${SUPADATA_BASE_URL}/`);
  Object.entries(query || {}).forEach(([key, value]) => {
    if (value === undefined || value === null || value === "") {
      return;
    }
    nextUrl.searchParams.set(key, String(value));
  });
  return nextUrl.toString();
};

const parseSupadataJsonResponse = async (response) => {
  const payload = await response.json().catch(() => null);

  if (response.ok) {
    return payload;
  }

  const message =
    String(payload?.details || payload?.message || "").trim() ||
    `Supadata request failed (${response.status}).`;
  const error = new Error(message);
  error.status = response.status;
  error.payload = payload;
  throw error;
};

const normalizeAcademicYearInterval = (value = "") => {
  const normalizedValue = String(value || "").trim();
  const match = normalizedValue.match(/^(\d{4})\s*(?:-|\/)\s*(\d{4})$/);

  if (!match) {
    return "";
  }

  return `${match[1]} - ${match[2]}`;
};

const normalizeMusicPlaylistEntry = (value = {}) => {
  if (!value || typeof value !== "object") {
    return null;
  }

  const provider = String(value.provider || "jamendo").trim().toLowerCase();
  const trackId = String(value.trackId || value.id || "").trim();
  const previewUrl = String(value.previewUrl || value.src || value.url || "").trim();
  const query = String(value.query || "").trim();
  const songName = String(
    value.songName || value.title || value.trackTitle || "",
  ).trim();
  const artist = String(value.artist || value.trackArtist || "").trim();

  if (provider !== "jamendo") {
    return null;
  }

  if (!trackId && !previewUrl && !query) {
    return null;
  }

  return {
    songName,
    artist,
    provider,
    trackId,
    previewUrl,
    query,
    addedAt: value.addedAt ? new Date(value.addedAt) : new Date(),
  };
};

const normalizeMusicPlaylistForStorage = (value = []) =>
  (Array.isArray(value) ? value : [])
    .map((entry) => normalizeMusicPlaylistEntry(entry))
    .filter(Boolean);

const normalizeProgramTermNumber = (value = "") => {
  const normalizedValue = String(value || "").trim();
  return ["First", "Second", "Third"].includes(normalizedValue)
    ? normalizedValue
    : "";
};

const normalizeProgramTermScheduleEntries = (value) =>
  (Array.isArray(value) ? value : [])
    .map((entry) => {
      const component_class = String(entry?.component_class || "").trim();
      const startDate = entry?.start_date ? new Date(entry.start_date) : null;
      const endDate = entry?.end_date ? new Date(entry.end_date) : null;
      return {
        component_class,
        start_date:
          startDate instanceof Date && !Number.isNaN(startDate.getTime())
            ? startDate
            : null,
        end_date:
          endDate instanceof Date && !Number.isNaN(endDate.getTime())
            ? endDate
            : null,
      };
    })
    .filter(
      (entry) =>
        entry.component_class || entry.start_date !== null || entry.end_date !== null,
    );

const normalizeComponentsClassList = (value) =>
  Array.from(
    new Set(
      (Array.isArray(value) ? value : [value])
        .map((entry) => String(entry || "").trim())
        .filter(Boolean),
    ),
  );

const getProgramTermPayload = (value, fallbackNumber = "") => {
  const rawValue =
    value && typeof value === "object" && !Array.isArray(value) ? value : {};
  const number = normalizeProgramTermNumber(
    rawValue?.number ?? value ?? fallbackNumber,
  );
  return {
    number: number || null,
    attendanceDate: normalizeProgramTermScheduleEntries(rawValue?.attendanceDate),
    examDate: normalizeProgramTermScheduleEntries(rawValue?.examDate),
  };
};

const getProgramTermNumber = (...candidates) => {
  for (const candidate of candidates) {
    const normalizedValue = normalizeProgramTermNumber(
      candidate && typeof candidate === "object" && !Array.isArray(candidate)
        ? candidate?.number
        : candidate,
    );
    if (normalizedValue) {
      return normalizedValue;
    }
  }
  return "";
};

const buildNormativeCourseYearIntervalFromProfile = (
  startProgramYearInterval = "",
  courseYearNum = "",
) => {
  const normalizedStartInterval = normalizeAcademicYearInterval(
    startProgramYearInterval,
  );
  const parsedCourseYearNum = Number(String(courseYearNum || "").trim());
  const startYearMatch = normalizedStartInterval.match(/^(\d{4})/);

  if (!startYearMatch || !Number.isFinite(parsedCourseYearNum)) {
    return "";
  }

  const nextStartYear =
    Number(startYearMatch[1]) + Math.max(Math.trunc(parsedCourseYearNum) - 1, 0);

  return `${nextStartYear} - ${nextStartYear + 1}`;
};

const withAutoNormativeCourseYearInterval = (user, payload = {}) => {
  const nextPayload =
    payload && typeof payload === "object" ? { ...payload } : {};
  const explicitInterval = normalizeAcademicYearInterval(
    nextPayload?.normativeCourseYearInterval || "",
  );
  if (explicitInterval) {
    nextPayload.normativeCourseYearInterval = explicitInterval;
    return nextPayload;
  }
  const generatedInterval = buildNormativeCourseYearIntervalFromProfile(
    user?.profile?.studying?.academicYearsIntervals?.first?.interval ||
      user?.profile?.studying?.time?.start?.programYearInterval ||
      "",
    nextPayload?.normativeCourseYearNum,
  );

  if (generatedInterval) {
    nextPayload.normativeCourseYearInterval = generatedInterval;
  }

  return nextPayload;
};

const withAutoActualCourseTimingFromProfile = (user, payload = {}) => {
  const nextPayload =
    payload && typeof payload === "object" ? { ...payload } : {};
  const currentStudyTime =
    user?.profile?.studying?.time?.current &&
    typeof user.profile.studying.time.current === "object"
      ? user.profile.studying.time.current
      : {};
  const currentStudyIntervals =
    user?.profile?.studying?.academicYearsIntervals?.current &&
    typeof user.profile.studying.academicYearsIntervals.current === "object"
      ? user.profile.studying.academicYearsIntervals.current
      : {};
  const normalizedCurrentYearNum = Number(
    String(currentStudyTime?.programYearNum ?? currentStudyIntervals?.num ?? "").trim(),
  );
  const normalizedCurrentYearInterval = normalizeAcademicYearInterval(
    currentStudyTime?.programYearInterval ||
      currentStudyIntervals?.interval ||
      "",
  );
  const normalizedCurrentProgramTerm = String(
    getProgramTermNumber(
      currentStudyTime?.programTerm || currentStudyIntervals?.term,
    ) ||
      "",
  ).trim();

  nextPayload.actualCourseYearNum = Number.isFinite(normalizedCurrentYearNum)
    ? normalizedCurrentYearNum
    : null;
  nextPayload.actualCourseYearInterval = normalizedCurrentYearInterval || "";
  nextPayload.actualCourseTerm = normalizedCurrentProgramTerm || "";
  nextPayload.course_year = normalizedCurrentYearInterval || "";
  nextPayload.academicYear = normalizedCurrentYearInterval || "";
  nextPayload.course_term = normalizedCurrentProgramTerm || "";
  nextPayload.term = normalizedCurrentProgramTerm || "";

  return nextPayload;
};

const sanitizeStudyOrganizerSettingsOnMemoryDoc = (memoryDoc) => {
  if (!memoryDoc || typeof memoryDoc !== "object") {
    return;
  }
  const currentSettings =
    memoryDoc?.studyPlanner?.settings &&
    typeof memoryDoc.studyPlanner.settings === "object"
      ? memoryDoc.studyPlanner.settings
      : {};
  const storedSettings = serializeStudyOrganizerSettingsForStorage(
    normalizeStudyOrganizerSettings(currentSettings),
  );
  memoryDoc.studyPlanner = memoryDoc.studyPlanner || {};
  memoryDoc.studyPlanner.settings = storedSettings;
};

const normalizePlannerOptionsSelectEntries = (value) =>
  (Array.isArray(value) ? value : [])
    .map((entry) => ({
      selectID: String(entry?.selectID || "").trim(),
      options: Array.isArray(entry?.options)
        ? entry.options
            .map((optionValue) => String(optionValue || "").trim())
            .filter(Boolean)
            .filter(
              (optionValue, optionIndex, sourceOptions) =>
                sourceOptions.indexOf(optionValue) === optionIndex,
            )
        : [],
    }))
    .filter((entry) => Boolean(entry.selectID));

const sanitizeLegacyPlannerSelectOptionsPayload = (settingsValue) => {
  if (!settingsValue || typeof settingsValue !== "object") {
    return {};
  }
  const { selectOptions: legacySelectOptions, ...restSettings } = settingsValue;
  const nextOptionsSelects = normalizePlannerOptionsSelectEntries(
    Array.isArray(restSettings?.optionsSelects)
      ? restSettings.optionsSelects
      : legacySelectOptions,
  );
  return {
    ...restSettings,
    optionsSelects: nextOptionsSelects,
  };
};

const persistStudyOrganizerMutation = async (
  userId = "",
  memoryDoc,
  { persistCourses = true, persistStudyPlanAid = true } = {},
) => {
  const normalizedUserId = String(userId || "").trim();
  if (!normalizedUserId || !memoryDoc || typeof memoryDoc !== "object") {
    return { acknowledged: false };
  }

  const setPayload = {};
  if (persistCourses) {
    const rawCourses = memoryDoc?.studyPlanner?.studyOrganizer?.courses;
    setPayload["memory.MOI.studyPlanner.studyOrganizer.courses"] = Array.isArray(
      rawCourses,
    )
      ? rawCourses
      : rawCourses && typeof rawCourses === "object"
        ? [rawCourses]
        : [];
  }
  if (persistStudyPlanAid) {
    setPayload["memory.MOI.studyPlanner.studyPlanAid"] =
      memoryDoc?.studyPlanner?.studyPlanAid &&
      typeof memoryDoc.studyPlanner.studyPlanAid === "object"
        ? memoryDoc.studyPlanner.studyPlanAid
        : {};
  }

  if (Object.keys(setPayload).length === 0) {
    return { acknowledged: false };
  }

  return UserModel.updateOne(
    { _id: normalizedUserId },
    {
      $set: setPayload,
    },
  );
};

const getSubjectAuth = (user) =>
  user?.auth && typeof user.auth === "object" ? user.auth : {};

const getSubjectBio = (user) => {
  const profile =
    user?.profile && typeof user.profile === "object" ? user.profile : {};
  const bio = user?.bio && typeof user.bio === "object" ? user.bio : {};

  // Some legacy users still have richer data in `bio`.
  // Prefer `profile` but fill missing fields from `bio`.
  const mergedStudying = {
    ...(bio?.studying && typeof bio.studying === "object" ? bio.studying : {}),
    ...(profile?.studying && typeof profile.studying === "object"
      ? profile.studying
      : {}),
  };
  const mergedWorking = {
    ...(bio?.working && typeof bio.working === "object" ? bio.working : {}),
    ...(profile?.working && typeof profile.working === "object"
      ? profile.working
      : {}),
  };
  const mergedHometown = {
    ...(bio?.hometown && typeof bio.hometown === "object" ? bio.hometown : {}),
    ...(profile?.hometown && typeof profile.hometown === "object"
      ? profile.hometown
      : {}),
  };

  return {
    ...bio,
    ...profile,
    hometown: mergedHometown,
    studying: mergedStudying,
    working: mergedWorking,
  };
};

const isProfileComplete = (user) => {
  const profile = getSubjectBio(user);
  const firstname = String(profile?.firstname || "").trim();
  const lastname = String(profile?.lastname || "").trim();
  if (!firstname || !lastname) {
    return false;
  }
  return true;
};

const getSubjectStatus = (user) =>
  user?.status && typeof user.status === "object" ? user.status : {};

const normalizePresenceStatusValue = (value, fallback = "offline") => {
  const normalizedValue = String(value || "").trim().toLowerCase();
  if (["online", "busy", "studying", "offline"].includes(normalizedValue)) {
    return normalizedValue;
  }

  const normalizedFallback = String(fallback || "").trim().toLowerCase();
  return ["online", "busy", "studying", "offline"].includes(normalizedFallback)
    ? normalizedFallback
    : "offline";
};

const getLegacyProfilePicture = (user) => {
  const bio = getSubjectBio(user);
  const pictureRoot =
    bio?.picture && typeof bio.picture === "object" ? bio.picture : {};
  const directProfilePic =
    bio?.profilePic && typeof bio.profilePic === "object" ? bio.profilePic : {};
  const profilePicRoot =
    pictureRoot?.profilePic && typeof pictureRoot.profilePic === "object"
      ? pictureRoot.profilePic
      : {};
  const profilePic =
    profilePicRoot?.index && typeof profilePicRoot.index === "object"
      ? profilePicRoot.index
      : directProfilePic
        ? directProfilePic
        : {};

  return {
    url: String(profilePic?.url || "").trim(),
    publicId: String(profilePic?.publicId || "").trim(),
    assetId: "",
    mimeType: String(profilePic?.mimeType || "").trim(),
    width: Number.isFinite(Number(profilePic?.width))
      ? Number(profilePic.width)
      : null,
    height: Number.isFinite(Number(profilePic?.height))
      ? Number(profilePic.height)
      : null,
    updatedAt: null,
  };
};

const getLegacyProfilePictureViewport = (user) => {
  const bio = getSubjectBio(user);
  const pictureRoot =
    bio?.picture && typeof bio.picture === "object" ? bio.picture : {};
  const profilePicRoot =
    pictureRoot?.profilePic && typeof pictureRoot.profilePic === "object"
      ? pictureRoot.profilePic
      : {};
  const viewport =
    profilePicRoot?.viewport && typeof profilePicRoot.viewport === "object"
      ? profilePicRoot.viewport
      : bio?.viewport && typeof bio.viewport === "object"
        ? bio.viewport
        : {};

  return {
    scale: Number.isFinite(Number(viewport?.zoom)) ? Number(viewport.zoom) : 1,
    offsetX: Number.isFinite(Number(viewport?.x)) ? Number(viewport.x) : 0,
    offsetY: Number.isFinite(Number(viewport?.y)) ? Number(viewport.y) : 0,
    width: Number.isFinite(Number(viewport?.width))
      ? Number(viewport.width)
      : null,
    height: Number.isFinite(Number(viewport?.height))
      ? Number(viewport.height)
      : null,
    updatedAt: null,
  };
};

const buildLegacyIdentity = (user) => {
  const auth = getSubjectAuth(user);
  const bio = getSubjectBio(user);
  const status = getSubjectStatus(user);
  const studyingTime =
    bio?.studying?.time && typeof bio.studying.time === "object"
      ? bio.studying.time
      : {};
  const current =
    studyingTime?.current && typeof studyingTime.current === "object"
      ? studyingTime.current
      : {};

  return {
    atSignup: {
      username: String(auth?.username || "").trim(),
    },
    personal: {
      firstname: String(bio?.firstname || "").trim(),
      lastname: String(bio?.lastname || "").trim(),
      dob: bio?.dob || null,
      gender: "other",
      email_address: String(bio?.email || "").trim(),
      faculty: String(bio?.studying?.faculty || "").trim(),
      program: String(bio?.studying?.program || "").trim(),
      university: String(bio?.studying?.university || "").trim(),
      year: String(current?.programYearNum || "").trim(),
      studyYear: String(current?.programYearNum || "").trim(),
      term: String(
        getProgramTermNumber(current?.programTerm) ||
          bio?.studying?.term ||
          "",
      ).trim(),
      profession: "",
      profilePicture: {
        picture: getLegacyProfilePicture(user),
        profilePictureViewport: getLegacyProfilePictureViewport(user),
      },
    },
    status: {
      value: normalizePresenceStatusValue(status?.value, "offline"),
      isLoggedIn:
        normalizePresenceStatusValue(status?.value, "offline") !== "offline",
      lastSeenAt: status?.lastSeenAt || status?.updatedAt || null,
      updatedAt: status?.updatedAt || status?.lastSeenAt || null,
      loggedInAt:
        normalizePresenceStatusValue(status?.value, "offline") !== "offline"
          ? status?.loggedInAt || status?.updatedAt || null
          : null,
      loggedOutAt:
        normalizePresenceStatusValue(status?.value, "offline") === "offline"
          ? status?.loggedOutAt || status?.updatedAt || null
          : null,
    },
  };
};

// --- /api/user/videoUpload route must be defined after UserRouter initialization ---
UserRouter.post(
  "/videoUpload",
  checkAuth,
  upload.single("video"),
  async (req, res, next) => {
    try {
      if (!req.file) {
        return res.status(400).json({ message: "No video file uploaded." });
      }
      const userId = req.authentication.userId;
      const filePath = req.file.path;
      const originalSize = req.file.size;
      const maxVideoSizeBytes = 100 * 1024 * 1024;
      let uploadPath = filePath;
      let compressed = false;

      // Compress if >= 100MB
      if (originalSize >= maxVideoSizeBytes) {
        const compressedPath = filePath + "-compressed.mp4";
        // Emit start of compression
        if (req.app.locals.io) {
          req.app.locals.io
            .to(userId.toString())
            .emit("compression-progress", { percent: 0 });
        }
        await compressVideo(filePath, compressedPath, {
          onProgress: (percent) => {
            // Emit progress to the user via socket.io
            if (req.app.locals.io) {
              req.app.locals.io
                .to(userId.toString())
                .emit("compression-progress", { percent });
            }
          },
        });
        // Emit end of compression
        if (req.app.locals.io) {
          req.app.locals.io
            .to(userId.toString())
            .emit("compression-progress", { percent: 100, done: true });
        }
        uploadPath = compressedPath;
        compressed = true;
      }

      // Upload to Cloudinary
      const cloudinaryResult = await cloudinary.uploader.upload(uploadPath, {
        resource_type: "video",
        folder: `sample1/user-videos/${userId}`,
      });

      // Clean up temp files
      fs.unlinkSync(filePath);
      if (compressed) {
        fs.unlinkSync(uploadPath);
      }

      // Build normalized gallery video payload (stored in memory.MOA.user.videos).
      const videoIdentity = {
        fileName: req.file.originalname,
        url: cloudinaryResult.secure_url,
        publicId: cloudinaryResult.public_id,
        mimeType: req.file.mimetype,
        assetId: cloudinaryResult.asset_id || "",
        contentHash: cloudinaryResult.etag || "",
        folder: cloudinaryResult.folder || "",
        resourceType: cloudinaryResult.resource_type || "video",
        width: cloudinaryResult.width || 0,
        height: cloudinaryResult.height || 0,
        format: cloudinaryResult.format || "",
        bytes: cloudinaryResult.bytes || 0,
        duration: cloudinaryResult.duration || 0,
        createdAt: new Date(),
        updatedAt: new Date(),
        shared: false,
      };

      // Save into memory through MOA.user trace schema.
      const user = await UserModel.findById(userId);
      if (!user) {
        return res.status(404).json({ message: "User not found." });
      }

      const memoryDoc = await ensureUserMemoryDoc(user);
      if (!memoryDoc) {
        return res
          .status(500)
          .json({ message: "Failed to access user memory." });
      }

      const normalizedVideo = normalizeStoredGalleryImage(videoIdentity);
      const existingGallery = getMemoryLocalGallery(memoryDoc);
      const nextImageGallery = sortGalleryImages([
        ...(normalizedVideo ? [normalizedVideo] : []),
        ...existingGallery.filter(
          (mediaItem) =>
            !normalizedVideo || mediaItem.publicId !== normalizedVideo.publicId,
        ),
      ]);
      setMemoryLocalGallery(memoryDoc, nextImageGallery);
      await memoryDoc.save();

      return res.status(200).json({
        message: "Video uploaded successfully.",
        video: videoIdentity,
      });
    } catch (error) {
      return next(error);
    }
  },
);

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const FRONTEND_REPO_PATH = path.resolve(__dirname, "../../sample1front");
const START_MENU_LIST_IDS = ["main", "settings"];

const normalizeStartMenuLayoutForStorage = (layout = {}) =>
  START_MENU_LIST_IDS.reduce((nextLayout, listId) => {
    const itemIds = Array.isArray(layout?.[listId]) ? layout[listId] : [];
    nextLayout[listId] = itemIds
      .map((itemId) => String(itemId || "").trim())
      .filter(Boolean)
      .slice(0, 80);
    return nextLayout;
  }, {});

const getUserAndFriendIds = (user) => {
  if (!user) {
    return [];
  }

  const relationshipEntries = Array.isArray(user.connections)
    ? user.connections
    : Array.isArray(user.friends)
      ? user.friends
      : [];
  const friendIds = relationshipEntries
    .map((friend) => {
      if (!friend) {
        return "";
      }

      // Support both the legacy "friends: [ObjectId]" shape and the new
      // "friends: [{ userID, userMode, ... }]" relationship shape.
      const candidate =
        typeof friend === "object" && friend !== null
          ? friend.id || friend.userID || friend._id || friend
          : friend;
      const normalized =
        typeof candidate === "object" && candidate !== null
          ? candidate._id || candidate
          : candidate;

      return String(normalized || "").trim();
    })
    .filter(Boolean);

  return [String(user._id), ...friendIds];
};

const mapFriendForClient = (friend) => {
  if (!friend || typeof friend !== "object") {
    return null;
  }

  const normalizedFriend =
    typeof friend.toObject === "function" ? friend.toObject() : { ...friend };
  const existingInfo = normalizedFriend?.info || {};
  const existingStatus = normalizedFriend?.status || {};
  const existingMedia = normalizedFriend?.media || {};
  const mediaProfilePicture =
    existingMedia?.profilePicture &&
    typeof existingMedia.profilePicture === "object"
      ? existingMedia.profilePicture
      : {};
  const legacyIdentity = buildLegacyIdentity(normalizedFriend);
  const identity = legacyIdentity;
  const personal = identity?.personal || {};
  const profilePicture = personal?.profilePicture?.picture || {};
  const statusValue = normalizePresenceStatusValue(
    existingStatus?.value,
    "offline",
  );
  const statusUpdatedAt =
    existingStatus?.updatedAt ||
    existingStatus?.lastSeenAt ||
    null;

  return {
    ...normalizedFriend,
    info: {
      ...existingInfo,
      username: String(
        existingInfo?.username || identity?.atSignup?.username || "",
      ).trim(),
      firstname: String(
        existingInfo?.firstname || personal?.firstname || "",
      ).trim(),
      lastname: String(
        existingInfo?.lastname || personal?.lastname || "",
      ).trim(),
      profilePicture: String(
        existingInfo?.profilePicture ||
          mediaProfilePicture?.url ||
          profilePicture?.url ||
          "",
      ).trim(),
    },
    status: {
      ...existingStatus,
      value: statusValue,
      updatedAt: statusUpdatedAt,
      lastSeenAt: statusUpdatedAt,
      loggedInAt: existingStatus?.loggedInAt || null,
      loggedOutAt:
        statusValue === "offline"
          ? existingStatus?.loggedOutAt || statusUpdatedAt
          : existingStatus?.loggedOutAt || null,
    },
    media: {
      ...existingMedia,
      profilePicture: {
        ...profilePicture,
        ...mediaProfilePicture,
        url: String(
          mediaProfilePicture?.url || profilePicture?.url || "",
        ).trim(),
      },
    },
  };
};

const mapFriendEntryForClient = (entry) => {
  if (!entry || typeof entry !== "object") {
    return null;
  }

  const normalizedEntry =
    typeof entry.toObject === "function" ? entry.toObject() : { ...entry };
  const friendUser =
    (normalizedEntry.userID && typeof normalizedEntry.userID === "object"
      ? normalizedEntry.userID
      : null) ||
    (normalizedEntry.id && typeof normalizedEntry.id === "object"
      ? normalizedEntry.id
      : null);
  const friendId = String(
    friendUser?._id ||
      normalizedEntry.id ||
      normalizedEntry.userID ||
      normalizedEntry._id ||
      "",
  ).trim();

  if (!friendId) {
    return null;
  }

  const mappedUser = friendUser ? mapFriendForClient(friendUser) : {};
  const userMode = String(
    normalizedEntry.userMode || normalizedEntry.mode || "stranger",
  ).trim();
  const existingLocalStatus =
    normalizedEntry?.localStatus && typeof normalizedEntry.localStatus === "object"
      ? normalizedEntry.localStatus
      : {};

  return {
    ...mappedUser,
    _id: String(mappedUser?._id || friendId).trim(),
    id: friendId,
    userID: friendId,
    userMode,
    localStatus: {
      value: String(existingLocalStatus?.value || "").trim() || null,
      updatedAt: existingLocalStatus?.updatedAt || null,
      lastChatAt: existingLocalStatus?.lastChatAt || null,
      lastTypingAt: existingLocalStatus?.lastTypingAt || null,
    },
    relationship: {
      userMode,
      localStatus: {
        value: String(existingLocalStatus?.value || "").trim() || null,
        updatedAt: existingLocalStatus?.updatedAt || null,
        lastChatAt: existingLocalStatus?.lastChatAt || null,
        lastTypingAt: existingLocalStatus?.lastTypingAt || null,
      },
    },
  };
};

const buildLegacyChatFromConnections = (connections = []) => {
  const chatRows = [];

  (Array.isArray(connections) ? connections : []).forEach((entry) => {
    if (!entry || typeof entry !== "object") {
      return;
    }

    const friendId = String(entry?.id || entry?.userID || entry?._id || "").trim();
    if (!friendId) {
      return;
    }

    const chatThreads = Array.isArray(entry?.chat) ? entry.chat : [];
    chatThreads.forEach((threadEntry) => {
      const threadMessages = Array.isArray(threadEntry?.messages)
        ? threadEntry.messages
        : [];

      threadMessages.forEach((messageEntry) => {
        const messageBodySource =
          messageEntry?.body && typeof messageEntry.body === "object"
            ? messageEntry.body
            : {};
        const messageText = String(
          messageBodySource?.text ?? messageEntry?.body ?? "",
        ).trim();
        const messageAudio = String(messageBodySource?.audio || "").trim();
        const messageImages = (
          Array.isArray(messageBodySource?.images) ? messageBodySource.images : []
        )
          .map((entry) => String(entry || "").trim())
          .filter(Boolean);
        const statusHistory = Array.isArray(messageEntry?.status)
          ? messageEntry.status
          : [];
        const latestStatusEntry =
          statusHistory.length > 0
            ? statusHistory[statusHistory.length - 1]
            : null;
        const latestStatusValue = String(latestStatusEntry?.value || "sent")
          .trim()
          .toLowerCase();
        const statusValue =
          [...statusHistory]
            .reverse()
            .find((entry) =>
              ["sent", "delivered", "read"].includes(
                String(entry?.value || "")
                  .trim()
                  .toLowerCase(),
              ),
            )
            ?.value || "sent";
        const normalizedStatusValue = String(statusValue || "sent")
          .trim()
          .toLowerCase();
        const isDeleted = latestStatusValue === "deleted";
        const isEdited =
          !isDeleted &&
          statusHistory.some(
            (entry) =>
              String(entry?.value || "")
                .trim()
                .toLowerCase() === "edited",
          );

        if (!messageText && !messageAudio && messageImages.length === 0 && !isDeleted) {
          return;
        }
        const normalizedDate = messageEntry?.index?.timestamp
          ? new Date(messageEntry.index.timestamp).toISOString()
          : latestStatusEntry?.updatedAt
            ? new Date(latestStatusEntry.updatedAt).toISOString()
            : new Date().toISOString();
        const senderTag = String(messageEntry?.index?.sender || "ME")
          .trim()
          .toUpperCase();

        chatRows.push({
          id: String(messageEntry?.index?.messageId || messageEntry?._id || "").trim(),
          _id: friendId,
          from: senderTag === "THEM" ? "them" : "me",
          message: isDeleted ? "" : messageText,
          audio: isDeleted ? "" : messageAudio,
          images: messageImages,
          date: normalizedDate,
          status: normalizedStatusValue,
          edited: isEdited,
          deleted: isDeleted,
        });
      });
    });

    const legacyMessages = Array.isArray(entry?.messages) ? entry.messages : [];
    legacyMessages.forEach((messageEntry) => {
      const messageBody = String(messageEntry?.messageBody || "").trim();
      if (!messageBody) {
        return;
      }

      const statusHistory = Array.isArray(messageEntry?.messageStatus)
        ? messageEntry.messageStatus
        : [];
      const latestStatusEntry =
        statusHistory.length > 0
          ? statusHistory[statusHistory.length - 1]
          : null;
      const statusValue = String(latestStatusEntry?.value || "sent")
        .trim()
        .toLowerCase();
      const statusUpdatedAt =
        latestStatusEntry?.updatedAt ||
        messageEntry?.updatedAt ||
        messageEntry?.createdAt ||
        null;
      const normalizedDate = statusUpdatedAt
        ? new Date(statusUpdatedAt).toISOString()
        : new Date().toISOString();

      chatRows.push({
        _id: friendId,
        from: ["sent", "read", "received"].includes(statusValue) ? "me" : "them",
        message: messageBody,
        date: normalizedDate,
        status: statusValue,
      });
    });
  });

  return chatRows.sort(
    (leftRow, rightRow) =>
      new Date(leftRow?.date || 0).getTime() - new Date(rightRow?.date || 0).getTime(),
  );
};

const normalizeUserId = (value) => String(value || "").trim();

const getFriendRelationshipEntry = (user, otherUserId) => {
  const normalizedOtherId = normalizeUserId(otherUserId);
  if (!user || !normalizedOtherId) {
    return null;
  }

  const friends = Array.isArray(user.connections)
    ? user.connections
    : Array.isArray(user.friends)
      ? user.friends
      : [];
  return (
    friends.find((entry) => {
      if (!entry) {
        return false;
      }

      if (typeof entry === "object" && entry !== null) {
        const candidate = entry.id || entry.userID || entry._id || entry;
        const normalized =
          typeof candidate === "object" && candidate !== null
            ? candidate._id || candidate
            : candidate;
        return normalizeUserId(normalized) === normalizedOtherId;
      }

      return normalizeUserId(entry) === normalizedOtherId;
    }) || null
  );
};

const ensureFriendRelationship = (user, otherUserId, userMode) => {
  const normalizedOtherId = normalizeUserId(otherUserId);
  const normalizedMode = String(userMode || "stranger").trim();
  if (!user || !normalizedOtherId) {
    return false;
  }

  user.connections = Array.isArray(user.connections) ? user.connections : [];
  const existing = getFriendRelationshipEntry(user, normalizedOtherId);

  if (existing && typeof existing === "object") {
    existing.id = existing.id || normalizedOtherId;
    existing.kind = existing.kind || "friend";
    existing.mode = normalizedMode;
    return true;
  }

  // If the relationship isn't in the array yet (or it's a legacy ObjectId),
  // add a proper relationship entry.
  user.connections.push({
    kind: "friend",
    id: normalizedOtherId,
    mode: normalizedMode,
    localStatus: {
      value: null,
      updatedAt: null,
      lastChatAt: null,
      lastTypingAt: null,
    },
  });
  return true;
};

const removeFriendRelationship = (user, otherUserId) => {
  const normalizedOtherId = normalizeUserId(otherUserId);
  if (!user || !normalizedOtherId) {
    return false;
  }

  const currentConnections = Array.isArray(user.connections)
    ? user.connections
    : [];
  const nextConnections = currentConnections.filter((entry) => {
    if (!entry) {
      return false;
    }

    if (typeof entry === "object" && entry !== null) {
      const candidate = entry.id || entry.userID || entry._id || entry;
      const normalized =
        typeof candidate === "object" && candidate !== null
          ? candidate._id || candidate
          : candidate;
      return normalizeUserId(normalized) !== normalizedOtherId;
    }

    return normalizeUserId(entry) !== normalizedOtherId;
  });

  const didChange = nextConnections.length !== currentConnections.length;
  if (didChange) {
    user.connections = nextConnections;
  }

  return didChange;
};

const getFriendRelationshipMode = (user, otherUserId) =>
  String(
    getFriendRelationshipEntry(user, otherUserId)?.mode ||
      getFriendRelationshipEntry(user, otherUserId)?.userMode ||
      "stranger",
  )
    .trim()
    .toLowerCase();

const isPendingReceivedMode = (value) =>
  String(value || "").trim().toLowerCase() === "requestreceived";

const isPendingSentMode = (value) =>
  String(value || "").trim().toLowerCase() === "requestsent";

const isPendingFriendRequestPair = ({ receiverMode, requesterMode }) =>
  isPendingReceivedMode(receiverMode) && isPendingSentMode(requesterMode);

const VISIT_LOG_OWNER_USERNAME = "rudyhamame";
const VISIT_LOG_LIMIT = 200;

const APP_LAST_UPDATED_CACHE_TTL_MS = 5 * 60 * 1000;
const HOMETOWN_CITIES_CACHE_TTL_MS = 30 * 60 * 1000;

const createTimedCache = () => ({
  value: null,
  expiresAt: 0,
  inFlight: null,
});

const appLastUpdatedCache = createTimedCache();
const hometownCitiesCache = createTimedCache();

const resolveTimedCache = async (cache, resolver, ttlMs) => {
  const now = Date.now();

  if (cache.expiresAt > now) {
    return cache.value;
  }

  if (cache.inFlight) {
    return cache.inFlight;
  }

  cache.inFlight = Promise.resolve()
    .then(() => resolver())
    .then((value) => {
      cache.value = value;
      cache.expiresAt = Date.now() + Math.max(0, Number(ttlMs) || 0);
      return value;
    })
    .finally(() => {
      cache.inFlight = null;
    });

  return cache.inFlight;
};

const CLOUDINARY_IMAGE_UPLOAD_FOLDER = "sample1/user-images";

const sanitizeCloudinaryFolderSegment = (value, fallback = "user") => {
  const normalized = String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-_]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");

  return normalized || fallback;
};

const buildUserCloudinaryFolder = (baseFolder, userId) => {
  const userSegment = sanitizeCloudinaryFolderSegment(
    String(userId || ""),
    "user",
  );
  return `${baseFolder}/${userSegment}`;
};

const buildUserImageGalleryFolder = (userId) =>
  buildUserCloudinaryFolder(CLOUDINARY_IMAGE_UPLOAD_FOLDER, userId);

const toBase64 = (value) =>
  Buffer.from(String(value || ""), "utf8").toString("base64");

const buildTurnRestCredentials = (userId) => {
  const turnSecret = String(
    process.env.WEBRTC_TURN_SECRET || process.env.TURN_SECRET || "",
  ).trim();

  if (!turnSecret) {
    return null;
  }

  const ttlSeconds = Math.max(
    60,
    Number.parseInt(
      String(process.env.WEBRTC_TURN_TTL_SECONDS || "86400").trim(),
      10,
    ) || 86400,
  );
  const expiresAt = Math.floor(Date.now() / 1000) + ttlSeconds;
  const usernameSuffix =
    String(userId || "").trim() ||
    String(process.env.WEBRTC_TURN_REST_USER || "phenomed").trim() ||
    "phenomed";
  const username = `${expiresAt}:${usernameSuffix}`;
  const credential = crypto
    .createHmac("sha1", turnSecret)
    .update(username)
    .digest("base64");

  return {
    username,
    credential,
    ttlSeconds,
    expiresAt,
  };
};

const maskTurnCredential = (value) => {
  const normalized = String(value || "").trim();

  if (!normalized) {
    return "";
  }

  if (normalized.length <= 8) {
    return `${normalized.slice(0, 2)}***`;
  }

  return `${normalized.slice(0, 6)}***${normalized.slice(-4)}`;
};

const isPlaceholderTurnUrl = (value) => {
  const normalized = String(value || "")
    .trim()
    .toLowerCase();

  if (!normalized) {
    return true;
  }

  return (
    normalized.includes("your-domain.com") ||
    normalized.includes("example.com") ||
    normalized.includes("localhost") ||
    normalized.includes("127.0.0.1")
  );
};

const expandTurnUrls = (rawUrls) => {
  const inputUrls = Array.isArray(rawUrls) ? rawUrls : [rawUrls];
  const expandedUrls = [];
  const seenUrls = new Set();

  inputUrls.forEach((rawEntry) => {
    const normalizedEntry = String(rawEntry || "").trim();

    if (!normalizedEntry || isPlaceholderTurnUrl(normalizedEntry)) {
      return;
    }

    const addUrl = (value) => {
      const nextValue = String(value || "").trim();

      if (!nextValue || seenUrls.has(nextValue)) {
        return;
      }

      seenUrls.add(nextValue);
      expandedUrls.push(nextValue);
    };

    const turnUriMatch = normalizedEntry.match(/^(turns?):([^?]+)(\?.*)?$/i);

    if (!turnUriMatch) {
      addUrl(normalizedEntry);
      return;
    }

    const protocol = String(turnUriMatch[1] || "").toLowerCase();
    const baseTarget = String(turnUriMatch[2] || "").trim();
    const search = String(turnUriMatch[3] || "").trim();
    const portMatch = baseTarget.match(/:(\d+)$/);
    const port = portMatch ? String(portMatch[1] || "").trim() : "";

    if (!baseTarget) {
      addUrl(normalizedEntry);
      return;
    }

    const hasTransportParam = /(?:\?|&)transport=/i.test(search);

    if (protocol === "turn" && port === "5349") {
      addUrl(`turns:${baseTarget}${search}`);

      if (!hasTransportParam) {
        addUrl(`turns:${baseTarget}?transport=tcp`);
      }

      return;
    }

    if (protocol === "turns") {
      addUrl(`turns:${baseTarget}${search}`);

      if (!hasTransportParam) {
        addUrl(`turns:${baseTarget}?transport=tcp`);
      }

      return;
    }

    if (protocol === "turn") {
      addUrl(`turn:${baseTarget}${search}`);

      if (!hasTransportParam) {
        addUrl(`turn:${baseTarget}?transport=udp`);
        addUrl(`turn:${baseTarget}?transport=tcp`);
      }

      return;
    }

    addUrl(normalizedEntry);
  });

  return expandedUrls;
};

const getRtcIceServers = (userId = "") => {
  const iceServers = [
    {
      urls: ["stun:stun.l.google.com:19302", "stun:stun1.l.google.com:19302"],
    },
  ];

  const turnUrls = String(
    process.env.WEBRTC_TURN_URLS ||
      process.env.TURN_URLS ||
      process.env.TURN_URL ||
      "",
  )
    .split(",")
    .map((entry) => String(entry || "").trim())
    .filter(Boolean)
    .flatMap((entry) => expandTurnUrls(entry));
  const turnUsername = String(
    process.env.WEBRTC_TURN_USERNAME || process.env.TURN_USERNAME || "",
  ).trim();
  const turnCredential = String(
    process.env.WEBRTC_TURN_PASSWORD ||
      process.env.WEBRTC_TURN_CREDENTIAL ||
      process.env.TURN_PASSWORD ||
      "",
  ).trim();
  const turnRestCredentials = buildTurnRestCredentials(userId);

  if (turnUrls.length && turnRestCredentials) {
    iceServers.push({
      urls: turnUrls,
      username: turnRestCredentials.username,
      credential: turnRestCredentials.credential,
    });
  } else if (turnUrls.length && turnUsername && turnCredential) {
    iceServers.push({
      urls: turnUrls,
      username: turnUsername,
      credential: turnCredential,
    });
  }

  return iceServers;
};

const getLiveKitServerConfig = () => {
  const url = String(process.env.LIVEKIT_URL || "").trim();
  const apiKey = String(process.env.LIVEKIT_API_KEY || "").trim();
  const apiSecret = String(process.env.LIVEKIT_API_SECRET || "").trim();

  return {
    url,
    apiKey,
    apiSecret,
    isReady: Boolean(url && apiKey && apiSecret),
  };
};

const createLiveKitToken = async ({
  identity,
  name,
  roomName,
  metadata = {},
}) => {
  const liveKitConfig = getLiveKitServerConfig();

  if (!liveKitConfig.isReady) {
    return null;
  }

  const token = new AccessToken(liveKitConfig.apiKey, liveKitConfig.apiSecret, {
    identity,
    name,
    metadata: JSON.stringify(metadata),
    ttl: "2h",
  });

  token.addGrant({
    roomJoin: true,
    room: roomName,
    canPublish: true,
    canSubscribe: true,
  });

  return {
    token: await token.toJwt(),
    url: liveKitConfig.url,
  };
};

const normalizeGalleryVisibility = (visibility) => {
  const normalizedVisibility = String(visibility || "")
    .trim()
    .toLowerCase();

  if (normalizedVisibility === "private") {
    return "me";
  }

  return ["public", "me", "hidden"].includes(normalizedVisibility)
    ? normalizedVisibility
    : "public";
};

const deriveCloudinaryPublicIdFromUrl = (value) => {
  const rawUrl = String(value || "").trim();
  if (!rawUrl) {
    return "";
  }

  try {
    const parsedUrl = new URL(rawUrl);
    const pathSegments = parsedUrl.pathname
      .split("/")
      .map((segment) => String(segment || "").trim())
      .filter(Boolean);
    const uploadIndex = pathSegments.findIndex((segment) => segment === "upload");
    if (uploadIndex === -1) {
      return "";
    }

    const publicIdSegments = pathSegments
      .slice(uploadIndex + 1)
      .filter((segment) => !/^v\d+$/i.test(segment));
    if (publicIdSegments.length === 0) {
      return "";
    }

    const lastSegment = publicIdSegments[publicIdSegments.length - 1];
    publicIdSegments[publicIdSegments.length - 1] = lastSegment.replace(
      /\.[^.]+$/,
      "",
    );

    return publicIdSegments.join("/");
  } catch {
    return "";
  }
};

const normalizeStoredGalleryImage = (image) => {
  if (!image) {
    return null;
  }

  const identity = image?.identity || {};
  const url = String(
    image?.url || image?.secure_url || identity?.url || "",
  ).trim();
  const publicId = String(
    image?.publicId ||
      image?.public_id ||
      identity?.publicId ||
      identity?.fileName ||
      deriveCloudinaryPublicIdFromUrl(url) ||
      "",
  ).trim();
  const mimeType = String(
    image?.mimeType || image?.mime_type || identity?.mimeType || "",
  ).trim();
  const normalizedResourceType = String(
    image?.resourceType ||
      image?.resource_type ||
      (mimeType.startsWith("video/") ? "video" : "") ||
      (mimeType && !mimeType.startsWith("image/") ? "raw" : "") ||
      "image",
  )
    .trim()
    .toLowerCase();
  const resourceType =
    normalizedResourceType === "video"
      ? "video"
      : normalizedResourceType === "raw"
        ? "raw"
        : "image";

  if (!url || !publicId) {
    return null;
  }

  const width = Number(image?.width) || 0;
  const height = Number(image?.height) || 0;
  const bytes = Number(image?.bytes) || 0;
  const duration = Number(image?.duration) || 0;
  const aspectRatio = width > 0 && height > 0 ? width / height : null;
  const bitrateBps =
    resourceType === "video" && duration > 0 && bytes > 0
      ? (bytes * 8) / duration
      : null;

  return {
    url,
    publicId,
    assetId: String(
      image?.assetId || image?.asset_id || image?._id || "",
    ).trim(),
    contentHash: String(
      image?.contentHash || image?.etag || identity?.contentHash || "",
    ).trim(),
    folder: String(image?.folder || "").trim(),
    resourceType,
    mimeType,
    width,
    height,
    format: String(image?.format || "").trim(),
    bytes,
    duration,
    aspectRatio,
    bitrateBps,
    bitrateKbps:
      bitrateBps !== null ? Number((bitrateBps / 1000).toFixed(2)) : null,
    visibility: normalizeGalleryVisibility(
      image?.visibility || identity?.visibility,
    ),
    createdAt:
      image?.createdAt || identity?.createdAt
        ? new Date(image?.createdAt || identity?.createdAt)
        : new Date(),
    updatedAt: image?.updatedAt || identity?.updatedAt || null,
  };
};

const buildMemoryLocalImageFile = (media) => ({
  identity: {
    fileName: String(media?.publicId || "").trim(),
    mimeType: String(media?.mimeType || "").trim(),
    url: String(media?.url || "").trim(),
    publicId: String(media?.publicId || "").trim(),
    assetId: String(media?.assetId || "").trim(),
    contentHash: String(media?.contentHash || "").trim(),
    folder: String(media?.folder || "").trim(),
    resourceType: String(media?.resourceType || "image").trim() || "image",
    width: Number(media?.width) || 0,
    height: Number(media?.height) || 0,
    format: String(media?.format || "").trim(),
    bytes: Number(media?.bytes) || 0,
    createdAt: media?.createdAt || new Date(),
    updatedAt: media?.updatedAt || null,
    shared: false,
  },
  ocr: {},
});

const buildMemoryLocalVideoFile = (media) => ({
  fileName: String(media?.fileName || media?.publicId || "").trim(),
  url: String(media?.url || "").trim(),
  publicId: String(media?.publicId || "").trim(),
  mimeType: String(media?.mimeType || "").trim(),
  assetId: String(media?.assetId || "").trim(),
  contentHash: String(media?.contentHash || "").trim(),
  folder: String(media?.folder || "").trim(),
  resourceType: String(media?.resourceType || "video").trim() || "video",
  width: Number(media?.width) || 0,
  height: Number(media?.height) || 0,
  format: String(media?.format || "").trim(),
  bytes: Number(media?.bytes) || 0,
  duration: Number(media?.duration) || 0,
  createdAt: media?.createdAt || new Date(),
  updatedAt: media?.updatedAt || null,
  shared: false,
});

const buildHumanTraceMediaItem = (
  media,
  resourceType = "image",
  modeOfIntervention = "gallery",
) => ({
  index: {
    fileName: String(media?.fileName || media?.publicId || "").trim(),
    mimeType: String(media?.mimeType || "").trim(),
    contentHash: String(media?.contentHash || "").trim(),
    resourceType:
      String(media?.resourceType || resourceType).trim() || resourceType,
    MOI: String(modeOfIntervention || "").trim(),
  },
  metadata: {
    width: Number.isFinite(Number(media?.width)) ? Number(media.width) : null,
    height: Number.isFinite(Number(media?.height))
      ? Number(media.height)
      : null,
    aspectRatio:
      Number.isFinite(Number(media?.aspectRatio))
        ? Number(media.aspectRatio)
        : Number.isFinite(Number(media?.width)) &&
            Number.isFinite(Number(media?.height)) &&
            Number(media.height) > 0
          ? Number(media.width) / Number(media.height)
          : null,
    pixels:
      Number.isFinite(Number(media?.pixels))
        ? Number(media.pixels)
        : Number.isFinite(Number(media?.width)) &&
            Number.isFinite(Number(media?.height))
          ? Number(media.width) * Number(media.height)
          : null,
    format: String(media?.format || "").trim(),
    bytes: Number.isFinite(Number(media?.bytes)) ? Number(media.bytes) : null,
    duration: Number.isFinite(Number(media?.duration))
      ? Number(media.duration)
      : null,
    bitrateBps: Number.isFinite(Number(media?.bitrateBps))
      ? Number(media.bitrateBps)
      : Number.isFinite(Number(media?.bytes)) &&
          Number.isFinite(Number(media?.duration)) &&
          Number(media.duration) > 0
        ? (Number(media.bytes) * 8) / Number(media.duration)
        : null,
    bitrateKbps: Number.isFinite(Number(media?.bitrateKbps))
      ? Number(media.bitrateKbps)
      : Number.isFinite(Number(media?.bytes)) &&
          Number.isFinite(Number(media?.duration)) &&
          Number(media.duration) > 0
        ? Number((((Number(media.bytes) * 8) / Number(media.duration)) / 1000).toFixed(2))
        : null,
    totalPages: Number.isFinite(Number(media?.totalPages))
      ? Number(media.totalPages)
      : null,
    visibility: normalizeGalleryVisibility(media?.visibility),
    createdAt: media?.createdAt || new Date(),
    updatedAt: media?.updatedAt || new Date(),
  },
  storageContext: {
    url: String(media?.url || "").trim(),
    publicId: String(media?.publicId || "").trim(),
    assetId: String(media?.assetId || "").trim(),
    folder: String(media?.folder || "").trim(),
  },
});

const buildHumanMediaTrace = (media, resourceType = "image") => {
  const normalizedType = resourceType === "video" ? "video" : "image";
  return {
    user: {
      images:
        normalizedType === "image"
          ? [buildHumanTraceMediaItem(media, "image")]
          : [],
      videos:
        normalizedType === "video"
          ? [buildHumanTraceMediaItem(media, "video")]
          : [],
      texts: [],
      audios: [],
      documents: [],
    },
    telegram: null,
    ai: null,
    chat: null,
  };
};

const getHumanTraceMediaBucket = (
  trace,
  resourceType = "image",
  requiredModeOfIntervention = "",
) => {
  const human =
    trace?.user && typeof trace.user === "object"
      ? trace.user
      : null;
  if (!human) {
    return [];
  }

  const bucket =
    resourceType === "video"
      ? Array.isArray(human.videos)
        ? human.videos
        : []
      : Array.isArray(human.images)
        ? human.images
        : [];

  const normalizedRequiredMode = String(requiredModeOfIntervention || "").trim();
  const filteredBucket = normalizedRequiredMode
    ? bucket.filter((item) => {
        const itemMode = String(item?.index?.MOI || "").trim();
        // Keep legacy gallery entries that were saved before MOI tagging.
        return itemMode === normalizedRequiredMode || itemMode === "";
      })
    : bucket;

  return filteredBucket.map((item) => ({
    fileName: String(item?.index?.fileName || "").trim(),
    url: String(item?.storageContext?.url || "").trim(),
    publicId: String(item?.storageContext?.publicId || "").trim(),
    mimeType: String(item?.index?.mimeType || "").trim(),
    assetId: String(item?.storageContext?.assetId || "").trim(),
    contentHash: String(item?.index?.contentHash || "").trim(),
    folder: String(item?.storageContext?.folder || "").trim(),
    resourceType:
      String(item?.index?.resourceType || resourceType).trim() || resourceType,
    width: Number.isFinite(Number(item?.metadata?.width))
      ? Number(item.metadata.width)
      : null,
    height: Number.isFinite(Number(item?.metadata?.height))
      ? Number(item.metadata.height)
      : null,
    format: String(item?.metadata?.format || "").trim(),
    bytes: Number.isFinite(Number(item?.metadata?.bytes))
      ? Number(item.metadata.bytes)
      : null,
    duration: Number.isFinite(Number(item?.metadata?.duration))
      ? Number(item.metadata.duration)
      : null,
    totalPages: Number.isFinite(Number(item?.metadata?.totalPages))
      ? Number(item.metadata.totalPages)
      : null,
    visibility: normalizeGalleryVisibility(item?.metadata?.visibility),
    createdAt: item?.metadata?.createdAt || new Date(),
    updatedAt: item?.metadata?.updatedAt || new Date(),
  }));
};

const getMemoryLocalImages = (memoryDoc) => {
  const traceImages = Array.isArray(memoryDoc?.MOA)
    ? memoryDoc.MOA.flatMap((trace) =>
        getHumanTraceMediaBucket(trace, "image", "gallery"),
      )
    : memoryDoc?.MOA && typeof memoryDoc.MOA === "object"
        ? getHumanTraceMediaBucket(memoryDoc.MOA, "image", "gallery")
        : [];
  return traceImages;
};

const getMemoryLocalVideos = (memoryDoc) => {
  const traceVideos = Array.isArray(memoryDoc?.MOA)
    ? memoryDoc.MOA.flatMap((trace) =>
        getHumanTraceMediaBucket(trace, "video", "gallery"),
      )
    : memoryDoc?.MOA && typeof memoryDoc.MOA === "object"
        ? getHumanTraceMediaBucket(memoryDoc.MOA, "video", "gallery")
        : [];
  return traceVideos;
};

const getMemoryLocalGallery = (memoryDoc) =>
  sortGalleryImages([
    ...getMemoryLocalImages(memoryDoc)
      .map(normalizeStoredGalleryImage)
      .filter(Boolean),
    ...getMemoryLocalVideos(memoryDoc)
      .map(normalizeStoredGalleryImage)
      .filter(Boolean),
  ]);

const sortGalleryImages = (images = []) =>
  images
    .filter(Boolean)
    .sort(
      (firstImage, secondImage) =>
        new Date(secondImage?.createdAt || 0).getTime() -
        new Date(firstImage?.createdAt || 0).getTime(),
    );

const setMemoryLocalGallery = (memoryDoc, images = []) => {
  const tracesArray = Array.isArray(memoryDoc?.MOA) ? memoryDoc.MOA : [];
  const traceRoot =
    memoryDoc?.MOA && typeof memoryDoc.MOA === "object" && !Array.isArray(memoryDoc.MOA)
      ? memoryDoc.MOA
      : tracesArray[0] && typeof tracesArray[0] === "object"
        ? tracesArray[0]
        : {};
  const existingUserTrace =
    traceRoot?.user && typeof traceRoot.user === "object" ? traceRoot.user : {};
  const nextImages = [];
  const nextVideos = [];
  sortGalleryImages(images).forEach((image) => {
    const normalizedType = image?.resourceType === "video" ? "video" : "image";
    const item = buildHumanTraceMediaItem(image, normalizedType);
    if (normalizedType === "video") {
      nextVideos.push(item);
      return;
    }
    nextImages.push(item);
  });

  const nextRoot = {
    user: {
      images: nextImages,
      videos: nextVideos,
      texts: Array.isArray(existingUserTrace.texts) ? existingUserTrace.texts : [],
      audios: Array.isArray(existingUserTrace.audios)
        ? existingUserTrace.audios
        : [],
      documents: Array.isArray(existingUserTrace.documents)
        ? existingUserTrace.documents
        : [],
    },
    telegram: traceRoot?.telegram || null,
    ai: traceRoot?.ai || null,
    chat: traceRoot?.chat || null,
  };

  memoryDoc.MOA = nextRoot;
};

const deleteCloudinaryAsset = async ({
  cloudName = "",
  apiKey = "",
  apiSecret = "",
  publicId = "",
  resourceType = "image",
}) => {
  const normalizedPublicId = String(publicId || "").trim();

  if (!cloudName || !apiKey || !apiSecret || !normalizedPublicId) {
    return false;
  }

  const timestamp = Math.floor(Date.now() / 1000);
  const signature = buildCloudinarySignature({
    paramsToSign: {
      public_id: normalizedPublicId,
      timestamp,
    },
    apiSecret,
  });

  const body = new URLSearchParams({
    public_id: normalizedPublicId,
    timestamp: String(timestamp),
    api_key: apiKey,
    signature,
  });

  const response = await fetch(
    `https://api.cloudinary.com/v1_1/${cloudName}/${resourceType}/destroy`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: body.toString(),
    },
  );

  if (!response.ok) {
    return false;
  }

  const payload = await response.json().catch(() => ({}));
  return ["ok", "not found"].includes(
    String(payload?.result || "")
      .trim()
      .toLowerCase(),
  );
};

const resolveCloudinaryContentHash = async (media = {}) => {
  const publicId = String(media?.publicId || "").trim();
  const resourceType =
    String(media?.resourceType || "").trim().toLowerCase() === "video"
      ? "video"
      : "image";

  if (!publicId) {
    return "";
  }

  try {
    const resource = await cloudinary.api.resource(publicId, {
      resource_type: resourceType,
    });
    return String(resource?.etag || "").trim();
  } catch {
    return "";
  }
};

const buildFallbackMediaContentHash = (media = {}) => {
  const parts = [
    String(media?.publicId || "").trim(),
    String(media?.assetId || "").trim(),
    String(media?.url || "").trim(),
    String(media?.resourceType || "").trim(),
    String(media?.format || "").trim(),
    String(Number(media?.bytes) || 0),
    String(Number(media?.duration) || 0),
  ];
  const seed = parts.join("|");
  if (!seed.replace(/\|/g, "").trim()) {
    return "";
  }
  return crypto.createHash("sha1").update(seed).digest("hex");
};

const getRequestIp = (req) => {
  const forwardedFor = req.headers["x-forwarded-for"];

  if (typeof forwardedFor === "string" && forwardedFor.trim()) {
    return forwardedFor.split(",")[0].trim();
  }

  return (
    req.ip ||
    req.socket?.remoteAddress ||
    req.connection?.remoteAddress ||
    "Unknown IP"
  );
};

const getCountryFromIp = (ipAddress) => {
  if (!ipAddress || ipAddress === "Unknown IP") {
    return "Unknown";
  }

  const normalizedIp = String(ipAddress)
    .replace(/^::ffff:/, "")
    .trim();

  if (
    normalizedIp === "::1" ||
    normalizedIp === "127.0.0.1" ||
    normalizedIp.startsWith("192.168.") ||
    normalizedIp.startsWith("10.") ||
    /^172\.(1[6-9]|2\d|3[0-1])\./.test(normalizedIp)
  ) {
    return "Local";
  }

  const lookup = geoip.lookup(normalizedIp);

  return lookup?.country || "Unknown";
};

const getVideoGateVisitorSummary = async () => {
  const [authorizedCount, recentAuthorizedVisitors, totalVisitors, totalVisits, totalUsers] =
    await Promise.all([
    VisitorsModel.countDocuments({ "videoGate.unlocked": true }),
    VisitorsModel.find({ "videoGate.unlocked": true })
      .sort({ "videoGate.verifiedAt": -1, lastSeenAt: -1 })
      .limit(8)
      .select("ip geo.country videoInfoAutho videoGate.authorizedCompany videoGate.verifiedAt")
      .lean(),
    VisitorsModel.countDocuments({}),
    VisitorsModel.aggregate([
      {
        $group: {
          _id: null,
          totalVisits: { $sum: { $ifNull: ["$visitCount", 1] } },
        },
      },
    ]),
    UserModel.countDocuments({}),
  ]);

  return {
    authorizedCount,
    visitStats: {
      totalVisitors,
      totalVisits: Number(totalVisits?.[0]?.totalVisits || 0),
      totalUsers,
    },
    recentAuthorizedVisitors: recentAuthorizedVisitors.map((visitor) => ({
      ip: String(visitor?.ip || ""),
      country: String(visitor?.geo?.country || "Unknown"),
      companyName: String(
        visitor?.videoGate?.authorizedCompany || visitor?.videoInfoAutho || "",
      ),
      verifiedAt:
        visitor?.videoGate?.verifiedAt || visitor?.lastSeenAt || null,
    })),
  };
};

const getFrontendLastUpdated = () => {
  const envCommittedAt = String(
    process.env.FRONTEND_LAST_UPDATED || "",
  ).trim();

  if (envCommittedAt) {
    return envCommittedAt;
  }

  try {
    const committedAt = execFileSync(
      "git",
      ["-C", FRONTEND_REPO_PATH, "log", "-1", "--format=%cI"],
      {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
      },
    ).trim();

    if (!committedAt) {
      return null;
    }

    return committedAt;
  } catch {
    return "2026-06-06T16:54:59-04:00";
  }
};

const getCloudinaryConfig = () => {
  const envCloudName = String(process.env.CLOUDINARY_CLOUD_NAME || "").trim();
  const envApiKey = String(process.env.CLOUDINARY_API_KEY || "").trim();
  const envApiSecret = String(process.env.CLOUDINARY_API_SECRET || "").trim();
  const cloudinaryUrl = String(process.env.CLOUDINARY_URL || "").trim();

  let urlCloudName = "";
  let urlApiKey = "";
  let urlApiSecret = "";

  if (cloudinaryUrl) {
    try {
      const parsedUrl = new URL(cloudinaryUrl);
      if (parsedUrl.protocol === "cloudinary:") {
        urlCloudName = String(parsedUrl.hostname || "").trim();
        urlApiKey = decodeURIComponent(String(parsedUrl.username || "").trim());
        urlApiSecret = decodeURIComponent(
          String(parsedUrl.password || "").trim(),
        );
      }
    } catch {
      const normalizedCloudinaryUrl = cloudinaryUrl.replace(
        /^cloudinary:\/\//i,
        "",
      );
      const cloudinaryUrlMatch = normalizedCloudinaryUrl.match(
        /^([^:]+):([^@]+)@(.+)$/,
      );

      if (cloudinaryUrlMatch) {
        urlApiKey = decodeURIComponent(
          String(cloudinaryUrlMatch[1] || "").trim(),
        );
        urlApiSecret = decodeURIComponent(
          String(cloudinaryUrlMatch[2] || "").trim(),
        );
        urlCloudName = String(cloudinaryUrlMatch[3] || "").trim();
      }
    }
  }

  const cloudName = envCloudName || urlCloudName;
  const apiKey = envApiKey || urlApiKey;
  const apiSecret = envApiSecret || urlApiSecret;
  const missing = [];

  if (!cloudName) {
    missing.push("CLOUDINARY_CLOUD_NAME");
  }

  if (!apiKey) {
    missing.push("CLOUDINARY_API_KEY");
  }

  if (!apiSecret) {
    missing.push("CLOUDINARY_API_SECRET");
  }

  return {
    cloudName,
    apiKey,
    apiSecret,
    missing,
    isReady: Boolean(cloudName && apiKey && apiSecret),
  };
};

const getPublicCloudinaryStatus = () => {
  const cloudinaryConfig = getCloudinaryConfig();

  return {
    status: cloudinaryConfig.isReady ? "configured" : "missing",
    missing: cloudinaryConfig.missing,
  };
};

const isDatabaseAvailabilityError = (error) => {
  const errorName = String(error?.name || "").trim();
  const errorMessage = String(error?.message || "").trim();
  const knownNames = new Set([
    "MongoServerSelectionError",
    "MongoNetworkError",
    "MongoNetworkTimeoutError",
    "MongooseServerSelectionError",
  ]);

  if (knownNames.has(errorName)) {
    return true;
  }

  return /enotfound|timed out|getaddrinfo|replicasetnoprimary|server selection/i.test(
    errorMessage,
  );
};

const buildCloudinarySignature = ({ paramsToSign = {}, apiSecret = "" }) => {
  const serializedParams = Object.entries(paramsToSign)
    .filter(([, value]) => String(value || "").trim() !== "")
    .sort(([firstKey], [secondKey]) => firstKey.localeCompare(secondKey))
    .map(([key, value]) => `${key}=${String(value)}`)
    .join("&");

  return crypto
    .createHash("sha1")
    .update(`${serializedParams}${apiSecret}`)
    .digest("hex");
};

const LOGIN_USER_SELECT = [
  "auth.username",
  "auth.password",
  "profile.firstname",
  "profile.lastname",
  "profile.email",
  "profile.phone",
  "profile.dob",
  "profile.hometown",
  "profile.studying",
  "profile.working",
  "profile.bio",
  "profile.picture.profilePic.index",
  "profile.picture.profilePic.viewport",
  "profile.events",
  "connections",
  "friends",
  "status",
].join(" ");

//Login API
UserRouter.post("/login", function (req, res, next) {
  const io = req.app.locals.io;

  const username = String(req.body?.username || "").trim();
  const password = req.body?.password;
  if (!username || !password) {
    return res
      .status(400)
      .json({ message: "Please provide a username and password." });
  }

  UserModel.findOne({
    "auth.username": username,
  })
    .select(LOGIN_USER_SELECT)
    .lean()
    .exec()
    .then((user) => {
      if (user) {
        bcrypt.compare(
          req.body.password,
          user.auth?.password || "",
          async (err, result) => {
            if (result) {
              try {
                const now = new Date();
                await UserModel.updateOne(
                  { _id: user._id },
                  {
                    $set: {
                      "status.value": "online",
                      "status.updatedAt": now,
                      "status.lastSeenAt": now,
                      "status.loggedInAt": now,
                      "status.loggedOutAt": null,
                    },
                  },
                ).exec();
                const updatedUser = {
                  ...user,
                  auth: {
                    ...(user?.auth && typeof user.auth === "object"
                      ? user.auth
                      : {}),
                    password: undefined,
                  },
                  status: {
                    ...(user?.status && typeof user.status === "object"
                      ? user.status
                      : {}),
                    value: "online",
                    updatedAt: now,
                    lastSeenAt: now,
                    loggedInAt: now,
                    loggedOutAt: null,
                  },
                };

                emitUserRefresh(
                  io,
                  getUserAndFriendIds(updatedUser),
                  "connection:changed",
                  {
                    statusValue: "online",
                    targetUserId: String(updatedUser._id),
                  },
                );

                const profileComplete = isProfileComplete(updatedUser);

                if (!profileComplete) {
                  return res.status(202).json({
                    message: "Profile completion required",
                    requiresProfileCompletion: true,
                    token: jwt.sign(
                      {
                        username: updatedUser.auth?.username || "",
                        userId: updatedUser._id,
                      },
                      process.env.JWT_KEY,
                      {
                        expiresIn: process.env.JWT_EXPIRES_IN || "30d",
                      },
                    ),
                    user: updatedUser,
                  });
                }

                const token = jwt.sign(
                  {
                    username: updatedUser.auth?.username || "",
                    userId: updatedUser._id,
                  },
                  process.env.JWT_KEY,
                  {
                    expiresIn: process.env.JWT_EXPIRES_IN || "30d",
                  },
                );
                return res.status(201).json({
                  token: token,
                  user: updatedUser,
                });
              } catch (error) {
                return next(error);
              }
            } else {
              res.status(401).json({
                message: "Authorized failed",
              });
            }
          },
        );
      } else {
        res.status(401).json({
          message: "Authorized failed",
        });
      }
    })
    .catch(next);
});

UserRouter.post("/logout", checkAuth, async function (req, res, next) {
  try {
    const io = req.app.locals.io;
    const userId = String(req.authentication?.userId || "").trim();
    if (!userId) {
      return res.status(401).json({ message: "Missing login session." });
    }

    const responsePayload = {
      ok: true,
      userId,
    };
    res.status(200).json(responsePayload);

    // Non-blocking persistence. Logout response must not wait on DB/network latency.
    setImmediate(async () => {
      try {
        const now = new Date();
        await UserModel.updateOne(
          { _id: userId },
          {
            $set: {
              "status.value": "offline",
              "status.updatedAt": now,
              "status.lastSeenAt": now,
              "status.loggedOutAt": now,
              "status.loggedInAt": null,
            },
          },
          { maxTimeMS: 4000 },
        );

        const notifyUser = await UserModel.findById(userId)
          .select("_id connections friends")
          .lean()
          .maxTimeMS(4000);

        if (notifyUser) {
          emitUserRefresh(io, getUserAndFriendIds(notifyUser), "connection:changed", {
            statusValue: "offline",
            targetUserId: String(notifyUser._id),
          });
        }
      } catch (error) {
        console.error("[logout] deferred persistence failed:", error?.message || error);
      }
    });
    return;
  } catch (error) {
    return next(error);
  }
});

// Direct signup (verification code flow removed)
UserRouter.post("/signup", async function (req, res, next) {
  try {
    const { username, password } = req.body;

    if (!username || !password) {
      return res.status(400).json({
        message: "Please provide a username and password.",
      });
    }

    const existingUsernameUser = await UserModel.findOne({
      "auth.username": username,
    });

    if (existingUsernameUser) {
      return res.status(409).json({
        message: "That username is already in use.",
      });
    }

    const passwordHash = await bcrypt.hash(password, 10);

    const createdUser = new UserModel({
      auth: {
        username: String(username || "").trim(),
        password: passwordHash,
      },
      profile: {
        studying: {
          time: {
            startDate: {
              startTerm: "First",
            },
            currentDate: {
              term: "First",
            },
          },
        },
      },
    });

    setUserConnectionState(createdUser, {
      statusValue: "online",
      at: new Date(),
      markLogin: true,
    });

    await createdUser.save();

    const token = jwt.sign(
      {
        username: createdUser.auth?.username || "",
        userId: createdUser._id,
      },
      process.env.JWT_KEY,
      {
        expiresIn: process.env.JWT_EXPIRES_IN || "30d",
      },
    );

    return res.status(201).json({
      userID: createdUser._id,
      token,
      user: createdUser,
      message: "Account created. Complete your profile to continue.",
    });
  } catch (error) {
    if (error?.code === 11000) {
      return res.status(409).json({
        message: "This account already exists.",
      });
    }

    if (isDatabaseAvailabilityError(error)) {
      return res.status(503).json({
        message:
          "The database is temporarily unavailable. Please try signing up again in a few moments.",
      });
    }

    return next(error);
  }
});

UserRouter.put("/signup/personal", checkAuth, async function (req, res, next) {
  try {
    const firstname = String(req.body?.firstname || "").trim();
    const lastname = String(req.body?.lastname || "").trim();
    const email = String(req.body?.email || "")
      .trim()
      .toLowerCase();
    const phone = String(req.body?.phone || "").trim();
    const rawDobInput = req.body?.dob;
    const dobInput = String(rawDobInput || "").trim();
    const hometown = req.body?.hometown;
    const studying = req.body?.studying;
    const working = req.body?.working;
    const normalizeNullableNumber = (value, defaultValue = null) => {
      if (value === null || value === undefined || value === "") {
        return defaultValue;
      }
      const parsed = Number(value);
      return Number.isFinite(parsed) ? parsed : defaultValue;
    };

    if (
      !firstname ||
      !lastname
    ) {
      return res.status(400).json({
        message: "First name, last name, and username are required.",
      });
    }

    // Check if user provided studying or working info
    const isStudying = studying && (studying.university || studying.program);
    const isWorking = working && (working.company || working.position);

    if (isStudying) {
      const studyingTime =
        studying?.time && typeof studying.time === "object" ? studying.time : {};
      const start =
        studyingTime?.start && typeof studyingTime.start === "object"
          ? studyingTime.start
          : {};
      const current =
        studyingTime?.current && typeof studyingTime.current === "object"
          ? studyingTime.current
          : {};
      const hasCurrentTerm = Boolean(
        getProgramTermNumber(current?.programTerm, studying?.term),
      );

      if (!studying.program || !studying.university || !hasCurrentTerm) {
        return res.status(400).json({
          message:
            "Program, university, and current term are required for education information.",
        });
      }

      if (
        String(studyingTime.totalYearsNum ?? "").trim() ||
        String(start.programYearInterval || "").trim() ||
        String(start.programTerm || "").trim() ||
        String(current.programYearNum ?? "").trim() ||
        String(current.programYearInterval || "").trim() ||
        getProgramTermNumber(current?.programTerm, studying?.term)
      ) {
        if (
          !normalizeNullableNumber(studyingTime.totalYearsNum, null) ||
          !String(start.programYearInterval || "").trim() ||
          !String(start.programTerm || "").trim() ||
          !normalizeNullableNumber(current.programYearNum, null) ||
          !String(current.programYearInterval || "").trim() ||
          !getProgramTermNumber(current?.programTerm, studying?.term)
        ) {
          return res.status(400).json({
            message:
              "If education timing is provided, total years, start interval/term, and current year number/interval/term are all required.",
          });
        }
      }
    }

    if (isWorking) {
      if (!working.company || !working.position) {
        return res.status(400).json({
          message:
            "Company and position are required for professional information.",
        });
      }
    }

    let parsedDob = null;
    if (rawDobInput !== null && rawDobInput !== undefined && dobInput) {
      parsedDob = new Date(dobInput);
    }
    if (parsedDob && Number.isNaN(parsedDob.getTime())) {
      return res.status(400).json({
        message: "Please provide a valid date of birth.",
      });
    }

    if (email) {
      const existingEmailUser = await UserModel.findOne({
        "profile.email": email,
        _id: { $ne: req.authentication.userId },
      }).select("_id");

      if (existingEmailUser) {
        return res.status(409).json({
          message: "That email address is already in use.",
        });
      }
    }

    const user = await UserModel.findById(req.authentication.userId);

    if (!user) {
      return res.status(404).json({
        message: "User not found.",
      });
    }

    user.profile = user.profile || {};
    user.profile.firstname = firstname;
    user.profile.lastname = lastname;
    user.profile.email = email;
    user.profile.phone = phone;
    user.profile.dob =
      parsedDob instanceof Date && !Number.isNaN(parsedDob.getTime())
        ? parsedDob
        : null;
    user.profile.hometown = {
      Country: String(hometown?.Country || "").trim(),
      City: String(hometown?.City || "").trim(),
    };

    if (isStudying) {
      const studyingTime =
        studying?.time && typeof studying.time === "object" ? studying.time : {};
      const start =
        studyingTime?.start && typeof studyingTime.start === "object"
          ? studyingTime.start
          : {};
      const current =
        studyingTime?.current && typeof studyingTime.current === "object"
          ? studyingTime.current
          : {};
      const normalizedTotalYearsNum = normalizeNullableNumber(
        studyingTime.totalYearsNum,
        0,
      );
      const normalizedStartProgramYearInterval = String(
        start.programYearInterval || "",
      ).trim();
      const normalizedStartProgramTerm = String(start.programTerm || "").trim();
      const normalizedCurrentProgramYearNum = normalizeNullableNumber(
        current.programYearNum,
        null,
      );
      const normalizedCurrentProgramYearInterval = String(
        current.programYearInterval || "",
      ).trim();
      const normalizedCurrentProgramTerm = getProgramTermNumber(
        current?.programTerm,
        studying?.term,
      );

      user.profile.studying = {
        id: {
          program: studying.program,
          components: normalizeComponentsClassList(studying?.componentsClass),
        },
        location: {
          university: studying.university,
          faculty: studying.faculty || "",
        },
        academicYearsIntervals: {
          total: normalizedTotalYearsNum || 0,
          first: {
            interval: normalizedStartProgramYearInterval || null,
            term: normalizedStartProgramTerm || null,
          },
          current: {
            num: normalizedCurrentProgramYearNum,
            interval: normalizedCurrentProgramYearInterval || null,
            term: normalizedCurrentProgramTerm || null,
          },
        },
        language: studying.language || "",
      };
    }

    if (isWorking) {
      user.profile.working = {
        company: working.company,
        position: working.position,
      };
    }

    await user.save();

    return res.status(200).json({
      message: "Profile completed successfully.",
      user,
    });
  } catch (error) {
    if (error?.code === 11000) {
      return res.status(409).json({
        message: "This account already exists.",
      });
    }

    return next(error);
  }
});

UserRouter.put("/signup/auth", checkAuth, async function (req, res, next) {
  try {
    const requestedUsername = String(req.body?.username || "").trim();
    const requestedPassword = String(req.body?.password || "");

    if (!requestedUsername) {
      return res.status(400).json({
        message: "Username is required.",
      });
    }

    const user = await UserModel.findById(req.authentication.userId);

    if (!user) {
      return res.status(404).json({
        message: "User not found.",
      });
    }

    const currentUsername = String(user?.auth?.username || "").trim();

    if (requestedUsername !== currentUsername) {
      const existingUsernameUser = await UserModel.findOne({
        "auth.username": requestedUsername,
        _id: { $ne: req.authentication.userId },
      }).select("_id");

      if (existingUsernameUser) {
        return res.status(409).json({
          message: "That username is already in use.",
        });
      }
    }

    user.auth = user.auth || {};
    user.auth.username = requestedUsername;

    if (requestedPassword) {
      user.auth.password = await bcrypt.hash(requestedPassword, 10);
    }

    await user.save();

    return res.status(200).json({
      message: "Signup credentials updated.",
      user,
    });
  } catch (error) {
    return next(error);
  }
});

UserRouter.get(
  "/ui/start-menu-layout",
  checkAuth,
  async function (req, res, next) {
    try {
      const user = await UserModel.findById(req.authentication.userId).select(
        "settings.ui.startMenuLayout",
      );

      if (!user) {
        return res.status(404).json({ message: "User not found." });
      }

      return res.status(200).json({
        startMenuLayout: normalizeStartMenuLayoutForStorage(
          user.ui?.startMenuLayout,
        ),
      });
    } catch (error) {
      return next(error);
    }
  },
);

UserRouter.patch(
  "/ui/start-menu-layout",
  checkAuth,
  async function (req, res, next) {
    try {
      const startMenuLayout = normalizeStartMenuLayoutForStorage(
        req.body?.startMenuLayout,
      );

      const user = await UserModel.findByIdAndUpdate(
        req.authentication.userId,
        {
          $set: {
            "ui.startMenuLayout": {
              ...startMenuLayout,
              updatedAt: new Date(),
            },
          },
        },
        { returnDocument: "after" },
      ).select("ui.startMenuLayout");

      if (!user) {
        return res.status(404).json({ message: "User not found." });
      }

      return res.status(200).json({
        startMenuLayout: normalizeStartMenuLayoutForStorage(
          user.ui?.startMenuLayout,
        ),
      });
    } catch (error) {
      return next(error);
    }
  },
);

UserRouter.get(
  "/settings/music-playlist",
  checkAuth,
  async function (req, res, next) {
    try {
      const user = await UserModel.findById(req.authentication.userId).select(
        "settings.musicPlaylist",
      );

      if (!user) {
        return res.status(404).json({ message: "User not found." });
      }

      return res.status(200).json({
        musicPlaylist: normalizeMusicPlaylistForStorage(
          user?.settings?.musicPlaylist,
        ),
      });
    } catch (error) {
      return next(error);
    }
  },
);

UserRouter.put(
  "/settings/music-playlist",
  checkAuth,
  async function (req, res, next) {
    try {
      const nextPlaylist = normalizeMusicPlaylistForStorage(
        req.body?.musicPlaylist,
      );

      const user = await UserModel.findByIdAndUpdate(
        req.authentication.userId,
        {
          $set: {
            "settings.musicPlaylist": nextPlaylist,
          },
        },
        { returnDocument: "after" },
      ).select("settings.musicPlaylist");

      if (!user) {
        return res.status(404).json({ message: "User not found." });
      }

      return res.status(200).json({
        message: "Music playlist saved.",
        musicPlaylist: normalizeMusicPlaylistForStorage(
          user?.settings?.musicPlaylist,
        ),
      });
    } catch (error) {
      return next(error);
    }
  },
);

////////UpdateUser
UserRouter.get("/update/:id", async function (req, res, next) {
  try {
    const profile = await UserModel.findById(req.params.id)
      .select(
        [
          "auth.username",
          "profile.firstname",
          "profile.lastname",
          "profile.bio",
          "profile.email",
          "profile.phone",
          "profile.dob",
          "profile.hometown",
          "profile.studying",
          "profile.working",
          "profile.picture.profilePic.index",
          "profile.picture.profilePic.viewport",
          "settings",
          "connections",
          "friends",
          "status",
          "bio",
        ].join(" "),
      )
      .lean();

    if (!profile) {
      return res.status(404).json({
        message: "User not found.",
      });
    }

    const subjectProfile = getSubjectBio(profile);

    const memoryUser = await UserModel.findById(req.params.id)
      .select(
        [
          "memory.MOI",
          "memory.MOA.user.images",
          "memory.MOA.user.videos",
        ].join(" "),
      )
      .lean();
    const memoryDoc = buildUserMemoryLean(memoryUser?.memory, {
      includeCourses: true,
      includeLectures: true,
    });

    const imageGallery = getMemoryLocalGallery(memoryDoc);
    const flattenedCourses = Array.isArray(memoryDoc?.courses)
      ? memoryDoc.courses
      : [];
    const flattenedLectures = Array.isArray(memoryDoc?.lectures)
      ? memoryDoc.lectures
      : [];

    const profilePicture = getLegacyProfilePicture(profile);
    const profilePictureViewport = getLegacyProfilePictureViewport(profile);
    const homeDrawing = {
      draftPaths: [],
      appliedPaths: [],
      textItems: [],
      updatedAt: null,
    };

    const connectionEntries = Array.isArray(profile.connections)
      ? profile.connections
      : [];
    const hasResolvableConnectionIds = connectionEntries.some((entry) =>
      Boolean(String(entry?.id || entry?.userID || "").trim()),
    );
    const rawRelationshipEntries = hasResolvableConnectionIds
      ? connectionEntries
      : Array.isArray(profile.friends)
        ? profile.friends
        : connectionEntries;
    const friendEntries = rawRelationshipEntries.map((entry) => {
      const normalizedEntry =
        typeof entry === "object" && entry !== null ? entry : {};

      return {
        ...normalizedEntry,
        userID:
          normalizedEntry?.id ||
          normalizedEntry?.userID ||
          normalizedEntry?._id ||
          (typeof entry === "object" && entry !== null ? null : entry),
        userMode:
          normalizedEntry?.mode ||
          normalizedEntry?.userMode ||
          normalizedEntry?.relationship?.userMode ||
          "stranger",
      };
    });
    const friendIds = Array.from(
      new Set(
        friendEntries
          .map((entry) => {
            if (!entry) {
              return "";
            }

            if (typeof entry === "object" && entry !== null) {
              const candidate = entry.userID || entry._id || entry;
              const normalized =
                typeof candidate === "object" && candidate !== null
                  ? candidate._id || candidate
                  : candidate;
              return String(normalized || "").trim();
            }

            return String(entry || "").trim();
          })
          .filter(Boolean),
      ),
    );

    const friendUsers = friendIds.length
      ? await UserModel.find({ _id: { $in: friendIds } })
          .select(
            [
              "auth.username",
              "profile.firstname",
              "profile.lastname",
              "profile.dob",
              "profile.email",
              "profile.phone",
              "profile.bio",
              "profile.studying",
              "profile.working",
              "profile.picture.profilePic.index",
              "profile.picture.profilePic.viewport",
              "status",
              "memory.MOI.studyPlanner.settings.messageFriend.to",
            ].join(" "),
          )
          .lean()
      : [];
    const friendUserById = new Map(
      friendUsers.map((friendUser) => [String(friendUser._id), friendUser]),
    );

    const friends = friendEntries
      .map((entry) => {
        if (!entry) {
          return null;
        }

        if (typeof entry === "object" && entry !== null) {
          const candidate = entry.userID || entry._id || entry;
          const friendId = String(
            typeof candidate === "object" && candidate !== null
              ? candidate._id || ""
              : candidate || "",
          ).trim();
          const friendUser = friendId ? friendUserById.get(friendId) : null;
          return friendUser
            ? mapFriendEntryForClient({ ...entry, userID: friendUser })
            : mapFriendEntryForClient(entry);
        }

        const friendId = String(entry || "").trim();
        const friendUser = friendId ? friendUserById.get(friendId) : null;
        return friendUser
          ? mapFriendEntryForClient({ userID: friendUser })
          : mapFriendEntryForClient({ userID: friendId });
      })
      .filter(Boolean);

    const responsePayload = {
      identity: buildLegacyIdentity(profile),
      profile: subjectProfile,
      bio: subjectProfile,
      friends: friends,
      chat: buildLegacyChatFromConnections(profile.connections),
      settings: profile.settings || {},
      memory: {
        ...(memoryDoc || {}),
        courses: flattenedCourses,
        lectures: flattenedLectures,
      },
      media: {
        profilePicture,
        profilePictureViewport,
        imageGallery,
        homeDrawing,
      },
    };
    return res.status(200).json(responsePayload);
  } catch (error) {
    return next(error);
  }
});

UserRouter.get(
  "/planner-snapshot/:my_id",
  checkAuth,
  requireSelfParam("my_id"),
  async function (req, res, next) {
    try {
      const requestStart = Date.now();
      const memoryUser = await UserModel.findById(req.params.my_id)
        .select("memory.MOI")
        .lean();

      const memoryDoc = memoryUser
        ? buildUserMemoryLean(memoryUser.memory, {
            includeCourses: true,
            includeLectures: true,
          })
        : null;

      if (!memoryDoc) {
        return res.status(404).json({
          message: "User memory not found.",
        });
      }

      const courses = Array.isArray(memoryDoc?.courses) ? memoryDoc.courses : [];
      const lectures = Array.isArray(memoryDoc?.lectures) ? memoryDoc.lectures : [];
      const totalMs = Date.now() - requestStart;

      if (totalMs >= 300) {
        console.warn(
          `[UserAPI:planner-snapshot] slow request ${req.params.my_id} total=${totalMs}ms counts=${JSON.stringify(
            {
              courses: courses.length,
              lectures: lectures.length,
            },
          )}`,
        );
      }

      return res.status(200).json({
        courses,
        lectures,
      });
    } catch (error) {
      return next(error);
    }
  },
);

UserRouter.get(
  "/planner-courses/:my_id",
  checkAuth,
  requireSelfParam("my_id"),
  async function (req, res, next) {
    try {
      const memoryUser = await UserModel.findById(req.params.my_id)
        .select("memory.MOI")
        .lean();
      const memoryDoc = memoryUser
        ? buildUserMemoryLean(memoryUser.memory, {
            includeCourses: true,
            includeLectures: false,
          })
        : null;

      if (!memoryDoc) {
        return res.status(404).json({
          message: "User memory not found.",
        });
      }

      return res.status(200).json({
        courses: Array.isArray(memoryDoc?.courses) ? memoryDoc.courses : [],
      });
    } catch (error) {
      return next(error);
    }
  },
);

UserRouter.get(
  "/planner-lectures/:my_id",
  checkAuth,
  requireSelfParam("my_id"),
  async function (req, res, next) {
    try {
      const memoryUser = await UserModel.findById(req.params.my_id)
        .select("memory.MOI")
        .lean();
      const memoryDoc = memoryUser
        ? buildUserMemoryLean(memoryUser.memory, {
            includeCourses: false,
            includeLectures: true,
          })
        : null;

      if (!memoryDoc) {
        return res.status(404).json({
          message: "User memory not found.",
        });
      }

      return res.status(200).json({
        lectures: Array.isArray(memoryDoc?.lectures) ? memoryDoc.lectures : [],
      });
    } catch (error) {
      return next(error);
    }
  },
);

UserRouter.post(
  "/editStudyPlannerMeta/:my_id",
  checkAuth,
  requireSelfParam("my_id"),
  async function (req, res, next) {
    try {
      const user = await UserModel.findById(req.params.my_id);
      if (!user) {
        return res.status(404).json({ message: "User not found." });
      }

      const memoryDoc = await ensureUserMemoryDoc(user);
      if (!memoryDoc) {
        return res
          .status(500)
          .json({ message: "Failed to access user memory." });
      }

      const updatedStudyPlanner = updateStudyPlannerMetaInPlanner(
        memoryDoc,
        req.body,
      );
      await memoryDoc.save();

      return res.status(201).json({
        studyPlanner: updatedStudyPlanner,
      });
    } catch (error) {
      return next(error);
    }
  },
);

UserRouter.post(
  "/planner/document-upload/:my_id",
  checkAuth,
  requireSelfParam("my_id"),
  upload.single("file"),
  async function (req, res) {
    try {
      if (!req.file) {
        return res.status(400).json({ message: "No file uploaded." });
      }
      const cloudinaryResult = await cloudinary.uploader.upload(req.file.path, {
        resource_type: "raw",
        folder: `planner/documents/${req.params.my_id}`,
        use_filename: true,
        unique_filename: true,
      });
      fs.unlinkSync(req.file.path);
      return res.status(200).json({
        url: cloudinaryResult.secure_url,
        publicId: cloudinaryResult.public_id,
        bytes: cloudinaryResult.bytes || 0,
        format: cloudinaryResult.format || "",
      });
    } catch (error) {
      if (req.file?.path) {
        fs.unlink(req.file.path, () => {});
      }
      return res.status(500).json({
        message: String(error?.message || "Upload failed."),
      });
    }
  },
);

UserRouter.post(
  "/supadata/youtube-to-text/:my_id",
  checkAuth,
  requireSelfParam("my_id"),
  async function (req, res) {
    try {
      const apiKey = getSupadataApiKey();
      if (!apiKey) {
        return res.status(500).json({
          message: "Missing SUPADATA_API_KEY in the backend environment.",
        });
      }

      const youtubeUrl = String(req.body?.url || "").trim();
      const lang = String(req.body?.lang || "").trim().toLowerCase();
      const mode = normalizeSupadataMode(req.body?.mode);

      if (!youtubeUrl) {
        return res.status(400).json({
          message: "YouTube URL is required.",
        });
      }

      const upstreamResponse = await fetch(
        buildSupadataUrl("/transcript", {
          url: youtubeUrl,
          lang,
          text: "true",
          mode,
        }),
        {
          method: "GET",
          headers: {
            "x-api-key": apiKey,
          },
        },
      );

      const payload = await parseSupadataJsonResponse(upstreamResponse);

      if (payload && typeof payload === "object" && "jobId" in payload) {
        return res.status(202).json({
          status: "queued",
          jobId: String(payload.jobId || "").trim(),
          source: "supadata",
        });
      }

      return res.status(200).json({
        status: "completed",
        content: String(payload?.content || "").trim(),
        lang: String(payload?.lang || "").trim(),
        availableLangs: Array.isArray(payload?.availableLangs)
          ? payload.availableLangs
          : [],
        source: "supadata",
      });
    } catch (error) {
      return res.status(Number(error?.status) || 500).json({
        message: String(error?.message || "Failed to fetch transcript."),
        error: error?.payload || null,
      });
    }
  },
);

UserRouter.get(
  "/supadata/youtube-to-text/:my_id/:jobId",
  checkAuth,
  requireSelfParam("my_id"),
  async function (req, res) {
    try {
      const apiKey = getSupadataApiKey();
      if (!apiKey) {
        return res.status(500).json({
          message: "Missing SUPADATA_API_KEY in the backend environment.",
        });
      }

      const jobId = String(req.params?.jobId || "").trim();
      if (!jobId) {
        return res.status(400).json({
          message: "Job ID is required.",
        });
      }

      const upstreamResponse = await fetch(
        buildSupadataUrl(`/transcript/${encodeURIComponent(jobId)}`),
        {
          method: "GET",
          headers: {
            "x-api-key": apiKey,
          },
        },
      );

      const payload = await parseSupadataJsonResponse(upstreamResponse);
      const normalizedStatus = String(payload?.status || "").trim().toLowerCase();

      return res.status(200).json({
        status: normalizedStatus || "queued",
        content:
          typeof payload?.content === "string"
            ? payload.content
            : Array.isArray(payload?.content)
              ? payload.content
                  .map((entry) => String(entry?.text || "").trim())
                  .filter(Boolean)
                  .join(" ")
              : "",
        lang: String(payload?.lang || "").trim(),
        availableLangs: Array.isArray(payload?.availableLangs)
          ? payload.availableLangs
          : [],
        error: payload?.error || null,
        source: "supadata",
      });
    } catch (error) {
      return res.status(Number(error?.status) || 500).json({
        message: String(error?.message || "Failed to fetch transcript job."),
        error: error?.payload || null,
      });
    }
  },
);

UserRouter.post(
  "/editStudyPlannerProgram/:my_id",
  checkAuth,
  requireSelfParam("my_id"),
  async function (req, res, next) {
    try {
      const user = await UserModel.findById(req.params.my_id);
      if (!user) {
        return res.status(404).json({ message: "User not found." });
      }

      const memoryDoc = await ensureUserMemoryDoc(user);
      if (!memoryDoc) {
        return res
          .status(500)
          .json({ message: "Failed to access user memory." });
      }

      const updatedStudyPlanner = updateStudyPlannerProgramInPlanner(
        memoryDoc,
        req.body,
      );
      await memoryDoc.save();

      return res.status(201).json({
        studyPlanner: updatedStudyPlanner,
      });
    } catch (error) {
      return next(error);
    }
  },
);

UserRouter.get(
  "/studyPlanner/:my_id",
  checkAuth,
  requireSelfParam("my_id"),
  async function (req, res, next) {
    try {
      const memoryDoc = await findUserMemoryLean(req.params.my_id, {
        includeCourses: true,
        includeLectures: true,
      });
      if (!memoryDoc) {
        return res.status(404).json({ message: "User not found." });
      }

      const studyPlanner =
        memoryDoc?.studyPlanner && typeof memoryDoc.studyPlanner === "object"
          ? {
              ...memoryDoc.studyPlanner,
              programExams: normalizeProgramExamsForPlanner(memoryDoc.studyPlanner),
              programComponents: normalizeProgramComponentsForPlanner(memoryDoc.studyPlanner),
              programFailingRules: normalizeProgramFailingRulesForPlanner(memoryDoc.studyPlanner),
            }
          : {};

      return res.status(200).json({ studyPlanner });
    } catch (error) {
      return next(error);
    }
  },
);

UserRouter.post(
  "/editStudyPlannerComponents/:my_id",
  checkAuth,
  requireSelfParam("my_id"),
  async function (req, res, next) {
    try {
      const user = await UserModel.findById(req.params.my_id);
      if (!user) {
        return res.status(404).json({ message: "User not found." });
      }

      const memoryDoc = await ensureUserMemoryDoc(user);
      if (!memoryDoc) {
        return res
          .status(500)
          .json({ message: "Failed to access user memory." });
      }

      const updatedStudyPlanner = updateStudyPlannerComponentsInPlanner(
        memoryDoc,
        req.body,
      );
      await memoryDoc.save();

      return res.status(201).json({
        studyPlanner: updatedStudyPlanner,
      });
    } catch (error) {
      return next(error);
    }
  },
);

UserRouter.post(
  "/editStudyPlannerIntervals/:my_id",
  checkAuth,
  requireSelfParam("my_id"),
  async function (req, res, next) {
    try {
      const user = await UserModel.findById(req.params.my_id);
      if (!user) {
        return res.status(404).json({ message: "User not found." });
      }

      const memoryDoc = await ensureUserMemoryDoc(user);
      if (!memoryDoc) {
        return res
          .status(500)
          .json({ message: "Failed to access user memory." });
      }

      const updatedStudyPlanner = updateStudyPlannerIntervalsInPlanner(
        memoryDoc,
        req.body,
      );
      await memoryDoc.save();

      return res.status(201).json({
        studyPlanner: updatedStudyPlanner,
      });
    } catch (error) {
      return next(error);
    }
  },
);

UserRouter.post(
  "/editStudyPlannerIntervalStatus/:my_id",
  checkAuth,
  requireSelfParam("my_id"),
  async function (req, res, next) {
    try {
      const user = await UserModel.findById(req.params.my_id);
      if (!user) {
        return res.status(404).json({ message: "User not found." });
      }

      const memoryDoc = await ensureUserMemoryDoc(user);
      if (!memoryDoc) {
        return res
          .status(500)
          .json({ message: "Failed to access user memory." });
      }

      const updatedStudyPlanner = updateStudyPlannerIntervalStatusInPlanner(
        memoryDoc,
        req.body,
      );
      await memoryDoc.save();

      return res.status(201).json({
        studyPlanner: updatedStudyPlanner,
      });
    } catch (error) {
      return next(error);
    }
  },
);

UserRouter.post(
  "/editStudyPlannerCourses/:my_id",
  checkAuth,
  requireSelfParam("my_id"),
  async function (req, res, next) {
    try {
      const user = await UserModel.findById(req.params.my_id);
      if (!user) {
        return res.status(404).json({ message: "User not found." });
      }

      const memoryDoc = await ensureUserMemoryDoc(user);
      if (!memoryDoc) {
        return res
          .status(500)
          .json({ message: "Failed to access user memory." });
      }

      const updatedStudyPlanner = updateStudyPlannerCoursesInPlanner(
        memoryDoc,
        req.body,
      );
      await memoryDoc.save();

      return res.status(201).json({
        studyPlanner: updatedStudyPlanner,
      });
    } catch (error) {
      return next(error);
    }
  },
);

UserRouter.post(
  "/editStudyPlannerDocuments/:my_id",
  checkAuth,
  requireSelfParam("my_id"),
  async function (req, res, next) {
    try {
      const user = await UserModel.findById(req.params.my_id);
      if (!user) {
        return res.status(404).json({ message: "User not found." });
      }
      const memoryDoc = await ensureUserMemoryDoc(user);
      if (!memoryDoc) {
        return res.status(500).json({ message: "Failed to access user memory." });
      }
      const updatedStudyPlanner = updateStudyPlannerDocumentsInPlanner(memoryDoc, req.body);
      await memoryDoc.save();
      return res.status(201).json({ studyPlanner: updatedStudyPlanner });
    } catch (error) {
      return next(error);
    }
  },
);

UserRouter.post(
  "/editStudyPlannerLectures/:my_id",
  checkAuth,
  requireSelfParam("my_id"),
  async function (req, res, next) {
    try {
      const user = await UserModel.findById(req.params.my_id);
      if (!user) {
        return res.status(404).json({ message: "User not found." });
      }
      const memoryDoc = await ensureUserMemoryDoc(user);
      if (!memoryDoc) {
        return res.status(500).json({ message: "Failed to access user memory." });
      }
      const updatedStudyPlanner = updateStudyPlannerLecturesInPlanner(memoryDoc, req.body);
      await memoryDoc.save();
      return res.status(201).json({ studyPlanner: updatedStudyPlanner });
    } catch (error) {
      return next(error);
    }
  },
);

UserRouter.post(
  "/editStudyPlannerStudySessions/:my_id",
  checkAuth,
  requireSelfParam("my_id"),
  async function (req, res, next) {
    try {
      const user = await UserModel.findById(req.params.my_id);
      if (!user) {
        return res.status(404).json({ message: "User not found." });
      }
      const memoryDoc = await ensureUserMemoryDoc(user);
      if (!memoryDoc) {
        return res.status(500).json({ message: "Failed to access user memory." });
      }
      const updatedStudyPlanner = updateStudyPlannerStudySessionsInPlanner(
        memoryDoc,
        req.body,
      );
      await memoryDoc.save();
      return res.status(201).json({ studyPlanner: updatedStudyPlanner });
    } catch (error) {
      return next(error);
    }
  },
);

UserRouter.post(
  "/editStudyPlanAid/:my_id",
  checkAuth,
  requireSelfParam("my_id"),
  async function (req, res, next) {
    try {
      const user = await UserModel.findById(req.params.my_id);
      if (!user) {
        return res.status(404).json({ message: "User not found." });
      }

      const memoryDoc = await ensureUserMemoryDoc(user);
      if (!memoryDoc) {
        return res
          .status(500)
          .json({ message: "Failed to access user memory." });
      }

      updateStudyPlanAidInPlanner(memoryDoc, req.body);
      await memoryDoc.save();
      const studyPlannerRoot =
        memoryDoc?.studyPlanner && typeof memoryDoc.studyPlanner === "object"
          ? memoryDoc.studyPlanner
          : {};
      const programComponents = Array.isArray(studyPlannerRoot?.programComponents)
        ? studyPlannerRoot.programComponents
        : [];
      const componentIntervals = programComponents.map((componentEntry) => ({
        componentId: String(
          componentEntry && typeof componentEntry === "object"
            ? componentEntry?.componentId ?? componentEntry?.label ?? ""
            : componentEntry,
        ).trim(),
        componentIntervals: [],
      }));

      return res.status(201).json({
        componentIntervals,
      });
    } catch (error) {
      return next(error);
    }
  },
);

UserRouter.put("/profile", checkAuth, async function (req, res, next) {
  try {
    const body = req.body && typeof req.body === "object" ? req.body : {};
    const hasField = (fieldName) =>
      Object.prototype.hasOwnProperty.call(body, fieldName);
    const existingUser = await UserModel.findById(req.authentication.userId)
      .select(
        [
          "auth.username",
          "profile.firstname",
          "profile.lastname",
          "profile.studying.time.current.programTerm",
          "settings.ui.scale",
          "settings.ui.updatedAt",
        ].join(" "),
      )
      .lean();
    if (!existingUser?._id) {
      return res.status(404).json({ message: "User not found." });
    }
    const currentUsername = String(
      existingUser?.auth?.username || req.authentication?.username || "",
    ).trim();

    const nextFirstname = String(
      body?.firstname ?? existingUser?.profile?.firstname ?? "",
    ).trim();
    const nextLastname = String(
      body?.lastname ?? existingUser?.profile?.lastname ?? "",
    ).trim();
    const nextUsername = String(body?.username ?? currentUsername).trim();

    if (!nextFirstname || !nextLastname || !nextUsername) {
      return res.status(400).json({
        message: "First name, last name, and username are required.",
      });
    }

    if (nextUsername !== currentUsername) {
      const existingUsernameUser = await UserModel.findOne({
        "auth.username": nextUsername,
        _id: { $ne: req.authentication.userId },
      }).select("_id");

      if (existingUsernameUser) {
        return res.status(409).json({
          message: "That username is already in use.",
        });
      }
    }

    const requestedAiProvider = String(
      body?.aiProvider ?? resolveDefaultAiProvider(),
    )
      .trim()
      .toLowerCase();

    const nextAiProvider = ["openai", "groq", "gemini", "kimi"].includes(
      requestedAiProvider,
    )
      ? requestedAiProvider
      : resolveDefaultAiProvider();

    const nextProgram = String(body?.program ?? "").trim();
    const nextUniversity = String(body?.university ?? "").trim();
    const nextFaculty = String(body?.faculty ?? "").trim();
    const nextComponentsClassFromBody = normalizeComponentsClassList(
      body?.componentsClass,
    );
    const existingComponentsClass = normalizeComponentsClassList(
      existingUser?.profile?.studying?.componentsClass,
    );
    const nextComponentsClass = hasField("componentsClass")
      ? nextComponentsClassFromBody
      : existingComponentsClass;
    const nextLanguage = String(body?.language ?? "").trim();
    const nextTotalYearsNum = String(body?.totalYearsNum ?? "").trim();
    const nextStartProgramYearInterval = String(
      body?.startProgramYearInterval ?? "",
    ).trim();
    const nextStartProgramTerm = String(body?.startProgramTerm ?? "").trim();
    const nextCurrentProgramYearNum = String(
      body?.currentProgramYearNum ?? body?.studyYear ?? "",
    ).trim();
    const nextCurrentProgramYearInterval = String(
      body?.currentProgramYearInterval ?? body?.currentAcademicYear ?? "",
    ).trim();
    const nextCurrentProgramTerm = getProgramTermNumber(
      body?.currentProgramTerm,
      body?.term,
    );
    const nextBio = String(body?.bio ?? "").trim();
    const nextEmail = String(body?.email ?? "").trim();
    const nextPhone = String(body?.phone ?? "").trim();
    const rawDobInput = body?.dob;
    let nextDob = null;
    if (rawDobInput !== undefined) {
      if (rawDobInput === null) {
        nextDob = null;
      } else {
        const normalizedDobText = String(rawDobInput || "").trim();
        if (normalizedDobText) {
          const parsedDob = new Date(normalizedDobText);
          if (!Number.isNaN(parsedDob.getTime())) {
            nextDob = parsedDob;
          }
        }
      }
    }
    const nextHometownCountry = String(body?.hometownCountry ?? "").trim();
    const nextHometownCity = String(body?.hometownCity ?? "").trim();
    const nextCompany = String(body?.company ?? "").trim();
    const nextPosition = String(body?.position ?? "").trim();
    const nextTotalYearsNumNumber = Number(nextTotalYearsNum);
    const nextCurrentProgramYearNumNumber = Number(nextCurrentProgramYearNum);
    const requestedSettings =
      body?.settings && typeof body.settings === "object" ? body.settings : null;
    const requestedSettingsUi =
      requestedSettings?.ui && typeof requestedSettings.ui === "object"
        ? requestedSettings.ui
        : null;
    const normalizeUiScaleEntries = (value) =>
      (Array.isArray(value) ? value : [])
        .map((entry) => {
          const element = String(entry?.element || "").trim();
          const scaleNum = Number(entry?.scaleNum);

          if (!element) {
            return null;
          }

          return {
            element,
            scaleNum: Number.isFinite(scaleNum) ? scaleNum : 1,
          };
        })
        .filter(Boolean);
    const requestedSettingsScaleSource =
      requestedSettingsUi?.scale ?? requestedSettings?.scale;
    const nextUiScaleEntries =
      requestedSettingsScaleSource !== undefined
        ? normalizeUiScaleEntries(requestedSettingsScaleSource)
        : null;

    const updateSet = {
      "profile.firstname": nextFirstname,
      "profile.lastname": nextLastname,
      "auth.username": nextUsername,
    };

    if (hasField("bio")) {
      updateSet["profile.bio"] = nextBio;
    }
    if (hasField("email")) {
      updateSet["profile.email"] = nextEmail;
    }
    if (hasField("phone")) {
      updateSet["profile.phone"] = nextPhone;
    }
    if (hasField("dob")) {
      updateSet["profile.dob"] =
        nextDob instanceof Date && !Number.isNaN(nextDob.getTime())
          ? nextDob
          : null;
    }
    if (hasField("hometownCountry")) {
      updateSet["profile.hometown.Country"] = nextHometownCountry;
    }
    if (hasField("hometownCity")) {
      updateSet["profile.hometown.City"] = nextHometownCity;
    }
    if (hasField("program")) {
      updateSet["profile.studying.id.program"] = nextProgram;
    }
    if (hasField("university")) {
      updateSet["profile.studying.location.university"] = nextUniversity;
    }
    if (hasField("faculty")) {
      updateSet["profile.studying.location.faculty"] = nextFaculty;
    }
    if (hasField("componentsClass")) {
      updateSet["profile.studying.id.components"] = nextComponentsClass;
    }
    if (hasField("language")) {
      updateSet["profile.studying.language"] = nextLanguage;
    }
    if (hasField("totalYearsNum")) {
      updateSet["profile.studying.academicYearsIntervals.total"] =
        nextTotalYearsNum === "" || !Number.isFinite(nextTotalYearsNumNumber)
          ? null
          : nextTotalYearsNumNumber;
    }
    if (hasField("startProgramYearInterval")) {
      updateSet["profile.studying.academicYearsIntervals.first.interval"] =
        nextStartProgramYearInterval || null;
    }
    if (hasField("startProgramTerm")) {
      updateSet["profile.studying.academicYearsIntervals.first.term"] =
        nextStartProgramTerm || null;
    }
    if (hasField("currentProgramYearNum") || hasField("studyYear")) {
      updateSet["profile.studying.academicYearsIntervals.current.num"] =
        nextCurrentProgramYearNum === "" ||
        !Number.isFinite(nextCurrentProgramYearNumNumber)
          ? null
          : nextCurrentProgramYearNumNumber;
    }
    if (hasField("currentProgramYearInterval") || hasField("currentAcademicYear")) {
      updateSet["profile.studying.academicYearsIntervals.current.interval"] =
        nextCurrentProgramYearInterval || null;
    }
    if (hasField("currentProgramTerm") || hasField("term")) {
      updateSet["profile.studying.academicYearsIntervals.current.term"] =
        nextCurrentProgramTerm || null;
    }
    if (hasField("company")) {
      updateSet["profile.working.company"] = nextCompany;
    }
    if (hasField("position")) {
      updateSet["profile.working.position"] = nextPosition;
    }
    if (nextUiScaleEntries !== null) {
      updateSet["settings.ui.scale"] = nextUiScaleEntries;
      updateSet["settings.ui.updatedAt"] = new Date();
    }

    let nextProfilePictureViewport = null;

    const requestedViewport = body?.profilePictureViewport;
    if (requestedViewport && typeof requestedViewport === "object") {
      const rawScale = Number(requestedViewport?.scale);
      const rawOffsetX = Number(requestedViewport?.offsetX);
      const rawOffsetY = Number(requestedViewport?.offsetY);

      nextProfilePictureViewport = {
        scale: Number.isFinite(rawScale)
          ? Math.min(Math.max(rawScale, 1), 4)
          : 1,
        offsetX: Number.isFinite(rawOffsetX) ? rawOffsetX : 0,
        offsetY: Number.isFinite(rawOffsetY) ? rawOffsetY : 0,
        updatedAt: new Date(),
      };

      updateSet["profile.picture.profilePic.viewport"] = {
        x: nextProfilePictureViewport.offsetX,
        y: nextProfilePictureViewport.offsetY,
        zoom: nextProfilePictureViewport.scale,
        width: null,
        height: null,
      };
    }

    let nextHomeDrawing = null;

    const requestedHomeDrawing = body?.homeDrawing;
    if (requestedHomeDrawing && typeof requestedHomeDrawing === "object") {
      const sanitizeDrawingPaths = (requestedPaths) =>
        (Array.isArray(requestedPaths) ? requestedPaths : [])
          .slice(0, 48)
          .map((path) => {
            const paletteId =
              String(path?.paletteId || "aurora").trim() || "aurora";
            const stroke = String(path?.stroke || "").trim();
            const glow = String(path?.glow || "").trim();
            const bulb = String(path?.bulb || "").trim();
            const points = Array.isArray(path?.points)
              ? path.points
                  .map((point) => ({
                    x: Number(point?.x),
                    y: Number(point?.y),
                  }))
                  .filter(
                    (point) =>
                      Number.isFinite(point.x) && Number.isFinite(point.y),
                  )
                  .slice(0, 2500)
              : [];

            return {
              paletteId,
              stroke,
              glow,
              bulb,
              points,
            };
          })
          .filter((path) => path.points.length >= 2);

      const sanitizeTextItems = (requestedItems) =>
        (Array.isArray(requestedItems) ? requestedItems : [])
          .slice(0, 80)
          .map((item, index) => ({
            id:
              String(item?.id || "").trim() ||
              `home-text-${Date.now()}-${index}`,
            paletteId: String(item?.paletteId || "aurora").trim() || "aurora",
            text: String(item?.text || "")
              .trim()
              .slice(0, 140),
            x: Number(item?.x),
            y: Number(item?.y),
          }))
          .filter(
            (item) =>
              item.text && Number.isFinite(item.x) && Number.isFinite(item.y),
          );

      const legacyAppliedPaths =
        !Array.isArray(requestedHomeDrawing?.appliedPaths) &&
        Array.isArray(requestedHomeDrawing?.paths)
          ? requestedHomeDrawing.paths
          : [];

      nextHomeDrawing = {
        draftPaths: sanitizeDrawingPaths(requestedHomeDrawing?.draftPaths),
        appliedPaths: sanitizeDrawingPaths(
          Array.isArray(requestedHomeDrawing?.appliedPaths)
            ? requestedHomeDrawing.appliedPaths
            : legacyAppliedPaths,
        ),
        textItems: sanitizeTextItems(requestedHomeDrawing?.textItems),
        updatedAt: new Date(),
      };
    }

    await UserModel.updateOne(
      { _id: req.authentication.userId },
      { $set: updateSet },
    );

    if (hasField("aiProvider")) {
      await upsertAiSettings(req.authentication.userId, {
        "ai.aiProvider": nextAiProvider,
        "ai.updatedAt": new Date(),
      });
    }

    const updatedSettings = await UserModel.findById(req.authentication.userId)
      .select("settings")
      .lean();

    const responseInfo = {
      firstname: nextFirstname,
      lastname: nextLastname,
      username: nextUsername,
      bio: nextBio,
      email: nextEmail,
      phone: nextPhone,
      dob:
        nextDob instanceof Date && !Number.isNaN(nextDob.getTime())
          ? nextDob.toISOString()
          : null,
      hometownCountry: nextHometownCountry,
      hometownCity: nextHometownCity,
      faculty: nextFaculty,
      componentsClass: nextComponentsClass,
      program: nextProgram,
      university: nextUniversity,
      language: nextLanguage,
      currentAcademicYear: nextCurrentProgramYearInterval,
      studyYear: nextCurrentProgramYearNum,
      term: nextCurrentProgramTerm,
      totalYearsNum: nextTotalYearsNum,
      startProgramYearInterval: nextStartProgramYearInterval,
      startProgramTerm: nextStartProgramTerm,
      currentProgramYearNum: nextCurrentProgramYearNum,
      currentProgramYearInterval: nextCurrentProgramYearInterval,
      currentProgramTerm: nextCurrentProgramTerm,
      company: nextCompany,
      position: nextPosition,
      aiProvider: nextAiProvider,
    };

    const responseMedia = {
      ...(nextProfilePictureViewport
        ? { profilePictureViewport: nextProfilePictureViewport }
        : {}),
      ...(nextHomeDrawing ? { homeDrawing: nextHomeDrawing } : {}),
    };

    return res.status(200).json({
      message: "Personal information updated.",
      info: responseInfo,
      media: responseMedia,
      settings: updatedSettings?.settings || null,
    });
  } catch (error) {
    next(error);
  }
});

UserRouter.get("/image-gallery", checkAuth, async function (req, res, next) {
  try {
    const user = await UserModel.findById(req.authentication.userId)
      .select(
        [
          "memory.MOA.user.images",
          "memory.MOA.user.videos",
          "profile.picture.profilePic.index",
          "profile.picture.profilePic.viewport",
          "profile.profilePic",
        ].join(" "),
      )
      .lean();

    if (!user) {
      return res.status(404).json({
        message: "User not found.",
      });
    }

    const imageGallery = getMemoryLocalGallery(user.memory || {});
    const legacyProfilePicture = getLegacyProfilePicture(user);
    const profilePicture = normalizeStoredGalleryImage(legacyProfilePicture)
      ? {
          ...normalizeStoredGalleryImage(legacyProfilePicture),
          updatedAt: legacyProfilePicture?.updatedAt || null,
        }
      : {
          url: "",
          publicId: "",
          assetId: "",
          updatedAt: null,
        };

    return res.status(200).json({
      imageGallery,
      profilePicture,
      folder: buildUserImageGalleryFolder(req.authentication.userId),
    });
  } catch (error) {
    return next(error);
  }
});

UserRouter.get("/rtc/config", checkAuth, async function (req, res, next) {
  try {
    const iceServers = getRtcIceServers(req.authentication.userId);
    const turnRestCredentials = buildTurnRestCredentials(
      req.authentication.userId,
    );
    const turnUrls = iceServers.flatMap((entry) =>
      Array.isArray(entry?.urls) ? entry.urls : [entry?.urls],
    );

    console.info("[rtc-config]", {
      userId: String(req.authentication.userId || "").trim(),
      authMode: turnRestCredentials ? "shared-secret" : "static",
      turnEnabled: turnUrls.some(
        (url) =>
          String(url || "").startsWith("turn:") ||
          String(url || "").startsWith("turns:"),
      ),
      turnUrls: turnUrls.filter((url) => {
        const normalizedUrl = String(url || "").trim();
        return (
          normalizedUrl.startsWith("turn:") ||
          normalizedUrl.startsWith("turns:")
        );
      }),
      username: turnRestCredentials?.username || "",
      credentialPreview: maskTurnCredential(
        turnRestCredentials?.credential || "",
      ),
      ttlSeconds: turnRestCredentials?.ttlSeconds || null,
      expiresAt: turnRestCredentials?.expiresAt || null,
    });

    return res.status(200).json({
      iceServers,
      ttlSeconds: turnRestCredentials?.ttlSeconds || null,
      expiresAt: turnRestCredentials?.expiresAt || null,
      authMode: turnRestCredentials ? "shared-secret" : "static",
      turnEnabled: iceServers.some((entry) =>
        Array.isArray(entry?.urls)
          ? entry.urls.some((url) => String(url || "").startsWith("turn:"))
          : String(entry?.urls || "").startsWith("turn:"),
      ),
    });
  } catch (error) {
    return next(error);
  }
});

UserRouter.post("/livekit/token", checkAuth, async function (req, res, next) {
  try {
    const roomName = String(req.body?.roomName || "").trim();
    const callType = req.body?.callType === "video" ? "video" : "audio";

    if (!roomName) {
      return res.status(400).json({
        message: "roomName is required.",
      });
    }

    const liveKitConfig = getLiveKitServerConfig();

    if (!liveKitConfig.isReady) {
      return res.status(503).json({
        message: "LiveKit is not configured on backend.",
        missing: [
          "LIVEKIT_URL",
          "LIVEKIT_API_KEY",
          "LIVEKIT_API_SECRET",
        ].filter((key) => !String(process.env[key] || "").trim()),
      });
    }

    const user = await UserModel.findById(req.authentication.userId).select(
      "auth.username profile.firstname profile.lastname bio.firstname bio.lastname",
    );

    if (!user) {
      return res.status(404).json({
        message: "User not found.",
      });
    }

    const bio = getSubjectBio(user);
    const firstname = String(bio?.firstname || "").trim();
    const lastname = String(bio?.lastname || "").trim();
    const username = String(user?.auth?.username || "").trim();
    const displayName =
      `${firstname} ${lastname}`.trim() ||
      username ||
      `user-${String(req.authentication.userId || "").trim()}`;

    const identity = String(req.authentication.userId || "").trim();
    const tokenPayload = await createLiveKitToken({
      identity,
      name: displayName,
      roomName,
      metadata: {
        userId: identity,
        displayName,
        callType,
      },
    });

    return res.status(200).json({
      roomName,
      url: tokenPayload.url,
      token: tokenPayload.token,
      identity,
      displayName,
      callType,
    });
  } catch (error) {
    return next(error);
  }
});

UserRouter.post(
  "/image-gallery/signature",
  checkAuth,
  async function (req, res, next) {
    try {
      const cloudinaryConfig = getCloudinaryConfig();

      if (!cloudinaryConfig.isReady) {
        return res.status(503).json({
          message: "Cloudinary is not configured on backend.",
          missing: cloudinaryConfig.missing,
        });
      }

      const publicId =
        String(req.body?.publicId || "")
          .trim()
          .slice(0, 180)
          .replace(/[^a-zA-Z0-9/_-]/g, "-") || `media-${Date.now()}`;
      const requestedResourceType = String(req.body?.resourceType || "image")
        .trim()
        .toLowerCase();
      const resourceType =
        requestedResourceType === "video"
          ? "video"
          : requestedResourceType === "raw"
            ? "raw"
            : "image";
      const folder = buildUserImageGalleryFolder(req.authentication.userId);
      const timestamp = Math.floor(Date.now() / 1000);
      const paramsToSign = {
        folder,
        public_id: publicId,
        timestamp,
      };

      const signature = buildCloudinarySignature({
        paramsToSign,
        apiSecret: cloudinaryConfig.apiSecret,
      });

      return res.status(200).json({
        cloudName: cloudinaryConfig.cloudName,
        apiKey: cloudinaryConfig.apiKey,
        timestamp,
        folder,
        publicId,
        resourceType,
        signature,
        uploadUrl: `https://api.cloudinary.com/v1_1/${cloudinaryConfig.cloudName}/${resourceType}/upload`,
      });
    } catch (error) {
      return next(error);
    }
  },
);

UserRouter.put("/image-gallery", checkAuth, async function (req, res, next) {
  try {
    const normalizedImage = normalizeStoredGalleryImage({
      url: req.body?.url || req.body?.secureUrl,
      publicId: req.body?.publicId,
      assetId: req.body?.assetId,
      contentHash: req.body?.contentHash || req.body?.etag,
      folder: req.body?.folder,
      resourceType: req.body?.resourceType,
      mimeType: req.body?.mimeType,
      width: req.body?.width,
      height: req.body?.height,
      format: req.body?.format,
      bytes: req.body?.bytes,
      duration: req.body?.duration,
      visibility: req.body?.visibility,
      createdAt: req.body?.createdAt || new Date(),
    });

    if (!normalizedImage) {
      return res.status(400).json({
        message: "A valid uploaded media file is required.",
      });
    }
    const cloudinaryHash =
      String(normalizedImage.contentHash || "").trim() ||
      (await resolveCloudinaryContentHash(normalizedImage)) ||
      buildFallbackMediaContentHash(normalizedImage);
    const normalizedImageWithHash = {
      ...normalizedImage,
      contentHash: cloudinaryHash,
    };

    const user = await UserModel.findById(req.authentication.userId);

    if (!user) {
      return res.status(404).json({
        message: "User not found.",
      });
    }

    const memoryDoc = await ensureUserMemoryDoc(user);
    if (!memoryDoc) {
      return res.status(500).json({ message: "Failed to access user memory." });
    }

    const existingGallery = getMemoryLocalGallery(memoryDoc);
    const dedupedImages = existingGallery.filter(
      (image) => image.publicId !== normalizedImageWithHash.publicId,
    );
    const nextImageGallery = sortGalleryImages([
      normalizedImageWithHash,
      ...dedupedImages,
    ]);
    const existingProfilePicture = normalizeStoredGalleryImage(
      getLegacyProfilePicture(user),
    );

    setMemoryLocalGallery(memoryDoc, nextImageGallery);

    await memoryDoc.save();

    return res.status(200).json({
      message: "Media saved to gallery.",
      imageGallery: nextImageGallery,
      profilePicture: existingProfilePicture || {
        url: "",
        publicId: "",
        assetId: "",
        updatedAt: null,
      },
    });
  } catch (error) {
    return next(error);
  }
});

UserRouter.post(
  "/image-gallery/backfill-content-hash",
  checkAuth,
  async function (req, res, next) {
    try {
      const user = await UserModel.findById(req.authentication.userId);
      if (!user) {
        return res.status(404).json({ message: "User not found." });
      }

      const memoryDoc = await ensureUserMemoryDoc(user);
      if (!memoryDoc) {
        return res.status(500).json({ message: "Failed to access user memory." });
      }

      const imageGallery = getMemoryLocalGallery(memoryDoc);
      if (!Array.isArray(imageGallery) || imageGallery.length === 0) {
        return res.status(200).json({
          message: "No gallery media found.",
          scannedCount: 0,
          updatedCount: 0,
        });
      }

      let updatedCount = 0;
      const nextImageGallery = [];
      for (const media of imageGallery) {
        const hasHash = String(media?.contentHash || "").trim();
        if (hasHash) {
          nextImageGallery.push(media);
          continue;
        }

        const resolvedHash = await resolveCloudinaryContentHash(media);
        const nextHash = resolvedHash || buildFallbackMediaContentHash(media);
        if (nextHash) {
          updatedCount += 1;
          nextImageGallery.push({
            ...media,
            contentHash: nextHash,
            updatedAt: new Date(),
          });
          continue;
        }

        nextImageGallery.push(media);
      }

      if (updatedCount > 0) {
        setMemoryLocalGallery(memoryDoc, nextImageGallery);
        await memoryDoc.save();
      }

      return res.status(200).json({
        message:
          updatedCount > 0
            ? "Gallery contentHash backfill completed."
            : "No missing contentHash values were resolved.",
        scannedCount: imageGallery.length,
        updatedCount,
      });
    } catch (error) {
      return next(error);
    }
  },
);

UserRouter.put(
  "/image-gallery/profile-picture",
  checkAuth,
  async function (req, res, next) {
    try {
      const selectedPublicId = String(req.body?.publicId || "").trim();
      const user = await UserModel.findById(req.authentication.userId);

      if (!user) {
        return res.status(404).json({
          message: "User not found.",
        });
      }

      const memoryDoc = await ensureUserMemoryDoc(user);
      const imageGallery = getMemoryLocalGallery(memoryDoc);
      const selectedImage = imageGallery.find(
        (image) => image.publicId === selectedPublicId,
      );

      if (!selectedImage) {
        return res.status(404).json({
          message: "Selected image was not found in your gallery.",
        });
      }

      if (selectedImage.resourceType !== "image") {
        return res.status(400).json({
          message: "Only image items can be used as profile picture.",
        });
      }

      user.profile = user.profile || {};
      user.profile.picture = user.profile.picture || {};
      user.profile.picture.profilePic = user.profile.picture.profilePic || {};
      user.profile.picture.profilePic.index = {
        url: selectedImage.url,
        publicId: selectedImage.publicId,
        mimeType: selectedImage.mimeType || "",
        width: selectedImage.width || null,
        height: selectedImage.height || null,
      };

      await user.save();

      return res.status(200).json({
        message: "Profile picture updated.",
        profilePicture: {
          ...getLegacyProfilePicture(user),
          assetId: String(selectedImage?.assetId || "").trim(),
          contentHash: String(selectedImage?.contentHash || "").trim(),
          updatedAt: selectedImage?.updatedAt || new Date(),
        },
        imageGallery: sortGalleryImages(imageGallery),
      });
    } catch (error) {
      return next(error);
    }
  },
);

UserRouter.delete("/image-gallery", checkAuth, async function (req, res, next) {
  try {
    const publicId = String(req.body?.publicId || "").trim();

    if (!publicId) {
      return res.status(400).json({
        message: "publicId is required.",
      });
    }

    const user = await UserModel.findById(req.authentication.userId);

    if (!user) {
      return res.status(404).json({
        message: "User not found.",
      });
    }

    const memoryDoc = await ensureUserMemoryDoc(user);
    if (!memoryDoc) {
      return res.status(500).json({ message: "Failed to access user memory." });
    }

    const imageGallery = getMemoryLocalGallery(memoryDoc);
    const imageToDelete = imageGallery.find(
      (image) => image.publicId === publicId,
    );

    if (!imageToDelete) {
      return res.status(404).json({
        message: "Media not found in gallery.",
      });
    }

    const cloudinaryConfig = getCloudinaryConfig();
    if (cloudinaryConfig.isReady) {
      try {
        await deleteCloudinaryAsset({
          cloudName: cloudinaryConfig.cloudName,
          apiKey: cloudinaryConfig.apiKey,
          apiSecret: cloudinaryConfig.apiSecret,
          publicId: imageToDelete.publicId,
          resourceType: imageToDelete.resourceType || "image",
        });
      } catch (cloudinaryDeleteError) {
        // Keep local deletion successful even if Cloudinary is temporarily unavailable.
        console.warn(
          "Cloudinary deletion failed for gallery media:",
          imageToDelete.publicId,
          cloudinaryDeleteError?.message || cloudinaryDeleteError,
        );
      }
    }

    const nextImageGallery = sortGalleryImages(
      imageGallery.filter((image) => image.publicId !== publicId),
    );
    const currentProfilePublicId = String(
      user?.profile?.picture?.profilePic?.index?.publicId ||
        user?.profile?.profilePic?.publicId ||
        user?.bio?.profilePic?.publicId ||
        "",
    ).trim();
    const currentProfileUrl = String(
      user?.profile?.picture?.profilePic?.index?.url ||
        user?.profile?.profilePic?.url ||
        user?.bio?.profilePic?.url ||
        "",
    ).trim();
    const deletedImageUrl = String(imageToDelete?.url || "").trim();

    setMemoryLocalGallery(memoryDoc, nextImageGallery);
    const shouldSaveUser =
      currentProfilePublicId === publicId ||
      (deletedImageUrl && currentProfileUrl === deletedImageUrl);

    if (shouldSaveUser) {
      user.profile = user.profile || {};
      user.profile.picture = user.profile.picture || {};
      user.profile.picture.profilePic = user.profile.picture.profilePic || {};

      const fallbackImage =
        nextImageGallery.find((image) => image.resourceType === "image") ||
        null;
      const nextProfilePicture = fallbackImage
        ? {
            url: fallbackImage.url,
            publicId: fallbackImage.publicId,
            mimeType: fallbackImage.mimeType || "",
            width: fallbackImage.width || null,
            height: fallbackImage.height || null,
          }
        : {
            url: "",
            publicId: "",
            mimeType: "",
            width: null,
            height: null,
          };

      user.profile.picture.profilePic.index = nextProfilePicture;

      if (user?.bio && typeof user.bio === "object") {
        user.bio.profilePic = nextProfilePicture;
      }
    }

    await memoryDoc.save();

    if (shouldSaveUser) {
      await user.save();
    }

    return res.status(200).json({
      message: "Media deleted from gallery.",
      imageGallery: nextImageGallery,
      profilePicture: getLegacyProfilePicture(user),
    });
  } catch (error) {
    return next(error);
  }
});

UserRouter.put("/change-password", checkAuth, async function (req, res, next) {
  try {
    const currentPassword = String(req.body?.currentPassword || "");
    const nextPassword = String(req.body?.newPassword || "");

    if (!currentPassword || !nextPassword) {
      return res.status(400).json({
        message: "Current password and new password are required.",
      });
    }

    if (nextPassword.length < 6) {
      return res.status(400).json({
        message: "New password must be at least 6 characters long.",
      });
    }

    const user = await UserModel.findById(req.authentication.userId).select(
      "auth.password",
    );

    if (!user) {
      return res.status(404).json({
        message: "User not found.",
      });
    }

    const passwordMatches = await bcrypt.compare(
      currentPassword,
      user.auth?.password || "",
    );

    if (!passwordMatches) {
      return res.status(401).json({
        message: "Current password is not correct.",
      });
    }

    const isSamePassword = await bcrypt.compare(
      nextPassword,
      user.auth?.password || "",
    );

    if (isSamePassword) {
      return res.status(409).json({
        message: "New password must be different from the current password.",
      });
    }

    user.auth = user.auth || {};
    user.auth.password = await bcrypt.hash(nextPassword, 10);
    await user.save();

    return res.status(200).json({
      message: "Password changed successfully.",
    });
  } catch (error) {
    return next(error);
  }
});

UserRouter.post("/verify-password", checkAuth, async function (req, res, next) {
  try {
    const password = String(req.body?.password || "");

    if (!password) {
      return res.status(400).json({
        message: "Password is required.",
      });
    }

    const user = await UserModel.findById(req.authentication.userId).select(
      "auth.password",
    );

    if (!user) {
      return res.status(404).json({
        message: "User not found.",
      });
    }

    const passwordMatches = await bcrypt.compare(
      password,
      user.auth?.password || "",
    );

    if (!passwordMatches) {
      return res.status(401).json({
        message: "Password is not correct.",
      });
    }

    return res.status(200).json({
      message: "Password verified.",
    });
  } catch (error) {
    return next(error);
  }
});

UserRouter.get("/app-last-updated", function (req, res) {
  resolveTimedCache(
    appLastUpdatedCache,
    () => ({
      committedAt: getFrontendLastUpdated(),
      cloudinary: getPublicCloudinaryStatus(),
    }),
    APP_LAST_UPDATED_CACHE_TTL_MS,
  )
    .then((payload) => {
      return res.status(200).json({
        committedAt: payload?.committedAt || null,
        cloudinary: payload?.cloudinary || getPublicCloudinaryStatus(),
      });
    })
    .catch(() => {
      return res.status(200).json({
        committedAt: null,
        cloudinary: getPublicCloudinaryStatus(),
      });
    });
});

UserRouter.delete("/login-log", checkAuth, async function (req, res, next) {
  try {
    const user = await UserModel.findById(req.authentication.userId);

    if (!user) {
      return res.status(404).json({
        message: "User not found.",
      });
    }

    await user.save();

    return res.status(200).json({
      message: "Login log cleared.",
    });
  } catch (error) {
    return next(error);
  }
});

UserRouter.get("/hometown-cities", function (req, res, next) {
  resolveTimedCache(
    hometownCitiesCache,
    async () => {
      const cities = await UserModel.distinct("profile.hometown.City", {
        "profile.hometown.City": { $exists: true, $ne: "" },
      });

      return cities.filter((city) => city && city.trim()).sort();
    },
    HOMETOWN_CITIES_CACHE_TTL_MS,
  )
    .then((cities) => {
      return res.status(200).json({
        cities,
      });
    })
    .catch((error) => {
      return next(error);
    });
});

/////Searching for a user to be a friend
UserRouter.get("/searchUsers/:name", function (req, res, next) {
  UserModel.find({})
    .select(
      [
        "auth.username",
        "profile.firstname",
        "profile.lastname",
        "profile.picture.profilePic.index",
        "status",
      ].join(" "),
    )
    .then((users) => {
      const array = [];
      const searchTerm = String(req.params.name || "")
        .trim()
        .toLowerCase();
      users.forEach((user) => {
        const bio = getSubjectBio(user);
        const firstname = String(bio?.firstname || "").toLowerCase();
        const lastname = String(bio?.lastname || "").toLowerCase();
        const fullName = `${firstname} ${lastname}`.trim();
        const username = String(user?.auth?.username || "").toLowerCase();

        if (
          firstname.includes(searchTerm) ||
          lastname.includes(searchTerm) ||
          fullName.includes(searchTerm) ||
          username.includes(searchTerm)
        ) {
          array.push(user);
        }
      });
      return array;
    })
    .then((array2) => {
      res.status(200).json({
        array: array2,
      });
    })
    .catch(next);
});

// Public doctor profile
UserRouter.get("/profile/:username", function (req, res, next) {
  UserModel.findOne({ "auth.username": req.params.username })
    .select(
      [
        "auth.username",
        "profile.firstname",
        "profile.lastname",
        "profile.picture.profilePic.index",
      ].join(" "),
    )
    .then((user) => {
      if (!user) {
        return res.status(404).json({
          message: "Doctor profile not found.",
        });
      }

      const bio = getSubjectBio(user);
      const profilePicture = getLegacyProfilePicture(user);

      return res.status(200).json({
        username: user.auth?.username || "",
        firstname: bio?.firstname || "",
        lastname: bio?.lastname || "",
        profilePicture: String(profilePicture?.url || "").trim(),
      });
    })
    .catch(next);
});

// ── Video Gate ────────────────────────────────────────────────────────────────

UserRouter.get("/video-gate", checkAuth, async function (req, res, next) {
  try {
    if (req.authentication?.username !== VISIT_LOG_OWNER_USERNAME) {
      return res.status(403).json({ message: "Not allowed." });
    }

    const owner = await UserModel.findOne({
      "auth.username": VISIT_LOG_OWNER_USERNAME,
    })
      .select("settings.videoGate")
      .lean();

    const gate = owner?.settings?.videoGate || {};

    const visitorSummary = await getVideoGateVisitorSummary();

    return res.status(200).json({
      videoGate: {
        enabled: Boolean(gate.enabled),
        companyName: String(gate.companyName || ""),
        hasPassword: Boolean(gate.passwordHash),
        updatedAt: gate.updatedAt || null,
        ...visitorSummary,
      },
    });
  } catch (error) {
    return next(error);
  }
});

UserRouter.get("/video-gate/public", async function (req, res, next) {
  try {
    const ip = getRequestIp(req);
    const [owner, visitorSummary] = await Promise.all([
      UserModel.findOne({ "auth.username": VISIT_LOG_OWNER_USERNAME })
        .select("settings.videoGate")
        .lean(),
      getVideoGateVisitorSummary(),
    ]);

    const gate = owner?.settings?.videoGate || {};
    const enabled = gate.enabled === true;
    const configured = Boolean(gate.companyName && gate.passwordHash);
    const gateKey = configured
      ? `${String(gate.updatedAt || "no-date")}:${String(gate.companyName || "")}`
      : "";
    const visitor = ip
      ? await VisitorsModel.findOne({ ip }).select("videoGate").lean()
      : null;
    const visitorGate = visitor?.videoGate || {};
    const visitorUnlocked =
      configured &&
      visitorGate?.unlocked === true &&
      String(visitorGate?.gateKey || "") === gateKey;

    return res.status(200).json({
      videoGate: {
        enabled,
        configured,
        gateKey,
        visitorUnlocked,
        visitStats: visitorSummary.visitStats,
      },
    });
  } catch (error) {
    return next(error);
  }
});

UserRouter.put("/video-gate", checkAuth, async function (req, res, next) {
  try {
    if (req.authentication?.username !== VISIT_LOG_OWNER_USERNAME) {
      return res.status(403).json({ message: "Not allowed." });
    }

    const enabled = req.body?.enabled !== false;
    const companyName = String(req.body?.companyName || "").trim();
    const password = String(req.body?.password || "").trim();

    if (enabled) {
      // Gate ON = public: video is open to all, no verification needed.
      const updateFields = {
        "settings.videoGate.enabled": true,
        "settings.videoGate.updatedAt": new Date(),
      };
      if (companyName) {
        updateFields["settings.videoGate.companyName"] = companyName.toLowerCase();
      }
      if (password) {
        updateFields["settings.videoGate.passwordHash"] = await bcrypt.hash(password, 10);
      }

      await Promise.all([
        UserModel.updateOne(
          { "auth.username": VISIT_LOG_OWNER_USERNAME },
          { $set: updateFields },
        ),
        VisitorsModel.updateMany(
          {},
          {
            $set: {
              "videoGate.unlocked": false,
              "videoGate.gateKey": "",
              "videoGate.authorizedCompany": "",
              "videoGate.verifiedAt": null,
              "videoGate.updatedAt": new Date(),
            },
          },
        ),
      ]);

      const owner = await UserModel.findOne({
        "auth.username": VISIT_LOG_OWNER_USERNAME,
      })
        .select("settings.videoGate")
        .lean();

      const gate = owner?.settings?.videoGate || {};
      const visitorSummary = await getVideoGateVisitorSummary();

      return res.status(200).json({
        videoGate: {
          enabled: true,
          companyName: String(gate.companyName || ""),
          hasPassword: Boolean(gate.passwordHash),
          updatedAt: gate.updatedAt || null,
          ...visitorSummary,
        },
      });
    }

    // Gate OFF = restricted: only allowed visitors can view the video.
    if (!companyName) {
      return res.status(400).json({ message: "Company name is required." });
    }

    const existing = await UserModel.findOne({
      "auth.username": VISIT_LOG_OWNER_USERNAME,
    })
      .select("settings.videoGate.passwordHash")
      .lean();

    const existingHash = existing?.settings?.videoGate?.passwordHash || "";

    if (!password && !existingHash) {
      return res.status(400).json({ message: "Password is required." });
    }

    const passwordHash = password ? await bcrypt.hash(password, 10) : existingHash;

    await Promise.all([
      UserModel.updateOne(
        { "auth.username": VISIT_LOG_OWNER_USERNAME },
        {
          $set: {
            "settings.videoGate.enabled": false,
            "settings.videoGate.companyName": companyName.toLowerCase(),
            "settings.videoGate.passwordHash": passwordHash,
            "settings.videoGate.updatedAt": new Date(),
          },
        },
      ),
      VisitorsModel.updateMany(
        {},
        {
          $set: {
            "videoGate.unlocked": false,
            "videoGate.gateKey": "",
            "videoGate.authorizedCompany": "",
            "videoGate.verifiedAt": null,
            "videoGate.updatedAt": new Date(),
          },
        },
      ),
    ]);

    const visitorSummary = await getVideoGateVisitorSummary();

    return res.status(200).json({
      videoGate: {
        enabled: false,
        companyName: companyName.toLowerCase(),
        hasPassword: Boolean(passwordHash),
        updatedAt: new Date(),
        ...visitorSummary,
      },
    });
  } catch (error) {
    return next(error);
  }
});

UserRouter.post("/video-gate/verify", async function (req, res, next) {
  try {
    const ip = getRequestIp(req);
    const now = new Date();
    const companyName = String(req.body?.companyName || "").trim().toLowerCase();
    const password = String(req.body?.password || "").trim();

    if (!companyName || !password) {
      return res.status(400).json({ message: "Company name and password are required." });
    }

    const owner = await UserModel.findOne({
      "auth.username": VISIT_LOG_OWNER_USERNAME,
    })
      .select("settings.videoGate")
      .lean();

    const gate = owner?.settings?.videoGate;

    if (gate?.enabled) {
      // Gate ON = public: no verification needed.
      return res.status(200).json({ verified: true });
    }

    if (!gate?.companyName || !gate?.passwordHash) {
      return res.status(503).json({
        verified: false,
        message: "Video gate is not configured yet.",
      });
    }

    if (gate.companyName !== companyName) {
      return res.status(401).json({ verified: false, message: "Invalid credentials." });
    }

    const passwordMatches = await bcrypt.compare(password, gate.passwordHash);
    if (!passwordMatches) {
      return res.status(401).json({ verified: false, message: "Invalid credentials." });
    }

    const gateKey = `${String(gate.updatedAt || "no-date")}:${String(gate.companyName || "")}`;

    if (ip) {
      await VisitorsModel.findOneAndUpdate(
        { ip },
        {
          $set: {
            lastSeenAt: now,
            videoInfoAutho: companyName,
            "videoGate.unlocked": true,
            "videoGate.gateKey": gateKey,
            "videoGate.authorizedCompany": companyName,
            "videoGate.verifiedAt": now,
            "videoGate.updatedAt": now,
          },
          $setOnInsert: {
            firstSeenAt: now,
            visitCount: 1,
          },
        },
        { upsert: true, new: true, setDefaultsOnInsert: true },
      );
    }

    return res.status(200).json({ verified: true });
  } catch (error) {
    return next(error);
  }
});

// ── Visit Log ─────────────────────────────────────────────────────────────────

UserRouter.get("/visit-log", checkAuth, async function (req, res, next) {
  try {
    if (req.authentication?.username !== VISIT_LOG_OWNER_USERNAME) {
      return res.status(403).json({
        message: "You are not allowed to view the visit log.",
      });
    }

    const visitors = await VisitorsModel.find({})
      .sort({ lastSeenAt: -1 })
      .limit(VISIT_LOG_LIMIT)
      .lean();

    const visitLog = visitors.map((v) => ({
      _id: String(v._id),
      ip: v.ip,
      country: v.geo?.country || "Unknown",
      visitedAt: v.lastSeenAt || v.firstSeenAt,
      visitCount: v.visitCount ?? 1,
      status: v.status || "allowed",
      videoInfoAutho: String(v.videoInfoAutho || ""),
      videoGate: {
        unlocked: v.videoGate?.unlocked === true,
        authorizedCompany: String(v.videoGate?.authorizedCompany || ""),
        verifiedAt: v.videoGate?.verifiedAt || null,
      },
    }));

    return res.status(200).json({ visitLog });
  } catch (error) {
    return next(error);
  }
});

UserRouter.post("/visit-log", async function (req, res, next) {
  try {
    const ip = getRequestIp(req);
    const country = getCountryFromIp(ip);
    const now = new Date();

    const visitor = await VisitorsModel.findOneAndUpdate(
      { ip },
      {
        $set: { lastSeenAt: now, "geo.country": country || "" },
        $inc: { visitCount: 1 },
        $push: {
          visits: {
            visitedAt: now,
            country: country || "",
            path: String(req.headers?.referer || req.path || "/").slice(0, 512),
            userAgent: String(req.headers?.["user-agent"] || "").slice(0, 512),
          },
        },
        $setOnInsert: { firstSeenAt: now },
      },
      { upsert: true, new: true },
    );

    const io = req.app.locals.io;
    const ownerDoc = await UserModel.findOne({
      "auth.username": VISIT_LOG_OWNER_USERNAME,
    })
      .select("_id")
      .lean();

    const entry = {
      _id: String(visitor._id),
      ip: visitor.ip,
      country: visitor.geo?.country || country || "Unknown",
      visitedAt: now,
      visitCount: visitor.visitCount ?? 1,
      status: visitor.status || "allowed",
    };

    if (io && ownerDoc?._id) {
      io.to(`user:${String(ownerDoc._id)}`).emit("visit-log:new", {
        visitLog: entry,
      });
    }

    return res.status(201).json({ visitLog: entry });
  } catch (error) {
    return next(error);
  }
});

UserRouter.delete("/visit-log", checkAuth, async function (req, res, next) {
  try {
    if (req.authentication?.username !== VISIT_LOG_OWNER_USERNAME) {
      return res.status(403).json({
        message: "You are not allowed to delete the visit log.",
      });
    }

    const deletedCount = await VisitorsModel.countDocuments({});
    await VisitorsModel.deleteMany({});

    return res.status(200).json({
      message: "Visit log cleared.",
      deletedCount,
    });
  } catch (error) {
    return next(error);
  }
});

// Requesting a friend
UserRouter.post(
  "/addFriend/:username/",
  checkAuth,
  async function (req, res, next) {
    const io = req.app.locals.io;
    try {
      const receiver = await UserModel.findOne({
        "auth.username": req.params.username,
      });
      if (!receiver) {
        return res.status(404).json({ message: "User not found." });
      }
      const requesterId = String(
        req.authentication?.userId || req.body.id || "",
      ).trim();
      const receiverId = String(receiver._id);
      if (!requesterId) {
        return res.status(400).json({ message: "Requester id is required." });
      }
      if (receiverId === requesterId) {
        return res
          .status(400)
          .json({ message: "You cannot send a friend request to yourself." });
      }

      const requester = await UserModel.findById(requesterId);
      if (!requester) {
        return res.status(404).json({ message: "Requester not found." });
      }

      const receiverMode = getFriendRelationshipMode(receiver, requesterId);
      const requesterMode = getFriendRelationshipMode(requester, receiverId);

      if (receiverMode === "friend" || requesterMode === "friend") {
        return res.status(409).json({ message: "You're already friends." });
      }

      if (receiverMode === "blocked" || requesterMode === "blocked") {
        return res.status(409).json({
          message: "This relationship is currently blocked.",
        });
      }

      if (
        isPendingFriendRequestPair({
          receiverMode,
          requesterMode,
        })
      ) {
        return res
          .status(200)
          .json({ message: "Friend request already pending." });
      }

      if (
        isPendingFriendRequestPair({
          receiverMode: requesterMode,
          requesterMode: receiverMode,
        })
      ) {
        ensureFriendRelationship(receiver, requesterId, "friend");
        ensureFriendRelationship(requester, receiverId, "friend");

        await Promise.all([receiver.save(), requester.save()]);

        emitUserRefresh(io, [receiverId, requesterId], "friends:updated");
        return res.status(201).json({
          message: "Existing friend request accepted. You're now friends!",
        });
      }

      ensureFriendRelationship(receiver, requesterId, "requestReceived");
      ensureFriendRelationship(requester, receiverId, "requestSent");

      await Promise.all([receiver.save(), requester.save()]);

      emitUserRefresh(io, [receiverId, requesterId], "friends:updated");
      res.status(201).json({ message: "Request sent!" });
    } catch (error) {
      next(error);
    }
  },
);

////////ACCEPT REQUEST JUST ONE TIME
UserRouter.post(
  "/acceptFriend/:my_id/:friend_id",
  checkAuth,
  requireSelfParam("my_id"),
  async function (req, res, next) {
    const io = req.app.locals.io;
    const receiverId = String(req.params.my_id || "").trim();
    const requesterId = String(req.params.friend_id || "").trim();

    try {
      const [receiver, requester] = await Promise.all([
        UserModel.findById(receiverId),
        UserModel.findById(requesterId),
      ]);

      if (!receiver || !requester) {
        return res.status(404).json({
          message: "One of the users was not found.",
        });
      }

      const receiverMode = getFriendRelationshipMode(receiver, requesterId);
      const requesterMode = getFriendRelationshipMode(requester, receiverId);

      if (receiverMode === "friend" && requesterMode === "friend") {
        return res.status(409).json({
          message: "You're already friends.",
        });
      }

      if (receiverMode === "blocked" || requesterMode === "blocked") {
        return res.status(409).json({
          message: "This relationship is currently blocked.",
        });
      }

      if (
        !isPendingFriendRequestPair({
          receiverMode,
          requesterMode,
        })
      ) {
        return res.status(409).json({
          message: "No pending friend request was found.",
        });
      }

      ensureFriendRelationship(receiver, requesterId, "friend");
      ensureFriendRelationship(requester, receiverId, "friend");

      await Promise.all([receiver.save(), requester.save()]);

      emitUserRefresh(io, [receiverId, requesterId], "friends:updated");

      return res.status(201).json({
        message: "Request accepted. You're now friends!",
      });
    } catch (error) {
      return next(error);
    }
  },
);

UserRouter.delete(
  "/removeFriend/:my_id/:friend_id",
  checkAuth,
  requireSelfParam("my_id"),
  function (req, res, next) {
    const io = req.app.locals.io;
    const { my_id, friend_id } = req.params;

    Promise.all([UserModel.findById(my_id), UserModel.findById(friend_id)])
      .then(([me, friend]) => {
        if (!me || !friend) {
          return res.status(404).json({
            message: "Friendship record was not found.",
          });
        }

        removeFriendRelationship(me, friend_id);
        removeFriendRelationship(friend, my_id);

        return Promise.all([me.save(), friend.save()]).then(() => {
          emitUserRefresh(io, [my_id, friend_id], "friends:updated");
          return res.status(200).json({
            message: "Friend removed.",
          });
        });
      })
      .catch(next);
  },
);

UserRouter.delete(
  "/unblockFriend/:my_id/:friend_id",
  checkAuth,
  requireSelfParam("my_id"),
  async function (req, res, next) {
    const io = req.app.locals.io;
    const myId = String(req.params.my_id || "").trim();
    const friendId = String(req.params.friend_id || "").trim();

    try {
      const [user, targetUser] = await Promise.all([
        UserModel.findById(myId),
        UserModel.findById(friendId),
      ]);

      if (!user || !targetUser) {
        return res.status(404).json({
          message: "User not found.",
        });
      }

      const relationshipMode = getFriendRelationshipMode(user, friendId);
      if (relationshipMode !== "blocked") {
        return res.status(409).json({
          message: "User is not blocked.",
        });
      }

      removeFriendRelationship(user, friendId);
      await user.save();

      emitUserRefresh(io, [myId, friendId], "friends:updated");
      return res.status(200).json({
        message: "User unblocked.",
      });
    } catch (error) {
      return next(error);
    }
  },
);

UserRouter.put(
  "/friend-requests/:requestId/read",
  checkAuth,
  async function (req, res, next) {
    const io = req.app.locals.io;
    try {
      const receiver = await UserModel.findById(req.authentication.userId);

      if (!receiver) {
        return res.status(404).json({
          message: "User not found.",
        });
      }

      const requestId = String(req.params.requestId || "").trim();
      const pendingRequest = (Array.isArray(receiver.connections)
        ? receiver.connections
        : []
      ).find((entry) => {
        const entryId = String(entry?._id || "").trim();
        const requesterId = String(entry?.id || entry?.userID || "").trim();
        return (
          isPendingReceivedMode(entry?.mode || entry?.userMode) &&
          (entryId === requestId || requesterId === requestId)
        );
      });

      if (!pendingRequest) {
        return res.status(404).json({
          message: "Friend request not found.",
        });
      }

      const requesterId = String(
        pendingRequest?.id || pendingRequest?.userID || "",
      ).trim();
      const requester = requesterId
        ? await UserModel.findById(requesterId)
        : null;

      removeFriendRelationship(receiver, requesterId);

      if (requester) {
        removeFriendRelationship(requester, String(receiver._id));
      }

      await Promise.all([
        receiver.save(),
        requester ? requester.save() : Promise.resolve(),
      ]);

      emitUserRefresh(
        io,
        requesterId ? [String(receiver._id), requesterId] : String(receiver._id),
        "friend-request:rejected",
      );

      return res.status(200).json({
        message: "Friend request rejected.",
        requestId: String(pendingRequest._id || req.params.requestId),
      });
    } catch (error) {
      return next(error);
    }
  },
);

UserRouter.delete(
  "/friend-requests/sent/:receiverId",
  checkAuth,
  async function (req, res, next) {
    const io = req.app.locals.io;
    const requesterId = String(req.authentication?.userId || "").trim();
    const receiverId = String(req.params.receiverId || "").trim();

    try {
      if (!requesterId || !receiverId) {
        return res.status(400).json({
          message: "Requester and receiver ids are required.",
        });
      }

      const [requester, receiver] = await Promise.all([
        UserModel.findById(requesterId),
        UserModel.findById(receiverId),
      ]);

      if (!requester || !receiver) {
        return res.status(404).json({
          message: "One of the users was not found.",
        });
      }

      const requesterMode = getFriendRelationshipMode(requester, receiverId);
      const receiverMode = getFriendRelationshipMode(receiver, requesterId);

      if (
        !isPendingFriendRequestPair({
          receiverMode,
          requesterMode,
        })
      ) {
        return res.status(409).json({
          message: "No pending sent friend request was found.",
        });
      }

      removeFriendRelationship(requester, receiverId);
      removeFriendRelationship(receiver, requesterId);

      await Promise.all([requester.save(), receiver.save()]);

      emitUserRefresh(io, [requesterId, receiverId], "friend-request:cancelled");

      return res.status(200).json({
        message: "Friend request cancelled.",
        receiverId,
      });
    } catch (error) {
      return next(error);
    }
  },
);

//////////////////////Posting update for a user before leaving app
UserRouter.put("/isOnline/:id", function (req, res, next) {
  const io = req.app.locals.io;
  const requestedStatusValue = normalizePresenceStatusValue(
    req.body?.statusValue,
    "offline",
  );
  UserModel.findById(req.params.id)
    .then((user) => {
      if (!user) {
        res.status(404).json({
          message: "User not found.",
        });
        return null;
      }

      setUserConnectionState(user, {
        statusValue: requestedStatusValue,
        at: new Date(),
      });

      return user.save();
    })
    .then((user) => {
      if (!user) {
        return null;
      }

      emitUserRefresh(io, getUserAndFriendIds(user), "connection:changed", {
        statusValue: requestedStatusValue,
        targetUserId: String(req.params.id),
      });
      res.status(201).json(user);
    })
    .catch(next);
});

UserRouter.put("/heartbeat/:id", function (req, res, next) {
  const io = req.app.locals.io;
  const requestedStatusValue = normalizePresenceStatusValue(
    req.body?.statusValue,
    "online",
  );
  UserModel.findById(req.params.id)
    .then((user) => {
      if (!user) {
        res.status(404).json({
          message: "User not found.",
        });
        return null;
      }

      setUserConnectionState(user, {
        statusValue: requestedStatusValue,
        at: new Date(),
      });

      return user.save();
    })
    .then((user) => {
      if (!user) {
        return null;
      }

      emitUserRefresh(io, getUserAndFriendIds(user), "connection:changed", {
        statusValue: requestedStatusValue,
        targetUserId: String(user._id),
      });
      return res.status(200).json({
        ok: true,
        userId: String(user._id),
      });
    })
    .catch(next);
});
UserRouter.post(
  "/studyOrganizer/settings/:my_id",
  checkAuth,
  requireSelfParam("my_id"),
  async function (req, res, next) {
    try {
      const userId = String(req.params.my_id || "").trim();
      const user = await UserModel.findById(userId).select("_id");
      if (!user?._id) {
        return res.status(404).json({ message: "User not found." });
      }
      const nextSettings =
        req.body &&
        typeof req.body === "object" &&
        req.body.settings &&
        typeof req.body.settings === "object"
          ? req.body.settings
          : req.body && typeof req.body === "object"
            ? req.body
            : {};
      const settingsPatch =
        req.body &&
        typeof req.body === "object" &&
        req.body.settingsPatch &&
        typeof req.body.settingsPatch === "object"
          ? req.body.settingsPatch
          : null;
      const optionsSelectsPayload =
        req.body &&
        typeof req.body === "object" &&
        Array.isArray(req.body.optionsSelects)
          ? req.body.optionsSelects
          : null;
      const selectIDRaw =
        req.body && typeof req.body === "object"
          ? String(req.body.selectID || "").trim()
          : "";
      const selectID = selectIDRaw;
      const options =
        req.body && typeof req.body === "object" && Array.isArray(req.body.options)
          ? req.body.options
          : null;
      const optionsMode =
        req.body && typeof req.body === "object"
          ? String(req.body.mode || "").trim().toLowerCase()
          : "";
      const dependencySelectIDRaw =
        req.body && typeof req.body === "object"
          ? String(req.body.dependencySelectID || "").trim()
          : "";
      const dependencySelectID = resolvePlannerSelectOptionsKey(
        dependencySelectIDRaw,
      );
      const dependentSelectID = resolvePlannerSelectOptionsKey(
        String(req.body?.dependentSelectID || "").trim(),
      );
      const independentID = resolvePlannerSelectOptionsKey(
        String(req.body?.independentID || "").trim(),
      );
      const independentOption = String(req.body?.independentOption || "").trim();
      const dependentOptions =
        Array.isArray(req.body?.dependentOptions) ? req.body.dependentOptions : null;
      const dependentOptionsFromSchemaBody =
        Array.isArray(req.body?.options) &&
        req.body.options.every((entry) => Array.isArray(entry))
          ? req.body.options[0]
          : null;
      const predictionToolInput =
        req.body &&
        typeof req.body === "object" &&
        req.body.predictionToolInput &&
        typeof req.body.predictionToolInput === "object"
          ? req.body.predictionToolInput
          : null;
      const predictionToolInputs =
        req.body &&
        typeof req.body === "object" &&
        Array.isArray(req.body.predictionToolInputs)
          ? req.body.predictionToolInputs
          : [];
      if (
        predictionToolInput ||
        (Array.isArray(predictionToolInputs) && predictionToolInputs.length > 0)
      ) {
        const existingUser = await UserModel.findById(userId).select("memory");
        if (!existingUser?._id) {
          return res.status(404).json({ message: "User not found." });
        }
        const memoryDoc = await ensureUserMemoryDoc(existingUser);
        if (!memoryDoc) {
          return res.status(500).json({
            message: "Failed to access user memory.",
          });
        }
        const existingSettings = normalizeStudyOrganizerSettings(
          memoryDoc?.studyPlanner?.settings || {},
        );
        const predictionEntries = Array.isArray(existingSettings?.predictionTool)
          ? [...existingSettings.predictionTool]
          : [];
        const applyPredictionInput = (rawInput) => {
          const tab = String(rawInput?.tab || "").trim();
          const inputFieldID = String(rawInput?.inputFieldID || "").trim();
          const value = String(rawInput?.value || "").trim();
          if (!tab || !inputFieldID || !value || value === "-") {
            return;
          }
          const existingIndex = predictionEntries.findIndex(
            (entry) =>
              String(entry?.tab || "").trim() === tab &&
              String(entry?.inputFieldID || "").trim() === inputFieldID,
          );
          if (existingIndex === -1) {
            predictionEntries.push({
              tab,
              inputFieldID,
              list: [value],
            });
            return;
          }
          const currentList = Array.isArray(predictionEntries[existingIndex]?.list)
            ? predictionEntries[existingIndex].list
            : [];
          const normalizedCurrentList = currentList
            .map((entry) => String(entry || "").trim())
            .filter(Boolean);
          predictionEntries[existingIndex] = {
            ...predictionEntries[existingIndex],
            tab,
            inputFieldID,
            list: [value, ...normalizedCurrentList.filter((entry) => entry !== value)].slice(
              0,
              25,
            ),
          };
        };
        if (predictionToolInput) {
          applyPredictionInput(predictionToolInput);
        }
        predictionToolInputs.forEach((entry) => applyPredictionInput(entry));
        const mergedSettings = {
          ...existingSettings,
          predictionTool: predictionEntries,
        };
        const storedMergedSettings =
          serializeStudyOrganizerSettingsForStorage(mergedSettings);
        memoryDoc.studyPlanner = memoryDoc.studyPlanner || {};
        memoryDoc.studyPlanner.settings = storedMergedSettings;
        await memoryDoc.save();
        return res.status(200).json({
          message: "Prediction tool entry saved successfully.",
          settings: serializeStudyOrganizerSettingsForStorage(
            storedMergedSettings,
          ),
        });
      }
      if (
        (selectID && Array.isArray(options)) ||
        (
          (dependentSelectID || selectID) &&
          independentID &&
          (Array.isArray(dependentOptions) ||
            Array.isArray(dependentOptionsFromSchemaBody))
        )
      ) {
        const existingUser = await UserModel.findById(userId)
          .select("memory.MOI.studyPlanner.settings")
          .lean();
        if (!existingUser?._id) {
          return res.status(404).json({ message: "User not found." });
        }
        const rawSettings =
          existingUser?.memory?.MOI?.studyPlanner?.settings &&
          typeof existingUser.memory.MOI.studyPlanner.settings === "object"
            ? existingUser.memory.MOI.studyPlanner.settings
            : {};
        const sourceOptions = Array.isArray(dependentOptionsFromSchemaBody)
          ? dependentOptionsFromSchemaBody
          : Array.isArray(dependentOptions)
            ? dependentOptions
            : options;
        const normalizedOptions = sourceOptions
          .map((entry) => String(entry || "").trim())
          .filter(Boolean)
          .filter(
            (entry, entryIndex, sourceEntries) =>
              sourceEntries.indexOf(entry) === entryIndex,
          );
        const canonicalSelectID = resolvePlannerSelectOptionsKey(
          selectID || dependentSelectID,
        );
        const filteredOptions = removeHardcodedPlannerSelectOptions(
          canonicalSelectID,
          normalizedOptions,
        );
        const normalizedMode =
          optionsMode === "dependent" ? "dependent" : "independent";
        const currentNormalizedSettings = normalizeStudyOrganizerSettings(
          rawSettings || {},
        );
        const nextOptionsSelects = Array.isArray(
          currentNormalizedSettings?.optionsSelects,
        )
          ? [...currentNormalizedSettings.optionsSelects]
          : [];
        const existingIndex = nextOptionsSelects.findIndex(
          (entry) =>
            String(entry?.selectID || "").trim() ===
            String(canonicalSelectID || "").trim(),
        );
        const baseEntry =
          existingIndex >= 0
            ? nextOptionsSelects[existingIndex]
            : {
                selectID: canonicalSelectID,
                mode: "independent",
                options: [],
                dependencyOptions: [],
              };
        if (normalizedMode === "dependent") {
          const normalizedDependencySelectID = independentID || dependencySelectID;
          const currentDependencyOptions = Array.isArray(baseEntry?.dependencyOptions)
            ? [...baseEntry.dependencyOptions]
            : [];
          const depIndex = currentDependencyOptions.findIndex(
            (entry) =>
              String(entry?.selectID || "").trim() ===
                String(normalizedDependencySelectID || "").trim() &&
              String(entry?.independentOption || "").trim() ===
                String(independentOption || "").trim(),
          );
          const nextDependencyEntry = {
            selectID: String(normalizedDependencySelectID || "").trim(),
            independentOption: String(independentOption || "").trim(),
            options: filteredOptions,
          };
          if (depIndex >= 0) {
            currentDependencyOptions[depIndex] = nextDependencyEntry;
          } else {
            currentDependencyOptions.push(nextDependencyEntry);
          }
          baseEntry.mode = "dependent";
          baseEntry.dependencyOptions = currentDependencyOptions.filter(
            (entry) => Boolean(String(entry?.selectID || "").trim()),
          );
        } else {
          baseEntry.mode = "independent";
          baseEntry.options = filteredOptions;
        }
        if (existingIndex >= 0) {
          nextOptionsSelects[existingIndex] = baseEntry;
        } else {
          nextOptionsSelects.push(baseEntry);
        }
        const nextSettingsRaw = {
          ...rawSettings,
          optionsSelects: nextOptionsSelects,
        };
        const nextStoredSettings =
          serializeStudyOrganizerSettingsForStorage(nextSettingsRaw);
        await UserModel.updateOne(
          { _id: userId },
          {
            $set: {
              "memory.MOI.studyPlanner.settings": nextStoredSettings,
            },
          },
        );
        const refreshedUser = await UserModel.findById(userId)
          .select("memory.MOI.studyPlanner.settings")
          .lean();
        const refreshedSettings =
          refreshedUser?.memory?.MOI?.studyPlanner?.settings &&
          typeof refreshedUser.memory.MOI.studyPlanner.settings === "object"
            ? refreshedUser.memory.MOI.studyPlanner.settings
            : rawSettings;
        const { selectOptions: _legacySelectOptions, ...rawSettingsWithoutLegacySelectOptions } =
          refreshedSettings || {};
        const responseStoredSettings = serializeStudyOrganizerSettingsForStorage({
          ...rawSettingsWithoutLegacySelectOptions,
        });
        return res.status(200).json({
          message: "Planner select options saved successfully.",
          settings: responseStoredSettings,
        });
      }
      if (Array.isArray(optionsSelectsPayload)) {
        const existingUser = await UserModel.findById(userId)
          .select("memory.MOI.studyPlanner.settings")
          .lean();
        if (!existingUser?._id) {
          return res.status(404).json({ message: "User not found." });
        }
        const rawSettings =
          existingUser?.memory?.MOI?.studyPlanner?.settings &&
          typeof existingUser.memory.MOI.studyPlanner.settings === "object"
            ? existingUser.memory.MOI.studyPlanner.settings
            : {};
        const { selectOptions: _legacySelectOptions, ...rawSettingsWithoutLegacySelectOptions } =
          rawSettings || {};
        const normalizedOptionsSelects = optionsSelectsPayload
          .map((entry) => ({
            selectID: resolvePlannerSelectOptionsKey(entry?.selectID),
            mode:
              String(entry?.mode || "").trim().toLowerCase() === "dependent"
                ? "dependent"
                : "independent",
            options: removeHardcodedPlannerSelectOptions(
              resolvePlannerSelectOptionsKey(entry?.selectID),
              (Array.isArray(entry?.options) ? entry.options : [])
                .map((value) => String(value || "").trim())
                .filter(Boolean),
            ),
            dependencyOptions: (
              Array.isArray(entry?.dependencyOptions)
                ? entry.dependencyOptions
                : []
            )
              .map((dependencyEntry) => ({
                selectID: resolvePlannerSelectOptionsKey(
                  dependencyEntry?.selectID,
                ),
                options: removeHardcodedPlannerSelectOptions(
                  resolvePlannerSelectOptionsKey(entry?.selectID),
                  (Array.isArray(dependencyEntry?.options)
                    ? dependencyEntry.options
                    : []
                  )
                    .map((value) => String(value || "").trim())
                    .filter(Boolean),
                ),
              }))
              .filter((dependencyEntry) => Boolean(dependencyEntry.selectID)),
          }))
          .filter((entry) => Boolean(entry.selectID));
        const nextSettingsRaw = {
          ...rawSettingsWithoutLegacySelectOptions,
          optionsSelects: normalizedOptionsSelects,
        };
        const storedSettings = serializeStudyOrganizerSettingsForStorage(
          nextSettingsRaw,
        );
        await UserModel.updateOne(
          { _id: userId },
          {
            $set: {
              "memory.MOI.studyPlanner.settings": storedSettings,
            },
          },
        );
        return res.status(200).json({
          message: "Planner optionsSelects saved successfully.",
          settings: serializeStudyOrganizerSettingsForStorage(storedSettings),
        });
      }
      if (settingsPatch) {
        const existingUser = await UserModel.findById(userId).select("memory");
        if (!existingUser?._id) {
          return res.status(404).json({ message: "User not found." });
        }
        const memoryDoc = await ensureUserMemoryDoc(existingUser);
        if (!memoryDoc) {
          return res.status(500).json({
            message: "Failed to access user memory.",
          });
        }
        const existingSettings = normalizeStudyOrganizerSettings(
          memoryDoc?.studyPlanner?.settings || {},
        );
        const sanitizedSettingsPatch =
          sanitizeLegacyPlannerSelectOptionsPayload(settingsPatch);
        const normalizedPatch = normalizeStudyOrganizerSettings({
          ...existingSettings,
          ...sanitizedSettingsPatch,
          fieldDefaults: mergePlannerFieldDefaults(
            existingSettings?.fieldDefaults || {},
            sanitizedSettingsPatch?.fieldDefaults || {},
          ),
        });
        const storedMergedSettings =
          serializeStudyOrganizerSettingsForStorage(normalizedPatch);
        memoryDoc.studyPlanner = memoryDoc.studyPlanner || {};
        memoryDoc.studyPlanner.settings = storedMergedSettings;
        await memoryDoc.save();
        return res.status(200).json({
          message: "Planner settings patch saved successfully.",
          settings: serializeStudyOrganizerSettingsForStorage(
            storedMergedSettings,
          ),
        });
      }
      const normalizedIncomingSettings = normalizeStudyOrganizerSettings(
        sanitizeLegacyPlannerSelectOptionsPayload(nextSettings),
      );
      const existingUser = await UserModel.findById(userId).select("memory");
      if (!existingUser?._id) {
        return res.status(404).json({ message: "User not found." });
      }
      const memoryDoc = await ensureUserMemoryDoc(existingUser);
      if (!memoryDoc) {
        return res.status(500).json({
          message: "Failed to access user memory.",
        });
      }
      const existingNormalizedSettings = normalizeStudyOrganizerSettings(
        memoryDoc?.studyPlanner?.settings || {},
      );
      const previousStoredSettings =
        serializeStudyOrganizerSettingsForStorage(existingNormalizedSettings);
      const mergedSettings = normalizeStudyOrganizerSettings({
        ...existingNormalizedSettings,
        ...normalizedIncomingSettings,
        fieldDefaults: mergePlannerFieldDefaults(
          existingNormalizedSettings?.fieldDefaults || {},
          normalizedIncomingSettings?.fieldDefaults || {},
        ),
      });
      const storedSettings = serializeStudyOrganizerSettingsForStorage(
        sanitizeLegacyPlannerSelectOptionsPayload(mergedSettings),
      );
      memoryDoc.studyPlanner = memoryDoc.studyPlanner || {};
      memoryDoc.studyPlanner.settings = storedSettings;
      await memoryDoc.save();

      const persistedSettings = normalizeStudyOrganizerSettings(storedSettings);
      const noChangesApplied =
        JSON.stringify(previousStoredSettings || {}) ===
        JSON.stringify(storedSettings || {});

      return res.status(200).json({
        message: noChangesApplied
          ? "No settings changes were applied."
          : "Settings saved successfully.",
        settings: serializeStudyOrganizerSettingsForStorage(storedSettings),
      });
    } catch (error) {
      return next(error);
    }
  },
);
UserRouter.get(
  "/studyOrganizer/settings/defaults/:my_id",
  checkAuth,
  requireSelfParam("my_id"),
  async function (req, res, next) {
    try {
      const userId = String(req.params.my_id || "").trim();
      const existingUser = await UserModel.findById(userId).select("memory");
      if (!existingUser?._id) {
        return res.status(404).json({ message: "User not found." });
      }
      const memoryDoc = await ensureUserMemoryDoc(existingUser);
      if (!memoryDoc) {
        return res.status(500).json({
          message: "Failed to access user memory.",
        });
      }
      const settings = normalizeStudyOrganizerSettings(
        memoryDoc?.studyPlanner?.settings || {},
      );
      return res.status(200).json({
        message: "Planner defaults loaded successfully.",
        fieldDefaults: plannerFieldDefaultsToEntries(
          normalizePlannerSettingsFieldDefaults(settings?.fieldDefaults),
        ),
      });
    } catch (error) {
      return next(error);
    }
  },
);
UserRouter.post(
  "/studyOrganizer/settings/defaults/:my_id",
  checkAuth,
  requireSelfParam("my_id"),
  async function (req, res, next) {
    try {
      const userId = String(req.params.my_id || "").trim();
      const existingUser = await UserModel.findById(userId).select("memory");
      if (!existingUser?._id) {
        return res.status(404).json({ message: "User not found." });
      }
      const memoryDoc = await ensureUserMemoryDoc(existingUser);
      if (!memoryDoc) {
        return res.status(500).json({
          message: "Failed to access user memory.",
        });
      }
      const settings = normalizeStudyOrganizerSettings(
        memoryDoc?.studyPlanner?.settings || {},
      );
      const requestBody =
        req.body && typeof req.body === "object" ? req.body : {};
      const incomingDefaultsCandidate = Array.isArray(requestBody.fieldDefaults)
        ? requestBody.fieldDefaults
        : requestBody.fieldDefaults &&
            typeof requestBody.fieldDefaults === "object"
          ? requestBody.fieldDefaults
          : requestBody.programMode || requestBody.field
            ? [
                {
                  programMode: requestBody.programMode,
                  field: requestBody.field,
                  value: requestBody.value ?? requestBody.fieldValue ?? "",
                },
              ]
            : [];

      if (
        !Array.isArray(requestBody.fieldDefaults) &&
        !requestBody.fieldDefaults &&
        !requestBody.field &&
        !requestBody.programMode &&
        Object.keys(requestBody).length > 0
      ) {
        return res.status(400).json({
          message:
            "Invalid defaults payload. Send fieldDefaults or programMode + field + value.",
        });
      }
      const normalizedIncomingDefaults = normalizePlannerSettingsFieldDefaults(
        incomingDefaultsCandidate,
      );
      const nextDefaults = normalizePlannerSettingsFieldDefaults(
        normalizedIncomingDefaults,
      );
      const mergedSettings = normalizeStudyOrganizerSettings({
        ...settings,
        fieldDefaults: nextDefaults,
      });
      const storedMergedSettings =
        serializeStudyOrganizerSettingsForStorage(mergedSettings);
      memoryDoc.studyPlanner = memoryDoc.studyPlanner || {};
      memoryDoc.studyPlanner.settings = storedMergedSettings;
      await memoryDoc.save();
      return res.status(200).json({
        message: "Planner defaults saved successfully.",
        fieldDefaults: plannerFieldDefaultsToEntries(
          normalizeStudyOrganizerSettings(storedMergedSettings)?.fieldDefaults ||
            {},
        ),
        settings: serializeStudyOrganizerSettingsForStorage(
          storedMergedSettings,
        ),
      });
    } catch (error) {
      return next(error);
    }
  },
);

UserRouter.post(
  "/addCourseInfo/:my_id",
  checkAuth,
  requireSelfParam("my_id"),
  async function (req, res, next) {
    try {
      const user = await UserModel.findById(req.params.my_id);
      if (!user) {
        return res.status(404).json({ message: "User not found." });
      }

      const memoryDoc = await ensureUserMemoryDoc(user);
      if (!memoryDoc) {
        return res
          .status(500)
          .json({ message: "Failed to access user memory." });
      }

      const createdCourse = addCourseInfoToPlanner(memoryDoc, req.body);
      await persistStudyOrganizerMutation(req.params.my_id, memoryDoc);

      return res.status(201).json({
        course: createdCourse,
      });
    } catch (error) {
      return next(error);
    }
  },
);

UserRouter.post(
  "/addComponent/:my_id/:courseID",
  checkAuth,
  requireSelfParam("my_id"),
  async function (req, res, next) {
    try {
      const user = await UserModel.findById(req.params.my_id);
      if (!user) {
        return res.status(404).json({ message: "User not found." });
      }

      const memoryDoc = await ensureUserMemoryDoc(user);
      if (!memoryDoc) {
        return res
          .status(500)
          .json({ message: "Failed to access user memory." });
      }

      const createdComponent = addComponentToPlanner(
        memoryDoc,
        req.params.courseID,
        withAutoActualCourseTimingFromProfile(
          user,
          withAutoNormativeCourseYearInterval(user, req.body),
        ),
      );

      if (!createdComponent) {
        return res.status(404).json({ message: "Course not found." });
      }

      await persistStudyOrganizerMutation(req.params.my_id, memoryDoc);

      return res.status(201).json({
        component: createdComponent,
      });
    } catch (error) {
      return next(error);
    }
  },
);

//..........ADDING COURSE TO COURSE ARRAY........
UserRouter.post(
  "/addCourse/:my_id",
  checkAuth,
  requireSelfParam("my_id"),
  async function (req, res, next) {
    try {
      const user = await UserModel.findById(req.params.my_id);
      if (!user) {
        return res.status(404).json({ message: "User not found." });
      }

      const memoryDoc = await ensureUserMemoryDoc(user);
      if (!memoryDoc) {
        return res
          .status(500)
          .json({ message: "Failed to access user memory." });
      }

      const createdPlannerCourse = addCourseInfoToPlanner(memoryDoc, {
        course_code: req.body?.course_code,
        course_name: req.body?.course_name,
        courseWeight: req.body?.courseWeight ?? req.body?.course_totalWeight,
      });

      const normalizedCourseComponentPayloads = Array.isArray(
        req.body?.course_components,
      )
        ? req.body.course_components
            .map((entry) =>
              entry && typeof entry === "object"
                ? entry
                : {
                    course_class: String(entry || "").trim(),
                  },
            )
            .filter(
              (entry) =>
                entry &&
                typeof entry === "object" &&
                Boolean(
                  String(entry?.course_class || entry?.course_component || "").trim(),
                ),
            )
        : [];
      const fallbackCourseComponent = String(req.body?.course_component || "").trim();
      const courseComponentsToCreate =
        normalizedCourseComponentPayloads.length > 0
          ? normalizedCourseComponentPayloads
          : fallbackCourseComponent
            ? [{ course_class: fallbackCourseComponent }]
            : [];

      const shouldCreateComponent = Boolean(
        String(req.body?.course_class || "").trim() ||
        courseComponentsToCreate.length > 0 ||
        String(req.body?.programYear ?? "").trim() ||
        String(req.body?.academicYear || "").trim() ||
        String(req.body?.course_year || "").trim() ||
        String(req.body?.term || "").trim() ||
        String(req.body?.course_term || "").trim() ||
        (Array.isArray(req.body?.course_dayAndTime) &&
          req.body.course_dayAndTime.length > 0) ||
        String(req.body?.course_grade || "").trim() ||
        (Array.isArray(req.body?.course_exams) &&
          req.body.course_exams.length > 0),
      );

      if (shouldCreateComponent && createdPlannerCourse?._id) {
        courseComponentsToCreate.forEach((componentPayload) => {
          const normalizedComponentPayload =
            componentPayload && typeof componentPayload === "object"
              ? componentPayload
              : {};
          const resolvedComponentClass = String(
            normalizedComponentPayload?.course_class ||
              normalizedComponentPayload?.course_component ||
              req.body?.course_class ||
              req.body?.course_component ||
              "",
          ).trim();
          if (!resolvedComponentClass) {
            return;
          }
          addComponentToPlanner(memoryDoc, createdPlannerCourse._id, {
            ...withAutoActualCourseTimingFromProfile(
              user,
              withAutoNormativeCourseYearInterval(user, {
                ...(req.body && typeof req.body === "object" ? req.body : {}),
                ...normalizedComponentPayload,
              }),
            ),
            course_component: resolvedComponentClass,
            course_class: resolvedComponentClass,
          });
        });
      }

      await persistStudyOrganizerMutation(req.params.my_id, memoryDoc);

      const createdCourse =
        flattenMemoryCoursesForPlanner(
          memoryDoc?.studyPlanner?.studyOrganizer?.courses,
        ).find(
          (course) =>
            String(course?.parentCourseId || course?._id || "") ===
            String(createdPlannerCourse?._id || ""),
        ) || null;

      return res.status(201).json({
        course: createdCourse,
      });
    } catch (error) {
      return next(error);
    }
  },
);
//....................
//..........ADDING LECTURE TO COURSE ARRAY........
UserRouter.post(
  "/addLecture/:my_id",
  checkAuth,
  requireSelfParam("my_id"),
  async function (req, res, next) {
    try {
      const user = await UserModel.findById(req.params.my_id);
      if (!user) {
        return res.status(404).json({ message: "User not found." });
      }

      const memoryDoc = await ensureUserMemoryDoc(user);
      if (!memoryDoc) {
        return res
          .status(500)
          .json({ message: "Failed to access user memory." });
      }

      const createdLecture = addLectureToPlanner(memoryDoc, req.body);
      if (!createdLecture) {
        return res.status(400).json({
          message:
            "Course/component must already exist. Select an existing course component before adding a lecture.",
        });
      }
      recalculateCourseLectureTotals(memoryDoc);
      await persistStudyOrganizerMutation(req.params.my_id, memoryDoc);

      return res.status(201).json({
        lecture: createdLecture,
      });
    } catch (error) {
      return next(error);
    }
  },
);
//....................
//..........DELETE COURSE.....................
UserRouter.delete(
  "/deleteCourse/:my_id/:courseID",
  checkAuth,
  requireSelfParam("my_id"),
  async function (req, res, next) {
    try {
      const user = await UserModel.findById(req.params.my_id);
      if (!user) {
        return res.status(404).json({ message: "User not found." });
      }

      const memoryDoc = await ensureUserMemoryDoc(user);
      if (!memoryDoc) {
        return res
          .status(500)
          .json({ message: "Failed to access user memory." });
      }

      removeCourseOrComponentFromPlanner(memoryDoc, req.params.courseID);
      await persistStudyOrganizerMutation(req.params.my_id, memoryDoc);
      return res.status(201).json();
    } catch (error) {
      return next(error);
    }
  },
);

UserRouter.delete(
  "/deleteAllCourses/:my_id",
  checkAuth,
  requireSelfParam("my_id"),
  async function (req, res, next) {
    try {
      const user = await UserModel.findById(req.params.my_id);
      if (!user) {
        return res.status(404).json({ message: "User not found." });
      }

      const memoryDoc = await ensureUserMemoryDoc(user);
      if (!memoryDoc) {
        return res
          .status(500)
          .json({ message: "Failed to access user memory." });
      }

      memoryDoc.studyPlanner = memoryDoc.studyPlanner || {};
      memoryDoc.studyPlanner.studyOrganizer =
        memoryDoc.studyPlanner.studyOrganizer || {};
      memoryDoc.studyPlanner.studyOrganizer.courses = [];
      await persistStudyOrganizerMutation(req.params.my_id, memoryDoc);
      return res.status(201).json();
    } catch (error) {
      return next(error);
    }
  },
);
//...............................................
//..........DELETE LECTURE.....................
UserRouter.delete(
  "/deleteLecture/:my_id/:lectureID",
  checkAuth,
  requireSelfParam("my_id"),
  async function (req, res, next) {
    try {
      const user = await UserModel.findById(req.params.my_id);
      if (!user) {
        return res.status(404).json({ message: "User not found." });
      }

      const memoryDoc = await ensureUserMemoryDoc(user);
      if (!memoryDoc) {
        return res
          .status(500)
          .json({ message: "Failed to access user memory." });
      }

      removeLectureFromPlanner(memoryDoc, req.params.lectureID);
      recalculateCourseLectureTotals(memoryDoc);
      await persistStudyOrganizerMutation(req.params.my_id, memoryDoc);
      return res.status(201).json();
    } catch (error) {
      return next(error);
    }
  },
);
//...............................................

//................Edit Course................
UserRouter.post(
  "/editCourseBundle/:my_id/:courseID",
  checkAuth,
  requireSelfParam("my_id"),
  async function (req, res, next) {
    try {
      const user = await UserModel.findById(req.params.my_id);
      if (!user) {
        return res.status(404).json({ message: "User not found." });
      }

      const memoryDoc = await ensureUserMemoryDoc(user);
      if (!memoryDoc) {
        return res
          .status(500)
          .json({ message: "Failed to access user memory." });
      }

      const normalizedComponents = Array.isArray(req.body?.components)
        ? req.body.components.map((componentEntry) =>
            withAutoActualCourseTimingFromProfile(
              user,
              withAutoNormativeCourseYearInterval(user, componentEntry),
            ),
          )
        : [];
      const updatedPlannerCourse = replaceCourseBundleInPlanner(
        memoryDoc,
        req.params.courseID,
        {
          course_name: req.body?.course_name,
          course_code: req.body?.course_code,
          components: normalizedComponents,
        },
      );

      if (!updatedPlannerCourse) {
        return res.status(404).json({ message: "Course not found." });
      }

      await persistStudyOrganizerMutation(req.params.my_id, memoryDoc);

      return res.status(201).json({
        course:
          flattenMemoryCoursesForPlanner([updatedPlannerCourse]).find(
            (course) =>
              String(course?.parentCourseId || course?._id || "") ===
              String(updatedPlannerCourse?._id || ""),
          ) || null,
      });
    } catch (error) {
      return next(error);
    }
  },
);

UserRouter.post(
  "/editCourse/:my_id/:courseID",
  checkAuth,
  requireSelfParam("my_id"),
  async function (req, res, next) {
    try {
      const normalizedCourseId = String(req.params.courseID || "").trim();
      if (!normalizedCourseId) {
        return res.status(400).json({ message: "Missing courseID." });
      }

      const user = await UserModel.findById(req.params.my_id);
      if (!user) {
        return res.status(404).json({ message: "User not found." });
      }

      const memoryDoc = await ensureUserMemoryDoc(user);
      if (!memoryDoc) {
        return res
          .status(500)
          .json({ message: "Failed to access user memory." });
      }

      const updatedPlannerCourse = updateCourseInPlanner(
        memoryDoc,
        normalizedCourseId,
        withAutoActualCourseTimingFromProfile(
          user,
          withAutoNormativeCourseYearInterval(user, req.body),
        ),
      );

      if (!updatedPlannerCourse) {
        return res.status(404).json({ message: "Course/component not found." });
      }

      await persistStudyOrganizerMutation(req.params.my_id, memoryDoc);

      const updatedCourse =
        flattenMemoryCoursesForPlanner(
          updatedPlannerCourse ? [updatedPlannerCourse] : [],
        ).find(
          (course) => String(course?._id) === normalizedCourseId,
        ) ||
        flattenMemoryCoursesForPlanner(
          memoryDoc?.studyPlanner?.studyOrganizer?.courses,
        ).find(
          (course) => String(course?._id) === normalizedCourseId,
        ) ||
        null;

      return res.status(201).json({
        course: updatedCourse,
      });
    } catch (error) {
      const failureMessage = String(error?.message || "").trim();
      return res.status(500).json({
        message: failureMessage || "Failed to edit course.",
      });
    }
  },
);

//................Edit Course Full Pages................
UserRouter.post(
  "/editCoursePages/:my_id/:courseNAME",
  checkAuth,
  requireSelfParam("my_id"),
  async function (req, res, next) {
    try {
      const user = await UserModel.findById(req.params.my_id);
      if (!user) {
        return res.status(404).json({ message: "User not found." });
      }

      const memoryDoc = await ensureUserMemoryDoc(user);
      if (!memoryDoc) {
        return res
          .status(500)
          .json({ message: "Failed to access user memory." });
      }

      updateCoursePagesInPlanner(memoryDoc, req.params.courseNAME, req.body);
      await persistStudyOrganizerMutation(req.params.my_id, memoryDoc);
      return res.status(201).json();
    } catch (error) {
      return next(error);
    }
  },
);
//................Edit Lecture................
UserRouter.post(
  "/editLecture/:my_id/:lectureID",
  checkAuth,
  requireSelfParam("my_id"),
  async function (req, res, next) {
    try {
      const user = await UserModel.findById(req.params.my_id);
      if (!user) {
        return res.status(404).json({ message: "User not found." });
      }

      const memoryDoc = await ensureUserMemoryDoc(user);
      if (!memoryDoc) {
        return res
          .status(500)
          .json({ message: "Failed to access user memory." });
      }

      updateLectureInPlanner(memoryDoc, req.params.lectureID, req.body);
      recalculateCourseLectureTotals(memoryDoc);
      await persistStudyOrganizerMutation(req.params.my_id, memoryDoc);
      return res.status(201).json();
    } catch (error) {
      return next(error);
    }
  },
);
UserRouter.post(
  "/postProfileEvent/:my_id",
  checkAuth,
  requireSelfParam("my_id"),
  async function (req, res, next) {
    try {
      const user = await UserModel.findById(req.params.my_id).select(
        "profile.firstname profile.lastname profile.events ai.aiProvider",
      );
      if (!user) {
        return res.status(404).json({ message: "User not found." });
      }

      const firstName = String(user.profile?.firstname || "").trim();
      const lastName = String(user.profile?.lastname || "").trim();
      const datePostedISO = new Date().toISOString();
      const studySessionID = String(req.body?.studySessionID || "").trim();
      const preferredProvider = String(
        user.ai?.aiProvider || req.body?.aiProvider || resolveDefaultAiProvider(),
      ).trim();

      const imageURLs = Array.isArray(req.body?.images)
        ? req.body.images.map((u) => String(u || "").trim()).filter(Boolean)
        : [];
      const videoURLs = Array.isArray(req.body?.videos)
        ? req.body.videos.map((u) => String(u || "").trim()).filter(Boolean)
        : [];

      const achievementData = String(req.body?.achievementData || "").trim();

      const prompt = `Generate exactly one valid JSON object matching this structure:

{
  "eventClass": "String",
  "eventTitle": "String",
  "eventBody": {
    "eventText": "String",
    "eventImagesURLs": [],
    "eventVideosURLs": []
  },
  "eventFooter": {
    "eventDatePosted": "String",
    "eventUserName": {
      "firstName": "String",
      "lastName": "String"
    }
  },
  "eventReplies": []
}

Rules:
* Return JSON only.
* Do not return Markdown, code fences, explanations, or comments.
* Create a friendly social-media achievement post for friends.
* Use only information provided in the achievement data.
* Do not invent achievements, dates, people, media, or replies.
* Make eventTitle short and engaging.
* Set eventClass based on the achievement type, such as "study_achievement", "work_achievement", "fitness_achievement", "personal_achievement", or "milestone".
* Write the main post in eventBody.eventText. Start with one opening sentence (e.g. "Finished Study Session 3 (01:27:57)."), then list each detail on its own line as a bullet starting with "- " (e.g. "- Document: ...", "- Lecture: ...", "- Course: ...", "- Component: ...", "- Pages: ..."). Do not put all details on one line.
* Use empty arrays for eventImagesURLs and eventVideosURLs.
* Use an empty eventReplies array.
* Use ISO 8601 date format for eventDatePosted.
* Preserve Arabic text exactly when it appears in the input.

Achievement data:
${achievementData}

Post author:
{
  "firstName": "${firstName}",
  "lastName": "${lastName}"
}

Date posted:
"${datePostedISO}"

Optional media:
{
  "images": ${JSON.stringify(imageURLs)},
  "videos": ${JSON.stringify(videoURLs)}
}`;

      let aiParsed = null;
      try {
        const aiRaw = await callAiCompletion(prompt, preferredProvider);
        const cleaned = aiRaw.replace(/^```[a-z]*\n?/i, "").replace(/```$/m, "").trim();
        aiParsed = JSON.parse(cleaned);
      } catch (_aiErr) {
        aiParsed = null;
      }

      const newEvent = {
        eventClass: String(aiParsed?.eventClass || "study_achievement").trim(),
        eventTitle: String(aiParsed?.eventTitle || "").trim(),
        studySessionID,
        eventBody: {
          eventText: String(aiParsed?.eventBody?.eventText || achievementData).trim(),
          eventImagesURLs: Array.isArray(aiParsed?.eventBody?.eventImagesURLs)
            ? aiParsed.eventBody.eventImagesURLs.map((u) => String(u || "").trim()).filter(Boolean)
            : imageURLs,
          eventVideosURLs: Array.isArray(aiParsed?.eventBody?.eventVideosURLs)
            ? aiParsed.eventBody.eventVideosURLs.map((u) => String(u || "").trim()).filter(Boolean)
            : videoURLs,
        },
        eventFooter: {
          eventDatePosted: new Date(datePostedISO),
          eventUserName: { firstName, lastName },
        },
        eventReplies: [],
      };

      user.profile.events.push(newEvent);
      await user.save();
      const savedEvent = user.profile.events[user.profile.events.length - 1];
      return res.status(201).json({
        event: savedEvent.toObject ? savedEvent.toObject() : savedEvent,
      });
    } catch (error) {
      return next(error);
    }
  },
);

UserRouter.delete(
  "/profileEvents/:my_id/:event_id",
  checkAuth,
  requireSelfParam("my_id"),
  async function (req, res, next) {
    try {
      const eventId = String(req.params.event_id || "").trim();
      if (!eventId) return res.status(400).json({ message: "Missing event_id." });
      const user = await UserModel.findById(req.params.my_id).select("profile.events");
      if (!user) return res.status(404).json({ message: "User not found." });
      const before = user.profile.events.length;
      const deletedEvent = user.profile.events.find((e) => String(e._id) === eventId);
      user.profile.events = user.profile.events.filter(
        (e) => String(e._id) !== eventId,
      );
      if (user.profile.events.length === before) {
        return res.status(404).json({ message: "Event not found." });
      }
      await user.save();
      const linkedSessionID = String(deletedEvent?.studySessionID || "").trim();
      if (linkedSessionID) {
        try {
          const fullUser = await UserModel.findById(req.params.my_id);
          if (fullUser) {
            const memoryDoc = await ensureUserMemoryDoc(fullUser);
            if (memoryDoc) {
              const sessions = Array.isArray(memoryDoc.studyPlanner?.programStudySessions)
                ? memoryDoc.studyPlanner.programStudySessions
                : [];
              let changed = false;
              sessions.forEach((s) => {
                if (String(s?.studySessionID || "") === linkedSessionID && s.studySessionPosted) {
                  s.studySessionPosted = false;
                  changed = true;
                }
              });
              if (changed) {
                memoryDoc.markModified("studyPlanner");
                await memoryDoc.save();
              }
            }
          }
        } catch (_sessionErr) {
          // non-fatal: event is deleted, session reset failed silently
        }
      }
      return res.status(200).json({ deletedId: eventId, resetSessionID: linkedSessionID || null });
    } catch (error) {
      return next(error);
    }
  },
);

UserRouter.get(
  "/profileEvents/:my_id",
  checkAuth,
  requireSelfParam("my_id"),
  async function (req, res, next) {
    try {
      const user = await UserModel.findById(req.params.my_id).select(
        "profile.events",
      );
      if (!user) {
        return res.status(404).json({ message: "User not found." });
      }
      const events = Array.isArray(user.profile?.events)
        ? user.profile.events.map((e) => (e.toObject ? e.toObject() : e))
        : [];
      return res.status(200).json({ events });
    } catch (error) {
      return next(error);
    }
  },
);

UserRouter.post(
  "/profileEvents/:owner_id/:event_id/reply",
  checkAuth,
  async function (req, res, next) {
    try {
      const ownerId = String(req.params.owner_id || "").trim();
      const eventId = String(req.params.event_id || "").trim();
      const replierId = String(req.authentication?.userId || "").trim();
      if (!ownerId || !eventId || !replierId) {
        return res.status(400).json({ message: "Missing required parameters." });
      }
      const replyText = String(req.body?.eventReplyText || "").trim();
      if (!replyText) {
        return res.status(400).json({ message: "Reply text is required." });
      }
      const [ownerUser, replierUser] = await Promise.all([
        UserModel.findById(ownerId).select("profile.events"),
        UserModel.findById(replierId).select("profile.firstname profile.lastname"),
      ]);
      if (!ownerUser) return res.status(404).json({ message: "User not found." });
      if (!replierUser) return res.status(404).json({ message: "Replier not found." });
      const event = ownerUser.profile.events.id
        ? ownerUser.profile.events.id(eventId)
        : ownerUser.profile.events.find((e) => String(e._id) === eventId);
      if (!event) return res.status(404).json({ message: "Event not found." });
      const newReply = {
        eventReplyBody: {
          eventReplyText: replyText,
          eventReplyImagesURLs: [],
          eventReplyVideosURLs: [],
        },
        eventReplyFooter: {
          eventReplyDatePosted: new Date(),
          eventReplyUserName: {
            firstName: String(replierUser.profile?.firstname || "").trim(),
            lastName: String(replierUser.profile?.lastname || "").trim(),
          },
        },
      };
      event.eventReplies.push(newReply);
      await ownerUser.save();
      const savedReply = event.eventReplies[event.eventReplies.length - 1];
      return res.status(201).json({
        reply: savedReply.toObject ? savedReply.toObject() : savedReply,
      });
    } catch (error) {
      return next(error);
    }
  },
);

UserRouter.get(
  "/feedEvents/:my_id",
  checkAuth,
  requireSelfParam("my_id"),
  async function (req, res, next) {
    try {
      const user = await UserModel.findById(req.params.my_id).select(
        "profile.events connections friends",
      );
      if (!user) return res.status(404).json({ message: "User not found." });

      const relationshipEntries = Array.isArray(user.connections)
        ? user.connections
        : Array.isArray(user.friends)
          ? user.friends
          : [];
      const friendIds = relationshipEntries
        .map((f) => {
          if (!f) return "";
          const candidate =
            typeof f === "object" && f !== null
              ? f.id || f.userID || f._id || f
              : f;
          const normalized =
            typeof candidate === "object" && candidate !== null
              ? candidate._id || candidate
              : candidate;
          return String(normalized || "").trim();
        })
        .filter(Boolean);

      const ownEvents = Array.isArray(user.profile?.events)
        ? user.profile.events.map((e) => ({
            ...(e.toObject ? e.toObject() : e),
            _isOwn: true,
            _ownerId: String(user._id),
          }))
        : [];

      let friendEvents = [];
      if (friendIds.length > 0) {
        const friends = await UserModel.find({ _id: { $in: friendIds } }).select(
          "profile.events profile.firstname profile.lastname",
        );
        friendEvents = friends.flatMap((friend) =>
          Array.isArray(friend.profile?.events)
            ? friend.profile.events.map((e) => ({
                ...(e.toObject ? e.toObject() : e),
                _isOwn: false,
                _ownerId: String(friend._id),
                _ownerName: {
                  firstName: String(friend.profile?.firstname || "").trim(),
                  lastName: String(friend.profile?.lastname || "").trim(),
                },
              }))
            : [],
        );
      }

      const allEvents = [...ownEvents, ...friendEvents].sort((a, b) => {
        const dateA = new Date(a?.eventFooter?.eventDatePosted || 0).getTime();
        const dateB = new Date(b?.eventFooter?.eventDatePosted || 0).getTime();
        return dateB - dateA;
      });

      return res.status(200).json({ events: allEvents });
    } catch (error) {
      return next(error);
    }
  },
);

//....................
//Attach all the routes to router\
export default UserRouter;
const PLANNER_SELECT_ID_TO_KEY = {
  nogaPlanner_savedCourseSelect_course_classSelection: "componentClassOptions",
  nogaPlanner_lecturesSelect_component: "componentClassOptions",
  nogaPlanner_savedCourseSelect_course_daySelection: "weekdayOptions",
  nogaPlanner_savedCourseSelect_course_timeSelection: "hourOptions",
  nogaPlanner_savedCourseSelect_normativeCourseTerm: "termOptions",
  nogaPlanner_savedCourseSelect_normativeCourseYearInterval: "academicYearOptions",
  nogaPlanner_savedCourseSelect_course_locationBuilding: "locationBuildingOptions",
  nogaPlanner_savedCourseSelect_course_locationRoom: "locationRoomOptions",
  nogaPlanner_lecturesSelect_instructors: "lectureInstructorOptions",
  nogaPlanner_lecturesSelect_writers: "lectureWriterOptions",
};
