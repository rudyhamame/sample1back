import base64
import io
import json
import sys

import cv2
import numpy as np
from PIL import Image
from scipy.signal import find_peaks


def fail(message):
    print(json.dumps({"ok": False, "error": message}))
    sys.exit(1)


def clamp(value, minimum, maximum):
    return max(minimum, min(maximum, value))


def percentile_threshold(gray):
    p20 = float(np.percentile(gray, 20))
    p35 = float(np.percentile(gray, 35))
    return clamp((p20 + p35) / 2.0, 25.0, 180.0)


def detect_grid_visible(rgb):
    red = rgb[:, :, 0].astype(np.int16)
    green = rgb[:, :, 1].astype(np.int16)
    blue = rgb[:, :, 2].astype(np.int16)
    red_dominant = (red > green + 12) & (red > blue + 12) & (red > 130)
    return bool(np.mean(red_dominant) > 0.015)


def build_binary_trace(gray):
    threshold = percentile_threshold(gray)
    binary = (gray < threshold).astype(np.uint8) * 255
    kernel = np.ones((2, 2), np.uint8)
    binary = cv2.morphologyEx(binary, cv2.MORPH_OPEN, kernel)
    return binary


def orientation_score(binary):
    height, width = binary.shape
    if width <= 0 or height <= 0:
        return -1.0

    hits_per_column = np.sum(binary > 0, axis=0)
    coverage = float(np.mean(hits_per_column > 0))
    slimness = float(np.mean(np.clip(hits_per_column / max(height, 1), 0.0, 1.0)))
    horizontal_bonus = 1.2 if width >= height else 0.0
    return coverage - (slimness * 0.65) + horizontal_bonus


def choose_best_orientation(rgb):
    candidates = [
        ("0", rgb),
        ("90_cw", cv2.rotate(rgb, cv2.ROTATE_90_CLOCKWISE)),
        ("180", cv2.rotate(rgb, cv2.ROTATE_180)),
        ("90_ccw", cv2.rotate(rgb, cv2.ROTATE_90_COUNTERCLOCKWISE)),
    ]

    best = None
    for label, candidate in candidates:
        gray = cv2.cvtColor(candidate, cv2.COLOR_RGB2GRAY)
        binary = build_binary_trace(gray)
        score = orientation_score(binary)
        if best is None or score > best["score"]:
            best = {
                "label": label,
                "rgb": candidate,
                "gray": gray,
                "binary": binary,
                "score": score,
            }

    return best


def extract_trace(binary):
    height, width = binary.shape
    raw_trace = np.full(width, np.nan, dtype=np.float32)

    for x in range(width):
      ys = np.where(binary[:, x] > 0)[0]
      if ys.size:
          raw_trace[x] = float(np.median(ys))

    valid = np.where(~np.isnan(raw_trace))[0]
    if valid.size < max(40, width * 0.2):
        raise ValueError("The uploaded ECG image does not contain a readable dark trace.")

    trace = raw_trace.copy()
    missing = np.where(np.isnan(trace))[0]
    if missing.size:
        trace[missing] = np.interp(missing, valid, trace[valid])

    trace = cv2.GaussianBlur(trace.reshape(1, -1), (1, 0), sigmaX=2.0).reshape(-1)
    normalized = 1.0 - (trace / max(height - 1, 1))
    return trace, normalized


