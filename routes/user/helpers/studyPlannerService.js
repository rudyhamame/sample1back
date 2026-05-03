import mongoose from "mongoose";

const DEFAULT_STUDY_ORGANIZER = {
  courses: [],
  exams: [],
};

const DEFAULT_STUDY_PLAN_AID = {
  enabled: false,
  source: "normalized-page-text",
  goal: "Help make the study plan more achievable from lecture page text.",
  lectureAids: [],
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

  memoryDoc.studyPlanner = {
    studyOrganizer: (() => {
      const { _id, ...organizerWithoutId } = currentOrganizer || {};
      void _id;
      return organizerWithoutId;
    })(),
    studyPlanAid: (() => {
      const { _id, ...aidWithoutId } = currentStudyPlanAid || {};
      void _id;
      return aidWithoutId;
    })(),
  };

  if (memoryDoc?.studyOrganizer) {
    delete memoryDoc.studyOrganizer;
  }
  if (memoryDoc?.studyPlanAid) {
    delete memoryDoc.studyPlanAid;
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

const normalizeOptionalPlannerString = (value) => {
  const normalizedValue = trimString(value);
  return normalizedValue === "-" ? "" : normalizedValue;
};

const normalizeStudyTerm = (value) => {
  const normalizedValue = normalizeOptionalPlannerString(value);
  const normalizedLowerValue = normalizedValue.toLowerCase();
  const termAliases = {
    first: "First",
    fall: "First",
    second: "Second",
    winter: "Second",
    third: "Third",
    summer: "Third",
  };

  return termAliases[normalizedLowerValue] || normalizedValue;
};

const normalizeComponentStatus = (value) => {
  const normalizedValue = trimString(value).toLowerCase();
  const statusAliases = {
    new: "new",
    failed: "failed",
    passed: "passed",
    "not started": "new",
    "in progress": "new",
    completed: "passed",
  };

  return statusAliases[normalizedValue] || "new";
};

const normalizeCourseStatus = (value) => {
  const normalizedValue = trimString(value).toLowerCase();
  const statusAliases = {
    new: "new",
    failed: "failed",
    incomplete: "incomplete",
    passed: "passed",
    "not started": "new",
    completed: "passed",
  };

  return statusAliases[normalizedValue] || "new";
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
      return normativeTerm === actualTerm ? "ongoing" : "failed";
    }
  }

  return "-";
};

const buildWeight = (value, previousWeight = {}) => {
  const parsedValue = Number(value);
  const parsedTotal = Number(previousWeight?.total);

  return {
    value: Number.isFinite(parsedValue)
      ? parsedValue
      : Number(previousWeight?.value) || 0,
    total: Number.isFinite(parsedTotal) ? parsedTotal : 100,
    unit: trimString(previousWeight?.unit) || "percent",
  };
};

const buildLocation = (payload = {}, previousLocation = {}) => ({
  building:
    trimString(payload?.course_locationBuilding) ||
    trimString(previousLocation?.building),
  room: trimString(payload?.course_locationRoom) || trimString(previousLocation?.room),
});

const buildVolume = (value, previousVolume = {}, unit = "pages") => ({
  value: toFiniteNumber(value, Number(previousVolume?.value) || 0),
  unit: trimString(previousVolume?.unit) || unit,
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
  const previousMax = Number(previousGrade?.max);

  return {
    value:
      assignTo === "value"
        ? Number.isFinite(parsedValue)
          ? parsedValue
          : Number.isFinite(previousValue)
            ? previousValue
            : null
        : Number.isFinite(previousValue)
          ? previousValue
          : null,
    max:
      assignTo === "max"
        ? Number.isFinite(parsedValue)
          ? parsedValue
          : Number.isFinite(previousMax)
            ? previousMax
            : null
        : Number.isFinite(previousMax)
          ? previousMax
          : null,
    unit: trimString(previousGrade?.unit) || "points",
  };
};

const sanitizeStudyLocation = (value = {}) => ({
  building: trimString(value?.building),
  room: trimString(value?.room),
});

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
  unit: trimString(value?.unit) || "percent",
});

const sanitizeStudyVolume = (value = {}) => ({
  value: toFiniteNumber(value?.value, 0),
  unit: trimString(value?.unit) || "pages",
  scope: trimString(value?.scope),
  note: trimString(value?.note),
});

