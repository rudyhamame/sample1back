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
  const currentProgramComponents = Array.isArray(currentPlanner?.programComponentClasses)
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
    programComponentClasses: currentProgramComponents,
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
  const components = Array.isArray(normalizedPlanner?.programComponentClasses)
    ? normalizedPlanner.programComponentClasses
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

const normalizeExamPart = (partEntry = {}) => {
  const entry =
    partEntry && typeof partEntry === "object" ? toPlainObject(partEntry) || {} : {};
  const componentID = trimString(
    entry?.componentID || entry?.componentId || entry?.courseID || entry?.courseId || "",
  );
  const examClass = trimString(entry?.examClass || "");
  if (!componentID || !examClass) return null;
  const examPartID = trimString(entry?.examPartID) || `${componentID}_exam_${examClass}`;
  return {
    examPartID,
    componentID,
    examClass,
    examLocation: sanitizeStudyLocation(entry?.examLocation || entry?.location || {}),
    examDate: parseOptionalDate(entry?.examDate || entry?.date || null),
    examTime: trimString(entry?.examTime || ""),
    examlectureIDs: normalizeReferenceIds(entry?.examlectureIDs || entry?.lectureIDs),
    examWeight: Number.isFinite(Number(entry?.examWeight)) ? Number(entry.examWeight) : null,
    examGrade: Number.isFinite(Number(entry?.examGrade)) ? Number(entry.examGrade) : null,
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
      const componentID = trimString(normalizedEntry?.componentID || "");
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
    const day = Number.isFinite(Number(value?.day)) ? Number(value.day) : null;
    const month = Number.isFinite(Number(value?.month)) ? Number(value.month) : null;
    const year = Number.isFinite(Number(value?.year)) ? Number(value.year) : null;
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

// ════════════════════════════════════════════════════════════════════════════
// ID BIBLE
// ────────────────────────────────────────────────────────────────────────────
// Every ID is pure concatenation — no separators except ": " after programID.
// No dashes, no underscores, no colons anywhere else.
//
// HIERARCHY
//   intervalID    = programID + ": " + INT{n}
//   intervalTryID = intervalID + IT{n}
//   subIntervalID = intervalTryID + sINT{n}
//   courseID      = subIntervalID + CRS{n}
//   componentID   = courseID + COMP{n}
//   lectureID     = componentID + L{n}
//   byteArrayID   = lectureID + B{n}
//   examID        = componentID + E{n}
//
// EXAMPLE  (programID = "P1")
//   intervalID    → "P1: INT1"
//   intervalTryID → "P1: INT1IT1"
//   subIntervalID → "P1: INT1IT1sINT2"
//   courseID      → "P1: INT1IT1sINT2CRS1"
//   componentID   → "P1: INT1IT1sINT2CRS1COMP1"
//   lectureID     → "P1: INT1IT1sINT2CRS1COMP1L1"
//   byteArrayID   → "P1: INT1IT1sINT2CRS1COMP1L1B1"
//   examID        → "P1: INT1IT1sINT2CRS1COMP1E1"
// ════════════════════════════════════════════════════════════════════════════
const buildIntervalTryID = (intervalID, tryNum, symbol = "IT") =>
  intervalID != null && tryNum != null ? `${intervalID}${symbol}${tryNum}` : "";
const buildNewSubIntervalID = (intervalTryID, subIntervalNum, symbol = "sINT") =>
  intervalTryID && subIntervalNum != null ? `${intervalTryID}${symbol}${subIntervalNum}` : "";
const buildNewCourseID = (subIntervalID, courseNum, courseSymbol = "CRS") =>
  subIntervalID && courseNum != null ? `${subIntervalID}${courseSymbol}${courseNum}` : "";
const buildNewComponentID = (courseID, componentNum, componentSymbol = "COMP") =>
  courseID && componentNum != null ? `${courseID}${componentSymbol}${componentNum}` : "";
const buildNewLectureID = (componentID, lectureNum) =>
  componentID && lectureNum != null ? `${componentID}L${lectureNum}` : "";
const buildNewByteArrayID = (lectureID, byteArrayNum) =>
  lectureID && byteArrayNum != null ? `${lectureID}B${byteArrayNum}` : "";
const buildNewExamID = (componentID, examNum) =>
  componentID && examNum != null ? `${componentID}E${examNum}` : "";

// Split a segment like "sINT3" → { symbol: "sINT", num: 3 }
const parseSymbolNum = (segment = "") => {
  const m = String(segment || "").trim().match(/^([A-Za-z]+)(\d+)$/);
  return m ? { symbol: m[1] || "", num: Number(m[2]) } : { symbol: "", num: null };
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
  const empty = { intervalNum: null, intervalSymbol: "", tryNum: null, intervalTrySymbol: "", subIntervalNum: null, subIntervalSymbol: "" };
  const m = s.match(/([A-Za-z]+)(\d+)([A-Za-z]+)(\d+)([A-Za-z]+)(\d+)$/);
  if (!m) return empty;
  return {
    intervalNum: Number(m[2]),
    intervalSymbol: m[1],
    tryNum: Number(m[4]),
    intervalTrySymbol: m[3],
    subIntervalNum: Number(m[6]),
    subIntervalSymbol: m[5],
  };
};

const buildPlannerSubIntervalId = (entry = {}) => {
  const explicitSubIntervalId = trimString(
    entry?.subIntervalID || entry?.subIntervalId,
  );
  if (explicitSubIntervalId) return explicitSubIntervalId;
  const intervalID = trimString(entry?.intervalID || entry?.intervalId || entry?.intervalNum);
  const tryNum = entry?.intervalTryNum;
  const subIntervalNum = trimString(entry?.subIntervalNum || entry?.subintervalNum || entry?.term);
  if (intervalID && subIntervalNum) {
    return buildNewSubIntervalID(buildIntervalTryID(intervalID, tryNum), subIntervalNum);
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

const assertStructuredSubIntervalID = (
  subIntervalID = "",
  intervalTryID = "",
  subIntervalNum = null,
  subIntervalSymbol = "sINT",
) => {
  const normalizedSubIntervalID = trimString(subIntervalID);
  const normalizedTryID = trimString(intervalTryID);
  const normalizedSubNum = Number.parseInt(String(subIntervalNum ?? ""), 10);
  const normalizedSubSymbol = trimString(subIntervalSymbol) || "sINT";
  const expectedSubIntervalID =
    Number.isInteger(normalizedSubNum) && normalizedSubNum > 0
      ? buildNewSubIntervalID(normalizedTryID, normalizedSubNum, normalizedSubSymbol)
      : "";
  if (!normalizedSubIntervalID || !normalizedTryID || !expectedSubIntervalID) {
    throw new Error("Invalid subInterval ID chain.");
  }
  if (normalizedSubIntervalID !== expectedSubIntervalID) {
    throw new Error(
      `Invalid subInterval ID. Expected ${expectedSubIntervalID} but received ${normalizedSubIntervalID}.`,
    );
  }
};

const assertStructuredIntervalPayload = (entry = {}) => {
  const base = entry && typeof entry === "object" ? toPlainObject(entry) || {} : {};
  const intervalID = trimString(base?.intervalID || base?.intervalId);
  if (!intervalID) {
    throw new Error("intervalID is required.");
  }
  const parsedIntervalID = parseStructuredIntervalID(intervalID);
  const intervalNum = Number.parseInt(trimString(base?.intervalNum), 10);
  const intervalSymbol = trimString(base?.intervalSymbol) || parsedIntervalID.symbol;
  if (!Number.isInteger(intervalNum) || intervalNum < 1) {
    throw new Error(`Invalid intervalNum for ${intervalID}.`);
  }
  if (!parsedIntervalID.symbol || parsedIntervalID.num !== intervalNum) {
    throw new Error(`intervalID must end with ${intervalSymbol}${intervalNum}.`);
  }
  if (intervalSymbol !== parsedIntervalID.symbol) {
    throw new Error(`intervalSymbol mismatch for ${intervalID}.`);
  }
  const intervalTries = Array.isArray(base?.intervalTry) ? base.intervalTry : [];
  if (intervalTries.length < 1) {
    throw new Error(`intervalTry is required for ${intervalID}.`);
  }
  intervalTries.forEach((tryEntry) => {
    const tryBase = tryEntry && typeof tryEntry === "object" ? toPlainObject(tryEntry) || {} : {};
    const tryNum = Number.parseInt(trimString(tryBase?.intervalTryNum), 10);
    const trySymbol = trimString(tryBase?.intervalTrySymbol) || "IT";
    const intervalTryID = trimString(tryBase?.intervalTryID);
    const expectedTryID =
      Number.isInteger(tryNum) && tryNum > 0
        ? buildIntervalTryID(intervalID, tryNum, trySymbol)
        : "";
    if (!intervalTryID || !expectedTryID) {
      throw new Error(`Invalid intervalTryID for ${intervalID}.`);
    }
    if (intervalTryID !== expectedTryID) {
      throw new Error(
        `Invalid intervalTryID. Expected ${expectedTryID} but received ${intervalTryID}.`,
      );
    }
    const subIntervals = Array.isArray(tryBase?.intervalTrysubIntervals)
      ? tryBase.intervalTrysubIntervals
      : [];
    if (subIntervals.length < 1) {
      throw new Error(`intervalTrysubIntervals is required for ${intervalTryID}.`);
    }
    subIntervals.forEach((subEntry) => {
      const subBase =
        subEntry && typeof subEntry === "object" ? toPlainObject(subEntry) || {} : {};
      const subIntervalID = trimString(subBase?.subIntervalID || subBase?.subIntervalId);
      const subIntervalNum = Number.parseInt(trimString(subBase?.subIntervalNum), 10);
      const subIntervalSymbol = trimString(subBase?.subIntervalSymbol) || "sINT";
      assertStructuredSubIntervalID(
        subIntervalID,
        intervalTryID,
        subIntervalNum,
        subIntervalSymbol,
      );
    });
  });
};

const buildPlannerNextIntervalSubIntervals = (
  baseInterval = {},
  programTermsPerYear = 1,
  nextIntervalNum = null,
) => {
  const totalTerms = Math.max(1, toPositiveInteger(programTermsPerYear, 1));
  const targetIntervalID = trimString(baseInterval?.intervalID || baseInterval?.intervalId);
  const tryNum = Number.parseInt(trimString(baseInterval?.intervalTryNum), 10);
  const intervalTryID = buildIntervalTryID(targetIntervalID, tryNum);
  return [{
    intervalTryID,
    intervalTryNum: tryNum,
    intervalTrysubIntervals: Array.from({ length: totalTerms }, (_, index) => ({
      subIntervalID: buildNewSubIntervalID(intervalTryID, index + 1),
      subIntervalNum: index + 1,
      subIntervalCurrent: false,
      subIntervalTryDates: { start: { day: null, month: null, year: null, date: null }, end: { day: null, month: null, year: null, date: null } },
      subIntervalCourses: [],
    })),
  }];
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
    const tryID = buildIntervalTryID(intervalID, 1);
    return {
      intervalID,
      intervalNum,
      intervalSymbol,
      intervalStatus: ["Normal"],
      intervalTry: [{
        intervalTryID: tryID,
        intervalTryNum: 1,
        intervalTrysubIntervals: [{
          subIntervalID: subIntervalId || buildNewSubIntervalID(tryID, 1),
          subIntervalNum: 1,
          subIntervalCurrent: false,
          subIntervalTryDates: { start: { day: null, month: null, year: null, date: null }, end: { day: null, month: null, year: null, date: null } },
          subIntervalCourses: [],
        }],
      }],
    };
  });
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
        courseNum: Number.isFinite(Number.parseInt(source?.courseNum, 10))
          ? Number.parseInt(source.courseNum, 10)
          : Number.isInteger(parsedCourseIDNum)
            ? parsedCourseIDNum
            : null,
        courseID: normalizedCourseID,
        courseName:
          trimString(source?.courseName) || trimString(source?.courseId),
        courseCode: trimString(source?.courseCode),
        courseComponentName: trimString(
          source?.courseComponentName || source?.courseComponentId,
        ),
        courseWeight: normalizedCourseWeight,
        courseComponents: (Array.isArray(source?.courseComponents)
          ? source.courseComponents
          : []
        ).map((componentEntry) => {
          const normalizedComponentEntry =
            componentEntry && typeof componentEntry === "object"
              ? toPlainObject(componentEntry) || {}
              : {};
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
          const componentClass = trimString(
            normalizedComponentEntry?.componentClass ||
              normalizedComponentEntry?.componentName ||
              normalizedComponentEntry?.componentId,
          );
          const componentNum = Number.isFinite(
            Number.parseInt(normalizedComponentEntry?.componentNum, 10),
          )
            ? Number.parseInt(normalizedComponentEntry.componentNum, 10)
            : null;
          const componentSymbol = trimString(normalizedComponentEntry?.componentSymbol) || "COMP";
          const componentID =
            trimString(normalizedComponentEntry?.componentID) ||
            buildNewComponentID(normalizedCourseID, componentNum, componentSymbol) ||
            (normalizedCourseID && componentClass ? `${normalizedCourseID}_${componentClass}` : "");
          return {
            componentID,
            componentNum,
            componentClass,
            componentWeight: computedComponentWeight,
            componentLocation: sanitizeStudyLocation(
              normalizedComponentEntry?.componentLocation ||
                normalizedComponentEntry?.location ||
                {},
            ),
            componentExams: (Array.isArray(normalizedComponentEntry?.componentExams)
              ? normalizedComponentEntry.componentExams
              : []
            ).map((examEntry) => {
              const exam = examEntry && typeof examEntry === "object" ? toPlainObject(examEntry) || {} : {};
              const examNum = Number.isFinite(Number.parseInt(exam?.examNum, 10))
                ? Number.parseInt(exam.examNum, 10)
                : null;
              const examSymbol = trimString(exam?.examSymbol) || "EXM";
              const examID = trimString(exam?.examID) ||
                (componentID && examNum != null ? buildNewExamID(componentID, examNum) : "");
              return {
                examSymbol,
                examNum,
                examID,
                examLocation: sanitizeStudyLocation(exam?.examLocation || {}),
                examDate: parseOptionalDate(exam?.examDate || null),
                examTime: trimString(exam?.examTime) || "",
                examWeight: Number.isFinite(Number(exam?.examWeight)) ? Number(exam.examWeight) : null,
                examGrade: Number.isFinite(Number(exam?.examGrade)) ? Number(exam.examGrade) : null,
                examsLectures: Array.isArray(exam?.examsLectures) ? exam.examsLectures.map((lec) => {
                  const l = lec && typeof lec === "object" ? toPlainObject(lec) || {} : {};
                  return {
                    lectureSymbol: trimString(l?.lectureSymbol) || "LEC",
                    lectureNum: Number.isFinite(Number.parseInt(l?.lectureNum, 10)) ? Number.parseInt(l.lectureNum, 10) : null,
                    lectureID: trimString(l?.lectureID) || "",
                    lectureName: trimString(l?.lectureName) || "",
                    lectureInstructors: normalizeStringArray(l?.lectureInstructors),
                    lectureInstructionDate: parseOptionalDate(l?.lectureInstructionDate || null),
                    lectureDocuments: Array.isArray(l?.lectureDocuments) ? l.lectureDocuments : [],
                  };
                }).filter((l) => Boolean(l.lectureName || l.lectureID)) : [],
              };
            }).filter((exam) => Boolean(exam.examID || exam.examNum != null)),
          };
        }),
      };
    })
    .filter((courseEntry) => Boolean(courseEntry.courseName));

