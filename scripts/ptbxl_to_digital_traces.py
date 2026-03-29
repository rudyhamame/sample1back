import argparse
import csv
import json
from pathlib import Path

import wfdb

EXPECTED_LEADS = ["I", "II", "III", "aVR", "aVL", "aVF", "V1", "V2", "V3", "V4", "V5", "V6"]
LEAD_ALIASES = {
    "I": "I",
    "II": "II",
    "III": "III",
    "AVR": "aVR",
    "AVL": "aVL",
    "AVF": "aVF",
    "V1": "V1",
    "V2": "V2",
    "V3": "V3",
    "V4": "V4",
    "V5": "V5",
    "V6": "V6",
}


def _parse_args():
    parser = argparse.ArgumentParser(
        description="Convert a PTB-XL ECG record into the PhenoMed digitalTraces JSON format.",
    )
    parser.add_argument(
        "--dataset-dir",
        type=Path,
        help="Path to the PTB-XL dataset root that contains ptbxl_database.csv.",
    )
    parser.add_argument(
        "--ecg-id",
        type=int,
        help="PTB-XL ecg_id to convert using ptbxl_database.csv.",
    )
    parser.add_argument(
        "--record-path",
        type=Path,
        help="Direct path to a PTB-XL WFDB record without the .hea/.dat suffix.",
    )
    parser.add_argument(
        "--resolution",
        choices=["hr", "lr"],
        default="hr",
        help="Use filename_hr (500 Hz) or filename_lr (100 Hz) when resolving by ecg_id.",
    )
    parser.add_argument(
        "--output",
        type=Path,
        help="Optional file path to save the converted JSON payload.",
    )
    parser.add_argument(
        "--indent",
        type=int,
        default=2,
        help="Pretty-print indentation for JSON output. Default: 2.",
    )
    return parser.parse_args()


def _require(condition, message):
    if not condition:
        raise ValueError(message)


def _find_record_path(dataset_dir, ecg_id, resolution):
    database_path = dataset_dir / "ptbxl_database.csv"
    _require(database_path.exists(), f"PTB-XL metadata file not found: {database_path}")

    with database_path.open("r", encoding="utf-8-sig", newline="") as handle:
        reader = csv.DictReader(handle)
        for row in reader:
            try:
                current_id = int(row.get("ecg_id") or 0)
            except ValueError:
                continue
            if current_id != ecg_id:
                continue

            record_key = "filename_hr" if resolution == "hr" else "filename_lr"
            relative_record = str(row.get(record_key) or "").strip()
            _require(relative_record, f"PTB-XL row for ecg_id={ecg_id} does not contain {record_key}.")
            return dataset_dir / relative_record, row

    raise ValueError(f"PTB-XL ecg_id={ecg_id} was not found in {database_path}.")


def _normalize_record_path(record_path):
    path_str = str(record_path)
    for suffix in (".hea", ".dat"):
        if path_str.endswith(suffix):
            return Path(path_str[: -len(suffix)])
    return Path(path_str)


def _canonical_lead_name(value):
    return LEAD_ALIASES.get(str(value or "").strip().upper(), "")


def _derive_augmented_limb_leads(digital_traces):
    lead_i = digital_traces.get("I")
    lead_ii = digital_traces.get("II")
    if not lead_i or not lead_ii or len(lead_i) != len(lead_ii):
        return

    i_values = lead_i
    ii_values = lead_ii
    if "III" not in digital_traces:
        digital_traces["III"] = [round(ii - i, 6) for i, ii in zip(i_values, ii_values)]
    if "aVR" not in digital_traces:
        digital_traces["aVR"] = [round((-(i + ii)) / 2.0, 6) for i, ii in zip(i_values, ii_values)]
    if "aVL" not in digital_traces:
        digital_traces["aVL"] = [round(i - (ii / 2.0), 6) for i, ii in zip(i_values, ii_values)]
    if "aVF" not in digital_traces:
        digital_traces["aVF"] = [round(ii - (i / 2.0), 6) for i, ii in zip(i_values, ii_values)]


def _build_payload(record, metadata_row=None):
    signal = record.p_signal
    _require(signal is not None, "WFDB record does not contain p_signal data.")

    lead_names = [_canonical_lead_name(name) for name in (record.sig_name or [])]
    _require(lead_names, "WFDB record does not contain lead names.")

    digital_traces = {}
    for lead_name in EXPECTED_LEADS:
        if lead_name not in lead_names:
            continue
        lead_index = lead_names.index(lead_name)
        digital_traces[lead_name] = [round(float(sample), 6) for sample in signal[:, lead_index].tolist()]

    _derive_augmented_limb_leads(digital_traces)

    _require(digital_traces, "No standard 12-lead signals were found in the PTB-XL record.")

    report_text = ""
    if metadata_row:
        report_text = str(metadata_row.get("report") or "").strip()

    acquisition_note = "Imported from PTB-XL digital ECG record."
    if metadata_row:
        acquisition_note = (
            f"Imported from PTB-XL ecg_id={metadata_row.get('ecg_id')} "
            f"patient_id={metadata_row.get('patient_id') or 'unknown'}."
        )

    payload = {
        "digitalTraces": digital_traces,
        "sampleRateHz": float(record.fs or 0),
        "traceUnit": "mV",
        "acquisitionNote": acquisition_note,
    }

    if report_text:
        payload["observedText"] = report_text

    if metadata_row:
        payload["sourceMetadata"] = {
            "dataset": "PTB-XL",
            "ecgId": str(metadata_row.get("ecg_id") or ""),
            "patientId": str(metadata_row.get("patient_id") or ""),
            "recordingDate": str(metadata_row.get("recording_date") or ""),
            "filenameHr": str(metadata_row.get("filename_hr") or ""),
            "filenameLr": str(metadata_row.get("filename_lr") or ""),
        }

    return payload


def main():
    args = _parse_args()

    _require(
        bool(args.record_path) ^ bool(args.dataset_dir and args.ecg_id is not None),
        "Use either --record-path OR the pair --dataset-dir and --ecg-id.",
    )

    metadata_row = None
    if args.record_path:
        record_path = _normalize_record_path(args.record_path)
    else:
        record_path, metadata_row = _find_record_path(args.dataset_dir.resolve(), args.ecg_id, args.resolution)
        record_path = _normalize_record_path(record_path)

    record = wfdb.rdrecord(str(record_path))
    payload = _build_payload(record, metadata_row=metadata_row)
    payload_json = json.dumps(payload, indent=args.indent)

    if args.output:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(payload_json + "\n", encoding="utf-8")
    else:
        print(payload_json)


if __name__ == "__main__":
    main()
