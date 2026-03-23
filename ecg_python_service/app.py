from flask import Flask, jsonify, request

from service_tools.digitize import build_analysis
from service_tools.pdf_to_image import render_pdf_page

app = Flask(__name__)

LOCAL_METHOD = "deterministic_digitizer"


def build_toolchain_status():
    missing = []
    try:
        import PIL  # noqa: F401
    except Exception:
        missing.append("PIL")

    try:
        import cv2  # noqa: F401
    except Exception:
        missing.append("cv2")

    try:
        import numpy  # noqa: F401
    except Exception:
        missing.append("numpy")

    try:
        import scipy  # noqa: F401
    except Exception:
        missing.append("scipy")

    try:
        import pypdfium2  # noqa: F401
    except Exception:
        missing.append("pypdfium2")

    return {
        "status": "healthy" if not missing else "degraded",
        "python": "ok",
        "missingModules": missing,
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
    toolchain = build_toolchain_status()
    if toolchain["status"] != "healthy":
        return (
            jsonify(
                {
                    "message": f"Local ECG toolchain is unavailable. Missing Python modules: {', '.join(toolchain['missingModules'])}.",
                    "toolchain": toolchain,
                }
            ),
            503,
        )

    payload = request.get_json(silent=True) or {}
    acquisition_note = str(payload.get("acquisitionNote") or "").strip()
    observed_text = str(payload.get("observedText") or "").strip()
    mime_type = str(payload.get("mimeType") or "").strip()
    file_name = str(payload.get("fileName") or "").strip()
    base64_data = str(payload.get("fileData") or "").strip()
    pdf_page = max(1, int(payload.get("pdfPage") or 1))

    if not base64_data and not observed_text:
        return jsonify({"message": "Provide an ECG file or observedText for analysis."}), 400

    source_type = "pdf" if mime_type == "application/pdf" else ("image" if base64_data else "text")

    if source_type == "text":
        return (
            jsonify(
                {
                    "message": "Local ECG digitization currently needs an ECG image upload. Text-only local analysis is not implemented.",
                }
            ),
            501,
        )

    try:
        if source_type == "pdf":
            rasterized = render_pdf_page(
                {
                    "base64Data": base64_data,
                    "pdfPage": pdf_page,
                }
            )
            analysis = build_analysis(
                {
                    "base64Data": rasterized["base64Data"],
                    "acquisitionNote": acquisition_note
                    or f"PDF ECG page {rasterized['selectedPage']} rasterized locally before digitization.",
                    "observedText": observed_text,
                }
            )
            return jsonify(
                {
                    "mode": "non-diagnostic",
                    "sourceType": "pdf",
                    "method": f"{LOCAL_METHOD}_via_pdf_rasterization",
                    "analysis": analysis,
                    "pdfPage": rasterized["selectedPage"],
                    "pdfPageCount": rasterized["pageCount"],
                    "fileName": file_name,
                }
            )

        analysis = build_analysis(
            {
                "base64Data": base64_data,
                "acquisitionNote": acquisition_note,
                "observedText": observed_text,
            }
        )
        return jsonify(
            {
                "mode": "non-diagnostic",
                "sourceType": "image",
                "method": LOCAL_METHOD,
                "analysis": analysis,
                "fileName": file_name,
            }
        )
    except Exception as exc:
        return jsonify({"message": str(exc)}), 500


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=8000)
