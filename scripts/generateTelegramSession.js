import readline from "readline";
import "dotenv/config";
import { TelegramClient } from "telegram";
import { StringSession } from "telegram/sessions/index.js";

const ask = (rl, question) =>
  new Promise((resolve) => {
    rl.question(question, (answer) => resolve(String(answer || "").trim()));
  });

const main = async () => {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  try {
    const envApiId = String(process.env.TELEGRAM_API_ID || "").trim();
    const envApiHash = String(process.env.TELEGRAM_API_HASH || "").trim();

    const apiIdInput =
      envApiId || (await ask(rl, "Telegram API ID: "));
    const apiHashInput =
      envApiHash || (await ask(rl, "Telegram API Hash: "));

    const apiId = Number(apiIdInput);
    const apiHash = String(apiHashInput || "").trim();

    if (!apiId || !apiHash) {
      throw new Error("Telegram API ID and API Hash are required.");
    }

    const client = new TelegramClient(
      new StringSession(""),
      apiId,
      apiHash,
      {
        connectionRetries: 5,
      },
    );

    await client.start({
      phoneNumber: async () => ask(rl, "Phone number (with country code): "),
      password: async () =>
        ask(rl, "Two-step verification password (leave empty if none): "),
      phoneCode: async () => ask(rl, "Telegram login code: "),
      onError: (error) => {
        console.error("Telegram login error:", error?.message || error);
      },
    });

    const stringSession = client.session.save();

    console.log("\nTELEGRAM_STRING_SESSION=");
    console.log(stringSession);
    console.log(
      "\nAdd this value to your backend .env as TELEGRAM_STRING_SESSION",
    );

    await client.disconnect();
    rl.close();
  } catch (error) {
    rl.close();
    console.error(error?.message || error);
    process.exit(1);
  }
};

main();
