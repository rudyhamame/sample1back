import express from "express";
import multer from "multer";
import path from "path";
import { spawn } from "child_process";
import { fileURLToPath } from "url";

const ECGRouter = express.Router();
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const LOCAL_METHOD = "deterministic_digitizer";
const DIGITAL_TRACE_METHOD = "digital_trace_ingest";
const PYTHON_BINARY = process.env.PYTHON_BINARY || "python";
const PYTHON_TOOL_TIMEOUT_MS = 45000;
const ECG_SERVICE_TIMEOUT_MS = 600000;
const MAX_FILE_SIZE_BYTES = 15 * 1024 * 1024;
const ECG_PYTHON_SERVICE_URL = String(process.env.ECG_PYTHON_SERVICE_URL || "")
  .trim()
  .replace(/\/+$/, "");
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: MAX_FILE_SIZE_BYTES,
  },
});

const parseJsonField = (value) => {
  if (typeof value !== "string") {
    return value;
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }

  try {
    return JSON.parse(trimmed);
  } catch (error) {
    return value;
  }
};

const hasDeviceTracePayload = (payload) =>
  [
    payload?.digitalTraces,
    payload?.leadTraces,
    payload?.deviceTraces,
    payload?.traces,
    payload?.leadSignals,
    payload?.leads,
  ].some((value) => {
    if (Array.isArray(value)) {
      return value.length > 0;
    }

    if (value && typeof value === "object") {
      return Object.keys(value).length > 0;
    }

    return typeof value === "string" && value.trim().length > 0;
  });

const inferSourceType = ({
  mimeType,
  hasFile,
  observedText,
  hasDigitalTraces,
}) => {
  if (hasDigitalTraces) {
    return "device";
  }

  if (String(observedText || "").trim()) {
    return "text";
  }

  return "text";
};

const normalizeBase64 = (value) => String(value || "").replace(/\s/g, "");
const LOCAL_DIGITAL_TRACE_SCRIPT = path.resolve(
  __dirname,
  "../scripts/ecg_digital_trace_analysis.py",
);
const LOCAL_PROFILE_OILY_PALETTE_SCRIPT = path.resolve(
  __dirname,
  "../scripts/profile_oily_palette.py",
);
let ecgHealthCache = {
  checkedAt: 0,
  status: "checking",
  details: null,
};

const usingRemoteEcgService = () => Boolean(ECG_PYTHON_SERVICE_URL);

const shouldFallbackToLocalEcg = (error) => {
  const status = Number(error?.status || 0);
  const remoteMessage = String(
    error?.payload?.message || error?.message || "",
  ).toLowerCase();

  if ([502, 503, 504].includes(status)) {
    return true;
  }

  return (
    remoteMessage.includes("local ecg toolchain is unavailable") ||
    remoteMessage.includes("missing model/config files") ||
    remoteMessage.includes("missing python modules") ||
    remoteMessage.includes("remote ecg service is unavailable")
  );
};

const extractAnalysisRequest = (req) => {
  const uploadedFile = req.file || null;
  const jsonMimeType = String(req.body?.mimeType || "").trim();
  const jsonFileName = String(req.body?.fileName || "").trim();
  const acquisitionNote = String(req.body?.acquisitionNote || "").trim();
  const observedText = String(req.body?.observedText || "").trim();
  const pdfPage = Math.max(1, Number(req.body?.pdfPage) || 1);
  const digitalTraces = parseJsonField(req.body?.digitalTraces);
  const leadTraces = parseJsonField(req.body?.leadTraces);
  const deviceTraces = parseJsonField(req.body?.deviceTraces);
  const traces = parseJsonField(req.body?.traces);
  const leadSignals = parseJsonField(req.body?.leadSignals);
  const leads = parseJsonField(req.body?.leads);
  const sampleRateHz =
    Number(req.body?.sampleRateHz || req.body?.samplingRateHz) || undefined;
  const traceUnit = String(
    req.body?.traceUnit || req.body?.signalUnit || req.body?.unit || "",
  ).trim();
  const rawBase64 = normalizeBase64(req.body?.fileData || "");
  const mimeType = uploadedFile?.mimetype || jsonMimeType;
  const fileName = uploadedFile?.originalname || jsonFileName || "ecg-source";
  const base64Data = uploadedFile?.buffer?.toString("base64") || rawBase64;
  const hasDigitalTraces = hasDeviceTracePayload({
    digitalTraces,
    leadTraces,
    deviceTraces,
    traces,
    leadSignals,
    leads,
  });
  const sourceType = inferSourceType({
    mimeType,
    hasFile: Boolean(uploadedFile || base64Data),
    observedText,
    hasDigitalTraces,
  });

  return {
    uploadedFile,
    acquisitionNote,
    observedText,
    pdfPage,
    mimeType,
    fileName,
    base64Data,
    sourceType,
    digitalTraces,
    leadTraces,
    deviceTraces,
    traces,
    leadSignals,
    leads,
    sampleRateHz,
    traceUnit,
  };
};

