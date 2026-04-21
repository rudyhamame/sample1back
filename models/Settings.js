import mongoose from "mongoose";

const { Schema } = mongoose;

const SettingsSchema = new Schema(
  {
    ai: {
      aiProvider: { type: String, default: "openai" },
      languageOfReply: { type: String, default: "english" },
      inputType: { type: String, default: "text" },
      outputType: { type: String, default: "text" },
      updatedAt: { type: Date, default: null },
    },
    ui: {
      startMenuLayout: {
        main: { type: [String], default: [] },
        settings: { type: [String], default: [] },
        updatedAt: { type: Date, default: null },
      },
      // App UI language for the subject interface, not the AI reply language.
      language: { type: String, default: "en" },
      theme: { type: String, default: "light" },
      updatedAt: { type: Date, default: null },
    },
    telegram: {
      status: {
        pageUrl: { type: String, default: "" },
        groupReference: { type: String, default: "" },
        syncMode: { type: String, default: "live" },
        historyStartDate: { type: Date, default: null },
        historyEndDate: { type: Date, default: null },
        syncEnabled: { type: Boolean, default: false },
        historyImportedAt: { type: Date, default: null },
        lastSyncedAt: { type: Date, default: null },
        lastStoredMessageId: { type: Number, default: 0 },
        lastStoredMessageDate: { type: Date, default: null },
        lastSyncStatus: { type: String, default: "" },
        lastSyncReason: { type: String, default: "" },
        lastSyncMessage: { type: String, default: "" },
        lastSyncImportedCount: { type: Number, default: 0 },
        lastSyncError: { type: String, default: "" },
        lastSyncScannedCount: { type: Number, default: 0 },
        lastSyncNewestMessageDateSeen: { type: Date, default: null },
        lastSyncOldestMessageDateSeen: { type: Date, default: null },
        lastSyncOldestImportedMessageDate: { type: Date, default: null },
        lastSyncFirstSkippedBeforeStartDate: { type: Date, default: null },
        lastSyncReachedStartBoundary: { type: Boolean, default: false },
        apiIdEncrypted: { type: String, default: "" },
        apiHashEncrypted: { type: String, default: "" },
        stringSessionEncrypted: { type: String, default: "" },
        updatedAt: { type: Date, default: null },
      },
    },
  },
  { _id: false },
);

export default SettingsSchema;