def summarize_segments(normalized_trace, count=8):
    segments = []
    segment_size = max(1, len(normalized_trace) // count)

    for idx in range(count):
        start = idx * segment_size
        end = len(normalized_trace) if idx == count - 1 else (idx + 1) * segment_size
        chunk = normalized_trace[start:end]
        if chunk.size == 0:
            continue
        slope = float(chunk[-1] - chunk[0])
        x_start = round((start / max(len(normalized_trace) - 1, 1)) * 100, 1)
        x_end = round(((end - 1) / max(len(normalized_trace) - 1, 1)) * 100, 1)
        if slope > 0.035:
            trend = "increase"
        elif slope < -0.035:
            trend = "decrease"
        else:
            trend = "stable"
        segments.append(
            {
                "trend": trend,
                "start": x_start,
                "end": x_end,
                "delta": round(slope, 3),
            }
        )

    return segments


def detect_key_points(normalized_trace, max_points=6):
    prominence = max(0.02, float(np.std(normalized_trace) * 0.65))
    peaks, _ = find_peaks(normalized_trace, prominence=prominence, distance=max(8, len(normalized_trace) // 18))
    troughs, _ = find_peaks(-normalized_trace, prominence=prominence, distance=max(8, len(normalized_trace) // 18))

    entries = []
    for idx in peaks:
        entries.append(("peak", idx, float(normalized_trace[idx])))
    for idx in troughs:
        entries.append(("trough", idx, float(normalized_trace[idx])))

    entries.sort(key=lambda item: abs(item[2] - float(np.median(normalized_trace))), reverse=True)
    entries = entries[:max_points]
    entries.sort(key=lambda item: item[1])
    return entries


def build_analysis(payload):
    base64_data = str(payload.get("base64Data") or "").strip()
    if not base64_data:
        raise ValueError("No ECG image data was provided to the local digitizer.")

    acquisition_note = str(payload.get("acquisitionNote") or "").strip()
    observed_text = str(payload.get("observedText") or "").strip()

    image_bytes = base64.b64decode(base64_data, validate=False)
    image = Image.open(io.BytesIO(image_bytes)).convert("RGB")
    rgb = np.array(image)

    max_width = 1800
    if rgb.shape[1] > max_width:
        scale = max_width / float(rgb.shape[1])
        rgb = cv2.resize(rgb, (max_width, int(rgb.shape[0] * scale)), interpolation=cv2.INTER_AREA)

    oriented = choose_best_orientation(rgb)
    rgb = oriented["rgb"]
    gray = oriented["gray"]
    binary = oriented["binary"]
    trace_pixels, normalized_trace = extract_trace(binary)

    filled_fraction = float(np.mean(~np.isnan(trace_pixels)))
    amplitude_range = float(np.max(normalized_trace) - np.min(normalized_trace))
    std_value = float(np.std(normalized_trace))
    grid_visible = detect_grid_visible(rgb)

    limitations = []
    if filled_fraction < 0.8:
        limitations.append("Part of the trace required interpolation because the line was faint or interrupted.")
    if amplitude_range < 0.08:
        limitations.append("The visible waveform amplitude range is small, so fine variation may be understated.")
    if gray.shape[0] < 180 or gray.shape[1] < 450:
        limitations.append("The ECG image resolution is limited for detailed interval extraction.")
    if not grid_visible:
        limitations.append("The background grid is not clearly visible.")
    if observed_text:
        limitations.append("Typed ECG notes were preserved alongside the digitized image trace.")
    if oriented["label"] != "0":
        limitations.append(f"The ECG image was auto-rotated ({oriented['label']}) before digitization.")

    if filled_fraction > 0.92 and amplitude_range > 0.16:
        readability = "good"
    elif filled_fraction > 0.72 and amplitude_range > 0.1:
        readability = "fair"
    elif filled_fraction > 0.45:
        readability = "limited"
    else:
        readability = "unreadable"

    segments = summarize_segments(normalized_trace)
    key_points = detect_key_points(normalized_trace)

    increases = []
    decreases = []
    stable = []
    for segment in segments:
        label = f"{segment['start']}%-{segment['end']}% of the trace"
        if segment["trend"] == "increase":
            increases.append(f"{label}: upward shift ({segment['delta']:+.3f} normalized units)")
        elif segment["trend"] == "decrease":
            decreases.append(f"{label}: downward shift ({segment['delta']:+.3f} normalized units)")
        else:
            stable.append(f"{label}: relatively stable ({segment['delta']:+.3f} normalized units)")

    waveform_points = []
    for index, (kind, position, amplitude) in enumerate(key_points):
        waveform_points.append(
            {
                "structure": f"Digitized {kind} {index + 1}",
                "observedState": f"{kind} at {round((position / max(len(normalized_trace) - 1, 1)) * 100, 1)}% of horizontal span",
                "leads": [],
                "evidence": f"Normalized amplitude {amplitude:.3f}",
            }
        )

    peak_positions = [position for kind, position, _ in key_points if kind == "peak"]
    rr_cv = None
    if len(peak_positions) >= 3:
        intervals = np.diff(np.array(peak_positions, dtype=np.float32))
        mean_interval = float(np.mean(intervals))
        if mean_interval > 0:
            rr_cv = float(np.std(intervals) / mean_interval)

    rhythm_features = [
        {
            "feature": "Digitized trace continuity",
            "observedState": f"{round(filled_fraction * 100, 1)}% of columns contained a readable trace point",
            "evidence": "Computed from per-column trace detection coverage.",
        },
        {
            "feature": "Visible amplitude spread",
            "observedState": f"{amplitude_range:.3f} normalized vertical units",
            "evidence": "Computed from the detected trace envelope.",
        },
    ]
    if rr_cv is not None:
        rhythm_features.append(
            {
                "feature": "Peak-spacing regularity",
                "observedState": "more regular" if rr_cv < 0.18 else "variable",
                "evidence": f"Coefficient of variation across dominant peak spacing: {rr_cv:.3f}",
            }
        )

    measurements = [
        {
            "label": "Digitized graph points",
            "value": int(len(normalized_trace)),
            "unit": "samples",
            "lead": "",
            "qualifier": "horizontal trace coverage",
            "evidence": "One representative vertical position was estimated for each image column.",
        },
        {
            "label": "Visible amplitude range",
            "value": round(amplitude_range, 3),
            "unit": "normalized units",
            "lead": "",
            "qualifier": "0 to 1 vertical normalization",
            "evidence": "Calculated from the digitized trace maximum and minimum.",
        },
        {
            "label": "Trace continuity",
            "value": round(filled_fraction * 100, 1),
            "unit": "%",
            "lead": "",
            "qualifier": "detected columns before interpolation",
            "evidence": "Measured from direct per-column line detection.",
        },
        {
            "label": "Trace variability",
            "value": round(std_value, 3),
            "unit": "normalized units",
            "lead": "",
            "qualifier": "overall graph spread",
            "evidence": "Standard deviation of the digitized trace after smoothing.",
        },
    ]

    lead_findings = []
    if increases:
        lead_findings.append(
            {
                "lead": "visible trace",
                "phenomenon": "upward excursions",
                "direction": "increase",
                "magnitude": f"{len(increases)} segments",
                "evidence": increases[0],
            }
        )
    if decreases:
        lead_findings.append(
            {
                "lead": "visible trace",
                "phenomenon": "downward excursions",
                "direction": "decrease",
                "magnitude": f"{len(decreases)} segments",
                "evidence": decreases[0],
            }
        )

    summary = (
        f"Local digitization extracted a readable ECG trace across {round(filled_fraction * 100, 1)}% "
        f"of the horizontal span with {len(normalized_trace)} digitized graph points. "
        f"The visible waveform shows {len(increases)} upward segments, {len(decreases)} downward segments, "
        f"and an overall amplitude range of {amplitude_range:.3f} normalized units."
    )

    analysis = {
        "sourceType": "image",
        "summary": summary,
        "acquisitionNote": acquisition_note or "Image-based deterministic ECG digitization.",
        "qualityAssessment": {
            "readability": readability,
            "gridVisible": grid_visible,
            "calibrationVisible": None,
            "limitations": limitations,
        },
        "measurements": measurements,
        "waveformPoints": waveform_points,
        "leadFindings": lead_findings,
        "rhythmFeatures": rhythm_features,
        "trends": {
            "increases": increases,
            "decreases": decreases,
            "stableOrNeutral": stable,
        },
        "extractedText": [observed_text] if observed_text else [],
        "nonDiagnosticNotice": (
            "Observable ECG findings only. This local digitizer extracts graph behavior and does not provide a diagnosis."
        ),
    }

    return analysis


def main():
    try:
        payload = json.load(sys.stdin)
        analysis = build_analysis(payload)
        print(json.dumps({"ok": True, "analysis": analysis}))
    except Exception as exc:
        fail(str(exc))


if __name__ == "__main__":
    main()
