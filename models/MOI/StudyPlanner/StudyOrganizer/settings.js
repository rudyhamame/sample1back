import mongoose from "mongoose";

const { Schema } = mongoose;

const createEmptyObject = () => ({});

const trimString = (value) => String(value || "").trim();
const normalizeObjectIdString = (value) => {
  const normalizedValue = trimString(value);
  return mongoose.Types.ObjectId.isValid(normalizedValue)
    ? normalizedValue
    : undefined;
};

const toPlainObject = (value) =>
  value && typeof value?.toObject === "function" ? value.toObject() : value;

const normalizePlannerSettingsStringList = (value) =>
  Array.isArray(value)
    ? value
        .map((entry) => trimString(entry))
        .filter(Boolean)
        .filter((entry, index, entries) => entries.indexOf(entry) === index)
    : [];

const buildHalfHour12hOptions = () => {
  const options = [];
  for (let hour = 0; hour < 24; hour += 1) {
    for (let minute = 0; minute <= 30; minute += 30) {
      const period = hour >= 12 ? "PM" : "AM";
      const hour12 = hour % 12 === 0 ? 12 : hour % 12;
      options.push(`${hour12}:${String(minute).padStart(2, "0")} ${period}`);
    }
  }
  return options;
};

const buildAcademicYearOptions = (startYear = 2000, endYear = 2030) => {
  const parsedEndYear = Number(endYear);
  const end =
    endYear !== null &&
    endYear !== undefined &&
    String(endYear).trim() !== "" &&
    Number.isFinite(parsedEndYear)
      ? parsedEndYear
      : 2030;
  const start = Math.min(Math.max(1900, Number(startYear) || 2000), end);
  const options = [];
  for (let year = end; year >= start; year -= 1) {
    options.push(`${year} - ${year + 1}`);
  }
  return options;
};

const normalizePredictionToolEntry = (value = {}) => {
  const nextValue =
    value && typeof value === "object" ? toPlainObject(value) || {} : {};
  return {
    tab: trimString(nextValue?.tab),
    inputFieldID: trimString(nextValue?.inputFieldID),
    list: normalizePlannerSettingsStringList(nextValue?.list),
  };
};

const normalizePredictionToolSettings = (value = []) =>
  (Array.isArray(value) ? value : [])
    .map((entry) => normalizePredictionToolEntry(entry))
    .filter((entry) => Boolean(entry.inputFieldID));

const normalizeVoiceCommandEntry = (value = {}) => {
  const nextValue =
    value && typeof value === "object" ? toPlainObject(value) || {} : {};
  const idTree = Array.isArray(nextValue?.idTree)
    ? nextValue.idTree.map((entry) => trimString(entry)).filter(Boolean)
    : [];
  const elementID = trimString(nextValue?.elementID || nextValue?.button);
  const voiceCommand = trimString(
    nextValue?.voiceCommand || nextValue?.command,
  );
  return {
    idTree,
    elementID,
    voiceCommand,
  };
};

const normalizeVoiceCommandSettings = (value = []) =>
  (Array.isArray(value) ? value : [])
    .map((entry) => normalizeVoiceCommandEntry(entry))
    .filter((entry) => Boolean(entry.elementID) && Boolean(entry.voiceCommand))
    .reduce((accumulator, entry) => {
      const duplicateIndex = accumulator.findIndex(
        (existingEntry) =>
          String(existingEntry.elementID || "").trim() ===
            String(entry.elementID || "").trim() &&
          String(existingEntry.voiceCommand || "").trim() ===
            String(entry.voiceCommand || "").trim(),
      );
      if (duplicateIndex === -1) {
        accumulator.push(entry);
      }
      return accumulator;
    }, []);

const normalizeVoiceDictationNormalizationEntry = (value = {}) => {
  const nextValue =
    value && typeof value === "object" ? toPlainObject(value) || {} : {};
  const conditionRaw = trimString(nextValue?.condition).toLowerCase();
  const condition =
    conditionRaw === "startofword"
      ? "startOfWord"
      : conditionRaw === "anywhere"
        ? "anywhere"
        : "endOfWord";
  return {
    letter: trimString(nextValue?.letter),
    normalizedLetter: trimString(nextValue?.normalizedLetter),
    condition,
  };
};

const normalizeVoiceDictationNormalizationSettings = (value = []) =>
  (Array.isArray(value) ? value : [])
    .map((entry) => normalizeVoiceDictationNormalizationEntry(entry))
    .filter((entry) => Boolean(entry.letter) && Boolean(entry.normalizedLetter))
    .reduce((accumulator, entry) => {
      const duplicateIndex = accumulator.findIndex(
        (existingEntry) =>
          String(existingEntry.letter || "").trim() ===
            String(entry.letter || "").trim() &&
          String(existingEntry.normalizedLetter || "").trim() ===
            String(entry.normalizedLetter || "").trim() &&
          String(existingEntry.condition || "").trim() ===
            String(entry.condition || "").trim(),
      );
      if (duplicateIndex === -1) {
        accumulator.push(entry);
      }
      return accumulator;
    }, []);

