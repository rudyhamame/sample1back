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
    messageFriend,
    predictionTool,
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
  locationRoomOptionsByBuilding: [],
  logoMotionEnabled: true,
  logoFixedClock: "9",
  fieldDefaults: {},
  messageFriend: {
    from: {
      friendID: undefined,
      message: "",
    },
    to: [],
  },
  relationships: [],
  predictionTool: [],
});

const serializeStudyOrganizerSettingsForStorage = (settings = {}) => {
  const normalizedSettings = normalizeStudyOrganizerSettings(settings);
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

  return {
    ...normalizedSettings,
    messageFriend: {
      from: serializedMessageFriendFrom,
      to: serializedMessageFriendTo,
    },
    predictionTool: serializedPredictionTool,
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
    messageFriend: { type: MessageFriend, default: {} },
    predictionTool: [
      {
        tab: { type: String },
        inputFieldID: { type: String },
        list: [],
      },
    ],
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
