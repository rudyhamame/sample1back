import nodemailer from "nodemailer";
import UserModel from "../compat/UserModel.js";
import {
  normalizeStudyOrganizerSettings,
  serializeStudyOrganizerSettingsForStorage,
} from "../models/MOI/StudyPlanner/StudyOrganizer/settings.js";

const inFlightSweep = { active: false };
const DEFAULT_RECIPIENT_USERNAME = "rudyhamame";
const DEFAULT_SMTP_CONNECTION_TIMEOUT_MS = 30 * 1000;
const DEFAULT_SMTP_GREETING_TIMEOUT_MS = 30 * 1000;
const DEFAULT_SMTP_SOCKET_TIMEOUT_MS = 60 * 1000;

const trimText = (value) => String(value ?? "").trim();
const normalizeUserId = (value) => trimText(value);
const getTimeoutMs = (value, fallback) => {
  const normalized = Number(value);
  return Number.isFinite(normalized) && normalized > 0 ? normalized : fallback;
};

const getRelationshipEntries = (user = {}) => {
  if (!user || typeof user !== "object") {
    return [];
  }
  if (Array.isArray(user.connections) && user.connections.length > 0) {
    return user.connections;
  }
  if (Array.isArray(user.friends) && user.friends.length > 0) {
    return user.friends;
  }
  return [];
};

const getFriendIds = (user = {}) =>
  Array.from(
    new Set(
      getRelationshipEntries(user)
        .map((entry) => {
          if (!entry) {
            return "";
          }
          const candidate =
            typeof entry === "object" && entry !== null
              ? entry.id || entry.userID || entry.friendID || entry._id || entry
              : entry;
          const normalized =
            typeof candidate === "object" && candidate !== null
              ? candidate._id || candidate.id || candidate
              : candidate;
          return normalizeUserId(normalized);
        })
        .filter(Boolean),
    ),
  );

const resolveTransportConfig = () => {
  const host = trimText(process.env.EMAIL_SMTP_HOST || process.env.SMTP_HOST);
  const port = Number(process.env.EMAIL_SMTP_PORT || process.env.SMTP_PORT || 587);
  const username = trimText(process.env.EMAIL_SMTP_USER || process.env.SMTP_USER);
  const password = trimText(process.env.EMAIL_SMTP_PASS || process.env.SMTP_PASS);
  const fromAddress = trimText(
    process.env.EMAIL_FROM_ADDRESS ||
      process.env.SMTP_FROM ||
      process.env.EMAIL_SMTP_USER ||
      process.env.SMTP_USER,
  );
  if (!host || !username || !password || !fromAddress) {
    return null;
  }
  const secureEnv = String(
    process.env.EMAIL_SMTP_SECURE ?? process.env.SMTP_SECURE ?? "",
  )
    .trim()
    .toLowerCase();
  const secure =
    secureEnv === "true"
      ? true
      : secureEnv === "false"
        ? false
        : port === 465;
  return {
    host,
    port,
    secure,
    auth: { user: username, pass: password },
    fromAddress,
  };
};

let cachedTransport = null;
let cachedTransportSignature = "";

const getTransporter = () => {
  const transportConfig = resolveTransportConfig();
  if (!transportConfig) {
    return null;
  }
  const signature = JSON.stringify({
    host: transportConfig.host,
    port: transportConfig.port,
    secure: transportConfig.secure,
    user: transportConfig.auth.user,
    fromAddress: transportConfig.fromAddress,
  });
  if (cachedTransport && cachedTransportSignature === signature) {
    return { transporter: cachedTransport, transportConfig };
  }
  cachedTransportSignature = signature;
  cachedTransport = nodemailer.createTransport({
    host: transportConfig.host,
    port: transportConfig.port,
    secure: transportConfig.secure,
    auth: transportConfig.auth,
    connectionTimeout: getTimeoutMs(
      process.env.EMAIL_SMTP_CONNECTION_TIMEOUT_MS ||
        process.env.SMTP_CONNECTION_TIMEOUT_MS,
      DEFAULT_SMTP_CONNECTION_TIMEOUT_MS,
    ),
    greetingTimeout: getTimeoutMs(
      process.env.EMAIL_SMTP_GREETING_TIMEOUT_MS ||
        process.env.SMTP_GREETING_TIMEOUT_MS,
      DEFAULT_SMTP_GREETING_TIMEOUT_MS,
    ),
    socketTimeout: getTimeoutMs(
      process.env.EMAIL_SMTP_SOCKET_TIMEOUT_MS ||
        process.env.SMTP_SOCKET_TIMEOUT_MS,
      DEFAULT_SMTP_SOCKET_TIMEOUT_MS,
    ),
  });
  return { transporter: cachedTransport, transportConfig };
};