const normalizePlannerRoomOptionsByBuilding = (value) =>
  (Array.isArray(value) ? value : [])
    .map((entry) => toPlainObject(entry) || {})
    .map((entry) => ({
      building: trimString(entry?.building),
      rooms: normalizePlannerSettingsStringList(entry?.rooms),
    }))
    .filter((entry) => Boolean(entry.building))
    .reduce((accumulator, entry) => {
      const existingIndex = accumulator.findIndex(
        (item) => item.building === entry.building,
      );
      if (existingIndex === -1) {
        accumulator.push({
          building: entry.building,
          rooms: [...entry.rooms],
        });
        return accumulator;
      }
      accumulator[existingIndex].rooms = normalizePlannerSettingsStringList([
        ...accumulator[existingIndex].rooms,
        ...entry.rooms,
      ]);
      return accumulator;
    }, []);

const normalizePlannerDependencyOptions = (value = []) =>
  (Array.isArray(value) ? value : [])
    .map((entry) => toPlainObject(entry) || {})
    .map((entry) => ({
      selectID: trimString(entry?.selectID),
      options: normalizePlannerSettingsStringList(entry?.options),
    }))
    .filter((entry) => Boolean(entry.selectID));

const normalizePlannerIndependentOptionsSelects = (value = []) =>
  (Array.isArray(value) ? value : [])
    .map((entry) => toPlainObject(entry) || {})
    .map((entry) => ({
      selectID: resolvePlannerSelectOptionsKey(entry?.selectID),
      options: removeHardcodedPlannerSelectOptions(
        entry?.selectID,
        entry?.options,
      ),
    }))
    .filter((entry) => Boolean(entry.selectID));

const normalizePlannerDependentOptionsSelects = (value = []) =>
  (Array.isArray(value) ? value : [])
    .map((entry) => toPlainObject(entry) || {})
    .map((entry) => ({
      dependentSelectID: resolvePlannerSelectOptionsKey(
        entry?.selectID || entry?.dependentSelectID,
      ),
      independentID: resolvePlannerSelectOptionsKey(entry?.independentID),
      independentOption: trimString(entry?.independentOption),
      dependentOptions: Array.isArray(entry?.options)
        ? entry.options
            .map((group) => normalizePlannerSettingsStringList(group))
            .filter((group) => group.length > 0)
        : Array.isArray(entry?.dependentOptions)
          ? entry.dependentOptions
            .map((group) => normalizePlannerSettingsStringList(group))
            .filter((group) => group.length > 0)
          : [],
    }))
    .filter(
      (entry) =>
        Boolean(entry.dependentSelectID) &&
        Boolean(entry.independentID) &&
        entry.dependentOptions.length > 0,
    );

const PLANNER_SELECT_OPTIONS_ID_ALIASES = {
  componentClassOptions: [
    "componentClassOptions",
    "nogaPlanner_savedCourseSelect_course_classSelection",
    "nogaPlanner_lecturesSelect_component",
  ],
  weekdayOptions: [
    "weekdayOptions",
    "nogaPlanner_savedCourseSelect_course_daySelection",
  ],
  hourOptions: [
    "hourOptions",
    "nogaPlanner_savedCourseSelect_course_timeSelection",
  ],
  termOptions: [
    "termOptions",
    "nogaPlanner_savedCourseSelect_normativeCourseTerm",
  ],
  academicYearOptions: [
    "academicYearOptions",
    "nogaPlanner_savedCourseSelect_normativeCourseYearInterval",
  ],
  locationBuildingOptions: [
    "locationBuildingOptions",
    "nogaPlanner_savedCourseSelect_course_locationBuilding",
    "nogaPlanner_sharedSelect_locationBuilding",
  ],
  locationRoomOptions: [
    "locationRoomOptions",
    "nogaPlanner_savedCourseSelect_course_locationRoom",
    "nogaPlanner_sharedSelect_locationRoom",
  ],
  lectureInstructorOptions: [
    "lectureInstructorOptions",
    "nogaPlanner_lecturesSelect_instructors",
  ],
  lectureWriterOptions: [
    "lectureWriterOptions",
    "nogaPlanner_lecturesSelect_writers",
  ],
};

const buildEmptyPlannerFieldDefaults = () => ({});

const normalizePlannerFieldDefaultCard = (value = "") => {
  const normalizedValue = trimString(value).toLowerCase();
  if (!normalizedValue) {
    return "";
  }
  if (
    normalizedValue === "course" ||
    normalizedValue === "courses" ||
    normalizedValue === "savedcourse" ||
    normalizedValue === "inlinecourse"
  ) {
    return "course";
  }
  if (
    normalizedValue === "component" ||
    normalizedValue === "components" ||
    normalizedValue === "inlinecomponent"
  ) {
    return "components";
  }
  if (normalizedValue === "exam" || normalizedValue === "exams") {
    return "exams";
  }
  if (normalizedValue === "lecture" || normalizedValue === "lectures") {
    return "lectures";
  }
  return normalizedValue;
};

