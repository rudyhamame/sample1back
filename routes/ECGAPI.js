import express from "express";
import multer from "multer";
import path from "path";
import { spawn } from "child_process";
import { fileURLToPath } from "url";

const ECGRouter = express.Router();
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const LOCAL_METHOD = "deterministic_digitizer";
const PYTHON_BINARY = process.env.PYTHON_BINARY || "python";
const PYTHON_TOOL_TIMEOUT_MS = 45000;
const ECG_SERVICE_TIMEOUT_MS = 600000;
const MAX_FILE_SIZE_BYTES = 15 * 1024 * 1024;
const ECG_PYTHON_SERVICE_URL = String(
  process.env.ECG_PYTHON_SERVICE_URL || "",
).trim().replace(/\/+$/, "");
const SUPPORTED_IMAGE_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/heic",
  "image/heif",
]);
const SUPPORTED_FILE_TYPES = new Set([
  ...SUPPORTED_IMAGE_TYPES,
  "application/pdf",
]);

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: MAX_FILE_SIZE_BYTES,
  },
});

const inferSourceType = ({ mimeType, hasFile, observedText }) => {
  if (mimeType === "application/pdf") {
    return "pdf";
  }

  if (hasFile) {
    return "image";
  }

  if (String(observedText || "").trim()) {
    return "text";
  }

  return "text";
};

const normalizeBase64 = (value) => String(value || "").replace(/\s/g, "");
const LOCAL_DIGITIZER_SCRIPT = path.resolve(
  __dirname,
  "../scripts/ecg_digitize.py",
);
const LOCAL_PDF_RASTERIZER_SCRIPT = path.resolve(
  __dirname,
  "../scripts/ecg_pdf_to_image.py",
);
let ecgHealthCache = {
  checkedAt: 0,
  status: "checking",
  details: null,
};

const usingRemoteEcgService = () => Boolean(ECG_PYTHON_SERVICE_URL);