const callRemoteEcgService = async ({ pathname, method = "GET", payload }) => {
  if (!usingRemoteEcgService()) {
    throw new Error("ECG_PYTHON_SERVICE_URL is not configured.");
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => {
    controller.abort();
  }, ECG_SERVICE_TIMEOUT_MS);

  try {
    const response = await fetch(`${ECG_PYTHON_SERVICE_URL}${pathname}`, {
      method,
      headers:
        method === "GET"
          ? undefined
          : {
              "Content-Type": "application/json",
            },
      body: method === "GET" ? undefined : JSON.stringify(payload || {}),
      signal: controller.signal,
    });

    const rawText = await response.text();
    let parsed = null;
    try {
      parsed = rawText ? JSON.parse(rawText) : {};
    } catch (error) {
      parsed = {
        message: rawText || "Remote ECG service returned a non-JSON response.",
      };
    }

    if (!response.ok) {
      const serviceError = new Error(
        parsed?.message ||
          `Remote ECG service responded with HTTP ${response.status}.`,
      );
      serviceError.status = response.status;
      serviceError.payload = parsed;
      throw serviceError;
    }

    return parsed;
  } catch (error) {
    if (error?.name === "AbortError") {
      const timeoutError = new Error(
        `Remote ECG service timed out after ${ECG_SERVICE_TIMEOUT_MS / 1000} seconds.`,
      );
      timeoutError.status = 504;
      throw timeoutError;
    }

    if (typeof error?.status === "number") {
      throw error;
    }

    const networkError = new Error(
      error?.message || "Unable to reach the remote ECG service.",
    );
    networkError.status = 503;
    throw networkError;
  } finally {
    clearTimeout(timeoutId);
  }
};

