//For user data
import express from "express";
import { execFileSync } from "child_process";
import crypto from "crypto";
import { v2 as cloudinary } from "cloudinary";
import path from "path";
import { fileURLToPath } from "url";
import TestModel from "../models/Test.js";
import UserModel from "../models/Users.js";
import ChatModel from "../models/Chat.js";
const UserRouter = express.Router();
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import "dotenv/config.js";
import checkAuth from "../check-auth.js";
import PostsModel from "../models/Posts.js";
import SignupVerificationModel from "../models/SignupVerification.js";
import VisitLogModel from "../models/VisitLog.js";
import geoip from "geoip-lite";
import { emitUserRefresh } from "../helpers/realtime.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const FRONTEND_REPO_PATH = path.resolve(__dirname, "../../sample1front");

const recalculateCourseLectureTotals = (user) => {
  const lectures = Array.isArray(user.schoolPlanner?.lectures)
    ? user.schoolPlanner.lectures
    : [];

  user.schoolPlanner.courses = user.schoolPlanner.courses.map((course) => {
    let courseLength = 0;
    let courseProgress = 0;

    lectures.forEach((lecture) => {
      if (
        lecture.lecture_course === course.course_name &&
        lecture.lecture_partOfPlan === true
      ) {
        courseLength += Number(lecture.lecture_length) || 0;
        courseProgress += Number(lecture.lecture_progress) || 0;
      }
    });

    const normalizedCourse =
      typeof course.toObject === "function" ? course.toObject() : { ...course };

    return {
      ...normalizedCourse,
      course_length: courseLength,
      course_progress: courseProgress,
    };
  });
};

const getUserAndFriendIds = (user) => {
  if (!user) {
    return [];
  }

  const friendIds = Array.isArray(user.friends)
    ? user.friends.map((friend) => String(friend))
    : [];

  return [String(user._id), ...friendIds];
};

const CLINICAL_REALITY_HTML_MAX_LENGTH = 250000;
const VISIT_LOG_OWNER_USERNAME = "rudyhamame";
const VISIT_LOG_LIMIT = 200;
const CLOUDINARY_RING_VIDEO_UPLOAD_FOLDER = "sample1/noga-ring-videos";
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

const buildUserRingVideoFolder = (userId) =>
  buildUserCloudinaryFolder(CLOUDINARY_RING_VIDEO_UPLOAD_FOLDER, userId);

const buildUserImageGalleryFolder = (userId) =>
  buildUserCloudinaryFolder(CLOUDINARY_IMAGE_UPLOAD_FOLDER, userId);

const toBase64 = (value) => Buffer.from(String(value || ""), "utf8").toString("base64");

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
  const normalized = String(value || "").trim().toLowerCase();

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
      urls: [
        "stun:stun.l.google.com:19302",
        "stun:stun1.l.google.com:19302",
      ],
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

const ensureRingVideoFolderForUser = async (user) => {
  if (!user?._id) {
    return "";
  }

  const currentFolder = String(
    user?.schoolPlanner?.ringVideo?.folder || "",
  ).trim();
  if (currentFolder) {
    return currentFolder;
  }

  const folder = buildUserRingVideoFolder(user._id);

  await UserModel.updateOne(
    { _id: user._id },
    {
      $set: {
        "schoolPlanner.ringVideo.folder": folder,
      },
    },
  );

  return folder;
};

const normalizeStoredGalleryImage = (image) => {
  if (!image) {
    return null;
  }

  const url = String(image?.url || image?.secure_url || "").trim();
  const publicId = String(image?.publicId || image?.public_id || "").trim();
  const normalizedResourceType = String(
    image?.resourceType || image?.resource_type || "image",
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
    assetId: String(image?.assetId || image?.asset_id || "").trim(),
    folder: String(image?.folder || "").trim(),
    resourceType,
    mimeType: String(image?.mimeType || image?.mime_type || "").trim(),
    width: Number(image?.width) || 0,
    height: Number(image?.height) || 0,
    format: String(image?.format || "").trim(),
    bytes: Number(image?.bytes) || 0,
    duration: Number(image?.duration) || 0,
    createdAt: image?.createdAt ? new Date(image.createdAt) : new Date(),
  };
};

