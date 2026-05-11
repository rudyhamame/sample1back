import mongoose from "mongoose";

const { Schema } = mongoose;

const createEmptyObject = () => ({});

const trimString = (value) => String(value || "").trim();

const toPlainObject = (value) =>
  value && typeof value?.toObject === "function" ? value.toObject() : value;

const normalizePlannerSettingsStringList = (value) =>
  Array.isArray(value)
    ? value
        .map((entry) => trimString(entry))
        .filter(Boolean)
        .filter((entry, index, entries) => entries.indexOf(entry) === index)
    : [];

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

const normalizePlannerSettingsFieldDefaults = (value) =>
  Array.isArray(value)
    ? Object.fromEntries(
        value
          .map((entry) => toPlainObject(entry) || {})
          .map((entry) => [
            trimString(entry?.fieldKey),
            trimString(entry?.value),
          ])
          .filter(([fieldKey]) => Boolean(fieldKey)),
      )
    : value && typeof value === "object"
      ? Object.fromEntries(
          Object.entries(toPlainObject(value) || {})
            .map(([fieldKey, fieldValue]) => [
              trimString(fieldKey),
              trimString(fieldValue),
            ])
            .filter(([fieldKey]) => Boolean(fieldKey)),
        )
      : {};

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
    course_classSelection: trimString(entry?.course_classSelection),
    normativeCourseTerm: trimString(entry?.normativeCourseTerm),
    actualCourseTerm: trimString(entry?.actualCourseTerm),
    course_daySelection: trimString(entry?.course_daySelection),
    course_timeSelection: trimString(entry?.course_timeSelection),
    course_locationBuilding: trimString(entry?.course_locationBuilding),
    course_locationRoom: trimString(entry?.course_locationRoom),
    course_grade: trimString(entry?.course_grade),
    readOnly: Boolean(entry?.readOnly),
  };
};

const normalizeStudyOrganizerSettings = (settings = {}) => {
  const normalizedSettings =
    settings && typeof settings === "object"
      ? toPlainObject(settings) || {}
      : {};
  const fieldDefaultsSource =
    normalizedSettings?.fieldDefaults &&
    typeof normalizedSettings.fieldDefaults === "object"
      ? normalizedSettings.fieldDefaults
      : {};
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

  return {
    componentClassOptions: normalizePlannerSettingsStringList(
      normalizedSettings?.componentClassOptions,
    ),
    weekdayOptions: normalizePlannerSettingsStringList(
      normalizedSettings?.weekdayOptions,
    ),
    hourOptions: normalizePlannerSettingsStringList(
      normalizedSettings?.hourOptions,
    ),
    termOptions: normalizePlannerSettingsStringList(
      normalizedSettings?.termOptions,
    ),
    academicYearOptions: normalizePlannerSettingsStringList(
      normalizedSettings?.academicYearOptions,
    ),
    locationBuildingOptions: normalizePlannerSettingsStringList(
      normalizedSettings?.locationBuildingOptions,
    ),
    locationRoomOptions: [],
    locationRoomOptionsByBuilding,
    logoMotionEnabled:
      typeof normalizedSettings?.logoMotionEnabled === "boolean"
        ? normalizedSettings.logoMotionEnabled
        : true,
    logoFixedClock,
    fieldDefaults: normalizePlannerSettingsFieldDefaults(fieldDefaultsSource),
    relationships: relationshipsSource
      .map((entry) => normalizePlannerRelationship(toPlainObject(entry) || {}))
      .filter(
        (entry) =>
          Array.isArray(entry.conditions) &&
          entry.conditions.length > 0 &&
          Boolean(entry.resultFieldKey) &&
          Boolean(entry.resultValue),
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
  locationRoomOptionsByBuilding: [],
  logoMotionEnabled: true,
  logoFixedClock: "9",
  fieldDefaults: {},
  relationships: [],
});

const serializeStudyOrganizerSettingsForStorage = (settings = {}) => {
  const normalizedSettings = normalizeStudyOrganizerSettings(settings);

  return {
    ...normalizedSettings,
    fieldDefaults: Object.entries(normalizedSettings.fieldDefaults || {}).map(
      ([fieldKey, value]) => ({
        fieldKey,
        value,
      }),
    ),
  };
};

const PlannerFieldDefaultSchema = new Schema(
  {
    fieldKey: { type: String, trim: true, default: "" },
    value: { type: String, trim: true, default: "" },
  },
  { _id: false },
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

const PlannerRelationshipSchema = new Schema(
  {
    id: { type: String, trim: true, default: "" },
    targetType: {
      type: String,
      enum: ["component", "course"],
      default: "component",
    },
    activeComponentClass: { type: String, trim: true, default: "" },
    affectedComponentClass: { type: String, trim: true, default: "" },
    layerLevel: {
      type: String,
      enum: ["inner-component", "inter-component"],
      default: "inner-component",
    },
    conditionFormKey: { type: String, trim: true, default: "savedCourse" },
    conditionFieldKey: { type: String, trim: true, default: "" },
    conditionValue: { type: String, trim: true, default: "" },
    conditions: { type: [PlannerRelationshipConditionSchema], default: [] },
    resultFormKey: { type: String, trim: true, default: "savedCourse" },
    resultFieldKey: { type: String, trim: true, default: "" },
    resultValue: { type: String, trim: true, default: "" },
    course_classSelection: { type: String, trim: true, default: "" },
    normativeCourseTerm: { type: String, trim: true, default: "" },
    actualCourseTerm: { type: String, trim: true, default: "" },
    course_daySelection: { type: String, trim: true, default: "" },
    course_timeSelection: { type: String, trim: true, default: "" },
    course_locationBuilding: { type: String, trim: true, default: "" },
    course_locationRoom: { type: String, trim: true, default: "" },
    course_grade: { type: String, trim: true, default: "" },
    readOnly: { type: Boolean, default: false },
  },
  { _id: false },
);

const PlannerSettingsSchema = new Schema(
  {
    componentClassOptions: { type: [String], default: [] },
    weekdayOptions: { type: [String], default: [] },
    hourOptions: { type: [String], default: [] },
    termOptions: { type: [String], default: [] },
    academicYearOptions: { type: [String], default: [] },
    locationBuildingOptions: { type: [String], default: [] },
    locationRoomOptions: { type: [String], default: [] },
    locationRoomOptionsByBuilding: {
      type: [
        new Schema(
          {
            building: { type: String, trim: true, default: "" },
            rooms: { type: [String], default: [] },
          },
          { _id: false },
        ),
      ],
      default: [],
    },
    logoMotionEnabled: { type: Boolean, default: true },
    logoFixedClock: { type: String, trim: true, default: "9" },
    fieldDefaults: { type: [PlannerFieldDefaultSchema], default: [] },
    relationships: { type: [PlannerRelationshipSchema], default: [] },
  },
  { _id: false, strict: "throw" },
);

export {
  PlannerRelationshipConditionSchema,
  PlannerFieldDefaultSchema,
  PlannerRelationshipSchema,
  PlannerSettingsSchema,
  getDefaultStudyOrganizerSettings,
  normalizeStudyOrganizerSettings,
  serializeStudyOrganizerSettingsForStorage,
};
