# SoilSentinel — System Architecture

## Onboard Processing Pipeline

```
                ┌─────────────────────────────────────────────────────────────┐
                │              UNIBAP SPACECLOUD iX5-106                      │
                │          Heterogeneous COTS Processing Platform              │
                │                                                             │
  Multispectral │                                                             │
  + thermal     │  ┌──────────────────────────────────────────────────────┐  │
  sensor data ──┼─►│  FPGA  (Microsemi SmartFusion2)   ~1W  always-on    │  │
                │  │  · Cloud masking — discards cloudy frames            │  │
                │  │  · Sensor interface management                       │  │
                │  │  · Pre-processing before ML pipeline                 │  │
                │  └──────────────────────┬───────────────────────────────┘  │
                │                         │ clean frames only                │
                │                         ▼                                  │
                │  ┌──────────────────────────────────────────────────────┐  │
                │  │  Myriad X VPU  (Intel)            ~2W  always-on    │  │
                │  │  · NDVI/NDWI computation from multispectral bands    │  │
                │  │  · Anomaly detection vs SMAP L4 rolling baseline     │  │
                │  │  · Anomaly score = (baseline - current) / baseline   │  │
                │  │  · Threshold > 0.25 → GPU wakeup signal             │  │
                │  └──────────────────────┬───────────────────────────────┘  │
                │                         │ anomaly flag                     │
                │                         ▼                                  │
                │  ┌──────────────────────────────────────────────────────┐  │
                │  │  AMD GPU                         ~15W  on-alert only │  │
                │  │  · Simplified PT-JPL ET model confirmation           │  │
                │  │  · ET deficit = 1 - (actual / reference)            │  │
                │  │  · ESI evaporative stress index fusion               │  │
                │  │  · Multi-source severity scoring (0–5 scale)        │  │
                │  │  · Drought anomaly map generation                    │  │
                │  └──────────────────────┬───────────────────────────────┘  │
                │                         │ severity map                     │
                │                         ▼                                  │
                │  ┌──────────────────────────────────────────────────────┐  │
                │  │  AMD CPU                          ~5W  always-on    │  │
                │  │  · Adaptive scheduling logic                         │  │
                │  │  · Decision: re-task pointing / downlink / survey    │  │
                │  │  · Trend computation (2-week delta)                  │  │
                │  │  · Confidence weighting (multi-source fusion)        │  │
                │  │  · GeoJSON + alert metadata packet assembly          │  │
                │  └──────────────────────┬───────────────────────────────┘  │
                │                         │                                  │
                └─────────────────────────┼───────────────────────────────────┘
                                          │
                          ┌───────────────▼────────────────┐
                          │   GeoJSON FeatureCollection     │
                          │   ~10 MB/pass (vs 500 MB raw)  │
                          │   · Severity score (0–5)       │
                          │   · Drought level (D1–D4)      │
                          │   · Trend indicator            │
                          │   · Confidence level           │
                          │   · Timestamp + sensor sources │
                          │   + ~10 KB alert metadata pkt  │
                          └───────────────────────────────-┘
                                          │
                          Store-and-forward relay to ground
```

---

## Data Flow (Step by Step)

1. **Sensor acquisition** — multispectral + thermal imaging at orbit overpass.
2. **FPGA cloud masking** — SmartFusion2 rejects frames with >30% cloud cover before they reach the ML pipeline. This alone eliminates ~15% of frames, reducing unnecessary downstream compute.
3. **VPU always-on loop** — Myriad X VPU runs NDVI and NDWI band-ratio computation from multispectral bands at ~2W incremental cost. Checks current readings against a rolling SMAP L4 soil moisture baseline stored on the 240 GB onboard SSD. If the anomaly score exceeds 0.25, it raises a GPU wakeup flag.
4. **GPU alert confirmation** — AMD GPU activates only on anomaly flag (~15W burst). Runs simplified PT-JPL evapotranspiration model to compute ET deficit, fuses with ECOSTRESS ESI, and generates a weighted multi-source severity score (0–5). If severity clears the D1 watch threshold (0.6/5), a drought alert is confirmed.
5. **CPU downlink decision** — CPU assembles the GeoJSON map, computes trend direction (2-period delta) and multi-source confidence, then decides whether to re-task instrument pointing, prioritize store-and-forward relay, or return to survey scan mode.
6. **Downlink** — Processed GeoJSON (~10 MB/pass, ~10 KB alert packets) is transmitted via store-and-forward. Raw imagery (~500 MB/pass) is discarded onboard.

---

## Power Budget

| Mode          | FPGA  | VPU  | GPU   | CPU  | Total  |
|---------------|-------|------|-------|------|--------|
| Survey (idle) | ~1W   | ~2W  | off   | ~5W  | **~8W** |
| Alert (active)| ~1W   | ~2W  | ~15W  | ~5W  | **~23W** |

> Platform TRL: 9 (Unibap SpaceCloud iX5-106, flight-proven)

---

## NASA Dataset Integration

| Dataset | Product | Resolution | Cadence | Usage |
|---------|---------|-----------|---------|-------|
| SMAP L4 | SPL4SMGP | 9 km | 3-hourly | Rolling soil moisture baseline on SSD; VPU anomaly detection |
| MODIS/VIIRS | MOD13Q1 | 250 m | 16-day | NDVI/NDWI band-ratio in VPU always-on loop |
| ECOSTRESS PT-JPL | ECO3ETPTJPL | 70 m | scene | ET confirmation in GPU alert mode |
| ECOSTRESS ESI | ECO4ESIALEXI | 70 m | scene | Flash drought early warning via actual/reference ET ratio |

---

## Severity Classification

| Level | Score (0–5) | USDM | Drought curve sev. | Lead days |
|-------|-------------|------|-------------------|-----------|
| D1 Watch    | 0.6–1.1  | D1 | ≥ 0.12 | +5d  |
| D2 Moderate | 1.1–2.25 | D2 | ≥ 0.22 | +9d  |
| D3 Severe   | 2.25–3.5 | D3 | ≥ 0.45 | +14d |
| D4 Critical | ≥ 3.5   | D4 | ≥ 0.70 | +18d |

Lead days represent detection advantage over traditional 3–7 day ground-based assessment.

