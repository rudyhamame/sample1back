import json
import sys
from pathlib import Path


def fail(message):
    print(json.dumps({"ok": False, "error": message}))
    sys.exit(1)


def main():
    try:
        payload = json.load(sys.stdin)
    except Exception:
        fail("Unable to parse the digital ECG trace payload.")
        return

    repo_root = Path(__file__).resolve().parents[1]
    if str(repo_root) not in sys.path:
        sys.path.insert(0, str(repo_root))

    try:
        from phenomedbepy.phenomedbepy.services.digital_trace_analysis import build_analysis
    except Exception as exc:
        fail(f"Unable to load the digital ECG trace analyzer: {exc}")
        return

    try:
        analysis = build_analysis(payload)
    except Exception as exc:
        fail(str(exc))
        return

    print(json.dumps({"ok": True, "analysis": analysis}))


if __name__ == "__main__":
    main()
