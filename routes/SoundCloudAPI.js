import express from "express";

const SoundCloudRouter = express.Router();

const SOUNDCLOUD_OEMBED_URL = "https://soundcloud.com/oembed";
const SOUNDCLOUD_API_BASE_URL = "https://api.soundcloud.com";

const buildUrl = (baseUrl, query = {}) => {
  const params = new URLSearchParams();
  Object.entries(query).forEach(([key, value]) => {
    const normalizedValue = String(value ?? "").trim();
    if (normalizedValue) {
      params.set(key, normalizedValue);
    }
  });
  const queryString = params.toString();
  return `${baseUrl}${queryString ? `?${queryString}` : ""}`;
};

const getSoundCloudClientId = () =>
  String(
    process.env.SOUNDCLOUD_CLIENT_ID ||
      process.env.SOUNDCLOUD_API_KEY ||
      "",
  ).trim();

const normalizeOEmbedPayload = (payload = {}, resourceUrl = "") => ({
  title: String(payload?.title || "").trim(),
  authorName: String(payload?.author_name || "").trim(),
  authorUrl: String(payload?.author_url || "").trim(),
  providerName: String(payload?.provider_name || "SoundCloud").trim(),
  thumbnailUrl: String(payload?.thumbnail_url || "").trim(),
  html: String(payload?.html || "").trim(),
  width: Number(payload?.width || 0) || 0,
  height: Number(payload?.height || 0) || 0,
  resourceUrl: String(resourceUrl || "").trim(),
});

SoundCloudRouter.get("/config", (_req, res) => {
  const clientId = getSoundCloudClientId();
  return res.status(200).json({
    searchEnabled: Boolean(clientId),
    message: clientId
      ? "SoundCloud search is enabled."
      : "SoundCloud search requires SOUNDCLOUD_CLIENT_ID in the backend environment.",
  });
});

SoundCloudRouter.get("/oembed", async (req, res, next) => {
  try {
    const resourceUrl = String(req.query?.url || "").trim();
    if (!resourceUrl) {
      return res.status(400).json({
        message: "SoundCloud URL is required.",
      });
    }

    const response = await fetch(
      buildUrl(SOUNDCLOUD_OEMBED_URL, {
        format: "json",
        url: resourceUrl,
        maxheight: req.query?.maxheight || 420,
        auto_play: req.query?.auto_play || "true",
        show_comments: req.query?.show_comments || "false",
        show_reposts: req.query?.show_reposts || "false",
        visual: req.query?.visual || "true",
      }),
      { method: "GET" },
    );
    const payload = await response.json().catch(() => ({}));

    if (!response.ok) {
      return res.status(response.status).json({
        message: "Unable to load SoundCloud embed.",
      });
    }

    return res
      .status(200)
      .json(normalizeOEmbedPayload(payload, resourceUrl));
  } catch (error) {
    return next(error);
  }
});

SoundCloudRouter.get("/search", async (req, res, next) => {
  try {
    const clientId = getSoundCloudClientId();
    if (!clientId) {
      return res.status(503).json({
        message:
          "SoundCloud search requires SOUNDCLOUD_CLIENT_ID in the backend environment.",
      });
    }

    const query = String(req.query?.q || "").trim();
    const limit = Math.max(1, Math.min(50, Number(req.query?.limit || 25)));

    if (!query) {
      return res.status(400).json({
        message: "Search query is required.",
      });
    }

    const response = await fetch(
      buildUrl(`${SOUNDCLOUD_API_BASE_URL}/tracks`, {
        q: query,
        limit,
        client_id: clientId,
      }),
      { method: "GET" },
    );
    const payload = await response.json().catch(() => ({}));

    if (!response.ok) {
      return res.status(response.status).json({
        message: "Unable to search SoundCloud.",
      });
    }

    return res.status(200).json(payload);
  } catch (error) {
    return next(error);
  }
});

export default SoundCloudRouter;