const inferPlannerFieldDefaultCardFromFieldKey = (fieldKey = "") => {
  const normalizedFieldKey = trimString(fieldKey).toLowerCase();
  if (!normalizedFieldKey) {
    return "";
  }
  if (
    normalizedFieldKey.startsWith("exam") ||
    normalizedFieldKey.includes("exam_")
  ) {
    return "exams";
  }
  if (
    normalizedFieldKey.startsWith("lecture") ||
    normalizedFieldKey.includes("lecture_")
  ) {
    return "lectures";
  }
  if (
    normalizedFieldKey.startsWith("component") ||
    normalizedFieldKey.includes("component") ||
    normalizedFieldKey.includes("subinterval")
  ) {
    return "components";
  }
  return "course";
};

const normalizePlannerFieldDefaultEntry = (entry = {}) => {
  const nextEntry =
    entry && typeof entry === "object" ? toPlainObject(entry) || {} : {};
  return {
    card: normalizePlannerFieldDefaultCard(
      nextEntry?.card || nextEntry?.programMode,
    ),
    field: trimString(nextEntry?.field),
    value: trimString(nextEntry?.value),
  };
};

const normalizePlannerFieldDefaultsToMap = (value = []) => {
  const nextDefaults = buildEmptyPlannerFieldDefaults();
  const upsertEntry = (card, field, fieldValue) => {
    const normalizedCard =
      normalizePlannerFieldDefaultCard(card) ||
      inferPlannerFieldDefaultCardFromFieldKey(field);
    const normalizedField = trimString(field);
    const normalizedValue = trimString(fieldValue);
    if (!normalizedCard || !normalizedField) {
      return;
    }
    if (!nextDefaults[normalizedCard] || typeof nextDefaults[normalizedCard] !== "object") {
      nextDefaults[normalizedCard] = {};
    }
    nextDefaults[normalizedCard][normalizedField] = normalizedValue;
  };
  if (Array.isArray(value)) {
    value.forEach((entry) => {
      const normalizedEntry = normalizePlannerFieldDefaultEntry(entry);
      upsertEntry(
        normalizedEntry.card,
        normalizedEntry.field,
        normalizedEntry.value,
      );
    });
    return nextDefaults;
  }
  if (value && typeof value === "object") {
    Object.entries(toPlainObject(value) || {}).forEach(
      ([cardOrField, fieldValue]) => {
        const nestedCard = normalizePlannerFieldDefaultCard(cardOrField);
        if (
          nestedCard &&
          fieldValue &&
          typeof fieldValue === "object" &&
          !Array.isArray(fieldValue)
        ) {
          Object.entries(fieldValue).forEach(([field, nestedValue]) => {
            upsertEntry(nestedCard, field, nestedValue);
          });
          return;
        }
        const compositeMatch = String(cardOrField || "").match(/^([^._]+)[._](.+)$/);
        if (compositeMatch) {
          upsertEntry(compositeMatch[1], compositeMatch[2], fieldValue);
          return;
        }
        upsertEntry("", cardOrField, fieldValue);
      },
    );
  }
  return nextDefaults;
};

const HARD_CODED_OPTIONS_BY_SELECT_KEY = {
  componentClassOptions: [
    "Class",
    "Lab",
    "Hospital",
    "Pharmacy",
  ],
  weekdayOptions: [
    "Sunday",
    "Monday",
    "Tuesday",
    "Wednesday",
    "Thursday",
    "Friday",
    "Saturday",
  ],
  hourOptions: buildHalfHour12hOptions(),
  termOptions: ["first", "second", "third"],
  academicYearOptions: buildAcademicYearOptions(2000, 2030),
};

const resolvePlannerSelectOptionsKey = (selectID = "") => {
  const normalizedSelectID = trimString(selectID);
  if (!normalizedSelectID) return "";
  const matched = Object.entries(PLANNER_SELECT_OPTIONS_ID_ALIASES).find(
    ([, aliases]) =>
      Array.isArray(aliases) && aliases.includes(normalizedSelectID),
  );
  return matched?.[0] || normalizedSelectID;
};

const removeHardcodedPlannerSelectOptions = (selectKey = "", options = []) => {
  const canonicalSelectKey = resolvePlannerSelectOptionsKey(selectKey);
  const hardcodedSet = new Set(
    normalizePlannerSettingsStringList(
      HARD_CODED_OPTIONS_BY_SELECT_KEY[canonicalSelectKey],
    ),
  );
  if (hardcodedSet.size === 0) {
    return normalizePlannerSettingsStringList(options);
  }
  return normalizePlannerSettingsStringList(options).filter(
    (option) => !hardcodedSet.has(option),
  );
};

const normalizePlannerSettingsFieldDefaults = (value) =>
  normalizePlannerFieldDefaultsToMap(value);

