"""
pipeline.py — SoilSentinel 3-tier onboard processing pipeline.

Mirrors the heterogeneous COTS hardware architecture of the Unibap SpaceCloud
iX5-106 (AMD CPU + GPU + Intel Myriad X VPU + Microsemi SmartFusion2 FPGA):

  Tier 1 — FPGA  (~1W, always-on):  cloud masking + sensor I/O
  Tier 2 — VPU   (~2W, always-on):  NDVI/NDWI anomaly detection vs SMAP baseline
  Tier 3 — GPU   (~15W, on-alert):  PT-JPL ET deficit + ESI + severity mapping (0–5)
  CPU             (~5W, always-on):  adaptive scheduling, trend, confidence, downlink

Usage:
  python pipeline/pipeline.py --demo
  python pipeline/pipeline.py --week 8
  python pipeline/pipeline.py --all-weeks --output-dir results/
  python pipeline/pipeline.py --week 8 --real-data   # requires NASA credentials
"""

import argparse
import math
import os
import sys

# Ensure package root is on path when run directly
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from pipeline.data_loaders import (
    REGIONS,
    DROUGHT_CURVES,
    get_drought_severity,
    load_week_data,
)
from pipeline import output as out_module

# ---------------------------------------------------------------------------
# Constants (match JSX thresholds exactly)
# ---------------------------------------------------------------------------

SEV_THRESHOLDS = {"D1": 0.12, "D2": 0.22, "D3": 0.45, "D4": 0.70}
VPU_ANOMALY_THRESHOLD = 0.25   # SMAP anomaly score that wakes the GPU
VPU_NDVI_HEALTHY = 0.60        # NDVI below this = vegetation stress flag
SMAP_BASELINE = 0.35           # m³/m³ — long-term regional baseline
ET_REFERENCE = 0.80            # Normalized ET reference under non-stressed conditions


# ---------------------------------------------------------------------------
# Tier 1 — FPGA: cloud masking + sensor interface
# ---------------------------------------------------------------------------

def fpga_cloud_mask(region_id: str, week: int, demo: bool = False) -> bool:
    """
    Simulate FPGA cloud-mask accept/reject decision.

    In hardware the FPGA discards cloudy frames before they reach the ML
    pipeline, saving downstream compute. Here we model ~85% clear-sky
    acceptance with a deterministic function (reproducible across runs).

    Returns True (clear frame, proceed) or False (cloudy, discard).
    In demo mode always returns True so all regions are processed.
    """
    if demo:
        return True
    seed = ord(region_id[0]) + ord(region_id[1]) * 7
    # Deterministic pseudo-random based on region + week
    clear_prob = 0.75 + abs(math.sin(seed * 0.3 + week * 0.7)) * 0.25
    threshold = 0.15  # ~85% acceptance rate
    return (math.cos(seed + week * 1.3) + 1) / 2 > threshold


# ---------------------------------------------------------------------------
# Tier 2 — VPU: always-on NDVI/NDWI + SMAP anomaly detection (~2W)
# ---------------------------------------------------------------------------

def vpu_detect_anomaly(smap_current: float, smap_baseline: float = SMAP_BASELINE) -> tuple:
    """
    VPU SMAP anomaly detection.

    Formula (as specified in architecture):
        anomaly_score = (baseline - current) / baseline

    Positive score = soil is drier than baseline. Score > VPU_ANOMALY_THRESHOLD
    triggers the GPU pipeline.

    Returns: (flagged: bool, anomaly_score: float)
    """
    if smap_baseline <= 0:
        return False, 0.0
    score = (smap_baseline - smap_current) / smap_baseline
    return (score > VPU_ANOMALY_THRESHOLD, round(score, 3))


def vpu_compute_ndvi_anomaly(ndvi: float, ndwi: float) -> float:
    """
    VPU vegetation anomaly composite score.

    Blends NDVI deficit (60%) and NDWI deficit (40%) relative to healthy
    baselines. Returns score in [0, 1] — higher means more stressed.
    """
    ndvi_score = max(0.0, (VPU_NDVI_HEALTHY - ndvi) / VPU_NDVI_HEALTHY)
    # NDWI baseline 0.15, floor -0.30 → range 0.45
    ndwi_score = max(0.0, (0.15 - ndwi) / 0.45)
    return round(0.6 * ndvi_score + 0.4 * ndwi_score, 3)


# ---------------------------------------------------------------------------
# Tier 3 — GPU: PT-JPL ET deficit + severity mapping (on-alert, ~15W)
# ---------------------------------------------------------------------------

def gpu_compute_et_deficit(et_actual: float, et_reference: float = ET_REFERENCE) -> float:
    """
    GPU ET deficit computation.

    Formula (as specified in architecture):
        et_deficit = 1 - (actual_ET / reference_ET)

    Zero means no stress; 1.0 means complete ET suppression.
    """
    if et_reference <= 0:
        return 0.0
    deficit = 1.0 - (et_actual / et_reference)
    return round(max(0.0, min(1.0, deficit)), 3)


