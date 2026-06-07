export const getUserRoom = (userId) => `user:${userId}`;

const normalizeUserIds = (userIds) =>
  Array.from(
    new Set((Array.isArray(userIds) ? userIds : [userIds]).filter(Boolean)),
  );

export const emitToUserRooms = (io, userIds, eventName, payload = {}) => {
  if (!io || !eventName) {
    return;
  }

  normalizeUserIds(userIds).forEach((userId) => {
    io.to(getUserRoom(userId)).emit(eventName, {
      userId,
      ...payload,
    });
  });
};

export const emitUserRefresh = (io, userIds, reason, payload = {}) => {
  emitToUserRooms(io, userIds, "user:refresh", {
    reason,
    ...payload,
  });
};

export const emitChatMessage = (io, userId, payload = {}) =>
  emitToUserRooms(io, userId, "chat:message", payload);

export const emitChatMessageUpdated = (io, userId, payload = {}) =>
  emitToUserRooms(io, userId, "chat:message-updated", payload);

export const emitChatRead = (io, userIds, payload = {}) =>
  emitToUserRooms(io, userIds, "chat:read", payload);