// Flatten one programInterval entry into strict sub-interval records.
const flattenProgramIntervalEntry = (entry) => {
  const base = entry && typeof entry === "object" ? toPlainObject(entry) || {} : {};
  const hasStructuredTries = Array.isArray(base?.intervalTry) && base.intervalTry.length > 0;
  if (hasStructuredTries) {
    assertStructuredIntervalPayload(base);
  }
  const rawIntervalRef = trimString(base?.intervalID || base?.intervalId || base?.intervalNum);
  const resolvedIntervalID = rawIntervalRef;
  const directNum = Number.parseInt(rawIntervalRef, 10);
  const intervalIDNum = Number.isFinite(directNum)
    ? directNum
    : parseStructuredIntervalID(rawIntervalRef).num ?? null;
  const intervalStatus = normalizePlannerIntervalStatusValue(base?.intervalStatus);

  const intervalSymbol = trimString(base?.intervalSymbol) || "INT";
  // ── New structure: intervalTry[].intervalTrysubIntervals ──────────────────
  const intervalTries = Array.isArray(base?.intervalTry) ? base.intervalTry : [];
  if (intervalTries.length > 0) {
    return intervalTries.flatMap((tryEntry) => {
      const tryBase = tryEntry && typeof tryEntry === "object" ? toPlainObject(tryEntry) || {} : {};
      const tryNum = Number.parseInt(trimString(tryBase?.intervalTryNum), 10) || 1;
      const intervalTrySymbol = trimString(tryBase?.intervalTrySymbol) || "IT";
      const intervalTryID =
        trimString(tryBase?.intervalTryID) || buildIntervalTryID(resolvedIntervalID, tryNum, intervalTrySymbol);
      return (Array.isArray(tryBase?.intervalTrysubIntervals) ? tryBase.intervalTrysubIntervals : [])
        .map((subEntry) => {
          const sub = subEntry && typeof subEntry === "object" ? toPlainObject(subEntry) || {} : {};
          const subIntervalID = trimString(sub?.subIntervalID || sub?.subIntervalId);
          if (!subIntervalID) return null;
          const subIntervalSymbol = trimString(sub?.subIntervalSymbol) || "sINT";
          const parsed = parseStructuredSubIntervalID(subIntervalID);
          return {
            intervalIDNum,
            intervalSymbol,
            intervalTryID,
            intervalTryNum: tryNum,
            intervalTrySymbol,
            subIntervalID,
            subIntervalNum: Number.parseInt(trimString(sub?.subIntervalNum), 10) || parsed.subIntervalNum || null,
            subIntervalSymbol,
            subIntervalCurrent: Boolean(sub?.subIntervalCurrent),
            intervalStatus,
            subIntervalTryDates: {
              start: parseDateToComponents(sub?.subIntervalTryDates?.start ?? sub?.subIntervalDates?.start),
              end: parseDateToComponents(sub?.subIntervalTryDates?.end ?? sub?.subIntervalDates?.end),
            },
            intervalCourses: normalizePlannerIntervalCourseEntries(sub?.subIntervalCourses),
          };
        })
        .filter(Boolean);
    });
  }

  // ── Flat UI row entry (current client submit shape) ───────────────────────
  const subIntervalID = trimString(
    base?.subIntervalID || base?.subIntervalId,
  );
  if (!subIntervalID) return [];
  const tryNum = Number.parseInt(trimString(base?.intervalTryNum), 10) || 1;
  const trySymbol = trimString(base?.intervalTrySymbol) || "IT";
  const intervalTryID =
    trimString(base?.intervalTryID) || buildIntervalTryID(resolvedIntervalID, tryNum, trySymbol);
  const parsed = parseStructuredSubIntervalID(subIntervalID);
  assertStructuredSubIntervalID(
    subIntervalID,
    intervalTryID,
    Number.parseInt(trimString(base?.subIntervalNum), 10) || parsed.subIntervalNum || null,
    trimString(base?.subIntervalSymbol) || parsed.subIntervalSymbol || "sINT",
  );
  return [{
    intervalIDNum,
    intervalSymbol,
    intervalTryID,
    intervalTryNum: tryNum,
    intervalTrySymbol: trySymbol,
    subIntervalID,
    subIntervalNum: Number.parseInt(trimString(base?.subIntervalNum), 10) || parsed.subIntervalNum || null,
    subIntervalSymbol: trimString(base?.subIntervalSymbol) || parsed.subIntervalSymbol || "sINT",
    subIntervalCurrent: Boolean(base?.subIntervalCurrent),
    intervalStatus,
    subIntervalTryDates: {
      start: parseDateToComponents(base?.subIntervalTryDates?.start ?? base?.subIntervalDates?.start),
      end: parseDateToComponents(base?.subIntervalTryDates?.end ?? base?.subIntervalDates?.end),
    },
    intervalCourses: normalizePlannerIntervalCourseEntries(base?.intervalCourses || base?.subIntervalCourses),
  }];
};

