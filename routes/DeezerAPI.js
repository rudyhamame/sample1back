import express from "express";

const DeezerRouter = express.Router();

const DEEZER_BASE_URL = "https://api.deezer.com";

const buildDeezerUrl = (path, query = {}) => {
  const params = new URLSearchParams();
  Object.entries(query).forEach(([key, value]) => {
    const normalized = String(value ?? "").trim();
    if (normalized) {
      params.set(key, normalized);
    }
  });
  const qs = params.toString();
  return `${DEEZER_BASE_URL}${path}${qs ? `?${qs}` : ""}`;
};

DeezerRouter.get("/search", async (req, res, next) => {
  try {
    const q = String(req.query?.q || "").trim();
    const limit = Math.max(1, Math.min(50, Number(req.query?.limit || 25)));

    if (!q) {
      return res.status(400).json({ message: "Search query is required." });
    }

    const response = await fetch(buildDeezerUrl("/search", { q, limit }), {
      method: "GET",
    });
    const payload = await response.json().catch(() => ({}));

    if (!response.ok) {
      return res.status(response.status).json({
        message: "Unable to search Deezer.",
      });
    }

    return res.status(200).json(payload);
  } catch (error) {
    return next(error);
  }
});

DeezerRouter.get("/track/:id", async (req, res, next) => {
  try {
    const trackId = String(req.params?.id || "").trim();
    if (!trackId) {
      return res.status(400).json({ message: "Track id is required." });
    }

    const response = await fetch(buildDeezerUrl(`/track/${trackId}`), {
      method: "GET",
    });
    const payload = await response.json().catch(() => ({}));

    if (!response.ok) {
      return res.status(response.status).json({
        message: "Unable to fetch Deezer track.",
      });
    }

    return res.status(200).json(payload);
  } catch (error) {
    return next(error);
  }
});

DeezerRouter.get("/chart", async (_req, res, next) => {
  try {
    const response = await fetch(buildDeezerUrl("/chart/0/tracks"), {
      method: "GET",
    });
    const payload = await response.json().catch(() => ({}));

    if (!response.ok) {
      return res.status(response.status).json({
        message: "Unable to fetch Deezer chart.",
      });
    }

    return res.status(200).json(payload);
  } catch (error) {
    return next(error);
  }
});

export default DeezerRouter;

