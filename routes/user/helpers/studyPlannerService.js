import mongoose from "mongoose";
import {
  getDefaultStudyOrganizerSettings,
  normalizeStudyOrganizerSettings,
  serializeStudyOrganizerSettingsForStorage,
} from "../../../models/MOI/StudyPlanner/StudyOrganizer/settings.js";

const DEFAULT_STUDY_ORGANIZER = {
  courses: [],
  exams: [],
  settings: getDefaultStudyOrganizerSettings(),
};

const DEFAULT_STUDY_PLAN_AID = {
  enabled: false,
  viewMode: "timeline",
  timelineUnit: "day",
  defaults: {
    defaultDailyHours: 0,
    defaultDifficulty: "",
    defaultMastery: "",
    defaultPriority: "",
  },
  coursePlans: [],
  dayPlans: [],
  note: "",
};

const sanitizePlannerSettingsForSchemaStorage = (settings = {}) => {
  const normalizedSettings = normalizeStudyOrganizerSettings(
    toPlainObject(settings) || {},
  );
  const serializedSettings =
    serializeStudyOrganizerSettingsForStorage(normalizedSettings);

  return {
    voiceControlEnabled: Boolean(normalizedSettings?.voiceControlEnabled),
    voiceDictationEnabled: Boolean(normalizedSettings?.voiceDictationEnabled),
    logoFixedClock: String(normalizedSettings?.logoFixedClock || "9").trim() || "9",
    fieldDefaults: Array.isArray(serializedSettings?.fieldDefaults)
      ? serializedSettings.fieldDefaults
      : [],
    relationships: Array.isArray(normalizedSettings?.relationships)
      ? normalizedSettings.relationships.map((entry) => ({
          mode: String(entry?.mode || "").trim(),
          causeField: String(entry?.causeField || "").trim(),
          causeValue: String(entry?.causeValue || "").trim(),
          effectField: String(entry?.effectField || "").trim(),
          effectValue: String(entry?.effectValue || "").trim(),
          active: Boolean(entry?.active),
        }))
      : [],
    messageFriend:
      normalizedSettings?.messageFriend &&
      typeof normalizedSettings.messageFriend === "object"
        ? {
            from:
              normalizedSettings.messageFriend.from &&
              typeof normalizedSettings.messageFriend.from === "object"
                ? {
                    friendID: normalizedSettings.messageFriend.from.friendID,
                    message: String(
                      normalizedSettings.messageFriend.from.message || "",
                    ).trim(),
                  }
                : { message: "" },
            to: Array.isArray(normalizedSettings.messageFriend.to)
              ? normalizedSettings.messageFriend.to.map((entry) => ({
                  friendID: entry?.friendID,
                  message: String(entry?.message || "").trim(),
                }))
              : [],
          }
        : { from: { message: "" }, to: [] },
    voiceCommands: Array.isArray(normalizedSettings?.voiceCommands)
      ? normalizedSettings.voiceCommands.map((entry) => ({
          idTree: Array.isArray(entry?.idTree)
            ? entry.idTree.map((value) => String(value || "").trim()).filter(Boolean)
            : [],
          elementID: String(entry?.elementID || "").trim(),
          voiceCommand: String(entry?.voiceCommand || "").trim(),
        }))
      : [],
    voiceDictationNormalizations: Array.isArray(
      normalizedSettings?.voiceDictationNormalizations,
    )
      ? normalizedSettings.voiceDictationNormalizations.map((entry) => ({
          letter: String(entry?.letter || "").trim(),
          normalizedLetter: String(entry?.normalizedLetter || "").trim(),
          condition: String(entry?.condition || "endOfWord").trim() || "endOfWord",
        }))
      : [],
    predictionTool: Array.isArray(normalizedSettings?.predictionTool)
      ? normalizedSettings.predictionTool.map((entry) => ({
          tab: String(entry?.tab || "").trim(),
          inputFieldID: String(entry?.inputFieldID || "").trim(),
          list: Array.isArray(entry?.list)
            ? entry.list.map((value) => String(value || "").trim()).filter(Boolean)
            : [],
        }))
      : [],
  };
};

const getStudyPlannerRoot = (memoryDoc) => {
  const currentPlanner =
    memoryDoc?.studyPlanner && typeof memoryDoc.studyPlanner === "object"
      ? toPlainObject(memoryDoc.studyPlanner)
      : {};
  const currentOrganizer =
    currentPlanner?.studyOrganizer && typeof currentPlanner.studyOrganizer === "object"
      ? toPlainObject(currentPlanner.studyOrganizer)
      : memoryDoc?.studyOrganizer && typeof memoryDoc.studyOrganizer === "object"
        ? toPlainObject(memoryDoc.studyOrganizer)
        : {};
  if (Object.prototype.hasOwnProperty.call(currentOrganizer, "settings")) {
    delete currentOrganizer.settings;
  }
  const currentStudyPlanAid =
    currentPlanner?.studyPlanAid && typeof currentPlanner.studyPlanAid === "object"
      ? toPlainObject(currentPlanner.studyPlanAid)
      : memoryDoc?.studyPlanAid && typeof memoryDoc.studyPlanAid === "object"
        ? toPlainObject(memoryDoc.studyPlanAid)
        : {};
  const currentProgramComponents = Array.isArray(currentPlanner?.programComponentNames)
    ? currentPlanner.programComponentNames
        .map((entry, index) => {
          if (entry && typeof entry === "object") {
            const componentName = String(entry.componentName || "").trim();
            if (!componentName) return null;
            return {
              componentName,
              componentNum:
                Number.isFinite(Number(entry.componentNum))
                  ? Number(entry.componentNum)
                  : index + 1,
            };
          }
          const componentName = String(entry || "").trim();
          return componentName ? { componentName, componentNum: index + 1 } : null;
        })
        .filter(Boolean)
    : [];
  const currentProgramTaskNames =
    normalizeProgramTaskNamesForPlanner(currentPlanner);
  const currentProgramIntervals = Array.isArray(currentPlanner?.programIntervals)
    ? currentPlanner.programIntervals.map((entry) => toPlainObject(entry) || {})
    : [];
  const currentProgramExams = Array.isArray(currentPlanner?.programExams)
    ? currentPlanner.programExams.map((entry) => toPlainObject(entry) || {})
    : [];
  const currentExams = Array.isArray(currentPlanner?.exams)
    ? currentPlanner.exams.map((entry) => toPlainObject(entry) || {})
    : [];
  const currentProgramFailingRules =
    normalizeProgramFailingRulesForPlanner(currentPlanner);

  // Strip _id plus any stale/virtual keys not in StudyPlannerSchema (strict: "throw")
  const {
    _id: plannerId,
    programComponents,
    programExamClasses,
    programId,
    programInstructors,
    ...plannerWithoutId
  } = currentPlanner || {};
  void programComponents; void programExamClasses; void programId; void programInstructors;
  void plannerId;
  memoryDoc.studyPlanner = {
    ...plannerWithoutId,
    programTaskNames: currentProgramTaskNames,
    programExams: currentProgramExams,
    programFailingRules: currentProgramFailingRules,
    programComponentNames: currentProgramComponents,
    programIntervals: currentProgramIntervals,
    studyOrganizer: (() => {
      const { _id, ...organizerWithoutId } = currentOrganizer || {};
      void _id;
      return organizerWithoutId;
    })(),
    exams: currentExams,
  };

  if (memoryDoc?.studyOrganizer) {
    delete memoryDoc.studyOrganizer;
  }

  return memoryDoc.studyPlanner;
};

const { Types } = mongoose;

const toPlainObject = (value) =>
  value && typeof value?.toObject === "function" ? value.toObject() : value;

const normalizeObjectIdValue = (value, { allowNull = false } = {}) => {
  if (value === null || value === undefined || value === "") {
    return allowNull ? null : undefined;
  }

  if (value instanceof Types.ObjectId) {
    return value;
  }

  const nestedId = value?._id;
  if (nestedId && nestedId !== value) {
    return normalizeObjectIdValue(nestedId, { allowNull });
  }

  const normalizedString = String(value || "").trim();
  if (normalizedString && Types.ObjectId.isValid(normalizedString)) {
    return new Types.ObjectId(normalizedString);
  }

  const rawBuffer =
    value?.buffer && typeof value.buffer === "object" ? value.buffer : null;
  if (rawBuffer) {
    const orderedBytes = Object.keys(rawBuffer)
      .sort((left, right) => Number(left) - Number(right))
      .map((key) => Number(rawBuffer[key]))
      .filter((byte) => Number.isInteger(byte) && byte >= 0 && byte <= 255);

    if (orderedBytes.length === 12) {
      try {
        return new Types.ObjectId(Buffer.from(orderedBytes));
      } catch {
        return allowNull ? null : undefined;
      }
    }
  }

  return allowNull ? null : undefined;
};

const trimString = (value) => String(value || "").trim();
const sanitizeId = (id) => (typeof id === "string" ? id.replace(/[-_]/g, "") : id);
const resolveStoredDocumentVolumeNumber = (value) => {
  if (Number.isFinite(Number(value))) {
    return Number(value);
  }
  return null;
};
const buildStoredDocumentPages = (volumeValue, rawPages = []) => {
  const normalizedDocumentVolume = resolveStoredDocumentVolumeNumber(volumeValue);
  const maxPages =
    Number.isFinite(normalizedDocumentVolume) && normalizedDocumentVolume > 0
      ? Math.max(0, Math.trunc(normalizedDocumentVolume))
      : 0;
  if (maxPages === 0) {
    return [];
  }
  const fallbackPages = Array.isArray(rawPages) ? rawPages : [];
  return Array.from({ length: maxPages }, (_, index) => {
    const pageOrder = index + 1;
    const existingPage = fallbackPages.find(
      (pageEntry) => Number(pageEntry?.pageOrder) === pageOrder,
    ) || {};
    return {
      pageOrder,
      pageStatus: trimString(existingPage?.pageStatus) || null,
      pageNotes: Array.isArray(existingPage?.pageNotes)
        ? existingPage.pageNotes.map((pageNote) => trimString(pageNote)).filter(Boolean)
        : [],
    };
  });
};
const normalizeProgramComponentValue = (entry = null) => {
  if (typeof entry === "string" || typeof entry === "number" || typeof entry === "boolean") {
    return trimString(entry);
  }
  if (!entry || typeof entry !== "object") {
    return "";
  }
  const rawValue =
    entry?.componentClass ??
    entry?.componentName ??
    entry?.componentId ??
    entry?.label ??
    "";
  if (
    typeof rawValue === "string" ||
    typeof rawValue === "number" ||
    typeof rawValue === "boolean"
  ) {
    return trimString(rawValue);
  }
  return "";
};
const normalizeProgramFailingRuleEntry = (entry = null) => {
  const normalizedEntry =
    entry && typeof entry === "object" ? toPlainObject(entry) || {} : {};
  const thresholdUnit = trimString(normalizedEntry?.thresholdUnit);
  const thresholdMode = trimString(normalizedEntry?.thresholdMode);
  const thresholdNumber = toFiniteNumber(normalizedEntry?.thresholdNumber, null);
  const thresholdRuleRaw = trimString(normalizedEntry?.thresholdRule);
  const validThresholdRules = ["less than", "equal", "more than"];
  const thresholdRule = validThresholdRules.includes(thresholdRuleRaw) ? thresholdRuleRaw : null;

  if (!thresholdUnit && !thresholdMode && !Number.isFinite(thresholdNumber)) {
    return null;
  }

  return {
    thresholdMode: thresholdMode || null,
    thresholdUnit: thresholdUnit || null,
    thresholdNumber: Number.isFinite(thresholdNumber) ? thresholdNumber : null,
    thresholdRule: thresholdRule || null,
  };
};

export const normalizeProgramFailingRulesForPlanner = (planner = {}) => {
  const normalizedPlanner =
    planner && typeof planner === "object" ? toPlainObject(planner) || {} : {};
  const explicitRules = Array.isArray(normalizedPlanner?.programFailingRules)
    ? normalizedPlanner.programFailingRules
        .map((entry) => normalizeProgramFailingRuleEntry(entry))
        .filter(Boolean)
    : [];

  if (explicitRules.length > 0) {
    return explicitRules;
  }

  const legacyRule = normalizeProgramFailingRuleEntry(
    normalizedPlanner?.programPassingThresholdPerInterval,
  );
  return legacyRule ? [legacyRule] : [];
};

export const normalizeProgramComponentsForPlanner = (planner = {}) => {
  const normalizedPlanner =
    planner && typeof planner === "object" ? toPlainObject(planner) || {} : {};
  const components = Array.isArray(normalizedPlanner?.programComponentNames)
    ? normalizedPlanner.programComponentNames
    : [];
  return components.map((entry) => normalizeProgramComponentValue(entry)).filter(Boolean);
};

export const normalizeProgramTaskNamesForPlanner = (planner = {}) => {
  const normalizedPlanner =
    planner && typeof planner === "object" ? toPlainObject(planner) || {} : {};
  const taskNames = Array.isArray(normalizedPlanner?.programTaskNames)
    ? normalizedPlanner.programTaskNames
    : [];
  return taskNames
    .map((entry) => String(entry || "").trim())
    .filter(Boolean);
};

const normalizeProgramTask = (taskEntry = {}) => {
  const entry = taskEntry && typeof taskEntry === "object" ? toPlainObject(taskEntry) || {} : {};
  const taskInfo = entry?.taskInfo && typeof entry.taskInfo === "object" ? toPlainObject(entry.taskInfo) || {} : entry;
  const taskID = sanitizeId(trimString(taskInfo?.taskID || entry?.taskID || ""));
  if (!taskID) return null;
  return {
    taskInfo: {
      taskSymbol: trimString(taskInfo?.taskSymbol) || "TSK",
      taskNum: Number.isFinite(Number.parseInt(taskInfo?.taskNum, 10)) ? Number.parseInt(taskInfo.taskNum, 10) : null,
      taskID,
      taskName: trimString(taskInfo?.taskName || taskInfo?.examClass || entry?.examClass || ""),
      taskLocation: sanitizeStudyLocation(taskInfo?.taskLocation || taskInfo?.location || {}),
      taskDate: parseOptionalDate(taskInfo?.taskDate || null),
      taskTime: trimString(taskInfo?.taskTime || ""),
      taskWeight: Number.isFinite(Number(taskInfo?.taskWeight)) ? Number(taskInfo.taskWeight) : null,
      taskGrade: Number.isFinite(Number(taskInfo?.taskGrade)) ? Number(taskInfo.taskGrade) : null,
    },
    tasksLectures: normalizeReferenceIds(entry?.tasksLectures || []),
  };
};

export const normalizeProgramTasksForPlanner = (planner = {}) => {
  const normalizedPlanner = planner && typeof planner === "object" ? toPlainObject(planner) || {} : {};
  const tasks = Array.isArray(normalizedPlanner?.programTasks) ? normalizedPlanner.programTasks : [];
  return tasks.map(normalizeProgramTask).filter(Boolean);
};

const normalizeExamPart = (partEntry = {}) => {
  const entry =
    partEntry && typeof partEntry === "object" ? toPlainObject(partEntry) || {} : {};
  const componentID = sanitizeId(trimString(
    entry?.componentID || entry?.componentId || entry?.courseID || entry?.courseId || "",
  ));
  const examClass = trimString(entry?.examClass || "");
  if (!componentID || !examClass) return null;
  const examPartID = sanitizeId(trimString(entry?.examPartID)) || `${componentID}exam${examClass}`;
  return {
    examPartID,
    componentID,
    examClass,
    taskLocation: sanitizeStudyLocation(entry?.taskLocation || entry?.location || {}),
    taskDate: parseOptionalDate(entry?.taskDate || entry?.date || null),
    taskTime: trimString(entry?.taskTime || ""),
    examlectureIDs: normalizeReferenceIds(entry?.examlectureIDs || entry?.lectureIDs),
    taskWeight: Number.isFinite(Number(entry?.taskWeight)) ? Number(entry.taskWeight) : null,
    taskGrade: Number.isFinite(Number(entry?.taskGrade)) ? Number(entry.taskGrade) : null,
  };
};

export const normalizeProgramExamsForPlanner = (planner = {}) => {
  const normalizedPlanner =
    planner && typeof planner === "object" ? toPlainObject(planner) || {} : {};
  const exams = Array.isArray(normalizedPlanner?.programExams)
    ? normalizedPlanner.programExams
    : [];
  return exams
    .map((entry) => {
      const normalizedEntry =
        entry && typeof entry === "object" ? toPlainObject(entry) || {} : {};
      const componentID = sanitizeId(trimString(normalizedEntry?.componentID || ""));
      if (!componentID) return null;
      const parts = Array.isArray(normalizedEntry?.examParts)
        ? normalizedEntry.examParts.map(normalizeExamPart).filter(Boolean)
        : [];
      return { componentID, examParts: parts };
    })
    .filter(Boolean);
};

const repairArabicMojibake = (value) => {
  const normalizedValue = trimString(value);

  if (!/[Ã˜Ã™Ã¸Ã¹]/.test(normalizedValue)) {
    return normalizedValue;
  }

  try {
    const repairedValue = Buffer.from(normalizedValue, "latin1").toString("utf8");
    return /[\u0600-\u06FF]/.test(repairedValue) ? repairedValue.trim() : normalizedValue;
  } catch {
    return normalizedValue;
  }
};

const normalizeOptionalPlannerString = (value) => {
  const normalizedValue = repairArabicMojibake(value);
  return normalizedValue === "-" ? "" : normalizedValue;
};

const normalizeStudyTerm = (value) => normalizeOptionalPlannerString(value);

const normalizePlannerStatusValue = (value) => {
  const normalizedValue = normalizeOptionalPlannerString(value).toLowerCase();
  const aliases = {
    pending: "pending",
    "set later": "pending",
    new: "new",
    failed: "failed",
    passed: "passed",
    incomplete: "incomplete",
    ongoing: "ongoing",
    "not started": "pending",
  };
  return aliases[normalizedValue] || "new";
};

const normalizeComponentStatus = (value) => normalizePlannerStatusValue(value);

const normalizeCourseStatus = (value) => normalizePlannerStatusValue(value);



const normalizeExamType = (value) => normalizeOptionalPlannerString(value);

const classifyStudyTerm = (value) => {
  const normalizedValue = normalizeOptionalPlannerString(value).toLowerCase();
  const termAliases = {
    first: "first",
    fall: "first",
    second: "second",
    winter: "second",
    third: "third",
    summer: "third",
  };

  return termAliases[normalizedValue] || normalizedValue;
};


const normalizeStringArray = (value) =>
  (Array.isArray(value) ? value : [value])
    .map((entry) => trimString(entry))
    .filter(Boolean);

const normalizeDelimitedStringArray = (value) =>
  (Array.isArray(value) ? value : String(value || "").split(/\||,|\n|;/))
    .flatMap((entry) =>
      Array.isArray(entry) ? entry : String(entry || "").split(/\||,|\n|;/),
    )
    .map((entry) => trimString(entry))
    .filter(Boolean);

const parseOptionalDate = (value) => {
  const normalizedValue = trimString(value);

  if (!normalizedValue || normalizedValue === "-") {
    return null;
  }

  const nextDate = new Date(normalizedValue);
  return Number.isNaN(nextDate.getTime()) ? null : nextDate;
};

const parseOptionalInteger = (value) => {
  const normalizedValue = trimString(value);
  if (!normalizedValue) {
    return null;
  }
  if (!/^-?\d+$/.test(normalizedValue)) {
    return null;
  }
  const parsed = Number(normalizedValue);
  return Number.isInteger(parsed) ? parsed : null;
};

