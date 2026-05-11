import express from "express";
import OpenAI from "openai";
import UserModel from "../compat/UserModel.js";
import {
  findAiSettingsLean,
  findUserMemoryLean,
} from "../services/userData.js";

const EnquiriesRouter = express.Router();

const DEFAULT_GROQ_MODEL =
  process.env.GROQ_MODEL ||
  process.env.OPENAI_MODEL ||
  process.env.OPENAI_OFFICIAL_MODEL ||
  "llama-3.3-70b-versatile";
const DEFAULT_OPENAI_MODEL =
  process.env.OPENAI_OFFICIAL_MODEL ||
  process.env.OPENAI_MODEL ||
  process.env.GROQ_MODEL ||
  "gpt-5-mini";
const DEFAULT_KIMI_MODEL =
  process.env.KIMI_MODEL || process.env.MOONSHOT_MODEL || "kimi-k2.5";
const VALID_AI_PROVIDERS = ["openai", "groq", "gemini", "kimi"];
const DEFAULT_NO_PROVIDER_MESSAGE =
  "Missing GROQ_API_KEY, GEMINI_API_KEY, MOONSHOT_API_KEY, and OPENAI_API_KEY in the backend environment.";
const DEFAULT_INSTRUCTIONS =
  "You are a helpful assistant for MCTOSH. Answer website enquiries clearly, professionally, and concisely. If a question is missing details, say what information is needed.";
const DEFAULT_GREETING_INSTRUCTIONS =
  "You write one cheerful and professional sentence for a doctor dashboard. Mention the doctor's momentum based on the provided database summary. Keep it under 24 words. Do not use markdown, bullet points, or emojis.";

const normalizeTextField = (value) => {
  if (typeof value === "string") {
    return value.trim();
  }

  if (typeof value === "number") {
    return String(value).trim();
  }

  return "";
};

const resolveEnquiryMessage = (body) =>
  normalizeTextField(body?.message) ||
  normalizeTextField(body?.prompt) ||
  normalizeTextField(body?.question) ||
  normalizeTextField(body?.text);

const getGroqClient = () => {
  const apiKey = String(process.env.GROQ_API_KEY || "").trim();

  if (!apiKey) {
    return null;
  }

  const baseURL = String(process.env.GROQ_BASE_URL || "").trim();

  return new OpenAI({
    apiKey,
    ...(baseURL ? { baseURL } : {}),
  });
};

const getOpenAIClient = () => {
  const apiKey = String(
    process.env.OPENAI_API_KEY || process.env.OPENAI_OFFICIAL_API_KEY || "",
  ).trim();

  if (!apiKey) {
    return null;
  }

  const baseURL = String(process.env.OPENAI_BASE_URL || "").trim();

  return new OpenAI({
    apiKey,
    ...(baseURL ? { baseURL } : {}),
  });
};

const getKimiClient = () => {
  const apiKey = String(
    process.env.MOONSHOT_API_KEY || process.env.KIMI_API_KEY || "",
  ).trim();

  if (!apiKey) {
    return null;
  }

  const baseURL =
    String(process.env.MOONSHOT_BASE_URL || process.env.KIMI_BASE_URL || "").trim() ||
    "https://api.moonshot.ai/v1";

  return new OpenAI({
    apiKey,
    baseURL,
  });
};

const getGeminiApiKey = () => String(process.env.GEMINI_API_KEY || "").trim();
const getConfiguredAiProviders = (
  groqClient = null,
  openAiClient = null,
  kimiClient = null,
) => {
  const providers = [];

  if (groqClient || getGroqClient()) {
    providers.push("groq");
  }

  if (getGeminiApiKey()) {
    providers.push("gemini");
  }

  if (kimiClient || getKimiClient()) {
    providers.push("kimi");
  }

  if (openAiClient || getOpenAIClient()) {
    providers.push("openai");
  }

  return providers;
};
const getDefaultAiProvider = (
  groqClient = null,
  openAiClient = null,
  kimiClient = null,
) => getConfiguredAiProviders(groqClient, openAiClient, kimiClient)[0] || "openai";
const normalizeAiProvider = (value = "", fallbackProvider = "openai") => {
  const normalizedValue = String(value || "")
    .trim()
    .toLowerCase();

  return VALID_AI_PROVIDERS.includes(normalizedValue)
    ? normalizedValue
    : fallbackProvider;
};
const hasExplicitAiProviderSelection = (value = "") =>
  VALID_AI_PROVIDERS.includes(String(value || "").trim().toLowerCase());