const extractCloudinaryDeliveryTypeFromUrl = (value) => {
  const url = String(value || "").trim();

  if (!url) {
    return "upload";
  }

  const match = url.match(/\/(?:image|video|raw)\/([^/]+)\//i);
  const deliveryType = String(match?.[1] || "").trim().toLowerCase();

  return deliveryType || "upload";
};

const extractCloudinaryFormat = (image) => {
  const explicitFormat = String(image?.format || "").trim().toLowerCase();

  if (explicitFormat) {
    return explicitFormat;
  }

  const mimeType = String(image?.mimeType || "").trim().toLowerCase();

  if (mimeType === "application/pdf") {
    return "pdf";
  }

  const url = String(image?.url || "").trim();
  const fileName = url.split("/").pop() || "";
  const extensionMatch = fileName.match(/\.([a-z0-9]+)(?:[?#].*)?$/i);

  return String(extensionMatch?.[1] || "").trim().toLowerCase() || "pdf";
};

const sortGalleryImages = (images = []) =>
  images
    .filter(Boolean)
    .sort(
      (firstImage, secondImage) =>
        new Date(secondImage?.createdAt || 0).getTime() -
        new Date(firstImage?.createdAt || 0).getTime(),
    );

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
  UserModel.findOne({
    "info.username": req.body.username,
  })
    .exec()
    .then((user) => {
      if (user) {
        bcrypt.compare(req.body.password, user.info.password, (err, result) => {
          if (result) {
            UserModel.findByIdAndUpdate(
              user._id,
              {
                $set: {
                  "status.isConnected": true,
                  "status.lastSeenAt": new Date(),
                },
                $push: {
                  login_record: {
                    $each: [{ loggedInAt: new Date(), loggedOutAt: null }],
                    $slice: -100,
                  },
                },
              },
              {
                new: true,
              },
            )
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
                const token = jwt.sign(
                  {
                    username: updatedUser.info.username,
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
        });
      } else {
        res.status(401).json({
          message: "Authorized failed",
        });
      }
    })
    .catch(next);
});

// Request signup verification code by email
UserRouter.post("/signup/request-code", async function (req, res, next) {
  try {
    const { username, password, firstname, lastname, email, dob } = req.body;

    if (!username || !password || !firstname || !lastname || !email) {
      return res.status(400).json({
        message: "Please provide all required signup information.",
      });
    }

    const [existingUsernameUser, existingEmailUser] = await Promise.all([
      UserModel.findOne({ "info.username": username }),
      UserModel.findOne({ "info.email": email }),
    ]);

    if (existingUsernameUser) {
      return res.status(409).json({
        message: "That username is already in use.",
      });
    }

    if (existingEmailUser) {
      return res.status(409).json({
        message: "That email address is already in use.",
      });
    }

    const passwordHash = await bcrypt.hash(password, 10);
    const verificationCode = String(
      Math.floor(100000 + Math.random() * 900000),
    );
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000);

    await SignupVerificationModel.deleteMany({
      $or: [{ username }, { email }],
    });

    await SignupVerificationModel.create({
      username,
      email,
      firstname,
      lastname,
      dob,
      passwordHash,
      verificationCode,
      expiresAt,
    });

    return res.status(200).json({
      message: "Verification code generated successfully.",
      verificationCode,
    });
  } catch (error) {
    const message = String(error?.message || "");

    return res.status(500).json({
      message: `Signup request failed: ${message || "Unknown server error."}`,
    });
  }
});

// Complete signup after verification
UserRouter.post("/signup/verify-code", async function (req, res, next) {
  try {
    const { username, email, verificationCode } = req.body;

    if (!username || !email || !verificationCode) {
      return res.status(400).json({
        message: "Username, email, and verification code are required.",
      });
    }

    const pendingSignup = await SignupVerificationModel.findOne({
      username,
      email,
    });

    if (!pendingSignup) {
      return res.status(404).json({
        message: "No pending signup was found for this account.",
      });
    }

    if (pendingSignup.expiresAt.getTime() < Date.now()) {
      await pendingSignup.deleteOne();
      return res.status(410).json({
        message: "Verification code expired. Please request a new one.",
      });
    }

    if (pendingSignup.verificationCode !== String(verificationCode).trim()) {
      return res.status(401).json({
        message: "Verification code is not correct.",
      });
    }

    const createdUser = new UserModel({
      "info.username": pendingSignup.username,
      "info.password": pendingSignup.passwordHash,
      "info.firstname": pendingSignup.firstname,
      "info.lastname": pendingSignup.lastname,
      "info.email": pendingSignup.email,
      "info.dob": pendingSignup.dob,
    });

    createdUser.schoolPlanner = createdUser.schoolPlanner || {};
    createdUser.schoolPlanner.ringVideo = {
      ...(createdUser.schoolPlanner.ringVideo || {}),
      folder: buildUserRingVideoFolder(createdUser._id),
    };

    await createdUser.save();

    await pendingSignup.deleteOne();

    return res.status(201).json({
      userID: createdUser._id,
      message: "Signup completed successfully.",
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

//Modifiying User's Connection Status
UserRouter.put("/connection/:id", function (req, res, next) {
  UserModel.findByIdAndUpdate({ _id: req.params.id }, req.body, {
    useFindAndModify: false,
  })
    .then((result) => res.json(result))
    .catch(next);
});

////////UpdateUser
UserRouter.get("/update/:id", function (req, res, next) {
  UserModel.findOne({ _id: req.params.id })
    .select(
      "info friends notifications chat posts terminology study_session login_record schoolPlanner study clinicalReality media status",
    )
    .populate({
      path: "friends",
      populate: {
        path: "posts",
      },
    })
    .populate("chat")
    .populate("posts")
    .then((profile) => {
      const ownPosts = Array.isArray(profile.posts) ? profile.posts : [];
      const friendPosts = Array.isArray(profile.friends)
        ? profile.friends.flatMap((friend) =>
            Array.isArray(friend.posts) ? friend.posts : [],
          )
        : [];
      const posts = [...ownPosts, ...friendPosts]
        .filter(Boolean)
        .filter(
          (post, index, allPosts) =>
            allPosts.findIndex(
              (candidate) => String(candidate?._id) === String(post?._id),
            ) === index,
        )
        .sort((firstPost, secondPost) => {
          const firstDate = new Date(firstPost?.date || 0).getTime();
          const secondDate = new Date(secondPost?.date || 0).getTime();
          return secondDate - firstDate;
        });

      res.status(200).json({
        info: profile.info,
        chat: Array.isArray(profile.chat?.conversation)
          ? profile.chat.conversation
          : [],
        friends: profile.friends,
        notifications: profile.notifications,
        posts,
        terminology: profile.terminology,
        study_session: profile.study_session,
        login_record: profile.login_record || [],
        isOnline: profile.status.isConnected,
        schoolPlanner: profile.schoolPlanner,
        study: profile.study,
        clinicalReality: profile.clinicalReality,
        media: profile.media || {
          profilePicture: {
            url: "",
            publicId: "",
            assetId: "",
            updatedAt: null,
          },
          imageGallery: [],
        },
      });
    })
    .catch(next);
});

UserRouter.put("/profile", checkAuth, async function (req, res, next) {
  try {
    const user = await UserModel.findById(req.authentication.userId).select(
      "info media",
    );

    if (!user) {
      return res.status(404).json({
        message: "User not found.",
      });
    }

    const nextFirstname = String(
      req.body?.firstname ?? user.info.firstname ?? "",
    ).trim();
    const nextLastname = String(
      req.body?.lastname ?? user.info.lastname ?? "",
    ).trim();
    const nextUsername = String(
      req.body?.username ?? user.info.username ?? "",
    ).trim();

    if (!nextFirstname || !nextLastname || !nextUsername) {
      return res.status(400).json({
        message: "First name, last name, and username are required.",
      });
    }

    if (nextUsername !== String(user.info.username || "").trim()) {
      const existingUsernameUser = await UserModel.findOne({
        "info.username": nextUsername,
        _id: { $ne: user._id },
      }).select("_id");

      if (existingUsernameUser) {
        return res.status(409).json({
          message: "That username is already in use.",
        });
      }
    }

    const requestedAiProvider = String(
      req.body?.aiProvider ?? user.info.aiProvider ?? "openai",
    )
      .trim()
      .toLowerCase();

    const nextAiProvider = ["openai", "gemini"].includes(requestedAiProvider)
      ? requestedAiProvider
      : "openai";

    user.info.firstname = nextFirstname;
    user.info.lastname = nextLastname;
    user.info.username = nextUsername;
    user.info.program = String(
      req.body?.program ?? user.info.program ?? "",
    ).trim();
    user.info.university = String(
      req.body?.university ?? user.info.university ?? "",
    ).trim();
    user.info.studyYear = String(
      req.body?.studyYear ?? user.info.studyYear ?? "",
    ).trim();
    user.info.term = String(req.body?.term ?? user.info.term ?? "").trim();
    user.info.aiProvider = nextAiProvider;

    const requestedViewport = req.body?.profilePictureViewport;
    if (requestedViewport && typeof requestedViewport === "object") {
      const rawScale = Number(requestedViewport?.scale);
      const rawOffsetX = Number(requestedViewport?.offsetX);
      const rawOffsetY = Number(requestedViewport?.offsetY);

      user.media = user.media || {};
      user.media.profilePictureViewport = {
        scale: Number.isFinite(rawScale)
          ? Math.min(Math.max(rawScale, 1), 4)
          : 1,
        offsetX: Number.isFinite(rawOffsetX) ? rawOffsetX : 0,
        offsetY: Number.isFinite(rawOffsetY) ? rawOffsetY : 0,
        updatedAt: new Date(),
      };
    }

    const requestedHomeDrawing = req.body?.homeDrawing;
    if (requestedHomeDrawing && typeof requestedHomeDrawing === "object") {
      const sanitizeDrawingPaths = (requestedPaths) =>
        (Array.isArray(requestedPaths) ? requestedPaths : [])
          .slice(0, 48)
          .map((path) => {
            const paletteId = String(path?.paletteId || "aurora").trim() || "aurora";
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
            text: String(item?.text || "").trim().slice(0, 140),
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

      user.media = user.media || {};
      user.media.homeDrawing = {
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

    await user.save();

    return res.status(200).json({
      message: "Personal information updated.",
      info: user.info,
      media: {
        profilePictureViewport: user?.media?.profilePictureViewport || {
          scale: 1,
          offsetX: 0,
          offsetY: 0,
          updatedAt: null,
        },
        homeDrawing: user?.media?.homeDrawing || {
          draftPaths: [],
          appliedPaths: [],
          textItems: [],
          updatedAt: null,
        },
      },
    });
  } catch (error) {
    next(error);
  }
});

UserRouter.get(
  "/schoolPlanner/ring-video",
  checkAuth,
  async function (req, res, next) {
    try {
      const user = await UserModel.findById(req.authentication.userId).select(
        "schoolPlanner.ringVideo",
      );

      if (!user) {
        return res.status(404).json({
          message: "User not found.",
        });
      }

      const folder = await ensureRingVideoFolderForUser(user);

      return res.status(200).json({
        ringVideo: {
          url: String(user?.schoolPlanner?.ringVideo?.url || "").trim(),
          publicId: String(
            user?.schoolPlanner?.ringVideo?.publicId || "",
          ).trim(),
          folder,
          updatedAt: user?.schoolPlanner?.ringVideo?.updatedAt || null,
        },
      });
    } catch (error) {
      return next(error);
    }
  },
);

UserRouter.post(
  "/schoolPlanner/ring-video/signature",
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

      const user = await UserModel.findById(req.authentication.userId).select(
        "schoolPlanner.ringVideo.folder",
      );

      if (!user) {
        return res.status(404).json({
          message: "User not found.",
        });
      }

      const folder = await ensureRingVideoFolderForUser(user);

      const publicId =
        String(req.body?.publicId || "")
          .trim()
          .slice(0, 180)
          .replace(/[^a-zA-Z0-9/_-]/g, "-") || `ring-${Date.now()}`;
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
        signature,
        uploadUrl: `https://api.cloudinary.com/v1_1/${cloudinaryConfig.cloudName}/video/upload`,
      });
    } catch (error) {
      return next(error);
    }
  },
);

UserRouter.put(
  "/schoolPlanner/ring-video",
  checkAuth,
  async function (req, res, next) {
    try {
      const videoUrl = String(req.body?.videoUrl || "").trim();
      const publicId = String(req.body?.publicId || "").trim();
      const folder = buildUserRingVideoFolder(req.authentication.userId);

      if (!videoUrl) {
        return res.status(400).json({
          message: "videoUrl is required.",
        });
      }

      const updatedUser = await UserModel.findByIdAndUpdate(
        req.authentication.userId,
        {
          "schoolPlanner.ringVideo.url": videoUrl,
          "schoolPlanner.ringVideo.publicId": publicId,
          "schoolPlanner.ringVideo.folder": folder,
          "schoolPlanner.ringVideo.updatedAt": new Date(),
        },
        {
          new: true,
        },
      ).select("schoolPlanner.ringVideo");

      if (!updatedUser) {
        return res.status(404).json({
          message: "User not found.",
        });
      }

      return res.status(200).json({
        message: "Ring video saved.",
        ringVideo: updatedUser.schoolPlanner?.ringVideo || {
          url: "",
          publicId: "",
          folder,
          updatedAt: null,
        },
      });
    } catch (error) {
      return next(error);
    }
  },
);

UserRouter.post(
  "/schoolPlanner/ring-video/backfill-folders",
  checkAuth,
  async function (req, res, next) {
    try {
      if (req.authentication?.username !== VISIT_LOG_OWNER_USERNAME) {
        return res.status(403).json({
          message: "Not authorized.",
        });
      }

      const usersMissingFolder = await UserModel.find({
        $or: [
          { "schoolPlanner.ringVideo.folder": { $exists: false } },
          { "schoolPlanner.ringVideo.folder": null },
          { "schoolPlanner.ringVideo.folder": "" },
        ],
      }).select("_id");

      if (!usersMissingFolder.length) {
        return res.status(200).json({
          message: "No users needed Cloudinary folder backfill.",
          updatedCount: 0,
        });
      }

      const bulkOperations = usersMissingFolder.map((user) => ({
        updateOne: {
          filter: { _id: user._id },
          update: {
            $set: {
              "schoolPlanner.ringVideo.folder": buildUserRingVideoFolder(
                user._id,
              ),
            },
          },
        },
      }));

      const bulkResult = await UserModel.bulkWrite(bulkOperations, {
        ordered: false,
      });

      return res.status(200).json({
        message: "Cloudinary folders backfilled for existing users.",
        updatedCount: Number(bulkResult?.modifiedCount || 0),
        matchedCount: Number(bulkResult?.matchedCount || 0),
      });
    } catch (error) {
      return next(error);
    }
  },
);

UserRouter.get("/image-gallery", checkAuth, async function (req, res, next) {
  try {
    const user = await UserModel.findById(req.authentication.userId).select(
      "media",
    );

    if (!user) {
      return res.status(404).json({
        message: "User not found.",
      });
    }

    const imageGallery = sortGalleryImages(
      (Array.isArray(user?.media?.imageGallery) ? user.media.imageGallery : [])
        .map(normalizeStoredGalleryImage)
        .filter(Boolean),
    );
    const profilePicture = normalizeStoredGalleryImage(
      user?.media?.profilePicture,
    )
      ? {
          ...normalizeStoredGalleryImage(user.media.profilePicture),
          updatedAt: user?.media?.profilePicture?.updatedAt || null,
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
      turnEnabled: turnUrls.some((url) =>
        String(url || "").startsWith("turn:") ||
        String(url || "").startsWith("turns:"),
      ),
      turnUrls: turnUrls.filter((url) => {
        const normalizedUrl = String(url || "").trim();
        return (
          normalizedUrl.startsWith("turn:") || normalizedUrl.startsWith("turns:")
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

UserRouter.get(
  "/image-gallery/private-download",
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

      const requestedPublicId = String(req.query?.publicId || "").trim();
      const requestedUrl = String(req.query?.url || "").trim();

      if (!requestedPublicId && !requestedUrl) {
        return res.status(400).json({
          message: "publicId or url is required.",
        });
      }

      const user = await UserModel.findById(req.authentication.userId).select(
        "media",
      );

      if (!user) {
        return res.status(404).json({
          message: "User not found.",
        });
      }

      const imageGallery = Array.isArray(user?.media?.imageGallery)
        ? user.media.imageGallery.map(normalizeStoredGalleryImage).filter(Boolean)
        : [];

      const selectedImage = imageGallery.find((image) => {
        if (requestedPublicId && image.publicId === requestedPublicId) {
          return true;
        }

        if (requestedUrl && image.url === requestedUrl) {
          return true;
        }

        return false;
      });

      if (!selectedImage) {
        return res.status(404).json({
          message: "Requested media file was not found in your gallery.",
        });
      }

      cloudinary.config({
        cloud_name: cloudinaryConfig.cloudName,
        api_key: cloudinaryConfig.apiKey,
        api_secret: cloudinaryConfig.apiSecret,
        secure: true,
      });

      const fileUrl = cloudinary.utils.private_download_url(
        selectedImage.publicId,
        extractCloudinaryFormat(selectedImage),
        {
          resource_type: selectedImage.resourceType || "raw",
          type: extractCloudinaryDeliveryTypeFromUrl(selectedImage.url),
          expires_at: Math.floor(Date.now() / 1000) + 60 * 10,
          attachment: false,
        },
      );

      return res.status(200).json({
        url: fileUrl,
        publicId: selectedImage.publicId,
        resourceType: selectedImage.resourceType || "raw",
      });
    } catch (error) {
      return next(error);
    }
  },
);

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

    const user = await UserModel.findById(req.authentication.userId).select(
      "media",
    );

    if (!user) {
      return res.status(404).json({
        message: "User not found.",
      });
    }

    const existingImages = Array.isArray(user?.media?.imageGallery)
      ? user.media.imageGallery.map(normalizeStoredGalleryImage).filter(Boolean)
      : [];
    const dedupedImages = existingImages.filter(
      (image) => image.publicId !== normalizedImage.publicId,
    );
    const nextImageGallery = sortGalleryImages([
      normalizedImage,
      ...dedupedImages,
    ]);
    const existingProfilePicture = normalizeStoredGalleryImage(
      user?.media?.profilePicture,
    );

    user.media = user.media || {};
    user.media.imageGallery = nextImageGallery;

    await user.save();

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
      const user = await UserModel.findById(req.authentication.userId).select(
        "media",
      );

      if (!user) {
        return res.status(404).json({
          message: "User not found.",
        });
      }

      const imageGallery = Array.isArray(user?.media?.imageGallery)
        ? user.media.imageGallery
            .map(normalizeStoredGalleryImage)
            .filter(Boolean)
        : [];
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

      user.media = user.media || {};
      user.media.profilePicture = {
        url: selectedImage.url,
        publicId: selectedImage.publicId,
        assetId: selectedImage.assetId,
        updatedAt: new Date(),
      };

      await user.save();

      return res.status(200).json({
        message: "Profile picture updated.",
        profilePicture: user.media.profilePicture,
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

    const user = await UserModel.findById(req.authentication.userId).select(
      "media",
    );

    if (!user) {
      return res.status(404).json({
        message: "User not found.",
      });
    }

    const imageGallery = Array.isArray(user?.media?.imageGallery)
      ? user.media.imageGallery.map(normalizeStoredGalleryImage).filter(Boolean)
      : [];
    const imageToDelete = imageGallery.find(
      (image) => image.publicId === publicId,
    );

    if (!imageToDelete) {
      return res.status(404).json({
        message: "Image not found in gallery.",
      });
    }

    const cloudinaryConfig = getCloudinaryConfig();
    if (cloudinaryConfig.isReady) {
      await deleteCloudinaryAsset({
        cloudName: cloudinaryConfig.cloudName,
        apiKey: cloudinaryConfig.apiKey,
        apiSecret: cloudinaryConfig.apiSecret,
        publicId: imageToDelete.publicId,
        resourceType: imageToDelete.resourceType || "image",
      });
    }

    const nextImageGallery = sortGalleryImages(
      imageGallery.filter((image) => image.publicId !== publicId),
    );
    const currentProfilePublicId = String(
      user?.media?.profilePicture?.publicId || "",
    ).trim();

    user.media = user.media || {};
    user.media.imageGallery = nextImageGallery;
    if (currentProfilePublicId === publicId) {
      const fallbackImage =
        nextImageGallery.find((image) => image.resourceType === "image") ||
        null;
      user.media.profilePicture = fallbackImage
        ? {
            url: fallbackImage.url,
            publicId: fallbackImage.publicId,
            assetId: fallbackImage.assetId,
            updatedAt: new Date(),
          }
        : {
            url: "",
            publicId: "",
            assetId: "",
            updatedAt: null,
          };
    }

    await user.save();

    return res.status(200).json({
      message: "Image deleted from gallery.",
      imageGallery: nextImageGallery,
      profilePicture: user.media.profilePicture || {
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
        "info.username": req.params.username,
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
      "info.password",
    );

    if (!user) {
      return res.status(404).json({
        message: "User not found.",
      });
    }

    const passwordMatches = await bcrypt.compare(
      currentPassword,
      user.info.password,
    );

    if (!passwordMatches) {
      return res.status(401).json({
        message: "Current password is not correct.",
      });
    }

    const isSamePassword = await bcrypt.compare(
      nextPassword,
      user.info.password,
    );

    if (isSamePassword) {
      return res.status(409).json({
        message: "New password must be different from the current password.",
      });
    }

    user.info.password = await bcrypt.hash(nextPassword, 10);
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

    user.login_record = [];
    await user.save();

    return res.status(200).json({
      message: "Login log cleared.",
    });
  } catch (error) {
    return next(error);
  }
});

/////Searching for a user to be a friend
UserRouter.get("/searchUsers/:name", function (req, res, next) {
  UserModel.find({})
    .select("info.firstname info.lastname info.username")
    .then((users) => {
      const array = [];
      const searchTerm = String(req.params.name || "")
        .trim()
        .toLowerCase();
      users.forEach((user) => {
        const firstname = String(user?.info?.firstname || "").toLowerCase();
        const lastname = String(user?.info?.lastname || "").toLowerCase();
        const username = String(user?.info?.username || "").toLowerCase();

        if (
          firstname.includes(searchTerm) ||
          lastname.includes(searchTerm) ||
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

// Public doctor profile with populated posts
UserRouter.get("/profile/:username", function (req, res, next) {
  UserModel.findOne({ "info.username": req.params.username })
    .select(
      "info.username info.firstname info.lastname posts media.profilePicture",
    )
    .populate("posts")
    .then((user) => {
      if (!user) {
        return res.status(404).json({
          message: "Doctor profile not found.",
        });
      }

      return res.status(200).json({
        username: user.info.username,
        firstname: user.info.firstname,
        lastname: user.info.lastname,
        profilePicture: String(user?.media?.profilePicture?.url || "").trim(),
        posts: Array.isArray(user.posts) ? user.posts : [],
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

    const visitLog = await VisitLogModel.find({})
      .sort({ visitedAt: -1 })
      .limit(VISIT_LOG_LIMIT)
      .lean();

    return res.status(200).json({
      visitLog,
    });
  } catch (error) {
    return next(error);
  }
});

UserRouter.post("/visit-log", async function (req, res, next) {
  try {
    const ip = getRequestIp(req);
    const country = getCountryFromIp(ip);

    const visitLog = await VisitLogModel.create({
      ip,
      country,
      visitedAt: new Date(),
    });

    const io = req.app.locals.io;
    const visitLogOwner = await UserModel.findOne({
      "info.username": VISIT_LOG_OWNER_USERNAME,
    }).select("_id");

    if (io && visitLogOwner?._id) {
      io.to(`user:${String(visitLogOwner._id)}`).emit("visit-log:new", {
        visitLog: {
          _id: String(visitLog._id),
          ip: visitLog.ip,
          country: visitLog.country || "Unknown",
          visitedAt: visitLog.visitedAt,
        },
      });
    }

    return res.status(201).json({
      visitLog: {
        _id: String(visitLog._id),
        ip: visitLog.ip,
        country: visitLog.country || "Unknown",
        visitedAt: visitLog.visitedAt,
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

    const result = await VisitLogModel.deleteMany({});

    return res.status(200).json({
      message: "Visit log cleared.",
      deletedCount: result.deletedCount || 0,
    });
  } catch (error) {
    return next(error);
  }
});

// Requesting a friend
UserRouter.post("/addFriend/:username/", checkAuth, function (req, res, next) {
  const io = req.app.locals.io;
  UserModel.findOne({ "info.username": req.params.username })
    .then((user) => {
      user.notifications.push({
        id: req.body.id,
        type: "friend_request",
        count: 1,
        message: req.body.message,
      });
      return user.save();
    })
    .then((user) => {
      emitUserRefresh(io, user?._id?.toString(), "notification:new");
      res.status(201).json({
        message: "Request sent!",
      });
    })
    .catch(next);
});

////////ACCEPT REQUEST JUST ONE TIME
UserRouter.post("/acceptFriend/:my_id/:friend_id", function (req, res, next) {
  const io = req.app.locals.io;
  UserModel.findOne({ _id: req.params.my_id })
    .then((user) => {
      let conflict = false;
      user.friends.forEach((friend) => {
        if (friend == req.params.friend_id) {
          conflict = true;
        }
      });
      if (conflict == true) {
        return res.status(409).json({
          message: "You're already friends",
        });
      } else {
        return conflict;
      }
    })
    .then((result) => {
      if (result == false) {
        UserModel.findOne({ _id: req.params.my_id })
          .then((user) => {
            user.friends.push({
              _id: req.params.friend_id,
            });
            user.save();
          })
          .then(() => {
            UserModel.findOne({
              _id: req.params.friend_id,
            }).then((user) => {
              user.friends.push({
                _id: req.params.my_id,
              });
              user.save();
            });
            emitUserRefresh(
              io,
              [req.params.my_id, req.params.friend_id],
              "friends:updated",
            );
            res.status(201).json({
              message: "Request accepted. You're now friends!",
            });
          });
      }
    });
});

UserRouter.delete(
  "/removeFriend/:my_id/:friend_id",
  checkAuth,
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

///////Update Notification INFO USER
UserRouter.put("/editUserInfo/:me_id/:friend_id", function (req, res, next) {
  const io = req.app.locals.io;
  UserModel.findOne({ _id: req.params.me_id })
    .then((user) => {
      user.notifications.forEach((notification) => {
        if (notification.id == req.params.friend_id) {
          notification.status = "read";
          user.save();
        }
      });
      return user;
    })
    .then((user) => {
      return ChatModel.findOne({ _id: req.params.friend_id }).then((chat) => {
        if (chat) {
          let hasChatUpdates = false;

          chat.conversation.forEach((message) => {
            if (
              String(message?._id) === String(req.params.me_id) &&
              message?.from === "me" &&
              message?.status !== "read"
            ) {
              message.status = "read";
              hasChatUpdates = true;
            }
          });

          if (hasChatUpdates) {
            return chat.save().then(() => user);
          }
        }

        return user;
      });
    })
    .then((user) => {
      emitUserRefresh(
        io,
        [req.params.me_id, req.params.friend_id],
        "notification:read",
      );
      res.status(200).json(user);
    })
    .catch(next);
});

UserRouter.put(
  "/notifications/:notificationId/read",
  checkAuth,
  async function (req, res, next) {
    try {
      const user = await UserModel.findById(req.authentication.userId);

      if (!user) {
        return res.status(404).json({
          message: "User not found.",
        });
      }

      let notification = user.notifications.id(req.params.notificationId);

      if (!notification) {
        notification = (user.notifications || []).find(
          (entry) => String(entry?._id) === String(req.params.notificationId),
        );
      }

      if (!notification) {
        notification = (user.notifications || []).find(
          (entry) => String(entry?.id) === String(req.params.notificationId),
        );
      }

      if (!notification) {
        return res.status(404).json({
          message: "Notification not found.",
        });
      }

      notification.status = "read";
      await user.save();

      const io = req.app.locals.io;
      emitUserRefresh(io, String(user._id), "notification:read");

      return res.status(200).json({
        message: "Notification marked as read.",
        notificationId: String(notification._id || req.params.notificationId),
      });
    } catch (error) {
      return next(error);
    }
  },
);

/////////////Update User isConnected status
UserRouter.put("/connection/:id", function (req, res, next) {
  UserModel.findByIdAndUpdate({ _id: req.params.id }, req.body, {
    useFindAndModify: false,
  })
    .then(function (result) {
      res.json(result);
    })
    .catch(next);
});

///////SENDING MESSAGE TO FRIEND
UserRouter.post("/chat/send/:friendID", function (req, res, next) {
  UserModel.findOne({ _id: req.params.friendID })
    .then((friend) => {
      friend.chat.push(req.body);
      friend.save();
    })
    .then((response) => {
      res.status(201).json(response);
    })
    .catch(next);
});

///////POST A POST//The best architecture
UserRouter.post("/posts/:my_id", function (req, res, next) {
  UserModel.findOne({ _id: req.params.my_id })
    .then((mine) => {
      mine.posts.push(req.body);
      return mine.save();
    })
    .then((result) => {
      if (result) {
        res.status(201).json(result.posts.pop());
      } else {
        res.status(500).json();
      }
    })
    .catch(next);
});
/////Searching in posts
UserRouter.get(
  "/searchPosts/:keyword/:subject/:category/:my_id",
  function (req, res, next) {
    UserModel.findOne({ _id: req.params.my_id })
      .then((mine) => {
        const array = [];
        mine.posts.forEach((post) => {
          PostsModel.findOne({ _id: post }).then((user) => {
            if (
              req.params.keyword !== "$" &&
              req.params.subject === "$" &&
              req.params.category === "$"
            ) {
              if (
                String(user.note).toLowerCase() ===
                  req.params.keyword.toLowerCase() ||
                String(user.note)
                  .toLowerCase()
                  .includes(req.params.keyword.toLowerCase())
              ) {
                array.push(user);
              }
            }
            if (
              req.params.keyword === "$" &&
              req.params.subject !== "$" &&
              req.params.category === "$"
            ) {
              if (user.subject === req.params.subject) {
                array.push(user);
              }
            }
            if (
              req.params.keyword === "$" &&
              req.params.subject === "$" &&
              req.params.category !== "$"
            ) {
              if (user.category === req.params.category) {
                array.push(user);
              }
            }
            if (
              req.params.keyword !== "$" &&
              req.params.subject !== "$" &&
              req.params.category === "$"
            ) {
              if (
                String(user.note).toLowerCase() ===
                  req.params.keyword.toLowerCase() ||
                String(user.note)
                  .toLowerCase()
                  .includes(
                    req.params.keyword.toLowerCase() &&
                      user.subject === req.params.subject,
                  )
              ) {
                array.push(user);
              }
            }
            if (
              req.params.keyword !== "$" &&
              req.params.subject === "$" &&
              req.params.category !== "$"
            ) {
              if (
                String(user.note).toLowerCase() ===
                  req.params.keyword.toLowerCase() ||
                String(user.note)
                  .toLowerCase()
                  .includes(
                    req.params.keyword.toLowerCase() &&
                      user.category === req.params.category,
                  )
              ) {
                array.push(user);
              }
            }
            if (
              req.params.keyword == "$" &&
              req.params.subject !== "$" &&
              req.params.category !== "$"
            ) {
              if (
                user.subject === req.params.subject &&
                user.category === req.params.category
              ) {
                array.push(user);
              }
            }
            if (
              req.params.keyword !== "$" &&
              req.params.subject !== "$" &&
              req.params.category !== "$"
            ) {
              if (
                String(user.note).toLowerCase() ===
                  req.params.keyword.toLowerCase() ||
                String(user.note)
                  .toLowerCase()
                  .includes(
                    req.params.keyword.toLowerCase() &&
                      user.subject === req.params.subject &&
                      user.category === req.params.category,
                  )
              ) {
                array.push(user);
              }
            }
          });
        });
        return array;
      })
      .then((array2) => {
        console.log(array2);
        res.status(200).json({
          array: array2,
        });
      })
      .catch(next);
  },
);
//////////////Terminology post
UserRouter.post("/newTerminology/:my_id", function (req, res, next) {
  UserModel.findOne({ _id: req.params.my_id })
    .then((mine) => {
      mine.terminology.push(req.body);
      return mine.save();
    })
    .then((result) => {
      if (result) {
        res.status(201).json(result.terminology.pop());
      } else {
        res.status(500).json();
      }
    })
    .catch(next);
});

//////////////////////Posting update for a user before leaving app
UserRouter.put("/isOnline/:id", function (req, res, next) {
  const io = req.app.locals.io;
  UserModel.findById(req.params.id)
    .then((user) => {
      if (!user) {
        return res.status(404).json({
          message: "User not found.",
        });
      }

      user.status.isConnected = req.body.isConnected;
      user.status.lastSeenAt = new Date();

      if (!req.body.isConnected && Array.isArray(user.login_record)) {
        for (let i = user.login_record.length - 1; i >= 0; i -= 1) {
          if (!user.login_record[i].loggedOutAt) {
            user.login_record[i].loggedOutAt = new Date();
            break;
          }
        }
      }

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
  UserModel.findByIdAndUpdate(
    req.params.id,
    {
      $set: {
        "status.isConnected": true,
        "status.lastSeenAt": new Date(),
      },
    },
    {
      new: true,
    },
  )
    .then((user) => {
      if (!user) {
        return res.status(404).json({
          message: "User not found.",
        });
      }

      return res.status(200).json({
        ok: true,
        userId: String(user._id),
      });
    })
    .catch(next);
});
//////////////////////Posting update for a user before leaving app
UserRouter.put("/updateBeforeLeave/:id", function (req, res, next) {
  UserModel.findOne({ _id: req.params.id })
    .then((result) => {
      result.study_session.push(req.body.study_session);
      result.save();
    })
    .then((response) => {
      res.status(201).json(response);
    })
    .catch(next);
});

//////////////////////delete unit
UserRouter.delete(
  "/deleteCustomize/:my_id/:customizeID/:type",
  function (req, res, next) {
    UserModel.findOne({ _id: req.params.my_id })
      .then((user) => {
        if (req.params.type == "unit_inMemory") {
          for (var i = 0; i < user.study.unitsInMemory.length; i++) {
            if (user.study.unitsInMemory[i]._id == req.params.customizeID) {
              user.study.unitsInMemory.splice(i, 1);
              return user.save();
            }
          }
        }
        if (req.params.type == "propertyObject") {
          for (var i = 0; i < user.study.propertyObjects.length; i++) {
            if (user.study.propertyObjects[i]._id == req.params.customizeID) {
              user.study.propertyObjects.splice(i, 1);
              return user.save();
            }
          }
        }
        if (req.params.type == "functionNature") {
          for (var i = 0; i < user.study.functionNatures.length; i++) {
            if (user.study.functionNatures[i]._id == req.params.customizeID) {
              user.study.functionNatures.splice(i, 1);
              return user.save();
            }
          }
        }
        if (req.params.type == "changeFactor") {
          for (var i = 0; i < user.study.changeFactors.length; i++) {
            if (user.study.changeFactors[i]._id == req.params.customizeID) {
              user.study.changeFactors.splice(i, 1);
              return user.save();
            }
          }
        }
      })
      .then((result) => {
        if (result) {
          res.status(201).json();
        }
      })
      .catch(next);
  },
);
//////////////////////edit unit
UserRouter.put(
  "/editCustomize/:my_id/:customizeID/:type",
  function (req, res, next) {
    UserModel.findOne({ _id: req.params.my_id })
      .then((user) => {
        if (req.params.type == "proprertyUnit") {
          for (var i = 0; i < user.study.unitsInMemory.length; i++) {
            if (user.study.unitsInMemory[i]._id == req.params.customizeID) {
              user.study.unitsInMemory.splice(i, 1, req.body);
              return user.save();
            }
          }
        }
        if (req.params.type == "propertyObject") {
          for (var i = 0; i < user.study.propertyObjects.length; i++) {
            if (user.study.propertyObjects[i]._id == req.params.customizeID) {
              user.study.propertyObjects.splice(i, 1, req.body);
              return user.save();
            }
          }
        }
        if (req.params.type == "functionNature") {
          for (var i = 0; i < user.study.functionNatures.length; i++) {
            if (user.study.functionNatures[i]._id == req.params.customizeID) {
              user.study.functionNatures.splice(i, 1);
              return user.save();
            }
          }
        }
        if (req.params.type == "changeFactor") {
          for (var i = 0; i < user.study.changeFactors.length; i++) {
            if (user.study.changeFactors[i]._id == req.params.customizeID) {
              user.study.changeFactors.splice(i, 1);
              return user.save();
            }
          }
        }
      })
      .then((result) => {
        if (result) {
          res.status(201).json();
        }
      })
      .catch(next);
  },
);
///////////////EDIT propertyObject and propertyUnit////////////
//////////////////////edit unit
UserRouter.put(
  "/editPropertyObjectAndUnitCustomize/:my_id/:propertyObjectcustomizeID",
  function (req, res, next) {
    UserModel.findOne({ _id: req.params.my_id })
      .then((user) => {
        for (var i = 0; i < user.study.propertyObjects.length; i++) {
          if (
            user.study.propertyObjects[i]._id ==
            req.params.propertyObjectcustomizeID
          ) {
            user.study.propertyObjects.splice(i, 1, req.body.propertyObject);
            user.save();
          }
        }
        user.study.unitsInMemory = req.body.propertyUnit;
        user.save();
        return user;
      })
      .then((result) => {
        if (result) {
          res.status(201).json();
        }
      })
      .catch(next);
  },
);
//////////////////////Add unit
UserRouter.post("/addCustomize/:my_id/:type", function (req, res, next) {
  UserModel.findOne({ _id: req.params.my_id })
    .then((user) => {
      if (req.params.type == "unit_inMemory") {
        user.study.unitsInMemory.push(req.body);
        return user.save();
      }
      if (req.params.type == "propertyObject") {
        user.study.propertyObjects.push(req.body);
        return user.save();
      }
      if (req.params.type == "functionNature") {
        user.study.functionNatures.push(req.body);
        return user.save();
      }
      if (req.params.type == "changeFactor") {
        user.study.changeFactors.push(req.body);
        return user.save();
      }
    })
    .then((result) => {
      if (result) {
        res.status(201).json();
      }
    })
    .catch(next);
});
//.................................AddMemory......................
UserRouter.post("/addMemory/:my_id/:type", function (req, res, next) {
  UserModel.findOne({ _id: req.params.my_id })
    .then((user) => {
      if (req.params.type == "unit_inMemory") {
        user.study.inMemory.units.push(req.body.object);
        return user.save();
      }
      if (req.params.type == "dataType_inMemory") {
        user.study.inMemory.dataTypes.push(req.body.object);
        return user.save();
      }
      if (req.params.type == "set_inMemory") {
        user.study.inMemory.sets.push(req.body.object);
        return user.save();
      }
    })
    .then((result) => {
      if (result) {
        res.status(201).json();
      }
    })
    .catch(next);
});
//................................................................
//////////////////////delete unit
UserRouter.delete(
  "/deleteMemory/:my_id/:memoryID/:type",
  function (req, res, next) {
    UserModel.findOne({ _id: req.params.my_id })
      .then((user) => {
        if (req.params.type == "unit_inMemory") {
          for (var i = 0; i < user.study.inMemory.units.length; i++) {
            if (i == req.params.memoryID) {
              user.study.inMemory.units.splice(i, 1);
              return user.save();
            }
          }
        }
        if (req.params.type == "dataType_inMemory") {
          for (var i = 0; i < user.study.inMemory.dataTypes.length; i++) {
            if (i == req.params.memoryID) {
              user.study.inMemory.dataTypes.splice(i, 1);
              return user.save();
            }
          }
        }
        if (req.params.type == "set_inMemory") {
          for (var i = 0; i < user.study.inMemory.sets.length; i++) {
            if (i == req.params.memoryID) {
              user.study.inMemory.sets.splice(i, 1);
              return user.save();
            }
          }
        }
      })
      .then((result) => {
        if (result) {
          res.status(201).json();
        }
      })
      .catch(next);
  },
);
//////////////////////delete unit
UserRouter.put("/editMemory/:my_id/:memoryID/:type", function (req, res, next) {
  UserModel.findOne({ _id: req.params.my_id })
    .then((user) => {
      if (req.params.type == "unit_inMemory") {
        for (var i = 0; i < user.study.inMemory.units.length; i++) {
          if (i == req.params.memoryID) {
            user.study.inMemory.units.splice(i, 1, req.body.object);
            return user.save();
          }
        }
      }
      if (req.params.type == "dataType_inMemory") {
        for (var i = 0; i < user.study.inMemory.dataTypes.length; i++) {
          if (i == req.params.memoryID) {
            user.study.inMemory.dataTypes.splice(i, 1, req.body.object);
            return user.save();
          }
        }
      }
      if (req.params.type == "set_inMemory") {
        for (var i = 0; i < user.study.inMemory.sets.length; i++) {
          if (i == req.params.memoryID) {
            user.study.inMemory.sets.splice(i, 1);
            return user.save();
          }
        }
      }
    })
    .then((result) => {
      if (result) {
        res.status(201).json();
      }
    })
    .catch(next);
});
//...................................
//////////////////////edit a term
UserRouter.put("/editTerminology/:termID/:my_id", function (req, res, next) {
  UserModel.findOne({ _id: req.params.my_id })
    .then((mine) => {
      for (var i = 0; i < mine.terminology.length; i++) {
        if (mine.terminology[i]._id == req.params.termID) {
          mine.terminology.splice(i, 1, req.body);
        }
      }
      return mine.save();
    })
    .then((result) => {
      if (result) {
        res.status(201).json();
        console.log(result);
      }
    })
    .catch(next);
});

//..........ADDING COURSE TO COURSE ARRAY........
UserRouter.post("/addCourse/:my_id", function (req, res, next) {
  UserModel.findOne({ _id: req.params.my_id })
    .then((user) => {
      user.schoolPlanner.courses.push(req.body);
      return user.save();
    })
    .then((result) => {
      if (result) {
        const createdCourse = Array.isArray(result?.schoolPlanner?.courses)
          ? result.schoolPlanner.courses[
              result.schoolPlanner.courses.length - 1
            ] || null
          : null;
        res.status(201).json({
          course: createdCourse,
        });
      }
    })
    .catch(next);
});
//....................
//..........ADDING LECTURE TO COURSE ARRAY........
UserRouter.post("/addLecture/:my_id", function (req, res, next) {
  UserModel.findOne({ _id: req.params.my_id })
    .then((user) => {
      user.schoolPlanner.lectures.push(req.body);
      recalculateCourseLectureTotals(user);
      return user.save();
    })
    .then((result) => {
      if (result) {
        res.status(201).json();
      }
    })
    .catch(next);
});
//....................
//..........DELETE COURSE.....................
UserRouter.delete("/deleteCourse/:my_id/:courseID", function (req, res, next) {
  UserModel.findOne({ _id: req.params.my_id })
    .then((user) => {
      const courseIndex = user.schoolPlanner.courses.findIndex(
        (course) => String(course._id) === req.params.courseID,
      );

      if (courseIndex !== -1) {
        user.schoolPlanner.courses.splice(courseIndex, 1);
      }

      return user.save();
    })
    .then((result) => {
      if (result) {
        res.status(201).json();
      }
    })
    .catch(next);
});

UserRouter.delete("/deleteAllCourses/:my_id", function (req, res, next) {
  UserModel.findOne({ _id: req.params.my_id })
    .then((user) => {
      if (!user?.schoolPlanner) {
        return null;
      }

      user.schoolPlanner.courses = [];
      return user.save();
    })
    .then((result) => {
      if (result) {
        res.status(201).json();
      }
    })
    .catch(next);
});
//...............................................
//..........DELETE LECTURE.....................
UserRouter.delete(
  "/deleteLecture/:my_id/:lectureID",
  function (req, res, next) {
    UserModel.findOne({ _id: req.params.my_id })
      .then((user) => {
        const lectureIndex = user.schoolPlanner.lectures.findIndex(
          (lecture) => String(lecture._id) === req.params.lectureID,
        );

        if (lectureIndex !== -1) {
          user.schoolPlanner.lectures.splice(lectureIndex, 1);
        }

        recalculateCourseLectureTotals(user);
        return user.save();
      })
      .then((result) => {
        if (result) {
          res.status(201).json();
        }
      })
      .catch(next);
  },
);
//...............................................

//................Edit Course................
UserRouter.post("/editCourse/:my_id/:courseID", function (req, res, next) {
  UserModel.findOne({ _id: req.params.my_id })
    .then((user) => {
      const courseIndex = user.schoolPlanner.courses.findIndex(
        (course) => String(course._id) === req.params.courseID,
      );

      if (courseIndex !== -1) {
        const previousCourse = user.schoolPlanner.courses[courseIndex];
        const previousCourseName = previousCourse.course_name;
        const previousInstructors = Array.isArray(
          previousCourse.course_instructors,
        )
          ? previousCourse.course_instructors
          : [];
        const nextInstructors = Array.isArray(req.body.course_instructors)
          ? req.body.course_instructors
          : [];
        const nextCoursePayload = {
          ...req.body,
          _id: previousCourse._id,
        };

        user.schoolPlanner.courses.splice(courseIndex, 1, nextCoursePayload);

        user.schoolPlanner.lectures = user.schoolPlanner.lectures.map(
          (lecture) => {
            if (lecture.lecture_course !== previousCourseName) {
              return lecture;
            }

            let nextLectureInstructor = lecture.lecture_instructor;

            if (previousInstructors.includes(lecture.lecture_instructor)) {
              if (nextInstructors.includes(lecture.lecture_instructor)) {
                nextLectureInstructor = lecture.lecture_instructor;
              } else if (nextInstructors.length > 0) {
                nextLectureInstructor = nextInstructors[0];
              } else {
                nextLectureInstructor = "-";
              }
            }

            return {
              ...lecture.toObject(),
              lecture_course: req.body.course_name,
              lecture_instructor: nextLectureInstructor,
            };
          },
        );
      }

      return user.save();
    })
    .then((result) => {
      if (result) {
        const updatedCourse = Array.isArray(result?.schoolPlanner?.courses)
          ? result.schoolPlanner.courses.find(
              (course) => String(course?._id) === String(req.params.courseID),
            ) || null
          : null;
        res.status(201).json({
          course: updatedCourse,
        });
      }
    })
    .catch(next);
});

//................Edit Course Full Pages................
UserRouter.post(
  "/editCoursePages/:my_id/:courseNAME",
  function (req, res, next) {
    UserModel.findOne({ _id: req.params.my_id })
      .then((user) => {
        for (i = 0; i < user.schoolPlanner.courses.length; i++) {
          if (
            user.schoolPlanner.courses[i].course_name == req.params.courseNAME
          ) {
            user.schoolPlanner.courses.splice(i, 1, {
              course_name: user.schoolPlanner.courses[i].course_name,
              course_component: user.schoolPlanner.courses[i].course_component,
              course_dayAndTime:
                user.schoolPlanner.courses[i].course_dayAndTime,
              course_term: user.schoolPlanner.courses[i].course_term,
              course_year: user.schoolPlanner.courses[i].course_year,
              course_class: user.schoolPlanner.courses[i].course_class,
              course_status: user.schoolPlanner.courses[i].course_status,
              course_instructors:
                user.schoolPlanner.courses[i].course_instructors,
              course_grade: user.schoolPlanner.courses[i].course_grade,
              course_fullGrade: user.schoolPlanner.courses[i].course_fullGrade,
              course_exams: user.schoolPlanner.courses[i].course_exams,
              course_length: req.body.course_length,
              course_progress: req.body.course_progress,
              course_partOfPlan:
                user.schoolPlanner.courses[i].course_partOfPlan,
              exam_type: user.schoolPlanner.courses[i].exam_type,
              exam_date: user.schoolPlanner.courses[i].exam_date,
              exam_time: user.schoolPlanner.courses[i].exam_time,
            });
          }
        }
        return user.save();
      })
      .then((result) => {
        if (result) {
          res.status(201).json();
        }
      })
      .catch(next);
  },
);
//................setPageFinishLecture................
UserRouter.put(
  "/setPageFinishLecture/:my_id/:lectureID/:boolean",
  function (req, res, next) {
    UserModel.findOne({ _id: req.params.my_id })
      .then((user) => {
        var lectureFound;
        for (var i = 0; i < user.schoolPlanner.lectures.length; i++) {
          if (user.schoolPlanner.lectures[i]._id == req.params.lectureID) {
            lectureFound = user.schoolPlanner.lectures[i];
            let index = user.schoolPlanner.lectures[
              i
            ].lecture_pagesFinished.indexOf(req.body.pageNum);
            if (index == -1) {
              user.schoolPlanner.lectures[i].lecture_pagesFinished.push(
                req.body.pageNum,
              );
            } else {
              user.schoolPlanner.lectures[i].lecture_pagesFinished.splice(
                index,
                1,
              );
            }
            user.schoolPlanner.lectures[i].lecture_progress =
              user.schoolPlanner.lectures[i].lecture_pagesFinished.length;
          }
        }
        recalculateCourseLectureTotals(user);
        user.save();
        return lectureFound;
      })
      .then((lectureFound) => {
        if (lectureFound) {
          res.status(201).json({
            lectureFound: lectureFound,
          });
        }
      })
      .catch(next);
  },
);
//................HIDE UNCHECKED................
UserRouter.put("/hideUncheckedLectures/:my_id", function (req, res, next) {
  UserModel.findOne({ _id: req.params.my_id })
    .then((user) => {
      for (var i = 0; i < user.schoolPlanner.lectures.length; i++) {
        if (user.schoolPlanner.lectures[i].lecture_partOfPlan == false) {
          user.schoolPlanner.lectures.splice(i, 1, {
            ...user.schoolPlanner.lectures[i].toObject(),
            lecture_hidden: true,
          });
        }
      }
      return user.save();
    })
    .then((result) => {
      if (result) {
        res.status(201).json();
      }
    })
    .catch(next);
});
//................UNHIDE UNCHECKED................
UserRouter.put("/unhideUncheckedLectures/:my_id", function (req, res, next) {
  UserModel.findOne({ _id: req.params.my_id })
    .then((user) => {
      for (var i = 0; i < user.schoolPlanner.lectures.length; i++) {
        if (user.schoolPlanner.lectures[i].lecture_partOfPlan == false) {
          user.schoolPlanner.lectures.splice(i, 1, {
            ...user.schoolPlanner.lectures[i].toObject(),
            lecture_hidden: false,
          });
        }
      }
      return user.save();
    })
    .then((result) => {
      if (result) {
        res.status(201).json();
      }
    })
    .catch(next);
});

//................Edit Lecture................
UserRouter.post("/editLecture/:my_id/:lectureID", function (req, res, next) {
  UserModel.findOne({ _id: req.params.my_id })
    .then((user) => {
      const lectureIndex = user.schoolPlanner.lectures.findIndex(
        (lecture) => String(lecture._id) === req.params.lectureID,
      );

      if (lectureIndex !== -1) {
        user.schoolPlanner.lectures.splice(lectureIndex, 1, req.body);
      }
      recalculateCourseLectureTotals(user);
      return user.save();
    })
    .then((result) => {
      if (result) {
        res.status(201).json();
      }
    })
    .catch(next);
});

//..........ADDING KEYWORD TO COURSE ARRAY........
UserRouter.post("/addKeyword/:my_id/:type", function (req, res, next) {
  UserModel.findOne({ _id: req.params.my_id })
    .then((user) => {
      if (req.params.type == "Structure") {
        user.study.structure_keywords.push(req.body);
      }
      if (req.params.type == "Function") {
        user.study.function_keywords.push(req.body);
      }
      return user.save();
    })
    .then((user) => {
      if (req.params.type == "Structure") {
        return user.study.structure_keywords.pop();
      }
      if (req.params.type == "Function") {
        return user.study.function_keywords.pop();
      }
    })
    .then((keyword) => {
      if (keyword) {
        return res.status(201).json(keyword);
      }
    })
    .catch(next);
});

//................Add keywordProperties................
UserRouter.post(
  "/addKeywordStructureProperties/:my_id/:keywordID",
  function (req, res, next) {
    UserModel.findOne({ _id: req.params.my_id })
      .then((user) => {
        var keyword;
        for (i = 0; i < user.study.structure_keywords.length; i++) {
          if (user.study.structure_keywords[i]._id == req.params.keywordID) {
            user.study.structure_keywords[i].keyword_structureProperties.push(
              req.body,
            );
            keyword = user.study.structure_keywords[i];
          }
        }
        user.save();
        return keyword;
      })
      .then((keyword) => {
        if (keyword) {
          res.status(201).json(keyword);
        }
      })
      .catch(next);
  },
);
//................Add keywordPropertiesFunction................
UserRouter.post(
  "/addKeywordFunctionProperties/:my_id/:keywordID",
  function (req, res, next) {
    UserModel.findOne({ _id: req.params.my_id })
      .then((user) => {
        var keyword;
        for (i = 0; i < user.study.function_keywords.length; i++) {
          if (user.study.function_keywords[i]._id == req.params.keywordID) {
            user.study.function_keywords[i].keyword_functionProperties.push(
              req.body,
            );
            keyword = user.study.function_keywords[i];
          }
        }
        user.save();
        return keyword;
      })
      .then((keyword) => {
        if (keyword) {
          res.status(201).json(keyword);
        }
      })
      .catch(next);
  },
);
//................Edit keywordProperties................
UserRouter.post(
  "/editKeywordStructureProperty/:my_id/:keywordID/:keywordPropertyID",
  function (req, res, next) {
    UserModel.findOne({ _id: req.params.my_id })
      .then((user) => {
        var keywordProperties;
        for (i = 0; i < user.study.structure_keywords.length; i++) {
          if (user.study.structure_keywords[i]._id == req.params.keywordID) {
            for (
              j = 0;
              j <
              user.study.structure_keywords[i].keyword_structureProperties
                .length;
              j++
            ) {
              if (
                user.study.structure_keywords[i].keyword_structureProperties[j]
                  ._id == req.params.keywordPropertyID
              ) {
                user.study.structure_keywords[
                  i
                ].keyword_structureProperties.splice(j, 1, req.body);
                keywordProperties = user.study.structure_keywords[i];
              }
            }
          }
        }
        user.save();
        return keywordProperties;
      })
      .then((keywordProperties) => {
        if (keywordProperties) {
          res.status(201).json(keywordProperties);
        }
      })
      .catch(next);
  },
);
//................editKeywordStructureAfterChangingFunctionName................
UserRouter.post(
  "/editKeywordStructureAfterChangingFunctionName/:my_id",
  function (req, res, next) {
    UserModel.findOne({ _id: req.params.my_id })
      .then((user) => {
        user.study.structure_keywords = req.body;
        return user.save();
      })
      .then((result) => {
        if (result) {
          res.status(201).json(result);
        }
      })
      .catch(next);
  },
);
//................DELETE KEYWORD STRUCTURE................
UserRouter.post(
  "/deleteKeyword/:my_id/:keywordID/:type",
  function (req, res, next) {
    UserModel.findOne({ _id: req.params.my_id })
      .then((user) => {
        if (req.params.type === "Structure") {
          for (i = 0; i < user.study.structure_keywords.length; i++) {
            if (user.study.structure_keywords[i]._id == req.params.keywordID) {
              user.study.structure_keywords.splice(i, 1);
            }
          }
        }
        if (req.params.type === "Function") {
          for (i = 0; i < user.study.function_keywords.length; i++) {
            if (user.study.function_keywords[i]._id == req.params.keywordID) {
              user.study.function_keywords.splice(i, 1);
            }
          }
        }
        return user.save();
      })
      .then((result) => {
        if (result) {
          res.status(201).json();
        }
      })
      .catch(next);
  },
);
//................DELETE KEYWORD STRUCTURE PROPERTY................
UserRouter.post(
  "/deleteKeywordStructureProperty/:my_id/:keywordID/:keywordStructurePropertyID",
  function (req, res, next) {
    UserModel.findOne({ _id: req.params.my_id })
      .then((user) => {
        let object;
        for (i = 0; i < user.study.structure_keywords.length; i++) {
          if (user.study.structure_keywords[i]._id == req.params.keywordID) {
            for (
              j = 0;
              j <
              user.study.structure_keywords[i].keyword_structureProperties
                .length;
              j++
            ) {
              if (
                user.study.structure_keywords[i].keyword_structureProperties[j]
                  ._id == req.params.keywordStructurePropertyID
              ) {
                let property =
                  user.study.structure_keywords[i].keyword_structureProperties[
                    j
                  ];
                user.study.structure_keywords[
                  i
                ].keyword_structureProperties.splice(j, 1);
                user.save();
                object = {
                  length:
                    user.study.structure_keywords[i].keyword_structureProperties
                      .length,
                  property: property,
                };
              }
            }
          }
        }
        return object;
      })
      .then((keywordStructureProperty_object) => {
        res.status(201).json(keywordStructureProperty_object);
      })
      .catch(next);
  },
);

//................EDIT KEYWORD STRUCTURE................
UserRouter.post(
  "/editKeyword/:my_id/:keywordID/:type",
  function (req, res, next) {
    UserModel.findOne({ _id: req.params.my_id })
      .then((user) => {
        if (req.params.type === "Structure") {
          for (i = 0; i < user.study.structure_keywords.length; i++) {
            if (user.study.structure_keywords[i]._id == req.params.keywordID) {
              console.log(req.body);
              user.study.structure_keywords.splice(i, 1, req.body);
              user.save();
              return user.study.structure_keywords[i];
            }
          }
        }
        if (req.params.type === "Function") {
          for (i = 0; i < user.study.function_keywords.length; i++) {
            if (user.study.function_keywords[i]._id == req.params.keywordID) {
              user.study.function_keywords.splice(i, 1, req.body);
              user.save();
              return user.study.function_keywords[i];
            }
          }
        }
      })
      .then((keywordFunction) => {
        if (keywordFunction) {
          res.status(201).json(keywordFunction);
        }
      })
      .catch(next);
  },
);

//....................
//Attach all the routes to router\
export default UserRouter;