const sanitizeStudyGrade = (value = {}) => ({
  value:
    value?.value === null || value?.value === undefined
      ? null
      : toFiniteNumber(value?.value, null),
  min:
    value?.min === null || value?.min === undefined
      ? null
      : toFiniteNumber(value?.min, null),
  max:
    value?.max === null || value?.max === undefined
      ? null
      : toFiniteNumber(value?.max, null),
  unit: trimString(value?.unit) || "points",
});

const sanitizeStudyRecommendation = (value = {}) => ({
  timing: trimString(value?.timing) || "later",
  intensity: trimString(value?.intensity) || "medium",
  suggestedHours: toFiniteNumber(value?.suggestedHours, 0),
  reason: trimString(value?.reason),
  note: trimString(value?.note),
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
  textData: Array.isArray(value?.textData)
    ? value.textData.map((entry) => sanitizePageTextData(toPlainObject(entry) || {}))
    : [],
  nonTextData: Array.isArray(value?.nonTextData)
    ? value.nonTextData.map((entry) =>
        sanitizePageNonTextData(toPlainObject(entry) || {}),
      )
    : [],
  studyRecommendation: sanitizeStudyRecommendation(value?.studyRecommendation || {}),
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
  pages: Array.isArray(value?.pages)
    ? value.pages.map((entry) => sanitizeStudyPage(toPlainObject(entry) || {}))
    : [],
});

const sanitizeStudyComponent = (value = {}) => ({
  ...(normalizeObjectIdValue(value?._id) ? { _id: normalizeObjectIdValue(value?._id) } : {}),
  class: trimString(value?.class),
  status: normalizeComponentStatus(value?.status),
  time: sanitizeStudyTime(value?.time || {}),
  location: sanitizeStudyLocation(value?.location || {}),
  schedule: Array.isArray(value?.schedule)
    ? value.schedule.map((entry) => sanitizeWeeklyScheduleEntry(entry))
    : [],
  weight: sanitizeStudyWeight(value?.weight || {}),
  lectures: Array.isArray(value?.lectures)
    ? value.lectures.map((entry) => sanitizeStudyLecture(toPlainObject(entry) || {}))
    : [],
});

const sanitizeStudyCourse = (value = {}) => ({
  ...(normalizeObjectIdValue(value?._id) ? { _id: normalizeObjectIdValue(value?._id) } : {}),
  code: trimString(value?.code),
  name: trimString(value?.name) || "-",
  status: normalizeCourseStatus(value?.status),
  components: Array.isArray(value?.components)
    ? value.components.map((entry) => sanitizeStudyComponent(toPlainObject(entry) || {}))
    : [],
});

