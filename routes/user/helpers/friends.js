export const getUserAndFriendIds = (user) => {
  if (!user) {
    return [];
  }

  const friendIds = Array.isArray(user.friends)
    ? user.friends
        .map((friend) => {
          if (!friend) {
            return "";
          }

          // Support both the legacy "friends: [ObjectId]" shape and the new
          // "friends: [{ userID, userMode, ... }]" relationship shape.
          const candidate =
            typeof friend === "object" && friend !== null
              ? friend.userID || friend._id || friend
              : friend;
          const normalized =
            typeof candidate === "object" && candidate !== null
              ? candidate._id || candidate
              : candidate;

          return String(normalized || "").trim();
        })
        .filter(Boolean)
    : [];

  return [String(user._id), ...friendIds];
};

const mapFriendForClient = (friend) => {
  if (!friend || typeof friend !== "object") {
    return null;
  }

  const normalizedFriend =
    typeof friend.toObject === "function" ? friend.toObject() : { ...friend };
  const identity = normalizedFriend?.identity || {};
  const personal = identity?.personal || {};
  const existingInfo = normalizedFriend?.info || {};
  const existingStatus = normalizedFriend?.status || {};
  const existingMedia = normalizedFriend?.media || {};
  const existingLocalStatus = normalizedFriend?.localStatus || {};
  const profilePicture = personal?.profilePicture?.picture || {};
  const mediaProfilePicture =
    existingMedia?.profilePicture && typeof existingMedia.profilePicture === "object"
      ? existingMedia.profilePicture
      : {};
  const statusValue = String(
    existingStatus?.value || "",
  )
    .trim()
    .toLowerCase();
  const normalizedStatusValue = ["online", "busy", "studying", "offline"].includes(
    statusValue,
  )
    ? statusValue
    : "offline";
  const statusUpdatedAt =
    existingStatus?.updatedAt ||
    existingStatus?.lastSeenAt ||
    null;

  return {
    ...normalizedFriend,
    info: {
      ...existingInfo,
      username: String(existingInfo?.username || identity?.atSignup?.username || "").trim(),
      firstname: String(existingInfo?.firstname || personal?.firstname || "").trim(),
      lastname: String(existingInfo?.lastname || personal?.lastname || "").trim(),
      profilePicture: String(
        existingInfo?.profilePicture ||
          mediaProfilePicture?.url ||
          profilePicture?.url ||
          "",
      ).trim(),
    },
    status: {
      ...existingStatus,
      value: normalizedStatusValue,
      updatedAt: statusUpdatedAt,
      lastSeenAt: statusUpdatedAt,
      loggedInAt: existingStatus?.loggedInAt || null,
      loggedOutAt:
        normalizedStatusValue === "offline"
          ? existingStatus?.loggedOutAt || statusUpdatedAt
          : existingStatus?.loggedOutAt || null,
    },
    media: {
      ...existingMedia,
      profilePicture: {
        ...profilePicture,
        ...mediaProfilePicture,
        url: String(mediaProfilePicture?.url || profilePicture?.url || "").trim(),
      },
    },
    localStatus: {
      value: String(existingLocalStatus?.value || "").trim() || null,
      updatedAt: existingLocalStatus?.updatedAt || null,
      lastChatAt: existingLocalStatus?.lastChatAt || null,
      lastTypingAt: existingLocalStatus?.lastTypingAt || null,
    },
  };
};

export const mapFriendEntryForClient = (entry) => {
  if (!entry || typeof entry !== "object") {
    return null;
  }

  const normalizedEntry =
    typeof entry.toObject === "function" ? entry.toObject() : { ...entry };
  const friendUser =
    normalizedEntry.userID && typeof normalizedEntry.userID === "object"
      ? normalizedEntry.userID
      : null;
  const friendId = String(friendUser?._id || normalizedEntry.userID || normalizedEntry._id || "").trim();

  if (!friendId) {
    return null;
  }

  const mappedUser = friendUser ? mapFriendForClient(friendUser) : {};
  const userMode = String(normalizedEntry.userMode || "stranger").trim();

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
