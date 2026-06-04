const ensureStatusObject = (user) => {
  if (!user || typeof user !== "object") {
    return null;
  }

  const existingStatus =
    user.status && typeof user.status === "object" ? user.status : {};

  user.status = {
    value: String(existingStatus.value || "").trim().toLowerCase() || "offline",
    updatedAt: existingStatus.updatedAt || null,
    lastSeenAt: existingStatus.lastSeenAt || null,
    loggedInAt: existingStatus.loggedInAt || null,
    loggedOutAt: existingStatus.loggedOutAt || null,
  };

  return user.status;
};

const normalizeStatusValue = (value, fallback = "offline") => {
  const normalizedValue = String(value || "").trim().toLowerCase();
  if (["online", "busy", "studying", "offline"].includes(normalizedValue)) {
    return normalizedValue;
  }

  const normalizedFallback = String(fallback || "").trim().toLowerCase();
  return ["online", "busy", "studying", "offline"].includes(normalizedFallback)
    ? normalizedFallback
    : "offline";
};

export const setUserConnectionState = (
  user,
  {
    statusValue,
    at = new Date(),
    markLogin = false,
  } = {},
) => {
  if (!user || typeof user !== "object") {
    return user;
  }

  const normalizedStatusValue = normalizeStatusValue(
    statusValue,
    "offline",
  );
  const status = ensureStatusObject(user);
  if (!status) {
    return user;
  }
  status.value = normalizedStatusValue;
  status.updatedAt = at;
  status.lastSeenAt = at;
  if (normalizedStatusValue !== "offline") {
    if (markLogin || !status.loggedInAt) {
      status.loggedInAt = at;
    }
    status.loggedOutAt = null;
  } else {
    status.loggedOutAt = at;
    status.loggedInAt = null;
  }
  return user;
};