const isProviderConfigured = (provider, groqClient, openAiClient, kimiClient) => {
  if (provider === "groq") {
    return Boolean(groqClient);
  }

  if (provider === "openai") {
    return Boolean(openAiClient);
  }

  if (provider === "kimi") {
    return Boolean(kimiClient);
  }

  if (provider === "gemini") {
    return Boolean(getGeminiApiKey());
  }

  return false;
};
const getMissingProviderConfigurationMessage = (provider) => {
  if (provider === "groq") {
    return "Missing GROQ_API_KEY in the backend environment.";
  }

  if (provider === "gemini") {
    return "Missing GEMINI_API_KEY in the backend environment.";
  }

  if (provider === "kimi") {
    return "Missing MOONSHOT_API_KEY in the backend environment.";
  }

  return "Missing OPENAI_API_KEY in the backend environment.";
};
const isAiQuotaError = (error) => {
  const message = String(error?.message || "").toLowerCase();
  const status = Number(error?.status || error?.code || 0);

  return (
    status === 429 ||
    message.includes("quota") ||
    message.includes("billing") ||
    message.includes("rate limit")
  );
};
const buildAiProviderFailureMessage = (
  providerErrors = [],
  fallbackMessage = "Unable to complete the AI request.",
) => {
  const firstQuotaError = providerErrors.find(({ message }) =>
    isAiQuotaError({ message }),
  );

  if (firstQuotaError) {
    return `The ${String(firstQuotaError.provider || "selected").toUpperCase()} AI provider is out of quota or rate-limited. Add quota or configure another provider key.`;
  }

  return providerErrors[0]?.message || fallbackMessage;
};

const getPreferredAiProvider = (
  userPreferredProvider = "",
  groqClient = null,
  openAiClient = null,
  kimiClient = null,
) => {
  return normalizeAiProvider(
    userPreferredProvider || process.env.APP_AI_PROVIDER || "",
    getDefaultAiProvider(groqClient, openAiClient, kimiClient),
  );
};

