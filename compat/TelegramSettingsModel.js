import UserModel from "./UserModel.js";

const cloneValue = (value) =>
  typeof structuredClone === "function"
    ? structuredClone(value)
    : JSON.parse(JSON.stringify(value));

const normalizeTelegramSettings = (user, seed = {}) => ({
  user: user?._id || seed?.user || null,
  groups: Array.isArray(seed?.groups) ? seed.groups : [],
  status:
    user?.settings?.telegram?.status &&
    typeof user.settings.telegram.status === "object"
      ? user.settings.telegram.status
      : seed?.status && typeof seed.status === "object"
        ? seed.status
        : {},
});

class TelegramSettingsDocument {
  constructor(payload = {}) {
    this.user = payload.user || null;
    this.groups = Array.isArray(payload.groups) ? payload.groups : [];
    this.status = payload.status && typeof payload.status === "object" ? payload.status : {};
  }

  toObject() {
    return cloneValue({
      user: this.user,
      groups: this.groups,
      status: this.status,
    });
  }

  async save() {
    if (!this.user) {
      return this;
    }

    const user = await UserModel.findById(this.user);
    if (!user) {
      return this;
    }

    user.settings = user.settings || {};
    user.settings.telegram = user.settings.telegram || {};
    user.settings.telegram.status =
      this.status && typeof this.status === "object" ? this.status : {};
    await user.save();
    return this;
  }
}

const buildQuery = (executor) => ({
  select() {
    return this;
  },
  async lean() {
    const result = await executor();
    return result?.toObject?.() || null;
  },
  then(resolve, reject) {
    return executor().then(resolve, reject);
  },
  catch(reject) {
    return executor().catch(reject);
  },
});

const TelegramSettingsModel = class extends TelegramSettingsDocument {
  static findOne(query = {}) {
    return buildQuery(async () => {
      const userId = query?.user;
      if (!userId) {
        return null;
      }

      const user = await UserModel.findById(userId);
      return user
        ? new TelegramSettingsDocument(normalizeTelegramSettings(user))
        : null;
    });
  }
};

export default TelegramSettingsModel;
