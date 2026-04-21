export const getUserPresence = (user) => {
  const status = user?.status || {};
  const isLoggedIn =
    status?.value === "online" ||
    Boolean(user?.identity?.status?.isLoggedIn);
  const updatedAt = status?.updatedAt || null;
  return {
    isLoggedIn,
    lastSeenAt: updatedAt,
    loggedInAt: isLoggedIn ? updatedAt : null,
    loggedOutAt: isLoggedIn ? null : updatedAt,
  };
};

export const isUserOnline = (user) => getUserPresence(user).isLoggedIn;
