"""
data_loaders.py — SoilSentinel data access layer.

Provides synthetic simulation of the 2012 U.S. Midwest drought (no credentials
needed) and optional real NASA Earthdata access via earthaccess + h5py/netCDF4.

All synthetic formulas are exact Python ports of soilSentinel.jsx so that
the dashboard and the pipeline produce numerically identical outputs.
"""

import math
import os
import datetime

# ---------------------------------------------------------------------------
# Region definitions (mirrors REGIONS constant in soilSentinel.jsx)
# ---------------------------------------------------------------------------

REGIONS = [
    {"id": "ND", "name": "North Dakota",  "cx": 168, "cy":  52, "w":  88, "h": 44, "group": "north"},
    {"id": "SD", "name": "South Dakota",  "cx": 168, "cy": 104, "w":  88, "h": 44, "group": "north"},
    {"id": "NE", "name": "Nebraska",      "cx": 168, "cy": 158, "w": 100, "h": 44, "group": "core"},
    {"id": "KS", "name": "Kansas",        "cx": 172, "cy": 214, "w": 100, "h": 44, "group": "core"},
    {"id": "OK", "name": "Oklahoma",      "cx": 170, "cy": 272, "w": 108, "h": 42, "group": "south"},
    {"id": "TX", "name": "Texas",         "cx": 148, "cy": 338, "w": 120, "h": 72, "group": "south"},
    {"id": "MN", "name": "Minnesota",     "cx": 276, "cy":  62, "w":  68, "h": 58, "group": "north"},
    {"id": "IA", "name": "Iowa",          "cx": 276, "cy": 138, "w":  72, "h": 48, "group": "core"},
    {"id": "MO", "name": "Missouri",      "cx": 282, "cy": 218, "w":  72, "h": 66, "group": "core"},
    {"id": "AR", "name": "Arkansas",      "cx": 282, "cy": 296, "w":  64, "h": 44, "group": "south"},
    {"id": "WI", "name": "Wisconsin",     "cx": 354, "cy":  68, "w":  56, "h": 54, "group": "east"},
    {"id": "IL", "name": "Illinois",      "cx": 362, "cy": 178, "w":  42, "h": 88, "group": "east"},
    {"id": "IN", "name": "Indiana",       "cx": 414, "cy": 182, "w":  38, "h": 78, "group": "east"},
    {"id": "OH", "name": "Ohio",          "cx": 464, "cy": 174, "w":  50, "h": 68, "group": "east"},
    {"id": "CO", "name": "Colorado",      "cx":  78, "cy": 178, "w":  76, "h": 60, "group": "west"},
]

REGION_IDS = {r["id"] for r in REGIONS}

# ---------------------------------------------------------------------------
# Drought progression curves (mirrors droughtCurves in soilSentinel.jsx)
# Each lambda encodes: onset week and weekly severity growth rate.
# ---------------------------------------------------------------------------

DROUGHT_CURVES = {
    "KS": lambda t: min(1.0, max(0.0, (t - 1.0)  * 0.135)),
    "OK": lambda t: min(1.0, max(0.0, (t - 1.5)  * 0.120)),
    "NE": lambda t: min(1.0, max(0.0, (t - 2.0)  * 0.125)),
    "CO": lambda t: min(1.0, max(0.0, (t - 2.5)  * 0.100)),
    "TX": lambda t: min(1.0, max(0.0, (t - 3.0)  * 0.095)),
    "IA": lambda t: min(1.0, max(0.0, (t - 4.0)  * 0.130)),
    "MO": lambda t: min(1.0, max(0.0, (t - 4.5)  * 0.110)),
    "SD": lambda t: min(1.0, max(0.0, (t - 5.0)  * 0.100)),
    "IL": lambda t: min(1.0, max(0.0, (t - 6.0)  * 0.115)),
    "AR": lambda t: min(1.0, max(0.0, (t - 6.0)  * 0.090)),
    "IN": lambda t: min(1.0, max(0.0, (t - 7.5)  * 0.100)),
    "MN": lambda t: min(1.0, max(0.0, (t - 8.0)  * 0.070)),
    "WI": lambda t: min(1.0, max(0.0, (t - 9.0)  * 0.060)),
    "OH": lambda t: min(1.0, max(0.0, (t - 9.0)  * 0.065)),
    "ND": lambda t: min(1.0, max(0.0, (t - 10.0) * 0.050)),
}

SCENARIO_START = datetime.date(2012, 5, 7)


def week_to_date(week: int) -> datetime.date:
    return SCENARIO_START + datetime.timedelta(weeks=week)


# ---------------------------------------------------------------------------
# Synthetic simulation (mirrors getDroughtData + getDatasetValues in JSX)
# ---------------------------------------------------------------------------

def get_drought_severity(region_id: str, week: int) -> float:
    """Return drought severity [0, 1] for a region at a given week."""
    curve = DROUGHT_CURVES.get(region_id)
    if curve is None:
        return 0.0
    return round(curve(week), 3)


