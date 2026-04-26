# SoilSentinel — 2012 U.S. Midwest Drought Detection Results

20-week simulation, May 7 – Sept 17, 2012.
Reproduced by running `python pipeline/pipeline.py --demo`.

## Detection table

| Week | Date        | Alerts | D4  | D3  | D2  | D1  | Bandwidth saved |
|------|-------------|-------:|----:|----:|----:|----:|----------------:|
| 1    | 2012-05-07  | 0      | 0   | 0   | 0   | 0   | 99.8%           |
| 2    | 2012-05-14  | 0      | 0   | 0   | 0   | 0   | 99.8%           |
| 3    | 2012-05-21  | 1      | 0   | 0   | 0   | 1   | 99.8%           |
| 4    | 2012-05-28  | 2      | 0   | 0   | 1   | 1   | 99.7%           |
| 5    | 2012-06-04  | 3      | 0   | 0   | 1   | 2   | 99.5%           |
| 6    | 2012-06-11  | 6      | 0   | 1   | 2   | 3   | 99.0%           |
| 7    | 2012-06-18  | 7      | 0   | 1   | 5   | 1   | 98.9%           |
| 8    | 2012-06-25  | 9      | 0   | 3   | 4   | 2   | 98.6%           |
| **9**| **2012-07-02** | **10** | **1** | **4** | **3** | **2** | **98.4%** |
| 10   | 2012-07-09  | 11     | 2   | 5   | 3   | 1   | 98.2%           |
| 11   | 2012-07-16  | 12     | 3   | 5   | 3   | 1   | 98.1%           |
| 12   | 2012-07-23  | 12     | 4   | 4   | 4   | 0   | 98.1%           |
| 13   | 2012-07-30  | 13     | 7   | 2   | 3   | 1   | 97.9%           |
| 14   | 2012-08-06  | 15     | 8   | 3   | 1   | 3   | 97.6%           |
| 15   | 2012-08-13  | 15     | 9   | 2   | 3   | 1   | 97.6%           |
| 16   | 2012-08-20  | 15     | 9   | 2   | 4   | 0   | 97.6%           |
| 17   | 2012-08-27  | 15     | 10  | 2   | 3   | 0   | 97.6%           |
| 18   | 2012-09-03  | 15     | 11  | 1   | 3   | 0   | 97.6%           |
| 19   | 2012-09-10  | 15     | 11  | 2   | 2   | 0   | 97.6%           |
| 20   | 2012-09-17  | 15     | 11  | 3   | 1   | 0   | 97.6%           |

Row 9 (bold) = peak early-detection window. All 15 target states reached D1+ by week 14.

## Week 9 detail (peak window, Jul 2 2012)

| Region       | Level | Severity/5 | Trend      | Confidence | Lead days |
|--------------|-------|-----------|------------|------------|-----------|
| Kansas       | D4    | 3.71      | worsening  | 98%        | +18d      |
| Nebraska     | D3    | 3.25      | worsening  | 98%        | +18d      |
| Oklahoma     | D3    | 2.89      | worsening  | 98%        | +18d      |
| Colorado     | D3    | 2.31      | worsening  | 98%        | +18d      |
| Texas        | D3    | 2.27      | worsening  | 98%        | +14d      |
| Iowa         | D2    | 2.02      | worsening  | 98%        | +18d      |
| Missouri     | D2    | 1.88      | worsening  | 98%        | +14d      |
| South Dakota | D2    | 1.34      | worsening  | 92%        | +14d      |
| Arkansas     | D1    | 1.03      | worsening  | 92%        | +9d       |
| Illinois     | D1    | 0.64      | worsening  | 92%        | +9d       |

Processed GeoJSON for this week: [`examples/soilsentinel_week09_2012-07-02.geojson`](examples/soilsentinel_week09_2012-07-02.geojson)

## Bandwidth

Each orbital pass produces ~500 MB of raw multispectral + thermal imagery.
The onboard pipeline transmits only the processed GeoJSON and alert packet:

| Pass state  | Data volume      | Note                        |
|-------------|------------------|-----------------------------|
| Raw imagery | ~500 MB          | discarded onboard           |
| GeoJSON map | ~8–12 MB         | per-region severity polygons |
| Alert packet| ~10 KB per alert | priority downlink           |
| **Reduction**| **97.6–99.8%**  | across the 20-week window   |

## Orbital timing

The full 20-week simulation (all 15 regions, all tiers) runs in **< 0.2 s** on
a laptop CPU. Onboard execution on the Unibap SpaceCloud iX5-106 is bounded by
sensor acquisition cadence, not compute. A single orbital pass (≈ 90 min) is
orders of magnitude longer than the pipeline runtime.
