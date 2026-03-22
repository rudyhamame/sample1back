//For user data
import express from "express";
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
import { emitUserRefresh } from "../helpers/realtime.js";

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
              }
            )
              .then((updatedUser) => {
                emitUserRefresh(
                  io,
                  getUserAndFriendIds(updatedUser),
                  "connection:changed",
                  {
                    isConnected: true,
                    targetUserId: String(updatedUser._id),
                  }
                );
                const token = jwt.sign(
                  {
                    username: updatedUser.info.username,
                    userId: updatedUser._id,
                  },
                  process.env.JWT_KEY,
                  {
                    expiresIn: "1h",
                  }
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
      Math.floor(100000 + Math.random() * 900000)
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

    const createdUser = await UserModel.create({
      "info.username": pendingSignup.username,
      "info.password": pendingSignup.passwordHash,
      "info.firstname": pendingSignup.firstname,
      "info.lastname": pendingSignup.lastname,
      "info.email": pendingSignup.email,
      "info.dob": pendingSignup.dob,
    });

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
      "friends notifications chat posts terminology study_session login_record schoolPlanner study clinicalReality"
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
            Array.isArray(friend.posts) ? friend.posts : []
          )
        : [];
      const posts = [...ownPosts, ...friendPosts]
        .filter(Boolean)
        .filter(
          (post, index, allPosts) =>
            allPosts.findIndex(
              (candidate) => String(candidate?._id) === String(post?._id)
            ) === index
        )
        .sort((firstPost, secondPost) => {
          const firstDate = new Date(firstPost?.date || 0).getTime();
          const secondDate = new Date(secondPost?.date || 0).getTime();
          return secondDate - firstDate;
        });

        res.status(200).json({
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
      });
    })
    .catch(next);
});

UserRouter.get("/clinical-reality", checkAuth, async function (req, res, next) {
  try {
    const user = await UserModel.findById(req.authentication.userId).select(
      "clinicalReality"
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
  }
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
      }
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
      "info.password"
    );

    if (!user) {
      return res.status(404).json({
        message: "User not found.",
      });
    }

    const passwordMatches = await bcrypt.compare(
      currentPassword,
      user.info.password
    );

    if (!passwordMatches) {
      return res.status(401).json({
        message: "Current password is not correct.",
      });
    }

    const isSamePassword = await bcrypt.compare(nextPassword, user.info.password);

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

/////Searching for a user to be a friend
UserRouter.get("/searchUsers/:name", function (req, res, next) {
  UserModel.find({})
    .select("info.firstname info.lastname info.username")
    .then((users) => {
      const array = [];
      const searchTerm = String(req.params.name || "").trim().toLowerCase();
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
    .select("info.username info.firstname info.lastname posts")
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

    const users = await UserModel.find({})
      .select(
        "info.username info.firstname info.lastname login_record status.isConnected"
      )
      .lean();

    const visitLog = users
      .flatMap((user) => {
        const loginRecord = Array.isArray(user?.login_record)
          ? user.login_record
          : [];

        return loginRecord.map((record) => ({
          userId: String(user?._id || ""),
          username: String(user?.info?.username || ""),
          firstname: String(user?.info?.firstname || ""),
          lastname: String(user?.info?.lastname || ""),
          loggedInAt: record?.loggedInAt || null,
          loggedOutAt: record?.loggedOutAt || null,
          isConnected: Boolean(user?.status?.isConnected && !record?.loggedOutAt),
        }));
      })
      .sort(
        (firstRecord, secondRecord) =>
          new Date(secondRecord.loggedInAt || 0).getTime() -
          new Date(firstRecord.loggedInAt || 0).getTime()
      )
      .slice(0, 200);

    return res.status(200).json({
      visitLog,
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
              "friends:updated"
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
        { new: true }
      ),
      UserModel.findByIdAndUpdate(
        friend_id,
        { $pull: { friends: my_id } },
        { new: true }
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
  }
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
      emitUserRefresh(io, req.params.me_id, "notification:read");
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

      const notification = user.notifications.id(req.params.notificationId);

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
        notificationId: String(notification._id),
      });
    } catch (error) {
      return next(error);
    }
  }
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
                      user.subject === req.params.subject
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
                      user.category === req.params.category
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
                      user.category === req.params.category
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
  }
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
  }
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
  }
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
  }
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
  }
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
        res.status(201).json();
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
  }
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
        const previousInstructors = Array.isArray(previousCourse.course_instructors)
          ? previousCourse.course_instructors
          : [];
        const nextInstructors = Array.isArray(req.body.course_instructors)
          ? req.body.course_instructors
          : [];

        user.schoolPlanner.courses.splice(courseIndex, 1, req.body);

        user.schoolPlanner.lectures = user.schoolPlanner.lectures.map((lecture) => {
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
        });
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
  }
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
                req.body.pageNum
              );
            } else {
              user.schoolPlanner.lectures[i].lecture_pagesFinished.splice(
                index,
                1
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
  }
);
//................HIDE UNCHECKED................
UserRouter.put("/hideUncheckedLectures/:my_id", function (req, res, next) {
  UserModel.findOne({ _id: req.params.my_id })
    .then((user) => {
      for (var i = 0; i < user.schoolPlanner.lectures.length; i++) {
        if (user.schoolPlanner.lectures[i].lecture_partOfPlan == false) {
          user.schoolPlanner.lectures.splice(i, 1, {
            lecture_name: user.schoolPlanner.lectures[i].lecture_name,
            lecture_course: user.schoolPlanner.lectures[i].lecture_course,
            lecture_instructor:
              user.schoolPlanner.lectures[i].lecture_instructor,
            lecture_writer: user.schoolPlanner.lectures[i].lecture_writer,
            lecture_date: user.schoolPlanner.lectures[i].lecture_date,
            lecture_year: user.schoolPlanner.lectures[i].lecture_year,
            lecture_term: user.schoolPlanner.lectures[i].lecture_term,
            lecture_length: user.schoolPlanner.lectures[i].lecture_length,
            lecture_progress: user.schoolPlanner.lectures[i].lecture_progress,
            lecture_outlines: user.schoolPlanner.lectures[i].lecture_outlines,
            lecture_partOfPlan:
              user.schoolPlanner.lectures[i].lecture_partOfPlan,
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
            lecture_name: user.schoolPlanner.lectures[i].lecture_name,
            lecture_course: user.schoolPlanner.lectures[i].lecture_course,
            lecture_instructor:
              user.schoolPlanner.lectures[i].lecture_instructor,
            lecture_writer: user.schoolPlanner.lectures[i].lecture_writer,
            lecture_date: user.schoolPlanner.lectures[i].lecture_date,
            lecture_year: user.schoolPlanner.lectures[i].lecture_year,
            lecture_term: user.schoolPlanner.lectures[i].lecture_term,
            lecture_length: user.schoolPlanner.lectures[i].lecture_length,
            lecture_progress: user.schoolPlanner.lectures[i].lecture_progress,
            lecture_outlines: user.schoolPlanner.lectures[i].lecture_outlines,
            lecture_partOfPlan:
              user.schoolPlanner.lectures[i].lecture_partOfPlan,
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
              req.body
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
  }
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
              req.body
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
  }
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
  }
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
  }
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
  }
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
  }
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
  }
);

//....................
//Attach all the routes to router\
export default UserRouter;