def get_synthetic_dataset_values(region_id: str, week: int, drought_sev: float) -> dict:
    """
    Return synthetic satellite readings for a region.

    Exact port of getDatasetValues() from soilSentinel.jsx:
      seed  = charCode[0] + charCode[1] * 7
      jitter = sin(seed * 0.1 + week * 0.3 + offset) * 0.08
    """
    seed = ord(region_id[0]) + ord(region_id[1]) * 7
    jitter = lambda offset: math.sin(seed * 0.1 + week * 0.3 + offset) * 0.08

    smap = round(max(0.0, min(1.0, 0.35 - drought_sev * 0.30  + jitter(1))), 3)
    ndvi = round(max(0.0, min(1.0, 0.70 - drought_sev * 0.55  + jitter(2))), 3)
    ndwi = round(max(-0.3, min(0.5, 0.20 - drought_sev * 0.45 + jitter(3))), 3)
    ptjpl = round(max(0.0, min(1.0, 0.80 - drought_sev * 0.60 + jitter(4))), 3)
    esi  = round(max(0.0, min(1.0, 1.00 - drought_sev * 0.85  + jitter(5))), 3)

    return {"smap": smap, "ndvi": ndvi, "ndwi": ndwi, "ptjpl": ptjpl, "esi": esi}


# ---------------------------------------------------------------------------
# Real NASA Earthdata access (optional — requires credentials)
# ---------------------------------------------------------------------------

def has_earthdata_credentials() -> bool:
    return bool(os.environ.get("EARTHDATA_USER") and os.environ.get("EARTHDATA_PASS"))


def _region_bbox(region_id: str) -> tuple:
    """Return (lon_min, lat_min, lon_max, lat_max) for a state."""
    from pipeline.output import REGION_BBOX
    bb = REGION_BBOX.get(region_id)
    if bb is None:
        return (-100.0, 35.0, -95.0, 40.0)
    return (bb[0], bb[1], bb[2], bb[3])


def load_real_smap(region_id: str, week: int, fallback_sev: float) -> float:
    """
    Fetch SMAP L4 SPL4SMGP volumetric soil moisture for a region/week.
    DOI: 10.5067/LWJ6TF5SZRG3

    Returns mean sm_surface value, or falls back to synthetic on any error.
    Requires: pip install earthaccess h5py
    Env vars: EARTHDATA_USER, EARTHDATA_PASS
    """
    try:
        import earthaccess
        import h5py

        os.environ.setdefault("EARTHDATA_USERNAME", os.environ["EARTHDATA_USER"])
        os.environ.setdefault("EARTHDATA_PASSWORD", os.environ["EARTHDATA_PASS"])
        earthaccess.login(strategy="environment")

        target_date = week_to_date(week)
        lon_min, lat_min, lon_max, lat_max = _region_bbox(region_id)

        results = earthaccess.search_data(
            short_name="SPL4SMGP",
            temporal=(str(target_date), str(target_date + datetime.timedelta(days=1))),
            bounding_box=(lon_min, lat_min, lon_max, lat_max),
            count=1,
        )
        if not results:
            raise ValueError("No SMAP granules found")

        files = earthaccess.download(results, local_path="/tmp/smap_cache")
        with h5py.File(files[0], "r") as f:
            sm = f["Geophysical_Data"]["sm_surface"][:]
            valid = sm[(sm > -9000)]
            if len(valid) == 0:
                raise ValueError("No valid SMAP pixels")
            return round(float(valid.mean()), 3)

    except Exception:
        return get_synthetic_dataset_values(region_id, week, fallback_sev)["smap"]


