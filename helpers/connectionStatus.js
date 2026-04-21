const ensureStatusObject = (user) => {
  if (!user || typeof user !== "object") {
    return null;
  }

  user.status =
    user.status && typeof user.status === "object" ? user.status : {};

  return user.status;
};

export const setUserConnectionState = (
  user,
  { isConnected, at = new Date(), markLogin = false } = {},
) => {
  if (!user || typeof user !== "object") {
    return user;
  }

  const nextIsConnected = Boolean(isConnected);
  const status = ensureStatusObject(user);
  if (!status) {
    return user;
  }
  status.value = nextIsConnected ? "online" : "offline";
  status.updatedAt = at;
  return user;
};
