import { readFileSync } from "fs";

const promptTemplate = readFileSync(
  new URL("./prompt.txt", import.meta.url),
  "utf8",
);

export const buildTelegramExtractProgramInstructorNamesPrompt = (messages = []) => {
  const normalizedMessages = (Array.isArray(messages) ? messages : [])
    .map((message) => String(message || "").trim())
    .filter(Boolean);

  const messagesBlock = normalizedMessages
    .map((message, index) => `${index + 1}. ${message}`)
    .join("\n");

  return promptTemplate.replace("{{MESSAGES_BLOCK}}", messagesBlock);
};
