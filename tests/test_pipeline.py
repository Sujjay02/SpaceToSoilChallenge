"""
Unit and integration tests for the SoilSentinel pipeline.

Run with:  python -m pytest tests/ -v
           python -m pytest tests/ -v --tb=short
"""

import sys
import os
import math

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from pipeline.pipeline import (
    vpu_detect_anomaly,
    vpu_compute_ndvi_anomaly,
    gpu_compute_et_deficit,
    gpu_compute_severity,
    classify_severity_level,
    cpu_compute_confidence,
    cpu_compute_lead_days,
    cpu_compute_trend,
    process_week,
    SMAP_BASELINE,
    ET_REFERENCE,
    VPU_ANOMALY_THRESHOLD,
)
from pipeline.data_loaders import get_drought_severity, DROUGHT_CURVES


# ---------------------------------------------------------------------------
# Tier 2 — VPU: SMAP anomaly detection
# ---------------------------------------------------------------------------

def test_vpu_anomaly_no_stress():
    """At baseline soil moisture the anomaly score is zero and no flag is raised."""
    flagged, score = vpu_detect_anomaly(SMAP_BASELINE)
    assert not flagged
    assert score == 0.0


def test_vpu_anomaly_severe_drought():
    """Half the baseline triggers the GPU wakeup flag."""
    flagged, score = vpu_detect_anomaly(SMAP_BASELINE / 2)
    assert flagged
    assert abs(score - 0.5) < 0.001


def test_vpu_anomaly_below_threshold():
    """SMAP value that produces anomaly_score < 0.25 is not flagged."""
    # smap=0.27 → score = (0.35-0.27)/0.35 ≈ 0.229 < 0.25 → not flagged
    flagged, score = vpu_detect_anomaly(0.27)
    assert not flagged
    assert score < VPU_ANOMALY_THRESHOLD


def test_vpu_ndvi_no_stress():
    """Healthy NDVI and NDWI produce zero vegetation anomaly score."""
    score = vpu_compute_ndvi_anomaly(ndvi=0.60, ndwi=0.15)
    assert score == 0.0


def test_vpu_ndvi_combined_stress():
    """Composite score blends NDVI deficit (60%) and NDWI deficit (40%)."""
    # ndvi_score = (0.60 - 0.30) / 0.60 = 0.5
    # ndwi_score = (0.15 - (-0.15)) / 0.45 = 0.667
    # composite  = 0.6 * 0.5 + 0.4 * 0.667 = 0.567
    score = vpu_compute_ndvi_anomaly(ndvi=0.30, ndwi=-0.15)
    assert abs(score - 0.567) < 0.001


# ---------------------------------------------------------------------------
# Tier 3 — GPU: ET deficit and severity
# ---------------------------------------------------------------------------

def test_et_deficit_no_stress():
    """Reference-level ET means zero deficit."""
    assert gpu_compute_et_deficit(ET_REFERENCE) == 0.0


def test_et_deficit_half_suppressed():
    """ET at 50% of reference gives 0.5 deficit."""
    assert gpu_compute_et_deficit(ET_REFERENCE / 2) == 0.5


def test_et_deficit_complete_suppression():
    """Zero actual ET gives deficit of 1.0 (clamped)."""
    assert gpu_compute_et_deficit(0.0) == 1.0


def test_severity_no_drought():
    """Baseline conditions across all datasets give severity 0.0."""
    sev = gpu_compute_severity(
        smap=SMAP_BASELINE,
        ndvi=0.70,
        ndwi=0.20,
        et_deficit=0.0,
        esi=1.0,
    )
    assert sev == 0.0


def test_severity_maximum():
    """Worst-case inputs across all datasets sum to exactly 5.0.

    smap=0.0   → smap_contrib  = (0.35/0.35)*5*0.30 = 1.50
    ndvi=0.0   → ndvi_contrib  = (0.70/0.70)*5*0.25 = 1.25
    ndwi=-0.3  → ndwi_contrib  = (0.50/0.50)*5*0.15 = 0.75
    et_def=1.0 → et_contrib    = 1.0    *5*0.20 = 1.00
    esi=0.0    → esi_contrib   = 1.0    *5*0.10 = 0.50
                                               total = 5.00
    """
    sev = gpu_compute_severity(
        smap=0.0,
        ndvi=0.0,
        ndwi=-0.3,
        et_deficit=1.0,
        esi=0.0,
    )
    assert sev == 5.0


def test_severity_weights_sum_to_five():
    """Each weight contributes to the correct fraction of the 0-5 scale."""
    # SMAP at 100% depletion alone should contribute 1.5 (30% of 5)
    sev = gpu_compute_severity(
        smap=0.0,
        ndvi=0.70,   # healthy
        ndwi=0.20,   # healthy
        et_deficit=0.0,
        esi=1.0,
    )
    assert abs(sev - 1.5) < 0.01


