// --- Video Upload Route for /api/user/videoUpload ---
import multer from "multer";
import fs from "fs";
import compressVideo from "../helpers/compressVideo.js";
import { emitCompressionProgress } from "../helpers/progressSocket.js";
// ...existing code...
const upload = multer({ dest: "uploads/" });
//For user data
import express from "express";
import { execFileSync } from "child_process";
import crypto from "crypto";
import cloudinary from "../helpers/cloudinary.js";
import path from "path";
import { fileURLToPath } from "url";
import UserModel from "../compat/UserModel.js";
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
  removeLectureFromPlanner,
  updateCourseInPlanner,
  updateCoursePagesInPlanner,
  updateStudyPlanAidInPlanner,
  updateLectureInPlanner,
} from "./user/helpers/studyPlannerService.js";
const UserRouter = express.Router();

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

const getSubjectAuth = (user) =>
  user?.auth && typeof user.auth === "object" ? user.auth : {};

const getSubjectBio = (user) => {
  if (user?.profile && typeof user.profile === "object") {
    return user.profile;
  }

  return user?.bio && typeof user.bio === "object" ? user.bio : {};
};

const isProfileComplete = (user) => {
  const profile = getSubjectBio(user);

  // Check required fields
  if (
    !profile.firstname?.trim() ||
    !profile.lastname?.trim() ||
    !profile.email?.trim() ||
    !profile.phone?.trim() ||
    !profile.dob ||
    !profile.hometown?.Country?.trim() ||
    !profile.hometown?.City?.trim() ||
    !profile.bio?.trim()
  ) {
    return false;
  }

  // Check if user has either studying or working info
  const studying = profile.studying;
  const working = profile.working;
  const studyingTime =
    studying?.time && typeof studying.time === "object" ? studying.time : {};
  const currentDate =
    studyingTime?.currentDate && typeof studyingTime.currentDate === "object"
      ? studyingTime.currentDate
      : {};

  const hasStudyingInfo =
    studying &&
    (studying.university?.trim() || studying.program?.trim()) &&
    studying.program?.trim() &&
    studying.university?.trim() &&
    (currentDate.term?.trim() || studying.term?.trim());

  const hasWorkingInfo =
    working &&
    (working.company?.trim() || working.position?.trim()) &&
    working.company?.trim() &&
    working.position?.trim();

  return hasStudyingInfo || hasWorkingInfo;
};

const getSubjectStatus = (user) =>
  user?.status && typeof user.status === "object" ? user.status : {};

const getLegacyProfilePicture = (user) => {
  const bio = getSubjectBio(user);
  const pictureRoot =
    bio?.picture && typeof bio.picture === "object" ? bio.picture : {};
  const profilePicRoot =
    pictureRoot?.profilePic && typeof pictureRoot.profilePic === "object"
      ? pictureRoot.profilePic
      : {};
  const profilePic =
    profilePicRoot?.index && typeof profilePicRoot.index === "object"
      ? profilePicRoot.index
      : bio?.profilePic && typeof bio.profilePic === "object"
        ? bio.profilePic
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
      year: String(bio?.studying?.time?.currentDate?.year || "").trim(),
      studyYear: String(bio?.studying?.time?.currentDate?.year || "").trim(),
      term: String(
        bio?.studying?.time?.currentDate?.term || bio?.studying?.term || "",
      ).trim(),
      profession: "",
      profilePicture: {
        picture: getLegacyProfilePicture(user),
        profilePictureViewport: getLegacyProfilePictureViewport(user),
      },
    },
    status: {
      isLoggedIn: status?.value === "online",
      lastSeenAt: status?.updatedAt || null,
      loggedInAt: status?.value === "online" ? status?.updatedAt || null : null,
      loggedOutAt:
        status?.value === "offline" ? status?.updatedAt || null : null,
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

      // Build video object for user.memory.files.local.videos (flat identity)
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

      // Push to user.memory.files.local.videos
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
  const identityStatus = identity?.status || {};
  const profilePicture = personal?.profilePicture?.picture || {};

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
      ...identityStatus,
      isConnected: Boolean(
        existingStatus?.isConnected ?? identityStatus?.isLoggedIn,
      ),
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

  return {
    ...mappedUser,
    _id: String(mappedUser?._id || friendId).trim(),
    id: friendId,
    userID: friendId,
    userMode,
    relationship: {
      userMode,
    },
  };
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
    existing.userID = normalizedOtherId;
    existing.userMode = normalizedMode;
    return true;
  }

  // If the relationship isn't in the array yet (or it's a legacy ObjectId),
  // add a proper relationship entry.
  user.connections.push({
    kind: "friend",
    id: normalizedOtherId,
    mode: normalizedMode,
    messages: [],
  });
  return true;
};

