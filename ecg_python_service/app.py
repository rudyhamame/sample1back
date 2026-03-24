from flask import Flask, jsonify, request

try:
    from service_tools.digital_trace_analysis import build_analysis as build_digital_trace_analysis
except ModuleNotFoundError:
    from .service_tools.digital_trace_analysis import build_analysis as build_digital_trace_analysis

app = Flask(__name__)

LOCAL_METHOD = "digital_trace_ingest"
DIGITAL_TRACE_METHOD = "digital_trace_ingest"


def build_toolchain_status():
    return {
        "status": "healthy",
        "python": "ok",
        "missingModules": [],
    }


@app.get("/health")
def health():
    toolchain = build_toolchain_status()
    return (
        jsonify(
            {
                "status": toolchain["status"],
                "mode": "local-only",
                "method": LOCAL_METHOD,
                "toolchain": toolchain,
            }
        ),
        200 if toolchain["status"] == "healthy" else 503,
    )


@app.post("/analyze")
def analyze():
    payload = request.get_json(silent=True) or {}
    file_name = str(payload.get("fileName") or "").strip()
    has_digital_traces = any(
        payload.get(key) not in (None, "", [], {})
        for key in ("digitalTraces", "leadTraces", "deviceTraces", "traces", "leadSignals", "leads")
    )

    if has_digital_traces:
        try:
            analysis = build_digital_trace_analysis(payload)
            return jsonify(
                {
                    "mode": "non-diagnostic",
                    "sourceType": "device",
                    "method": DIGITAL_TRACE_METHOD,
                    "analysis": analysis,
                    "fileName": file_name,
                }
            )
        except Exception as exc:
            return jsonify({"message": str(exc)}), 400

    return jsonify({"message": "Image, PDF, and text-only ECG submissions are no longer supported. Send device digital traces instead."}), 415


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=8000)
