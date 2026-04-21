import crypto from "crypto";

const buildTurnRestCredentials = (userId) => {
  const turnSecret = String(
    process.env.WEBRTC_TURN_SECRET || process.env.TURN_SECRET || "",
  ).trim();

  if (!turnSecret) {
    return null;
  }

  const ttlSeconds = Math.max(
    60,
    Number.parseInt(String(process.env.WEBRTC_TURN_TTL_SECONDS || "86400").trim(), 10) ||
      86400,
  );
  const expiresAt = Math.floor(Date.now() / 1000) + ttlSeconds;
  const usernameSuffix =
    String(userId || "").trim() ||
    String(process.env.WEBRTC_TURN_REST_USER || "phenomed").trim() ||
    "phenomed";
  const username = `${expiresAt}:${usernameSuffix}`;
  const credential = crypto.createHmac("sha1", turnSecret).update(username).digest("base64");

  return {
    username,
    credential,
    ttlSeconds,
    expiresAt,
  };
};

const maskTurnCredential = (value) => {
  const normalized = String(value || "").trim();

  if (!normalized) {
    return "";
  }

  if (normalized.length <= 8) {
    return `${normalized.slice(0, 2)}***`;
  }

  return `${normalized.slice(0, 6)}***${normalized.slice(-4)}`;
};

const isPlaceholderTurnUrl = (value) => {
  const normalized = String(value || "").trim().toLowerCase();

  if (!normalized) {
    return true;
  }

  return (
    normalized.includes("your-domain.com") ||
    normalized.includes("example.com") ||
    normalized.includes("localhost") ||
    normalized.includes("127.0.0.1")
  );
};

const expandTurnUrls = (rawUrls) => {
  const inputUrls = Array.isArray(rawUrls) ? rawUrls : [rawUrls];
  const expandedUrls = [];
  const seenUrls = new Set();

  inputUrls.forEach((rawEntry) => {
    const normalizedEntry = String(rawEntry || "").trim();

    if (!normalizedEntry || isPlaceholderTurnUrl(normalizedEntry)) {
      return;
    }

    const addUrl = (value) => {
      const nextValue = String(value || "").trim();

      if (!nextValue || seenUrls.has(nextValue)) {
        return;
      }

      seenUrls.add(nextValue);
      expandedUrls.push(nextValue);
    };

    const turnUriMatch = normalizedEntry.match(/^(turns?):([^?]+)(\?.*)?$/i);

    if (!turnUriMatch) {
      addUrl(normalizedEntry);
      return;
    }

    const protocol = String(turnUriMatch[1] || "").toLowerCase();
    const baseTarget = String(turnUriMatch[2] || "").trim();
    const search = String(turnUriMatch[3] || "").trim();
    const portMatch = baseTarget.match(/:(\d+)$/);
    const port = portMatch ? String(portMatch[1] || "").trim() : "";

    if (!baseTarget) {
      addUrl(normalizedEntry);
      return;
    }

    const hasTransportParam = /(?:\?|&)transport=/i.test(search);

    if (protocol === "turn" && port === "5349") {
      addUrl(`turns:${baseTarget}${search}`);

      if (!hasTransportParam) {
        addUrl(`turns:${baseTarget}?transport=tcp`);
      }

      return;
    }

    if (protocol === "turns") {
      addUrl(`turns:${baseTarget}${search}`);

      if (!hasTransportParam) {
        addUrl(`turns:${baseTarget}?transport=tcp`);
      }

      return;
    }

    if (protocol === "turn") {
      addUrl(`turn:${baseTarget}${search}`);

      if (!hasTransportParam) {
        addUrl(`turn:${baseTarget}?transport=udp`);
        addUrl(`turn:${baseTarget}?transport=tcp`);
      }

      return;
    }

    addUrl(normalizedEntry);
  });

  return expandedUrls;
};

const getRtcIceServers = (userId = "") => {
  const iceServers = [
    {
      urls: ["stun:stun.l.google.com:19302", "stun:stun1.l.google.com:19302"],
    },
  ];

  const turnUrls = String(
    process.env.WEBRTC_TURN_URLS ||
      process.env.TURN_URLS ||
      process.env.TURN_URL ||
      "",
  )
    .split(",")
    .map((entry) => String(entry || "").trim())
    .filter(Boolean)
    .flatMap((entry) => expandTurnUrls(entry));
  const turnUsername = String(
    process.env.WEBRTC_TURN_USERNAME || process.env.TURN_USERNAME || "",
  ).trim();
  const turnCredential = String(
    process.env.WEBRTC_TURN_PASSWORD ||
      process.env.WEBRTC_TURN_CREDENTIAL ||
      process.env.TURN_PASSWORD ||
      "",
  ).trim();
  const turnRestCredentials = buildTurnRestCredentials(userId);

  if (turnUrls.length && turnRestCredentials) {
    iceServers.push({
      urls: turnUrls,
      username: turnRestCredentials.username,
      credential: turnRestCredentials.credential,
    });
  } else if (turnUrls.length && turnUsername && turnCredential) {
    iceServers.push({
      urls: turnUrls,
      username: turnUsername,
      credential: turnCredential,
    });
  }

  return iceServers;
};

export { buildTurnRestCredentials, getRtcIceServers, maskTurnCredential };

