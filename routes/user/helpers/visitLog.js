import geoip from "geoip-lite";

const VISIT_LOG_OWNER_USERNAME = "rudyhamame";
const VISIT_LOG_LIMIT = 200;

const getRequestIp = (req) => {
  const forwardedFor = req.headers["x-forwarded-for"];

  if (typeof forwardedFor === "string" && forwardedFor.trim()) {
    return forwardedFor.split(",")[0].trim();
  }

  return req.ip || req.socket?.remoteAddress || req.connection?.remoteAddress || "Unknown IP";
};

const getCountryFromIp = (ipAddress) => {
  if (!ipAddress || ipAddress === "Unknown IP") {
    return "Unknown";
  }

  const normalizedIp = String(ipAddress).replace(/^::ffff:/, "").trim();

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

export { getCountryFromIp, getRequestIp, VISIT_LOG_LIMIT, VISIT_LOG_OWNER_USERNAME };