const CLINICAL_REALITY_HTML_MAX_LENGTH = 250000;
const VISIT_LOG_OWNER_USERNAME = "rudyhamame";
const VISIT_LOG_LIMIT = 200;
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

  return {
    url,
    publicId,
    assetId: String(
      image?.assetId || image?.asset_id || image?._id || "",
    ).trim(),
    folder: String(image?.folder || "").trim(),
    resourceType,
    mimeType,
    width: Number(image?.width) || 0,
    height: Number(image?.height) || 0,
    format: String(image?.format || "").trim(),
    bytes: Number(image?.bytes) || 0,
    duration: Number(image?.duration) || 0,
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

const buildHumanTraceMediaItem = (media, resourceType = "image") => ({
  index: {
    fileName: String(media?.fileName || media?.publicId || "").trim(),
    mimeType: String(media?.mimeType || "").trim(),
    contentHash: String(media?.contentHash || "").trim(),
    resourceType:
      String(media?.resourceType || resourceType).trim() || resourceType,
  },
  metadata: {
    width: Number.isFinite(Number(media?.width)) ? Number(media.width) : null,
    height: Number.isFinite(Number(media?.height))
      ? Number(media.height)
      : null,
    format: String(media?.format || "").trim(),
    bytes: Number.isFinite(Number(media?.bytes)) ? Number(media.bytes) : null,
    duration: Number.isFinite(Number(media?.duration))
      ? Number(media.duration)
      : null,
    totalPages: Number.isFinite(Number(media?.totalPages))
      ? Number(media.totalPages)
      : null,
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

const getHumanTraceMediaBucket = (trace, resourceType = "image") => {
  const human =
    trace?.user && typeof trace.user === "object"
      ? trace.user
      : trace?.human && typeof trace.human === "object"
        ? trace.human
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

  return bucket.map((item) => ({
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
    createdAt: item?.metadata?.createdAt || new Date(),
    updatedAt: item?.metadata?.updatedAt || new Date(),
  }));
};

const getMemoryLocalImages = (memoryDoc) =>
  Array.isArray(memoryDoc?.traces)
    ? memoryDoc.traces.flatMap((trace) => getHumanTraceMediaBucket(trace, "image"))
    : memoryDoc?.traces && typeof memoryDoc.traces === "object"
      ? getHumanTraceMediaBucket(memoryDoc.traces, "image")
      : Array.isArray(memoryDoc?.files?.local?.images)
        ? memoryDoc.files.local.images
        : [];

const getMemoryLocalVideos = (memoryDoc) =>
  Array.isArray(memoryDoc?.traces)
    ? memoryDoc.traces.flatMap((trace) => getHumanTraceMediaBucket(trace, "video"))
    : memoryDoc?.traces && typeof memoryDoc.traces === "object"
      ? getHumanTraceMediaBucket(memoryDoc.traces, "video")
      : Array.isArray(memoryDoc?.files?.local?.videos)
        ? memoryDoc.files.local.videos
        : [];

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
  const tracesArray = Array.isArray(memoryDoc?.traces) ? memoryDoc.traces : [];
  const traceRoot =
    tracesArray[0] && typeof tracesArray[0] === "object"
      ? tracesArray[0]
      : memoryDoc?.traces && typeof memoryDoc.traces === "object"
        ? memoryDoc.traces
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

  if (Array.isArray(memoryDoc?.traces)) {
    memoryDoc.traces = [
      nextRoot,
      ...memoryDoc.traces.slice(1).filter((entry) => entry && typeof entry === "object"),
    ];
    return;
  }

  memoryDoc.traces = [nextRoot];
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

const getFrontendLastUpdated = () => {
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
    return null;
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
    "auth.username": req.body.username,
  })
    .exec()
    .then((user) => {
      if (user) {
        bcrypt.compare(
          req.body.password,
          user.auth?.password || "",
          (err, result) => {
            if (result) {
              const now = new Date();
              setUserConnectionState(user, {
                isConnected: true,
                at: now,
                markLogin: true,
              });

              user
                .save()
                .then((updatedUser) => {
                  emitUserRefresh(
                    io,
                    getUserAndFriendIds(updatedUser),
                    "connection:changed",
                    {
                      isConnected: true,
                      targetUserId: String(updatedUser._id),
                    },
                  );

                  const profileComplete = isProfileComplete(updatedUser);

                  if (!profileComplete) {
                    // Return 202 (Accepted) to indicate profile completion is required
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
                  res.status(201).json({
                    token: token,
                    user: updatedUser,
                  });
                })
                .catch(next);
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

UserRouter.post("/logout", checkAuth, function (req, res, next) {
  const io = req.app.locals.io;

  UserModel.findById(req.authentication.userId)
    .then((user) => {
      if (!user) {
        res.status(404).json({
          message: "User not found.",
        });
        return null;
      }

      setUserConnectionState(user, {
        isConnected: false,
        at: new Date(),
      });

      return user.save();
    })
    .then((user) => {
      if (!user) {
        return null;
      }

      emitUserRefresh(io, getUserAndFriendIds(user), "connection:changed", {
        isConnected: false,
        targetUserId: String(user._id),
      });

      return res.status(200).json({
        ok: true,
        userId: String(user._id),
      });
    })
    .catch(next);
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
      isConnected: true,
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
    const dobInput = String(req.body?.dob || "").trim();
    const hometown = req.body?.hometown;
    const bio = String(req.body?.bio || "").trim();
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
      !lastname ||
      !email ||
      !phone ||
      !dobInput ||
      !hometown?.Country ||
      !hometown?.City ||
      !bio
    ) {
      return res.status(400).json({
        message:
          "First name, last name, email, phone, date of birth, country, city, and bio are required.",
      });
    }

    // Check if user provided studying or working info
    const isStudying = studying && (studying.university || studying.program);
    const isWorking = working && (working.company || working.position);

    if (isStudying) {
      const studyingTime =
        studying?.time && typeof studying.time === "object" ? studying.time : {};
      const startDate =
        studyingTime?.startDate && typeof studyingTime.startDate === "object"
          ? studyingTime.startDate
          : {};
      const currentDate =
        studyingTime?.currentDate &&
        typeof studyingTime.currentDate === "object"
          ? studyingTime.currentDate
          : {};
      const hasCurrentTerm = Boolean(
        String(currentDate.term || studying.term || "").trim(),
      );

      if (!studying.program || !studying.university || !hasCurrentTerm) {
        return res.status(400).json({
          message:
            "Program, university, and current term are required for education information.",
        });
      }

      if (
        (startDate.startYear !== undefined && startDate.startYear !== null) ||
        String(startDate.startTerm || "").trim() ||
        (currentDate.year !== undefined && currentDate.year !== null) ||
        String(currentDate.term || "").trim()
      ) {
        if (
          !normalizeNullableNumber(startDate.startYear, null) ||
          !String(startDate.startTerm || "").trim() ||
          !normalizeNullableNumber(currentDate.year, null) ||
          !String(currentDate.term || "").trim()
        ) {
          return res.status(400).json({
            message:
              "If studying time is provided, start year/term and current year/term are all required.",
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

    if (!isStudying && !isWorking) {
      return res.status(400).json({
        message: "Please provide either education or professional information.",
      });
    }

    const parsedDob = new Date(dobInput);
    if (Number.isNaN(parsedDob.getTime())) {
      return res.status(400).json({
        message: "Please provide a valid date of birth.",
      });
    }

    const existingEmailUser = await UserModel.findOne({
      "profile.email": email,
      _id: { $ne: req.authentication.userId },
    }).select("_id");

    if (existingEmailUser) {
      return res.status(409).json({
        message: "That email address is already in use.",
      });
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
    user.profile.dob = parsedDob;
    user.profile.hometown = {
      Country: hometown.Country,
      City: hometown.City,
    };
    user.profile.bio = bio;

    if (isStudying) {
      const studyingTime =
        studying?.time && typeof studying.time === "object" ? studying.time : {};
      const startDate =
        studyingTime?.startDate && typeof studyingTime.startDate === "object"
          ? studyingTime.startDate
          : {};
      const currentDate =
        studyingTime?.currentDate &&
        typeof studyingTime.currentDate === "object"
          ? studyingTime.currentDate
          : {};
      const normalizedStartYear = normalizeNullableNumber(
        startDate.startYear,
        null,
      );
      const normalizedCurrentYear = normalizeNullableNumber(
        currentDate.year,
        null,
      );
      const normalizedCurrentTerm = String(
        currentDate.term || studying.term || "",
      ).trim();
      const normalizedStartTerm = String(startDate.startTerm || "").trim();

      user.profile.studying = {
        university: studying.university,
        program: studying.program,
        programStartYear:
          studying.programStartYear ||
          studying.academicYear ||
          (normalizedStartYear ? `${normalizedStartYear}/${normalizedStartYear + 1}` : ""),
        term: normalizedCurrentTerm,
        language: studying.language || "",
        time: {
          totalYears: normalizeNullableNumber(studyingTime.totalYears, 0) || 0,
          currentAcademicYear: normalizeNullableNumber(
            studyingTime.currentAcademicYear,
            null,
          ),
          startDate: {
            startYear: normalizedStartYear,
            startTerm: normalizedStartTerm,
          },
          currentDate: {
            year: normalizedCurrentYear,
            term: normalizedCurrentTerm,
          },
        },
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
        { new: true },
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

////////UpdateUser
UserRouter.get("/update/:id", async function (req, res, next) {
  try {
    const profile = await UserModel.findById(req.params.id)
      .select(
        "auth profile bio settings connections status clinicalReality memory",
      )
      .lean();

    if (!profile) {
      return res.status(404).json({
        message: "User not found.",
      });
    }

    const memoryDoc = await findUserMemoryLean(profile._id);
    const imageGallery = getMemoryLocalGallery(memoryDoc);
    const flattenedCourses = flattenMemoryCoursesForPlanner(
      memoryDoc?.studyPlanner?.studyOrganizer?.courses,
      memoryDoc?.studyPlanner?.studyOrganizer?.exams,
    );
    const flattenedLectures = flattenMemoryLecturesForPlanner(
      memoryDoc?.studyPlanner?.studyOrganizer?.courses,
    );

    const profilePicture = getLegacyProfilePicture(profile);
    const profilePictureViewport = getLegacyProfilePictureViewport(profile);
    const homeDrawing = {
      draftPaths: [],
      appliedPaths: [],
      textItems: [],
      updatedAt: null,
    };

    const friendEntries = Array.isArray(profile.connections)
      ? profile.connections.map((entry) => ({
          userID: entry?.id || null,
          userMode: entry?.mode || "stranger",
          ...entry,
        }))
      : [];
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
              "profile.profilePic",
              "profile.viewport",
              "status",
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

    return res.status(200).json({
      identity: buildLegacyIdentity(profile),
      friends: friends,
      settings: profile.settings || {},
      memory: {
        ...(memoryDoc || {}),
        courses: flattenedCourses,
        lectures: flattenedLectures,
      },
      clinicalReality: profile.clinicalReality,
      media: {
        profilePicture,
        profilePictureViewport,
        imageGallery,
        homeDrawing,
      },
    });
  } catch (error) {
    return next(error);
  }
});

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

      const updatedStudyPlanAid = updateStudyPlanAidInPlanner(
        memoryDoc,
        req.body,
      );
      await memoryDoc.save();

      return res.status(201).json({
        studyPlanAid: getStudyPlanAid(memoryDoc),
        updatedStudyPlanAid,
      });
    } catch (error) {
      return next(error);
    }
  },
);

UserRouter.put("/profile", checkAuth, async function (req, res, next) {
  try {
    const user = await UserModel.findById(req.authentication.userId)
      .select(
        [
          "auth.username",
          "profile.firstname",
          "profile.lastname",
          "profile.bio",
          "profile.studying.program",
          "profile.studying.university",
          "profile.studying.faculty",
          "profile.studying.time.currentDate.year",
          "profile.studying.time.currentDate.term",
          "profile.picture.profilePic.viewport",
        ].join(" "),
      )
      .lean();

    if (!user) {
      return res.status(404).json({
        message: "User not found.",
      });
    }

    const auth = getSubjectAuth(user);
    const bio = getSubjectBio(user);
    const aiSettingsDoc = await findAiSettingsLean(
      req.authentication.userId,
      "settings.aiProvider settings.languageOfReply settings.inputType settings.outputType",
    );
    const aiSettings = aiSettingsDoc?.settings || {};

    const nextFirstname = String(
      req.body?.firstname ?? bio.firstname ?? "",
    ).trim();
    const nextLastname = String(
      req.body?.lastname ?? bio.lastname ?? "",
    ).trim();
    const nextUsername = String(
      req.body?.username ?? auth.username ?? "",
    ).trim();

    if (!nextFirstname || !nextLastname || !nextUsername) {
      return res.status(400).json({
        message: "First name, last name, and username are required.",
      });
    }

    if (nextUsername !== String(auth.username || "").trim()) {
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
      req.body?.aiProvider ?? aiSettings.aiProvider ?? "openai",
    )
      .trim()
      .toLowerCase();

    const nextAiProvider = ["openai", "groq", "gemini"].includes(
      requestedAiProvider,
    )
      ? requestedAiProvider
      : "openai";

    const nextProgram = String(
      req.body?.program ?? bio?.studying?.program ?? "",
    ).trim();
    const nextUniversity = String(
      req.body?.university ?? bio?.studying?.university ?? "",
    ).trim();
    const nextFaculty = String(req.body?.faculty ?? bio?.studying?.faculty ?? "").trim();
    const nextStudyYear = String(
      req.body?.studyYear ?? bio?.studying?.time?.currentDate?.year ?? "",
    ).trim();
    const nextTerm = String(
      req.body?.term ?? bio?.studying?.time?.currentDate?.term ?? "",
    ).trim();
    const nextBio = String(req.body?.bio ?? bio?.bio ?? "").trim();
    const nextStudyYearNumber = Number(nextStudyYear);

    const updateSet = {
      "profile.firstname": nextFirstname,
      "profile.lastname": nextLastname,
      "profile.bio": nextBio,
      "auth.username": nextUsername,
      "profile.studying.program": nextProgram,
      "profile.studying.university": nextUniversity,
      "profile.studying.faculty": nextFaculty,
      "profile.studying.time.currentDate.year":
        nextStudyYear === "" || !Number.isFinite(nextStudyYearNumber)
          ? null
          : nextStudyYearNumber,
      "profile.studying.time.currentDate.term": nextTerm || null,
    };

    let nextProfilePictureViewport = getLegacyProfilePictureViewport(user) || {
      scale: 1,
      offsetX: 0,
      offsetY: 0,
      updatedAt: null,
    };

    const requestedViewport = req.body?.profilePictureViewport;
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

    let nextHomeDrawing = {
      draftPaths: [],
      appliedPaths: [],
      textItems: [],
      updatedAt: null,
    };

    const requestedHomeDrawing = req.body?.homeDrawing;
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

    await upsertAiSettings(req.authentication.userId, {
      aiProvider: nextAiProvider,
      updatedAt: new Date(),
    });

    const responseInfo = {
      firstname: nextFirstname,
      lastname: nextLastname,
      username: nextUsername,
      bio: nextBio,
      faculty: nextFaculty,
      program: nextProgram,
      university: nextUniversity,
      studyYear: nextStudyYear,
      term: nextTerm,
      aiProvider: nextAiProvider,
    };

    const responseMedia = {
      profilePictureViewport: nextProfilePictureViewport,
      homeDrawing: nextHomeDrawing,
    };

    return res.status(200).json({
      message: "Personal information updated.",
      info: responseInfo,
      media: responseMedia,
    });
  } catch (error) {
    next(error);
  }
});

UserRouter.get("/image-gallery", checkAuth, async function (req, res, next) {
  try {
    const user = await UserModel.findById(req.authentication.userId);

    if (!user) {
      return res.status(404).json({
        message: "User not found.",
      });
    }

    const memoryDoc = await ensureUserMemoryDoc(user);
    const imageGallery = getMemoryLocalGallery(memoryDoc);
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
      folder: req.body?.folder,
      resourceType: req.body?.resourceType,
      mimeType: req.body?.mimeType,
      width: req.body?.width,
      height: req.body?.height,
      format: req.body?.format,
      bytes: req.body?.bytes,
      duration: req.body?.duration,
      createdAt: req.body?.createdAt || new Date(),
    });

    if (!normalizedImage) {
      return res.status(400).json({
        message: "A valid uploaded media file is required.",
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

    const existingGallery = getMemoryLocalGallery(memoryDoc);
    const dedupedImages = existingGallery.filter(
      (image) => image.publicId !== normalizedImage.publicId,
    );
    const nextImageGallery = sortGalleryImages([
      normalizedImage,
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
      user.profile.profilePic = {
        url: selectedImage.url,
        publicId: selectedImage.publicId,
        mimeType: selectedImage.mimeType || "",
        width: selectedImage.width || null,
        height: selectedImage.height || null,
      };

      await user.save();

      return res.status(200).json({
        message: "Profile picture updated.",
        profilePicture: getLegacyProfilePicture(user),
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
      user?.profile?.profilePic?.publicId ||
        user?.bio?.profilePic?.publicId ||
        "",
    ).trim();
    const currentProfileUrl = String(
      user?.profile?.profilePic?.url || user?.bio?.profilePic?.url || "",
    ).trim();
    const deletedImageUrl = String(imageToDelete?.url || "").trim();

    setMemoryLocalGallery(memoryDoc, nextImageGallery);
    const shouldSaveUser =
      currentProfilePublicId === publicId ||
      (deletedImageUrl && currentProfileUrl === deletedImageUrl);

    if (shouldSaveUser) {
      user.profile = user.profile || {};

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

      user.profile.profilePic = nextProfilePicture;

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

UserRouter.get("/clinical-reality", checkAuth, async function (req, res, next) {
  try {
    const user = await UserModel.findById(req.authentication.userId).select(
      "clinicalReality",
    );

    if (!user) {
      return res.status(404).json({
        message: "User not found.",
      });
    }

    return res.status(200).json({
      clinicalReality: user.clinicalReality || { html: "", updatedAt: null },
    });
  } catch (error) {
    return next(error);
  }
});

UserRouter.get(
  "/clinical-reality/public/:username",
  async function (req, res, next) {
    try {
      const user = await UserModel.findOne({
        "auth.username": req.params.username,
      }).select("clinicalReality");

      if (!user) {
        return res.status(404).json({
          message: "User not found.",
        });
      }

      return res.status(200).json({
        clinicalReality: user.clinicalReality || { html: "", updatedAt: null },
      });
    } catch (error) {
      return next(error);
    }
  },
);

UserRouter.put("/clinical-reality", checkAuth, async function (req, res, next) {
  try {
    const html = String(req.body?.html || "");

    if (html.length > CLINICAL_REALITY_HTML_MAX_LENGTH) {
      return res.status(413).json({
        message: "Clinical reality content is too large.",
      });
    }

    const updatedUser = await UserModel.findByIdAndUpdate(
      req.authentication.userId,
      {
        clinicalReality: {
          html,
          updatedAt: new Date(),
        },
      },
      {
        new: true,
      },
    ).select("clinicalReality");

    if (!updatedUser) {
      return res.status(404).json({
        message: "User not found.",
      });
    }

    return res.status(200).json({
      message: "Clinical reality saved.",
      clinicalReality: updatedUser.clinicalReality,
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

UserRouter.get("/app-last-updated", function (req, res) {
  const committedAt = getFrontendLastUpdated();
  const cloudinary = getPublicCloudinaryStatus();

  if (!committedAt) {
    return res.status(200).json({
      committedAt: null,
      cloudinary,
    });
  }

  return res.status(200).json({
    committedAt,
    cloudinary,
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
  UserModel.distinct("profile.hometown.City", {
    "profile.hometown.City": { $exists: true, $ne: "" },
  })
    .then((cities) => {
      return res.status(200).json({
        cities: cities.filter((city) => city && city.trim()).sort(),
      });
    })
    .catch((error) => {
      return next(error);
    });
});

/////Searching for a user to be a friend
UserRouter.get("/searchUsers/:name", function (req, res, next) {
  UserModel.find({})
    .select("auth.username bio.firstname bio.lastname bio.profilePic status")
    .then((users) => {
      const array = [];
      const searchTerm = String(req.params.name || "")
        .trim()
        .toLowerCase();
      users.forEach((user) => {
        const firstname = String(user?.bio?.firstname || "").toLowerCase();
        const lastname = String(user?.bio?.lastname || "").toLowerCase();
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
    .select("auth.username bio.firstname bio.lastname bio.profilePic")
    .then((user) => {
      if (!user) {
        return res.status(404).json({
          message: "Doctor profile not found.",
        });
      }

      return res.status(200).json({
        username: user.auth?.username || "",
        firstname: user.bio?.firstname || "",
        lastname: user.bio?.lastname || "",
        profilePicture: String(user?.bio?.profilePic?.url || "").trim(),
      });
    })
    .catch(next);
});

UserRouter.get("/visit-log", checkAuth, async function (req, res, next) {
  try {
    if (req.authentication?.username !== VISIT_LOG_OWNER_USERNAME) {
      return res.status(403).json({
        message: "You are not allowed to view the visit log.",
      });
    }

    const owner = await UserModel.findOne({
      "auth.username": VISIT_LOG_OWNER_USERNAME,
    })
      .select("visitLog")
      .lean();

    const visitLog = Array.isArray(owner?.visitLog) ? owner.visitLog : [];
    const sortedLog = visitLog
      .slice()
      .sort(
        (a, b) =>
          new Date(b?.visitedAt || 0).getTime() -
          new Date(a?.visitedAt || 0).getTime(),
      )
      .slice(0, VISIT_LOG_LIMIT);

    return res.status(200).json({
      visitLog: sortedLog,
    });
  } catch (error) {
    return next(error);
  }
});

UserRouter.post("/visit-log", async function (req, res, next) {
  try {
    const ip = getRequestIp(req);
    const country = getCountryFromIp(ip);

    const visitLogOwner = await UserModel.findOne({
      "auth.username": VISIT_LOG_OWNER_USERNAME,
    }).select("_id visitLog");

    if (!visitLogOwner) {
      return res.status(404).json({
        message: "Visit log owner not found.",
      });
    }

    visitLogOwner.visitLog = Array.isArray(visitLogOwner.visitLog)
      ? visitLogOwner.visitLog
      : [];

    visitLogOwner.visitLog.unshift({
      ip,
      country,
      visitedAt: new Date(),
    });

    // Keep it bounded since this is now embedded in the `subjects` collection.
    visitLogOwner.visitLog = visitLogOwner.visitLog.slice(0, VISIT_LOG_LIMIT);

    await visitLogOwner.save();

    const storedEntry =
      Array.isArray(visitLogOwner.visitLog) && visitLogOwner.visitLog.length
        ? visitLogOwner.visitLog[0]
        : null;

    const io = req.app.locals.io;

    if (io && visitLogOwner?._id) {
      io.to(`user:${String(visitLogOwner._id)}`).emit("visit-log:new", {
        visitLog: {
          _id: storedEntry?._id ? String(storedEntry._id) : "",
          ip: storedEntry?.ip || ip,
          country: storedEntry?.country || country || "Unknown",
          visitedAt: storedEntry?.visitedAt || new Date(),
        },
      });
    }

    return res.status(201).json({
      visitLog: {
        _id: storedEntry?._id ? String(storedEntry._id) : "",
        ip: storedEntry?.ip || ip,
        country: storedEntry?.country || country || "Unknown",
        visitedAt: storedEntry?.visitedAt || new Date(),
      },
    });
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

    const owner = await UserModel.findOne({
      "auth.username": VISIT_LOG_OWNER_USERNAME,
    }).select("_id visitLog");

    if (!owner) {
      return res.status(404).json({
        message: "Visit log owner not found.",
      });
    }

    const deletedCount = Array.isArray(owner.visitLog)
      ? owner.visitLog.length
      : 0;
    owner.visitLog = [];
    await owner.save();

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
      const user = await UserModel.findOne({
        "auth.username": req.params.username,
      });
      if (!user) {
        return res.status(404).json({ message: "User not found." });
      }
      const requesterId = String(
        req.authentication?.userId || req.body.id || "",
      ).trim();
      const receiverId = String(user._id);
      if (!requesterId) {
        return res.status(400).json({ message: "Requester id is required." });
      }
      if (String(user._id) === requesterId) {
        return res
          .status(400)
          .json({ message: "You cannot send a friend request to yourself." });
      }
      // Check if already friends
      const isAlreadyFriend = (user.friends || []).some((friend) => {
        if (typeof friend === "object" && friend !== null) {
          return String(friend.userID || friend._id || friend) === requesterId;
        }
        return String(friend) === requesterId;
      });
      if (isAlreadyFriend) {
        return res.status(409).json({ message: "You're already friends." });
      }
      // Add a pending friend request using friends[].userMode
      user.friends = Array.isArray(user.friends) ? user.friends : [];
      const existingRequest = user.friends.find((entry) => {
        if (typeof entry === "object" && entry !== null) {
          return (
            String(entry.userID || entry._id || entry) === requesterId &&
            entry.userMode === "requestReceived"
          );
        }
        return false;
      });
      if (existingRequest) {
        return res
          .status(200)
          .json({ message: "Friend request already pending." });
      }
      user.friends.push({
        userID: requesterId,
        userMode: "requestReceived",
      });
      await user.save();
      // Also update the requester to track the sent request
      const requester = await UserModel.findById(requesterId);
      if (requester) {
        requester.friends = Array.isArray(requester.friends)
          ? requester.friends
          : [];
        const alreadyTracked = requester.friends.find((entry) => {
          if (typeof entry === "object" && entry !== null) {
            return (
              String(entry.userID || entry._id || entry) === receiverId &&
              entry.userMode === "requestSent"
            );
          }
          return false;
        });
        if (!alreadyTracked) {
          requester.friends.push({
            userID: receiverId,
            userMode: "requestSent",
          });
          await requester.save();
        }
      }
      emitUserRefresh(io, user?._id?.toString(), "friends:updated");
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

      receiver.notifications =
        receiver.notifications && typeof receiver.notifications === "object"
          ? receiver.notifications
          : {};
      requester.notifications =
        requester.notifications && typeof requester.notifications === "object"
          ? requester.notifications
          : {};

      receiver.notifications.friend_requests = (
        Array.isArray(receiver.notifications.friend_requests)
          ? receiver.notifications.friend_requests
          : []
      ).filter((request) => String(request?.id || "") !== requesterId);
      receiver.notifications.rejected_users = (
        Array.isArray(receiver.notifications.rejected_users)
          ? receiver.notifications.rejected_users
          : []
      ).filter((entry) => String(entry?.id || "") !== requesterId);
      requester.notifications.sent_friend_requests = (
        Array.isArray(requester.notifications.sent_friend_requests)
          ? requester.notifications.sent_friend_requests
          : []
      ).filter((request) => String(request?.id || "") !== receiverId);

      if (
        !(receiver.friends || []).some(
          (friend) => String(friend) === requesterId,
        )
      ) {
        receiver.friends.push(requester._id);
      }

      if (
        !(requester.friends || []).some(
          (friend) => String(friend) === receiverId,
        )
      ) {
        requester.friends.push(receiver._id);
      }

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

    Promise.all([
      UserModel.findByIdAndUpdate(
        my_id,
        { $pull: { friends: friend_id } },
        { new: true },
      ),
      UserModel.findByIdAndUpdate(
        friend_id,
        { $pull: { friends: my_id } },
        { new: true },
      ),
    ])
      .then(([me, friend]) => {
        if (!me || !friend) {
          return res.status(404).json({
            message: "Friendship record was not found.",
          });
        }

        emitUserRefresh(io, [my_id, friend_id], "friends:updated");
        return res.status(200).json({
          message: "Friend removed.",
        });
      })
      .catch(next);
  },
);

UserRouter.put(
  "/friend-requests/:requestId/read",
  checkAuth,
  async function (req, res, next) {
    try {
      const user = await UserModel.findById(req.authentication.userId);

      if (!user) {
        return res.status(404).json({
          message: "User not found.",
        });
      }

      const friendRequests = Array.isArray(user.notifications?.friend_requests)
        ? user.notifications.friend_requests
        : [];

      let friendRequest = user.notifications?.friend_requests?.id?.(
        req.params.requestId,
      );

      if (!friendRequest) {
        friendRequest = friendRequests.find(
          (entry) => String(entry?._id) === String(req.params.requestId),
        );
      }

      if (!friendRequest) {
        friendRequest = friendRequests.find(
          (entry) => String(entry?.id) === String(req.params.requestId),
        );
      }

      if (!friendRequest) {
        return res.status(404).json({
          message: "Friend request not found.",
        });
      }

      const requesterId = String(friendRequest.id || "").trim();

      user.notifications.rejected_users = Array.isArray(
        user.notifications?.rejected_users,
      )
        ? user.notifications.rejected_users
        : [];

      const alreadyRejected = user.notifications.rejected_users.some(
        (entry) => String(entry?.id || "") === requesterId,
      );

      if (!alreadyRejected && requesterId) {
        user.notifications.rejected_users.push({
          id: requesterId,
          message: friendRequest.message || "Friend request rejected",
          status: "rejected",
        });
      }

      user.notifications.friend_requests = friendRequests.filter(
        (entry) =>
          String(entry?._id || "") !== String(friendRequest._id || "") &&
          String(entry?.id || "") !== requesterId,
      );

      const requester = requesterId
        ? await UserModel.findById(requesterId)
        : null;

      if (requester) {
        requester.notifications =
          requester.notifications && typeof requester.notifications === "object"
            ? requester.notifications
            : {};
        requester.notifications.sent_friend_requests = (
          Array.isArray(requester.notifications.sent_friend_requests)
            ? requester.notifications.sent_friend_requests
            : []
        ).filter((request) => String(request?.id || "") !== String(user._id));
      }

      await Promise.all([
        user.save(),
        requester ? requester.save() : Promise.resolve(),
      ]);

      const io = req.app.locals.io;
      emitUserRefresh(
        io,
        requesterId ? [String(user._id), requesterId] : String(user._id),
        "friend-request:rejected",
      );

      return res.status(200).json({
        message: "Friend request rejected.",
        requestId: String(friendRequest._id || req.params.requestId),
      });
    } catch (error) {
      return next(error);
    }
  },
);

//////////////////////Posting update for a user before leaving app
UserRouter.put("/isOnline/:id", function (req, res, next) {
  const io = req.app.locals.io;
  UserModel.findById(req.params.id)
    .then((user) => {
      if (!user) {
        res.status(404).json({
          message: "User not found.",
        });
        return null;
      }

      setUserConnectionState(user, {
        isConnected: req.body.isConnected,
        at: new Date(),
      });

      return user.save();
    })
    .then((user) => {
      if (!user) {
        return null;
      }

      emitUserRefresh(io, getUserAndFriendIds(user), "connection:changed", {
        isConnected: Boolean(req.body.isConnected),
        targetUserId: String(req.params.id),
      });
      res.status(201).json(user);
    })
    .catch(next);
});

UserRouter.put("/heartbeat/:id", function (req, res, next) {
  UserModel.findById(req.params.id)
    .then((user) => {
      if (!user) {
        res.status(404).json({
          message: "User not found.",
        });
        return null;
      }

      setUserConnectionState(user, {
        isConnected: true,
        at: new Date(),
      });

      return user.save();
    })
    .then((user) => {
      if (!user) {
        return null;
      }

      return res.status(200).json({
        ok: true,
        userId: String(user._id),
      });
    })
    .catch(next);
});
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
      await memoryDoc.save();

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
        req.body,
      );

      if (!createdComponent) {
        return res.status(404).json({ message: "Course not found." });
      }

      await memoryDoc.save();

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
      });

      const shouldCreateComponent = Boolean(
        String(req.body?.course_class || "").trim() ||
        String(req.body?.course_component || "").trim() ||
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
        addComponentToPlanner(memoryDoc, createdPlannerCourse._id, {
          ...req.body,
          course_class:
            String(req.body?.course_class || "").trim() ||
            String(req.body?.course_component || "").trim(),
        });
      }

      await memoryDoc.save();

      const createdCourse =
        flattenMemoryCoursesForPlanner(
          [createdPlannerCourse || null],
          memoryDoc.studyPlanner.studyOrganizer.exams,
        )[0] || null;

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

      addLectureToPlanner(memoryDoc, req.body);
      recalculateCourseLectureTotals(memoryDoc);
      await memoryDoc.save();

      return res.status(201).json();
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

      await memoryDoc.save();
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
      memoryDoc.studyPlanner.studyOrganizer.exams = [];
      await memoryDoc.save();
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
      await memoryDoc.save();
      return res.status(201).json();
    } catch (error) {
      return next(error);
    }
  },
);
//...............................................

//................Edit Course................
UserRouter.post(
  "/editCourse/:my_id/:courseID",
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

      const updatedPlannerCourse = updateCourseInPlanner(
        memoryDoc,
        req.params.courseID,
        req.body,
      );

      await memoryDoc.save();

      const updatedCourse =
        flattenMemoryCoursesForPlanner(
          updatedPlannerCourse ? [updatedPlannerCourse] : [],
          memoryDoc?.studyPlanner?.studyOrganizer?.exams,
        ).find(
          (course) => String(course?._id) === String(req.params.courseID),
        ) ||
        flattenMemoryCoursesForPlanner(
          memoryDoc?.studyPlanner?.studyOrganizer?.courses,
          memoryDoc?.studyPlanner?.studyOrganizer?.exams,
        ).find(
          (course) => String(course?._id) === String(req.params.courseID),
        ) ||
        null;

      return res.status(201).json({
        course: updatedCourse,
      });
    } catch (error) {
      return next(error);
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

      await memoryDoc.save();
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
      await memoryDoc.save();
      return res.status(201).json();
    } catch (error) {
      return next(error);
    }
  },
);
//....................
//Attach all the routes to router\
export default UserRouter;