const getPlannerRoot = (user = {}) => {
  const directPlanner =
    user?.memory?.MOI?.studyPlanner && typeof user.memory.MOI.studyPlanner === "object"
      ? user.memory.MOI.studyPlanner
      : null;
  if (directPlanner) {
    return directPlanner;
  }
  if (user?.studyPlanner && typeof user.studyPlanner === "object") {
    return user.studyPlanner;
  }
  return {};
};

const getDateKeyInTimeZone = (value, timeZone) => {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "";
  }
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  return formatter.format(date);
};

const getRelativeDateKeyInTimeZone = (offsetDays, timeZone, now = new Date()) => {
  const base = now instanceof Date ? now : new Date(now);
  const shifted = new Date(base.getTime() + offsetDays * 24 * 60 * 60 * 1000);
  return getDateKeyInTimeZone(shifted, timeZone);
};

const normalizePageNumberList = (value = []) =>
  Array.from(
    new Set(
      (Array.isArray(value) ? value : [])
        .map((entry) => Number(entry))
        .filter((entry) => Number.isFinite(entry) && entry > 0),
    ),
  ).sort((left, right) => left - right);

const isDoneLike = (pageStatus = "") => {
  const normalized = trimText(pageStatus).toLowerCase();
  return normalized === "done" || normalized === "done: revised";
};

const getDisplayName = (user = {}) => {
  const firstname = trimText(user?.profile?.firstname);
  const lastname = trimText(user?.profile?.lastname);
  return (
    [firstname, lastname].filter(Boolean).join(" ").trim() ||
    trimText(user?.auth?.username) ||
    trimText(user?.profile?.email) ||
    "Student"
  );
};

const getEmail = (user = {}) => trimText(user?.profile?.email);

const getRecipientUsername = () =>
  trimText(
    process.env.DAILY_PROGRESS_EMAIL_RECIPIENT_USERNAME ||
      DEFAULT_RECIPIENT_USERNAME,
  ).toLowerCase();

const resolveReportRecipientUser = async () => {
  const recipientUsername = getRecipientUsername();
  if (!recipientUsername) {
    return null;
  }
  return UserModel.findOne({
    $or: [
      { username: recipientUsername },
      { "auth.username": recipientUsername },
      { "identity.atSignup.username": recipientUsername },
      { "identity.personal.username": recipientUsername },
    ],
  }).select("profile.email auth.username connections friends");
};

const resolveReportRecipientEmail = async () => {
  const recipientUser = await resolveReportRecipientUser();
  return getEmail(recipientUser);
};

const shouldRunDailySweepNow = (now = new Date(), timeZone = "UTC") => {
  const date = now instanceof Date ? now : new Date(now);
  if (Number.isNaN(date.getTime())) {
    return false;
  }
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  const parts = formatter.formatToParts(date);
  const hour = Number(parts.find((entry) => entry.type === "hour")?.value || NaN);
  const minute = Number(parts.find((entry) => entry.type === "minute")?.value || NaN);
  return hour === 0 && Number.isFinite(minute) && minute >= 0 && minute < 5;
};