const parseDateToComponents = (value) => {
  const buildDateField = (year, month, day) => {
    if (
      !Number.isInteger(year) ||
      year < 1000 ||
      year > 9999 ||
      !Number.isInteger(month) ||
      month < 1 ||
      month > 12 ||
      !Number.isInteger(day) ||
      day < 1 ||
      day > 31
    ) {
      return null;
    }
    const isoValue = `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    const nextDate = new Date(`${isoValue}T00:00:00.000Z`);
    return Number.isNaN(nextDate.getTime()) ? null : nextDate;
  };
  // Already {day, month, year, date} object
  if (value && typeof value === "object" && !Array.isArray(value)) {
    if (value instanceof Date) {
      return Number.isNaN(value.getTime())
        ? { day: null, month: null, year: null, date: null }
        : {
            day: value.getUTCDate(),
            month: value.getUTCMonth() + 1,
            year: value.getUTCFullYear(),
            date: value,
          };
    }
    const day = parseOptionalInteger(value?.day);
    const month = parseOptionalInteger(value?.month);
    const year = parseOptionalInteger(value?.year);
    const rawDate = value?.date;
    const normalizedDate = rawDate instanceof Date
      ? (Number.isNaN(rawDate.getTime()) ? null : rawDate)
      : parseOptionalDate(rawDate);
    return {
      day,
      month,
      year,
      date: normalizedDate || buildDateField(year, month, day),
    };
  }
  const s = trimString(value);
  if (!s || s === "-") return { day: null, month: null, year: null, date: null };
  // Full ISO: "2025-09-01"
  const fullMatch = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (fullMatch) {
    const year = Number(fullMatch[1]);
    const month = Number(fullMatch[2]);
    const day = Number(fullMatch[3]);
    return {
      day,
      month,
      year,
      date: buildDateField(year, month, day),
    };
  }
  const slashMatch = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (slashMatch) {
    const day = Number(slashMatch[1]);
    const month = Number(slashMatch[2]);
    const year = Number(slashMatch[3]);
    return {
      day,
      month,
      year,
      date: buildDateField(year, month, day),
    };
  }
  const slashWithoutYearMatch = s.match(/^(\d{1,2})\/(\d{1,2})$/);
  if (slashWithoutYearMatch) {
    const day = Number(slashWithoutYearMatch[1]);
    const month = Number(slashWithoutYearMatch[2]);
    return { day, month, year: null, date: null };
  }
  // Year only: "2025"
  const yearMatch = s.match(/^(\d{4})$/);
  if (yearMatch) return { day: null, month: null, year: Number(yearMatch[1]), date: null };
  return { day: null, month: null, year: null, date: null };
};

const normalizeReferenceIds = (value) =>
  (Array.isArray(value) ? value : [value])
    .map((entry) => normalizeIdString(entry))
    .filter(Boolean);

const toFiniteNumber = (value, fallback = 0) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const toPositiveInteger = (value, fallback = 0) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return fallback;
  }
  return Math.trunc(parsed);
};

const normalizeIdString = (value) => trimString(value?._id || value);

const buildLectureCourseLabel = (courseName = "", componentName = "") => {
  const normalizedCourseName = trimString(courseName);
  const normalizedComponentName = trimString(componentName);

  if (!normalizedCourseName) {
    return normalizedComponentName;
  }

  if (
    normalizedComponentName &&
    normalizedComponentName !== "-" &&
    normalizedComponentName !== normalizedCourseName
  ) {
    return `${normalizedCourseName} (${normalizedComponentName})`;
  }

  return normalizedCourseName;
};

const splitLectureCourseLabel = (value = "") => {
  const normalizedValue = trimString(value);
  const match = normalizedValue.match(/^(.*?)(?:\s+\(([^()]+)\))?$/);

  if (!match) {
    return {
      baseCourseName: normalizedValue,
      componentName: "",
    };
  }

  return {
    baseCourseName: trimString(match[1]),
    componentName: trimString(match[2]),
  };
};

const stripComponentFromCourseLabel = (courseName = "", componentName = "") => {
  const normalizedCourseName = trimString(courseName);
  const normalizedComponentName = trimString(componentName);

  if (!normalizedCourseName) {
    return "";
  }

  if (
    normalizedComponentName &&
    normalizedCourseName.endsWith(` (${normalizedComponentName})`)
  ) {
    return normalizedCourseName.slice(0, -` (${normalizedComponentName})`.length);
  }

  return normalizedCourseName;
};

const getComponentTimingStatus = (component = {}) => {
  const normalizedComponent = toPlainObject(component) || {};
  const componentTime =
    normalizedComponent?.time && typeof normalizedComponent.time === "object"
      ? normalizedComponent.time
      : {};
  const normativeYearNum = toFiniteNumber(
    normalizedComponent?.normativeCourseYearNum ??
      componentTime?.Normative?.courseYearNum,
    null,
  );
  const actualYearNum = toFiniteNumber(
    normalizedComponent?.actualCourseYearNum ??
      componentTime?.actual?.courseYearNum,
    null,
  );
  const normativeTerm = normalizeStudyTerm(
    normalizedComponent?.normativeCourseTerm ||
      componentTime?.Normative?.courseTerm,
  );
  const actualTerm = normalizeStudyTerm(
    normalizedComponent?.actualCourseTerm ||
      componentTime?.actual?.courseTerm,
  );

  if (Number.isFinite(actualYearNum) && Number.isFinite(normativeYearNum)) {
    if (actualYearNum > normativeYearNum) {
      return "failed";
    }

    if (
      actualYearNum === normativeYearNum &&
      normativeTerm &&
      actualTerm &&
      normativeTerm !== actualTerm
    ) {
      return "failed";
    }

    if (actualYearNum === normativeYearNum && normativeTerm && actualTerm) {
      return normativeTerm === actualTerm ? "new" : "failed";
    }
  }

  return "-";
};

const hasExactPlannerComponentTimingMatch = (component = {}) => {
  const normalizedComponent = toPlainObject(component) || {};
  const componentTime =
    normalizedComponent?.time && typeof normalizedComponent.time === "object"
      ? normalizedComponent.time
      : {};
  const normativeYearNum = toFiniteNumber(
    normalizedComponent?.normativeCourseYearNum ??
      componentTime?.Normative?.courseYearNum,
    null,
  );
  const actualYearNum = toFiniteNumber(
    normalizedComponent?.actualCourseYearNum ??
      componentTime?.actual?.courseYearNum,
    null,
  );
  const normativeYearInterval = normalizeOptionalPlannerString(
    normalizedComponent?.normativeCourseYearInterval ||
      componentTime?.Normative?.courseYearInterval,
  );
  const actualYearInterval = normalizeOptionalPlannerString(
    normalizedComponent?.actualCourseYearInterval ||
      componentTime?.actual?.courseYearInterval,
  );
  const normativeTerm = classifyStudyTerm(
    normalizedComponent?.normativeCourseTerm ||
      componentTime?.Normative?.courseTerm,
  );
  const actualTerm = classifyStudyTerm(
    normalizedComponent?.actualCourseTerm || componentTime?.actual?.courseTerm,
  );

  return (
    Number.isFinite(normativeYearNum) &&
    Number.isFinite(actualYearNum) &&
    normativeYearNum === actualYearNum &&
    normativeYearInterval === actualYearInterval &&
    normativeTerm === actualTerm
  );
};

const getComparableExamThreshold = (grade = {}) => {
  const candidate = grade && typeof grade === "object" ? grade : {};
  const orderedValues = [
    candidate?.value,
    candidate?.passThreshold,
    candidate?.min,
    candidate?.maxGrade,
    candidate?.max,
  ];

  for (const value of orderedValues) {
    const parsedValue = Number(value);
    if (Number.isFinite(parsedValue)) {
      return parsedValue;
    }
  }

  return null;
};

const classifyExamResultStatus = (value) => {
  const normalizedValue = repairArabicMojibake(value).toLowerCase();
  const statusAliases = {
    passed: "passed",
    pass: "passed",
    success: "passed",
    successful: "passed",
    failed: "failed",
    fail: "failed",
    pending: "",
    new: "",
    "not started": "",
    "in progress": "",
  };
  return statusAliases[normalizedValue] || "";
};

const deriveExamGradeStatusFromValues = (grade = {}, passGrade = {}) => {
  const rawGradeValue = grade?.value ?? grade?.gradeValue;
  const rawPassThreshold =
    grade?.passThreshold ??
    passGrade?.passThreshold ??
    passGrade?.value ??
    passGrade?.min;
  const hasGradeValue = rawGradeValue !== null && rawGradeValue !== undefined;
  const hasPassThreshold =
    rawPassThreshold !== null && rawPassThreshold !== undefined;
  const gradeValue = hasGradeValue ? Number(rawGradeValue) : null;
  const passThreshold = hasPassThreshold ? Number(rawPassThreshold) : null;
  if (!Number.isFinite(gradeValue) || !Number.isFinite(passThreshold)) {
    return trimString(grade?.status || "");
  }
  return gradeValue < passThreshold ? "failed" : "passed";
};

const derivePlannerComponentStatus = (component = {}, plannerExams = []) => {
  const normalizedComponent = toPlainObject(component) || {};
  void plannerExams;
  const componentTime =
    normalizedComponent?.time && typeof normalizedComponent.time === "object"
      ? normalizedComponent.time
      : {};
  const normativeYearInterval = normalizeOptionalPlannerString(
    normalizedComponent?.normativeCourseYearInterval ||
      componentTime?.Normative?.courseYearInterval,
  );
  const normativeTerm = classifyStudyTerm(
    normalizedComponent?.normativeCourseTerm ||
      componentTime?.Normative?.courseTerm,
  );
  if (!normativeYearInterval || !normativeTerm) {
    return "pending";
  }
  if (hasExactPlannerComponentTimingMatch(normalizedComponent)) {
    return "new";
  }
  const componentExams = Array.isArray(normalizedComponent?.exams)
    ? normalizedComponent.exams.map((exam) => toPlainObject(exam) || {})
    : [];
  const explicitExamStatuses = componentExams
    .map((exam) =>
      classifyExamResultStatus(
        exam?.grade?.status || exam?.resultStatus || exam?.status,
      ),
    )
    .filter(Boolean);
  if (explicitExamStatuses.some((status) => status === "failed")) {
    return "failed";
  }
  if (explicitExamStatuses.some((status) => status === "passed")) {
    return "passed";
  }
  const evaluatedExams = componentExams
    .map((exam) => ({
      gradeValue: getComparableExamThreshold(exam?.grade || {}),
      passGradeValue: getComparableExamThreshold(exam?.passGrade || {}),
    }))
    .filter(
      ({ gradeValue, passGradeValue }) =>
        Number.isFinite(gradeValue) &&
        Number.isFinite(passGradeValue) &&
        (gradeValue > 0 || passGradeValue > 0),
    );
  if (evaluatedExams.length > 0) {
    return evaluatedExams.some(
      ({ gradeValue, passGradeValue }) => gradeValue < passGradeValue,
    )
      ? "failed"
      : "passed";
  }
  return "new";
};

const derivePlannerCourseStatus = (components = [], plannerExams = []) => {
  const componentStatuses = (Array.isArray(components) ? components : [])
    .map((component) => derivePlannerComponentStatus(component))
    .filter(Boolean);
  if (componentStatuses.length === 0) {
    return "new";
  }
  if (componentStatuses.every((status) => status === "pending")) {
    return "pending";
  }
  if (componentStatuses.every((status) => status === "new")) {
    return "new";
  }
  if (componentStatuses.every((status) => status === "failed")) {
    return "failed";
  }
  if (componentStatuses.every((status) => status === "passed")) {
    return "passed";
  }
  if (componentStatuses.some((status) => status === "passed")) {
    return "incomplete";
  }
  return "incomplete";
};

const buildWeight = (value, previousWeight = {}) => {
  const parsedValue = Number(value);
  const parsedTotal = Number(previousWeight?.total);

  return {
    value: Number.isFinite(parsedValue)
      ? parsedValue
      : Number(previousWeight?.value) || 0,
    total: Number.isFinite(parsedTotal) ? parsedTotal : 100,
  };
};

const buildLocation = (payload = {}, previousLocation = {}) => ({
  building:
    trimString(payload?.course_locationBuilding) ||
    trimString(previousLocation?.building),
  room: trimString(payload?.course_locationRoom) || trimString(previousLocation?.room),
});

const buildVolume = (value, previousVolume = {}) => ({
  value: toFiniteNumber(value, Number(previousVolume?.value) || 0),
  scope: trimString(previousVolume?.scope),
  note: trimString(previousVolume?.note),
});

const buildGrade = (
  value,
  previousGrade = {},
  { assignTo = "max" } = {},
) => {
  const parsedValue = Number(value);
  const previousValue = Number(previousGrade?.value);
  const previousPassThreshold = Number(
    previousGrade?.passThreshold ?? previousGrade?.min,
  );
  const previousMax = Number(previousGrade?.max);
  const previousMaxGrade = Number(
    previousGrade?.maxGrade ?? previousGrade?.max,
  );

  const nextValue =
    assignTo === "value"
      ? Number.isFinite(parsedValue)
        ? parsedValue
        : Number.isFinite(previousValue)
          ? previousValue
          : null
      : Number.isFinite(previousValue)
        ? previousValue
        : null;
  const nextMax =
    assignTo === "max"
      ? Number.isFinite(parsedValue)
        ? parsedValue
        : Number.isFinite(previousMaxGrade)
          ? previousMaxGrade
          : Number.isFinite(previousMax)
            ? previousMax
            : null
      : Number.isFinite(previousMaxGrade)
        ? previousMaxGrade
        : Number.isFinite(previousMax)
          ? previousMax
          : null;
  const nextPassThreshold = Number.isFinite(previousPassThreshold)
    ? previousPassThreshold
    : null;

  return {
    value: nextValue,
    passThreshold: nextPassThreshold,
    min: nextPassThreshold,
    maxGrade: nextMax,
    max: nextMax,
    status: trimString(previousGrade?.status),
  };
};

const sanitizeStudyLocation = (value = {}) => {
  const rooms = Array.isArray(value?.rooms)
    ? value.rooms
    : value?.room
      ? [value.room]
      : [];

  return {
    building: trimString(value?.building),
    rooms: Array.from(
      new Set(rooms.map((entry) => trimString(entry)).filter(Boolean)),
    ),
  };
};

const sanitizeWeeklyScheduleEntry = (value = {}) => ({
  day: trimString(value?.day),
  time: trimString(value?.time),
  holydays: Array.isArray(value?.holydays)
    ? value.holydays.filter(Boolean).map((entry) => new Date(entry))
    : [],
  location: sanitizeStudyLocation(value?.location || {}),
});

const sanitizeStudyTime = (value = {}) => {
  const normalizedProgramYear = toFiniteNumber(value?.programYear, null);
  const normalizedNormativeYear = toFiniteNumber(
    value?.Normative?.courseYearNum,
    null,
  );
  const normalizedActualYear = toFiniteNumber(
    value?.actual?.courseYearNum,
    null,
  );

  return {
    programYear:
      Number.isFinite(normalizedProgramYear) && normalizedProgramYear >= 0
        ? Math.trunc(normalizedProgramYear)
        : null,
    academicYear: trimString(value?.academicYear) || null,
    term: normalizeStudyTerm(value?.term) || null,
    Normative: {
      courseYearNum:
        Number.isFinite(normalizedNormativeYear) && normalizedNormativeYear >= 0
          ? Math.trunc(normalizedNormativeYear)
          : null,
      courseYearInterval: trimString(value?.Normative?.courseYearInterval) || null,
      courseTerm: normalizeStudyTerm(value?.Normative?.courseTerm) || null,
    },
    actual: {
      courseYearNum:
        Number.isFinite(normalizedActualYear) && normalizedActualYear >= 0
          ? Math.trunc(normalizedActualYear)
          : null,
      courseYearInterval: trimString(value?.actual?.courseYearInterval) || null,
      courseTerm: normalizeStudyTerm(value?.actual?.courseTerm) || null,
    },
    startsAt: value?.startsAt ? new Date(value.startsAt) : null,
    endsAt: value?.endsAt ? new Date(value.endsAt) : null,
  };
};

const sanitizeStudyWeight = (value = {}) => ({
  value: toFiniteNumber(value?.value, 0),
  total: toFiniteNumber(value?.total, 100),
});

const normalizeComponentWeightNumber = (value, fallbackValue = 0) => {
  if (value && typeof value === "object") {
    return toFiniteNumber(value?.value, fallbackValue);
  }
  return toFiniteNumber(value, fallbackValue);
};

const sanitizeStudyVolume = (value = {}) => {
  const total = toFiniteNumber(value?.total ?? value?.value, 0);
  const done = toFiniteNumber(value?.done, 0);
  const remaining = toFiniteNumber(
    value?.remaining,
    Math.max(total - done, 0),
  );
  return {
    total: Math.max(total, 0),
    done: Math.max(done, 0),
    remaining: Math.max(remaining, 0),
  };
};

const normalizeLecturePagesFinished = (value = []) =>
  Array.from(
    new Set(
      (Array.isArray(value) ? value : [])
        .map((pageNumber) => toPositiveInteger(pageNumber, 0))
        .filter((pageNumber) => pageNumber > 0),
    ),
  ).sort((left, right) => left - right);

const sanitizeStudyGrade = (value = {}) => ({
  value:
    value?.value === null || value?.value === undefined
      ? null
      : toFiniteNumber(value?.value, null),
  passThreshold:
    value?.passThreshold === null || value?.passThreshold === undefined
      ? value?.min === null || value?.min === undefined
        ? null
        : toFiniteNumber(value?.min, null)
      : toFiniteNumber(value?.passThreshold, null),
  min:
    value?.min === null || value?.min === undefined
      ? null
      : toFiniteNumber(value?.min, null),
  maxGrade:
    value?.maxGrade === null || value?.maxGrade === undefined
      ? value?.max === null || value?.max === undefined
        ? null
        : toFiniteNumber(value?.max, null)
      : toFiniteNumber(value?.maxGrade, null),
  max:
    value?.max === null || value?.max === undefined
      ? null
      : toFiniteNumber(value?.max, null),
  status: trimString(value?.status),
});

const sanitizePageTextData = (value = {}) => ({
  ...(normalizeObjectIdValue(value?._id) ? { _id: normalizeObjectIdValue(value?._id) } : {}),
  kind: trimString(value?.kind) || "text-already",
  text: trimString(value?.text),
  normalizedText: trimString(value?.normalizedText),
  source: trimString(value?.source) || "page",
  isConvertedFromNonText: Boolean(value?.isConvertedFromNonText),
  converter: {
    name: trimString(value?.converter?.name),
    version: trimString(value?.converter?.version),
    note: trimString(value?.converter?.note),
  },
});

const sanitizePageNonTextData = (value = {}) => ({
  ...(normalizeObjectIdValue(value?._id) ? { _id: normalizeObjectIdValue(value?._id) } : {}),
  kind: trimString(value?.kind) || "unknown",
  source: trimString(value?.source),
  mimeType: trimString(value?.mimeType),
  description: trimString(value?.description),
  extractedTextStatus: trimString(value?.extractedTextStatus) || "none",
  data: value?.data ?? null,
});

const sanitizeStudyPage = (value = {}) => ({
  ...(normalizeObjectIdValue(value?._id) ? { _id: normalizeObjectIdValue(value?._id) } : {}),
  order: toPositiveInteger(value?.order, 0),
  status: trimString(value?.status),
  textData: Array.isArray(value?.textData)
    ? value.textData.map((entry) => sanitizePageTextData(toPlainObject(entry) || {}))
    : [],
  nonTextData: Array.isArray(value?.nonTextData)
    ? value.nonTextData.map((entry) =>
        sanitizePageNonTextData(toPlainObject(entry) || {}),
      )
    : [],
});

const sanitizeStudyLecture = (value = {}) => ({
  ...(normalizeObjectIdValue(value?._id) ? { _id: normalizeObjectIdValue(value?._id) } : {}),
  title: trimString(value?.title),
  instructors: normalizeStringArray(value?.instructors),
  writer: normalizeStringArray(value?.writer),
  publishDate: parseOptionalDate(value?.publishDate),
  weight: sanitizeStudyWeight(value?.weight || {}),
  textDensity: toFiniteNumber(value?.textDensity, 0),
  progress: toFiniteNumber(value?.progress, 0),
  content: Array.isArray(value?.content)
    ? value.content.map((entry) => sanitizeStudyPage(toPlainObject(entry) || {}))
    : Array.isArray(value?.pages)
      ? value.pages.map((entry) => sanitizeStudyPage(toPlainObject(entry) || {}))
    : [],
});

const sanitizeStudyComponent = (value = {}) => ({
  ...(normalizeObjectIdValue(value?._id) ? { _id: normalizeObjectIdValue(value?._id) } : {}),
  order: toPositiveInteger(value?.order, 0),
  class: trimString(value?.class),
  status: normalizeComponentStatus(value?.status),
  time: sanitizeStudyTime(value?.time || {}),
  location: sanitizeStudyLocation(value?.location || {}),
  schedule: Array.isArray(value?.schedule)
    ? value.schedule.map((entry) => sanitizeWeeklyScheduleEntry(entry))
    : [],
  weight: normalizeComponentWeightNumber(value?.weight, 0),
  lectures: Array.isArray(value?.lectures)
    ? value.lectures.map((entry) => sanitizeStudyLecture(toPlainObject(entry) || {}))
    : [],
  exams: Array.isArray(value?.exams)
    ? value.exams.map((entry) => sanitizeStudyExam(toPlainObject(entry) || {}))
    : [],
  componentInstructors: Array.isArray(value?.componentInstructors)
    ? value.componentInstructors
        .map((entry) => {
          const source = toPlainObject(entry) || {};
          const firstName = trimString(source?.firstName);
          const lastName = trimString(source?.lastName);
          return firstName || lastName ? { firstName, lastName } : null;
        })
        .filter(Boolean)
    : [],
});

const sanitizeStudyCourse = (value = {}) => ({
  ...(normalizeObjectIdValue(value?._id) ? { _id: normalizeObjectIdValue(value?._id) } : {}),
  code: trimString(value?.code),
  name: trimString(value?.name) || "-",
  status: normalizeCourseStatus(value?.status),
  weight: toFiniteNumber(value?.weight ?? value?.totalWeight, null),
  components: Array.isArray(value?.components)
    ? value.components.map((entry) => sanitizeStudyComponent(toPlainObject(entry) || {}))
    : [],
});

const sanitizeStudyExam = (value = {}) => ({
  ...(normalizeObjectIdValue(value?._id) ? { _id: normalizeObjectIdValue(value?._id) } : {}),
  componentId: normalizeObjectIdValue(value?.componentId, { allowNull: true }),
  type: normalizeExamType(value?.type),
  time: sanitizeStudyTime(value?.time || {}),
  location: sanitizeStudyLocation(value?.location || {}),
  lectures: (Array.isArray(value?.lectures) ? value.lectures : [value?.lectures])
    .map((entry) => normalizeObjectIdValue(entry))
    .filter(Boolean),
  volume: sanitizeStudyVolume(value?.volume || {}),
  weight: sanitizeStudyWeight(value?.weight || {}),
  passGrade: sanitizeStudyGrade(value?.passGrade || {}),
  grade: sanitizeStudyGrade(value?.grade || {}),
});

const normalizeScheduleInput = (entries = []) =>
  (Array.isArray(entries) ? entries : [entries])
    .map((entry) => {
      if (entry && typeof entry === "object") {
        const day = trimString(entry?.day);
        const time = trimString(entry?.time);
        return day || time ? { day, time } : null;
      }

      const normalizedEntry = trimString(entry);
      if (!normalizedEntry) {
        return null;
      }

      const [day = "", ...timeParts] = normalizedEntry.split(/\s+/);
      return {
        day: trimString(day),
        time: timeParts.join(" ").trim(),
      };
    })
    .filter(Boolean);

const buildExamTime = (dateValue = "", timeValue = "", previousTime = {}) => {
  const normalizedDate = trimString(dateValue);
  const normalizedTime = trimString(timeValue);
  const dateTimeCandidate =
    normalizedDate && normalizedTime
      ? `${normalizedDate}T${normalizedTime}`
      : normalizedDate
        ? normalizedDate
        : "";
  const parsedDate = dateTimeCandidate ? new Date(dateTimeCandidate) : null;

  return {
    startsAt:
      parsedDate && !Number.isNaN(parsedDate.getTime())
        ? parsedDate
        : previousTime?.startsAt || null,
    endsAt: previousTime?.endsAt || null,
  };
};

const mapExamTimeForPlanner = (exam = {}) => {
  const startsAt = exam?.time?.startsAt ? new Date(exam.time.startsAt) : null;
  if (startsAt && !Number.isNaN(startsAt.getTime())) {
    return {
      exam_date: startsAt.toISOString().slice(0, 10),
      exam_time: startsAt.toISOString().slice(11, 16),
    };
  }

  return {
    exam_date: "-",
    exam_time: "-",
  };
};

const ensureStudyOrganizer = (memoryDoc) => {
  const studyPlanner = getStudyPlannerRoot(memoryDoc);
  const currentOrganizer =
    studyPlanner?.studyOrganizer && typeof studyPlanner.studyOrganizer === "object"
      ? toPlainObject(studyPlanner.studyOrganizer)
      : {};

  studyPlanner.studyOrganizer = {
    courses: Array.isArray(currentOrganizer?.courses)
      ? currentOrganizer.courses.map((entry) =>
          sanitizeStudyCourse(toPlainObject(entry) || {}),
        )
      : [],
    exams: Array.isArray(currentOrganizer?.exams)
      ? currentOrganizer.exams.map((entry) => sanitizeStudyExam(toPlainObject(entry) || {}))
      : [],
  };

  return studyPlanner.studyOrganizer;
};

const normalizeStudyPlanAidNumber = (value, fallbackValue = 0) => {
  const parsedValue = Number(value);
  return Number.isFinite(parsedValue) && parsedValue >= 0
    ? parsedValue
    : fallbackValue;
};

const normalizeStudyPlanAidIdString = (value) =>
  normalizeIdString(value) || trimString(value);

const normalizeStudyPlanAidLectureOverride = (entry = {}) => {
  const normalizedEntry = toPlainObject(entry) || {};
  const lectureId = normalizeStudyPlanAidIdString(normalizedEntry?.lectureId);
  if (!lectureId) {
    return null;
  }

  return {
    ...(normalizedEntry?._id ? { _id: normalizedEntry._id } : {}),
    lectureId,
    targetHours: normalizeStudyPlanAidNumber(normalizedEntry?.targetHours, 0),
    difficulty: trimString(normalizedEntry?.difficulty),
    mastery: trimString(normalizedEntry?.mastery),
    priority: trimString(normalizedEntry?.priority),
    dailyHoursCap: normalizeStudyPlanAidNumber(
      normalizedEntry?.dailyHoursCap,
      0,
    ),
    note: trimString(normalizedEntry?.note),
  };
};

const normalizeStudyPlanAidComponentPlan = (entry = {}) => {
  const normalizedEntry = toPlainObject(entry) || {};
  const componentId = normalizeStudyPlanAidIdString(normalizedEntry?.componentId);
  if (!componentId) {
    return null;
  }

  return {
    ...(normalizedEntry?._id ? { _id: normalizedEntry._id } : {}),
    componentId,
    targetHours: normalizeStudyPlanAidNumber(normalizedEntry?.targetHours, 0),
    difficulty: trimString(normalizedEntry?.difficulty),
    mastery: trimString(normalizedEntry?.mastery),
    priority: trimString(normalizedEntry?.priority),
    dailyHoursCap: normalizeStudyPlanAidNumber(
      normalizedEntry?.dailyHoursCap,
      0,
    ),
    note: trimString(normalizedEntry?.note),
    lectureOverrides: (Array.isArray(normalizedEntry?.lectureOverrides)
      ? normalizedEntry.lectureOverrides
      : []
    )
      .map((lectureOverrideEntry) =>
        normalizeStudyPlanAidLectureOverride(lectureOverrideEntry),
      )
      .filter(Boolean),
  };
};

const normalizeStudyPlanAidCoursePlan = (entry = {}) => {
  const normalizedEntry = toPlainObject(entry) || {};
  const courseId = normalizeStudyPlanAidIdString(normalizedEntry?.courseId);
  if (!courseId) {
    return null;
  }

  return {
    ...(normalizedEntry?._id ? { _id: normalizedEntry._id } : {}),
    courseId,
    note: trimString(normalizedEntry?.note),
    componentPlans: (Array.isArray(normalizedEntry?.componentPlans)
      ? normalizedEntry.componentPlans
      : []
    )
      .map((componentPlanEntry) =>
        normalizeStudyPlanAidComponentPlan(componentPlanEntry),
      )
      .filter(Boolean),
  };
};

const normalizeStudyPlanAidDayPlan = (entry = {}) => {
  const normalizedEntry = toPlainObject(entry) || {};
  const periodType = trimString(normalizedEntry?.periodType);
  const groupKey = trimString(normalizedEntry?.groupKey);
  const dayNumber = normalizeStudyPlanAidNumber(normalizedEntry?.dayNumber, 0);
  if (!periodType || !groupKey || dayNumber <= 0) {
    return null;
  }

  return {
    ...(normalizedEntry?._id ? { _id: normalizedEntry._id } : {}),
    periodType,
    groupKey,
    label: trimString(normalizedEntry?.label),
    dayNumber,
    dailyHoursCap: normalizeStudyPlanAidNumber(
      normalizedEntry?.dailyHoursCap,
      0,
    ),
    lectureIds: (Array.isArray(normalizedEntry?.lectureIds)
      ? normalizedEntry.lectureIds
      : []
    )
      .map((lectureId) =>
        normalizeObjectIdValue(lectureId, { allowNull: false }),
      )
      .filter(Boolean),
  };
};

const normalizeStudyPlanAidDefaults = (value = {}) => {
  const normalizedValue = toPlainObject(value) || {};
  return {
    defaultDailyHours: normalizeStudyPlanAidNumber(
      normalizedValue?.defaultDailyHours,
      DEFAULT_STUDY_PLAN_AID.defaults.defaultDailyHours,
    ),
    defaultDifficulty:
      trimString(normalizedValue?.defaultDifficulty) ||
      DEFAULT_STUDY_PLAN_AID.defaults.defaultDifficulty,
    defaultMastery:
      trimString(normalizedValue?.defaultMastery) ||
      DEFAULT_STUDY_PLAN_AID.defaults.defaultMastery,
    defaultPriority:
      trimString(normalizedValue?.defaultPriority) ||
      DEFAULT_STUDY_PLAN_AID.defaults.defaultPriority,
  };
};

const buildNormalizedStudyPlanAid = (value = {}) => {
  const normalizedValue = toPlainObject(value) || {};
  const normalizedIntervals = (Array.isArray(normalizedValue?.intervals)
    ? normalizedValue.intervals
  : []
  )
    .map((entry) => {
      const source = toPlainObject(entry) || {};
      const intervalIdFromPayload = trimString(source?.intervalId);
      if (intervalIdFromPayload) {
        return {
          intervalId: intervalIdFromPayload,
          intervalCourses: Array.isArray(source?.intervalCourses)
            ? source.intervalCourses
            : [],
        };
      }
      const year = trimString(source?.year);
      const term = trimString(source?.term);
      if (year && term) {
        return {
          intervalId: `${year}${term}`,
          intervalCourses: [],
        };
      }
      const componentClass = trimString(
        source?.componentClass || source?.component_class,
      );
      const startDate = trimString(source?.startDate);
      const endDate = trimString(source?.endDate);
      if (!componentClass || !startDate || !endDate) {
        return null;
      }
      const inferredIntervalId = buildPlannerIntervalId({
        componentClass,
        startDate,
        endDate,
      });
      return {
        intervalId: inferredIntervalId,
        intervalCourses: [],
      };
    })
    .filter(Boolean);
  return {
    intervals: normalizedIntervals,
  };
};

const removeLectureOverrideFromStudyPlanAid = (studyPlanAid, lectureId = "") => {
  const normalizedLectureId = normalizeIdString(lectureId);
  if (!normalizedLectureId) {
    return;
  }

  studyPlanAid.coursePlans = (Array.isArray(studyPlanAid?.coursePlans)
    ? studyPlanAid.coursePlans
    : []
  )
    .map((coursePlan) => ({
      ...(toPlainObject(coursePlan) || {}),
      componentPlans: (Array.isArray(coursePlan?.componentPlans)
        ? coursePlan.componentPlans
        : []
      )
        .map((componentPlan) => ({
          ...(toPlainObject(componentPlan) || {}),
          lectureOverrides: (Array.isArray(componentPlan?.lectureOverrides)
            ? componentPlan.lectureOverrides
            : []
          ).filter(
            (lectureOverride) =>
              normalizeIdString(lectureOverride?.lectureId) !== normalizedLectureId,
          ),
        }))
        .filter((componentPlan) => Boolean(componentPlan?.componentId)),
    }))
    .filter((coursePlan) => Boolean(coursePlan?.courseId));
  studyPlanAid.dayPlans = (Array.isArray(studyPlanAid?.dayPlans)
    ? studyPlanAid.dayPlans
    : []
  )
    .map((dayPlan) => ({
      ...(toPlainObject(dayPlan) || {}),
      lectureIds: (Array.isArray(dayPlan?.lectureIds) ? dayPlan.lectureIds : []).filter(
        (dayPlanLectureId) =>
          normalizeIdString(dayPlanLectureId) !== normalizedLectureId,
      ),
    }))
    .filter((dayPlan) => Array.isArray(dayPlan?.lectureIds) && dayPlan.lectureIds.length > 0);
};

const removeCourseOrComponentFromStudyPlanAid = (studyPlanAid, targetId = "") => {
  const normalizedTargetId = normalizeIdString(targetId);
  if (!normalizedTargetId) {
    return;
  }

  studyPlanAid.coursePlans = (Array.isArray(studyPlanAid?.coursePlans)
    ? studyPlanAid.coursePlans
    : []
  )
    .filter(
      (coursePlan) => normalizeIdString(coursePlan?.courseId) !== normalizedTargetId,
    )
    .map((coursePlan) => ({
      ...(toPlainObject(coursePlan) || {}),
      componentPlans: (Array.isArray(coursePlan?.componentPlans)
        ? coursePlan.componentPlans
        : []
      ).filter(
        (componentPlan) =>
          normalizeIdString(componentPlan?.componentId) !== normalizedTargetId,
      ),
    }))
    .filter((coursePlan) => Boolean(coursePlan?.courseId));
};

const ensureStudyPlanAid = (memoryDoc) => {
  const currentAid =
    memoryDoc?.studyPlanAid && typeof memoryDoc.studyPlanAid === "object"
      ? toPlainObject(memoryDoc.studyPlanAid)
      : {};
  memoryDoc.studyPlanAid = buildNormalizedStudyPlanAid(currentAid);
  return memoryDoc.studyPlanAid;
};

export const getStudyPlanAid = (memoryDoc) => ensureStudyPlanAid(memoryDoc);

const inferIntervalTerm = (entry = {}) => {
  const explicitTerm = trimString(entry?.term);
  if (explicitTerm) {
    return explicitTerm;
  }
  const startDate = trimString(entry?.startDate);
  const monthMatch = startDate.match(/^\d{4}-(\d{2})-\d{2}$/);
  const month = Number(monthMatch?.[1] || 0);
  if (month >= 9 && month <= 12) {
    return "1";
  }
  if (month >= 1 && month <= 5) {
    return "2";
  }
  if (month >= 6 && month <= 8) {
    return "3";
  }
  return "";
};

const inferIntervalYear = (entry = {}) => {
  const explicitYear = trimString(entry?.year);
  if (explicitYear) {
    return explicitYear;
  }
  const startDate = trimString(entry?.startDate);
  const yearMatch = startDate.match(/^(\d{4})-\d{2}-\d{2}$/);
  return trimString(yearMatch?.[1] || "");
};

// ID HIERARCHY
//   intervalID    = programID + ": " + INT{n}
//   subIntervalID = intervalID + sINT{n}
//   courseID      = subIntervalID + CRS{n}
//   componentID   = courseID + COMP{n}
//   lectureID     = componentID + L{n}
//   byteArrayID   = lectureID + B{n}
//   taskID        = componentID + E{n}
const buildNewSubIntervalID = (intervalID, subIntervalNum, symbol = "sINT") =>
  intervalID && subIntervalNum != null ? sanitizeId(`${intervalID}${symbol}${subIntervalNum}`) : "";
const buildNewCourseID = (subIntervalID, courseNum, courseSymbol = "CRS") =>
  subIntervalID && courseNum != null ? sanitizeId(`${subIntervalID}${courseSymbol}${courseNum}`) : "";
const buildNewComponentID = (courseID, componentNum, componentSymbol = "COMP") =>
  courseID && componentNum != null ? sanitizeId(`${courseID}${componentSymbol}${componentNum}`) : "";
const buildNewLectureID = (componentID, lectureNum) =>
  componentID && lectureNum != null ? sanitizeId(`${componentID}LEC${lectureNum}`) : "";
const buildNewByteArrayID = (lectureID, byteArrayNum) =>
  lectureID && byteArrayNum != null ? sanitizeId(`${lectureID}B${byteArrayNum}`) : "";
const buildNewTaskID = (componentID, taskNum) =>
  componentID && taskNum != null ? sanitizeId(`${componentID}E${taskNum}`) : "";

const toOneBasedInteger = (value, fallback = null) => {
  const parsed = Number.parseInt(String(value ?? "").trim(), 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
};

const parseStructuredIntervalID = (id = "") => {
  const normalizedId = trimString(id);
  if (!normalizedId) {
    return { symbol: "", num: null };
  }
  const m = normalizedId.match(/([A-Za-z]+)(\d+)$/);
  return m ? { symbol: m[1], num: Number(m[2]) } : { symbol: "", num: null };
};

const parseStructuredSubIntervalID = (id = "") => {
  const s = trimString(id);
  const empty = { intervalNum: null, intervalSymbol: "", subIntervalNum: null, subIntervalSymbol: "" };
  const m = s.match(/([A-Za-z]+)(\d+)([A-Za-z]+)(\d+)$/);
  if (!m) return empty;
  return {
    intervalNum: Number(m[2]),
    intervalSymbol: m[1],
    subIntervalNum: Number(m[4]),
    subIntervalSymbol: m[3],
  };
};

const buildPlannerSubIntervalId = (entry = {}) => {
  const explicitSubIntervalId = trimString(
    entry?.subIntervalID || entry?.subIntervalId,
  );
  if (explicitSubIntervalId) return explicitSubIntervalId;
  const intervalID = trimString(entry?.intervalID || entry?.intervalId || entry?.intervalNum);
  const subIntervalNum = trimString(entry?.subIntervalNum || entry?.subintervalNum || entry?.term);
  if (intervalID && subIntervalNum) {
    return buildNewSubIntervalID(intervalID, subIntervalNum);
  }
  return "";
};

const parsePlannerSubIntervalYearTerm = (subIntervalId = "") => {
  const s = trimString(subIntervalId);
  if (!s) return { year: "", term: "" };
  const parsed = parseStructuredSubIntervalID(s);
  if (parsed.intervalNum != null && parsed.subIntervalNum != null) {
    return { year: String(parsed.intervalNum), term: String(parsed.subIntervalNum) };
  }
  return { year: "", term: "" };
};

const normalizePlannerIntervalStatusValue = (value = "Normal") => {
  if (Array.isArray(value)) {
    const firstValue = trimString(value[0]);
    return firstValue || "Normal";
  }
  return trimString(value) || "Normal";
};

const syncPlannerComponentIntervalsFromStudyPlanAid = (memoryDoc, intervals = []) => {
  const studyPlanner = getStudyPlannerRoot(memoryDoc);
  const programID = trimString(studyPlanner?.programID);
  const intervalSymbol = "INT";
  const intervalIds = Array.from(
    new Set(
      (Array.isArray(intervals) ? intervals : [])
        .map((entry) => buildPlannerSubIntervalId(entry))
        .filter(Boolean),
    ),
  );
  studyPlanner.programIntervals = intervalIds.map((subIntervalId, index) => {
    const intervalNum = index + 1;
    const intervalID = buildIntervalID(programID, intervalSymbol, intervalNum);
    return {
      intervalInfo: {
        intervalID,
        intervalNum,
        intervalSymbol,
        intervalStatus: ["Normal"],
      },
      intervalSubIntervals: [{
        subIntervalInfo: {
          subIntervalID: subIntervalId || buildNewSubIntervalID(intervalID, 1),
          subIntervalNum: 1,
          subIntervalSymbol: "sINT",
          subIntervalCurrent: false,
        },
        subIntervalCourses: [],
      }],
    };
  });
};

const stripDocId = ({ _id, ...rest } = {}) => rest;

const getIntervalInfoSource = (entry = {}) => {
  const base = entry && typeof entry === "object" ? toPlainObject(entry) || {} : {};
  return base?.intervalInfo && typeof base.intervalInfo === "object"
    ? stripDocId(toPlainObject(base.intervalInfo) || {})
    : stripDocId(base);
};

const getSubIntervalInfoSource = (entry = {}) => {
  const base = entry && typeof entry === "object" ? toPlainObject(entry) || {} : {};
  return base?.subIntervalInfo && typeof base.subIntervalInfo === "object"
    ? stripDocId(toPlainObject(base.subIntervalInfo) || {})
    : stripDocId(base);
};

const getCourseInfoSource = (entry = {}) => {
  const base = entry && typeof entry === "object" ? toPlainObject(entry) || {} : {};
  return base?.courseInfo && typeof base.courseInfo === "object"
    ? toPlainObject(base.courseInfo) || {}
    : base;
};

const getComponentInfoSource = (entry = {}) => {
  const base = entry && typeof entry === "object" ? toPlainObject(entry) || {} : {};
  return base?.componentInfo && typeof base.componentInfo === "object"
    ? toPlainObject(base.componentInfo) || {}
    : base;
};

const getTaskInfoSource = (entry = {}) => {
  const base = entry && typeof entry === "object" ? toPlainObject(entry) || {} : {};
  return base?.taskInfo && typeof base.taskInfo === "object"
    ? toPlainObject(base.taskInfo) || {}
    : base;
};

const getLectureInfoSource = (entry = {}) => {
  const base = entry && typeof entry === "object" ? toPlainObject(entry) || {} : {};
  return base?.lectureInfo && typeof base.lectureInfo === "object"
    ? toPlainObject(base.lectureInfo) || {}
    : base;
};

const getDocumentInfoSource = (entry = {}) => {
  const base = entry && typeof entry === "object" ? toPlainObject(entry) || {} : {};
  return base?.documentInfo && typeof base.documentInfo === "object"
    ? toPlainObject(base.documentInfo) || {}
    : base;
};

const normalizePlannerLectureId = (value) => sanitizeId(trimString(value)) || "";

const isLegacyDocumentLectureMatch = (documentId = "", lectureId = "") =>
  Boolean(
    documentId &&
      lectureId &&
      documentId.startsWith(lectureId) &&
      !/^\d/.test(documentId.slice(lectureId.length)),
  );

const getPlannerDocumentId = (entry = {}) =>
  normalizePlannerLectureId(
    getDocumentInfoSource(entry)?.documentID ||
      entry?.documentID ||
      entry?.documentId ||
      "",
  );

const syncPlannerDocumentLectureLinks = (studyPlanner = {}) => {
  if (!studyPlanner || typeof studyPlanner !== "object") {
    return studyPlanner;
  }

  const rawLectures = Array.isArray(studyPlanner.programLectures)
    ? studyPlanner.programLectures.filter((entry) => entry && typeof entry === "object")
    : [];
  const lectureLookup = new Map();
  rawLectures.forEach((lectureEntry) => {
    const lectureInfo = getLectureInfoSource(lectureEntry);
    const lectureId = normalizePlannerLectureId(lectureInfo?.lectureID);
    if (!lectureId) {
      return;
    }
    lectureLookup.set(lectureId, {
      lectureId,
      lectureName: trimString(lectureInfo?.lectureName),
    });
  });

  const rawDocuments = Array.isArray(studyPlanner.programDocuments)
    ? studyPlanner.programDocuments.filter((entry) => entry && typeof entry === "object")
    : [];
  const legacyDocumentLectureLookup = new Map();
  rawLectures.forEach((lectureEntry) => {
    const lectureInfo = getLectureInfoSource(lectureEntry);
    const lectureId = normalizePlannerLectureId(lectureInfo?.lectureID);
    if (!lectureId) {
      return;
    }
    const lectureDocuments = Array.isArray(lectureEntry?.lectureDocuments)
      ? lectureEntry.lectureDocuments
      : [];
    lectureDocuments.forEach((documentEntry) => {
      const documentId = getPlannerDocumentId(
        documentEntry && typeof documentEntry === "object"
          ? documentEntry
          : { documentID: documentEntry },
      );
      if (documentId && !legacyDocumentLectureLookup.has(documentId)) {
        legacyDocumentLectureLookup.set(documentId, lectureId);
      }
    });
  });

  const normalizedDocuments = rawDocuments.map((entry) => {
    const info = getDocumentInfoSource(entry);
    const documentId = normalizePlannerLectureId(info?.documentID);
    const explicitLectureId = normalizePlannerLectureId(info?.documentLectureID);
    let resolvedLectureId = "";

    if (explicitLectureId && lectureLookup.has(explicitLectureId)) {
      resolvedLectureId = explicitLectureId;
    } else if (documentId && legacyDocumentLectureLookup.has(documentId)) {
      resolvedLectureId = legacyDocumentLectureLookup.get(documentId) || "";
    } else if (documentId) {
      for (const lectureId of lectureLookup.keys()) {
        if (isLegacyDocumentLectureMatch(documentId, lectureId)) {
          resolvedLectureId = lectureId;
          break;
        }
      }
    }

    const resolvedLecture = resolvedLectureId
      ? lectureLookup.get(resolvedLectureId) || null
      : null;

    const normalizedDocumentVolume = resolveStoredDocumentVolumeNumber(
      info?.documentVolume,
    );
    const normalizedDocumentPages = buildStoredDocumentPages(
      info?.documentVolume,
      info?.documentPages,
    );

    return {
      documentInfo: {
        documentSymbol: trimString(info?.documentSymbol) || "DOC",
        documentNum: Number.isFinite(Number.parseInt(info?.documentNum, 10))
          ? Number.parseInt(info.documentNum, 10)
          : null,
        documentID: documentId,
        documentLectureID: resolvedLectureId,
        documentLectureName: resolvedLecture?.lectureName || "",
        documentName: trimString(info?.documentName) || "",
        documentType: trimString(info?.documentType),
        documentVolumeUnit: trimString(info?.documentVolumeUnit),
        documentVolume: normalizedDocumentVolume,
        documentPages: normalizedDocumentPages,
        documentEditors: Array.isArray(info?.documentEditors)
          ? info.documentEditors.map((value) => trimString(value)).filter(Boolean)
          : [],
        documentConcepts: Array.isArray(info?.documentConcepts)
          ? info.documentConcepts.map((value) => trimString(value)).filter(Boolean)
          : [],
        documentByteSize: Number.isFinite(Number(info?.documentByteSize))
          ? Number(info.documentByteSize)
          : 0,
      },
      documentURL: trimString(entry?.documentURL),
    };
  });

  const documentsByLectureId = new Map();
  normalizedDocuments.forEach((documentEntry) => {
    const documentInfo = getDocumentInfoSource(documentEntry);
    const lectureId = normalizePlannerLectureId(documentInfo?.documentLectureID);
    const documentId = normalizePlannerLectureId(documentInfo?.documentID);
    if (!lectureId || !documentId) {
      return;
    }
    if (!documentsByLectureId.has(lectureId)) {
      documentsByLectureId.set(lectureId, []);
    }
    documentsByLectureId.get(lectureId).push(documentId);
  });

  studyPlanner.programDocuments = normalizedDocuments;
  studyPlanner.programLectures = rawLectures.map((lectureEntry) => {
    const lectureInfo = getLectureInfoSource(lectureEntry);
    const lectureId = normalizePlannerLectureId(lectureInfo?.lectureID);
    const resolvedLecture = lectureId ? lectureLookup.get(lectureId) || null : null;
    const nextLectureDocuments = lectureId
      ? Array.from(
          new Set(
            documentsByLectureId.get(lectureId) || [],
          ),
        ).filter(Boolean)
      : [];

    return {
      ...lectureEntry,
      lectureInfo: {
        ...lectureInfo,
        lectureID: lectureId,
        lectureName: resolvedLecture?.lectureName || trimString(lectureInfo?.lectureName),
      },
      lectureDocuments: nextLectureDocuments,
    };
  });

  return studyPlanner;
};

const normalizePlannerIntervalCourseEntries = (intervalCourses = []) =>
  (Array.isArray(intervalCourses) ? intervalCourses : [])
    .map((courseEntry) => {
      const rawCourseEntry =
        courseEntry && typeof courseEntry === "object"
          ? toPlainObject(courseEntry) || {}
          : {};
      const source = getCourseInfoSource(rawCourseEntry);
      const normalizedCourseWeight = Array.isArray(source?.courseWeight)
        ? source.courseWeight
            .map((weightEntry) => {
              const normalizedWeightEntry =
                weightEntry && typeof weightEntry === "object"
                  ? toPlainObject(weightEntry) || {}
                  : {};
              const componentId = trimString(normalizedWeightEntry?.componentId);
              if (!componentId) {
                return null;
              }
              return {
                componentId,
                weight: Number.isFinite(
                  Number.parseFloat(normalizedWeightEntry?.weight),
                )
                  ? Number.parseFloat(normalizedWeightEntry.weight)
                  : Number.isFinite(
                        Number.parseFloat(
                          normalizedWeightEntry?.componentWeightPercentage,
                        ),
                      )
                    ? Number.parseFloat(
                        normalizedWeightEntry.componentWeightPercentage,
                      )
                    : null,
              };
            })
            .filter(Boolean)
        : Number.isFinite(Number.parseFloat(source?.courseWeight))
          ? Number.parseFloat(source.courseWeight)
          : null;
    const normalizedCourseID = trimString(source?.courseID || source?.courseId);
    // Parse courseNum from strict dash format "INT1-IT1-sINT1-CRS2" → 2
    const courseIDDashMatch = (normalizedCourseID || "").match(/-[A-Za-z]+(\d+)$/);
    const parsedCourseIDNum = courseIDDashMatch
      ? Number.parseInt(courseIDDashMatch[1], 10)
      : null;
    const parsedCourseWeight = Number.isFinite(
      Number.parseFloat(normalizedCourseWeight),
    )
      ? Number.parseFloat(normalizedCourseWeight)
      : null;
    return {
      courseInfo: {
        courseSymbol: trimString(source?.courseSymbol) || "CRS",
        courseNum: Number.isFinite(Number.parseInt(source?.courseNum, 10))
          ? Number.parseInt(source.courseNum, 10)
          : Number.isInteger(parsedCourseIDNum)
            ? parsedCourseIDNum
            : null,
        courseID: normalizedCourseID,
        courseName:
          trimString(source?.courseName) || trimString(source?.courseId),
        courseCode: trimString(source?.courseCode),
        courseWeight: normalizedCourseWeight,
        courseGrade: Number.isFinite(Number(source?.courseGrade))
          ? Number(source.courseGrade)
          : 100,
        courseStatus: trimString(source?.courseStatus),
      },
      courseComponents: (Array.isArray(rawCourseEntry?.courseComponents)
        ? rawCourseEntry.courseComponents
        : Array.isArray(source?.courseComponents)
          ? source.courseComponents
          : []
      ).map((componentEntry, componentIndex) => {
          const rawComponentEntry =
            componentEntry && typeof componentEntry === "object"
              ? toPlainObject(componentEntry) || {}
              : {};
          const normalizedComponentEntry = getComponentInfoSource(rawComponentEntry);
          const directComponentWeight = Number.isFinite(
            Number.parseFloat(normalizedComponentEntry?.componentWeight),
          )
            ? Number.parseFloat(normalizedComponentEntry.componentWeight)
            : Number.isFinite(
                  Number.parseFloat(
                    normalizedComponentEntry?.componentRelativeWeight,
                  ),
                )
              ? Number.parseFloat(
                  normalizedComponentEntry.componentRelativeWeight,
                )
              : null;
          const percentageSource = Number.isFinite(
            Number.parseFloat(
              normalizedComponentEntry?.componentWeightPercentage,
            ),
          )
            ? Number.parseFloat(
                normalizedComponentEntry.componentWeightPercentage,
              )
            : Number.isFinite(
                  Number.parseFloat(
                    normalizedComponentEntry?.componentPartialWeight,
                  ),
                )
              ? Number.parseFloat(
                  normalizedComponentEntry.componentPartialWeight,
                )
              : null;
          const computedComponentWeight =
            Number.isFinite(directComponentWeight)
              ? directComponentWeight
              : Number.isFinite(parsedCourseWeight) &&
                  Number.isFinite(percentageSource)
                ? parsedCourseWeight * (percentageSource / 100)
                : null;
          const componentName = trimString(
            normalizedComponentEntry?.componentName ||
              normalizedComponentEntry?.componentClass ||
              normalizedComponentEntry?.componentId,
          );
          const componentNum = toOneBasedInteger(
            normalizedComponentEntry?.componentNum,
            componentIndex + 1,
          );
          const componentSymbol = trimString(normalizedComponentEntry?.componentSymbol) || "COMP";
          const componentID =
            buildNewComponentID(normalizedCourseID, componentNum, componentSymbol) ||
            trimString(normalizedComponentEntry?.componentID) ||
            (normalizedCourseID && componentName ? `${normalizedCourseID}${componentName}` : "");
          return {
            componentInfo: {
              componentID,
              componentNum,
              componentSymbol,
              componentName,
              componentWeight: computedComponentWeight,
              componentDates: {
                start: parseDateToComponents(
                  normalizedComponentEntry?.componentDates?.start ||
                    normalizedComponentEntry?.startDate ||
                    normalizedComponentEntry?.componentStartDate ||
                    null,
                ),
                end: parseDateToComponents(
                  normalizedComponentEntry?.componentDates?.end ||
                    normalizedComponentEntry?.endDate ||
                    normalizedComponentEntry?.componentEndDate ||
                    null,
                ),
              },
              componentLocation: sanitizeStudyLocation(
                normalizedComponentEntry?.componentLocation ||
                  normalizedComponentEntry?.location ||
                  {},
              ),
            },
            componentExams: (Array.isArray(rawComponentEntry?.componentExams)
              ? rawComponentEntry.componentExams
              : Array.isArray(normalizedComponentEntry?.componentExams)
                ? normalizedComponentEntry.componentExams
                : []
            ).map((examEntry) => {
              const rawExamEntry = examEntry && typeof examEntry === "object" ? toPlainObject(examEntry) || {} : {};
              const exam = getTaskInfoSource(rawExamEntry);
              const taskNum = Number.isFinite(Number.parseInt(exam?.taskNum, 10))
                ? Number.parseInt(exam.taskNum, 10)
                : null;
              const taskSymbol = trimString(exam?.taskSymbol) || "EXM";
              const taskID = sanitizeId(trimString(exam?.taskID)) ||
                (componentID && taskNum != null ? buildNewTaskID(componentID, taskNum) : "");
              return {
                taskInfo: {
                  taskSymbol,
                  taskNum,
                  taskID,
                  taskLocation: sanitizeStudyLocation(exam?.taskLocation || {}),
                  taskDate: parseOptionalDate(exam?.taskDate || null),
                  taskTime: trimString(exam?.taskTime) || "",
                  taskWeight: Number.isFinite(Number(exam?.taskWeight)) ? Number(exam.taskWeight) : null,
                  taskGrade: Number.isFinite(Number(exam?.taskGrade)) ? Number(exam.taskGrade) : null,
                },
                tasksLectures: (Array.isArray(rawExamEntry?.tasksLectures) ? rawExamEntry.tasksLectures : []).map((lec) => {
                  const rawLectureEntry = lec && typeof lec === "object" ? toPlainObject(lec) || {} : {};
                  const l = getLectureInfoSource(rawLectureEntry);
                  const lectureID = sanitizeId(trimString(l?.lectureID)) || "";
                  const lectureName = trimString(l?.lectureName) || "";
                  return {
                    lectureInfo: {
                      lectureSymbol: trimString(l?.lectureSymbol) || "LEC",
                      lectureNum: Number.isFinite(Number.parseInt(l?.lectureNum, 10)) ? Number.parseInt(l.lectureNum, 10) : null,
                      lectureID,
                      lectureName,
                      lectureInstructors: normalizeStringArray(l?.lectureInstructors),
                      lectureInstructionDate: parseOptionalDate(l?.lectureInstructionDate || null),
                    },
                    lectureDocuments: (Array.isArray(rawLectureEntry?.lectureDocuments) ? rawLectureEntry.lectureDocuments : []).map((documentEntry) => {
                      const rawDocumentEntry = documentEntry && typeof documentEntry === "object" ? toPlainObject(documentEntry) || {} : {};
                      const documentInfo = getDocumentInfoSource(rawDocumentEntry);
                      const normalizedDocumentVolume = resolveStoredDocumentVolumeNumber(
                        documentInfo?.documentVolume,
                      );
                      const normalizedDocumentPages = buildStoredDocumentPages(
                        documentInfo?.documentVolume,
                        documentInfo?.documentPages,
                      );
                      return {
                        documentInfo: {
                          documentSymbol: trimString(documentInfo?.documentSymbol) || "DOC",
                          documentNum: Number.isFinite(Number.parseInt(documentInfo?.documentNum, 10))
                            ? Number.parseInt(documentInfo.documentNum, 10)
                            : null,
                          documentID: sanitizeId(trimString(documentInfo?.documentID)) || "",
                          documentLectureID: trimString(
                            documentInfo?.documentLectureID || lectureID,
                          ),
                          documentLectureName: trimString(
                            documentInfo?.documentLectureName || lectureName,
                          ),
                          documentName: trimString(documentInfo?.documentName) || "",
                          documentVolumeUnit: trimString(documentInfo?.documentVolumeUnit),
                          documentVolume: normalizedDocumentVolume,
                          documentPages: normalizedDocumentPages,
                          documentEditors: normalizeStringArray(documentInfo?.documentEditors),
                          documentConcepts: normalizeStringArray(documentInfo?.documentConcepts),
                          documentType: trimString(documentInfo?.documentType),
                          documentByteSize: Number.isFinite(Number(documentInfo?.documentByteSize))
                            ? Number(documentInfo.documentByteSize)
                            : 0,
                        },
                        documentURL: trimString(rawDocumentEntry?.documentURL),
                      };
                    }),
                  };
                }).filter((l) => Boolean(l?.lectureInfo?.lectureName || l?.lectureInfo?.lectureID)),
              };
            }).filter((exam) => Boolean(exam?.taskInfo?.taskID || exam?.taskInfo?.taskNum != null)),
          };
        }),
    };
    })
    .filter((courseEntry) => Boolean(courseEntry?.courseInfo?.courseName));

// Flatten one programInterval entry into strict sub-interval records.
const flattenProgramIntervalEntry = (entry) => {
  const base = entry && typeof entry === "object" ? toPlainObject(entry) || {} : {};
  const intervalInfo = getIntervalInfoSource(base);
  const rawIntervalRef = sanitizeId(trimString(intervalInfo?.intervalID || intervalInfo?.intervalId || intervalInfo?.intervalNum));
  const resolvedIntervalID = rawIntervalRef;
  const directNum = Number.parseInt(rawIntervalRef, 10);
  const intervalIDNum = Number.isFinite(directNum)
    ? directNum
    : parseStructuredIntervalID(rawIntervalRef).num ?? null;
  const intervalStatus = normalizePlannerIntervalStatusValue(intervalInfo?.intervalStatus);

  const intervalSymbol = trimString(intervalInfo?.intervalSymbol) || "INT";
  const intervalSubIntervals = Array.isArray(base?.intervalSubIntervals)
    ? base.intervalSubIntervals
    : [];
  if (intervalSubIntervals.length > 0) {
    return intervalSubIntervals
      .map((subEntry) => {
        const sub = getSubIntervalInfoSource(subEntry);
        const subIntervalID = sanitizeId(trimString(sub?.subIntervalID || sub?.subIntervalId));
        if (!subIntervalID) return null;
        const subIntervalSymbol = trimString(sub?.subIntervalSymbol) || "sINT";
        const subIntervalNum =
          Number.parseInt(trimString(sub?.subIntervalNum), 10) ||
          parseStructuredSubIntervalID(subIntervalID).subIntervalNum ||
          null;
        const resolvedSubIntervalID =
          subIntervalID ||
          buildNewSubIntervalID(resolvedIntervalID, subIntervalNum, subIntervalSymbol);
        const parsed = parseStructuredSubIntervalID(subIntervalID);
        return {
          intervalIDNum,
          intervalSymbol,
          subIntervalID: resolvedSubIntervalID,
          subIntervalNum: subIntervalNum || parsed.subIntervalNum || null,
          subIntervalSymbol,
          subIntervalCurrent: Boolean(sub?.subIntervalCurrent),
          intervalStatus,
          intervalCourses: (Array.isArray(subEntry?.subIntervalCourses)
            ? subEntry.subIntervalCourses
            : []
          ).map((e) => String(e || "").trim()).filter(Boolean),
        };
      })
      .filter(Boolean);
  }

  // ── Flat UI row entry (current client submit shape) ───────────────────────
  const subIntervalID = trimString(
    base?.subIntervalID || base?.subIntervalId,
  );
  if (!subIntervalID) return [];
  const parsed = parseStructuredSubIntervalID(subIntervalID);
  const subIntervalNum =
    Number.parseInt(trimString(base?.subIntervalNum), 10) ||
    parsed.subIntervalNum ||
    null;
  const subIntervalSymbol =
    trimString(base?.subIntervalSymbol) || parsed.subIntervalSymbol || "sINT";
  const resolvedSubIntervalID =
    (!subIntervalID.includes("_") ? subIntervalID : "") ||
    buildNewSubIntervalID(resolvedIntervalID, subIntervalNum, subIntervalSymbol) ||
    subIntervalID;
  return [{
    intervalIDNum,
    intervalSymbol,
    subIntervalID: resolvedSubIntervalID,
    subIntervalNum,
    subIntervalSymbol,
    subIntervalCurrent: Boolean(base?.subIntervalCurrent),
    intervalStatus,
    intervalCourses: (Array.isArray(base?.intervalCourses || base?.subIntervalCourses)
      ? (base?.intervalCourses || base?.subIntervalCourses)
      : []
    ).map((e) => String(e || "").trim()).filter(Boolean),
  }];
};

const buildIntervalID = (programID, intervalSymbol, intervalIDNum) => {
  const sym = sanitizeId(trimString(intervalSymbol)) || "INT";
  const num = intervalIDNum != null ? String(intervalIDNum) : "";
  const symNum = `${sym}${num}`;
  const pid = sanitizeId(trimString(programID));
  return sanitizeId(pid ? `${pid}: ${symNum}` : symNum);
};

// Reassemble flat sub-interval records → programIntervals[].intervalSubIntervals[]
const assembleProgramIntervals = (flatEntries, programID = "") => {
  const intervalMap = new Map();
  for (const entry of flatEntries) {
    const iKey = String(entry.intervalIDNum ?? "");
    const sKey = entry.subIntervalID || "";
    if (!sKey) continue;
    if (!intervalMap.has(iKey)) {
      intervalMap.set(iKey, {
        intervalIDNum: entry.intervalIDNum,
        intervalSymbol: entry.intervalSymbol || "INT",
        intervalStatus: entry.intervalStatus,
        subIntervals: new Map(),
      });
    }
    const iEntry = intervalMap.get(iKey);
    if (entry.intervalStatus && entry.intervalStatus !== "Normal") iEntry.intervalStatus = entry.intervalStatus;
    iEntry.subIntervals.set(sKey, {
      subIntervalInfo: {
        subIntervalID: sKey,
        subIntervalNum: entry.subIntervalNum != null ? Number(entry.subIntervalNum) : null,
        subIntervalSymbol: entry.subIntervalSymbol || "sINT",
        subIntervalCurrent: Boolean(entry.subIntervalCurrent),
      },
      subIntervalCourses: (Array.isArray(entry.intervalCourses) ? entry.intervalCourses : [])
        .map((e) => String(e || "").trim()).filter(Boolean),
    });
  }
  return Array.from(intervalMap.values()).map((iEntry) => ({
    intervalInfo: {
      intervalID: buildIntervalID(programID, iEntry.intervalSymbol, iEntry.intervalIDNum),
      intervalNum: iEntry.intervalIDNum,
      intervalSymbol: iEntry.intervalSymbol,
      intervalStatus: [normalizePlannerIntervalStatusValue(iEntry.intervalStatus)],
    },
    intervalSubIntervals: Array.from(iEntry.subIntervals.values()),
  }));
};

const normalizePlannerIntervalEntries = (intervals = [], programID = "") => {
  const sourceIntervals = Array.isArray(intervals) ? intervals : [];
  sourceIntervals.forEach((entry) => {
    const base = entry && typeof entry === "object" ? toPlainObject(entry) || {} : {};
    if (Array.isArray(base?.intervalsubIntervals)) {
      throw new Error("Legacy intervalsubIntervals is not supported.");
    }
  });
  const flat = (Array.isArray(intervals) ? intervals : []).flatMap(flattenProgramIntervalEntry);
  return assembleProgramIntervals(flat, programID);
};

export const updateStudyPlanAidInPlanner = (memoryDoc, payload = {}) => {
  const studyPlanAid = ensureStudyPlanAid(memoryDoc);
  const normalizedPayload =
    payload && typeof payload === "object" ? toPlainObject(payload) || {} : {};
  const nextIntervals = Array.isArray(normalizedPayload?.intervals)
    ? normalizedPayload.intervals
    : studyPlanAid?.intervals;
  studyPlanAid.intervals = nextIntervals;
  syncPlannerComponentIntervalsFromStudyPlanAid(memoryDoc, nextIntervals);

  return buildNormalizedStudyPlanAid(studyPlanAid);
};

export const updateStudyPlannerIntervalsInPlanner = (memoryDoc, payload = {}) => {
  const studyPlanner = getStudyPlannerRoot(memoryDoc);
  const normalizedPayload =
    payload && typeof payload === "object" ? toPlainObject(payload) || {} : {};
  const programID = trimString(studyPlanner?.programID);
  studyPlanner.programIntervals = normalizePlannerIntervalEntries(
    normalizedPayload?.intervals,
    programID,
  );
  if (typeof memoryDoc?.markModified === "function") {
    memoryDoc.markModified("studyPlanner");
    memoryDoc.markModified("studyPlanner.programIntervals");
  }
  return studyPlanner;
};

const sanitizeProgramCoursesForSchemaStorage = (rawCourses = []) =>
  (Array.isArray(rawCourses) ? rawCourses : []).map((courseEntry) => {
    if (!courseEntry || typeof courseEntry !== "object") return courseEntry;
    const plainCourse = toPlainObject(courseEntry) || {};
    const plainCourseInfo =
      plainCourse.courseInfo && typeof plainCourse.courseInfo === "object"
        ? toPlainObject(plainCourse.courseInfo) || {}
        : {};
    const courseIDForComponents = sanitizeId(trimString(plainCourseInfo.courseID));
    const plainCourseComponents = Array.isArray(plainCourse.courseComponents)
      ? plainCourse.courseComponents.map((compEntry, componentIndex) => {
          if (!compEntry || typeof compEntry !== "object") return compEntry;
          const plainComponent = toPlainObject(compEntry) || {};
          const plainComponentInfo =
            plainComponent.componentInfo &&
            typeof plainComponent.componentInfo === "object"
              ? toPlainObject(plainComponent.componentInfo) || {}
              : {};
          const componentInstructors = Array.isArray(plainComponentInfo.componentInstructors)
            ? plainComponentInfo.componentInstructors
            : Array.isArray(plainComponent.componentInstructors)
              ? plainComponent.componentInstructors
              : [];
          const componentSymbol = trimString(plainComponentInfo.componentSymbol) || "COMP";
          const componentNum = toOneBasedInteger(
            plainComponentInfo.componentNum,
            componentIndex + 1,
          );
          const componentID =
            buildNewComponentID(courseIDForComponents, componentNum, componentSymbol) ||
            sanitizeId(trimString(plainComponentInfo.componentID));
          const cleanComponentInfo = {
            componentSymbol,
            componentName: trimString(plainComponentInfo.componentName),
            componentNum,
            componentID,
            componentWeight: Number.isFinite(Number(plainComponentInfo.componentWeight))
              ? Number(plainComponentInfo.componentWeight)
              : null,
            componentStatus: trimString(plainComponentInfo.componentStatus),
            componentDates: {
              start: parseDateToComponents(
                plainComponentInfo?.componentDates?.start || null,
              ),
              end: parseDateToComponents(
                plainComponentInfo?.componentDates?.end || null,
              ),
            },
            componentLocation: sanitizeStudyLocation(
              plainComponentInfo?.componentLocation || {},
            ),
            componentInstructors: componentInstructors
              .map((entry) => {
                const source = toPlainObject(entry) || {};
                const firstName = trimString(source?.firstName);
                const lastName = trimString(source?.lastName);
                return firstName || lastName ? { firstName, lastName } : null;
              })
              .filter(Boolean),
          };
          return {
            ...plainComponent,
            componentInfo: cleanComponentInfo,
            componentLectures: Array.isArray(plainComponent.componentLectures)
              ? plainComponent.componentLectures
              : [],
          };
        })
      : [];
    return {
      ...plainCourse,
      courseInfo: plainCourseInfo,
      courseComponents: plainCourseComponents,
    };
  });

export const repairStudyPlannerCourseIdsInPlanner = (memoryDoc) => {
  const studyPlanner = getStudyPlannerRoot(memoryDoc);
  const currentCourses = Array.isArray(studyPlanner.programCourses)
    ? studyPlanner.programCourses
    : [];
  const repairedCourses = sanitizeProgramCoursesForSchemaStorage(currentCourses);
  const changed =
    JSON.stringify(currentCourses) !== JSON.stringify(repairedCourses);

  if (changed) {
    studyPlanner.programCourses = repairedCourses;
    if (typeof memoryDoc?.markModified === "function") {
      memoryDoc.markModified("studyPlanner");
      memoryDoc.markModified("studyPlanner.programCourses");
    }
  }

  return { studyPlanner, changed };
};

export const updateStudyPlannerCoursesInPlanner = (memoryDoc, payload = {}) => {
  const studyPlanner = getStudyPlannerRoot(memoryDoc);
  const normalizedPayload =
    payload && typeof payload === "object" ? toPlainObject(payload) || {} : {};
  const rawCourses = Array.isArray(normalizedPayload?.programCourses)
    ? normalizedPayload.programCourses
    : studyPlanner.programCourses || [];
  studyPlanner.programCourses = sanitizeProgramCoursesForSchemaStorage(rawCourses);

  // Rebuild subIntervalCourses for each subInterval from the current programCourses.
  // courseID is structured as subIntervalID + courseSymbol + courseNum, so a course
  // belongs to a subInterval when its ID starts with that subIntervalID followed by a letter.
  const allCourseIDs = (Array.isArray(studyPlanner.programCourses) ? studyPlanner.programCourses : [])
    .map((entry) => {
      const ci = entry?.courseInfo && typeof entry.courseInfo === "object" ? entry.courseInfo : entry;
      return sanitizeId(trimString(ci?.courseID));
    })
    .filter(Boolean);

  studyPlanner.programIntervals = (Array.isArray(studyPlanner.programIntervals) ? studyPlanner.programIntervals : [])
    .map((intervalEntry) => {
      const base = intervalEntry && typeof intervalEntry === "object" ? toPlainObject(intervalEntry) || {} : {};
      const intervalInfo = getIntervalInfoSource(base);
      const nextSubIntervals = (Array.isArray(base.intervalSubIntervals) ? base.intervalSubIntervals : [])
        .map((subEntry) => {
          const subBase = subEntry && typeof subEntry === "object" ? toPlainObject(subEntry) || {} : {};
          const subInfo = getSubIntervalInfoSource(subBase);
          const subIntervalID = sanitizeId(trimString(subInfo?.subIntervalID || subInfo?.subIntervalId));
          const matchingCourseIDs = subIntervalID
            ? allCourseIDs.filter(
                (courseID) =>
                  courseID.startsWith(subIntervalID) &&
                  courseID.length > subIntervalID.length &&
                  /^[A-Za-z]/.test(courseID.slice(subIntervalID.length)),
              )
            : (Array.isArray(subBase.subIntervalCourses) ? subBase.subIntervalCourses : [])
                .map((e) => String(e || "").trim())
                .filter(Boolean);
          return {
            ...subBase,
            subIntervalInfo: subInfo,
            subIntervalCourses: matchingCourseIDs,
          };
        });
      return {
        ...base,
        intervalInfo,
        intervalSubIntervals: nextSubIntervals,
      };
    });

  if (typeof memoryDoc?.markModified === "function") {
    memoryDoc.markModified("studyPlanner");
    memoryDoc.markModified("studyPlanner.programCourses");
    memoryDoc.markModified("studyPlanner.programIntervals");
  }
  return studyPlanner;
};

export const updateStudyPlannerIntervalStatusInPlanner = (
  memoryDoc,
  payload = {},
) => {
  const studyPlanner = getStudyPlannerRoot(memoryDoc);
  const normalizedPayload =
    payload && typeof payload === "object" ? toPlainObject(payload) || {} : {};
  const targetSubIntervalId = trimString(
    normalizedPayload?.subIntervalID ||
      normalizedPayload?.subIntervalId ||
      normalizedPayload?.subintervalId,
  );
  const rawStatus = normalizePlannerIntervalStatusValue(normalizedPayload?.intervalStatus);
  const isRetakeAction = rawStatus.toLowerCase() === "retake";
  const isCancelRetaking = rawStatus.toLowerCase() === "cancelretaking";
  const requestedStatus = isRetakeAction
    ? "FailedRetaking"
    : isCancelRetaking
      ? "Failed"
      : rawStatus;
  const requestedStatusLower = requestedStatus.toLowerCase();

  if (!targetSubIntervalId) {
    throw new Error("SubInterval ID is required.");
  }

  const currentProgramIntervals = Array.isArray(studyPlanner?.programIntervals)
    ? studyPlanner.programIntervals
    : [];

  const nextProgramIntervals = currentProgramIntervals.map((intervalEntry) => {
    const intervalBase = intervalEntry && typeof intervalEntry === "object"
      ? toPlainObject(intervalEntry) || {}
      : {};
    const intervalInfo = getIntervalInfoSource(intervalBase);
    const currentStatus = normalizePlannerIntervalStatusValue(intervalInfo?.intervalStatus);
    const nextSubIntervals = (Array.isArray(intervalBase?.intervalSubIntervals)
      ? intervalBase.intervalSubIntervals
      : []
    ).map((subEntry) => {
      const subBase = subEntry && typeof subEntry === "object"
        ? toPlainObject(subEntry) || {}
        : {};
      const subInfo = getSubIntervalInfoSource(subBase);
      const subId = sanitizeId(trimString(subInfo?.subIntervalID || subInfo?.subIntervalId));
      const isTarget = subId === targetSubIntervalId;
      return {
        ...subBase,
        subIntervalInfo: {
          ...subInfo,
          subIntervalCurrent:
            requestedStatusLower === "current"
              ? isTarget
              : requestedStatusLower === "normal" && isTarget
                ? false
                : Boolean(subInfo?.subIntervalCurrent),
        },
        subIntervalCourses: (Array.isArray(subBase?.subIntervalCourses) ? subBase.subIntervalCourses : [])
          .map((e) => String(e || "").trim()).filter(Boolean),
      };
    });

    const isTargetInterval = nextSubIntervals.some(
      (subEntry) =>
        trimString(
          getSubIntervalInfoSource(subEntry)?.subIntervalID ||
            getSubIntervalInfoSource(subEntry)?.subIntervalId,
        ) === targetSubIntervalId,
    );

    return {
      ...intervalBase,
      intervalInfo: {
        ...intervalInfo,
        intervalStatus: [
          isTargetInterval
            ? requestedStatus
            : currentStatus.toLowerCase() === "current"
              ? "Normal"
              : currentStatus || "Normal",
        ],
      },
      intervalSubIntervals: nextSubIntervals,
    };
  });

  if (typeof memoryDoc?.markModified === "function") {
    memoryDoc.markModified("studyPlanner");
    memoryDoc.markModified("studyPlanner.programIntervals");
    memoryDoc.markModified("studyPlanner.programCurrentIntervalSelection");
  }

  studyPlanner.programIntervals = nextProgramIntervals;
  return studyPlanner;
};

export const updateStudyPlannerProgramInPlanner = (memoryDoc, payload = {}) => {
  const studyPlanner = getStudyPlannerRoot(memoryDoc);
  const normalizedPayload =
    payload && typeof payload === "object" ? toPlainObject(payload) || {} : {};
  const programId = trimString(normalizedPayload?.programID || normalizedPayload?.programId);

  if (!programId) {
    throw new Error("Program ID is required.");
  }

  studyPlanner.programID = programId;
  if (!Array.isArray(studyPlanner.programComponentNames)) {
    studyPlanner.programComponentNames = [];
  }
  if (!Array.isArray(studyPlanner.programIntervals)) {
    studyPlanner.programIntervals = [];
  }
  if (!Array.isArray(studyPlanner.exams)) {
    studyPlanner.exams = [];
  }

  ensureStudyOrganizer(memoryDoc);
  ensureStudyPlanAid(memoryDoc);

  return studyPlanner;
};

export const updateStudyPlannerMetaInPlanner = (memoryDoc, payload = {}) => {
  const studyPlanner = getStudyPlannerRoot(memoryDoc);
  studyPlanner.settings = sanitizePlannerSettingsForSchemaStorage(
    studyPlanner?.settings || {},
  );
  studyPlanner.programCourses = sanitizeProgramCoursesForSchemaStorage(
    studyPlanner?.programCourses || [],
  );
  const normalizedPayload =
    payload && typeof payload === "object" ? toPlainObject(payload) || {} : {};
  if (Object.prototype.hasOwnProperty.call(normalizedPayload, "programInstructors")) {
    delete normalizedPayload.programInstructors;
  }
  const nextProgramName = trimString(normalizedPayload?.programName);
  const nextProgramLanguage = trimString(normalizedPayload?.programLanguage);
  const nextProgramUniversity = trimString(normalizedPayload?.programUniversity);
  const nextProgramFaculty = trimString(normalizedPayload?.programFaculty);
  const hasProgramTaskNames = "programTaskNames" in normalizedPayload;
  const hasProgramTasks = "programTasks" in normalizedPayload;
  const hasProgramExams = "programExams" in normalizedPayload;
  const hasProgramStartYear = "programStartYear" in normalizedPayload;
  const hasProgramTotalYears = "programTotalYears" in normalizedPayload;
  const hasProgramTermsPerYear = "programTermsPerYear" in normalizedPayload;
  const hasProgramPassingThresholdPerInterval =
    "programPassingThresholdPerInterval" in normalizedPayload;
  const hasProgramFailingRules = "programFailingRules" in normalizedPayload;
  const nextProgramStartYear = hasProgramStartYear
    ? toFiniteNumber(normalizedPayload?.programStartYear, null)
    : null;
  const nextProgramTotalYears = hasProgramTotalYears
    ? toFiniteNumber(normalizedPayload?.programTotalYears, null)
    : null;
  const nextProgramTermsPerYear = hasProgramTermsPerYear
    ? toFiniteNumber(normalizedPayload?.programTermsPerYear, null)
    : null;
  const nextProgramPassingThresholdPerInterval =
    hasProgramPassingThresholdPerInterval &&
    normalizedPayload?.programPassingThresholdPerInterval &&
    typeof normalizedPayload.programPassingThresholdPerInterval === "object"
      ? toPlainObject(normalizedPayload.programPassingThresholdPerInterval) || {}
      : {};
  const nextProgramFailingRules = hasProgramFailingRules
    ? normalizeProgramFailingRulesForPlanner({
        programFailingRules: Array.isArray(normalizedPayload?.programFailingRules)
          ? normalizedPayload.programFailingRules
          : [],
      })
    : [];
  const nextProgramTaskNames = hasProgramTaskNames
    ? normalizeProgramTaskNamesForPlanner({
        programTaskNames: Array.isArray(normalizedPayload?.programTaskNames)
          ? normalizedPayload.programTaskNames
          : [],
      })
    : [];
  const nextProgramExams = hasProgramExams
    ? normalizeProgramExamsForPlanner({
        programExams: Array.isArray(normalizedPayload?.programExams)
          ? normalizedPayload.programExams
          : [],
      })
    : [];
  const nextProgramTasks = hasProgramTasks
    ? normalizeProgramTasksForPlanner({
        programTasks: Array.isArray(normalizedPayload?.programTasks)
          ? normalizedPayload.programTasks
          : [],
      })
    : [];
  const hasProgramDocumentTypes = "programDocumentTypes" in normalizedPayload;
  const nextProgramDocumentTypes = hasProgramDocumentTypes
    ? (Array.isArray(normalizedPayload?.programDocumentTypes)
        ? normalizedPayload.programDocumentTypes
        : []
      ).map((entry) => String(entry || "").trim()).filter(Boolean)
    : [];
  const hasProgramDocumentVolumeUnit =
    "programDocumentVolumeUnit" in normalizedPayload;
  const nextProgramDocumentVolumeUnit = hasProgramDocumentVolumeUnit
    ? (Array.isArray(normalizedPayload?.programDocumentVolumeUnit)
        ? normalizedPayload.programDocumentVolumeUnit
        : []
      ).map((entry) => String(entry || "").trim()).filter(Boolean)
    : [];
  const hasProgramEditors = "programEditors" in normalizedPayload;
  const hasProgramLocations = "programLocations" in normalizedPayload;
  const hasProgramIntervals = "programIntervals" in normalizedPayload;
  const hasProgramCurrentIntervalSelection = "programCurrentIntervalSelection" in normalizedPayload;
  const hasProgramAIExtractions = "programAIExtractions" in normalizedPayload;
  const hasSettings = "settings" in normalizedPayload;
  const nextSettings = hasSettings
    ? normalizeStudyOrganizerSettings(
        toPlainObject(normalizedPayload?.settings) || {},
      )
    : null;
  const nextProgramEditors = hasProgramEditors
    ? normalizeStringArray(normalizedPayload?.programEditors)
    : [];
  const nextProgramLocations = hasProgramLocations
    ? (Array.isArray(normalizedPayload?.programLocations)
        ? normalizedPayload.programLocations
        : [normalizedPayload?.programLocations]
      )
        .map((entry) => {
          const normalizedEntry =
            entry && typeof entry === "object" ? toPlainObject(entry) || {} : {};
          const location = sanitizeStudyLocation(normalizedEntry);
          return location.building || location.room ? location : null;
        })
        .filter(Boolean)
    : [];
  const nextThresholdUnit = trimString(
    nextProgramPassingThresholdPerInterval?.thresholdUnit,
  );
  const nextThresholdMode = trimString(
    nextProgramPassingThresholdPerInterval?.thresholdMode,
  );
  const nextThresholdNumber = hasProgramPassingThresholdPerInterval
    ? toFiniteNumber(
        nextProgramPassingThresholdPerInterval?.thresholdNumber,
        null,
      )
    : null;

  if (
    !nextProgramName &&
    !nextProgramLanguage &&
    !nextProgramUniversity &&
    !nextProgramFaculty &&
    !hasProgramTaskNames &&
    !hasProgramTasks &&
    !hasProgramExams &&
    !hasProgramStartYear &&
    !hasProgramTotalYears &&
    !hasProgramTermsPerYear &&
    !hasProgramPassingThresholdPerInterval &&
    !hasProgramFailingRules &&
    !hasProgramDocumentTypes &&
    !hasProgramDocumentVolumeUnit &&
    !hasProgramEditors &&
    !hasProgramLocations &&
    !hasProgramIntervals &&
    !hasProgramCurrentIntervalSelection &&
    !hasProgramAIExtractions &&
    !hasSettings
  ) {
    throw new Error(
      "At least one studyPlanner meta field is required.",
    );
  }

  if ("programName" in normalizedPayload) {
    studyPlanner.programName = nextProgramName;
  }
  if ("programLanguage" in normalizedPayload) {
    studyPlanner.programLanguage = nextProgramLanguage;
  }
  if ("programUniversity" in normalizedPayload) {
    studyPlanner.programUniversity = nextProgramUniversity;
  }
  if ("programFaculty" in normalizedPayload) {
    studyPlanner.programFaculty = nextProgramFaculty;
  }
  if (hasProgramTaskNames) {
    studyPlanner.programTaskNames = nextProgramTaskNames;
  }
  if (hasProgramExams) {
    studyPlanner.programExams = nextProgramExams;
  }
  if (hasProgramTasks) {
    studyPlanner.programTasks = nextProgramTasks;
  }
  if (hasProgramDocumentTypes) {
    studyPlanner.programDocumentTypes = nextProgramDocumentTypes;
  }
  if (hasProgramDocumentVolumeUnit) {
    studyPlanner.programDocumentVolumeUnit = nextProgramDocumentVolumeUnit;
  }
  if (hasProgramEditors) {
    studyPlanner.programEditors = nextProgramEditors;
  }
  if (hasProgramLocations) {
    studyPlanner.programLocations = nextProgramLocations;
  }
  if (hasProgramIntervals) {
    studyPlanner.programIntervals = normalizePlannerIntervalEntries(
      Array.isArray(normalizedPayload?.programIntervals)
        ? normalizedPayload.programIntervals.map((entry) => toPlainObject(entry) || {})
        : [],
      trimString(studyPlanner?.programID),
    );
  }
  if (hasProgramCurrentIntervalSelection) {
    const raw = normalizedPayload?.programCurrentIntervalSelection;
    const rawObj = raw && typeof raw === "object" ? toPlainObject(raw) || {} : {};
    const intervalNum = toFiniteNumber(rawObj?.intervalNum, null);
    const subIntervalNum = toFiniteNumber(rawObj?.subIntervalNum, null);
    const targetSubIntervalId = trimString(
      rawObj?.subIntervalID ||
        rawObj?.subIntervalId ||
        normalizedPayload?.subIntervalID ||
        normalizedPayload?.subIntervalId,
    );
    const resolvedTarget =
      targetSubIntervalId &&
      Array.isArray(studyPlanner?.programIntervals)
        ? studyPlanner.programIntervals
            .flatMap((intervalEntry) => {
              const currentIntervalNum = toFiniteNumber(
                getIntervalInfoSource(intervalEntry)?.intervalNum,
                null,
              );
          return (Array.isArray(intervalEntry?.intervalSubIntervals)
            ? intervalEntry.intervalSubIntervals
            : []
          ).map((subEntry) => ({
            intervalNum: currentIntervalNum,
            subIntervalNum: toFiniteNumber(
              getSubIntervalInfoSource(subEntry)?.subIntervalNum,
              null,
            ),
            subIntervalID: trimString(
                  getSubIntervalInfoSource(subEntry)?.subIntervalID ||
                    getSubIntervalInfoSource(subEntry)?.subIntervalId,
                ),
              }));
            })
            .find((entry) => entry.subIntervalID === targetSubIntervalId) || null
        : null;
    const nextIntervalNum = intervalNum !== null ? intervalNum : resolvedTarget?.intervalNum ?? null;
    const nextSubIntervalNum = subIntervalNum !== null ? subIntervalNum : resolvedTarget?.subIntervalNum ?? null;
    studyPlanner.programCurrentIntervalSelection =
      targetSubIntervalId || nextIntervalNum !== null || nextSubIntervalNum !== null
        ? {
            intervalNum: nextIntervalNum,
            subIntervalNum: nextSubIntervalNum,
            subIntervalID: targetSubIntervalId || resolvedTarget?.subIntervalID || "",
          }
        : null;
    if (targetSubIntervalId || resolvedTarget) {
      studyPlanner.programIntervals = (Array.isArray(studyPlanner.programIntervals)
        ? studyPlanner.programIntervals
        : []
      ).map((intervalEntry) => {
        const currentIntervalNum = toFiniteNumber(
          getIntervalInfoSource(intervalEntry)?.intervalNum,
          null,
        );
        return {
          ...intervalEntry,
          intervalSubIntervals: (Array.isArray(intervalEntry?.intervalSubIntervals)
            ? intervalEntry.intervalSubIntervals
            : []
          ).map((subEntry) => {
            const subInfo = getSubIntervalInfoSource(subEntry);
            const subId = sanitizeId(trimString(subInfo?.subIntervalID || subInfo?.subIntervalId));
            const subNum = toFiniteNumber(subInfo?.subIntervalNum, null);
            const isTarget =
              Boolean(targetSubIntervalId && subId === targetSubIntervalId) ||
              (resolvedTarget &&
                currentIntervalNum === resolvedTarget.intervalNum &&
                subNum === resolvedTarget.subIntervalNum);
            return {
              ...subEntry,
              subIntervalInfo: {
                ...subInfo,
                subIntervalCurrent: isTarget,
              },
            };
          }),
        };
      });
    }
    if (typeof memoryDoc?.markModified === "function") {
      memoryDoc.markModified("studyPlanner");
      memoryDoc.markModified("studyPlanner.programCurrentIntervalSelection");
      if (hasProgramIntervals) {
        memoryDoc.markModified("studyPlanner.programIntervals");
      }
    }
  }
  if (hasProgramAIExtractions) {
    studyPlanner.programAIExtractions = (Array.isArray(normalizedPayload?.programAIExtractions)
      ? normalizedPayload.programAIExtractions
      : []
    )
      .map((entry) => {
        if (!entry || typeof entry !== "object") return null;
        const obj = toPlainObject(entry) || {};
        const result = {};
        if (Array.isArray(obj?.coursesNameCode)) {
          result.coursesNameCode = obj.coursesNameCode
            .map((c) => {
              const co = c && typeof c === "object" ? toPlainObject(c) || {} : {};
              return { courseName: trimString(co?.courseName) || "", courseCode: trimString(co?.courseCode) || "" };
            })
            .filter((c) => c.courseName || c.courseCode);
        }
        if (Array.isArray(obj?.instructorsNames)) {
          result.instructorsNames = obj.instructorsNames
            .map((n) => {
              const no = n && typeof n === "object" ? toPlainObject(n) || {} : {};
              return { firstName: trimString(no?.firstName) || "", lastName: trimString(no?.lastName) || "" };
            })
            .filter((n) => n.firstName && n.lastName);
        }
        if (Array.isArray(obj?.programInstructorNames)) {
          result.programInstructorNames = obj.programInstructorNames;
        }
        if (Array.isArray(obj?.subIntervalCourses)) {
          result.subIntervalCourses = obj.subIntervalCourses
            .map((c) => String(c || "").trim())
            .filter(Boolean);
          /* legacy block preserved but no longer executed — schema is now [String]
            .map((c) => {
              const co = c && typeof c === "object" ? toPlainObject(c) || {} : {};
              return {
                courseSymbol: trimString(co?.courseSymbol) || "CRS",
                courseNum: Number.isFinite(co?.courseNum) ? co.courseNum : undefined,
                courseID: sanitizeId(trimString(co?.courseID)) || "",
                courseName: trimString(co?.courseName) || "",
                courseCode: trimString(co?.courseCode) || "",
                courseWeight: Number.isFinite(co?.courseWeight) ? co.courseWeight : 100,
                courseComponents: Array.isArray(co?.courseComponents)
                  ? co.courseComponents.map((comp) => {
                      const cp = comp && typeof comp === "object" ? toPlainObject(comp) || {} : {};
                      return {
                        componentSymbol: trimString(cp?.componentSymbol) || "COMP",
                        componentNum: Number.isFinite(cp?.componentNum) ? cp.componentNum : undefined,
                        componentID: sanitizeId(trimString(cp?.componentID)) || "",
                        componentClass: trimString(cp?.componentClass) || "",
                        componentWeight: Number.isFinite(cp?.componentWeight) ? cp.componentWeight : null,
                      };
                    })
                  : [],
              };
            })
            .filter((c) => c.courseName || c.courseCode);
          */
        }
        return Object.keys(result).length > 0 ? result : null;
      })
        .filter(Boolean);
  }
  if (hasSettings) {
    const storedSettings = sanitizePlannerSettingsForSchemaStorage(
      nextSettings || {},
    );
    studyPlanner.settings = storedSettings;
  }
  if (hasProgramStartYear) {
    studyPlanner.programStartYear = Number.isFinite(nextProgramStartYear)
      ? nextProgramStartYear
      : null;
  }
  if (hasProgramTotalYears) {
    studyPlanner.programTotalYears = Number.isFinite(nextProgramTotalYears)
      ? nextProgramTotalYears
      : null;
  }
  if (hasProgramTermsPerYear) {
    studyPlanner.programTermsPerYear = Number.isFinite(nextProgramTermsPerYear)
      ? nextProgramTermsPerYear
      : null;
  }
  if (hasProgramPassingThresholdPerInterval) {
    studyPlanner.programPassingThresholdPerInterval = {
      thresholdMode: nextThresholdMode || null,
      thresholdUnit: nextThresholdUnit || null,
      thresholdNumber: Number.isFinite(nextThresholdNumber)
        ? nextThresholdNumber
        : null,
    };
  }
  if (hasProgramFailingRules) {
    studyPlanner.programFailingRules = nextProgramFailingRules;
    if (!hasProgramPassingThresholdPerInterval) {
      const primaryFailingRule =
        nextProgramFailingRules.find(
          (entry) => entry && typeof entry === "object",
        ) || null;
      studyPlanner.programPassingThresholdPerInterval = primaryFailingRule
        ? {
            thresholdMode: primaryFailingRule?.thresholdMode || null,
            thresholdUnit: primaryFailingRule?.thresholdUnit || null,
            thresholdNumber: Number.isFinite(primaryFailingRule?.thresholdNumber)
              ? primaryFailingRule.thresholdNumber
              : null,
          }
        : {
            thresholdMode: null,
            thresholdUnit: null,
            thresholdNumber: null,
          };
    }
  }
  if (!Array.isArray(studyPlanner.programComponentNames)) {
    studyPlanner.programComponentNames = [];
  }
  if (!Array.isArray(studyPlanner.programIntervals)) {
    studyPlanner.programIntervals = [];
  }
  if (!Array.isArray(studyPlanner.exams)) {
    studyPlanner.exams = [];
  }

  ensureStudyOrganizer(memoryDoc);
  ensureStudyPlanAid(memoryDoc);

  if (typeof memoryDoc?.markModified === "function") {
    memoryDoc.markModified("studyPlanner");
    if (hasSettings) {
      memoryDoc.markModified("studyPlanner.settings");
    }
    if (hasProgramTasks) {
      memoryDoc.markModified("studyPlanner.programTasks");
    }
  }

  return studyPlanner;
};

export const updateStudyPlannerComponentsInPlanner = (memoryDoc, payload = {}) => {
  const studyPlanner = getStudyPlannerRoot(memoryDoc);
  const normalizedPayload =
    payload && typeof payload === "object" ? toPlainObject(payload) || {} : {};
  const rawProgramComponents = Array.isArray(normalizedPayload?.programComponentNames)
    ? normalizedPayload.programComponentNames
    : [];
  const seenNames = new Set();
  const componentEntries = rawProgramComponents
    .map((entry, index) => {
      const componentName = normalizeProgramComponentValue(entry);
      if (!componentName) return null;
      const componentNum =
        entry && typeof entry === "object" && Number.isFinite(Number(entry.componentNum))
          ? Number(entry.componentNum)
          : index + 1;
      return { componentName, componentNum };
    })
    .filter((entry) => {
      if (!entry) return false;
      if (seenNames.has(entry.componentName)) return false;
      seenNames.add(entry.componentName);
      return true;
    });

  studyPlanner.programComponentNames = componentEntries;
  if (!Array.isArray(studyPlanner.programIntervals)) {
    studyPlanner.programIntervals = [];
  }
  if (!Array.isArray(studyPlanner.exams)) {
    studyPlanner.exams = [];
  }

  ensureStudyOrganizer(memoryDoc);
  ensureStudyPlanAid(memoryDoc);

  return studyPlanner;
};

const getPlannerCourses = (memoryDoc) => {
  const studyOrganizer = ensureStudyOrganizer(memoryDoc);
  return Array.isArray(studyOrganizer?.courses) ? studyOrganizer.courses : [];
};

const setPlannerCourses = (memoryDoc, courses = []) => {
  const studyOrganizer = ensureStudyOrganizer(memoryDoc);
  studyOrganizer.courses = Array.isArray(courses)
    ? courses.map((entry) => sanitizeStudyCourse(toPlainObject(entry) || {}))
    : [];
};

const countLectureFinishedPages = (lecture = {}) =>
  toPositiveInteger(lecture?.progress, 0);

const countLecturePages = (lecture = {}) =>
  Array.isArray(lecture?.content)
    ? lecture.content.length
    : Array.isArray(lecture?.pages)
      ? lecture.pages.length
      : 0;

const getLecturePageStats = (lecture = {}) => ({
  totalPages: countLecturePages(lecture),
  finishedPages: countLectureFinishedPages(lecture),
});

const getComponentPageStats = (component = {}) => {
  const lectures = Array.isArray(component?.lectures) ? component.lectures : [];

  return lectures.reduce(
    (totals, lecture) => {
      const lectureStats = getLecturePageStats(lecture);
      return {
        totalPages: totals.totalPages + lectureStats.totalPages,
        finishedPages: totals.finishedPages + lectureStats.finishedPages,
      };
    },
    { totalPages: 0, finishedPages: 0 },
  );
};

const buildLecturePages = (payload = {}, previousLecture = {}) => {
  const previousPages = Array.isArray(previousLecture?.content)
    ? previousLecture.content.map((page) => ({ ...toPlainObject(page) }))
    : Array.isArray(previousLecture?.pages)
      ? previousLecture.pages.map((page) => ({ ...toPlainObject(page) }))
    : [];
  const totalPages = Math.max(
    toPositiveInteger(
      payload?.volume?.total ?? payload?.lecture_volume_total ?? payload?.lecture_length,
      previousPages.length,
    ),
    previousPages.length && !payload?.lecture_length ? previousPages.length : 0,
  );
  const finishedPages = new Set(
    Array.isArray(payload?.lecture_pagesFinished)
      ? payload.lecture_pagesFinished
          .map((pageNumber) => toPositiveInteger(pageNumber, 0))
          .filter((pageNumber) => pageNumber > 0)
      : [],
  );
  const pageStudyTimeEntries =
    payload?.lecture_pageStudyTimes &&
    typeof payload.lecture_pageStudyTimes === "object"
      ? payload.lecture_pageStudyTimes
      : {};

  return Array.from({ length: totalPages }, (_, index) => {
    const order = index + 1;
    const previousPage = previousPages[index] || {};
    const payloadStudyTime = Number(pageStudyTimeEntries?.[order] || 0);
    const previousStudyTime = Number(previousPage?.plan?.studyTimePerPage || 0);

    return {
      ...(previousPage?._id ? { _id: previousPage._id } : {}),
      order,
      status: finishedPages.has(order) ? "done" : "remaining",
      textData: Array.isArray(previousPage?.textData) ? previousPage.textData : [],
      nonTextData: Array.isArray(previousPage?.nonTextData)
        ? previousPage.nonTextData
        : [],
      plan: {
        ...(previousPage?.plan && typeof previousPage.plan === "object"
          ? previousPage.plan
          : {}),
        studyTimePerPage: Math.max(
          0,
          Number.isFinite(payloadStudyTime)
            ? payloadStudyTime
            : Number.isFinite(previousStudyTime)
              ? previousStudyTime
              : 0,
        ),
      },
    };
  });
};

const findCourseAndComponentById = (courses = [], targetId = "") => {
  const normalizedTargetId = trimString(targetId);

  for (let courseIndex = 0; courseIndex < courses.length; courseIndex += 1) {
    const course = courses[courseIndex];
    if (String(course?._id || "") === normalizedTargetId) {
      return {
        courseIndex,
        componentIndex: -1,
        course: toPlainObject(course),
        component: null,
      };
    }

    const components = Array.isArray(course?.components) ? course.components : [];
    for (let componentIndex = 0; componentIndex < components.length; componentIndex += 1) {
      const component = components[componentIndex];
      if (String(component?._id || "") === normalizedTargetId) {
        return {
          courseIndex,
          componentIndex,
          course: toPlainObject(course),
          component: toPlainObject(component),
        };
      }
    }
  }

  return {
    courseIndex: -1,
    componentIndex: -1,
    course: null,
    component: null,
  };
};

const findCourseComponentByLabel = (courses = [], courseLabel = "") => {
  const normalizedCourseLabel = trimString(courseLabel);
  const { baseCourseName, componentName } = splitLectureCourseLabel(normalizedCourseLabel);

  for (let courseIndex = 0; courseIndex < courses.length; courseIndex += 1) {
    const course = toPlainObject(courses[courseIndex]) || {};
    const components = Array.isArray(course?.components) ? course.components : [];

    for (let componentIndex = 0; componentIndex < components.length; componentIndex += 1) {
      const component = toPlainObject(components[componentIndex]) || {};
      const fullCourseLabel = buildLectureCourseLabel(course?.name, component?.name);

      if (fullCourseLabel === normalizedCourseLabel) {
        return { courseIndex, componentIndex, course, component };
      }

      if (
        trimString(course?.name) === baseCourseName &&
        (!componentName || trimString(component?.name) === componentName)
      ) {
        return { courseIndex, componentIndex, course, component };
      }
    }
  }

  return {
    courseIndex: -1,
    componentIndex: -1,
    course: null,
    component: null,
  };
};

const normalizePlannerExamPayloads = (
  entries = [],
  fallbackPayload = {},
  previousExams = [],
  previousLectures = [],
  componentId = null,
) => {
  const candidateEntries = Array.isArray(entries) && entries.length > 0 ? entries : [fallbackPayload];
  const existingLectureIds = new Set(
    (Array.isArray(previousLectures) ? previousLectures : [])
      .map((lecture) => normalizeIdString(lecture?._id))
      .filter(Boolean),
  );

  return candidateEntries
    .map((entry, index) => {
      const previousExam = toPlainObject(previousExams[index]) || {};
      const normalizedWeight = trimString(
        entry?.course_grade ??
          entry?.weight?.value ??
          previousExam?.weight?.value,
      );
      const normalizedGrade = trimString(
        entry?.course_fullGrade ??
          entry?.grade?.max ??
          previousExam?.grade?.max,
      );
      const normalizedDate = trimString(entry?.exam_date);
      const normalizedTime = trimString(entry?.exam_time);
      const normalizedTitle = trimString(entry?.type ?? entry?.exam_type);
      const nextLectureIds = normalizeReferenceIds(entry?.lectures).filter((lectureId) =>
        existingLectureIds.has(lectureId),
      );
      const nextLocation = sanitizeStudyLocation(
        entry?.location ||
          {
            building: entry?.course_locationBuilding,
            room: entry?.course_locationRoom,
          } ||
          previousExam?.location ||
          {},
      );
      const nextVolume = sanitizeStudyVolume(
        entry?.volume || previousExam?.volume || {},
      );
      const nextWeight =
        entry?.weight && typeof entry.weight === "object"
          ? sanitizeStudyWeight({
              ...(previousExam?.weight || {}),
              ...entry.weight,
            })
          : buildWeight(normalizedWeight, previousExam?.weight || {});
      const nextPassGrade =
        entry?.passGrade && typeof entry.passGrade === "object"
          ? sanitizeStudyGrade({
              ...(previousExam?.passGrade || {}),
              ...entry.passGrade,
            })
          : buildGrade(
              previousExam?.passGrade?.value,
              previousExam?.passGrade || {},
              { assignTo: "value" },
            );
      const nextGrade =
        entry?.grade && typeof entry.grade === "object"
          ? sanitizeStudyGrade({
              ...(previousExam?.grade || {}),
              ...entry.grade,
            })
          : buildGrade(normalizedGrade, previousExam?.grade || {}, {
              assignTo: "max",
            });
      const nextGradeStatus = deriveExamGradeStatusFromValues(
        nextGrade,
        nextPassGrade,
      );
      const nextTimeBase =
        entry?.time && typeof entry.time === "object"
          ? sanitizeStudyTime({
              ...(previousExam?.time || {}),
              ...entry.time,
            })
          : sanitizeStudyTime(previousExam?.time || {});
      const nextTime =
        normalizedDate || normalizedTime
          ? {
              ...nextTimeBase,
              ...buildExamTime(normalizedDate, normalizedTime, previousExam?.time || {}),
            }
          : nextTimeBase;

      if (
        !normalizedWeight &&
        !normalizedGrade &&
        !normalizedDate &&
        !normalizedTime &&
        !normalizedTitle &&
        nextLectureIds.length === 0 &&
        !trimString(previousExam?.title) &&
        !trimString(nextLocation?.building) &&
        !trimString(nextLocation?.room) &&
        !toFiniteNumber(nextVolume?.value, 0) &&
        !trimString(nextVolume?.scope) &&
        !trimString(nextVolume?.note) &&
        !toFiniteNumber(nextWeight?.value, 0) &&
        !toFiniteNumber(nextPassGrade?.value, null) &&
        !toFiniteNumber(nextPassGrade?.min, null) &&
        !toFiniteNumber(nextPassGrade?.max, null) &&
        !toFiniteNumber(nextGrade?.value, null) &&
        !toFiniteNumber(nextGrade?.min, null) &&
        !toFiniteNumber(nextGrade?.max, null)
      ) {
        return null;
      }

      return {
        ...(previousExam?._id ? { _id: previousExam._id } : {}),
        componentId: previousExam?.componentId || componentId || null,
        title: normalizedTitle || trimString(previousExam?.title),
        type: normalizedTitle || trimString(previousExam?.type),
        time: nextTime,
        location: nextLocation,
        volume: nextVolume,
        lectures:
          nextLectureIds.length > 0
            ? nextLectureIds
            : normalizeReferenceIds(previousExam?.lectures).filter((lectureId) =>
                existingLectureIds.has(lectureId),
              ),
        weight: nextWeight,
        passGrade: nextPassGrade,
        grade: {
          ...nextGrade,
          status: nextGradeStatus,
        },
      };
    })
    .filter(Boolean);
};

const recalculateComponentAndCourseTotals = (course = {}) => {
  const normalizedCourse = toPlainObject(course) || {};
  const components = Array.isArray(normalizedCourse?.components)
    ? normalizedCourse.components.map((component) => {
        const normalizedComponent = toPlainObject(component) || {};
        const lectures = Array.isArray(normalizedComponent?.lectures)
          ? normalizedComponent.lectures
          : [];
        const exams = Array.isArray(normalizedComponent?.exams)
          ? normalizedComponent.exams.map((exam) => toPlainObject(exam) || {})
          : [];
        const componentStatus = derivePlannerComponentStatus({
          ...normalizedComponent,
          lectures,
          exams,
        });

        return {
          ...normalizedComponent,
          status: componentStatus,
          lectures,
          exams,
        };
      })
    : [];
  const courseStatus = derivePlannerCourseStatus(components);

  return {
    ...normalizedCourse,
    status: courseStatus,
    components: sortPlannerComponentsByOrder(components),
  };
};

export const recalculateCourseLectureTotals = (memoryDoc) => {
  const nextCourses = getPlannerCourses(memoryDoc).map((course) =>
    recalculateComponentAndCourseTotals(course),
  );
  setPlannerCourses(memoryDoc, nextCourses);
};

const buildCoursePayloadForUpdate = (payload = {}, previousCourse = {}) => {
  const normalizedPreviousCourse = toPlainObject(previousCourse) || {};
  const previousComponents = Array.isArray(normalizedPreviousCourse?.components)
    ? normalizedPreviousCourse.components
    : [];
  const previousComponent =
    toPlainObject(previousComponents[0]) || {
      lectures: [],
      exams: [],
    };
  const previousLectures = Array.isArray(previousComponent?.lectures)
    ? previousComponent.lectures.map((lecture) => toPlainObject(lecture))
    : [];
  const componentName =
    trimString(payload?.course_component) || trimString(previousComponent?.name) || "-";
  const baseCourseName =
    stripComponentFromCourseLabel(payload?.course_name, componentName) ||
    trimString(normalizedPreviousCourse?.name) ||
    trimString(payload?.course_name) ||
    "-";
  const nextCourseId = normalizedPreviousCourse?._id || new Types.ObjectId();
  const nextComponentId = previousComponent?._id || new Types.ObjectId();

  const nextCourse = {
    _id: nextCourseId,
    code: trimString(normalizedPreviousCourse?.code),
    name: baseCourseName,
    components: [
      {
        _id: nextComponentId,
        class: trimString(previousComponent?.class),
        time: {
          ...(previousComponent?.time && typeof previousComponent.time === "object"
            ? previousComponent.time
            : {}),
        },
        location:
          previousComponent?.location && typeof previousComponent.location === "object"
            ? previousComponent.location
            : {},
        schedule:
          normalizeScheduleInput(payload?.course_dayAndTime).length > 0
            ? normalizeScheduleInput(payload?.course_dayAndTime)
            : Array.isArray(previousComponent?.schedule)
              ? previousComponent.schedule
              : [],
        lectures: previousLectures,
      },
    ],
  };

  return recalculateComponentAndCourseTotals(nextCourse);
};

export const buildCourseInfoPayload = (payload = {}, previousCourse = {}) => {
  const normalizedPreviousCourse = toPlainObject(previousCourse) || {};
  const hasExplicitCourseWeight =
    payload?.courseWeight !== null &&
    payload?.courseWeight !== undefined &&
    String(payload?.courseWeight).trim() !== "";

  return {
    _id:
      normalizeObjectIdValue(normalizedPreviousCourse?._id) || new Types.ObjectId(),
    code: trimString(payload?.course_code) || trimString(normalizedPreviousCourse?.code),
    name: trimString(payload?.course_name) || trimString(normalizedPreviousCourse?.name) || "-",
    status: normalizeCourseStatus(normalizedPreviousCourse?.status),
    weight:
      hasExplicitCourseWeight
        ? toFiniteNumber(payload?.courseWeight, null)
        : toFiniteNumber(
            normalizedPreviousCourse?.weight ?? normalizedPreviousCourse?.totalWeight,
            null,
          ),
    components: Array.isArray(normalizedPreviousCourse?.components)
      ? normalizedPreviousCourse.components.map((component) => toPlainObject(component))
      : [],
  };
};

export const buildComponentPayload = (payload = {}, previousComponent = {}) => {
  const normalizedPreviousComponent = toPlainObject(previousComponent) || {};
  const nextComponentId =
    normalizeObjectIdValue(normalizedPreviousComponent?._id) ||
    new Types.ObjectId();
  const normalizedPreviousTime =
    normalizedPreviousComponent?.time && typeof normalizedPreviousComponent.time === "object"
      ? normalizedPreviousComponent.time
      : {};
  const rawProgramYear =
    payload?.programYear !== null && payload?.programYear !== undefined
      ? payload.programYear
      : normalizedPreviousTime?.programYear;
  const normalizedProgramYear = toFiniteNumber(rawProgramYear, null);
  const rawNormativeProgramYear =
    payload?.normativeCourseYearNum !== null &&
    payload?.normativeCourseYearNum !== undefined
      ? payload.normativeCourseYearNum
      : normalizedPreviousTime?.Normative?.courseYearNum;
  const normalizedNormativeProgramYear = toFiniteNumber(
    rawNormativeProgramYear,
    null,
  );
  const normativeAcademicYear =
    normalizeOptionalPlannerString(payload?.normativeCourseYearInterval) ||
    normalizeOptionalPlannerString(
      normalizedPreviousTime?.Normative?.courseYearInterval,
    );
  const normativeTerm = normalizeStudyTerm(
    payload?.normativeCourseTerm || normalizedPreviousTime?.Normative?.courseTerm,
  );
  const academicYear =
    normalizeOptionalPlannerString(payload?.academicYear) ||
    normalizeOptionalPlannerString(payload?.course_year);
  const rawActualYear =
    payload?.actualCourseYearNum !== null &&
    payload?.actualCourseYearNum !== undefined
      ? payload.actualCourseYearNum
      : normalizedPreviousTime?.actual?.courseYearNum;
  const normalizedActualYear = toFiniteNumber(rawActualYear, null);
  const actualAcademicYear =
    normalizeOptionalPlannerString(payload?.actualCourseYearInterval) ||
    normalizeOptionalPlannerString(
      normalizedPreviousTime?.actual?.courseYearInterval,
    );
  const actualTerm = normalizeStudyTerm(
    payload?.actualCourseTerm || normalizedPreviousTime?.actual?.courseTerm,
  );
  const term = normalizeStudyTerm(payload?.term || payload?.course_term);
  const previousLectures = Array.isArray(normalizedPreviousComponent?.lectures)
    ? normalizedPreviousComponent.lectures.map((lecture) => toPlainObject(lecture))
    : [];
  const nextExams = normalizePlannerExamPayloads(
    payload?.course_exams,
    {},
    Array.isArray(normalizedPreviousComponent?.exams)
      ? normalizedPreviousComponent.exams
      : [],
    previousLectures,
    nextComponentId,
  );
  const nextWeight = (() => {
    const previousWeight =
      normalizedPreviousComponent?.weight && typeof normalizedPreviousComponent.weight === "object"
        ? normalizedPreviousComponent.weight?.value
        : normalizedPreviousComponent?.weight;

    if (payload?.weight && typeof payload.weight === "object") {
      return normalizeComponentWeightNumber(
        payload.weight?.value,
        normalizeComponentWeightNumber(previousWeight, 0),
      );
    }

    return normalizeComponentWeightNumber(
      payload?.course_grade,
      normalizeComponentWeightNumber(previousWeight, 0),
    );
  })();

  return {
    _id: nextComponentId,
    order: toPositiveInteger(
      payload?.order,
      toPositiveInteger(normalizedPreviousComponent?.order, 0),
    ),
    class:
      trimString(payload?.course_class) ||
      trimString(normalizedPreviousComponent?.class) ||
      "-",
    status: normalizeComponentStatus(normalizedPreviousComponent?.status),
    time: {
      ...normalizedPreviousTime,
      programYear:
        Number.isFinite(normalizedProgramYear) && normalizedProgramYear >= 0
          ? Math.trunc(normalizedProgramYear)
          : normalizedPreviousTime?.programYear ?? null,
      academicYear:
        academicYear ||
        normalizeOptionalPlannerString(normalizedPreviousTime?.academicYear) ||
        null,
      term:
        term ||
        normalizeStudyTerm(normalizedPreviousTime?.term) ||
        null,
      Normative: {
        ...(normalizedPreviousTime?.Normative || {}),
        courseYearNum:
          Number.isFinite(normalizedNormativeProgramYear) &&
          normalizedNormativeProgramYear >= 0
            ? Math.trunc(normalizedNormativeProgramYear)
            : normalizedPreviousTime?.Normative?.courseYearNum ?? null,
        courseYearInterval: normativeAcademicYear || null,
        courseTerm: normativeTerm || null,
      },
      actual: {
        ...(normalizedPreviousTime?.actual || {}),
        courseYearNum:
          Number.isFinite(normalizedActualYear) && normalizedActualYear >= 0
            ? Math.trunc(normalizedActualYear)
            : normalizedPreviousTime?.actual?.courseYearNum ?? null,
        courseYearInterval: actualAcademicYear || null,
        courseTerm: actualTerm || null,
      },
    },
    location: buildLocation(payload, normalizedPreviousComponent?.location || {}),
    schedule:
      normalizeScheduleInput(payload?.course_dayAndTime).length > 0
        ? normalizeScheduleInput(payload?.course_dayAndTime)
        : Array.isArray(normalizedPreviousComponent?.schedule)
          ? normalizedPreviousComponent.schedule
          : [],
    weight: nextWeight,
    lectures: previousLectures,
    exams: nextExams,
  };
};

const sortPlannerComponentsByOrder = (components = []) =>
  [...(Array.isArray(components) ? components : [])].sort((left, right) => {
    const leftOrder = toPositiveInteger(left?.order, 0);
    const rightOrder = toPositiveInteger(right?.order, 0);

    if (leftOrder > 0 && rightOrder > 0) {
      return leftOrder - rightOrder;
    }

    if (leftOrder > 0) {
      return -1;
    }

    if (rightOrder > 0) {
      return 1;
    }

    return 0;
  });

export const addCourseInfoToPlanner = (memoryDoc, payload = {}) => {
  const courses = getPlannerCourses(memoryDoc).map((course) => toPlainObject(course));
  const nextCourse = recalculateComponentAndCourseTotals(buildCourseInfoPayload(payload));
  courses.push(nextCourse);
  setPlannerCourses(memoryDoc, courses);
  return nextCourse;
};

export const addComponentToPlanner = (memoryDoc, courseId = "", payload = {}) => {
  const courses = getPlannerCourses(memoryDoc).map((course) => toPlainObject(course));
  const match = findCourseAndComponentById(courses, courseId);

  if (match.courseIndex === -1) {
    return null;
  }

  const nextComponent = buildComponentPayload(payload);
  let updatedCourse = null;

  const nextCourses = courses.map((courseEntry, index) => {
    if (index !== match.courseIndex) {
      return courseEntry;
    }

    const normalizedCourse = toPlainObject(courseEntry) || {};
    updatedCourse = recalculateComponentAndCourseTotals({
      ...normalizedCourse,
      components: sortPlannerComponentsByOrder([
        ...(Array.isArray(normalizedCourse?.components)
          ? normalizedCourse.components.map((component) => toPlainObject(component))
          : []),
        nextComponent,
      ]),
    });

    return updatedCourse;
  });

  setPlannerCourses(memoryDoc, nextCourses);
  return nextComponent;
};

export const buildManualLecturePayload = (payload = {}, previousLecture = {}) => {
  const normalizedPreviousLecture = toPlainObject(previousLecture) || {};
  const content = buildLecturePages(payload, normalizedPreviousLecture);
  const instructors = normalizeDelimitedStringArray(
    payload?.instructors ?? payload?.lecture_instructors ?? payload?.lecture_instructor,
  );
  const editors = normalizeDelimitedStringArray(
    payload?.editors ?? payload?.lecture_editors ?? payload?.lecture_editor,
  );
  const writers = normalizeDelimitedStringArray(
    payload?.writer ?? payload?.writers ?? payload?.lecture_writers ?? payload?.lecture_writer,
  );
  const publishDate = parseOptionalDate(
    payload?.publishDate || payload?.lecture_publishDate || payload?.lecture_date,
  );
  const nextLocation = sanitizeStudyLocation(
    payload?.location ||
      payload?.lecture_location ||
      normalizedPreviousLecture?.location ||
      {},
  );
  const nextVolume = sanitizeStudyVolume(
    payload?.volume ||
      {
        total: payload?.lecture_volume_total,
        done: payload?.lecture_volume_done,
        remaining: payload?.lecture_volume_remaining,
      } ||
      normalizedPreviousLecture?.volume ||
      {},
  );
  const finishedPages = content
    .filter((page) => trimString(page?.status).toLowerCase() === "done")
    .map((page) => toPositiveInteger(page?.order, 0))
    .filter((pageNumber) => pageNumber > 0);

  return {
    ...(normalizedPreviousLecture?._id ? { _id: normalizedPreviousLecture._id } : {}),
    lectureOrder: toPositiveInteger(
      payload?.lecture_order ?? payload?.lectureOrder,
      normalizedPreviousLecture?.lectureOrder || 0,
    ) || null,
    title:
      trimString(payload?.lecture_name) ||
      trimString(normalizedPreviousLecture?.title) ||
      "-",
    instructors:
      instructors.length > 0
        ? instructors
        : normalizeStringArray(normalizedPreviousLecture?.instructors),
    editors:
      editors.length > 0
        ? editors
        : normalizeStringArray(normalizedPreviousLecture?.editors),
    writer:
      writers.length > 0
        ? writers
        : normalizeStringArray(normalizedPreviousLecture?.writer),
    publishDate: publishDate || normalizedPreviousLecture?.publishDate || null,
    location: nextLocation,
    volume: nextVolume,
    weight:
      normalizedPreviousLecture?.weight &&
      typeof normalizedPreviousLecture.weight === "object"
        ? normalizedPreviousLecture.weight
        : { value: 0 },
    progress: finishedPages.length,
    content,
  };
};

export const flattenMemoryCoursesForPlanner = (entries = []) =>
  (Array.isArray(entries) ? entries : []).flatMap((course) => {
    const normalizedCourse = toPlainObject(course) || {};
    const components = sortPlannerComponentsByOrder(
      Array.isArray(normalizedCourse?.components)
        ? normalizedCourse.components
        : [],
    );
    const courseStatus = derivePlannerCourseStatus(components);

    const buildFlattenedComponentEntry = (component = {}) => {
      const normalizedComponent = toPlainObject(component) || {};
      const componentTime =
        normalizedComponent?.time && typeof normalizedComponent.time === "object"
          ? normalizedComponent.time
          : {};
      const componentStats = getComponentPageStats(normalizedComponent);
      const exams = Array.isArray(normalizedComponent?.exams)
        ? normalizedComponent.exams.map((exam) => toPlainObject(exam) || {})
        : [];
      const primaryExam = exams[0] || {};
      const primaryExamTime = mapExamTimeForPlanner(primaryExam);
      const componentStatus = derivePlannerComponentStatus(normalizedComponent);

      return {
        _id: normalizedComponent?._id || normalizedCourse?._id,
        parentCourseId: normalizedCourse?._id || null,
        primaryComponentId: normalizedComponent?._id || "",
        order: toPositiveInteger(normalizedComponent?.order, 0),
        course_code: trimString(normalizedCourse?.code) || "",
        course_name: trimString(normalizedCourse?.name) || "-",
        course_status: courseStatus,
        course_weight:
          Number.isFinite(
            Number(normalizedCourse?.weight ?? normalizedCourse?.totalWeight),
          )
            ? String(normalizedCourse?.weight ?? normalizedCourse?.totalWeight)
            : "-",
        course_totalWeight:
          Number.isFinite(Number(normalizedCourse?.weight ?? normalizedCourse?.totalWeight))
            ? String(normalizedCourse?.weight ?? normalizedCourse?.totalWeight)
            : "-",
        component_status: componentStatus,
        course_component:
          trimString(normalizedComponent?.class) ||
          trimString(normalizedComponent?.name) ||
          "-",
        course_dayAndTime: Array.isArray(normalizedComponent?.schedule)
          ? normalizedComponent.schedule
          : [],
        course_location:
          normalizedComponent?.location && typeof normalizedComponent.location === "object"
            ? {
                building: trimString(normalizedComponent.location.building),
                room: trimString(normalizedComponent.location.room),
              }
            : {},
        normativeCourseYearNum:
          Number.isFinite(
            Number(
              normalizedComponent?.normativeCourseYearNum ??
                componentTime?.Normative?.courseYearNum,
            ),
          ) &&
          Number(
            normalizedComponent?.normativeCourseYearNum ??
              componentTime?.Normative?.courseYearNum,
          ) >= 0
            ? String(
                Math.trunc(
                  Number(
                    normalizedComponent?.normativeCourseYearNum ??
                      componentTime?.Normative?.courseYearNum,
                  ),
                ),
              )
            : "-",
        normativeCourseYearInterval:
          trimString(
            normalizedComponent?.normativeCourseYearInterval ||
              componentTime?.Normative?.courseYearInterval,
          ) || "-",
        normativeCourseTerm:
          trimString(
            normalizedComponent?.normativeCourseTerm ||
              componentTime?.Normative?.courseTerm,
          ) || "-",
        actualCourseYearNum:
          Number.isFinite(
            Number(
              normalizedComponent?.actualCourseYearNum ??
                componentTime?.actual?.courseYearNum,
            ),
          ) &&
          Number(
            normalizedComponent?.actualCourseYearNum ??
              componentTime?.actual?.courseYearNum,
          ) >= 0
            ? String(
                Math.trunc(
                  Number(
                    normalizedComponent?.actualCourseYearNum ??
                      componentTime?.actual?.courseYearNum,
                  ),
                ),
              )
            : "-",
        actualCourseYearInterval:
          trimString(
            normalizedComponent?.actualCourseYearInterval ||
              componentTime?.actual?.courseYearInterval,
          ) || "-",
        actualCourseTerm:
          trimString(
            normalizedComponent?.actualCourseTerm ||
              componentTime?.actual?.courseTerm,
          ) || "-",
        programYear:
          Number.isFinite(Number(componentTime?.programYear)) &&
          Number(componentTime.programYear) >= 0
            ? String(Math.trunc(Number(componentTime.programYear)))
            : "-",
        course_year: trimString(componentTime?.academicYear) || "-",
        course_term: trimString(componentTime?.term) || "-",
        course_class:
          trimString(normalizedComponent?.class) ||
          trimString(normalizedComponent?.name) ||
          "-",
        course_instructors: [],
        course_grade:
          String(
            normalizeComponentWeightNumber(normalizedComponent?.weight, 0) || "-",
          ),
        course_weightTotal:
          String(toFiniteNumber(normalizedComponent?.weight?.total, 100) || "100"),
        course_fullGrade:
          Number.isFinite(
            Number(primaryExam?.grade?.maxGrade ?? primaryExam?.grade?.max),
          )
            ? String(primaryExam?.grade?.maxGrade ?? primaryExam?.grade?.max)
            : "-",
        course_length: componentStats.totalPages,
        course_progress: componentStats.finishedPages,
        course_components: components.map((componentEntry) => {
          const normalizedComponentEntry = toPlainObject(componentEntry) || {};
          const componentEntryTime =
            normalizedComponentEntry?.time &&
            typeof normalizedComponentEntry.time === "object"
              ? normalizedComponentEntry.time
              : {};
          return {
            _id: normalizedComponentEntry?._id || null,
            course_class:
              trimString(normalizedComponentEntry?.class) ||
              trimString(normalizedComponentEntry?.name) ||
              "",
            component_status: derivePlannerComponentStatus(normalizedComponentEntry),
            normativeCourseYearNum:
              Number.isFinite(
                Number(
                  normalizedComponentEntry?.normativeCourseYearNum ??
                    componentEntryTime?.Normative?.courseYearNum,
                ),
              ) &&
              Number(
                normalizedComponentEntry?.normativeCourseYearNum ??
                  componentEntryTime?.Normative?.courseYearNum,
              ) >= 0
                ? String(
                    Math.trunc(
                      Number(
                        normalizedComponentEntry?.normativeCourseYearNum ??
                          componentEntryTime?.Normative?.courseYearNum,
                      ),
                    ),
                  )
                : "-",
            normativeCourseYearInterval:
              trimString(
                normalizedComponentEntry?.normativeCourseYearInterval ||
                  componentEntryTime?.Normative?.courseYearInterval,
              ) || "-",
            normativeCourseTerm:
              trimString(
                normalizedComponentEntry?.normativeCourseTerm ||
                  componentEntryTime?.Normative?.courseTerm,
              ) || "-",
            actualCourseYearNum:
              Number.isFinite(
                Number(
                  normalizedComponentEntry?.actualCourseYearNum ??
                    componentEntryTime?.actual?.courseYearNum,
                ),
              ) &&
              Number(
                normalizedComponentEntry?.actualCourseYearNum ??
                  componentEntryTime?.actual?.courseYearNum,
              ) >= 0
                ? String(
                    Math.trunc(
                      Number(
                        normalizedComponentEntry?.actualCourseYearNum ??
                          componentEntryTime?.actual?.courseYearNum,
                      ),
                    ),
                  )
                : "-",
            actualCourseYearInterval:
              trimString(
                normalizedComponentEntry?.actualCourseYearInterval ||
                  componentEntryTime?.actual?.courseYearInterval,
              ) || "-",
            actualCourseTerm:
              trimString(
                normalizedComponentEntry?.actualCourseTerm ||
                  componentEntryTime?.actual?.courseTerm,
              ) || "-",
            course_dayAndTime: Array.isArray(normalizedComponentEntry?.schedule)
              ? normalizedComponentEntry.schedule
              : [],
            course_grade: String(
              normalizeComponentWeightNumber(normalizedComponentEntry?.weight, 0),
            ),
            course_location:
              normalizedComponentEntry?.location &&
              typeof normalizedComponentEntry.location === "object"
                ? {
                    building: trimString(normalizedComponentEntry.location.building),
                    room: trimString(normalizedComponentEntry.location.room),
                  }
                : {},
            course_exams: Array.isArray(normalizedComponentEntry?.exams)
              ? normalizedComponentEntry.exams.map((examEntry) => {
                  const normalizedExamEntry = toPlainObject(examEntry) || {};
                  const plannerExamTime = mapExamTimeForPlanner(normalizedExamEntry);
                  return {
                    _id: normalizedExamEntry?._id || null,
                    componentId:
                      normalizeIdString(normalizedExamEntry?.componentId) || null,
                    type: trimString(normalizedExamEntry?.type) || "-",
                    exam_type: trimString(normalizedExamEntry?.type) || "-",
                    exam_date: plannerExamTime.exam_date,
                    exam_time: plannerExamTime.exam_time,
                    time:
                      normalizedExamEntry?.time &&
                      typeof normalizedExamEntry.time === "object"
                        ? toPlainObject(normalizedExamEntry.time)
                        : {},
                    location:
                      normalizedExamEntry?.location &&
                      typeof normalizedExamEntry.location === "object"
                        ? {
                            building: trimString(
                              normalizedExamEntry.location.building,
                            ),
                            room: trimString(normalizedExamEntry.location.room),
                          }
                        : {},
                    volume:
                      normalizedExamEntry?.volume &&
                      typeof normalizedExamEntry.volume === "object"
                        ? toPlainObject(normalizedExamEntry.volume)
                        : {},
                    passGrade:
                      normalizedExamEntry?.passGrade &&
                      typeof normalizedExamEntry.passGrade === "object"
                        ? toPlainObject(normalizedExamEntry.passGrade)
                        : {},
                    grade:
                      normalizedExamEntry?.grade &&
                      typeof normalizedExamEntry.grade === "object"
                        ? toPlainObject(normalizedExamEntry.grade)
                        : {},
                    course_fullGrade:
                      Number.isFinite(
                        Number(
                          normalizedExamEntry?.grade?.maxGrade ??
                            normalizedExamEntry?.grade?.max,
                        ),
                      )
                        ? String(
                            normalizedExamEntry?.grade?.maxGrade ??
                              normalizedExamEntry?.grade?.max,
                          )
                        : "-",
                    lectures: normalizeReferenceIds(normalizedExamEntry?.lectures),
                  };
                })
              : [],
          };
        }),
        course_exams: exams.map((exam) => {
          const plannerExamTime = mapExamTimeForPlanner(exam);

          return {
            _id: exam?._id || null,
            componentId: normalizeIdString(exam?.componentId) || null,
            type: trimString(exam?.type) || "-",
            exam_type: trimString(exam?.type) || "-",
            exam_date: plannerExamTime.exam_date,
            exam_time: plannerExamTime.exam_time,
            time:
              exam?.time && typeof exam.time === "object"
                ? toPlainObject(exam.time)
                : {},
            location:
              exam?.location && typeof exam.location === "object"
                ? {
                    building: trimString(exam.location.building),
                    room: trimString(exam.location.room),
                  }
                : {},
            volume:
              exam?.volume && typeof exam.volume === "object"
                ? toPlainObject(exam.volume)
                : {},
            passGrade:
              exam?.passGrade && typeof exam.passGrade === "object"
                ? toPlainObject(exam.passGrade)
                : {},
            grade:
              exam?.grade && typeof exam.grade === "object"
                ? toPlainObject(exam.grade)
                : {},
            course_fullGrade:
              Number.isFinite(
                Number(exam?.grade?.maxGrade ?? exam?.grade?.max),
              )
                ? String(exam?.grade?.maxGrade ?? exam?.grade?.max)
                : "-",
            lectures: normalizeReferenceIds(exam?.lectures),
          };
        }),
        exam_type: trimString(primaryExam?.type) || "-",
        exam_date: primaryExamTime.exam_date,
        exam_time: primaryExamTime.exam_time,
        course_partOfPlan: true,
      };
    };

    if (components.length === 0) {
      return [
        {
          _id: normalizedCourse?._id || null,
          parentCourseId: normalizedCourse?._id || null,
          primaryComponentId: "",
          course_code: trimString(normalizedCourse?.code) || "",
          course_name: trimString(normalizedCourse?.name) || "-",
          course_status: courseStatus,
          course_weight:
            Number.isFinite(
              Number(normalizedCourse?.weight ?? normalizedCourse?.totalWeight),
            )
              ? String(normalizedCourse?.weight ?? normalizedCourse?.totalWeight)
              : "-",
          course_totalWeight:
            Number.isFinite(Number(normalizedCourse?.weight ?? normalizedCourse?.totalWeight))
              ? String(normalizedCourse?.weight ?? normalizedCourse?.totalWeight)
              : "-",
          component_status: "-",
          course_component: "-",
          course_dayAndTime: [],
          course_location: {
            building: "",
            room: "",
          },
          programYear: "-",
          course_year: "-",
          course_term: "-",
          course_class: "-",
          course_instructors: [],
          course_grade: "-",
          course_weightTotal: "100",
          course_fullGrade: "-",
          course_length: 0,
          course_progress: 0,
          course_exams: [],
          exam_type: "-",
          exam_date: "-",
          exam_time: "-",
          course_partOfPlan: true,
          components: [],
        },
      ];
    }

    const componentEntries = components.map((component) =>
      buildFlattenedComponentEntry(component),
    );

    return componentEntries.map((entry) => ({
      ...entry,
      components: componentEntries.map((componentEntry) => ({
        ...componentEntry,
      })),
    }));
  });

export const flattenMemoryLecturesForPlanner = (entries = []) =>
  (Array.isArray(entries) ? entries : []).flatMap((course) => {
    const normalizedCourse = toPlainObject(course) || {};
    const components = Array.isArray(normalizedCourse?.components)
      ? normalizedCourse.components
      : [];

    return components.flatMap((component) => {
      const normalizedComponent = toPlainObject(component) || {};
      const lectures = Array.isArray(normalizedComponent?.lectures)
        ? normalizedComponent.lectures
        : [];
      const lectureCourseLabel = buildLectureCourseLabel(
        normalizedCourse?.name,
        normalizedComponent?.class || normalizedComponent?.name,
      );
      const primaryInstructor =
        normalizeStringArray(
          lectures.flatMap((lecture) => toPlainObject(lecture)?.instructors || []),
        )[0] || "-";

      return lectures.map((lecture) => {
        const normalizedLecture = toPlainObject(lecture) || {};
        const pages = Array.isArray(normalizedLecture?.content)
          ? normalizedLecture.content
          : Array.isArray(normalizedLecture?.pages)
            ? normalizedLecture.pages
          : [];
        const lectureInstructors = normalizeStringArray(
          normalizedLecture?.instructors,
        );
        const lectureWriters = normalizeStringArray(normalizedLecture?.writer);
        const lectureInstructorDisplay =
          lectureInstructors.join(" | ") || primaryInstructor;
        const lectureWriterDisplay = lectureWriters.join(" | ") || "-";
        const lecturePublishDate = normalizedLecture?.publishDate
          ? new Date(normalizedLecture.publishDate)
          : null;
        const finishedPagesFromStatus = pages
          .filter(
            (page) => trimString(toPlainObject(page)?.status).toLowerCase() === "done",
          )
          .map((page) => toPositiveInteger(toPlainObject(page)?.order, 0))
          .filter((pageNumber) => pageNumber > 0);
        const finishedPages =
          finishedPagesFromStatus.length > 0
            ? finishedPagesFromStatus
            : Array.from(
                {
                  length: Math.min(
                    toPositiveInteger(normalizedLecture?.progress, 0),
                    pages.length,
                  ),
                },
                (_, index) => index + 1,
              );
        const lecturePageStudyTimes = pages.reduce((result, page) => {
          const normalizedPage = toPlainObject(page) || {};
          const order = toPositiveInteger(normalizedPage?.order, 0);
          if (!order) {
            return result;
          }
          result[order] = Math.max(
            0,
            Number(normalizedPage?.plan?.studyTimePerPage || 0) || 0,
          );
          return result;
        }, {});

        return {
          _id: normalizedLecture?._id || null,
          lecture_order: toPositiveInteger(normalizedLecture?.lectureOrder, null),
          lecture_name: trimString(normalizedLecture?.title) || "-",
          lecture_course:
            lectureCourseLabel || trimString(normalizedCourse?.name) || "-",
          lecture_courseName: trimString(normalizedCourse?.name) || "-",
          lecture_component:
            trimString(normalizedComponent?.class || normalizedComponent?.name) || "-",
          lecture_componentClass:
            trimString(normalizedComponent?.class || normalizedComponent?.name) || "-",
          component_class:
            trimString(normalizedComponent?.class || normalizedComponent?.name) || "-",
          lecture_instructors: lectureInstructors,
          lecture_instructor: lectureInstructorDisplay,
          lecture_instructorName: lectureInstructorDisplay,
          lecture_writers: lectureWriters,
          lecture_writer: lectureWriterDisplay,
          lecture_writerName: lectureWriterDisplay,
          lecture_date:
            lecturePublishDate && !Number.isNaN(lecturePublishDate.getTime())
              ? lecturePublishDate.toISOString().slice(0, 10)
              : "",
          volume: sanitizeStudyVolume(normalizedLecture?.volume || {}),
          lecture_length: pages.length,
          lecture_progress: finishedPages.length,
          lecture_pagesFinished: finishedPages,
          lecture_pageStudyTimes: lecturePageStudyTimes,
          lecture_outlines: [],
          lecture_corrections: [],
          lecture_partOfPlan: true,
          lecture_hidden: false,
        };
      });
    });
  });

export const syncManualInstructors = (memoryDoc, instructorNames = []) => {
  void memoryDoc;
  void instructorNames;
};

export const addLectureToPlanner = (memoryDoc, payload = {}) => {
  const courses = getPlannerCourses(memoryDoc).map((course) => toPlainObject(course));
  const lectureCourseName = trimString(payload?.lecture_course);
  const targetComponentId = trimString(
    payload?.lecture_componentId || payload?.componentId,
  );
  const targetCourseId = trimString(payload?.lecture_courseId || payload?.courseId);

  let courseIndex = -1;
  let componentIndex = -1;

  if (targetComponentId) {
    const componentMatch = findCourseAndComponentById(courses, targetComponentId);
    courseIndex = componentMatch.courseIndex;
    componentIndex = componentMatch.componentIndex;
  } else if (targetCourseId) {
    const courseMatch = findCourseAndComponentById(courses, targetCourseId);
    if (courseMatch.courseIndex !== -1) {
      courseIndex = courseMatch.courseIndex;
      componentIndex =
        courseMatch.componentIndex !== -1
          ? courseMatch.componentIndex
          : 0;
    }
  }

  if (courseIndex === -1 || componentIndex === -1) {
    const labelMatch = findCourseComponentByLabel(courses, lectureCourseName);
    courseIndex = labelMatch.courseIndex;
    componentIndex = labelMatch.componentIndex;
  }

  if (courseIndex === -1 || componentIndex === -1) {
    return null;
  }

  const nextLecture = {
    _id: new Types.ObjectId(),
    ...buildManualLecturePayload(payload),
  };

  const nextCourses = courses.map((entry, index) => {
    if (index !== courseIndex) {
      return entry;
    }

    const normalizedCourse = toPlainObject(entry) || {};
    const nextComponents = (Array.isArray(normalizedCourse?.components)
      ? normalizedCourse.components
      : []
    ).map((componentEntry, currentComponentIndex) => {
      if (currentComponentIndex !== componentIndex) {
        return componentEntry;
      }

      const normalizedComponent = toPlainObject(componentEntry) || {};
      return {
        ...normalizedComponent,
        lectures: [
          ...(Array.isArray(normalizedComponent?.lectures)
            ? normalizedComponent.lectures.map((lecture) => toPlainObject(lecture))
            : []),
          nextLecture,
        ],
      };
    });

    return recalculateComponentAndCourseTotals({
      ...normalizedCourse,
      components: nextComponents,
    });
  });

  setPlannerCourses(memoryDoc, nextCourses);
  return nextLecture;
};

export const updateLectureInPlanner = (memoryDoc, lectureId = "", payload = {}) => {
  const courses = getPlannerCourses(memoryDoc).map((course) => toPlainObject(course));
  let updatedLecture = null;

  const nextCourses = courses.map((course) => {
    const normalizedCourse = toPlainObject(course) || {};
    const nextComponents = (Array.isArray(normalizedCourse?.components)
      ? normalizedCourse.components
      : []
    ).map((component) => {
      const normalizedComponent = toPlainObject(component) || {};
      const nextLectures = (Array.isArray(normalizedComponent?.lectures)
        ? normalizedComponent.lectures
        : []
      ).map((lecture) => {
        if (normalizeIdString(lecture?._id) !== String(lectureId || "")) {
          return lecture;
        }

        updatedLecture = {
          _id: lecture._id,
          ...buildManualLecturePayload(payload, toPlainObject(lecture) || {}),
        };
        return updatedLecture;
      });

      return {
        ...normalizedComponent,
        lectures: nextLectures,
      };
    });

    return recalculateComponentAndCourseTotals({
      ...normalizedCourse,
      components: nextComponents,
    });
  });

  setPlannerCourses(memoryDoc, nextCourses);
  return updatedLecture;
};

export const removeLectureFromPlanner = (memoryDoc, lectureId = "") => {
  const courses = getPlannerCourses(memoryDoc).map((course) => toPlainObject(course));
  const studyPlanAid = ensureStudyPlanAid(memoryDoc);

  const nextCourses = courses.map((course) => {
    const normalizedCourse = toPlainObject(course) || {};
    const nextComponents = (Array.isArray(normalizedCourse?.components)
      ? normalizedCourse.components
      : []
    ).map((component) => {
      const normalizedComponent = toPlainObject(component) || {};
      const nextLectures = (Array.isArray(normalizedComponent?.lectures)
        ? normalizedComponent.lectures
        : []
      ).filter((lecture) => normalizeIdString(lecture?._id) !== String(lectureId || ""));
      const nextExams = (Array.isArray(normalizedComponent?.exams)
        ? normalizedComponent.exams
        : []
      ).map((exam) => ({
        ...(toPlainObject(exam) || {}),
        lectures: normalizeReferenceIds(exam?.lectures).filter((linkedLectureId) =>
          linkedLectureId !== String(lectureId || ""),
        ),
      }));

      return {
        ...normalizedComponent,
        lectures: nextLectures,
        exams: nextExams,
      };
    });

    return recalculateComponentAndCourseTotals({
      ...normalizedCourse,
      components: nextComponents,
    });
  });

  setPlannerCourses(memoryDoc, nextCourses);
  removeLectureOverrideFromStudyPlanAid(studyPlanAid, lectureId);
};

export const removeCourseOrComponentFromPlanner = (memoryDoc, targetId = "") => {
  const courses = getPlannerCourses(memoryDoc).map((course) => toPlainObject(course));
  const studyPlanAid = ensureStudyPlanAid(memoryDoc);
  const removedLectureIds = new Set();

  const nextCourses = courses.reduce((result, course) => {
    const normalizedCourse = toPlainObject(course) || {};
    if (String(normalizedCourse?._id || "") === String(targetId || "")) {
      (Array.isArray(normalizedCourse?.components) ? normalizedCourse.components : []).forEach(
        (component) => {
          (Array.isArray(component?.lectures) ? component.lectures : []).forEach((lecture) => {
            const lectureId = normalizeIdString(lecture?._id);
            if (lectureId) {
              removedLectureIds.add(lectureId);
            }
          });
        },
      );
      return result;
    }

    const nextComponents = (Array.isArray(normalizedCourse?.components)
      ? normalizedCourse.components
      : []
    ).filter((component) => {
      const shouldKeep = String(component?._id || "") !== String(targetId || "");
      if (!shouldKeep) {
        (Array.isArray(component?.lectures) ? component.lectures : []).forEach((lecture) => {
          const lectureId = normalizeIdString(lecture?._id);
          if (lectureId) {
            removedLectureIds.add(lectureId);
          }
        });
      }
      return shouldKeep;
    });

    if (nextComponents.length === 0) {
      return result;
    }

    result.push(
      recalculateComponentAndCourseTotals({
        ...normalizedCourse,
        components: nextComponents,
      }),
    );
    return result;
  }, []);

  setPlannerCourses(memoryDoc, nextCourses);
  removeCourseOrComponentFromStudyPlanAid(studyPlanAid, targetId);
  removedLectureIds.forEach((lectureId) =>
    removeLectureOverrideFromStudyPlanAid(studyPlanAid, lectureId),
  );
};

export const updateCourseInPlanner = (memoryDoc, courseId = "", payload = {}) => {
  const courses = getPlannerCourses(memoryDoc).map((course) => toPlainObject(course));
  const match = findCourseAndComponentById(courses, courseId);

  if (match.courseIndex === -1) {
    return null;
  }

  const previousComponentId = normalizeIdString(match.component?._id);
  let updatedCourse = null;

  const nextCourses = courses.map((courseEntry, index) => {
    if (index !== match.courseIndex) {
      return courseEntry;
    }

    if (match.componentIndex === -1) {
      updatedCourse = recalculateComponentAndCourseTotals(
        buildCourseInfoPayload(payload, match.course),
      );
      return updatedCourse;
    }

    const normalizedCourse = toPlainObject(courseEntry) || {};
    const nextCourseInfo = buildCourseInfoPayload(payload, normalizedCourse);
    const nextComponent = buildComponentPayload(payload, match.component);
    const nextComponents = sortPlannerComponentsByOrder((Array.isArray(normalizedCourse?.components)
      ? normalizedCourse.components
      : []
    ).map((componentEntry, componentIndex) =>
      componentIndex === match.componentIndex ? nextComponent : componentEntry,
    ));

    updatedCourse = recalculateComponentAndCourseTotals({
      ...nextCourseInfo,
      components: nextComponents,
    });

    return updatedCourse;
  });

  setPlannerCourses(memoryDoc, nextCourses);
  void previousComponentId;
  return updatedCourse;
};

export const replaceCourseBundleInPlanner = (
  memoryDoc,
  courseId = "",
  payload = {},
) => {
  const courses = getPlannerCourses(memoryDoc).map((course) => toPlainObject(course));
  const match = findCourseAndComponentById(courses, courseId);

  if (match.courseIndex === -1) {
    return null;
  }

  const normalizedCourse = toPlainObject(match.course) || {};
  const previousComponents = Array.isArray(normalizedCourse?.components)
    ? normalizedCourse.components.map((component) => toPlainObject(component) || {})
    : [];
  const previousComponentById = new Map(
    previousComponents
      .map((component) => [normalizeIdString(component?._id), component])
      .filter(([componentId]) => Boolean(componentId)),
  );
  const requestedComponents = Array.isArray(payload?.components)
    ? payload.components
    : [];
  const nextComponents = sortPlannerComponentsByOrder(
    requestedComponents.map((componentEntry, componentIndex) => {
      const normalizedRequestedId = normalizeIdString(
        componentEntry?.course_componentId || componentEntry?._id,
      );
      const previousComponent =
        (normalizedRequestedId && previousComponentById.get(normalizedRequestedId)) ||
        previousComponents[componentIndex] ||
        {};

      return buildComponentPayload(componentEntry, previousComponent);
    }),
  );

  let updatedCourse = null;
  const nextCourses = courses.map((courseEntry, courseIndex) => {
    if (courseIndex !== match.courseIndex) {
      return courseEntry;
    }

    updatedCourse = recalculateComponentAndCourseTotals({
      ...buildCourseInfoPayload(payload, normalizedCourse),
      components: nextComponents,
    });
    return updatedCourse;
  });

  setPlannerCourses(memoryDoc, nextCourses);
  return updatedCourse;
};

export const updateCoursePagesInPlanner = (
  memoryDoc,
  courseName = "",
  { course_length, course_progress } = {},
) => {
  void course_length;
  void course_progress;
  const normalizedCourseName = trimString(courseName);
  const courses = getPlannerCourses(memoryDoc).map((course) => toPlainObject(course));

  const nextCourses = courses.map((course) => {
    const normalizedCourse = toPlainObject(course) || {};
    const nextComponents = (Array.isArray(normalizedCourse?.components)
      ? normalizedCourse.components
      : []
    ).map((component) => {
      const normalizedComponent = toPlainObject(component) || {};
      const lectureCourseLabel = buildLectureCourseLabel(
        normalizedCourse?.name,
        normalizedComponent?.name,
      );

      if (
        lectureCourseLabel !== normalizedCourseName &&
        trimString(normalizedCourse?.name) !== normalizedCourseName
      ) {
        return normalizedComponent;
      }

      return normalizedComponent;
    });

    return recalculateComponentAndCourseTotals({
      ...normalizedCourse,
      components: nextComponents,
    });
  });

  setPlannerCourses(memoryDoc, nextCourses);
};

export const updateStudyPlannerDocumentsInPlanner = (memoryDoc, payload = {}) => {
  const studyPlanner = getStudyPlannerRoot(memoryDoc);
  const normalizedPayload =
    payload && typeof payload === "object" ? toPlainObject(payload) || {} : {};
  const rawDocuments = Array.isArray(normalizedPayload?.programDocuments)
    ? normalizedPayload.programDocuments
    : studyPlanner.programDocuments || [];

  studyPlanner.programDocuments = rawDocuments
    .filter((entry) => entry && typeof entry === "object")
    .map((entry) => {
      const info = entry?.documentInfo && typeof entry.documentInfo === "object"
        ? entry.documentInfo
        : {};
      const normalizedDocumentVolume = resolveStoredDocumentVolumeNumber(
        info?.documentVolume,
      );
      const normalizedDocumentPages = buildStoredDocumentPages(
        info?.documentVolume,
        info?.documentPages,
      );
      return {
        documentInfo: {
          documentSymbol: trimString(info?.documentSymbol) || "DOC",
          documentNum: typeof info?.documentNum === "number" ? info.documentNum : null,
          documentID: sanitizeId(trimString(info?.documentID)),
          documentLectureID: trimString(info?.documentLectureID),
          documentLectureName: trimString(info?.documentLectureName),
          documentName: trimString(info?.documentName),
          documentType: trimString(info?.documentType),
          documentVolumeUnit: trimString(info?.documentVolumeUnit),
          documentVolume: normalizedDocumentVolume,
          documentPages: normalizedDocumentPages,
          documentEditors: Array.isArray(info?.documentEditors)
            ? info.documentEditors.map((e) => trimString(e)).filter(Boolean)
            : [],
        },
        documentURL: trimString(entry?.documentURL),
      };
    });

  syncPlannerDocumentLectureLinks(studyPlanner);

  if (typeof memoryDoc?.markModified === "function") {
    memoryDoc.markModified("studyPlanner");
    memoryDoc.markModified("studyPlanner.programDocuments");
    memoryDoc.markModified("studyPlanner.programLectures");
  }
  return studyPlanner;
};

export const updateStudyPlannerLecturesInPlanner = (memoryDoc, payload = {}) => {
  const studyPlanner = getStudyPlannerRoot(memoryDoc);
  const normalizedPayload =
    payload && typeof payload === "object" ? toPlainObject(payload) || {} : {};
  const rawLectures = Array.isArray(normalizedPayload?.programLectures)
    ? normalizedPayload.programLectures
    : studyPlanner.programLectures || [];

  studyPlanner.programLectures = rawLectures
    .filter((entry) => entry && typeof entry === "object")
    .map((entry) => {
      const info = entry?.lectureInfo && typeof entry.lectureInfo === "object"
        ? entry.lectureInfo
        : {};
      return {
        lectureInfo: {
          lectureSymbol: trimString(info?.lectureSymbol) || "LEC",
          lectureNum:
            typeof info?.lectureNum === "number" && Number.isFinite(info.lectureNum)
              ? info.lectureNum
              : null,
          lectureID: sanitizeId(trimString(info?.lectureID)),
          lectureName: trimString(info?.lectureName),
          lectureOrder:
            typeof info?.lectureOrder === "number" && Number.isFinite(info.lectureOrder)
              ? info.lectureOrder
              : null,
          lectureCourseName: trimString(info?.lectureCourseName),
          lectureComponentName: trimString(info?.lectureComponentName),
          lectureInstructors: Array.isArray(info?.lectureInstructors)
            ? info.lectureInstructors.map((value) => trimString(value)).filter(Boolean)
            : [],
          lectureInstructionDate: parseOptionalDate(info?.lectureInstructionDate || null),
        },
        lectureDocuments: Array.isArray(entry?.lectureDocuments)
          ? entry.lectureDocuments.map((value) => trimString(value)).filter(Boolean)
          : [],
      };
    });

  syncPlannerDocumentLectureLinks(studyPlanner);

  if (typeof memoryDoc?.markModified === "function") {
    memoryDoc.markModified("studyPlanner");
    memoryDoc.markModified("studyPlanner.programLectures");
    memoryDoc.markModified("studyPlanner.programDocuments");
  }
  return studyPlanner;
};

export const updateStudyPlannerStudySessionsInPlanner = (memoryDoc, payload = {}) => {
  const studyPlanner = getStudyPlannerRoot(memoryDoc);
  const normalizedPayload =
    payload && typeof payload === "object" ? toPlainObject(payload) || {} : {};
  const rawSessions = Array.isArray(normalizedPayload?.programStudySessions)
    ? normalizedPayload.programStudySessions
    : studyPlanner.programStudySessions || [];
  const programID = trimString(studyPlanner?.programID);

  studyPlanner.programStudySessions = rawSessions
    .filter((entry) => entry && typeof entry === "object")
    .map((entry, index) => {
      const achievements = Array.isArray(entry?.studySessionAchievements)
        ? entry.studySessionAchievements
        : Array.isArray(entry?.achievements)
          ? entry.achievements
        : [];
      const studySessionSymbol = trimString(entry?.studySessionSymbol) || "SS";
      const studySessionNum = toFiniteNumber(entry?.studySessionNum, null);
      const studySessionID =
        (() => {
          const explicitStudySessionID = trimString(entry?.studySessionID);
          return explicitStudySessionID && explicitStudySessionID !== "studySessionID"
            ? explicitStudySessionID
            : "";
        })() ||
        (programID && Number.isFinite(studySessionNum)
          ? `${programID}: ${studySessionSymbol}${studySessionNum}`
          : `studySession_${index + 1}`);
      const studySessionStartDate = parseOptionalDate(
        entry?.studySessionStartDate || entry?.startDate || entry?.start_date || null,
      );
      const studySessionEndDate = parseOptionalDate(
        entry?.studySessionEndDate || entry?.endDate || entry?.end_date || null,
      );
      return {
        studySessionID,
        studySessionSymbol,
        studySessionNum,
        studySessionStartDate,
        studySessionEndDate,
        studySessionAchievements: achievements
          .filter((achievementEntry) => achievementEntry && typeof achievementEntry === "object")
          .map((achievementEntry) => ({
            documentID: trimString(
              achievementEntry?.documentID || achievementEntry?.documentId || "",
            ),
            pagesDone: Array.from(
              new Set(
                (Array.isArray(achievementEntry?.pagesDone)
                  ? achievementEntry.pagesDone
                  : [])
                  .map((value) => Number(value))
                  .filter((value) => Number.isFinite(value) && value > 0),
              ),
            ).sort((left, right) => left - right),
          }))
          .filter((achievementEntry) => Boolean(achievementEntry.documentID)),
      };
    });

  if (typeof memoryDoc?.markModified === "function") {
    memoryDoc.markModified("studyPlanner");
    memoryDoc.markModified("studyPlanner.programStudySessions");
  }
  return studyPlanner;
};
