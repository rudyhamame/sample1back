import { execFileSync } from "child_process";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const FRONTEND_REPO_PATH = path.resolve(__dirname, "../../../sample1front");

const getFrontendLastUpdated = () => {
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
    return null;
  }
};

export { getFrontendLastUpdated };