const buildIntervalID = (programID, intervalSymbol, intervalIDNum) => {
  const sym = trimString(intervalSymbol) || "INT";
  const num = intervalIDNum != null ? String(intervalIDNum) : "";
  const symNum = `${sym}${num}`;
  const pid = trimString(programID);
  return pid ? `${pid}: ${symNum}` : symNum;
};

// Reassemble flat sub-interval records → programIntervals[].intervalTry[].intervalTrysubIntervals[]
const assembleProgramIntervals = (flatEntries, programID = "") => {
  // Group: intervalIDNum → Map(intervalTryID → Map(subIntervalID → subEntry))
  const intervalMap = new Map();
  for (const entry of flatEntries) {
    const iKey = String(entry.intervalIDNum ?? "");
    const tKey = entry.intervalTryID || "";
    const sKey = entry.subIntervalID || "";
    if (!sKey) continue;
    if (!intervalMap.has(iKey)) {
      intervalMap.set(iKey, {
        intervalIDNum: entry.intervalIDNum,
        intervalSymbol: entry.intervalSymbol || "INT",
        intervalStatus: entry.intervalStatus,
        tries: new Map(),
      });
    }
    const iEntry = intervalMap.get(iKey);
    if (entry.intervalStatus && entry.intervalStatus !== "Normal") iEntry.intervalStatus = entry.intervalStatus;
    if (!iEntry.tries.has(tKey)) {
      iEntry.tries.set(tKey, { intervalTryID: tKey, intervalTryNum: entry.intervalTryNum, subIntervals: new Map() });
    }
    const tEntry = iEntry.tries.get(tKey);
    tEntry.subIntervals.set(sKey, {
      subIntervalID: sKey,
      subIntervalNum: entry.subIntervalNum != null ? String(entry.subIntervalNum) : "",
      subIntervalCurrent: Boolean(entry.subIntervalCurrent),
      subIntervalTryDates: {
        start: parseDateToComponents(entry.subIntervalTryDates?.start ?? entry.subIntervalDates?.start),
        end: parseDateToComponents(entry.subIntervalTryDates?.end ?? entry.subIntervalDates?.end),
      },
      subIntervalCourses: normalizePlannerIntervalCourseEntries(entry.intervalCourses),
    });
  }
  return Array.from(intervalMap.values()).map((iEntry) => ({
    intervalID: buildIntervalID(programID, iEntry.intervalSymbol, iEntry.intervalIDNum),
    intervalNum: iEntry.intervalIDNum,
    intervalSymbol: iEntry.intervalSymbol,
    intervalStatus: [normalizePlannerIntervalStatusValue(iEntry.intervalStatus)],
    intervalTry: Array.from(iEntry.tries.values()).map((tEntry) => ({
      intervalTryID: tEntry.intervalTryID,
      intervalTryNum: tEntry.intervalTryNum,
      intervalTrysubIntervals: Array.from(tEntry.subIntervals.values()),
    })),
  }));
};

