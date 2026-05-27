import express from "express";
import { Readable } from "node:stream";

const JamendoRouter = express.Router();

const JAMENDO_API_BASE_URL = "https://api.jamendo.com/v3.0";

const buildUrl = (path, query = {}) => {
  const params = new URLSearchParams();
  Object.entries(query).forEach(([key, value]) => {
    const normalizedValue = String(value ?? "").trim();
    if (normalizedValue) {
      params.set(key, normalizedValue);
    }
  });
  const queryString = params.toString();
  return `${JAMENDO_API_BASE_URL}${path}${queryString ? `?${queryString}` : ""}`;
};

const getJamendoClientId = () =>
  String(process.env.JAMENDO_CLIENT_ID || "").trim();

JamendoRouter.get("/config", (_req, res) => {
  const clientId = getJamendoClientId();
  return res.status(200).json({
    searchEnabled: Boolean(clientId),
    message: clientId
      ? "Jamendo search is enabled."
      : "Jamendo requires JAMENDO_CLIENT_ID in the backend environment.",
  });
});

JamendoRouter.get("/tracks", async (req, res, next) => {
  try {
    const clientId = getJamendoClientId();
    if (!clientId) {
      return res.status(503).json({
        message: "Jamendo requires JAMENDO_CLIENT_ID in the backend environment.",
      });
    }

    const query = String(req.query?.q || "").trim();
    const trackId = String(req.query?.id || "").trim();
    const limit = Math.max(1, Math.min(50, Number(req.query?.limit || 25)));
    const genre = String(req.query?.genre || "").trim().toLowerCase();

    const response = await fetch(
      buildUrl("/tracks", {
        client_id: clientId,
        format: "json",
        limit,
        id: trackId,
        namesearch: query,
        tags: genre,
        audioformat: "mp32",
        include: "musicinfo",
        imagesize: "400",
        order: query || trackId ? "" : "popularity_total",
      }),
      { method: "GET" },
    );
    const payload = await response.json().catch(() => ({}));

    if (!response.ok) {
      return res.status(response.status).json({
        message: query
          ? "Unable to search Jamendo."
          : trackId
            ? "Unable to load Jamendo track."
          : "Unable to load Jamendo tracks.",
      });
    }

    return res.status(200).json(payload);
  } catch (error) {
    return next(error);
  }
});

JamendoRouter.get("/genres", async (req, res, next) => {
  try {
    const clientId = getJamendoClientId();
    if (!clientId) {
      return res.status(503).json({
        message: "Jamendo requires JAMENDO_CLIENT_ID in the backend environment.",
      });
    }

    const fallbackFromTracks = async () => {
      const fallbackResponse = await fetch(
        buildUrl("/tracks", {
          client_id: clientId,
          format: "json",
          limit: 200,
          include: "musicinfo",
          order: "popularity_total",
        }),
        { method: "GET" },
      );
      const fallbackPayload = await fallbackResponse.json().catch(() => ({}));
      const results = Array.isArray(fallbackPayload?.results)
        ? fallbackPayload.results
        : [];
      const fallbackGenres = Array.from(
        new Set(
          results
            .flatMap((track) =>
              Array.isArray(track?.musicinfo?.tags?.genres)
                ? track.musicinfo.tags.genres
                : [],
            )
            .map((entry) =>
              String(entry?.name || entry || "")
                .trim()
                .toLowerCase(),
            )
            .filter(Boolean),
        ),
      ).sort((a, b) => a.localeCompare(b));
      return fallbackGenres;
    };

    const response = await fetch(
      buildUrl("/tags", {
        client_id: clientId,
        format: "json",
        type: "genre",
        limit: 500,
      }),
      { method: "GET" },
    );
    const payload = await response.json().catch(() => ({}));

    if (!response.ok) {
      const genres = await fallbackFromTracks();
      return res.status(200).json({ genres });
    }

    const genres = Array.from(
      new Set(
        (Array.isArray(payload?.results) ? payload.results : [])
          .map((entry) => String(entry?.name || entry || "").trim().toLowerCase())
          .filter(Boolean),
      ),
    ).sort((a, b) => a.localeCompare(b));

    if (genres.length === 0) {
      const fallbackGenres = await fallbackFromTracks();
      return res.status(200).json({ genres: fallbackGenres });
    }

    return res.status(200).json({ genres });
  } catch (error) {
    return next(error);
  }
});

JamendoRouter.get("/stream", async (req, res, next) => {
  try {
    const clientId = getJamendoClientId();
    if (!clientId) {
      return res.status(503).json({
        message: "Jamendo requires JAMENDO_CLIENT_ID in the backend environment.",
      });
    }

    const trackId = String(req.query?.id || "").trim();
    if (!trackId) {
      return res.status(400).json({ message: "Missing Jamendo track id." });
    }

    const trackLookupResponse = await fetch(
      buildUrl("/tracks", {
        client_id: clientId,
        format: "json",
        id: trackId,
        limit: 1,
        audioformat: "mp32",
      }),
      { method: "GET" },
    );
    const trackLookupPayload = await trackLookupResponse.json().catch(() => ({}));
    const track = Array.isArray(trackLookupPayload?.results)
      ? trackLookupPayload.results[0]
      : null;
    const sourceUrl = String(track?.audio || track?.audiodownload || "").trim();

    if (!sourceUrl) {
      return res.status(404).json({ message: "Jamendo track audio not found." });
    }

    const upstreamResponse = await fetch(sourceUrl, {
      method: "GET",
      headers: req.headers?.range
        ? {
            range: String(req.headers.range),
          }
        : undefined,
    });

    if (!upstreamResponse.ok && upstreamResponse.status !== 206) {
      return res.status(upstreamResponse.status).json({
        message: "Unable to stream Jamendo audio.",
      });
    }

    const contentType =
      upstreamResponse.headers.get("content-type") || "audio/mpeg";
    const contentLength = upstreamResponse.headers.get("content-length");
    const contentRange = upstreamResponse.headers.get("content-range");
    const acceptRanges = upstreamResponse.headers.get("accept-ranges");

    res.status(upstreamResponse.status);
    res.setHeader("Content-Type", contentType);
    if (contentLength) {
      res.setHeader("Content-Length", contentLength);
    }
    if (contentRange) {
      res.setHeader("Content-Range", contentRange);
    }
    if (acceptRanges) {
      res.setHeader("Accept-Ranges", acceptRanges);
    }
    res.setHeader("Cache-Control", "public, max-age=300");

    if (!upstreamResponse.body) {
      return res.end();
    }

    Readable.fromWeb(upstreamResponse.body).pipe(res);
  } catch (error) {
    return next(error);
  }
});

export default JamendoRouter;