const createGeminiResponse = async ({
  model = process.env.GEMINI_MODEL || "gemini-2.5-flash",
  instructions = "",
  input = "",
}) => {
  const apiKey = getGeminiApiKey();

  if (!apiKey) {
    throw new Error("Missing GEMINI_API_KEY in the backend environment.");
  }

  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(
      model,
    )}:generateContent`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": apiKey,
      },
      body: JSON.stringify({
        systemInstruction: {
          parts: [{ text: String(instructions || "") }],
        },
        contents: [
          {
            role: "user",
            parts: [{ text: String(input || "") }],
          },
        ],
        generationConfig: {
          temperature: 0.2,
        },
      }),
    },
  );

  const payload = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(
      payload?.error?.message || "Gemini enquiry request failed.",
    );
  }

  return (Array.isArray(payload?.candidates) ? payload.candidates : [])
    .flatMap((candidate) =>
      Array.isArray(candidate?.content?.parts) ? candidate.content.parts : [],
    )
    .map((part) => String(part?.text || "").trim())
    .filter(Boolean)
    .join("\n")
    .trim();
};

const createOpenAiResponse = async ({
  client,
  model = DEFAULT_OPENAI_MODEL,
  provider = "openai",
  instructions = "",
  input = "",
}) => {
  if (!client) {
    throw new Error("Missing OPENAI_API_KEY in the backend environment.");
  }

  if (provider === "kimi") {
    const completion = await client.chat.completions.create({
      model,
      messages: [
        ...(String(instructions || "").trim()
          ? [{ role: "system", content: String(instructions || "") }]
          : []),
        { role: "user", content: String(input || "") },
      ],
    });

    return String(completion?.choices?.[0]?.message?.content || "").trim();
  }

  const response = await client.responses.create({
    model,
    instructions: String(instructions || ""),
    input: String(input || ""),
  });

  return String(response?.output_text || "").trim();
};

const getOpenAiCompatibleClient = (
  provider,
  groqClient,
  openAiClient,
  kimiClient,
) => {
  if (provider === "groq") {
    return groqClient;
  }

  if (provider === "kimi") {
    return kimiClient;
  }

  if (provider === "openai") {
    return openAiClient;
  }

  return null;
};

const getOpenAiCompatibleModel = (provider) =>
  provider === "groq"
    ? DEFAULT_GROQ_MODEL
    : provider === "kimi"
      ? DEFAULT_KIMI_MODEL
      : DEFAULT_OPENAI_MODEL;

const buildProviderAttemptOrder = (
  preferredProvider,
  groqClient,
  openAiClient,
  kimiClient,
  { allowFallback = true } = {},
) => {
  const availableProviders = [];

  if (
    isProviderConfigured(preferredProvider, groqClient, openAiClient, kimiClient)
  ) {
    availableProviders.push(preferredProvider);
  }

  if (!allowFallback) {
    return availableProviders;
  }

  if (groqClient && !availableProviders.includes("groq")) {
    availableProviders.push("groq");
  }

  if (openAiClient && !availableProviders.includes("openai")) {
    availableProviders.push("openai");
  }

  if (kimiClient && !availableProviders.includes("kimi")) {
    availableProviders.push("kimi");
  }

  if (getGeminiApiKey() && !availableProviders.includes("gemini")) {
    availableProviders.push("gemini");
  }

  return availableProviders;
};

const buildUserSummary = (user, memoryDoc) => {
  const courses = Array.isArray(memoryDoc?.courses)
    ? memoryDoc.courses.length
    : 0;
  const lectures = (
    Array.isArray(memoryDoc?.studyPlanner?.studyOrganizer?.courses)
      ? memoryDoc.studyPlanner.studyOrganizer.courses
      : []
  ).reduce((lectureCount, course) => {
    const components = Array.isArray(course?.components)
      ? course.components
      : [];
    return (
      lectureCount +
      components.reduce((componentLectureCount, component) => {
        const componentLectures = Array.isArray(component?.lectures)
          ? component.lectures.length
          : 0;
        return componentLectureCount + componentLectures;
      }, 0)
    );
  }, 0);
  const friends = Array.isArray(user?.connections)
    ? user.connections.length
    : 0;

  return {
    username: user?.auth?.username || "",
    firstname: user?.bio?.firstname || "",
    lastname: user?.bio?.lastname || "",
    counts: {
      friends,
      courses,
      lectures,
    },
  };
};

const buildFallbackGreeting = (summary) => {
  const { username, counts } = summary;
  return `Dr. ${username}, your workspace is looking strong with ${counts.courses} courses and ${counts.lectures} lectures ready for today.`;
};

const getGreetingErrorReply = (error, summary) => {
  const message = String(error?.message || "").toLowerCase();
  const status = error?.status;

  if (
    status === 429 ||
    message.includes("quota") ||
    message.includes("billing") ||
    message.includes("rate limit")
  ) {
    return "ChatGPT API has low balance.";
  }

  return buildFallbackGreeting(summary);
};

EnquiriesRouter.post("/", async function (req, res) {
  const message = resolveEnquiryMessage(req.body);
  const context = normalizeTextField(req.body?.context);
  const instructions =
    normalizeTextField(req.body?.instructions) || DEFAULT_INSTRUCTIONS;
  const requestedProvider = normalizeTextField(req.body?.aiProvider);
  const requestUserId = normalizeTextField(req.body?.userId);
  const requestUsername = normalizeTextField(req.body?.username);
  let storedProvider = "";

  if (
    !hasExplicitAiProviderSelection(requestedProvider) &&
    (requestUserId || requestUsername)
  ) {
    const user = await UserModel.findOne(
      requestUserId ? { _id: requestUserId } : { "auth.username": requestUsername },
    )
      .select("_id")
      .lean();

    if (user?._id) {
      const aiSettingsDoc = await findAiSettingsLean(user._id, "settings.aiProvider");
      storedProvider = normalizeTextField(aiSettingsDoc?.settings?.aiProvider);
    }
  }

  const explicitProvider = hasExplicitAiProviderSelection(requestedProvider)
    ? requestedProvider
    : hasExplicitAiProviderSelection(storedProvider)
      ? storedProvider
      : "";
  const groqClient = getGroqClient();
  const openAiClient = getOpenAIClient();
  const kimiClient = getKimiClient();
  const preferredProvider = getPreferredAiProvider(
    explicitProvider,
    groqClient,
    openAiClient,
    kimiClient,
  );
  const providerAttemptOrder = buildProviderAttemptOrder(
    preferredProvider,
    groqClient,
    openAiClient,
    kimiClient,
    {
      allowFallback: !hasExplicitAiProviderSelection(explicitProvider),
    },
  );

  if (providerAttemptOrder.length === 0) {
    return res.status(500).json({
      message: hasExplicitAiProviderSelection(explicitProvider)
        ? getMissingProviderConfigurationMessage(preferredProvider)
        : DEFAULT_NO_PROVIDER_MESSAGE,
    });
  }

  if (!message) {
    return res.status(400).json({
      message: "message is required.",
    });
  }

  const prompt = context
    ? `Context:\n${context}\n\nEnquiry:\n${message}`
    : message;

  try {
    const providerErrors = [];
    let provider = "";
    let reply = "";

    for (const candidateProvider of providerAttemptOrder) {
      try {
        reply =
          candidateProvider === "gemini"
            ? await createGeminiResponse({
                instructions,
                input: prompt,
              })
            : await createOpenAiResponse({
                client: getOpenAiCompatibleClient(
                  candidateProvider,
                  groqClient,
                  openAiClient,
                  kimiClient,
                ),
                model: getOpenAiCompatibleModel(candidateProvider),
                provider: candidateProvider,
                instructions,
                input: prompt,
              });
        provider = candidateProvider;
        break;
      } catch (error) {
        providerErrors.push({
          provider: candidateProvider,
          message: error?.message || "Unknown AI provider error.",
        });
      }
    }

    if (!provider) {
      return res.status(502).json({
        message: buildAiProviderFailureMessage(providerErrors),
        provider: preferredProvider,
        attemptedProviders: providerErrors.map(({ provider: name }) => name),
      });
    }

    return res.status(200).json({
      model:
        provider === "gemini"
          ? process.env.GEMINI_MODEL || "gemini-2.5-flash"
          : getOpenAiCompatibleModel(provider),
      provider,
      reply,
    });
  } catch (error) {
    return res.status(502).json({
      message: error?.message || "OpenAI enquiry request failed.",
    });
  }
});

EnquiriesRouter.post("/greeting", async function (req, res) {
  const userId = req.body?.userId?.trim();
  const username = req.body?.username?.trim();
  let summary = null;
  let provider = "fallback";

  if (!userId && !username) {
    return res.status(400).json({
      message: "userId or username is required.",
    });
  }

  try {
    const user = await UserModel.findOne(
      userId ? { _id: userId } : { "auth.username": username },
    )
      .select(
        "auth.username profile.firstname profile.lastname connections memory",
      )
      .lean();

    if (!user) {
      return res.status(404).json({
        message: "User not found.",
      });
    }

    const memoryDoc = await findUserMemoryLean(user._id);
    summary = buildUserSummary(user, memoryDoc);

    const aiSettingsDoc = await findAiSettingsLean(
      user._id,
      "settings.aiProvider",
    );
    const groqClient = getGroqClient();
    const openAiClient = getOpenAIClient();
    const kimiClient = getKimiClient();
    const preferredProvider = getPreferredAiProvider(
      aiSettingsDoc?.settings?.aiProvider,
      groqClient,
      openAiClient,
      kimiClient,
    );

    if (
      preferredProvider === "openai" &&
      !openAiClient &&
      !kimiClient &&
      !groqClient &&
      !getGeminiApiKey()
    ) {
      return res.status(200).json({
        reply: buildFallbackGreeting(summary),
        source: "fallback",
      });
    }

    const greetingInput = `Doctor username: ${summary.username}