const syncProgramCurrentIntervalTrySelection = (
  programIntervals = [],
  programCurrentIntervalTryNum = null,
  explicitSubIntervalID = "",
) => {
  const sourceIntervals = Array.isArray(programIntervals) ? programIntervals : [];
  const currentMeta =
    programCurrentIntervalTryNum &&
    typeof programCurrentIntervalTryNum === "object"
      ? toPlainObject(programCurrentIntervalTryNum) || {}
      : null;
  const normalizedExplicitSubIntervalID = trimString(explicitSubIntervalID);
  const selectedIntervalNum = toFiniteNumber(currentMeta?.intervalNum, null);
  const selectedTryNum = toFiniteNumber(currentMeta?.intervalTryNum, null);
  const selectedSubIntervalNum = toFiniteNumber(currentMeta?.subIntervalNum, null);
  const hasSelection =
    Number.isFinite(selectedIntervalNum) && Number.isFinite(selectedTryNum);

  return sourceIntervals.map((intervalEntry) => {
    const base =
      intervalEntry && typeof intervalEntry === "object"
        ? toPlainObject(intervalEntry) || {}
        : {};
    const intervalNum = toFiniteNumber(base?.intervalNum, null);
    const mappedTries = (Array.isArray(base?.intervalTry) ? base.intervalTry : []).map(
      (tryEntry) => {
        const tryBase =
          tryEntry && typeof tryEntry === "object"
            ? toPlainObject(tryEntry) || {}
            : {};
        const tryNum = toFiniteNumber(tryBase?.intervalTryNum, null);
        const isSelectedTry =
          hasSelection &&
          intervalNum === selectedIntervalNum &&
          tryNum === selectedTryNum;
        const subIntervals = Array.isArray(tryBase?.intervalTrysubIntervals)
          ? [...tryBase.intervalTrysubIntervals]
          : [];
        const activeSubIndex = isSelectedTry
          ? normalizedExplicitSubIntervalID
            ? subIntervals.findIndex((subEntry) => {
                const subBase =
                  subEntry && typeof subEntry === "object"
                    ? toPlainObject(subEntry) || {}
                    : {};
                return (
                  trimString(subBase?.subIntervalID || subBase?.subIntervalId) ===
                  normalizedExplicitSubIntervalID
                );
              })
            : Number.isFinite(selectedSubIntervalNum)
              ? subIntervals.findIndex((subEntry) => {
                  const subBase =
                    subEntry && typeof subEntry === "object"
                      ? toPlainObject(subEntry) || {}
                      : {};
                  return toFiniteNumber(subBase?.subIntervalNum, null) === selectedSubIntervalNum;
                })
            : subIntervals.reduce((bestIndex, subEntry, index) => {
                const subBase =
                  subEntry && typeof subEntry === "object"
                    ? toPlainObject(subEntry) || {}
                    : {};
                const subNum = Number.parseInt(trimString(subBase?.subIntervalNum), 10);
                if (!Number.isFinite(subNum) || subNum <= 0) {
                  return bestIndex;
                }
                if (bestIndex === -1) {
                  return index;
                }
                const bestBase =
                  subIntervals[bestIndex] && typeof subIntervals[bestIndex] === "object"
                    ? toPlainObject(subIntervals[bestIndex]) || {}
                    : {};
                const bestNum = Number.parseInt(trimString(bestBase?.subIntervalNum), 10);
                return !Number.isFinite(bestNum) || subNum < bestNum ? index : bestIndex;
              }, -1)
          : -1;

        return {
          ...tryBase,
          intervalTrysubIntervals: subIntervals.map((subEntry, index) => {
            const subBase =
              subEntry && typeof subEntry === "object"
                ? toPlainObject(subEntry) || {}
                : {};
            return {
              ...subBase,
              subIntervalCurrent: isSelectedTry ? index === activeSubIndex : false,
            };
          }),
        };
      },
    );
    return {
      ...base,
      intervalTry: mappedTries,
    };
  });
};