def gpu_compute_severity(
    smap: float,
    ndvi: float,
    ndwi: float,
    et_deficit: float,
    esi: float,
) -> float:
    """
    GPU multi-source drought severity score (0–5 scale).

    Weighted fusion of all four NASA datasets:
      SMAP L4          30% — soil moisture deficit
      NDVI/NDWI        25% / 15% — vegetation + water stress
      PT-JPL ET        20% — evapotranspiration deficit
      ESI L4           10% — evaporative stress index

    Returns float in [0, 5].
    """
    smap_contrib  = max(0.0, (SMAP_BASELINE - smap) / SMAP_BASELINE) * 5 * 0.30
    ndvi_contrib  = max(0.0, (0.70 - ndvi) / 0.70) * 5 * 0.25
    ndwi_contrib  = max(0.0, (0.20 - ndwi) / 0.50) * 5 * 0.15
    et_contrib    = et_deficit * 5 * 0.20
    esi_contrib   = max(0.0, (1.0 - esi)) * 5 * 0.10

    raw = smap_contrib + ndvi_contrib + ndwi_contrib + et_contrib + esi_contrib
    return round(max(0.0, min(5.0, raw)), 2)


def classify_severity_level(severity: float) -> str | None:
    """
    Map 0–5 severity score to USDM drought designation (D1–D4).

    Thresholds are calibrated so that a severity=3.5 (D4) corresponds
    to drought_sev ≈ 0.70 in the underlying curve — matching JSX.
    """
    if severity >= 3.5:
        return "D4"
    if severity >= 2.25:
        return "D3"
    if severity >= 1.1:
        return "D2"
    if severity >= 0.6:
        return "D1"
    return None


# ---------------------------------------------------------------------------
# CPU: adaptive scheduling — trend, confidence, lead days
# ---------------------------------------------------------------------------

def cpu_compute_trend(region_id: str, week: int) -> str:
    """
    Trend direction over the previous 2-week interval.
    Exact port of getTrend() from soilSentinel.jsx.
    """
    if week < 2:
        return "stable"
    curve = DROUGHT_CURVES.get(region_id)
    if curve is None:
        return "stable"
    prev_sev = curve(week - 2)
    curr_sev = curve(week)
    delta = curr_sev - prev_sev
    if delta > 0.05:
        return "worsening"
    if delta < -0.02:
        return "improving"
    return "stable"


def cpu_compute_confidence(drought_sev: float, week: int) -> float:
    """
    Multi-source fusion confidence score.
    Exact port of getConfidence() from soilSentinel.jsx.

    Higher severity activates more sensors → higher confidence.
    Temporal accumulation adds up to 10% over 10 weeks.
    """
    source_count = 4 if drought_sev > 0.3 else 3 if drought_sev > 0.1 else 2
    base = 0.60 + source_count * 0.08 + min(week * 0.01, 0.10)
    return min(0.98, round(base, 2))


def cpu_compute_lead_days(drought_sev: float) -> int:
    """
    Estimated detection lead days vs traditional ground-based methods.
    Exact port of leadDays logic from getAlerts() in soilSentinel.jsx.
    """
    if drought_sev >= 0.5:
        return 18
    if drought_sev >= 0.3:
        return 14
    if drought_sev >= 0.15:
        return 9
    return 5


# ---------------------------------------------------------------------------
# Main orchestration
# ---------------------------------------------------------------------------

def process_week(week: int, use_real: bool = False, demo: bool = False) -> list:
    """
    Run the full 3-tier pipeline for all 15 regions at a given week.

    Returns list of alert dicts sorted by severity descending.
    Only regions at D1 or above are included.
    """
    alerts = []

    for region in REGIONS:
        rid = region["id"]

        # --- Tier 1: FPGA cloud mask ---
        if not fpga_cloud_mask(rid, week, demo=demo):
            continue  # Frame discarded — GPU stays off

        # --- Load sensor data (synthetic or real) ---
        drought_sev = get_drought_severity(rid, week)
        data = load_week_data(rid, week, use_real=use_real)

        # --- Tier 2: VPU anomaly detection ---
        smap_flagged, smap_score = vpu_detect_anomaly(data["smap"])
        ndvi_score = vpu_compute_ndvi_anomaly(data["ndvi"], data["ndwi"])
        vpu_anomaly = smap_flagged or (ndvi_score > 0.3)

        # Skip GPU if VPU sees no anomaly and drought below watch level
        if not vpu_anomaly and drought_sev < SEV_THRESHOLDS["D1"]:
            continue

        # --- Tier 3: GPU severity computation ---
        et_deficit = gpu_compute_et_deficit(data["ptjpl"])
        severity = gpu_compute_severity(
            data["smap"], data["ndvi"], data["ndwi"], et_deficit, data["esi"]
        )
        level = classify_severity_level(severity)

        if level is None:
            continue  # Below D1 threshold — no alert

        # --- CPU: scheduling metadata ---
        trend = cpu_compute_trend(rid, week)
        confidence = cpu_compute_confidence(drought_sev, week)
        lead_days = cpu_compute_lead_days(drought_sev)

        sensor_sources = ["smap", "ndvi", "ndwi"]
        if drought_sev > SEV_THRESHOLDS["D1"]:
            sensor_sources += ["ptjpl", "esi"]

        alerts.append({
            "region_id": rid,
            "name": region["name"],
            "group": region["group"],
            "drought_sev": drought_sev,
            "severity": severity,
            "level": level,
            "trend": trend,
            "confidence": confidence,
            "lead_days": lead_days,
            "et_deficit": et_deficit,
            "smap_score": smap_score,
            "ndvi_score": ndvi_score,
            "sensor_sources": sensor_sources,
            "datasets": {k: data[k] for k in ("smap", "ndvi", "ndwi", "ptjpl", "esi")},
            "data_source": data.get("source", "synthetic"),
        })

    alerts.sort(key=lambda a: a["severity"], reverse=True)
    return alerts


