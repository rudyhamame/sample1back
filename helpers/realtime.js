export const getUserRoom = (userId) => `user:${userId}`;

export const emitUserRefresh = (io, userIds, reason, payload = {}) => {
  if (!io) {
    return;
  }

  const normalizedIds = Array.from(
    new Set((Array.isArray(userIds) ? userIds : [userIds]).filter(Boolean))
  );

  normalizedIds.forEach((userId) => {
    io.to(getUserRoom(userId)).emit("user:refresh", {
      reason,
      userId,
      ...payload,
    });
  });
};
