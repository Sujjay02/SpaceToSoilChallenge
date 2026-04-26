"""
output.py — SoilSentinel GeoJSON output and reporting.

Generates competition-spec GeoJSON FeatureCollections (not raw imagery):
  - Region polygons using real WGS84 state bounding boxes
  - severity (0–5 scale), severity_level (D1–D4)
  - trend (worsening / stable / improving)
  - confidence (multi-source fusion confidence)
  - timestamp, sensor_sources, lead_days
  - all four dataset readings (smap_sm, ndvi, ndwi, et_deficit, esi)

Bandwidth reduction formula mirrors procMB = max(1.2, alerts.length * 0.8)
from soilSentinel.jsx (line 127), validating the 98% reduction claim.
"""

import json
import os
import datetime

# ---------------------------------------------------------------------------
# Real WGS84 bounding boxes [lon_min, lat_min, lon_max, lat_max]
# ---------------------------------------------------------------------------

REGION_BBOX = {
    "ND": [-104.05,  45.94,  -96.55,  49.00],
    "SD": [-104.06,  42.48,  -96.44,  45.94],
    "NE": [-104.05,  39.99, -95.308,  43.00],
    "KS": [-102.05,  36.99,  -94.59,  40.00],
    "OK": [-103.00,  33.62,  -94.43,  37.00],
    "TX": [-106.65,  25.84,  -93.51,  36.50],
    "MN": [ -97.24,  43.50,  -89.48,  49.38],
    "IA": [  -96.64,  40.37,  -90.14,  43.50],
    "MO": [ -95.77,  35.99,  -89.10,  40.61],
    "AR": [ -94.62,  33.00,  -89.64,  36.50],
    "WI": [ -92.89,  42.49,  -86.25,  47.08],
    "IL": [ -91.51,  36.97,  -87.02,  42.51],
    "IN": [ -88.10,  37.77,  -84.78,  41.76],
    "OH": [ -84.82,  38.40,  -80.52,  41.98],
    "CO": [-109.06,  36.99, -102.04,  41.00],
}


def build_polygon_coords(region_id: str) -> list:
    """
    Return a GeoJSON Polygon coordinate ring for a state bounding box.
    5-point closed ring: SW → SE → NE → NW → SW.
    """
    bb = REGION_BBOX.get(region_id)
    if bb is None:
        return [[[-100.0, 37.0], [-95.0, 37.0], [-95.0, 40.0], [-100.0, 40.0], [-100.0, 37.0]]]
    lon_min, lat_min, lon_max, lat_max = bb
    ring = [
        [lon_min, lat_min],
        [lon_max, lat_min],
        [lon_max, lat_max],
        [lon_min, lat_max],
        [lon_min, lat_min],
    ]
    return [ring]


def week_to_iso(week: int) -> str:
    """Convert week index (0=May 7 2012) to ISO 8601 timestamp string."""
    d = datetime.date(2012, 5, 7) + datetime.timedelta(weeks=week)
    return f"{d.isoformat()}T00:00:00Z"


def week_to_label(week: int) -> str:
    d = datetime.date(2012, 5, 7) + datetime.timedelta(weeks=week)
    return d.strftime("%b %d, %Y").replace(" 0", " ")


# ---------------------------------------------------------------------------
# GeoJSON feature builder
# ---------------------------------------------------------------------------

def alert_to_feature(alert: dict, week: int) -> dict:
    """Convert a pipeline alert dict to a GeoJSON Feature."""
    return {
        "type": "Feature",
        "geometry": {
            "type": "Polygon",
            "coordinates": build_polygon_coords(alert["region_id"]),
        },
        "properties": {
            "region":          alert["region_id"],
            "name":            alert["name"],
            "severity":        alert["severity"],        # 0–5 scale
            "severity_level":  alert["level"],           # "D1"/"D2"/"D3"/"D4"
            "trend":           alert["trend"],           # worsening/stable/improving
            "confidence":      alert["confidence"],      # 0.60–0.98
            "timestamp":       week_to_iso(week),
            "sensor_sources":  alert["sensor_sources"],
            "lead_days":       alert["lead_days"],
            "smap_sm":         alert["datasets"]["smap"],
            "ndvi":            alert["datasets"]["ndvi"],
            "ndwi":            alert["datasets"]["ndwi"],
            "et_deficit":      alert["et_deficit"],
            "esi":             alert["datasets"]["esi"],
            "data_source":     alert.get("data_source", "synthetic"),
        },
    }


