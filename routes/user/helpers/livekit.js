import { AccessToken } from "livekit-server-sdk";

const getLiveKitServerConfig = () => {
  const url = String(process.env.LIVEKIT_URL || "").trim();
  const apiKey = String(process.env.LIVEKIT_API_KEY || "").trim();
  const apiSecret = String(process.env.LIVEKIT_API_SECRET || "").trim();

  return {
    url,
    apiKey,
    apiSecret,
    isReady: Boolean(url && apiKey && apiSecret),
  };
};

const createLiveKitToken = async ({ identity, name, roomName, metadata = {} }) => {
  const liveKitConfig = getLiveKitServerConfig();

  if (!liveKitConfig.isReady) {
    return null;
  }

  const token = new AccessToken(liveKitConfig.apiKey, liveKitConfig.apiSecret, {
    identity,
    name,
    metadata: JSON.stringify(metadata),
    ttl: "2h",
  });

  token.addGrant({
    roomJoin: true,
    room: roomName,
    canPublish: true,
    canSubscribe: true,
  });

  return {
    token: await token.toJwt(),
    url: liveKitConfig.url,
  };
};

export { createLiveKitToken, getLiveKitServerConfig };