const buildDailyProgressReport = ({
  plannerRoot = {},
  reportDateKey = "",
  timeZone = "UTC",
} = {}) => {
  const programCourses = Array.isArray(plannerRoot?.programCourses)
    ? plannerRoot.programCourses
    : [];
  const programLectures = Array.isArray(plannerRoot?.programLectures)
    ? plannerRoot.programLectures
    : [];
  const programDocuments = Array.isArray(plannerRoot?.programDocuments)
    ? plannerRoot.programDocuments
    : [];
  const programStudySessions = Array.isArray(plannerRoot?.programStudySessions)
    ? plannerRoot.programStudySessions
    : [];

  const lectureInfoById = new Map();
  programLectures.forEach((lectureEntry) => {
    const info =
      lectureEntry?.lectureInfo && typeof lectureEntry.lectureInfo === "object"
        ? lectureEntry.lectureInfo
        : lectureEntry || {};
    const lectureID = trimText(info?.lectureID);
    if (!lectureID) return;
    lectureInfoById.set(lectureID, {
      courseName: trimText(info?.lectureCourseName),
      componentName: trimText(info?.lectureComponentName),
      lectureName: trimText(info?.lectureName),
    });
  });

  const groups = new Map();
  const ensureGroup = (courseName = "", componentName = "") => {
    const normalizedCourseName = trimText(courseName) || "Unknown Course";
    const normalizedComponentName = trimText(componentName) || "Unknown Component";
    const key = `${normalizedCourseName}||${normalizedComponentName}`;
    if (!groups.has(key)) {
      groups.set(key, {
        key,
        courseName: normalizedCourseName,
        componentName: normalizedComponentName,
        documents: [],
        generalDonePages: 0,
        generalRemainingPages: 0,
      });
    }
    return groups.get(key);
  };

  programCourses.forEach((courseEntry) => {
    const courseInfo =
      courseEntry?.courseInfo && typeof courseEntry.courseInfo === "object"
        ? courseEntry.courseInfo
        : courseEntry || {};
    const courseName = trimText(courseInfo?.courseName || courseInfo?.courseCode);
    (Array.isArray(courseEntry?.courseComponents) ? courseEntry.courseComponents : []).forEach(
      (componentEntry) => {
        const componentInfo =
          componentEntry?.componentInfo && typeof componentEntry.componentInfo === "object"
            ? componentEntry.componentInfo
            : componentEntry || {};
        const componentName = trimText(
          componentInfo?.componentName || componentInfo?.componentClass,
        );
        if (courseName && componentName) {
          ensureGroup(courseName, componentName);
        }
      },
    );
  });

  const dailyProgressByDocumentId = new Map();
  programStudySessions.forEach((sessionEntry) => {
    const sessionEnd = sessionEntry?.studySessionEndDate || sessionEntry?.endDate || null;
    const sessionStart = sessionEntry?.studySessionStartDate || sessionEntry?.startDate || null;
    const sessionDateKey = getDateKeyInTimeZone(sessionEnd || sessionStart, timeZone);
    if (!sessionDateKey || sessionDateKey !== reportDateKey) {
      return;
    }
    const achievements = Array.isArray(sessionEntry?.studySessionAchievements)
      ? sessionEntry.studySessionAchievements
      : Array.isArray(sessionEntry?.achievements)
        ? sessionEntry.achievements
        : [];
    achievements.forEach((achievementEntry) => {
      const documentID = trimText(
        achievementEntry?.documentID || achievementEntry?.documentId,
      );
      if (!documentID) return;
      const existing = dailyProgressByDocumentId.get(documentID) || {
        pagesDone: [],
        pagesRevised: [],
      };
      dailyProgressByDocumentId.set(documentID, {
        pagesDone: normalizePageNumberList([
          ...existing.pagesDone,
          ...(Array.isArray(achievementEntry?.pagesDone)
            ? achievementEntry.pagesDone
            : []),
        ]),
        pagesRevised: normalizePageNumberList([
          ...existing.pagesRevised,
          ...(Array.isArray(achievementEntry?.pagesRevised)
            ? achievementEntry.pagesRevised
            : []),
        ]),
      });
    });
  });

  programDocuments.forEach((documentEntry, index) => {
    const info =
      documentEntry?.documentInfo && typeof documentEntry.documentInfo === "object"
        ? documentEntry.documentInfo
        : documentEntry || {};
    const documentID = trimText(info?.documentID) || `document_${index + 1}`;
    const lectureID = trimText(
      documentEntry?.documentLectureID || info?.documentLectureID,
    );
    const lectureInfo = lectureInfoById.get(lectureID) || {};
    const group = ensureGroup(lectureInfo?.courseName, lectureInfo?.componentName);
    const pages = Array.isArray(info?.documentPages) ? info.documentPages : [];
    const totalPagesRaw = Number(info?.documentVolume);
    const totalPages =
      Number.isFinite(totalPagesRaw) && totalPagesRaw > 0
        ? totalPagesRaw
        : pages.length;
    const donePagesCount = pages.filter((pageEntry) => isDoneLike(pageEntry?.pageStatus)).length;
    const remainingPagesCount = Math.max(0, totalPages - donePagesCount);
    const dailyProgress = dailyProgressByDocumentId.get(documentID) || {
      pagesDone: [],
      pagesRevised: [],
    };
    group.generalDonePages += donePagesCount;
    group.generalRemainingPages += remainingPagesCount;
    group.documents.push({
      documentID,
      documentName: trimText(info?.documentName) || documentID,
      pagesDoneToday: normalizePageNumberList(dailyProgress.pagesDone),
      pagesRevisedToday: normalizePageNumberList(dailyProgress.pagesRevised),
      donePagesCount,
      remainingPagesCount,
      totalPages,
    });
  });

  return Array.from(groups.values()).sort((left, right) => {
    const courseCompare = left.courseName.localeCompare(right.courseName);
    if (courseCompare !== 0) return courseCompare;
    return left.componentName.localeCompare(right.componentName);
  });
};