def build_feature_collection(alerts: list, week: int) -> dict:
    """
    Build GeoJSON FeatureCollection with competition-spec metadata.

    Bandwidth formula mirrors soilSentinel.jsx line 127:
        procMB = max(1.2, alerts.length * 0.8)
    """
    proc_mb = max(1.2, round(len(alerts) * 0.8, 1))
    raw_mb = 500
    bw_reduction = round((1 - proc_mb / raw_mb) * 100, 1)
    packet_kb = round(proc_mb * 1024 / 100, 1)  # ~10 KB per alert

    return {
        "type": "FeatureCollection",
        "metadata": {
            "week":                    week,
            "week_label":              f"Week {week + 1}",
            "date":                    week_to_iso(week)[:10],
            "scenario":                "2012_midwest_drought",
            "alert_count":             len(alerts),
            "raw_mb_per_pass":         raw_mb,
            "processed_mb_per_pass":   proc_mb,
            "bandwidth_reduction_pct": bw_reduction,
            "packet_size_kb":          packet_kb,
            "generator":               "SoilSentinel v1.0 / NASA ESTO Space to Soil 2026",
            "platform":                "Unibap SpaceCloud iX5-106 (AMD CPU+GPU + Myriad X VPU + SmartFusion2 FPGA)",
            "datasets": [
                {"id": "smap",  "doi": "10.5067/LWJ6TF5SZRG3",               "hw": "VPU"},
                {"id": "ndvi",  "doi": "10.5067/MODIS/MOD13Q1.061",           "hw": "VPU"},
                {"id": "ptjpl", "doi": "10.5067/ECOSTRESS/ECO3ETPTJPL.001",   "hw": "GPU"},
                {"id": "esi",   "doi": "10.5067/ECOSTRESS/ECO4ESIALEXI.001",  "hw": "GPU"},
            ],
        },
        "features": [alert_to_feature(a, week) for a in alerts],
    }


# ---------------------------------------------------------------------------
# File I/O
# ---------------------------------------------------------------------------

def save_geojson(alerts: list, week: int, output_dir: str = "output") -> str:
    """Write GeoJSON FeatureCollection to disk. Returns file path."""
    os.makedirs(output_dir, exist_ok=True)
    date_str = week_to_iso(week)[:10]
    filename = f"soilsentinel_week{week + 1:02d}_{date_str}.geojson"
    path = os.path.join(output_dir, filename)
    fc = build_feature_collection(alerts, week)
    with open(path, "w") as f:
        json.dump(fc, f, indent=2)
    return path


# ---------------------------------------------------------------------------
# Console reporting
# ---------------------------------------------------------------------------

TREND_ICON = {"worsening": "↑", "stable": "→", "improving": "↓"}
LEVEL_COLOR = {"D4": "CRIT", "D3": "SEVR", "D2": "MOD ", "D1": "WTCH"}


def print_summary(alerts: list, week: int):
    """Print a formatted alert table and bandwidth summary to stdout."""
    fc = build_feature_collection(alerts, week)
    meta = fc["metadata"]
    date_label = week_to_label(week)

    print(f"\n  ┌{'─' * 64}┐")
    print(f"  │  SoilSentinel · Week {week + 1} · {date_label:<39}│")
    print(f"  ├{'─' * 14}┬{'─' * 6}┬{'─' * 9}┬{'─' * 11}┬{'─' * 10}┬{'─' * 8}┤")
    print(f"  │ {'Region':<13}│ {'Lvl':<5}│ {'Sev/5':<8}│ {'Trend':<10}│ {'Confidence':<9}│ {'Lead':>7} │")
    print(f"  ├{'─' * 14}┼{'─' * 6}┼{'─' * 9}┼{'─' * 11}┼{'─' * 10}┼{'─' * 8}┤")

    if not alerts:
        print(f"  │ {'No alerts — all regions below D1 watch threshold':<63}│")
    else:
        for a in alerts:
            icon = TREND_ICON.get(a["trend"], "?")
            print(
                f"  │ {a['name']:<13}│ {a['level']:<5}│ {a['severity']:>5.2f}/5  "
                f"│ {icon} {a['trend']:<9}│ {int(a['confidence']*100):>8}%  "
                f"│ +{a['lead_days']:>3}d   │"
            )

    print(f"  ├{'─' * 14}┴{'─' * 6}┴{'─' * 9}┴{'─' * 11}┴{'─' * 10}┴{'─' * 8}┤")
    print(
        f"  │  Raw: {meta['raw_mb_per_pass']} MB/pass  →  Processed: "
        f"{meta['processed_mb_per_pass']} MB  "
        f"({meta['bandwidth_reduction_pct']}% saved){'':>14}│"
    )
    print(f"  │  Alert count: {meta['alert_count']}   Packet: ~{meta['packet_size_kb']} KB{'':>35}│")
    print(f"  └{'─' * 64}┘")