# ---------------------------------------------------------------------------
# Runner modes
# ---------------------------------------------------------------------------

def run_single_week(week: int, use_real: bool = False, output_dir: str = "output"):
    alerts = process_week(week, use_real=use_real, demo=True)
    out_module.print_summary(alerts, week)
    path = out_module.save_geojson(alerts, week, output_dir=output_dir)
    print(f"\n  GeoJSON saved → {path}")


def run_demo(output_dir: str = "output"):
    """Run all 20 weeks of the 2012 Midwest drought simulation."""
    print("\n  SoilSentinel — 2012 U.S. Midwest Drought Simulation")
    print("  " + "=" * 56)
    print(f"  {'Week':<6} {'Date':<12} {'Alerts':>7} {'D4':>4} {'D3':>4} {'D2':>4} {'D1':>4} {'Saved%':>7}")
    print("  " + "-" * 56)

    for w in range(20):
        alerts = process_week(w, demo=True)
        d4 = sum(1 for a in alerts if a["level"] == "D4")
        d3 = sum(1 for a in alerts if a["level"] == "D3")
        d2 = sum(1 for a in alerts if a["level"] == "D2")
        d1 = sum(1 for a in alerts if a["level"] == "D1")
        proc_mb = max(1.2, round(len(alerts) * 0.8, 1))
        saved = round((1 - proc_mb / 500) * 100, 1)
        from pipeline.data_loaders import week_to_date
        date_str = str(week_to_date(w))
        print(f"  {w+1:<6} {date_str:<12} {len(alerts):>7} {d4:>4} {d3:>4} {d2:>4} {d1:>4} {saved:>6}%")
        out_module.save_geojson(alerts, w, output_dir=output_dir)

    print("  " + "=" * 56)
    print(f"  GeoJSON files written to: {os.path.abspath(output_dir)}/\n")


def run_all_weeks(use_real: bool = False, output_dir: str = "output"):
    for w in range(20):
        alerts = process_week(w, use_real=use_real, demo=True)
        out_module.print_summary(alerts, w)
        out_module.save_geojson(alerts, w, output_dir=output_dir)
        print()


# ---------------------------------------------------------------------------
# CLI entry point
# ---------------------------------------------------------------------------

def main():
    parser = argparse.ArgumentParser(
        description="SoilSentinel onboard drought detection pipeline",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  python pipeline/pipeline.py --demo
  python pipeline/pipeline.py --week 8
  python pipeline/pipeline.py --all-weeks --output-dir results/
  python pipeline/pipeline.py --week 8 --real-data
        """,
    )
    parser.add_argument("--demo", action="store_true",
                        help="Run all 20 weeks, print summary table (no credentials needed)")
    parser.add_argument("--week", type=int, metavar="N",
                        help="Process a single week (0-indexed, 0=May 7 2012)")
    parser.add_argument("--all-weeks", action="store_true",
                        help="Process all 20 weeks with full alert tables")
    parser.add_argument("--real-data", action="store_true",
                        help="Use real NASA Earthdata (requires EARTHDATA_USER + EARTHDATA_PASS env vars)")
    parser.add_argument("--output-dir", default="output",
                        help="Directory for GeoJSON output (default: output/)")
    args = parser.parse_args()

    if args.real_data and not _check_credentials():
        return

    if args.demo:
        run_demo(output_dir=args.output_dir)
    elif args.week is not None:
        if not 0 <= args.week <= 19:
            print("Error: --week must be between 0 and 19")
            sys.exit(1)
        run_single_week(args.week, use_real=args.real_data, output_dir=args.output_dir)
    elif args.all_weeks:
        run_all_weeks(use_real=args.real_data, output_dir=args.output_dir)
    else:
        parser.print_help()


def _check_credentials() -> bool:
    from pipeline.data_loaders import has_earthdata_credentials
    if not has_earthdata_credentials():
        print("Error: --real-data requires EARTHDATA_USER and EARTHDATA_PASS environment variables.")
        print("Register free at https://urs.earthdata.nasa.gov/")
        return False
    return True


if __name__ == "__main__":
    main()
