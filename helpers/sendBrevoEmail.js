const trimText = (value) => String(value ?? "").trim();

const DEFAULT_BREVO_API_URL = "https://api.brevo.com/v3/smtp/email";
const DEFAULT_TIMEOUT_MS = 30 * 1000;

const getTimeoutMs = (value, fallback = DEFAULT_TIMEOUT_MS) => {
  const normalized = Number(value);
  return Number.isFinite(normalized) && normalized > 0 ? normalized : fallback;
};

const resolveBrevoApiKey = () =>
  trimText(
    process.env.BREVO_API_KEY ||
      process.env.EMAIL_BREVO_API_KEY ||
      process.env.BREVO_TRANSACTIONAL_API_KEY,
  );

const parseSenderAddress = (value = "") => {
  const rawValue = trimText(value);
  const match = rawValue.match(/^(.*?)(?:<([^>]+)>)$/);
  if (match) {
    const name = trimText(match[1]).replace(/^"|"$/g, "");
    const email = trimText(match[2]);
    return {
      name: name || undefined,
      email,
    };
  }
  return {
    name: undefined,
    email: rawValue,
  };
};

const resolveBrevoConfig = () => {
  const apiKey = resolveBrevoApiKey();
  const fromAddress = trimText(
    process.env.EMAIL_FROM_ADDRESS ||
      process.env.SMTP_FROM ||
      process.env.EMAIL_SMTP_USER ||
      process.env.SMTP_USER,
  );
  const sender = parseSenderAddress(fromAddress);
  if (!apiKey || !sender?.email) {
    return null;
  }
  return {
    apiKey,
    apiUrl: trimText(process.env.BREVO_API_URL) || DEFAULT_BREVO_API_URL,
    timeoutMs: getTimeoutMs(
      process.env.BREVO_API_TIMEOUT_MS || process.env.EMAIL_BREVO_API_TIMEOUT_MS,
      DEFAULT_TIMEOUT_MS,
    ),
    sender,
  };
};

const isRetryableBrevoError = (error) => {
  const message = trimText(error?.message).toLowerCase();
  const code = trimText(error?.code).toUpperCase();
  const status = Number(error?.status);
  return (
    code === "ABORT_ERR" ||
    code === "ETIMEDOUT" ||
    message.includes("timeout") ||
    status === 408 ||
    status === 425 ||
    status === 429 ||
    status >= 500
  );
};

const wait = (ms) =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

const sendBrevoRequest = async ({ apiUrl, apiKey, timeoutMs, payload }) => {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(apiUrl, {
      method: "POST",
      headers: {
        accept: "application/json",
        "api-key": apiKey,
        "content-type": "application/json",
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    const responseBody = await response.json().catch(() => null);
    if (!response.ok) {
      const error = new Error(
        trimText(responseBody?.message) ||
          trimText(responseBody?.code) ||
          `Brevo email request failed (${response.status}).`,
      );
      error.status = response.status;
      error.payload = responseBody;
      throw error;
    }
    return responseBody;
  } catch (error) {
    if (error?.name === "AbortError") {
      const timeoutError = new Error("Brevo API request timeout");
      timeoutError.code = "ABORT_ERR";
      throw timeoutError;
    }
    throw error;
  } finally {
    clearTimeout(timeoutId);
  }
};

export const sendBrevoEmail = async ({
  to = "",
  subject = "",
  text = "",
  replyTo = "",
} = {}) => {
  const config = resolveBrevoConfig();
  if (!config) {
    return { sent: false, skipped: "missing-email-config" };
  }
  const recipient = trimText(to);
  if (!recipient) {
    throw new Error("Recipient email is required.");
  }
  const payload = {
    sender: config.sender.name
      ? { name: config.sender.name, email: config.sender.email }
      : { email: config.sender.email },
    to: [{ email: recipient }],
    subject: trimText(subject),
    textContent: String(text ?? ""),
  };
  const normalizedReplyTo = parseSenderAddress(replyTo);
  if (normalizedReplyTo?.email) {
    payload.replyTo = normalizedReplyTo.name
      ? { name: normalizedReplyTo.name, email: normalizedReplyTo.email }
      : { email: normalizedReplyTo.email };
  }

  try {
    const responseBody = await sendBrevoRequest({
      apiUrl: config.apiUrl,
      apiKey: config.apiKey,
      timeoutMs: config.timeoutMs,
      payload,
    });
    return {
      sent: true,
      provider: "brevo-api",
      messageId: trimText(responseBody?.messageId),
    };
  } catch (error) {
    if (!isRetryableBrevoError(error)) {
      throw error;
    }
    await wait(1500);
    const responseBody = await sendBrevoRequest({
      apiUrl: config.apiUrl,
      apiKey: config.apiKey,
      timeoutMs: config.timeoutMs,
      payload,
    });
    return {
      sent: true,
      provider: "brevo-api",
      messageId: trimText(responseBody?.messageId),
      retried: true,
    };
  }
};