const runPythonJsonTool = ({
  scriptPath,
  payload,
  startupErrorMessage,
  exitErrorMessage,
  parseErrorMessage,
}) =>
  new Promise((resolve, reject) => {
    const child = spawn(PYTHON_BINARY, [scriptPath], {
      stdio: ["pipe", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";
    let finished = false;
    const timeoutId = setTimeout(() => {
      if (finished) {
        return;
      }

      finished = true;
      child.kill("SIGKILL");
      reject(
        new Error(
          `${exitErrorMessage} Timed out after ${PYTHON_TOOL_TIMEOUT_MS / 1000} seconds.`,
        ),
      );
    }, PYTHON_TOOL_TIMEOUT_MS);

    child.stdout.on("data", (chunk) => {
      stdout += String(chunk);
    });

    child.stderr.on("data", (chunk) => {
      stderr += String(chunk);
    });

    child.stdin.on("error", (error) => {
      if (finished) {
        return;
      }
      finished = true;
      clearTimeout(timeoutId);
      reject(
        new Error(
          error?.code === "EPIPE"
            ? `${startupErrorMessage} The Python process closed its input pipe unexpectedly.`
            : error?.message || startupErrorMessage,
        ),
      );
    });

    child.on("error", (error) => {
      if (finished) {
        return;
      }
      finished = true;
      clearTimeout(timeoutId);
      reject(new Error(error?.message || startupErrorMessage));
    });

    child.on("close", (code) => {
      if (finished) {
        return;
      }
      finished = true;
      clearTimeout(timeoutId);
      if (code !== 0) {
        reject(new Error(stderr.trim() || stdout.trim() || exitErrorMessage));
        return;
      }

      try {
        const parsed = JSON.parse(stdout || "{}");
        if (!parsed?.ok) {
          throw new Error(parsed?.error || exitErrorMessage);
        }
        resolve(parsed);
      } catch (error) {
        reject(new Error(error?.message || parseErrorMessage));
      }
    });

    try {
      child.stdin.write(JSON.stringify(payload));
      child.stdin.end();
    } catch (error) {
      if (finished) {
        return;
      }
      finished = true;
      clearTimeout(timeoutId);
      reject(
        new Error(
          error?.code === "EPIPE"
            ? `${startupErrorMessage} The Python process closed its input pipe unexpectedly.`
            : error?.message || startupErrorMessage,
        ),
      );
    }
  });

const runPythonCommand = ({ args, timeoutMs = 12000 }) =>
  new Promise((resolve, reject) => {
    const child = spawn(PYTHON_BINARY, args, {
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";
    let finished = false;
    const timeoutId = setTimeout(() => {
      if (finished) {
        return;
      }
      finished = true;
      child.kill("SIGKILL");
      reject(new Error(`Timed out after ${timeoutMs / 1000} seconds.`));
    }, timeoutMs);

    child.stdout.on("data", (chunk) => {
      stdout += String(chunk);
    });

    child.stderr.on("data", (chunk) => {
      stderr += String(chunk);
    });

    child.on("error", (error) => {
      if (finished) {
        return;
      }
      finished = true;
      clearTimeout(timeoutId);
      reject(error);
    });

    child.on("close", (code) => {
      if (finished) {
        return;
      }
      finished = true;
      clearTimeout(timeoutId);

      if (code !== 0) {
        reject(
          new Error(
            stderr.trim() || stdout.trim() || `Exited with code ${code}.`,
          ),
        );
        return;
      }

      resolve({
        stdout: stdout.trim(),
        stderr: stderr.trim(),
      });
    });
  });

const checkLocalEcgEnvironment = async () => {
  const now = Date.now();
  if (now - ecgHealthCache.checkedAt < 30000 && ecgHealthCache.details) {
    return ecgHealthCache.details;
  }

  try {
    const result = await runPythonCommand({
      args: [
        "-c",
        "import importlib.util, json; mods=['numpy','scipy']; missing=[m for m in mods if importlib.util.find_spec(m) is None]; print(json.dumps({'python':'ok','missing':missing,'engine':'digital_trace_ingest'}))",
      ],
      timeoutMs: 12000,
    });
    const parsed = JSON.parse(result.stdout || "{}");
    const details = {
      status:
        Array.isArray(parsed.missing) && parsed.missing.length === 0
          ? "healthy"
          : "degraded",
      python: "ok",
      missingModules: Array.isArray(parsed.missing) ? parsed.missing : [],
      engine: String(parsed.engine || DIGITAL_TRACE_METHOD),
    };
    ecgHealthCache = {
      checkedAt: now,
      status: details.status,
      details,
    };
    return details;
  } catch (error) {
    const details = {
      status: "offline",
      python: "unavailable",
      missingModules: [],
      error: error?.message || "Python ECG toolchain is unavailable.",
    };
    ecgHealthCache = {
      checkedAt: now,
      status: details.status,
      details,
    };
    return details;
  }
};

const runLocalDigitalTraceAnalyzer = ({
  acquisitionNote,
  observedText,
  digitalTraces,
  leadTraces,
  deviceTraces,
  traces,
  leadSignals,
  leads,
  sampleRateHz,
  traceUnit,
}) =>
  runPythonJsonTool({
    scriptPath: LOCAL_DIGITAL_TRACE_SCRIPT,
    payload: {
      acquisitionNote,
      observedText,
      digitalTraces,
      leadTraces,
      deviceTraces,
      traces,
      leadSignals,
      leads,
      sampleRateHz,
      traceUnit,
    },
    startupErrorMessage:
      "Unable to start the local digital ECG trace analyzer.",
    exitErrorMessage: "Local digital ECG trace analyzer exited unexpectedly.",
    parseErrorMessage:
      "Unable to parse the local digital ECG trace analyzer response.",
  }).then((parsed) => {
    if (!parsed?.analysis) {
      throw new Error("Local digital ECG trace analyzer returned no analysis.");
    }

    return parsed.analysis;
  });

const runLocalProfileOilyPaletteGenerator = ({ imageUrl }) =>
  runPythonJsonTool({
    scriptPath: LOCAL_PROFILE_OILY_PALETTE_SCRIPT,
    payload: {
      imageUrl,
    },
    startupErrorMessage:
      "Unable to start the local profile oily palette generator.",
    exitErrorMessage:
      "Local profile oily palette generator exited unexpectedly.",
    parseErrorMessage:
      "Unable to parse the local profile oily palette response.",
  }).then((parsed) => ({
    palette: Array.isArray(parsed?.palette) ? parsed.palette : [],
    overlaySvgDataUrl: String(parsed?.overlaySvgDataUrl || "").trim(),
  }));

ECGRouter.get("/", function (req, res) {
  return res.status(200).json({
    name: "PhenoMed ECG API",
    status: "ready",
    mode: "non-diagnostic",
    acceptedInputs: [
      "digital ECG traces in JSON body under digitalTraces, leadTraces, traces, or leads",
      "optional metadata like sampleRateHz, traceUnit, acquisitionNote, and observedText",
    ],
    supportedMimeTypes: [],
    method: DIGITAL_TRACE_METHOD,
  });
});

ECGRouter.get("/health", async function (req, res) {
  if (usingRemoteEcgService()) {
    try {
      const remoteHealth = await callRemoteEcgService({
        pathname: "/api/ecg/health",
      });
      const httpStatus = remoteHealth?.status === "healthy" ? 200 : 503;
      return res.status(httpStatus).json({
        ...remoteHealth,
        serviceMode: "remote-python-service",
        serviceUrl: ECG_PYTHON_SERVICE_URL,
      });
    } catch (error) {
      if (!shouldFallbackToLocalEcg(error)) {
        return res.status(error?.status || 503).json({
          status: "offline",
          mode: "remote-python-service",
          method: LOCAL_METHOD,
          serviceUrl: ECG_PYTHON_SERVICE_URL,
          message:
            error?.payload?.message ||
            error?.message ||
            "Remote ECG service is unavailable.",
          toolchain: error?.payload?.toolchain || null,
        });
      }
    }
  }

  const toolchain = await checkLocalEcgEnvironment();
  const httpStatus = toolchain.status === "healthy" ? 200 : 503;

  return res.status(httpStatus).json({
    status: toolchain.status,
    mode: "local-only",
    method: DIGITAL_TRACE_METHOD,
    pythonBinary: PYTHON_BINARY,
    toolchain,
    remoteServiceFallback: usingRemoteEcgService(),
    remoteServiceUrl: usingRemoteEcgService() ? ECG_PYTHON_SERVICE_URL : null,
  });
});

ECGRouter.post("/profile-palette/oily", async function (req, res) {
  const imageUrl = String(req.body?.imageUrl || "").trim();

  if (!imageUrl) {
    return res.status(400).json({
      message: "imageUrl is required.",
    });
  }

  if (usingRemoteEcgService()) {
    try {
      const remotePalette = await callRemoteEcgService({
        pathname: "/palette/oily",
        method: "POST",
        payload: {
          imageUrl,
        },
      });

      return res.status(200).json({
        palette: Array.isArray(remotePalette?.palette)
          ? remotePalette.palette
          : [],
        overlaySvgDataUrl: String(
          remotePalette?.overlaySvgDataUrl || "",
        ).trim(),
        serviceMode: "remote-python-service",
        serviceUrl: ECG_PYTHON_SERVICE_URL,
      });
    } catch (error) {
      if (!shouldFallbackToLocalEcg(error)) {
        return res.status(error?.status || 503).json({
          ...(error?.payload && typeof error.payload === "object"
            ? error.payload
            : {}),
          message:
            error?.payload?.message ||
            error?.message ||
            "Remote palette service is unavailable.",
          serviceMode: "remote-python-service",
          serviceUrl: ECG_PYTHON_SERVICE_URL,
        });
      }
    }
  }

  try {
    const generatedPalette = await runLocalProfileOilyPaletteGenerator({
      imageUrl,
    });

    return res.status(200).json({
      ...generatedPalette,
      serviceMode: "local-only",
    });
  } catch (error) {
    return res.status(500).json({
      message:
        error?.message ||
        "Unable to generate oily palette from profile picture.",
    });
  }
});

ECGRouter.post(
  "/analyze",
  upload.single("file"),
  async function (req, res, next) {
    try {
      const {
        uploadedFile,
        acquisitionNote,
        observedText,
        pdfPage,
        mimeType,
        fileName,
        base64Data,
        sourceType,
        digitalTraces,
        leadTraces,
        deviceTraces,
        traces,
        leadSignals,
        leads,
        sampleRateHz,
        traceUnit,
      } = extractAnalysisRequest(req);

      if (
        !uploadedFile &&
        !base64Data &&
        !observedText &&
        sourceType !== "device"
      ) {
        return res.status(400).json({
          message: "Provide device digital traces for analysis.",
        });
      }

      if (sourceType !== "device") {
        return res.status(415).json({
          message:
            "Image, PDF, and text-only ECG submissions are no longer supported. Send device digital traces instead.",
        });
      }

      if (usingRemoteEcgService()) {
        try {
          const remoteJob = await callRemoteEcgService({
            pathname: "/api/ecg/jobs",
            method: "POST",
            payload: {
              acquisitionNote,
              observedText,
              mimeType,
              fileName,
              fileData: base64Data,
              pdfPage,
              digitalTraces,
              leadTraces,
              deviceTraces,
              traces,
              leadSignals,
              leads,
              sampleRateHz,
              traceUnit,
            },
          });

          return res.status(202).json({
            ...remoteJob,
            serviceMode: "remote-python-service",
            serviceUrl: ECG_PYTHON_SERVICE_URL,
            sourceType,
          });
        } catch (error) {
          if (!shouldFallbackToLocalEcg(error)) {
            return res.status(error?.status || 503).json({
              ...(error?.payload && typeof error.payload === "object"
                ? error.payload
                : {}),
              message:
                error?.payload?.message ||
                error?.message ||
                "Remote ECG service is unavailable.",
              serviceMode: "remote-python-service",
              serviceUrl: ECG_PYTHON_SERVICE_URL,
            });
          }
        }
      }

      if (sourceType === "device") {
        const analysis = await runLocalDigitalTraceAnalyzer({
          acquisitionNote,
          observedText,
          digitalTraces,
          leadTraces,
          deviceTraces,
          traces,
          leadSignals,
          leads,
          sampleRateHz,
          traceUnit,
        });

        return res.status(200).json({
          mode: "non-diagnostic",
          sourceType,
          method: DIGITAL_TRACE_METHOD,
          analysis,
          serviceMode: "local-only",
        });
      }

      return res.status(415).json({
        message:
          "Image, PDF, and text-only ECG submissions are no longer supported. Send device digital traces instead.",
      });
    } catch (error) {
      return res.status(500).json({
        message:
          error?.message || "Unable to analyze the ECG source right now.",
      });
    }
  },
);

ECGRouter.get("/jobs/:jobId", async function (req, res) {
  if (usingRemoteEcgService()) {
    try {
      const remoteJob = await callRemoteEcgService({
        pathname: `/api/ecg/jobs/${encodeURIComponent(String(req.params.jobId || ""))}`,
      });
      return res.status(200).json({
        ...remoteJob,
        serviceMode: "remote-python-service",
        serviceUrl: ECG_PYTHON_SERVICE_URL,
      });
    } catch (error) {
      return res.status(error?.status || 503).json({
        ...(error?.payload && typeof error.payload === "object"
          ? error.payload
          : {}),
        message:
          error?.payload?.message ||
          error?.message ||
          "Remote ECG service is unavailable.",
        serviceMode: "remote-python-service",
        serviceUrl: ECG_PYTHON_SERVICE_URL,
      });
    }
  }

  return res.status(501).json({
    message: "Local ECG job polling is not implemented.",
  });
});

ECGRouter.post("/jobs/:jobId/cancel", async function (req, res) {
  if (usingRemoteEcgService()) {
    try {
      const remoteJob = await callRemoteEcgService({
        pathname: `/api/ecg/jobs/${encodeURIComponent(String(req.params.jobId || ""))}/cancel`,
        method: "POST",
        payload: {},
      });
      return res.status(200).json({
        ...remoteJob,
        serviceMode: "remote-python-service",
        serviceUrl: ECG_PYTHON_SERVICE_URL,
      });
    } catch (error) {
      return res.status(error?.status || 503).json({
        ...(error?.payload && typeof error.payload === "object"
          ? error.payload
          : {}),
        message:
          error?.payload?.message ||
          error?.message ||
          "Remote ECG service is unavailable.",
        serviceMode: "remote-python-service",
        serviceUrl: ECG_PYTHON_SERVICE_URL,
      });
    }
  }

  return res.status(501).json({
    message: "Local ECG job cancellation is not implemented.",
  });
});

ECGRouter.use(function (error, req, res, next) {
  if (error?.code === "LIMIT_FILE_SIZE") {
    return res.status(413).json({
      message: "ECG file is too large. Maximum size is 15 MB.",
    });
  }

  return next(error);
});

export default ECGRouter;