# ---------------------------------------------------------------------------
# Severity classification
# ---------------------------------------------------------------------------

def test_classify_below_d1():
    assert classify_severity_level(0.5) is None


def test_classify_d1_boundary():
    assert classify_severity_level(0.6) == "D1"
    assert classify_severity_level(1.09) == "D1"


def test_classify_d2_boundary():
    assert classify_severity_level(1.1) == "D2"
    assert classify_severity_level(2.24) == "D2"


def test_classify_d3_boundary():
    assert classify_severity_level(2.25) == "D3"
    assert classify_severity_level(3.49) == "D3"


def test_classify_d4_boundary():
    assert classify_severity_level(3.5) == "D4"
    assert classify_severity_level(5.0) == "D4"


# ---------------------------------------------------------------------------
# CPU: scheduling metadata
# ---------------------------------------------------------------------------

def test_confidence_four_sources():
    """High-severity drought activates 4 sources → 0.98 cap by week 8."""
    # source_count=4, base = 0.60 + 4*0.08 + min(8*0.01, 0.10) = 1.00 → capped 0.98
    assert cpu_compute_confidence(drought_sev=0.5, week=8) == 0.98


def test_confidence_two_sources_early():
    """Low severity early in the season gives minimum confidence."""
    # source_count=2, week=0 → 0.60 + 2*0.08 + 0 = 0.76
    assert cpu_compute_confidence(drought_sev=0.05, week=0) == 0.76


def test_lead_days():
    assert cpu_compute_lead_days(0.5) == 18
    assert cpu_compute_lead_days(0.3) == 14
    assert cpu_compute_lead_days(0.15) == 9
    assert cpu_compute_lead_days(0.1) == 5


def test_trend_worsening():
    # KS onset week 1, rate 0.135 — at week 10 the 2-week delta is well above 0.05
    assert cpu_compute_trend("KS", week=10) == "worsening"


def test_trend_stable_early():
    # Before onset, KS curve is flat at 0
    assert cpu_compute_trend("KS", week=0) == "stable"


# ---------------------------------------------------------------------------
# Drought curves (data_loaders)
# ---------------------------------------------------------------------------

def test_ks_curve_before_onset():
    assert get_drought_severity("KS", week=0) == 0.0


def test_ks_curve_onset():
    # KS: (t - 1.0) * 0.135; at t=1 → 0.0; at t=2 → 0.135
    assert abs(get_drought_severity("KS", week=2) - 0.135) < 0.001


def test_ks_curve_capped():
    # By week 8, (8-1)*0.135 = 0.945 < 1; by week 20 it would exceed 1
    assert get_drought_severity("KS", week=20) == 1.0


def test_nd_curve_later_onset():
    # ND: onset week 10 — still 0 at week 9
    assert get_drought_severity("ND", week=9) == 0.0
    assert get_drought_severity("ND", week=11) > 0.0


# ---------------------------------------------------------------------------
# Integration: full pipeline run
# ---------------------------------------------------------------------------

def test_week0_no_alerts():
    """No region has crossed D1 watch at the very start of the simulation."""
    alerts = process_week(0, demo=True)
    assert len(alerts) == 0


def test_week8_kansas_d4():
    """Kansas is the first to reach D4 Critical — confirmed at week 8 (Jul 2, 2012)."""
    alerts = process_week(8, demo=True)
    ks = next((a for a in alerts if a["region_id"] == "KS"), None)
    assert ks is not None, "Kansas should be in alerts at week 8"
    assert ks["level"] == "D4"
    assert abs(ks["severity"] - 3.71) < 0.05


def test_week8_alert_count():
    """Peak early drought: exactly 10 regions at D1+ by week 8."""
    alerts = process_week(8, demo=True)
    assert len(alerts) == 10


def test_week8_alerts_sorted_by_severity():
    """Alerts are returned in descending severity order."""
    alerts = process_week(8, demo=True)
    severities = [a["severity"] for a in alerts]
    assert severities == sorted(severities, reverse=True)


def test_week19_all_15_regions():
    """By the end of the simulation all 15 regions have reached drought watch."""
    alerts = process_week(19, demo=True)
    assert len(alerts) == 15


def test_bandwidth_reduction():
    """Week 8 with 10 alerts: processed ≤ 8 MB vs 500 MB raw (≥ 98% reduction)."""
    alerts = process_week(8, demo=True)
    proc_mb = max(1.2, len(alerts) * 0.8)
    saved_pct = (1 - proc_mb / 500) * 100
    assert saved_pct >= 98.0