const normalizeMessageFriendEntry = (entry = {}) => {
  const nextEntry =
    entry && typeof entry === "object" ? toPlainObject(entry) || {} : {};
  return {
    friendID: normalizeObjectIdString(nextEntry?.friendID),
    message: trimString(nextEntry?.message),
  };
};

const normalizePlannerRelationshipCondition = (entry = {}) => ({
  id: trimString(entry?.id),
  conditionType:
    trimString(entry?.conditionType || entry?.type) === "rule"
      ? "rule"
      : "field",
  formKey:
    trimString(entry?.formKey || entry?.conditionFormKey) || "savedCourse",
  fieldKey: trimString(entry?.fieldKey || entry?.conditionFieldKey),
  value:
    trimString(entry?.value || entry?.conditionValue) ||
    trimString(
      entry?.[trimString(entry?.fieldKey || entry?.conditionFieldKey)],
    ),
  referencedRelationshipId: trimString(
    entry?.referencedRelationshipId || entry?.relationshipId,
  ),
  logicalOperator:
    trimString(entry?.logicalOperator || entry?.operator).toUpperCase() === "OR"
      ? "OR"
      : "AND",
  negate: Boolean(entry?.negate || entry?.not),
});

const normalizePlannerRelationship = (entry = {}) => {
  const normalizedConditions = Array.isArray(entry?.conditions)
    ? entry.conditions
        .map((conditionEntry) =>
          normalizePlannerRelationshipCondition(
            toPlainObject(conditionEntry) || {},
          ),
        )
        .filter((conditionEntry) =>
          conditionEntry.conditionType === "rule"
            ? Boolean(conditionEntry.referencedRelationshipId)
            : Boolean(conditionEntry.fieldKey) && Boolean(conditionEntry.value),
        )
    : [];
  const fallbackCondition =
    normalizedConditions[0] ||
    normalizePlannerRelationshipCondition(toPlainObject(entry) || {});

  return {
    id: trimString(entry?.id),
    mode:
      trimString(entry?.mode) === "intercomponent"
        ? "intercomponent"
        : trimString(entry?.mode) === "innerComponent"
          ? "innerComponent"
          : trimString(entry?.layerLevel || entry?.layer) === "inter-component"
            ? "intercomponent"
            : "innerComponent",
    targetType:
      trimString(entry?.targetType || entry?.target) === "course"
        ? "course"
        : "component",
    activeComponentClass: trimString(
      entry?.activeComponentClass || entry?.actingComponentClass,
    ),
    affectedComponentClass: trimString(
      entry?.affectedComponentClass || entry?.targetComponentClass,
    ),
    layerLevel:
      trimString(entry?.layerLevel || entry?.layer) === "inter-component"
        ? "inter-component"
        : "inner-component",
    conditionFormKey:
      trimString(entry?.conditionFormKey || fallbackCondition.formKey) ||
      "savedCourse",
    conditionFieldKey: trimString(
      entry?.conditionFieldKey || fallbackCondition.fieldKey,
    ),
    conditionValue: trimString(
      entry?.conditionValue || fallbackCondition.value,
    ),
    conditions:
      normalizedConditions.length > 0
        ? normalizedConditions
        : fallbackCondition.fieldKey && fallbackCondition.value
          ? [fallbackCondition]
          : [],
    resultFormKey: trimString(entry?.resultFormKey) || "savedCourse",
    resultFieldKey: trimString(entry?.resultFieldKey),
    resultValue: trimString(entry?.resultValue),
    relationScope:
      trimString(entry?.relationScope) === "intercomponent" ||
      trimString(entry?.mode) === "intercomponent"
        ? "intercomponent"
        : "innerComponent",
    causeField: trimString(entry?.causeField || entry?.conditionFieldKey),
    causeValue: trimString(entry?.causeValue || entry?.conditionValue),
    effectField: trimString(entry?.effectField || entry?.resultFieldKey),
    effectValue: trimString(entry?.effectValue || entry?.resultValue),
    active:
      typeof entry?.active === "boolean"
        ? entry.active
        : Boolean(entry?.readOnly),
    course_classSelection: trimString(entry?.course_classSelection),
    normativeCourseTerm: trimString(entry?.normativeCourseTerm),
    actualCourseTerm: trimString(entry?.actualCourseTerm),
    course_daySelection: trimString(entry?.course_daySelection),
    course_timeSelection: trimString(entry?.course_timeSelection),
    course_locationBuilding: trimString(entry?.course_locationBuilding),
    course_locationRoom: trimString(entry?.course_locationRoom),
    course_grade: trimString(entry?.course_grade),
    readOnly:
      typeof entry?.readOnly === "boolean"
        ? entry.readOnly
        : Boolean(entry?.active),
  };
};

