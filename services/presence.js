export const getUserPresence = (user) => {
  const status = user?.status || {};
  const statusValue = String(status?.value || "").trim().toLowerCase();
  const isLoggedIn = ["online", "busy", "studying"].includes(statusValue);
  const updatedAt = status?.lastSeenAt || status?.updatedAt || null;
  return {
    isLoggedIn,
    lastSeenAt: updatedAt,
    loggedInAt: isLoggedIn ? status?.loggedInAt || updatedAt : null,
    loggedOutAt: isLoggedIn ? null : status?.loggedOutAt || updatedAt,
  };
};

export const isUserOnline = (user) => getUserPresence(user).isLoggedIn;
