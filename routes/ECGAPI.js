import express from "express";
import multer from "multer";
import OpenAI from "openai";
import path from "path";
import { spawn } from "child_process";
import { fileURLToPath } from "url";

const ECGRouter = express.Router();
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DEFAULT_MODEL = process.env.OPENAI_MODEL || "gpt-5-mini";
const LOCAL_METHOD = "deterministic_digitizer";
const LOCAL_DIGITIZER_ENABLED =
  String(process.env.ECG_LOCAL_DIGITIZER_ENABLED || "").trim().toLowerCase() ===
  "true";
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

const ECG_ANALYSIS_INSTRUCTIONS = `You are PhenoMed ECG, a non-diagnostic ECG phenomenon extraction assistant.
Your job is to analyze an ECG image, ECG PDF, or textual ECG observations and return only observable/measurable findings.
Do not diagnose, do not name diseases, do not recommend treatment, and do not infer clinical meaning beyond what is visibly present.
Focus on the graph, points, intervals, amplitudes, segment changes, polarity, rhythm regularity, lead-specific increases/decreases, and any limitations in the source quality.
If something cannot be read clearly, say it is unclear instead of guessing.`;

const ECG_ANALYSIS_SCHEMA = {
  name: "ecg_phenomenon_analysis",
  strict: true,
  schema: {
    type: "object",
    additionalProperties: false,
    properties: {
      sourceType: {
        type: "string",
        enum: ["image", "pdf", "text"],
      },
      summary: {
        type: "string",
      },
      acquisitionNote: {
        type: "string",
      },
      qualityAssessment: {
        type: "object",
        additionalProperties: false,
        properties: {
          readability: {
            type: "string",
            enum: ["good", "fair", "limited", "unreadable"],
          },
          gridVisible: {
            type: ["boolean", "null"],
          },
          calibrationVisible: {
            type: ["boolean", "null"],
          },
          limitations: {
            type: "array",
            items: {
              type: "string",
            },
          },
        },
        required: [
          "readability",
          "gridVisible",
          "calibrationVisible",
          "limitations",
        ],
      },
      measurements: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            label: { type: "string" },
            value: { type: ["number", "null"] },
            unit: { type: "string" },
            lead: { type: "string" },
            qualifier: { type: "string" },
            evidence: { type: "string" },
          },
          required: ["label", "value", "unit", "lead", "qualifier", "evidence"],
        },
      },
      waveformPoints: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            structure: { type: "string" },
            observedState: { type: "string" },
            leads: {
              type: "array",
              items: { type: "string" },
            },
            evidence: { type: "string" },
          },
          required: ["structure", "observedState", "leads", "evidence"],
        },
      },
      leadFindings: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            lead: { type: "string" },
            phenomenon: { type: "string" },
            direction: {
              type: "string",
              enum: ["increase", "decrease", "flat", "inverted", "biphasic", "none", "unclear"],
            },
            magnitude: { type: "string" },
            evidence: { type: "string" },
          },
          required: ["lead", "phenomenon", "direction", "magnitude", "evidence"],
        },
      },
      rhythmFeatures: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            feature: { type: "string" },
            observedState: { type: "string" },
            evidence: { type: "string" },
          },
          required: ["feature", "observedState", "evidence"],
        },
      },
      trends: {
        type: "object",
        additionalProperties: false,
        properties: {
          increases: {
            type: "array",
            items: { type: "string" },
          },
          decreases: {
            type: "array",
            items: { type: "string" },
          },
          stableOrNeutral: {
            type: "array",
            items: { type: "string" },
          },
        },
        required: ["increases", "decreases", "stableOrNeutral"],
      },
      extractedText: {
        type: "array",
        items: { type: "string" },
      },
      nonDiagnosticNotice: {
        type: "string",
      },
    },
    required: [
      "sourceType",
      "summary",
      "acquisitionNote",
      "qualityAssessment",
      "measurements",
      "waveformPoints",
      "leadFindings",
      "rhythmFeatures",
      "trends",
      "extractedText",
      "nonDiagnosticNotice",
    ],
  },
};

const getOpenAIClient = () => {
  if (!process.env.OPENAI_API_KEY) {
    return null;
  }

  return new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
  });
};

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

const isImageMimeType = (mimeType) => SUPPORTED_IMAGE_TYPES.has(String(mimeType || "").trim());

