import json

import numpy as np
from scipy.signal import find_peaks

LEAD_NAMES = ["I", "II", "III", "aVR", "aVL", "aVF", "V1", "V2", "V3", "V4", "V5", "V6"]
_PREFERRED_DISPLAY_LEADS = ["II", "V5", "V2", "I", "V1"]
_LEAD_ALIASES = {
    "I": "I",
    "1": "I",
    "II": "II",
    "2": "II",
    "III": "III",
    "3": "III",
    "AVR": "aVR",
    "A VR": "aVR",
    "AVL": "aVL",
    "A VL": "aVL",
    "AVF": "aVF",
    "A VF": "aVF",
    "V1": "V1",
    "V2": "V2",
    "V3": "V3",
    "V4": "V4",
    "V5": "V5",
    "V6": "V6",
}


def _canonical_lead_name(value):
    raw = str(value or "").strip().upper().replace("-", "").replace("_", "").replace(" ", "")
    return _LEAD_ALIASES.get(raw, "")


def _coerce_json(value):
    if isinstance(value, str):
        text = value.strip()
        if not text:
            return None
        try:
            return json.loads(text)
        except Exception:
            return None
    return value


def _coerce_samples(value):
    data = _coerce_json(value)
    if isinstance(data, dict):
        for key in ("samples", "values", "trace", "points", "signal"):
            if key in data:
                data = data.get(key)
                break
    if not isinstance(data, (list, tuple)):
        return np.array([], dtype=np.float32)

    samples = []
    for entry in data:
        if isinstance(entry, dict):
            entry = entry.get("value", entry.get("y", entry.get("amplitude")))
        try:
            number = float(entry)
        except (TypeError, ValueError):
            number = np.nan
        samples.append(number)

    array = np.asarray(samples, dtype=np.float32)
    finite = np.isfinite(array)
    if not np.any(finite):
        return np.array([], dtype=np.float32)
    if not np.all(finite):
        valid = np.where(finite)[0]
        if valid.size == 1:
            array[~finite] = float(array[valid[0]])
        else:
            missing = np.where(~finite)[0]
            array[missing] = np.interp(missing, valid, array[valid])
    return array


def _extract_lead_arrays(payload):
    trace_map = {}

    mapping_sources = [
        _coerce_json(payload.get("digitalTraces")),
        _coerce_json(payload.get("leadTraces")),
        _coerce_json(payload.get("deviceTraces")),
    ]
    for source in mapping_sources:
        if not isinstance(source, dict):
            continue
        for lead_name, samples in source.items():
            canonical = _canonical_lead_name(lead_name)
            if not canonical:
                continue
            array = _coerce_samples(samples)
            if array.size < 3:
                continue
            previous = trace_map.get(canonical)
            if previous is None or array.size > previous.size:
                trace_map[canonical] = array

    array_sources = [
        _coerce_json(payload.get("traces")),
        _coerce_json(payload.get("leadSignals")),
        _coerce_json(payload.get("leads")),
    ]
    for source in array_sources:
        if not isinstance(source, list):
            continue
        for item in source:
            if not isinstance(item, dict):
                continue
            canonical = _canonical_lead_name(item.get("lead") or item.get("name") or item.get("label"))
            if not canonical:
                continue
            array = _coerce_samples(item)
            if array.size < 3:
                continue
            previous = trace_map.get(canonical)
            if previous is None or array.size > previous.size:
                trace_map[canonical] = array

    return trace_map


def _normalize_trace(trace):
    finite = trace[np.isfinite(trace)]
    if finite.size == 0:
        return np.array([], dtype=np.float32)
    minimum = float(np.min(finite))
    maximum = float(np.max(finite))
    spread = maximum - minimum
    if spread < 1e-6:
        return np.full(trace.shape, 0.5, dtype=np.float32)
    return ((trace - minimum) / spread).astype(np.float32)


def _downsample_trace(trace, max_points=1400):
    if trace.size == 0:
        return []
    if trace.size <= max_points:
        return [round(float(value), 4) for value in trace]
    indices = np.linspace(0, trace.size - 1, max_points).astype(np.int32)
    return [round(float(trace[index]), 4) for index in indices]