const buildReportText = ({
  displayName = "",
  reportDateKey = "",
  groups = [],
} = {}) => {
  const header = [
    `Daily study progress report for ${displayName || "Student"}`,
    `Report date: ${reportDateKey}`,
    "",
  ];
  if (groups.length === 0) {
    return [...header, "No course components were found in the planner."].join("\n");
  }
  const body = groups.flatMap((group) => {
    const lines = [
      `${group.courseName} -> ${group.componentName}`,
      `  Pages done in general: ${group.generalDonePages}`,
      `  Pages remaining in general: ${group.generalRemainingPages}`,
    ];
    if (group.documents.length === 0) {
      lines.push("  Documents: none");
      lines.push("");
      return lines;
    }
    group.documents
      .sort((left, right) => left.documentName.localeCompare(right.documentName))
      .forEach((documentEntry) => {
        lines.push(`  Document: ${documentEntry.documentName}`);
        lines.push(
          `    Finished during the day: ${
            documentEntry.pagesDoneToday.length > 0
              ? documentEntry.pagesDoneToday.join(", ")
              : "-"
          }`,
        );
        lines.push(
          `    Revised during the day: ${
            documentEntry.pagesRevisedToday.length > 0
              ? documentEntry.pagesRevisedToday.join(", ")
              : "-"
          }`,
        );
        lines.push(`    Pages done in general: ${documentEntry.donePagesCount}`);
        lines.push(`    Pages remaining in general: ${documentEntry.remainingPagesCount}`);
      });
    lines.push("");
    return lines;
  });
  return [...header, ...body].join("\n").trim();
};

const sendMail = async ({ to, subject, text }) => {
  const transportBundle = getTransporter();
  if (!transportBundle) {
    return { sent: false, skipped: "missing-email-config" };
  }
  const { transporter, transportConfig } = transportBundle;
  const primaryMessage = {
    from: transportConfig.fromAddress,
    to,
    subject,
    text,
  };

  try {
    await transporter.sendMail(primaryMessage);
    return { sent: true, sender: "configured-from-address" };
  } catch (primaryError) {
    const fallbackMessage = {
      from: {
        name: "MCTOSH",
        address: transportConfig.auth.user,
      },
      replyTo: transportConfig.fromAddress,
      to,
      subject,
      text,
    };

    try {
      await transporter.sendMail(fallbackMessage);
      return { sent: true, sender: "smtp-auth-user" };
    } catch (fallbackError) {
      fallbackError.cause = primaryError;
      throw fallbackError;
    }
  }
};