const normalizeStudyOrganizerSettings = (settings = {}) => {
  const normalizedSettings =
    settings && typeof settings === "object"
      ? toPlainObject(settings) || {}
      : {};
  const SELECT_OPTIONS_KEYS = [
    "componentClassOptions",
    "weekdayOptions",
    "hourOptions",
    "termOptions",
    "academicYearOptions",
    "locationBuildingOptions",
    "locationRoomOptions",
    "lectureInstructorOptions",
    "lectureWriterOptions",
  ];
  const optionsSelectsRaw = normalizedSettings?.optionsSelects;
  const optionsSelectsObject =
    optionsSelectsRaw &&
    typeof optionsSelectsRaw === "object" &&
    !Array.isArray(optionsSelectsRaw)
      ? toPlainObject(optionsSelectsRaw) || {}
      : {};
  const legacyFlatEntries = Array.isArray(optionsSelectsRaw)
    ? optionsSelectsRaw.map((entry) => toPlainObject(entry) || {})
    : [];
  const independentEntries = [
    ...normalizePlannerIndependentOptionsSelects(
      optionsSelectsObject?.independent,
    ),
    ...legacyFlatEntries
      .filter(
        (entry) =>
          String(entry?.mode || "")
            .trim()
            .toLowerCase() !== "dependent" &&
          String(resolvePlannerSelectOptionsKey(entry?.selectID) || "").trim(),
      )
      .map((entry) => ({
        selectID: resolvePlannerSelectOptionsKey(entry?.selectID),
        options: removeHardcodedPlannerSelectOptions(
          entry?.selectID,
          entry?.options,
        ),
      })),
  ].filter((entry) => Boolean(entry.selectID));
  const dependentEntries = [
    ...normalizePlannerDependentOptionsSelects(optionsSelectsObject?.dependent),
    ...legacyFlatEntries
      .filter(
        (entry) =>
          String(entry?.mode || "")
            .trim()
            .toLowerCase() === "dependent" &&
          String(resolvePlannerSelectOptionsKey(entry?.selectID) || "").trim(),
      )
      .flatMap((entry) =>
        (Array.isArray(entry?.dependencyOptions)
          ? entry.dependencyOptions
          : []
        ).map((depEntry) => ({
          dependentSelectID: resolvePlannerSelectOptionsKey(entry?.selectID),
          independentID: resolvePlannerSelectOptionsKey(depEntry?.selectID),
          independentOption: trimString(depEntry?.independentOption),
          dependentOptions: [
            normalizePlannerSettingsStringList(depEntry?.options),
          ],
        })),
      ),
  ];
  const independentMap = new Map(
    independentEntries.map((entry) => [entry.selectID, entry.options]),
  );
  const dependencyMap = new Map();
  dependentEntries.forEach((entry) => {
    const key = String(entry.dependentSelectID || "").trim();
    if (!key) return;
    const list = dependencyMap.get(key) || [];
    list.push({
      selectID: String(entry.independentID || "").trim(),
      independentOption: String(entry.independentOption || "").trim(),
      options: Array.isArray(entry.dependentOptions?.[0])
        ? entry.dependentOptions[0]
        : [],
    });
    dependencyMap.set(key, list);
  });
  const resolveSelectOptions = (key) => {
    const entryFromSchema = independentMap.get(String(key || "").trim());
    if (Array.isArray(entryFromSchema) && entryFromSchema.length > 0) {
      return entryFromSchema;
    }
    const dependentEntries = dependencyMap.get(String(key || "").trim()) || [];
    if (dependentEntries.length > 0) {
      return normalizePlannerSettingsStringList(
        dependentEntries.flatMap((entry) =>
          Array.isArray(entry?.options) ? entry.options : [],
        ),
      );
    }
    return removeHardcodedPlannerSelectOptions(key, normalizedSettings?.[key]);
  };
  const fieldDefaultsSource = normalizedSettings?.fieldDefaults || {};
  const relationshipsSource = Array.isArray(normalizedSettings?.relationships)
    ? normalizedSettings.relationships
    : [];
  const locationRoomOptionsByBuilding = normalizePlannerRoomOptionsByBuilding(
    normalizedSettings?.locationRoomOptionsByBuilding,
  );
  const normalizedLogoFixedClock = trimString(
    normalizedSettings?.logoFixedClock || "9",
  ).replace(/[^\d]/g, "");
  const logoFixedClock = /^[1-9]$|^1[0-2]$/.test(normalizedLogoFixedClock)
    ? normalizedLogoFixedClock
    : "9";
  const voiceControlEnabled =
    typeof normalizedSettings?.voiceControlEnabled === "boolean"
      ? normalizedSettings.voiceControlEnabled
      : false;
  const voiceDictationEnabled =
    typeof normalizedSettings?.voiceDictationEnabled === "boolean"
      ? normalizedSettings.voiceDictationEnabled
      : false;
  const rawMessageFriend =
    normalizedSettings?.messageFriend &&
    typeof normalizedSettings.messageFriend === "object"
      ? toPlainObject(normalizedSettings.messageFriend) || {}
      : {};
  const normalizedMessageFrom = normalizeMessageFriendEntry(
    rawMessageFriend?.from ||
      (rawMessageFriend?.friendID || rawMessageFriend?.message
        ? rawMessageFriend
        : {}),
  );
  const normalizedMessageTo = (
    Array.isArray(rawMessageFriend?.to)
      ? rawMessageFriend.to
      : rawMessageFriend?.to && typeof rawMessageFriend.to === "object"
        ? [rawMessageFriend.to]
        : []
  )
    .map((entry) => normalizeMessageFriendEntry(entry))
    .filter((entry) => Boolean(entry.friendID) && Boolean(entry.message));
  const messageFriend = {
    from: normalizedMessageFrom,
    to: normalizedMessageTo,
  };
  const predictionTool = normalizePredictionToolSettings(
    normalizedSettings?.predictionTool,
  );
  const voiceCommands = normalizeVoiceCommandSettings(
    normalizedSettings?.voiceCommands ||
      normalizedSettings?.voiceCommandEntries ||
      [],
  );
  const voiceDictationNormalizations =
    normalizeVoiceDictationNormalizationSettings(
      normalizedSettings?.voiceDictationNormalizations || [],
    );

  return {
    componentClassOptions: resolveSelectOptions("componentClassOptions"),
    weekdayOptions: resolveSelectOptions("weekdayOptions"),
    hourOptions: resolveSelectOptions("hourOptions"),
    termOptions: resolveSelectOptions("termOptions"),
    academicYearOptions: resolveSelectOptions("academicYearOptions"),
    locationBuildingOptions: resolveSelectOptions("locationBuildingOptions"),
    locationRoomOptions: resolveSelectOptions("locationRoomOptions"),
    lectureInstructorOptions: resolveSelectOptions("lectureInstructorOptions"),
    lectureWriterOptions: resolveSelectOptions("lectureWriterOptions"),
    optionsSelects: SELECT_OPTIONS_KEYS.map((selectID) => {
      const dependentOptions = dependencyMap.get(selectID) || [];
      return {
        selectID,
        mode: dependentOptions.length > 0 ? "dependent" : "independent",
        options: resolveSelectOptions(selectID),
        dependencyOptions: normalizePlannerDependencyOptions(dependentOptions),
      };
    }),
    locationRoomOptionsByBuilding,
    logoMotionEnabled:
      typeof normalizedSettings?.logoMotionEnabled === "boolean"
        ? normalizedSettings.logoMotionEnabled
        : true,
    voiceControlEnabled,
    voiceDictationEnabled,
    logoFixedClock,
    fieldDefaults: normalizePlannerSettingsFieldDefaults(fieldDefaultsSource),
    messageFriend,
    predictionTool,
    voiceCommands,
    voiceDictationNormalizations,
    relationships: relationshipsSource
      .map((entry) => normalizePlannerRelationship(toPlainObject(entry) || {}))
      .filter(
        (entry) =>
          (Array.isArray(entry.conditions) &&
            entry.conditions.length > 0 &&
            Boolean(entry.resultFieldKey) &&
            Boolean(entry.resultValue)) ||
          (entry.mode === "intercomponent" &&
            Boolean(entry.causeField) &&
            Boolean(entry.effectField)) ||
          (entry.mode === "innerComponent" &&
            Boolean(entry.causeField) &&
            Boolean(entry.causeValue) &&
            Boolean(entry.effectField) &&
            Boolean(entry.effectValue)),
      ),
  };
};