First name: ${summary.firstname}
Last name: ${summary.lastname}
Database summary:
- Friends: ${summary.counts.friends}
- Courses: ${summary.counts.courses}
- Lectures: ${summary.counts.lectures}`;
    provider =
      preferredProvider === "groq" && groqClient
        ? "groq"
        : preferredProvider === "kimi" && kimiClient
          ? "kimi"
        : preferredProvider === "gemini" && getGeminiApiKey()
          ? "gemini"
          : openAiClient
            ? "openai"
            : kimiClient
              ? "kimi"
            : groqClient
              ? "groq"
              : getGeminiApiKey()
                ? "gemini"
                : "fallback";
    const reply =
      provider === "gemini"
        ? await createGeminiResponse({
            instructions: DEFAULT_GREETING_INSTRUCTIONS,
            input: greetingInput,
          })
        : provider === "openai" || provider === "groq" || provider === "kimi"
          ? (await createOpenAiResponse({
              client: getOpenAiCompatibleClient(
                provider,
                groqClient,
                openAiClient,
                kimiClient,
              ),
              model: getOpenAiCompatibleModel(provider),
              provider,
              instructions: DEFAULT_GREETING_INSTRUCTIONS,
              input: greetingInput,
            })) || buildFallbackGreeting(summary)
          : buildFallbackGreeting(summary);

    return res.status(200).json({
      reply,
      source: provider,
    });
  } catch (error) {
    return res.status(200).json({
      reply: getGreetingErrorReply(
        error,
        summary || {
          username: username || "Doctor",
          counts: {
            courses: 0,
            lectures: 0,
          },
        },
      ),
      source: "fallback",
    });
  }
});

export default EnquiriesRouter;