export const runDailyStudyProgressEmailSweep = async ({
  now = new Date(),
  timeZone = trimText(process.env.DAILY_PROGRESS_EMAIL_TIMEZONE) || "UTC",
  force = false,
} = {}) => {
  if (inFlightSweep.active) {
    return { sent: 0, skipped: "in-flight" };
  }
  if (!force && !shouldRunDailySweepNow(now, timeZone)) {
    return { sent: 0, skipped: "outside-midnight-window" };
  }
  inFlightSweep.active = true;
  try {
    const reportDateKey = getRelativeDateKeyInTimeZone(-1, timeZone, now);
    if (!reportDateKey) {
      return { sent: 0, skipped: "invalid-report-date" };
    }
    const transportBundle = getTransporter();
    if (!transportBundle) {
      return { sent: 0, skipped: "missing-email-config" };
    }
    const recipientUser = await resolveReportRecipientUser();
    const recipientEmail = getEmail(recipientUser);
    if (!recipientEmail) {
      return { sent: 0, skipped: "missing-report-recipient-email" };
    }
    const recipientFriendIds = getFriendIds(recipientUser);
    if (recipientFriendIds.length === 0) {
      return { sent: 0, skipped: "no-recipient-friends" };
    }
    const users = await UserModel.find({
      _id: { $in: recipientFriendIds },
    }).select(
      "profile.firstname profile.lastname profile.email auth.username memory.MOI.studyPlanner",
    );
    let sent = 0;
    for (const user of users) {
      const plannerRoot = getPlannerRoot(user);
      const hasPlannerContent =
        (Array.isArray(plannerRoot?.programCourses) && plannerRoot.programCourses.length > 0) ||
        (Array.isArray(plannerRoot?.programDocuments) && plannerRoot.programDocuments.length > 0) ||
        (Array.isArray(plannerRoot?.programStudySessions) && plannerRoot.programStudySessions.length > 0);
      if (!hasPlannerContent) {
        continue;
      }
      const settings = normalizeStudyOrganizerSettings(plannerRoot?.settings || {});
      const lastSentDate = trimText(settings?.dailyProgressEmailLastSentDate);
      if (lastSentDate === reportDateKey) {
        continue;
      }
      const groups = buildDailyProgressReport({
        plannerRoot,
        reportDateKey,
        timeZone,
      });
      if (groups.length === 0) {
        continue;
      }
      const text = buildReportText({
        displayName: getDisplayName(user),
        reportDateKey,
        groups,
      });
      try {
        await sendMail({
          to: recipientEmail,
          subject: `Daily study progress report - ${reportDateKey}`,
          text,
        });
        const nextSettings = serializeStudyOrganizerSettingsForStorage({
          ...settings,
          dailyProgressEmailLastSentDate: reportDateKey,
        });
        user.set("memory.MOI.studyPlanner.settings", nextSettings);
        user.markModified("memory.MOI.studyPlanner.settings");
        await user.save();
        sent += 1;
      } catch (error) {
        console.error(
          `Failed to send daily study progress email to user ${trimText(user?._id) || "unknown"}`,
          error,
        );
      }
    }
    return { sent, reportDateKey };
  } finally {
    inFlightSweep.active = false;
  }
};

export const sendDailyStudyProgressEmailForUser = async ({
  userId = "",
  now = new Date(),
  timeZone = trimText(process.env.DAILY_PROGRESS_EMAIL_TIMEZONE) || "UTC",
  reportDateOffsetDays = 0,
  markAsSent = false,
} = {}) => {
  const normalizedUserId = trimText(userId);
  if (!normalizedUserId) {
    throw new Error("User ID is required.");
  }
  const transportBundle = getTransporter();
  if (!transportBundle) {
    throw new Error("Missing email configuration.");
  }
  const user = await UserModel.findById(normalizedUserId).select(
    "profile.firstname profile.lastname profile.email auth.username memory.MOI.studyPlanner",
  );
  if (!user?._id) {
    throw new Error("User not found.");
  }
  const plannerRoot = getPlannerRoot(user);
  const recipientEmail = await resolveReportRecipientEmail();
  if (!recipientEmail) {
    throw new Error(
      `Daily report recipient email is missing for admin ${getRecipientUsername() || DEFAULT_RECIPIENT_USERNAME}.`,
    );
  }
  const reportDateKey = getRelativeDateKeyInTimeZone(
    reportDateOffsetDays,
    timeZone,
    now,
  );
  if (!reportDateKey) {
    throw new Error("Could not resolve report date.");
  }
  const groups = buildDailyProgressReport({
    plannerRoot,
    reportDateKey,
    timeZone,
  });
  const text = buildReportText({
    displayName: getDisplayName(user),
    reportDateKey,
    groups,
  });
  await sendMail({
    to: recipientEmail,
    subject: `Daily study progress report - ${reportDateKey}`,
    text,
  });
  if (markAsSent) {
    const settings = normalizeStudyOrganizerSettings(plannerRoot?.settings || {});
    const nextSettings = serializeStudyOrganizerSettingsForStorage({
      ...settings,
      dailyProgressEmailLastSentDate: reportDateKey,
    });
    user.set("memory.MOI.studyPlanner.settings", nextSettings);
    user.markModified("memory.MOI.studyPlanner.settings");
    await user.save();
  }
  return { sent: 1, reportDateKey };
};
