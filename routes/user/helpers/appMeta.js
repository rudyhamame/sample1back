import { execFileSync } from "child_process";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const FRONTEND_REPO_PATH = path.resolve(__dirname, "../../../sample1front");
const FALLBACK_FRONTEND_LAST_UPDATED = "2026-06-06T16:54:59-04:00";

const getFrontendLastUpdated = () => {
  const envCommittedAt = String(
    process.env.FRONTEND_LAST_UPDATED || "",
  ).trim();

  if (envCommittedAt) {
    return envCommittedAt;
  }

  try {
    const committedAt = execFileSync(
      "git",
      ["-C", FRONTEND_REPO_PATH, "log", "-1", "--format=%cI"],
      {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
      },
    ).trim();

    if (!committedAt) {
      return null;
    }

    return committedAt;
  } catch {
    return FALLBACK_FRONTEND_LAST_UPDATED;
  }
};

export { getFrontendLastUpdated };
