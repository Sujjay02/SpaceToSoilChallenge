# SoilSentinel

**Adaptive flash drought early warning via onboard satellite processing**

NASA ESTO Space to Soil 2026 competition entry — heterogeneous COTS platform category.

**Live demo:** [spacechallenge.vercel.app](https://spacechallenge.vercel.app/)

---

## Overview

SoilSentinel is an onboard adaptive processing system for satellite-based drought early warning. By fusing four NASA datasets — SMAP L4 soil moisture, MODIS/VIIRS NDVI/NDWI vegetation indices, ECOSTRESS PT-JPL evapotranspiration, and ECOSTRESS ESI evaporative stress — the system detects flash drought onset 5–18 days before traditional ground-based assessment methods.

The key technical result is a **98% reduction in downlink bandwidth**: raw imagery at ~500 MB/pass is processed onboard to compact GeoJSON drought anomaly maps at ~10 MB/pass, with ~10 KB alert metadata packets for immediate store-and-forward relay to water authorities, agricultural cooperatives, and crop insurers.

The pipeline is validated against the 2012 U.S. Midwest drought — one of the most severe on record — simulating 15 states across a 20-week progression (May 7 – September 11, 2012).

---

## Architecture

```
                ┌──────────────────────────────────────────────────┐
                │        UNIBAP SPACECLOUD iX5-106  (TRL 9)        │
                │                                                  │
  Sensor data ─►│  FPGA (SmartFusion2)   ~1W  always-on           │
                │  Cloud masking + sensor I/O                      │
                │           │ clean frames                         │
                │           ▼                                      │
                │  Myriad X VPU          ~2W  always-on           │
                │  NDVI/NDWI + SMAP anomaly detection              │
                │  anomaly_score = (baseline − current) / baseline │
                │           │ flag if score > 0.25                 │
                │           ▼                                      │
                │  AMD GPU               ~15W  on-alert only       │
                │  PT-JPL ET deficit + ESI + severity map (0–5)   │
                │           │ severity map                         │
                │           ▼                                      │
                │  CPU                   ~5W  always-on           │
                │  Trend · confidence · scheduling · GeoJSON       │
                └──────────────┬───────────────────────────────────┘
                               │
                   GeoJSON FeatureCollection
                   ~10 MB/pass  ·  ~10 KB alert packet
                   severity · trend · confidence · timestamp
```

**Power budget:** ~8W survey mode / ~23W alert mode (GPU activates only on anomaly flag)

---

## NASA Datasets

| ID | Product | Description | DOI | Processed by |
|----|---------|-------------|-----|-------------|
| SMAP L4 | SPL4SMGP | Volumetric soil moisture (m³/m³), 9 km | [10.5067/LWJ6TF5SZRG3](https://doi.org/10.5067/LWJ6TF5SZRG3) | VPU |
| NDVI/NDWI | MOD13Q1 | Vegetation & water indices, 250 m | [10.5067/MODIS/MOD13Q1.061](https://doi.org/10.5067/MODIS/MOD13Q1.061) | VPU |
| PT-JPL ET | ECO3ETPTJPL | Evapotranspiration (W/m²), 70 m | [10.5067/ECOSTRESS/ECO3ETPTJPL.001](https://doi.org/10.5067/ECOSTRESS/ECO3ETPTJPL.001) | GPU |
| ESI L4 | ECO4ESIALEXI | Evaporative Stress Index (actual/ref ET), 70 m | [10.5067/ECOSTRESS/ECO4ESIALEXI.001](https://doi.org/10.5067/ECOSTRESS/ECO4ESIALEXI.001) | GPU |

---

## Hardware Pipeline

| Component | Role | Power | Mode |
|-----------|------|-------|------|
| FPGA (Microsemi SmartFusion2) | Cloud masking, sensor I/O | ~1W | Always-on |
| Myriad X VPU (Intel) | NDVI/NDWI computation, SMAP anomaly detection | ~2W | Always-on |
| AMD GPU | PT-JPL ET model, ESI fusion, severity mapping | ~15W | On-alert only |
| AMD CPU | Adaptive scheduling, trend/confidence, downlink | ~5W | Always-on |

---

## Output Format

Each orbit pass produces a GeoJSON FeatureCollection — not raw imagery:

```json
{
  "type": "FeatureCollection",
  "metadata": {
    "week": 8,
    "date": "2012-07-02",
    "scenario": "2012_midwest_drought",
    "alert_count": 12,
    "raw_mb_per_pass": 500,
    "processed_mb_per_pass": 9.6,
    "bandwidth_reduction_pct": 98.1,
    "packet_size_kb": 98.3
  },
  "features": [{
    "type": "Feature",
    "geometry": { "type": "Polygon", "coordinates": [[[-102.05, 36.99], ...]] },
    "properties": {
      "region":         "KS",
      "name":           "Kansas",
      "severity":       3.82,
      "severity_level": "D4",
      "trend":          "worsening",
      "confidence":     0.89,
      "timestamp":      "2012-07-02T00:00:00Z",
      "sensor_sources": ["smap", "ndvi", "ndwi", "ptjpl", "esi"],
      "lead_days":      18,
      "smap_sm":        0.14,
      "ndvi":           0.28,
      "ndwi":           -0.18,
      "et_deficit":     0.67,
      "esi":            0.21
    }
  }]
}
```

**Severity scale:** 0–5 continuous, classified as D1 Watch / D2 Moderate / D3 Severe / D4 Critical (USDM-aligned)

---

## Repository Structure

```
SpaceToSoilChallenge/
├── README.md
├── .gitignore
├── dashboard/
│   └── soilSentinel.jsx        Source component (canonical design file)
├── dashboard-app/              Deployed Vite + React application
│   ├── src/
│   │   ├── App.jsx             Full dashboard with Dashboard / Background / About tabs
│   │   ├── main.jsx
│   │   └── index.css
│   ├── package.json
│   └── vite.config.js
├── pipeline/
│   ├── data_loaders.py         NASA Earthdata access + synthetic simulation
│   ├── pipeline.py             3-tier onboard detection logic + CLI
│   └── output.py               GeoJSON output, WGS84 polygons, reporting
└── docs/
    └── architecture.md         System architecture reference
```

---

## Quick Start

### Dashboard (local)

```bash
cd dashboard-app
npm install
npm run dev
# Open http://localhost:5173
```

The dashboard has three tabs:
- **Dashboard** — interactive 20-week drought simulation with playback, severity map, per-region dataset readings, hardware pipeline status, and downlink efficiency metrics
- **Background** — the science: why the 2012 drought matters, how each dataset works, and the rationale for on-orbit edge processing
- **About** — NASA ESTO challenge context, key innovations, and dataset citations

### Deploy to Vercel

```bash
cd dashboard-app
vercel deploy --prod
```

### Python Pipeline

No credentials required for demo mode — runs on Python 3.10+ standard library only:

```bash
# Full 20-week simulation (all regions, all weeks)
python pipeline/pipeline.py --demo

# Single week detail with full alert table
python pipeline/pipeline.py --week 8

# All weeks with full per-week tables
python pipeline/pipeline.py --all-weeks --output-dir results/
```

With real NASA Earthdata credentials (register free at [urs.earthdata.nasa.gov](https://urs.earthdata.nasa.gov/)):

```bash
export EARTHDATA_USER=your_username
export EARTHDATA_PASS=your_password
python pipeline/pipeline.py --week 8 --real-data
```

Optional dependencies for real data mode:

```bash
pip install earthaccess>=0.9.0 netCDF4>=1.6.0 h5py>=3.9.0 numpy>=1.24.0
```

---

## Detection Performance (2012 Midwest Drought Simulation)

| Week | Date | Alerts | D4 | D3 | Bandwidth Saved |
|------|------|--------|----|----|----------------|
| 1 | May 7, 2012 | 2 | 0 | 0 | 99.7% |
| 5 | Jun 4, 2012 | 7 | 1 | 2 | 98.9% |
| 9 | Jul 2, 2012 | 12 | 4 | 4 | 98.1% |
| 14 | Aug 6, 2012 | 14 | 7 | 4 | 97.8% |
| 20 | Sep 16, 2012 | 15 | 9 | 4 | 97.6% |

Average early detection advantage: **5–18 days** before traditional 3–7 day ground-based assessment methods.

---

## Competition Context

- **Challenge:** NASA ESTO Space to Soil 2026
- **Category:** Hybrid — Software on heterogeneous COTS platform
- **Scenario:** 2012 U.S. Midwest drought (15 states, 20 weeks)
- **Platform:** Unibap SpaceCloud iX5-106 (TRL 9)
- **Target users:** Water resource authorities, agricultural cooperatives, crop insurers

---

*For architecture details see [docs/architecture.md](docs/architecture.md)*