const getDefaultStudyOrganizerSettings = () => ({
  componentClassOptions: [],
  weekdayOptions: [],
  hourOptions: [],
  termOptions: [],
  academicYearOptions: [],
  locationBuildingOptions: [],
  locationRoomOptions: [],
  lectureInstructorOptions: [],
  lectureWriterOptions: [],
  optionsSelects: {
    independent: [],
    dependent: [],
  },
  locationRoomOptionsByBuilding: [],
  logoMotionEnabled: true,
  voiceControlEnabled: false,
  voiceDictationEnabled: false,
  logoFixedClock: "9",
  fieldDefaults: buildEmptyPlannerFieldDefaults(),
  messageFriend: {
    from: {
      friendID: undefined,
      message: "",
    },
    to: [],
  },
  relationships: [],
  predictionTool: [],
  voiceCommands: [],
  voiceDictationNormalizations: [],
});

const serializeStudyOrganizerSettingsForStorage = (settings = {}) => {
  const normalizedSettings = normalizeStudyOrganizerSettings(settings);
  const {
    voiceCommandEntries: _voiceCommandEntries,
    ...normalizedSettingsForStorage
  } = normalizedSettings || {};
  const serializedMessageFriendFrom =
    normalizedSettings?.messageFriend &&
    typeof normalizedSettings.messageFriend === "object" &&
    normalizedSettings.messageFriend.from &&
    typeof normalizedSettings.messageFriend.from === "object"
      ? {
          friendID: normalizeObjectIdString(
            normalizedSettings.messageFriend.from.friendID,
          ),
          message: trimString(normalizedSettings.messageFriend.from.message),
        }
      : { message: "" };
  const serializedMessageFriendTo = (
    Array.isArray(normalizedSettings?.messageFriend?.to)
      ? normalizedSettings.messageFriend.to
      : []
  )
    .map((entry) => ({
      friendID: normalizeObjectIdString(entry?.friendID),
      message: trimString(entry?.message),
    }))
    .filter((entry) => Boolean(entry.friendID));
  const serializedPredictionTool = normalizePredictionToolSettings(
    normalizedSettings?.predictionTool,
  );
  const serializedVoiceCommands = normalizeVoiceCommandSettings(
    normalizedSettings?.voiceCommands,
  );
  const serializedVoiceDictationNormalizations =
    normalizeVoiceDictationNormalizationSettings(
      normalizedSettings?.voiceDictationNormalizations,
    );
  const {
    componentClassOptions: _componentClassOptions,
    weekdayOptions: _weekdayOptions,
    hourOptions: _hourOptions,
    termOptions: _termOptions,
    academicYearOptions: _academicYearOptions,
    locationBuildingOptions: _locationBuildingOptions,
    locationRoomOptions: _locationRoomOptions,
    lectureInstructorOptions: _lectureInstructorOptions,
    lectureWriterOptions: _lectureWriterOptions,
    locationRoomOptionsByBuilding: _locationRoomOptionsByBuilding,
    ...normalizedSettingsWithoutFlatSelectOptions
  } = normalizedSettingsForStorage || {};

  const independent = [
    {
      selectID: "componentClassOptions",
      options: normalizedSettings?.componentClassOptions,
    },
    { selectID: "weekdayOptions", options: normalizedSettings?.weekdayOptions },
    { selectID: "hourOptions", options: normalizedSettings?.hourOptions },
    { selectID: "termOptions", options: normalizedSettings?.termOptions },
    {
      selectID: "academicYearOptions",
      options: normalizedSettings?.academicYearOptions,
    },
    {
      selectID: "locationBuildingOptions",
      options: normalizedSettings?.locationBuildingOptions,
    },
    {
      selectID: "locationRoomOptions",
      options: normalizedSettings?.locationRoomOptions,
    },
    {
      selectID: "lectureInstructorOptions",
      options: normalizedSettings?.lectureInstructorOptions,
    },
    {
      selectID: "lectureWriterOptions",
      options: normalizedSettings?.lectureWriterOptions,
    },
  ].map((entry) => ({
    selectID: trimString(entry.selectID),
    options: normalizePlannerSettingsStringList(entry.options),
  }));
  const dependent = (
    Array.isArray(normalizedSettings?.optionsSelects)
      ? normalizedSettings.optionsSelects
      : []
  )
    .flatMap((entry) =>
      String(entry?.mode || "")
        .trim()
        .toLowerCase() === "dependent"
        ? (Array.isArray(entry?.dependencyOptions)
            ? entry.dependencyOptions
            : []
          ).map((dependencyEntry) => ({
            selectID: trimString(entry?.selectID),
            independentID: trimString(dependencyEntry?.selectID),
            independentOption: trimString(dependencyEntry?.independentOption),
            options: [
              normalizePlannerSettingsStringList(dependencyEntry?.options),
            ],
            mode: "dependent",
          }))
        : [],
    )
    .filter(
      (entry) =>
        Boolean(entry.selectID) &&
        Boolean(entry.independentID) &&
        Array.isArray(entry.options?.[0]) &&
        entry.options[0].length > 0,
    );

  return {
    ...normalizedSettingsWithoutFlatSelectOptions,
    optionsSelects: {
      independent,
      dependent,
    },
    messageFriend: {
      from: serializedMessageFriendFrom,
      to: serializedMessageFriendTo,
    },
    predictionTool: serializedPredictionTool,
    voiceCommands: serializedVoiceCommands,
    voiceDictationNormalizations: serializedVoiceDictationNormalizations,
    relationships: (Array.isArray(normalizedSettings.relationships)
      ? normalizedSettings.relationships
      : []
    ).map((entry) => ({
      mode: trimString(entry?.mode),
      causeField: trimString(entry?.causeField),
      causeValue: trimString(entry?.causeValue),
      effectField: trimString(entry?.effectField),
      effectValue: trimString(entry?.effectValue),
      active: Boolean(entry?.active),
    })),
    fieldDefaults: Object.entries(
      normalizePlannerSettingsFieldDefaults(normalizedSettings.fieldDefaults),
    ).flatMap(([card, fields]) =>
      Object.entries(fields || {}).map(([field, value]) => ({
        card,
        field,
        value,
      })),
    ),
  };
};