const sanitizeStudyExam = (value = {}) => ({
  ...(normalizeObjectIdValue(value?._id) ? { _id: normalizeObjectIdValue(value?._id) } : {}),
  componentId: normalizeObjectIdValue(value?.componentId, { allowNull: true }),
  type: trimString(value?.type),
  time: sanitizeStudyTime(value?.time || {}),
  location: sanitizeStudyLocation(value?.location || {}),
  lectures: (Array.isArray(value?.lectures) ? value.lectures : [value?.lectures])
    .map((entry) => normalizeObjectIdValue(entry))
    .filter(Boolean),
  volume: sanitizeStudyVolume(value?.volume || {}),
  weight: sanitizeStudyWeight(value?.weight || {}),
  passGrade: sanitizeStudyGrade(value?.passGrade || {}),
  grade: sanitizeStudyGrade(value?.grade || {}),
  studyRecommendation: sanitizeStudyRecommendation(value?.studyRecommendation || {}),
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

const ensureStudyPlanAid = (memoryDoc) => {
  const studyPlanner = getStudyPlannerRoot(memoryDoc);
  const currentAid =
    studyPlanner?.studyPlanAid && typeof studyPlanner.studyPlanAid === "object"
      ? toPlainObject(studyPlanner.studyPlanAid)
      : {};

  studyPlanner.studyPlanAid = {
    enabled:
      typeof currentAid?.enabled === "boolean"
        ? currentAid.enabled
        : DEFAULT_STUDY_PLAN_AID.enabled,
    source: trimString(currentAid?.source) || DEFAULT_STUDY_PLAN_AID.source,
    goal: trimString(currentAid?.goal) || DEFAULT_STUDY_PLAN_AID.goal,
    lectureAids: Array.isArray(currentAid?.lectureAids) ? currentAid.lectureAids : [],
    note: trimString(currentAid?.note),
  };

  return studyPlanner.studyPlanAid;
};

export const getStudyPlanAid = (memoryDoc) => ensureStudyPlanAid(memoryDoc);

export const updateStudyPlanAidInPlanner = (memoryDoc, payload = {}) => {
  const studyPlanAid = ensureStudyPlanAid(memoryDoc);
  const normalizedPayload =
    payload && typeof payload === "object" ? toPlainObject(payload) || {} : {};

  const nextLectureAids = Array.isArray(normalizedPayload?.lectureAids)
    ? normalizedPayload.lectureAids
        .map((entry) => {
          const normalizedEntry = toPlainObject(entry) || {};
          return {
            ...(normalizedEntry?._id ? { _id: normalizedEntry._id } : {}),
            lectureId: normalizedEntry?.lectureId || null,
            pageIds: Array.isArray(normalizedEntry?.pageIds)
              ? normalizedEntry.pageIds.filter(Boolean)
              : [],
            normalizedPageText: Array.isArray(normalizedEntry?.normalizedPageText)
              ? normalizedEntry.normalizedPageText
                  .map((text) => trimString(text))
                  .filter(Boolean)
              : [],
            studyNotes: trimString(normalizedEntry?.studyNotes),
            memorizationTips: trimString(normalizedEntry?.memorizationTips),
            practiceQuestions: Array.isArray(normalizedEntry?.practiceQuestions)
              ? normalizedEntry.practiceQuestions
                  .map((question) => trimString(question))
                  .filter(Boolean)
              : [],
            note: trimString(normalizedEntry?.note),
          };
        })
        .filter((entry) => entry.lectureId)
    : studyPlanAid.lectureAids;

  studyPlanAid.enabled =
    typeof normalizedPayload?.enabled === "boolean"
      ? normalizedPayload.enabled
      : studyPlanAid.enabled;
  studyPlanAid.source =
    trimString(normalizedPayload?.source) || trimString(studyPlanAid?.source);
  studyPlanAid.goal =
    trimString(normalizedPayload?.goal) || trimString(studyPlanAid?.goal);
  studyPlanAid.note =
    trimString(normalizedPayload?.note) || trimString(studyPlanAid?.note);
  studyPlanAid.lectureAids = nextLectureAids;

  return studyPlanAid;
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

const getPlannerExams = (memoryDoc) => {
  const studyOrganizer = ensureStudyOrganizer(memoryDoc);
  return Array.isArray(studyOrganizer?.exams) ? studyOrganizer.exams : [];
};

const setPlannerExams = (memoryDoc, exams = []) => {
  const studyOrganizer = ensureStudyOrganizer(memoryDoc);
  studyOrganizer.exams = Array.isArray(exams)
    ? exams.map((entry) => sanitizeStudyExam(toPlainObject(entry) || {}))
    : [];
};

const countLectureFinishedPages = (lecture = {}) =>
  toPositiveInteger(lecture?.progress, 0);

const countLecturePages = (lecture = {}) =>
  Array.isArray(lecture?.pages) ? lecture.pages.length : 0;

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
  const previousPages = Array.isArray(previousLecture?.pages)
    ? previousLecture.pages.map((page) => ({ ...toPlainObject(page) }))
    : [];
  const totalPages = Math.max(
    toPositiveInteger(payload?.lecture_length, previousPages.length),
    previousPages.length && !payload?.lecture_length ? previousPages.length : 0,
  );
  const finishedPages = new Set(
    Array.isArray(payload?.lecture_pagesFinished)
      ? payload.lecture_pagesFinished
          .map((pageNumber) => toPositiveInteger(pageNumber, 0))
          .filter((pageNumber) => pageNumber > 0)
      : [],
  );

  return Array.from({ length: totalPages }, (_, index) => {
    const order = index + 1;
    const previousPage = previousPages[index] || {};

    return {
      ...(previousPage?._id ? { _id: previousPage._id } : {}),
      order,
      textData: Array.isArray(previousPage?.textData) ? previousPage.textData : [],
      nonTextData: Array.isArray(previousPage?.nonTextData)
        ? previousPage.nonTextData
        : [],
      studyRecommendation:
        previousPage?.studyRecommendation &&
        typeof previousPage.studyRecommendation === "object"
          ? previousPage.studyRecommendation
          : {},
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
      const nextStudyRecommendation = sanitizeStudyRecommendation({
        ...(previousExam?.studyRecommendation || {}),
        ...(entry?.studyRecommendation && typeof entry.studyRecommendation === "object"
          ? entry.studyRecommendation
          : {}),
      });
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
        !toFiniteNumber(nextGrade?.max, null) &&
        !trimString(nextStudyRecommendation?.reason) &&
        !trimString(nextStudyRecommendation?.note) &&
        !toFiniteNumber(nextStudyRecommendation?.suggestedHours, 0)
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
        grade: nextGrade,
        studyRecommendation: nextStudyRecommendation,
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

        return {
          ...normalizedComponent,
          lectures,
        };
      })
    : [];

  return {
    ...normalizedCourse,
    components,
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
        weight: buildWeight(payload?.course_grade, {
          ...(previousComponent?.weight || {}),
          total:
            Number.isFinite(Number(payload?.course_weightTotal))
              ? Number(payload.course_weightTotal)
              : previousComponent?.weight?.total,
        }),
        lectures: previousLectures,
      },
    ],
  };

  return recalculateComponentAndCourseTotals(nextCourse);
};

export const buildCourseInfoPayload = (payload = {}, previousCourse = {}) => {
  const normalizedPreviousCourse = toPlainObject(previousCourse) || {};

  return {
    _id:
      normalizeObjectIdValue(normalizedPreviousCourse?._id) || new Types.ObjectId(),
    code: trimString(payload?.course_code) || trimString(normalizedPreviousCourse?.code),
    name: trimString(payload?.course_name) || trimString(normalizedPreviousCourse?.name) || "-",
    status: normalizeCourseStatus(payload?.course_status || normalizedPreviousCourse?.status),
    components: Array.isArray(normalizedPreviousCourse?.components)
      ? normalizedPreviousCourse.components.map((component) => toPlainObject(component))
      : [],
  };
};

export const buildComponentPayload = (payload = {}, previousComponent = {}) => {
  const normalizedPreviousComponent = toPlainObject(previousComponent) || {};
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

  return {
    _id:
      normalizeObjectIdValue(normalizedPreviousComponent?._id) ||
      new Types.ObjectId(),
    class:
      trimString(payload?.course_class) ||
      trimString(normalizedPreviousComponent?.class) ||
      "-",
    status: normalizeComponentStatus(
      payload?.course_status || normalizedPreviousComponent?.status,
    ),
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
    weight: buildWeight(payload?.course_grade, {
      ...(normalizedPreviousComponent?.weight || {}),
      total:
        Number.isFinite(Number(payload?.course_weightTotal))
          ? Number(payload.course_weightTotal)
          : normalizedPreviousComponent?.weight?.total,
    }),
    lectures: Array.isArray(normalizedPreviousComponent?.lectures)
      ? normalizedPreviousComponent.lectures.map((lecture) => toPlainObject(lecture))
      : [],
  };
};

export const addCourseInfoToPlanner = (memoryDoc, payload = {}) => {
  const courses = getPlannerCourses(memoryDoc).map((course) => toPlainObject(course));
  const nextCourse = recalculateComponentAndCourseTotals(buildCourseInfoPayload(payload));
  courses.push(nextCourse);
  setPlannerCourses(memoryDoc, courses);
  return nextCourse;
};

export const addComponentToPlanner = (memoryDoc, courseId = "", payload = {}) => {
  const courses = getPlannerCourses(memoryDoc).map((course) => toPlainObject(course));
  const plannerExams = getPlannerExams(memoryDoc).map((exam) => toPlainObject(exam));
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
      components: [
        ...(Array.isArray(normalizedCourse?.components)
          ? normalizedCourse.components.map((component) => toPlainObject(component))
          : []),
        nextComponent,
      ],
    });

    return updatedCourse;
  });

  setPlannerCourses(memoryDoc, nextCourses);
  const normalizedExams = normalizePlannerExamPayloads(
    payload?.course_exams,
    payload,
    [],
    [],
    nextComponent._id,
  );
  setPlannerExams(memoryDoc, [...plannerExams, ...normalizedExams]);

  return nextComponent;
};

