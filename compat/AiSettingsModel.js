import UserModel from "./UserModel.js";

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
    aiProvider: String(user?.settings?.aiProvider || "openai"),
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

      const user = await UserModel.findById(userId);
      return user ? normalizeAiSettings(user) : null;
    });
  },

  async findOneAndUpdate(query = {}, update = {}, options = {}) {
    const userId = query?.subject;
    if (!userId) {
      return null;
    }

    const user = await UserModel.findById(userId);
    if (!user) {
      return null;
    }

    user.settings = user.settings || {};

    const setPayload = update?.$set || {};
    Object.entries(setPayload).forEach(([key, value]) => {
      if (key.startsWith("settings.")) {
        const nestedKey = key.slice("settings.".length);
        user.settings[nestedKey] = value;
      }
    });

    if (options?.upsert && update?.$setOnInsert) {
      const insertSettings = Object.fromEntries(
        Object.entries(update.$setOnInsert).filter(([key]) => key !== "subject"),
      );
      user.settings = {
        ...insertSettings,
        ...user.settings,
      };
    }

    await user.save();
    return normalizeAiSettings(user);
  },
};

export default AiSettingsModel;