def _summarize_segments(trace, count=8):
    segments = []
    segment_size = max(1, len(trace) // count)
    for idx in range(count):
        start = idx * segment_size
        end = len(trace) if idx == count - 1 else (idx + 1) * segment_size
        chunk = trace[start:end]
        if chunk.size == 0:
            continue
        slope = float(chunk[-1] - chunk[0])
        x_start = round((start / max(len(trace) - 1, 1)) * 100, 1)
        x_end = round(((end - 1) / max(len(trace) - 1, 1)) * 100, 1)
        if slope > 0.035:
            trend = "increase"
        elif slope < -0.035:
            trend = "decrease"
        else:
            trend = "stable"
        segments.append({"trend": trend, "start": x_start, "end": x_end, "delta": round(slope, 3)})
    return segments


def _detect_key_points(trace, max_points=8):
    if trace.size < 3:
        return []
    prominence = max(0.03, float(np.std(trace) * 0.6))
    peaks, _ = find_peaks(trace, prominence=prominence, distance=max(20, len(trace) // 15))
    troughs, _ = find_peaks(-trace, prominence=prominence, distance=max(20, len(trace) // 15))
    entries = [("peak", idx, float(trace[idx])) for idx in peaks]
    entries.extend(("trough", idx, float(trace[idx])) for idx in troughs)
    entries.sort(key=lambda item: abs(item[2] - float(np.median(trace))), reverse=True)
    entries = entries[:max_points]
    entries.sort(key=lambda item: item[1])
    return entries


def _pick_display_lead(traces):
    scores = {}
    for lead_name, trace in traces.items():
        finite = trace[np.isfinite(trace)]
        if finite.size == 0:
            continue
        amplitude = float(np.max(finite) - np.min(finite))
        scores[lead_name] = amplitude * 0.7 + float(trace.size) * 0.3

    if not scores:
        return "", np.array([], dtype=np.float32)

    for lead_name in _PREFERRED_DISPLAY_LEADS:
        if lead_name in scores:
            return lead_name, traces[lead_name]

    best_lead = max(scores, key=scores.get)
    return best_lead, traces[best_lead]


def _build_measurements(lead_arrays, sample_rate_hz, trace_unit):
    sample_counts = [int(trace.size) for trace in lead_arrays.values()]
    measurements = [
        {
            "label": "Detected digital leads",
            "value": int(len(lead_arrays)),
            "unit": "leads",
            "lead": "",
            "qualifier": "device-provided waveform channels",
            "evidence": "Counted from the submitted digital lead trace payload.",
        },
        {
            "label": "Samples per lead",
            "value": int(round(float(np.median(sample_counts)))) if sample_counts else 0,
            "unit": "samples",
            "lead": "",
            "qualifier": "median trace length",
            "evidence": "Computed from the submitted digital lead arrays.",
        },
    ]
    if sample_rate_hz > 0:
        measurements.append(
            {
                "label": "Sampling rate",
                "value": round(sample_rate_hz, 3),
                "unit": "Hz",
                "lead": "",
                "qualifier": "device metadata",
                "evidence": "Reported in the digital trace payload.",
            }
        )
    if trace_unit:
        measurements.append(
            {
                "label": "Signal unit",
                "value": trace_unit,
                "unit": "",
                "lead": "",
                "qualifier": "device metadata",
                "evidence": "Reported in the digital trace payload.",
            }
        )
    return measurements


def build_analysis(payload):
    acquisition_note = str(payload.get("acquisitionNote") or "").strip()
    observed_text = str(payload.get("observedText") or "").strip()
    trace_unit = str(payload.get("traceUnit") or payload.get("signalUnit") or payload.get("unit") or "").strip()
    try:
        sample_rate_hz = float(payload.get("sampleRateHz") or payload.get("samplingRateHz") or 0.0)
    except (TypeError, ValueError):
        sample_rate_hz = 0.0

    lead_arrays = _extract_lead_arrays(payload)
    if not lead_arrays:
        raise ValueError("Provide digital ECG traces from the device in digitalTraces, leadTraces, traces, or leads.")

    display_lead, display_trace = _pick_display_lead(lead_arrays)
    normalized_display = _normalize_trace(display_trace)
    lead_traces = {lead_name: _downsample_trace(_normalize_trace(trace)) for lead_name, trace in lead_arrays.items()}
    detected_leads = [lead_name for lead_name in LEAD_NAMES if lead_name in lead_traces]

    continuity = []
    amplitude_spreads = []
    for trace in lead_arrays.values():
        finite = np.isfinite(trace)
        continuity.append(float(np.mean(finite)) * 100.0)
        amplitude_spreads.append(float(np.nanmax(trace) - np.nanmin(trace)))

    limitations = []
    if len(lead_traces) < 12:
        limitations.append("Fewer than 12 leads were provided by the device payload.")
    if sample_rate_hz <= 0:
        limitations.append("Sampling rate metadata was not provided with the digital traces.")
    if observed_text:
        limitations.append("Typed ECG notes were preserved alongside the digital trace payload.")

    sample_counts = [len(samples) for samples in lead_traces.values()]
    if len(lead_traces) >= 8 and min(sample_counts) >= 1000:
        readability = "good"
    elif len(lead_traces) >= 4 and min(sample_counts) >= 300:
        readability = "fair"
    elif lead_traces:
        readability = "limited"
    else:
        readability = "unreadable"

    segments = _summarize_segments(normalized_display)
    increases = []
    decreases = []
    stable = []
    for segment in segments:
        label = f"{segment['start']}%-{segment['end']}% of lead {display_lead or 'display'}"
        if segment["trend"] == "increase":
            increases.append(f"{label}: upward shift ({segment['delta']:+.3f} normalized units)")
        elif segment["trend"] == "decrease":
            decreases.append(f"{label}: downward shift ({segment['delta']:+.3f} normalized units)")
        else:
            stable.append(f"{label}: relatively stable ({segment['delta']:+.3f} normalized units)")

    waveform_points = []
    key_points = _detect_key_points(normalized_display)
    for index, (kind, position, amplitude) in enumerate(key_points):
        waveform_points.append(
            {
                "structure": f"{display_lead or 'Display'} {kind} {index + 1}",
                "observedState": f"{kind} at {round((position / max(len(normalized_display) - 1, 1)) * 100, 1)}% of horizontal span",
                "leads": [display_lead] if display_lead else [],
                "evidence": f"Normalized amplitude {amplitude:.3f}",
            }
        )

    rr_cv = None
    peak_positions = [position for kind, position, _ in key_points if kind == "peak"]
    if len(peak_positions) >= 3:
        intervals = np.diff(np.array(peak_positions, dtype=np.float32))
        mean_interval = float(np.mean(intervals))
        if mean_interval > 0:
            rr_cv = float(np.std(intervals) / mean_interval)

    rhythm_features = [
        {
            "feature": "Lead coverage",
            "observedState": f"{len(lead_traces)} digital leads received",
            "evidence": "Computed from the submitted device trace payload.",
        },
        {
            "feature": "Trace continuity",
            "observedState": f"{round(float(np.mean(continuity)), 1)}% finite samples across submitted leads",
            "evidence": "Computed from the submitted lead arrays after numeric normalization.",
        },
        {
            "feature": "Amplitude spread",
            "observedState": f"{round(float(np.median(amplitude_spreads)), 4)} {trace_unit or 'raw units'} median spread across leads",
            "evidence": "Measured as max-min for each submitted lead trace.",
        },
    ]
    if rr_cv is not None:
        rhythm_features.append(
            {
                "feature": "Peak-spacing regularity",
                "observedState": "more regular" if rr_cv < 0.18 else "variable",
                "evidence": f"Coefficient of variation across dominant peak spacing in lead {display_lead}: {rr_cv:.3f}",
            }
        )

    lead_findings = []
    if display_lead and increases:
        lead_findings.append(
            {
                "lead": display_lead,
                "phenomenon": "upward excursions",
                "direction": "increase",
                "magnitude": f"{len(increases)} segments",
                "evidence": increases[0],
            }
        )
    if display_lead and decreases:
        lead_findings.append(
            {
                "lead": display_lead,
                "phenomenon": "downward excursions",
                "direction": "decrease",
                "magnitude": f"{len(decreases)} segments",
                "evidence": decreases[0],
            }
        )

    summary = (
        f"Received {len(lead_traces)} device-provided digital ECG lead traces"
        f"{f' at {sample_rate_hz:g} Hz' if sample_rate_hz > 0 else ''}. "
        f"Display lead {display_lead or 'N/A'} contains {len(display_trace)} samples, "
        f"with {len(increases)} upward segments and {len(decreases)} downward segments after normalization."
    )

    return {
        "sourceType": "device",
        "summary": summary,
        "acquisitionNote": acquisition_note or "Device-provided digital ECG traces.",
        "qualityAssessment": {
            "readability": readability,
            "gridVisible": None,
            "calibrationVisible": None,
            "limitations": limitations,
        },
        "measurements": _build_measurements(lead_arrays, sample_rate_hz, trace_unit),
        "waveformPoints": waveform_points,
        "traceSamples": _downsample_trace(normalized_display),
        "leadTraces": lead_traces,
        "leadFindings": lead_findings,
        "rhythmFeatures": rhythm_features,
        "trends": {
            "increases": increases,
            "decreases": decreases,
            "stableOrNeutral": stable,
        },
        "extractedText": [observed_text] if observed_text else [],
        "displayLead": display_lead,
        "detectedLeads": detected_leads,
        "nonDiagnosticNotice": (
            "Observable ECG findings only. This digital-trace pathway summarizes device-provided waveforms and does not provide a diagnosis."
        ),
        "rotationApplied": "0",
    }