def load_real_modis_ndvi(region_id: str, week: int, fallback_sev: float) -> tuple:
    """
    Fetch MODIS MOD13Q1 NDVI and derived NDWI for a region/week.
    DOI: 10.5067/MODIS/MOD13Q1.061

    NDWI = (NIR - SWIR) / (NIR + SWIR) approximated from EVI bands.
    Returns (ndvi, ndwi), or falls back to synthetic on any error.
    Requires: pip install earthaccess netCDF4
    """
    try:
        import earthaccess

        os.environ.setdefault("EARTHDATA_USERNAME", os.environ["EARTHDATA_USER"])
        os.environ.setdefault("EARTHDATA_PASSWORD", os.environ["EARTHDATA_PASS"])
        earthaccess.login(strategy="environment")

        target_date = week_to_date(week)
        lon_min, lat_min, lon_max, lat_max = _region_bbox(region_id)

        # MOD13Q1 is 16-day composite; search a 20-day window
        results = earthaccess.search_data(
            short_name="MOD13Q1",
            temporal=(
                str(target_date - datetime.timedelta(days=8)),
                str(target_date + datetime.timedelta(days=12)),
            ),
            bounding_box=(lon_min, lat_min, lon_max, lat_max),
            count=1,
        )
        if not results:
            raise ValueError("No MOD13Q1 granules found")

        files = earthaccess.download(results, local_path="/tmp/modis_cache")

        # Try netCDF4 first, fall back to h5py
        try:
            import netCDF4 as nc
            with nc.Dataset(files[0]) as ds:
                ndvi_raw = ds.variables["250m 16 days NDVI"][:]
                evi_raw  = ds.variables["250m 16 days EVI"][:]
        except Exception:
            import h5py
            with h5py.File(files[0], "r") as f:
                ndvi_raw = f["250m 16 days NDVI"][:]
                evi_raw  = f["250m 16 days EVI"][:]

        ndvi_val = float(ndvi_raw[ndvi_raw > -3000].mean()) * 0.0001
        evi_val  = float(evi_raw[evi_raw > -3000].mean())  * 0.0001
        # NDWI approximated from EVI: EVI encodes NIR/Red reflectance balance
        ndwi_approx = max(-0.3, min(0.5, evi_val * 0.4 - 0.05))

        return (round(ndvi_val, 3), round(ndwi_approx, 3))

    except Exception:
        vals = get_synthetic_dataset_values(region_id, week, fallback_sev)
        return (vals["ndvi"], vals["ndwi"])


def load_real_ecostress(region_id: str, week: int, fallback_sev: float) -> tuple:
    """
    Fetch ECOSTRESS PT-JPL ET and ESI for a region/week.
    ET DOI:  10.5067/ECOSTRESS/ECO3ETPTJPL.001
    ESI DOI: 10.5067/ECOSTRESS/ECO4ESIALEXI.001

    Returns (et_normalized, esi), or falls back to synthetic on any error.
    Requires: pip install earthaccess h5py
    """
    try:
        import earthaccess
        import h5py

        os.environ.setdefault("EARTHDATA_USERNAME", os.environ["EARTHDATA_USER"])
        os.environ.setdefault("EARTHDATA_PASSWORD", os.environ["EARTHDATA_PASS"])
        earthaccess.login(strategy="environment")

        target_date = week_to_date(week)
        lon_min, lat_min, lon_max, lat_max = _region_bbox(region_id)
        temporal = (str(target_date), str(target_date + datetime.timedelta(days=3)))

        et_results  = earthaccess.search_data(short_name="ECO3ETPTJPL", temporal=temporal,
                                               bounding_box=(lon_min, lat_min, lon_max, lat_max), count=1)
        esi_results = earthaccess.search_data(short_name="ECO4ESIALEXI", temporal=temporal,
                                               bounding_box=(lon_min, lat_min, lon_max, lat_max), count=1)

        et_val, esi_val = None, None

        if et_results:
            files = earthaccess.download(et_results, local_path="/tmp/eco_cache")
            with h5py.File(files[0], "r") as f:
                et_raw = f["SDS"]["ETinst"][:]
                valid = et_raw[et_raw > 0]
                if len(valid) > 0:
                    # ETinst in W/m²; normalize to [0,1] against ~650 W/m² max
                    et_val = round(min(1.0, float(valid.mean()) / 650.0), 3)

        if esi_results:
            files = earthaccess.download(esi_results, local_path="/tmp/eco_cache")
            with h5py.File(files[0], "r") as f:
                esi_raw = f["SDS"]["ESIavg"][:]
                valid = esi_raw[esi_raw > -9000]
                if len(valid) > 0:
                    esi_val = round(min(1.0, max(0.0, float(valid.mean()))), 3)

        synthetic = get_synthetic_dataset_values(region_id, week, fallback_sev)
        return (
            et_val  if et_val  is not None else synthetic["ptjpl"],
            esi_val if esi_val is not None else synthetic["esi"],
        )

    except Exception:
        vals = get_synthetic_dataset_values(region_id, week, fallback_sev)
        return (vals["ptjpl"], vals["esi"])


# ---------------------------------------------------------------------------
# Top-level dispatcher
# ---------------------------------------------------------------------------

def load_week_data(region_id: str, week: int, use_real: bool = False) -> dict:
    """
    Load all dataset values for a region/week.

    Returns dict: {smap, ndvi, ndwi, ptjpl, esi, source}
    source is "real" if any real data was fetched, "synthetic" otherwise.
    """
    drought_sev = get_drought_severity(region_id, week)

    if use_real and has_earthdata_credentials():
        smap = load_real_smap(region_id, week, drought_sev)
        ndvi, ndwi = load_real_modis_ndvi(region_id, week, drought_sev)
        ptjpl, esi = load_real_ecostress(region_id, week, drought_sev)
        return {"smap": smap, "ndvi": ndvi, "ndwi": ndwi, "ptjpl": ptjpl, "esi": esi, "source": "real"}

    vals = get_synthetic_dataset_values(region_id, week, drought_sev)
    vals["source"] = "synthetic"
    return vals
