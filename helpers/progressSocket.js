// helpers/progressSocket.js
// Utility to emit compression progress updates via Socket.io

export function emitCompressionProgress(io, userId, percent) {
  if (!io || !userId) return;
  io.to(`user:${userId}`).emit("video:compression-progress", {
    userId,
    percent,
    timestamp: Date.now(),
  });
}
