import crypto from "crypto";

const getCloudinaryConfig = () => {
  const envCloudName = String(process.env.CLOUDINARY_CLOUD_NAME || "").trim();
  const envApiKey = String(process.env.CLOUDINARY_API_KEY || "").trim();
  const envApiSecret = String(process.env.CLOUDINARY_API_SECRET || "").trim();
  const cloudinaryUrl = String(process.env.CLOUDINARY_URL || "").trim();

  let urlCloudName = "";
  let urlApiKey = "";
  let urlApiSecret = "";

  if (cloudinaryUrl) {
    try {
      const parsedUrl = new URL(cloudinaryUrl);
      if (parsedUrl.protocol === "cloudinary:") {
        urlCloudName = String(parsedUrl.hostname || "").trim();
        urlApiKey = decodeURIComponent(String(parsedUrl.username || "").trim());
        urlApiSecret = decodeURIComponent(String(parsedUrl.password || "").trim());
      }
    } catch {
      const normalizedCloudinaryUrl = cloudinaryUrl.replace(/^cloudinary:\/\//i, "");
      const cloudinaryUrlMatch = normalizedCloudinaryUrl.match(/^([^:]+):([^@]+)@(.+)$/);

      if (cloudinaryUrlMatch) {
        urlApiKey = decodeURIComponent(String(cloudinaryUrlMatch[1] || "").trim());
        urlApiSecret = decodeURIComponent(String(cloudinaryUrlMatch[2] || "").trim());
        urlCloudName = String(cloudinaryUrlMatch[3] || "").trim();
      }
    }
  }

  const cloudName = envCloudName || urlCloudName;
  const apiKey = envApiKey || urlApiKey;
  const apiSecret = envApiSecret || urlApiSecret;
  const missing = [];

  if (!cloudName) {
    missing.push("CLOUDINARY_CLOUD_NAME");
  }

  if (!apiKey) {
    missing.push("CLOUDINARY_API_KEY");
  }

  if (!apiSecret) {
    missing.push("CLOUDINARY_API_SECRET");
  }

  return {
    cloudName,
    apiKey,
    apiSecret,
    missing,
    isReady: Boolean(cloudName && apiKey && apiSecret),
  };
};

const getPublicCloudinaryStatus = () => {
  const cloudinaryConfig = getCloudinaryConfig();

  return {
    status: cloudinaryConfig.isReady ? "configured" : "missing",
    missing: cloudinaryConfig.missing,
  };
};

const buildCloudinarySignature = ({ paramsToSign = {}, apiSecret = "" }) => {
  const serializedParams = Object.entries(paramsToSign)
    .filter(([, value]) => String(value || "").trim() !== "")
    .sort(([firstKey], [secondKey]) => firstKey.localeCompare(secondKey))
    .map(([key, value]) => `${key}=${String(value)}`)
    .join("&");

  return crypto.createHash("sha1").update(`${serializedParams}${apiSecret}`).digest("hex");
};

const deleteCloudinaryAsset = async ({
  cloudName = "",
  apiKey = "",
  apiSecret = "",
  publicId = "",
  resourceType = "image",
}) => {
  const normalizedPublicId = String(publicId || "").trim();

  if (!cloudName || !apiKey || !apiSecret || !normalizedPublicId) {
    return false;
  }

  const timestamp = Math.floor(Date.now() / 1000);
  const signature = buildCloudinarySignature({
    paramsToSign: {
      public_id: normalizedPublicId,
      timestamp,
    },
    apiSecret,
  });

  const body = new URLSearchParams({
    public_id: normalizedPublicId,
    timestamp: String(timestamp),
    api_key: apiKey,
    signature,
  });

  const response = await fetch(
    `https://api.cloudinary.com/v1_1/${cloudName}/${resourceType}/destroy`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: body.toString(),
    },
  );

  if (!response.ok) {
    return false;
  }

  const payload = await response.json().catch(() => ({}));
  return ["ok", "not found"].includes(String(payload?.result || "").trim().toLowerCase());
};

export {
  buildCloudinarySignature,
  deleteCloudinaryAsset,
  getCloudinaryConfig,
  getPublicCloudinaryStatus,
};