const isImageMimeType = (mimeType) => SUPPORTED_IMAGE_TYPES.has(String(mimeType || "").trim());

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
        parsed?.message || `Remote ECG service responded with HTTP ${response.status}.`,
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
    const child = spawn(
      PYTHON_BINARY,
      [scriptPath],
      {
        stdio: ["pipe", "pipe", "pipe"],
      },
    );

    let stdout = "";
    let stderr = "";
    let finished = false;
    const timeoutId = setTimeout(() => {
      if (finished) {
        return;
      }

      finished = true;
      child.kill("SIGKILL");
      reject(new Error(`${exitErrorMessage} Timed out after ${PYTHON_TOOL_TIMEOUT_MS / 1000} seconds.`));
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
      reject(
        new Error(
          error?.message || startupErrorMessage,
        ),
      );
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
            stderr.trim() ||
              stdout.trim() ||
              exitErrorMessage,
          ),
        );
        return;
      }

      try {
        const parsed = JSON.parse(stdout || "{}");
        if (!parsed?.ok) {
          throw new Error(parsed?.error || exitErrorMessage);
        }
        resolve(parsed);
      } catch (error) {
        reject(
          new Error(
            error?.message || parseErrorMessage,
          ),
        );
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
        reject(new Error(stderr.trim() || stdout.trim() || `Exited with code ${code}.`));
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
        "import importlib.util, json; mods=['PIL','cv2','numpy','scipy','pypdfium2']; missing=[m for m in mods if importlib.util.find_spec(m) is None]; print(json.dumps({'python':'ok','missing':missing}))",
      ],
      timeoutMs: 12000,
    });
    const parsed = JSON.parse(result.stdout || "{}");
    const details = {
      status: Array.isArray(parsed.missing) && parsed.missing.length === 0 ? "healthy" : "degraded",
      python: "ok",
      missingModules: Array.isArray(parsed.missing) ? parsed.missing : [],
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

const runLocalDigitizer = ({
  acquisitionNote,
  observedText,
  base64Data,
}) =>
  runPythonJsonTool({
    scriptPath: LOCAL_DIGITIZER_SCRIPT,
    payload: {
      acquisitionNote,
      observedText,
      base64Data,
    },
    startupErrorMessage: "Unable to start the local ECG digitizer.",
    exitErrorMessage: "Local ECG digitizer exited unexpectedly.",
    parseErrorMessage: "Unable to parse the local ECG digitizer response.",
  }).then((parsed) => {
    if (!parsed?.analysis) {
      throw new Error("Local ECG digitizer returned no analysis.");
    }

    return parsed.analysis;
  });

const rasterizePdfPage = ({ base64Data, pdfPage }) =>
  runPythonJsonTool({
    scriptPath: LOCAL_PDF_RASTERIZER_SCRIPT,
    payload: {
      base64Data,
      pdfPage,
    },
    startupErrorMessage: "Unable to start the local ECG PDF rasterizer.",
    exitErrorMessage: "Local ECG PDF rasterizer exited unexpectedly.",
    parseErrorMessage: "Unable to parse the local ECG PDF rasterizer response.",
  }).then((parsed) => {
    if (!parsed?.base64Data) {
      throw new Error("Local ECG PDF rasterizer returned no image data.");
    }

    return parsed;
  });

ECGRouter.get("/", function (req, res) {
  return res.status(200).json({
    name: "PhenoMed ECG API",
    status: "ready",
    mode: "non-diagnostic",
    acceptedInputs: [
      "multipart/form-data file upload under field name 'file'",
      "base64 file data in JSON body",
      "text-only ECG observations in JSON body",
    ],
    supportedMimeTypes: [...SUPPORTED_FILE_TYPES],
    method: LOCAL_METHOD,
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
      return res.status(error?.status || 503).json({
        status: "offline",
        mode: "remote-python-service",
        method: LOCAL_METHOD,
        serviceUrl: ECG_PYTHON_SERVICE_URL,
        message: error?.payload?.message || error?.message || "Remote ECG service is unavailable.",
        toolchain: error?.payload?.toolchain || null,
      });
    }
  }

  const toolchain = await checkLocalEcgEnvironment();
  const httpStatus = toolchain.status === "healthy" ? 200 : 503;

  return res.status(httpStatus).json({
    status: toolchain.status,
    mode: "local-only",
    method: LOCAL_METHOD,
    pythonBinary: PYTHON_BINARY,
    toolchain,
  });
});

ECGRouter.post(
  "/analyze",
  upload.single("file"),
  async function (req, res, next) {
    try {
      const uploadedFile = req.file || null;
      const jsonMimeType = String(req.body?.mimeType || "").trim();
      const jsonFileName = String(req.body?.fileName || "").trim();
      const acquisitionNote = String(req.body?.acquisitionNote || "").trim();
      const observedText = String(req.body?.observedText || "").trim();
      const pdfPage = Math.max(1, Number(req.body?.pdfPage) || 1);
      const rawBase64 = normalizeBase64(req.body?.fileData || "");

      const mimeType = uploadedFile?.mimetype || jsonMimeType;
      const fileName = uploadedFile?.originalname || jsonFileName || "ecg-source";
      const base64Data = uploadedFile?.buffer?.toString("base64") || rawBase64;

      if (!uploadedFile && !base64Data && !observedText) {
        return res.status(400).json({
          message:
            "Provide an ECG file, base64 fileData, or observedText for analysis.",
        });
      }

      if ((uploadedFile || base64Data) && !SUPPORTED_FILE_TYPES.has(mimeType)) {
        return res.status(415).json({
          message:
            "Unsupported ECG file type. Use JPG, PNG, WEBP, HEIC, HEIF, or PDF.",
        });
      }

      const sourceType = inferSourceType({
        mimeType,
        hasFile: Boolean(uploadedFile || base64Data),
        observedText,
      });

      if (usingRemoteEcgService()) {
        try {
          const remoteAnalysis = await callRemoteEcgService({
            pathname: "/api/ecg/analyze",
            method: "POST",
            payload: {
              acquisitionNote,
              observedText,
              mimeType,
              fileName,
              fileData: base64Data,
              pdfPage,
            },
          });

          return res.status(200).json({
            ...remoteAnalysis,
            serviceMode: "remote-python-service",
            serviceUrl: ECG_PYTHON_SERVICE_URL,
          });
        } catch (error) {
          return res.status(error?.status || 503).json({
            ...(error?.payload && typeof error.payload === "object" ? error.payload : {}),
            message:
              error?.payload?.message ||
              error?.message ||
              "Remote ECG service is unavailable.",
            serviceMode: "remote-python-service",
            serviceUrl: ECG_PYTHON_SERVICE_URL,
          });
        }
      }

      const toolchain = await checkLocalEcgEnvironment();
      if (toolchain.status !== "healthy") {
        return res.status(503).json({
          message:
            toolchain.error ||
            (toolchain.missingModules?.length
              ? `Local ECG toolchain is unavailable. Missing Python modules: ${toolchain.missingModules.join(", ")}.`
              : "Local ECG toolchain is unavailable on this deployment."),
          toolchain,
        });
      }

      if (sourceType === "pdf") {
        const rasterizedPage = await rasterizePdfPage({
          base64Data,
          pdfPage,
        });

        const analysis = await runLocalDigitizer({
          acquisitionNote:
            acquisitionNote ||
            `PDF ECG page ${rasterizedPage.selectedPage} rasterized locally before digitization.`,
          observedText,
          base64Data: rasterizedPage.base64Data,
        });

        return res.status(200).json({
          mode: "non-diagnostic",
          sourceType,
          method: `${LOCAL_METHOD}_via_pdf_rasterization`,
          analysis,
          pdfPage: rasterizedPage.selectedPage,
          pdfPageCount: rasterizedPage.pageCount,
        });
      }

      if (sourceType === "text") {
        return res.status(501).json({
          message:
            "Local ECG digitization currently needs an ECG image upload. Text-only local analysis is not implemented.",
        });
      }

      if (!base64Data || !isImageMimeType(mimeType)) {
        return res.status(400).json({
          message:
            "Local ECG digitization needs a supported ECG image upload: JPG, PNG, WEBP, HEIC, or HEIF.",
        });
      }

      const analysis = await runLocalDigitizer({
        acquisitionNote,
        observedText,
        base64Data,
      });

      return res.status(200).json({
        mode: "non-diagnostic",
        sourceType,
        method: LOCAL_METHOD,
        analysis,
      });
    } catch (error) {
      return res.status(500).json({
        message:
          error?.message ||
          "Unable to analyze the ECG source right now.",
      });
    }
  }
);

ECGRouter.use(function (error, req, res, next) {
  if (error?.code === "LIMIT_FILE_SIZE") {
    return res.status(413).json({
      message: "ECG file is too large. Maximum size is 15 MB.",
    });
  }

  return next(error);
});

export default ECGRouter;