const PlannerFieldDefaultSchema = new Schema(
  {
    card: { type: String, trim: true, default: "" },
    field: { type: String, trim: true, default: "" },
    value: { type: String, trim: true, default: "" },
  },
  { _id: false, strict: "throw" },
);

const PlannerRelationshipConditionSchema = new Schema(
  {
    id: { type: String, trim: true, default: "" },
    conditionType: {
      type: String,
      enum: ["field", "rule"],
      default: "field",
    },
    formKey: { type: String, trim: true, default: "savedCourse" },
    fieldKey: { type: String, trim: true, default: "" },
    value: { type: String, trim: true, default: "" },
    referencedRelationshipId: { type: String, trim: true, default: "" },
    logicalOperator: {
      type: String,
      enum: ["AND", "OR"],
      default: "AND",
    },
    negate: { type: Boolean, default: false },
  },
  { _id: false },
);

const PlannerIndependentOptionsSelectsSchema = new Schema(
  {
    selectID: { type: String, trim: true, default: "" },
    options: { type: [String], default: [] },
    mode: { type: String },
  },
  { _id: false, strict: "throw" },
);

const PlannerDependentOptionsSelectsSchema = new Schema(
  {
    independentID: { type: String, trim: true, default: "" },
    independentOption: { type: String, trim: true, default: "" },
    selectID: { type: String, trim: true, default: "" },
    options: [{ type: [String], default: [] }],
    mode: { type: String },
  },
  { _id: false, strict: "throw" },
);
const PlannerOptionsSelectsSchema = new Schema(
  {
    independent: { type: [PlannerIndependentOptionsSelectsSchema] },
    dependent: { type: [PlannerDependentOptionsSelectsSchema] },
  },
  { _id: false, strict: "throw" },
);
const PlannerRelationshipSchema = new Schema({
  mode: { type: String },
  causeField: { type: String },
  causeValue: { type: String },
  effectField: { type: String },
  effectValue: { type: String },
  active: { type: Boolean },
});