const runLocalDigitizer = ({
  acquisitionNote,
  observedText,
  base64Data,
}) =>
  new Promise((resolve, reject) => {
    const child = spawn(
      "python",
      [LOCAL_DIGITIZER_SCRIPT],
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
          error?.message || "Unable to start the local ECG digitizer.",
        ),
      );
    });

    child.on("close", (code) => {
      if (code !== 0) {
        reject(
          new Error(
            stderr.trim() ||
              stdout.trim() ||
              "Local ECG digitizer exited unexpectedly.",
          ),
        );
        return;
      }

      try {
        const parsed = JSON.parse(stdout || "{}");

        if (!parsed?.ok || !parsed?.analysis) {
          throw new Error(parsed?.error || "Local ECG digitizer returned no analysis.");
        }

        resolve(parsed.analysis);
      } catch (error) {
        reject(
          new Error(
            error?.message || "Unable to parse the local ECG digitizer response.",
          ),
        );
      }
    });

    child.stdin.write(
      JSON.stringify({
        acquisitionNote,
        observedText,
        base64Data,
      }),
    );
    child.stdin.end();
  });

const buildFileInput = ({ mimeType, fileName, base64Data }) => {
  if (!mimeType || !base64Data) {
    return null;
  }

  if (mimeType === "application/pdf") {
    return {
      type: "input_file",
      filename: fileName || "ecg.pdf",
      file_data: base64Data,
    };
  }

  return {
    type: "input_image",
    detail: "high",
    image_url: `data:${mimeType};base64,${base64Data}`,
  };
};

const buildUserPrompt = ({ acquisitionNote, observedText, pdfPage }) => {
  return `Analyze this ECG source and extract observable phenomena only.

Acquisition note:
${acquisitionNote || "Not provided."}

Selected PDF page:
${pdfPage || "Not specified."}

Additional textual observations:
${observedText || "None provided."}

Return only structured ECG phenomena, measurements, waveform points, increases, decreases, lead-based observations, and source limitations.
Do not provide diagnosis or interpretation.`;
};

const parseStructuredOutput = (response) => {
  const raw = String(response?.output_text || "").trim();

  if (!raw) {
    throw new Error("OpenAI returned an empty ECG analysis.");
  }

  return JSON.parse(raw);
};

const requestOpenAIAnalysis = async ({
  client,
  acquisitionNote,
  observedText,
  pdfPage,
  mimeType,
  fileName,
  base64Data,
}) => {
  const content = [
    {
      type: "input_text",
      text: buildUserPrompt({
        acquisitionNote,
        observedText,
        pdfPage,
      }),
    },
  ];

  const fileInput = buildFileInput({
    mimeType,
    fileName,
    base64Data,
  });

  if (fileInput) {
    content.push(fileInput);
  }

  const response = await client.responses.create({
    model: DEFAULT_MODEL,
    instructions: ECG_ANALYSIS_INSTRUCTIONS,
    input: [
      {
        role: "user",
        content,
      },
    ],
    text: {
      verbosity: "low",
      format: {
        type: "json_schema",
        ...ECG_ANALYSIS_SCHEMA,
      },
    },
  });

  return parseStructuredOutput(response);
};

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

      if (
        LOCAL_DIGITIZER_ENABLED &&
        sourceType === "image" &&
        base64Data &&
        isImageMimeType(mimeType)
      ) {
        try {
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
        } catch (localError) {
          const client = getOpenAIClient();

          if (!client) {
            return res.status(500).json({
              message: `Local ECG digitization failed: ${localError.message}`,
            });
          }

          const analysis = await requestOpenAIAnalysis({
            client,
            acquisitionNote,
            observedText,
            pdfPage,
            mimeType,
            fileName,
            base64Data,
          });

          return res.status(200).json({
            model: DEFAULT_MODEL,
            mode: "non-diagnostic",
            sourceType,
            method: "openai_fallback_after_local_failure",
            analysis,
            warning: `Local ECG digitization failed and the request used model fallback: ${localError.message}`,
          });
        }
      }

      const client = getOpenAIClient();

      if (!client) {
        return res.status(500).json({
          message:
            sourceType === "pdf"
              ? "PDF ECG analysis currently needs OPENAI_API_KEY because local PDF digitization is not configured yet."
              : LOCAL_DIGITIZER_ENABLED
                ? "Missing OPENAI_API_KEY in the backend environment."
                : "OPENAI_API_KEY is required because local ECG digitization is disabled on this deployment.",
        });
      }

      const analysis = await requestOpenAIAnalysis({
        client,
        acquisitionNote,
        observedText,
        pdfPage,
        mimeType,
        fileName,
        base64Data,
      });

      return res.status(200).json({
        model: DEFAULT_MODEL,
        mode: "non-diagnostic",
        sourceType,
        method: "openai",
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