export const buildManualLecturePayload = (payload = {}, previousLecture = {}) => {
  const normalizedPreviousLecture = toPlainObject(previousLecture) || {};
  const pages = buildLecturePages(payload, normalizedPreviousLecture);
  const instructors = normalizeDelimitedStringArray(
    payload?.instructors ?? payload?.lecture_instructors ?? payload?.lecture_instructor,
  );
  const writers = normalizeDelimitedStringArray(
    payload?.writer ?? payload?.writers ?? payload?.lecture_writers ?? payload?.lecture_writer,
  );
  const publishDate = parseOptionalDate(
    payload?.publishDate || payload?.lecture_publishDate || payload?.lecture_date,
  );

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
    writer:
      writers.length > 0
        ? writers
        : normalizeStringArray(normalizedPreviousLecture?.writer),
    publishDate: publishDate || normalizedPreviousLecture?.publishDate || null,
    weight:
      normalizedPreviousLecture?.weight &&
      typeof normalizedPreviousLecture.weight === "object"
        ? normalizedPreviousLecture.weight
        : { value: 0, unit: "percent" },
    progress: Array.isArray(payload?.lecture_pagesFinished)
      ? payload.lecture_pagesFinished.length
      : toFiniteNumber(normalizedPreviousLecture?.progress, 0),
    pages,
  };
};

