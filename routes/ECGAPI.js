import express from "express";
import multer from "multer";
import path from "path";
import { spawn } from "child_process";
import { fileURLToPath } from "url";

const ECGRouter = express.Router();
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const LOCAL_METHOD = "deterministic_digitizer";
const MAX_FILE_SIZE_BYTES = 15 * 1024 * 1024;
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

const isImageMimeType = (mimeType) => SUPPORTED_IMAGE_TYPES.has(String(mimeType || "").trim());

const runPythonJsonTool = ({
  scriptPath,
  payload,
  startupErrorMessage,
  exitErrorMessage,
  parseErrorMessage,
}) =>
  new Promise((resolve, reject) => {
    const child = spawn(
      "python",
      [scriptPath],
      {
        stdio: ["pipe", "pipe", "pipe"],
      },
    );

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk) => {
      stdout += String(chunk);
    });

    child.stderr.on("data", (chunk) => {
      stderr += String(chunk);
    });

    child.on("error", (error) => {
      reject(
        new Error(
          error?.message || startupErrorMessage,
        ),
      );
    });

    child.on("close", (code) => {
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

    child.stdin.write(JSON.stringify(payload));
    child.stdin.end();
  });

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