const MessageFriendEntry = new Schema(
  {
    friendID: {
      type: Schema.Types.ObjectId,
      set: (value) => normalizeObjectIdString(value),
    },
    message: { type: String, default: "" },
  },
  { _id: false },
);

const MessageFriend = new Schema(
  {
    from: { type: MessageFriendEntry, default: {} },
    to: { type: [MessageFriendEntry], default: [] },
  },
  { _id: false },
);

const PlannerVoiceCommandSchema = new Schema(
  {
    idTree: { type: [String], default: [] },
    elementID: { type: String, trim: true, default: "" },
    voiceCommand: { type: String, trim: true, default: "" },
  },
  { _id: false },
);

const PlannerVoiceDictationNormalizationSchema = new Schema(
  {
    letter: { type: String, trim: true, default: "" },
    normalizedLetter: { type: String, trim: true, default: "" },
    condition: {
      type: String,
      enum: ["endOfWord", "startOfWord", "anywhere"],
      default: "endOfWord",
    },
  },
  { _id: false },
);

const locationRoomOptionsByBuilding = new Schema(
  {
    building: { type: String, trim: true, default: "" },
    rooms: { type: [String], default: [] },
  },
  { _id: false },
);

const PlannerPredictionToolEntrySchema = new Schema(
  {
    inputFieldID: { type: String, trim: true, default: "" },
    list: { type: [String], default: [] },
  },
  { _id: false },
);

const PlannerSettingsSchema = new Schema(
  {
    optionsSelects: { type: PlannerOptionsSelectsSchema, default: () => ({ independent: [], dependent: [] }) },
    logoMotionEnabled: { type: Boolean, default: true },
    voiceControlEnabled: { type: Boolean, default: false },
    voiceDictationEnabled: { type: Boolean, default: false },
    aiHelpersEnabled: { type: Boolean, default: false },
    logoFixedClock: { type: String, trim: true, default: "9" },
    fieldDefaults: { type: [PlannerFieldDefaultSchema], default: [] },
    relationships: { type: [PlannerRelationshipSchema], default: [] },
    messageFriend: { type: MessageFriend, default: {} },
    voiceCommands: { type: [PlannerVoiceCommandSchema], default: [] },
    voiceDictationNormalizations: {
      type: [PlannerVoiceDictationNormalizationSchema],
      default: [],
    },
    predictionTool: { type: [PlannerPredictionToolEntrySchema], default: [] },
    rewardSystem: {
      friendID: { type: String, default: "" },
      targetPagesDone: { type: Number, default: null },
    },
  },
  { _id: false, strict: "throw" },
);

export {
  PlannerIndependentOptionsSelectsSchema,
  PlannerDependentOptionsSelectsSchema,
  PlannerRelationshipConditionSchema,
  PlannerFieldDefaultSchema,
  PlannerRelationshipSchema,
  PlannerSettingsSchema,
  normalizePlannerSettingsFieldDefaults,
  resolvePlannerSelectOptionsKey,
  removeHardcodedPlannerSelectOptions,
  getDefaultStudyOrganizerSettings,
  normalizeStudyOrganizerSettings,
  serializeStudyOrganizerSettingsForStorage,
};