export const flattenMemoryCoursesForPlanner = (entries = [], plannerExams = []) =>
  (Array.isArray(entries) ? entries : []).flatMap((course) => {
    const normalizedCourse = toPlainObject(course) || {};
    const components = Array.isArray(normalizedCourse?.components)
      ? normalizedCourse.components
      : [];

    const buildFlattenedComponentEntry = (component = {}) => {
      const normalizedComponent = toPlainObject(component) || {};
      const componentTime =
        normalizedComponent?.time && typeof normalizedComponent.time === "object"
          ? normalizedComponent.time
          : {};
      const componentStats = getComponentPageStats(normalizedComponent);
      const exams = (Array.isArray(plannerExams) ? plannerExams : [])
        .map((exam) => toPlainObject(exam) || {})
        .filter(
          (exam) =>
            normalizeIdString(exam?.componentId) ===
            normalizeIdString(normalizedComponent?._id),
        );
      const primaryExam = exams[0] || {};
      const primaryExamTime = mapExamTimeForPlanner(primaryExam);
      const componentStatus = normalizeComponentStatus(
        normalizedComponent?.status,
      );

      return {
        _id: normalizedComponent?._id || normalizedCourse?._id,
        parentCourseId: normalizedCourse?._id || null,
        primaryComponentId: normalizedComponent?._id || "",
        course_code: trimString(normalizedCourse?.code) || "",
        course_name: trimString(normalizedCourse?.name) || "-",
        course_status: normalizeCourseStatus(normalizedCourse?.status),
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
          String(toFiniteNumber(normalizedComponent?.weight?.value, 0) || "-"),
        course_weightTotal:
          String(toFiniteNumber(normalizedComponent?.weight?.total, 100) || "100"),
        course_fullGrade:
          Number.isFinite(Number(primaryExam?.grade?.max))
            ? String(primaryExam.grade.max)
            : "-",
        course_length: componentStats.totalPages,
        course_progress: componentStats.finishedPages,
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
            course_grade:
              Number.isFinite(Number(exam?.weight?.value))
                ? String(exam.weight.value)
                : "-",
            weight:
              exam?.weight && typeof exam.weight === "object"
                ? toPlainObject(exam.weight)
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
            studyRecommendation:
              exam?.studyRecommendation &&
              typeof exam.studyRecommendation === "object"
                ? toPlainObject(exam.studyRecommendation)
                : {},
            course_fullGrade:
              Number.isFinite(Number(exam?.grade?.max))
                ? String(exam.grade.max)
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
          course_status: normalizeCourseStatus(normalizedCourse?.status),
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
        const pages = Array.isArray(normalizedLecture?.pages)
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
        const finishedPages = Array.from(
          {
            length: Math.min(
              toPositiveInteger(normalizedLecture?.progress, 0),
              pages.length,
            ),
          },
          (_, index) => index + 1,
        );

        return {
          _id: normalizedLecture?._id || null,
          lecture_name: trimString(normalizedLecture?.title) || "-",
          lecture_course:
            lectureCourseLabel || trimString(normalizedCourse?.name) || "-",
          lecture_courseName: trimString(normalizedCourse?.name) || "-",
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
          lecture_length: pages.length,
          lecture_progress: finishedPages.length,
          lecture_pagesFinished: finishedPages,
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
  let { courseIndex, componentIndex } = findCourseComponentByLabel(
    courses,
    lectureCourseName,
  );

  if (courseIndex === -1 || componentIndex === -1) {
    const inferredNames = splitLectureCourseLabel(lectureCourseName);
    const nextCourse = recalculateComponentAndCourseTotals({
      name: inferredNames.baseCourseName || lectureCourseName || "-",
      components: [
        {
          class: "",
          time: {
            startsAt: null,
            endsAt: null,
          },
          location: { building: "", room: "" },
          schedule: [],
          weight: { value: 0, unit: "percent" },
          lectures: [],
        },
      ],
    });

    courses.push(nextCourse);
    courseIndex = courses.length - 1;
    componentIndex = 0;
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
  const plannerExams = getPlannerExams(memoryDoc).map((exam) => toPlainObject(exam));
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
  setPlannerExams(
    memoryDoc,
    plannerExams.map((exam) => ({
      ...exam,
      lectures: normalizeReferenceIds(exam?.lectures).filter((linkedLectureId) =>
        linkedLectureId !== String(lectureId || ""),
      ),
    })),
  );
  studyPlanAid.lectureAids = (Array.isArray(studyPlanAid?.lectureAids)
    ? studyPlanAid.lectureAids
    : []
  ).filter((entry) => normalizeIdString(entry?.lectureId) !== String(lectureId || ""));
};

export const removeCourseOrComponentFromPlanner = (memoryDoc, targetId = "") => {
  const courses = getPlannerCourses(memoryDoc).map((course) => toPlainObject(course));
  const plannerExams = getPlannerExams(memoryDoc).map((exam) => toPlainObject(exam));
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
  const remainingComponentIds = new Set(
    nextCourses.flatMap((course) =>
      (Array.isArray(course?.components) ? course.components : [])
        .map((component) => normalizeIdString(component?._id))
        .filter(Boolean),
    ),
  );
  setPlannerExams(
    memoryDoc,
    plannerExams.filter((exam) =>
      remainingComponentIds.has(normalizeIdString(exam?.componentId)),
    ),
  );
  studyPlanAid.lectureAids = (Array.isArray(studyPlanAid?.lectureAids)
    ? studyPlanAid.lectureAids
    : []
  ).filter((entry) => !removedLectureIds.has(normalizeIdString(entry?.lectureId)));
};

export const updateCourseInPlanner = (memoryDoc, courseId = "", payload = {}) => {
  const courses = getPlannerCourses(memoryDoc).map((course) => toPlainObject(course));
  const plannerExams = getPlannerExams(memoryDoc).map((exam) => toPlainObject(exam));
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
    const nextComponent = buildComponentPayload(payload, match.component);
    const nextComponents = (Array.isArray(normalizedCourse?.components)
      ? normalizedCourse.components
      : []
    ).map((componentEntry, componentIndex) =>
      componentIndex === match.componentIndex ? nextComponent : componentEntry,
    );

    updatedCourse = recalculateComponentAndCourseTotals({
      ...normalizedCourse,
      components: nextComponents,
    });

    return updatedCourse;
  });

  setPlannerCourses(memoryDoc, nextCourses);
  if (match.component && previousComponentId) {
    const nextComponent = buildComponentPayload(payload, match.component);
    const previousLectures = Array.isArray(nextComponent?.lectures)
      ? nextComponent.lectures
      : [];
    const previousComponentExams = plannerExams.filter(
      (exam) => normalizeIdString(exam?.componentId) === previousComponentId,
    );
    const normalizedExams = normalizePlannerExamPayloads(
      payload?.course_exams,
      payload,
      previousComponentExams,
      previousLectures,
      nextComponent._id,
    );
    const untouchedExams = plannerExams.filter(
      (exam) => normalizeIdString(exam?.componentId) !== previousComponentId,
    );
    setPlannerExams(memoryDoc, [...untouchedExams, ...normalizedExams]);
  }
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
