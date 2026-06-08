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
  const currentStudyPlanAid =
    currentPlanner?.studyPlanAid && typeof currentPlanner.studyPlanAid === "object"
      ? toPlainObject(currentPlanner.studyPlanAid)
      : memoryDoc?.studyPlanAid && typeof memoryDoc.studyPlanAid === "object"
        ? toPlainObject(memoryDoc.studyPlanAid)
        : {};
  const currentProgramComponents = Array.isArray(currentPlanner?.programComponents)
    ? normalizeProgramComponentsForPlanner(currentPlanner)
    : [];
  const currentProgramExamClasses =
    normalizeProgramExamClassesForPlanner(currentPlanner);
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

  const { _id: plannerId, ...plannerWithoutId } = currentPlanner || {};
  void plannerId;
  memoryDoc.studyPlanner = {
    ...plannerWithoutId,
    programExamClasses: currentProgramExamClasses,
    programExams: currentProgramExams,
    programFailingRules: currentProgramFailingRules,
    programComponents: currentProgramComponents,
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
const normalizeProgramComponentValue = (entry = null) => {
  if (typeof entry === "string" || typeof entry === "number" || typeof entry === "boolean") {
    return trimString(entry);
  }
  if (!entry || typeof entry !== "object") {
    return "";
  }
  const rawValue = entry?.componentId ?? entry?.label ?? "";
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

  if (!thresholdUnit && !thresholdMode && !Number.isFinite(thresholdNumber)) {
    return null;
  }

  return {
    thresholdMode: thresholdMode || null,
    thresholdUnit: thresholdUnit || null,
    thresholdNumber: Number.isFinite(thresholdNumber) ? thresholdNumber : null,
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
  const components = Array.isArray(normalizedPlanner?.programComponents)
    ? normalizedPlanner.programComponents
    : [];
  return components.map((entry) => normalizeProgramComponentValue(entry)).filter(Boolean);
};

export const normalizeProgramExamClassesForPlanner = (planner = {}) => {
  const normalizedPlanner =
    planner && typeof planner === "object" ? toPlainObject(planner) || {} : {};
  const examClasses = Array.isArray(normalizedPlanner?.programExamClasses)
    ? normalizedPlanner.programExamClasses
    : [];
  return examClasses
    .map((entry) => String(entry || "").trim())
    .filter(Boolean);
};

export const normalizeProgramExamsForPlanner = (planner = {}) => {
  const normalizedPlanner =
    planner && typeof planner === "object" ? toPlainObject(planner) || {} : {};
  const exams = Array.isArray(normalizedPlanner?.programExams)
    ? normalizedPlanner.programExams
    : [];
  return exams
    .map((entry) =>
      entry && typeof entry === "object" ? toPlainObject(entry) || {} : null,
    )
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
    settings: serializeStudyOrganizerSettingsForStorage(
      normalizeStudyOrganizerSettings(currentOrganizer?.settings),
    ),
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

const buildPlannerSubIntervalId = (entry = {}) => {
  const explicitSubIntervalId = trimString(
    entry?.subIntervalId || entry?.subintervalId,
  );
  if (explicitSubIntervalId) {
    return explicitSubIntervalId;
  }
  const year = inferIntervalYear(entry);
  const term = inferIntervalTerm(entry);
  if (!year || !term) {
    return "";
  }
  return `${year}${term}`;
};

const parsePlannerSubIntervalYearTerm = (subIntervalId = "") => {
  const normalizedDigits = trimString(subIntervalId).replace(/\D/g, "");
  if (normalizedDigits.length < 5) {
    return {
      year: "",
      term: "",
    };
  }
  return {
    year: normalizedDigits.slice(0, 4),
    term: normalizedDigits.slice(4, 5),
  };
};

const buildPlannerNextIntervalSubIntervals = (
  baseInterval = {},
  programTermsPerYear = 1,
  nextIntervalNum = null,
) => {
  const totalTerms = Math.max(
    1,
    toPositiveInteger(programTermsPerYear, 1),
  );
  const sourceSubIntervals = Array.isArray(baseInterval?.intervalsubIntervals)
    ? baseInterval.intervalsubIntervals
    : [];
  const lastSubInterval =
    sourceSubIntervals[sourceSubIntervals.length - 1] || {};
  const lastParsed = parsePlannerSubIntervalYearTerm(
    lastSubInterval?.subIntervalId ||
      lastSubInterval?.subintervalId ||
      "",
  );
  const baseYear =
    Number.parseInt(trimString(lastParsed?.year), 10) ||
    Number.parseInt(trimString(baseInterval?.intervalNum), 10) ||
    Number.parseInt(trimString(nextIntervalNum), 10) ||
    0;
  const generatedYear = baseYear > 0 ? baseYear + 1 : 1;

  return Array.from({ length: totalTerms }, (_, index) => ({
    subIntervalId: `${generatedYear}${index + 1}`,
    subIntervalCourses: [],
  }));
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
  const intervalIds = Array.from(
    new Set(
      (Array.isArray(intervals) ? intervals : [])
        .map((entry) => buildPlannerSubIntervalId(entry))
        .filter(Boolean),
    ),
  );
  studyPlanner.programIntervals = intervalIds.map((subIntervalId, index) => ({
    intervalId: String(index + 1),
    intervalNum: index + 1,
    intervalStatus: ["Normal"],
    intervalsubIntervals: [
      {
        subIntervalId,
        subIntervalCourses: [],
      },
    ],
  }));
};

const normalizePlannerIntervalCourseEntries = (intervalCourses = []) =>
  (Array.isArray(intervalCourses) ? intervalCourses : [])
    .map((courseEntry) => {
      const source =
        courseEntry && typeof courseEntry === "object"
          ? toPlainObject(courseEntry) || {}
          : {};
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
      return {
        courseName:
          trimString(source?.courseName) || trimString(source?.courseId),
        courseCode: trimString(source?.courseCode),
        courseComponentId: trimString(source?.courseComponentId),
        courseWeight: normalizedCourseWeight,
        courseComponents: (Array.isArray(source?.courseComponents)
          ? source.courseComponents
          : []
        ).map((componentEntry) => {
          const normalizedComponentEntry =
            componentEntry && typeof componentEntry === "object"
              ? toPlainObject(componentEntry) || {}
              : {};
          return {
            componentId: trimString(normalizedComponentEntry?.componentId),
            componentWeightPercentage:
              Number.isFinite(
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
                  : null,
            componentLectures: (Array.isArray(
              normalizedComponentEntry?.componentLectures,
            )
              ? normalizedComponentEntry.componentLectures
              : []
            )
              .map((lectureEntry) => {
                const normalizedLectureEntry =
                  lectureEntry && typeof lectureEntry === "object"
                    ? toPlainObject(lectureEntry) || {}
                    : {};
                const lectureName =
                  trimString(normalizedLectureEntry?.lectureName) ||
                  trimString(normalizedLectureEntry?.lectureId);
                if (!lectureName) {
                  return null;
                }
                return {
                  lectureName,
                  lectureInstructors: normalizeStringArray(
                    normalizedLectureEntry?.lectureInstructors,
                  ),
                  lectureEditors: normalizeStringArray(
                    normalizedLectureEntry?.lectureEditors,
                  ),
                  lectureGivenDate: parseOptionalDate(
                    normalizedLectureEntry?.lectureGivenDate,
                  ),
                  lectureEditedDate: parseOptionalDate(
                    normalizedLectureEntry?.lectureEditedDate,
                  ),
                  lectureLocation: sanitizeStudyLocation(
                    normalizedLectureEntry?.lectureLocation || {},
                  ),
                  lectureVolume: sanitizeStudyVolume(
                    normalizedLectureEntry?.lectureVolume || {},
                  ),
                  lecture_pagesFinished: normalizeLecturePagesFinished(
                    normalizedLectureEntry?.lecture_pagesFinished,
                  ),
                  lectureContent: Array.isArray(
                    normalizedLectureEntry?.lectureContent,
                  )
                    ? normalizedLectureEntry.lectureContent
                    : [],
                };
              })
              .filter(Boolean),
          };
        }),
      };
    })
    .filter((courseEntry) => Boolean(courseEntry.courseName));

const normalizePlannerIntervalEntries = (intervals = []) => {
  const flattenedEntries = (Array.isArray(intervals) ? intervals : []).flatMap(
    (entry) => {
      const baseEntry =
        entry && typeof entry === "object" ? toPlainObject(entry) || {} : {};
      const intervalId = trimString(baseEntry?.intervalId);
      const intervalStatus = normalizePlannerIntervalStatusValue(
        baseEntry?.intervalStatus,
      );
      const nestedSubIntervals = Array.isArray(baseEntry?.intervalsubIntervals)
        ? baseEntry.intervalsubIntervals
        : [];

      if (nestedSubIntervals.length > 0) {
        return nestedSubIntervals
          .map((subIntervalEntry) => {
            const normalizedSubIntervalEntry =
              subIntervalEntry && typeof subIntervalEntry === "object"
                ? toPlainObject(subIntervalEntry) || {}
                : {};
            const subIntervalId = buildPlannerSubIntervalId(
              normalizedSubIntervalEntry,
            );
            if (!subIntervalId) {
              return null;
            }
            return {
              intervalId: intervalId || subIntervalId,
              intervalNum:
                Number.parseInt(
                  trimString(normalizedSubIntervalEntry?.intervalNum),
                  10,
                ) || null,
              subIntervalId,
              intervalStatus,
              subIntervalDates: {
                start: parseOptionalDate(
                  normalizedSubIntervalEntry?.subIntervalDates?.start,
                ),
                end: parseOptionalDate(
                  normalizedSubIntervalEntry?.subIntervalDates?.end,
                ),
              },
              intervalCourses: normalizePlannerIntervalCourseEntries(
                normalizedSubIntervalEntry?.subIntervalCourses,
              ),
            };
          })
          .filter(Boolean);
      }

      const subIntervalId = buildPlannerSubIntervalId(baseEntry);
      if (!subIntervalId) {
        return [];
      }
      return [
        {
          intervalId:
            intervalId ||
            (typeof baseEntry?.regular === "boolean" && baseEntry.regular === false
              ? subIntervalId
              : subIntervalId),
          intervalNum:
            Number.parseInt(trimString(baseEntry?.intervalNum), 10) || null,
          subIntervalId,
          intervalStatus,
          subIntervalDates: {
            start: parseOptionalDate(baseEntry?.subIntervalDates?.start),
            end: parseOptionalDate(baseEntry?.subIntervalDates?.end),
          },
          intervalCourses: normalizePlannerIntervalCourseEntries(
            baseEntry?.intervalCourses,
          ),
        },
      ];
    },
  );

  const groupedIntervals = flattenedEntries.reduce((map, entry) => {
    const subIntervalId = trimString(entry?.subIntervalId);
    if (!subIntervalId) {
      return map;
    }
    const intervalId =
      trimString(entry?.intervalId) ||
      (typeof entry?.regular === "boolean" && entry.regular === false
        ? subIntervalId
        : subIntervalId);
    const storageIntervalId = intervalId || subIntervalId;
    const previousInterval = map.get(storageIntervalId) || {
      intervalId: storageIntervalId,
      intervalStatus: "Normal",
      intervalsubIntervals: [],
    };
    const nextSubIntervals = Array.from(
      new Map(
        [
          ...(Array.isArray(previousInterval.intervalsubIntervals)
            ? previousInterval.intervalsubIntervals
            : []),
          {
            subIntervalId,
            subIntervalDates: {
              start: parseOptionalDate(entry?.subIntervalDates?.start),
              end: parseOptionalDate(entry?.subIntervalDates?.end),
            },
            subIntervalCourses: normalizePlannerIntervalCourseEntries(
              entry?.intervalCourses,
            ),
          },
        ].map((subEntry) => [
          trimString(subEntry?.subIntervalId),
          {
            subIntervalId: trimString(subEntry?.subIntervalId),
            subIntervalDates: {
              start: parseOptionalDate(subEntry?.subIntervalDates?.start),
              end: parseOptionalDate(subEntry?.subIntervalDates?.end),
            },
            subIntervalCourses: normalizePlannerIntervalCourseEntries(
              subEntry?.subIntervalCourses,
            ),
          },
        ]),
      ).values(),
    ).filter((subEntry) => Boolean(subEntry?.subIntervalId));

    map.set(storageIntervalId, {
      intervalId: storageIntervalId,
      intervalNum:
        Number.parseInt(trimString(entry?.intervalNum), 10) ||
        Number.parseInt(storageIntervalId, 10) ||
        null,
      intervalStatus:
        normalizePlannerIntervalStatusValue(entry?.intervalStatus) ||
        previousInterval.intervalStatus ||
        "Normal",
      intervalsubIntervals: nextSubIntervals,
    });
    return map;
  }, new Map());

  return Array.from(groupedIntervals.values());
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
  const normalizedIntervals = normalizePlannerIntervalEntries(
    normalizedPayload?.intervals,
  );
  studyPlanner.programIntervals = normalizedIntervals.map((intervalEntry) => ({
    intervalId: String(intervalEntry?.intervalId || "").trim(),
    intervalNum:
      Number.parseInt(trimString(intervalEntry?.intervalNum), 10) ||
      Number.parseInt(String(intervalEntry?.intervalId || "").trim(), 10) ||
      null,
    intervalStatus: [
      normalizePlannerIntervalStatusValue(intervalEntry?.intervalStatus),
    ],
    intervalsubIntervals: (Array.isArray(intervalEntry?.intervalsubIntervals)
      ? intervalEntry.intervalsubIntervals
      : []
    ).map((subIntervalEntry) => ({
      subIntervalId: String(subIntervalEntry?.subIntervalId || "").trim(),
      courseComponentId: String(subIntervalEntry?.courseComponentId || "").trim(),
      subIntervalDates: {
        start: parseOptionalDate(subIntervalEntry?.subIntervalDates?.start),
        end: parseOptionalDate(subIntervalEntry?.subIntervalDates?.end),
      },
      subIntervalCourses: normalizePlannerIntervalCourseEntries(
        subIntervalEntry?.subIntervalCourses,
      ),
    })),
  }));

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
    normalizedPayload?.subIntervalId || normalizedPayload?.subintervalId,
  );
  const targetIntervalId = trimString(normalizedPayload?.intervalId);
  const requestedStatus = normalizePlannerIntervalStatusValue(
    normalizedPayload?.intervalStatus,
  );
  const requestedStatusLower = requestedStatus.toLowerCase();

  if (!targetSubIntervalId && !targetIntervalId) {
    throw new Error("SubInterval ID is required.");
  }
  const currentProgramIntervals = Array.isArray(studyPlanner?.programIntervals)
    ? studyPlanner.programIntervals
    : [];
  const nextProgramIntervals = currentProgramIntervals.map((intervalEntry) => {
    const baseInterval =
      intervalEntry && typeof intervalEntry === "object"
        ? toPlainObject(intervalEntry) || {}
        : {};
    const intervalId = trimString(baseInterval?.intervalId);
    const subIntervals = Array.isArray(baseInterval?.intervalsubIntervals)
      ? baseInterval.intervalsubIntervals.map((subIntervalEntry) =>
          subIntervalEntry && typeof subIntervalEntry === "object"
            ? toPlainObject(subIntervalEntry) || {}
            : {},
        )
      : [];
    const hasTargetSubInterval = subIntervals.some(
      (subIntervalEntry) =>
        trimString(subIntervalEntry?.subIntervalId) === targetSubIntervalId,
    );
    const isTargetInterval = targetSubIntervalId
      ? hasTargetSubInterval
      : intervalId === targetIntervalId;
    const currentStatus = normalizePlannerIntervalStatusValue(
      baseInterval?.intervalStatus,
    );
    return {
      ...baseInterval,
      intervalNum:
        Number.parseInt(trimString(baseInterval?.intervalNum), 10) ||
        Number.parseInt(intervalId, 10) ||
        null,
      intervalStatus: [
        isTargetInterval
          ? requestedStatus
          : currentStatus.toLowerCase() === "current"
            ? "Normal"
            : currentStatus || "Normal",
      ],
      intervalsubIntervals: subIntervals.map((subIntervalEntry) => ({
        ...subIntervalEntry,
        subIntervalCourses: normalizePlannerIntervalCourseEntries(
          subIntervalEntry?.subIntervalCourses,
        ),
      })),
    };
  });

  if (requestedStatusLower === "failed") {
    const targetIndex = currentProgramIntervals.findIndex((intervalEntry) => {
      const baseInterval =
        intervalEntry && typeof intervalEntry === "object"
          ? toPlainObject(intervalEntry) || {}
          : {};
      const intervalId = trimString(baseInterval?.intervalId);
      const subIntervals = Array.isArray(baseInterval?.intervalsubIntervals)
        ? baseInterval.intervalsubIntervals
        : [];
      const matchesSubInterval = subIntervals.some(
        (subIntervalEntry) =>
          trimString(subIntervalEntry?.subIntervalId) === targetSubIntervalId,
      );
      return targetSubIntervalId
        ? matchesSubInterval
        : intervalId === targetIntervalId;
    });

    if (targetIndex >= 0 && targetIndex + 1 < nextProgramIntervals.length) {
      const nextIntervalIndex = targetIndex + 1;
      nextProgramIntervals[nextIntervalIndex] = {
        ...nextProgramIntervals[nextIntervalIndex],
        intervalStatus: ["Makeup"],
      };

      const intervalNumbers = nextProgramIntervals
        .map((entry) => Number.parseInt(trimString(entry?.intervalNum), 10))
        .filter((value) => Number.isInteger(value));
      const maxIntervalNumber = intervalNumbers.length
        ? Math.max(...intervalNumbers)
        : nextProgramIntervals.length;
      const nextIntervalNumber = maxIntervalNumber + 1;
      const hasTrailingInterval = nextProgramIntervals.some(
        (entry) =>
          Number.parseInt(trimString(entry?.intervalNum), 10) ===
          nextIntervalNumber,
      );
      if (!hasTrailingInterval) {
        const baseInterval =
          nextProgramIntervals[nextProgramIntervals.length - 1] ||
          nextProgramIntervals[nextIntervalIndex] ||
          {};
        nextProgramIntervals.push({
          ...toPlainObject(baseInterval),
          intervalId: String(nextIntervalNumber),
          intervalNum: nextIntervalNumber,
          intervalStatus: ["Normal"],
          intervalsubIntervals: buildPlannerNextIntervalSubIntervals(
            baseInterval,
            studyPlanner?.programTermsPerYear,
            nextIntervalNumber,
          ),
        });
      }
    }
  }

  studyPlanner.programIntervals = nextProgramIntervals;

  return studyPlanner;
};

export const updateStudyPlannerProgramInPlanner = (memoryDoc, payload = {}) => {
  const studyPlanner = getStudyPlannerRoot(memoryDoc);
  const normalizedPayload =
    payload && typeof payload === "object" ? toPlainObject(payload) || {} : {};
  const programId = trimString(normalizedPayload?.programId);

  if (!programId) {
    throw new Error("Program ID is required.");
  }

  studyPlanner.programId = programId;
  if (!Array.isArray(studyPlanner.programComponents)) {
    studyPlanner.programComponents = [];
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
  const normalizedPayload =
    payload && typeof payload === "object" ? toPlainObject(payload) || {} : {};
  const nextProgramLanguage = trimString(normalizedPayload?.programLanguage);
  const nextProgramUniversity = trimString(normalizedPayload?.programUniversity);
  const nextProgramFaculty = trimString(normalizedPayload?.programFaculty);
  const hasProgramExamClasses = "programExamClasses" in normalizedPayload;
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
  const nextProgramExamClasses = hasProgramExamClasses
    ? normalizeProgramExamClassesForPlanner({
        programExamClasses: Array.isArray(normalizedPayload?.programExamClasses)
          ? normalizedPayload.programExamClasses
          : [],
      })
    : [];
  const hasProgramInstructors = "programInstructors" in normalizedPayload;
  const hasProgramEditors = "programEditors" in normalizedPayload;
  const hasProgramLocations = "programLocations" in normalizedPayload;
  const nextProgramInstructors = hasProgramInstructors
    ? normalizeStringArray(normalizedPayload?.programInstructors)
    : [];
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
    !nextProgramLanguage &&
    !nextProgramUniversity &&
    !nextProgramFaculty &&
    !hasProgramExamClasses &&
    !hasProgramStartYear &&
    !hasProgramTotalYears &&
    !hasProgramTermsPerYear &&
    !hasProgramPassingThresholdPerInterval &&
    !hasProgramFailingRules &&
    !hasProgramInstructors &&
    !hasProgramEditors &&
    !hasProgramLocations
  ) {
    throw new Error(
      "At least one studyPlanner meta field is required.",
    );
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
  if (hasProgramExamClasses) {
    studyPlanner.programExamClasses = nextProgramExamClasses;
  }
  if (hasProgramInstructors) {
    studyPlanner.programInstructors = nextProgramInstructors;
  }
  if (hasProgramEditors) {
    studyPlanner.programEditors = nextProgramEditors;
  }
  if (hasProgramLocations) {
    studyPlanner.programLocations = nextProgramLocations;
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
  if (!Array.isArray(studyPlanner.programComponents)) {
    studyPlanner.programComponents = [];
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

export const updateStudyPlannerComponentsInPlanner = (memoryDoc, payload = {}) => {
  const studyPlanner = getStudyPlannerRoot(memoryDoc);
  const normalizedPayload =
    payload && typeof payload === "object" ? toPlainObject(payload) || {} : {};
  const rawProgramComponents = Array.isArray(normalizedPayload?.programComponents)
    ? normalizedPayload.programComponents
    : [];
  const rawComponentIds = Array.isArray(normalizedPayload?.componentIds)
    ? normalizedPayload.componentIds
    : [];
  const componentSourceEntries =
    rawProgramComponents.length > 0 ? rawProgramComponents : rawComponentIds;
  const componentEntries = Array.from(
    new Set(
      componentSourceEntries
        .map((entry) => normalizeProgramComponentValue(entry))
        .filter(Boolean),
    ),
  );

  studyPlanner.programComponents = componentEntries;
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