const normalizePlannerIntervalEntries = (intervals = [], programID = "") => {
  const sourceIntervals = Array.isArray(intervals) ? intervals : [];
  sourceIntervals.forEach((entry) => {
    const base = entry && typeof entry === "object" ? toPlainObject(entry) || {} : {};
    if (Array.isArray(base?.intervalsubIntervals)) {
      throw new Error("Legacy intervalsubIntervals is not supported.");
    }
    const rawSubIntervalID = trimString(base?.subIntervalID || base?.subIntervalId);
    if (rawSubIntervalID && rawSubIntervalID.includes("_")) {
      throw new Error(`Legacy subIntervalID is not supported: ${rawSubIntervalID}`);
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
  const isCancelRetaking = rawStatus.toLowerCase() === "cancelretaking";
  const requestedStatus = isCancelRetaking ? "Failed" : rawStatus;
  const requestedStatusLower = requestedStatus.toLowerCase();

  if (!targetSubIntervalId) {
    throw new Error("SubInterval ID is required.");
  }

  const intervalHasTarget = (intervalEntry) => {
    const base = intervalEntry && typeof intervalEntry === "object" ? toPlainObject(intervalEntry) || {} : {};
    return (Array.isArray(base?.intervalTry) ? base.intervalTry : []).some((tryEntry) =>
      (Array.isArray(tryEntry?.intervalTrysubIntervals) ? tryEntry.intervalTrysubIntervals : [])
        .some((sub) => trimString(sub?.subIntervalID || sub?.subIntervalId) === targetSubIntervalId),
    );
  };

  const currentProgramIntervals = Array.isArray(studyPlanner?.programIntervals)
    ? studyPlanner.programIntervals
    : [];

  const nextProgramIntervals = currentProgramIntervals.map((intervalEntry) => {
    const base = intervalEntry && typeof intervalEntry === "object" ? toPlainObject(intervalEntry) || {} : {};
    const isTargetInterval = intervalHasTarget(base);
    const currentStatus = normalizePlannerIntervalStatusValue(base?.intervalStatus);
    let mappedTries = (Array.isArray(base?.intervalTry) ? base.intervalTry : []).map((tryEntry) => {
      const tryBase = tryEntry && typeof tryEntry === "object" ? toPlainObject(tryEntry) || {} : {};
      return {
        ...tryBase,
        intervalTrysubIntervals: (Array.isArray(tryBase?.intervalTrysubIntervals) ? tryBase.intervalTrysubIntervals : [])
          .map((sub) => {
            const subBase = sub && typeof sub === "object" ? toPlainObject(sub) || {} : {};
            const subId = trimString(subBase?.subIntervalID || subBase?.subIntervalId);
            const isTarget = subId === targetSubIntervalId;
            return {
              ...subBase,
              subIntervalCurrent:
                requestedStatusLower === "current"
                  ? isTarget
                  : requestedStatusLower === "normal" && isTarget
                    ? false
                    : Boolean(subBase?.subIntervalCurrent),
              subIntervalCourses: normalizePlannerIntervalCourseEntries(subBase?.subIntervalCourses),
            };
          }),
      };
    });
    // When resetting to normal, keep only the first try (lowest tryNum)
    if (isTargetInterval && requestedStatusLower === "normal" && mappedTries.length > 1) {
      mappedTries = [mappedTries.slice().sort((a, b) =>
        (Number.parseInt(trimString(a?.intervalTryNum), 10) || 0) -
        (Number.parseInt(trimString(b?.intervalTryNum), 10) || 0)
      )[0]];
    }
    // When cancelling retaking, remove the last try (highest tryNum), keep the rest
    if (isTargetInterval && isCancelRetaking && mappedTries.length > 1) {
      mappedTries = mappedTries.slice().sort((a, b) =>
        (Number.parseInt(trimString(a?.intervalTryNum), 10) || 0) -
        (Number.parseInt(trimString(b?.intervalTryNum), 10) || 0)
      ).slice(0, -1);
    }
    return {
      ...base,
      intervalID: base.intervalID ?? base.intervalNum ?? null,
      intervalStatus: [
        isTargetInterval
          ? requestedStatus
          : currentStatus.toLowerCase() === "current"
            ? "Normal"
            : currentStatus || "Normal",
      ],
      intervalTry: mappedTries,
    };
  });

  // On failure: add a new try (not a new interval) for the same interval
  if (requestedStatusLower === "failed" && !isCancelRetaking) {
    const targetIndex = currentProgramIntervals.findIndex(intervalHasTarget);
    if (targetIndex >= 0) {
      const failedInterval = toPlainObject(nextProgramIntervals[targetIndex]) || {};
      const existingTries = Array.isArray(failedInterval.intervalTry) ? failedInterval.intervalTry : [];
      const maxTryNum = existingTries.reduce((m, t) =>
        Math.max(m, Number.parseInt(trimString(t?.intervalTryNum), 10) || 0), 0);
      const nextTryNum = maxTryNum + 1;
      const trySymbol = trimString(existingTries[0]?.intervalTrySymbol) || "IT";
      const subSymbol = trimString(existingTries[0]?.intervalTrysubIntervals?.[0]?.subIntervalSymbol) || "sINT";
      const nextTryID = buildIntervalTryID(failedInterval.intervalID ?? failedInterval.intervalNum, nextTryNum, trySymbol);
      const termsPerYear = Number.parseInt(trimString(studyPlanner?.programTermsPerYear), 10) || 1;
      const lastTry = existingTries[existingTries.length - 1] || {};
      const lastSubIntervals = Array.isArray(lastTry.intervalTrysubIntervals) ? lastTry.intervalTrysubIntervals : [];
      const shiftRetakeDateByOneYear = (rawDate = {}) => {
        const parsedDate = parseDateToComponents(rawDate);
        const currentYear =
          Number.isInteger(Number(parsedDate?.year)) && Number(parsedDate.year) >= 1000
            ? Number(parsedDate.year)
            : null;
        const nextYear = currentYear != null ? currentYear + 1 : null;
        const month =
          Number.isInteger(Number(parsedDate?.month)) && Number(parsedDate.month) >= 1 && Number(parsedDate.month) <= 12
            ? Number(parsedDate.month)
            : null;
        const day =
          Number.isInteger(Number(parsedDate?.day)) && Number(parsedDate.day) >= 1 && Number(parsedDate.day) <= 31
            ? Number(parsedDate.day)
            : null;
        return {
          day,
          month,
          year: nextYear,
          date:
            nextYear != null && month != null && day != null
              ? new Date(`${String(nextYear).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}T00:00:00.000Z`)
              : null,
        };
      };
      nextProgramIntervals[targetIndex] = {
        ...failedInterval,
        intervalTry: [
          ...existingTries,
          {
            intervalTrySymbol: trySymbol,
            intervalTryID: nextTryID,
            intervalTryNum: nextTryNum,
            intervalTrysubIntervals: Array.from({ length: termsPerYear }, (_, i) => {
              const prevSub = lastSubIntervals[i] || {};
              const nextStart = shiftRetakeDateByOneYear(prevSub.subIntervalTryDates?.start || {});
              const nextEnd = shiftRetakeDateByOneYear(prevSub.subIntervalTryDates?.end || {});
              return {
                subIntervalSymbol: subSymbol,
                subIntervalID: buildNewSubIntervalID(nextTryID, i + 1, subSymbol),
                subIntervalNum: i + 1,
                subIntervalCurrent: false,
                subIntervalTryDates: {
                  start: nextStart,
                  end: nextEnd,
                },
                subIntervalCourses: [],
              };
            }),
          },
        ],
      };
    }
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
  if (!Array.isArray(studyPlanner.programComponentClasses)) {
    studyPlanner.programComponentClasses = [];
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
  const nextProgramName = trimString(normalizedPayload?.programName);
  const nextProgramLanguage = trimString(normalizedPayload?.programLanguage);
  const nextProgramUniversity = trimString(normalizedPayload?.programUniversity);
  const nextProgramFaculty = trimString(normalizedPayload?.programFaculty);
  const hasProgramExamClasses = "programExamClasses" in normalizedPayload;
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
  const nextProgramExamClasses = hasProgramExamClasses
    ? normalizeProgramExamClassesForPlanner({
        programExamClasses: Array.isArray(normalizedPayload?.programExamClasses)
          ? normalizedPayload.programExamClasses
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
  const hasProgramInstructors = "programInstructors" in normalizedPayload;
  const hasProgramEditors = "programEditors" in normalizedPayload;
  const hasProgramLocations = "programLocations" in normalizedPayload;
  const hasProgramCoursesNames = "programCoursesNames" in normalizedPayload;
  const hasProgramCoursesNamesCodes = "programCoursesNamesCodes" in normalizedPayload;
  const hasProgramCurrentIntervalTryNum = "programCurrentIntervalTryNum" in normalizedPayload;
  const hasProgramAIExtractions = "programAIExtractions" in normalizedPayload;
  const nextProgramInstructors = hasProgramInstructors
    ? (Array.isArray(normalizedPayload?.programInstructors)
        ? normalizedPayload.programInstructors
        : []
      )
        .map((entry) => {
          if (entry && typeof entry === "object") {
            const obj = toPlainObject(entry) || {};
            const rawFirstName = trimString(obj?.firstName) || "";
            const rawLastName = trimString(obj?.lastName) || "";
            const fullName = trimString(obj?.fullName) || [rawFirstName, rawLastName].filter(Boolean).join(" ");
            const [derivedFirstName = "", ...derivedLastNameParts] = fullName.split(/\s+/).filter(Boolean);
            const firstName = rawFirstName || derivedFirstName || "";
            const lastName = rawLastName || derivedLastNameParts.join(" ").trim() || "";
            const personality = trimString(obj?.personality) || "";
            const lectureIDs = Array.from(
              new Set(
                (Array.isArray(obj?.lectureIDs)
                  ? obj.lectureIDs
                  : Array.isArray(obj?.componentIDs)
                    ? obj.componentIDs
                    : String(obj?.lectureIDs || obj?.componentIDs || "").split(/\||,|\n|;/)
                )
                  .map((value) => trimString(value))
                  .filter(Boolean),
              ),
            );
            return (firstName || lastName || fullName)
              ? {
                  firstName,
                  lastName,
                  fullName,
                  personality,
                  lectureIDs,
                }
              : null;
          }
          return null;
        })
        .filter(Boolean)
    : [];
  const nextProgramEditors = hasProgramEditors
    ? normalizeStringArray(normalizedPayload?.programEditors)
    : [];
  const nextProgramCoursesNames = hasProgramCoursesNames
    ? normalizeStringArray(normalizedPayload?.programCoursesNames)
    : [];
  const nextProgramCoursesNamesCodes = hasProgramCoursesNamesCodes
    ? (Array.isArray(normalizedPayload?.programCoursesNamesCodes)
        ? normalizedPayload.programCoursesNamesCodes
        : []
      )
        .map((entry) => {
          const obj = entry && typeof entry === "object" ? toPlainObject(entry) || {} : {};
          const courseName = trimString(obj?.courseName) || "";
          const courseCode = trimString(obj?.courseCode) || "";
          return courseName ? { courseName, courseCode } : null;
        })
        .filter(Boolean)
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
    !hasProgramExamClasses &&
    !hasProgramExams &&
    !hasProgramStartYear &&
    !hasProgramTotalYears &&
    !hasProgramTermsPerYear &&
    !hasProgramPassingThresholdPerInterval &&
    !hasProgramFailingRules &&
    !hasProgramInstructors &&
    !hasProgramEditors &&
    !hasProgramLocations &&
    !hasProgramCoursesNames &&
    !hasProgramCoursesNamesCodes &&
    !hasProgramCurrentIntervalTryNum &&
    !hasProgramAIExtractions
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
  if (hasProgramExamClasses) {
    studyPlanner.programExamClasses = nextProgramExamClasses;
  }
  if (hasProgramExams) {
    studyPlanner.programExams = nextProgramExams;
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
  if (hasProgramCoursesNames) {
    studyPlanner.programCoursesNames = nextProgramCoursesNames;
  }
  if (hasProgramCoursesNamesCodes) {
    studyPlanner.programCoursesNamesCodes = nextProgramCoursesNamesCodes;
  }
  if (hasProgramCurrentIntervalTryNum) {
    const raw = normalizedPayload?.programCurrentIntervalTryNum;
    const rawObj = raw && typeof raw === "object" ? toPlainObject(raw) || {} : {};
    const intervalNum = toFiniteNumber(rawObj?.intervalNum, null);
    const intervalTryNum = toFiniteNumber(rawObj?.intervalTryNum, null);
    const subIntervalNum = toFiniteNumber(rawObj?.subIntervalNum, null);
    const targetSubIntervalId = trimString(
      normalizedPayload?.subIntervalID || normalizedPayload?.subIntervalId,
    );
    studyPlanner.programCurrentIntervalTryNum = (intervalNum !== null || intervalTryNum !== null || subIntervalNum !== null)
      ? { intervalNum, intervalTryNum, subIntervalNum }
      : null;
    studyPlanner.programIntervals = syncProgramCurrentIntervalTrySelection(
      studyPlanner.programIntervals,
      studyPlanner.programCurrentIntervalTryNum,
      targetSubIntervalId,
    );
    if (typeof memoryDoc?.markModified === "function") {
      memoryDoc.markModified("studyPlanner");
      memoryDoc.markModified("studyPlanner.programCurrentIntervalTryNum");
      memoryDoc.markModified("studyPlanner.programIntervals");
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
            .map((c) => {
              const co = c && typeof c === "object" ? toPlainObject(c) || {} : {};
              return {
                courseSymbol: trimString(co?.courseSymbol) || "CRS",
                courseNum: Number.isFinite(co?.courseNum) ? co.courseNum : undefined,
                courseID: trimString(co?.courseID) || "",
                courseName: trimString(co?.courseName) || "",
                courseCode: trimString(co?.courseCode) || "",
                courseWeight: Number.isFinite(co?.courseWeight) ? co.courseWeight : 100,
                courseComponents: Array.isArray(co?.courseComponents)
                  ? co.courseComponents.map((comp) => {
                      const cp = comp && typeof comp === "object" ? toPlainObject(comp) || {} : {};
                      return {
                        componentSymbol: trimString(cp?.componentSymbol) || "COMP",
                        componentNum: Number.isFinite(cp?.componentNum) ? cp.componentNum : undefined,
                        componentID: trimString(cp?.componentID) || "",
                        componentClass: trimString(cp?.componentClass) || "",
                        componentWeight: Number.isFinite(cp?.componentWeight) ? cp.componentWeight : null,
                      };
                    })
                  : [],
              };
            })
            .filter((c) => c.courseName || c.courseCode);
        }
        return Object.keys(result).length > 0 ? result : null;
      })
      .filter(Boolean);
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
  if (!Array.isArray(studyPlanner.programComponentClasses)) {
    studyPlanner.programComponentClasses = [];
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
  }

  return studyPlanner;
};

export const updateStudyPlannerComponentsInPlanner = (memoryDoc, payload = {}) => {
  const studyPlanner = getStudyPlannerRoot(memoryDoc);
  const normalizedPayload =
    payload && typeof payload === "object" ? toPlainObject(payload) || {} : {};
  const rawProgramComponents = Array.isArray(normalizedPayload?.programComponentClasses)
    ? normalizedPayload.programComponentClasses
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

  studyPlanner.programComponentClasses = componentEntries;
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
