import UserModel from "./UserModel.js";

const resolveDefaultAiProvider = () => {
  const appProvider = String(process.env.APP_AI_PROVIDER || "")
    .trim()
    .toLowerCase();

  if (["openai", "groq", "gemini"].includes(appProvider)) {
    return appProvider;
  }

  if (String(process.env.GROQ_API_KEY || "").trim()) {
    return "groq";
  }

  if (String(process.env.GEMINI_API_KEY || "").trim()) {
    return "gemini";
  }

  return "openai";
};

const cloneValue = (value) =>
  typeof structuredClone === "function"
    ? structuredClone(value)
    : JSON.parse(JSON.stringify(value));

const buildQuery = (executor) => ({
  select() {
    return this;
  },
  async lean() {
    const result = await executor();
    return result ? cloneValue(result) : null;
  },
  then(resolve, reject) {
    return executor().then(resolve, reject);
  },
  catch(reject) {
    return executor().catch(reject);
  },
});

const normalizeAiSettings = (user) => ({
  subject: user?._id || null,
  settings: {
    aiProvider: String(user?.settings?.aiProvider || resolveDefaultAiProvider()),
    languageOfReply: String(user?.settings?.languageOfReply || "english"),
    inputType: String(user?.settings?.inputType || "text"),
    outputType: String(user?.settings?.outputType || "text"),
    updatedAt: user?.settings?.updatedAt || null,
  },
});

const AiSettingsModel = {
  findOne(query = {}) {
    return buildQuery(async () => {
      const userId = query?.subject;
      if (!userId) {
        return null;
      }

      const user = await UserModel.findById(userId).select("settings").lean();
      return user ? normalizeAiSettings(user) : null;
    });
  },

  async findOneAndUpdate(query = {}, update = {}, options = {}) {
    const userId = query?.subject;
    if (!userId) {
      return null;
    }

    const setPayload = update?.$set || {};
    const updateSet = {};
    Object.entries(setPayload).forEach(([key, value]) => {
      if (key.startsWith("settings.")) {
        updateSet[key] = value;
      }
    });

    const updateDoc = {};
    if (Object.keys(updateSet).length > 0) {
      updateDoc.$set = updateSet;
    }

    if (options?.upsert && update?.$setOnInsert) {
      const insertSettings = Object.fromEntries(
        Object.entries(update.$setOnInsert)
          .filter(([key]) => key !== "subject")
          .map(([key, value]) => [`settings.${key}`, value]),
      );
      if (Object.keys(insertSettings).length > 0) {
        updateDoc.$setOnInsert = insertSettings;
      }
    }

    const user = await UserModel.findByIdAndUpdate(
      userId,
      updateDoc,
      {
        returnDocument: "after",
      },
    )
      .select("settings")
      .lean();

    if (!user) {
      return null;
    }
    return normalizeAiSettings(user);
  },
};

export default AiSettingsModel;
