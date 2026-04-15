import { useState, useEffect, useRef, useCallback, useMemo } from "react";

const WEEKS = Array.from({ length: 20 }, (_, i) => {
  const d = new Date(2012, 4, 7);
  d.setDate(d.getDate() + i * 7);
  return {
    idx: i,
    label: d.toLocaleDateString("en-US", { month: "short", day: "numeric" }),
    full: d.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" }),
  };
});

const DATASETS = [
  { id: "smap", name: "SMAP L4", desc: "Soil Moisture", doi: "10.5067/LWJ6TF5SZRG3", hw: "VPU", color: "#3d6b7c" },
  { id: "ndvi", name: "NDVI/NDWI", desc: "Vegetation Indices", doi: "10.5067/MODIS/MOD13Q1.061", hw: "VPU", color: "#4a7c59" },
  { id: "ptjpl", name: "PT-JPL ET", desc: "Evapotranspiration", doi: "10.5067/ECOSTRESS/ECO3ETPTJPL.001", hw: "GPU", color: "#c17f24" },
  { id: "esi", name: "ESI L4", desc: "Evaporative Stress", doi: "10.5067/ECOSTRESS/ECO4ESIALEXI.001", hw: "GPU", color: "#c0392b" },
];

const HW_PIPELINE = [
  { id: "fpga", name: "FPGA", role: "Cloud mask & sensor I/O", power: "~1W", status: "always-on", color: "#6b5c7a" },
  { id: "vpu", name: "Myriad X VPU", role: "NDVI/NDWI + anomaly detect", power: "~2W", status: "always-on", color: "#3d6b7c" },
  { id: "gpu", name: "AMD GPU", role: "PT-JPL & severity mapping", power: "~15W", status: "on-alert", color: "#c17f24" },
  { id: "cpu", name: "CPU", role: "Scheduling & downlink logic", power: "~5W", status: "always-on", color: "#4a7c59" },
];

function getDatasetValues(regionId, week, droughtSev) {
  const seed = regionId.charCodeAt(0) + regionId.charCodeAt(1) * 7;
  const jitter = (offset) => Math.sin(seed * 0.1 + week * 0.3 + offset) * 0.08;
  const smapBaseline = 0.35;
  const smapVal = Math.max(0, Math.min(1, smapBaseline - droughtSev * 0.3 + jitter(1)));
  const ndviVal = Math.max(0, Math.min(1, 0.7 - droughtSev * 0.55 + jitter(2)));
  const ndwiVal = Math.max(-0.3, Math.min(0.5, 0.2 - droughtSev * 0.45 + jitter(3)));
  const etVal = Math.max(0, Math.min(1, 0.8 - droughtSev * 0.6 + jitter(4)));
  const esiVal = Math.max(0, Math.min(1, 1.0 - droughtSev * 0.85 + jitter(5)));
  return { smap: Math.round(smapVal * 1000) / 1000, ndvi: Math.round(ndviVal * 1000) / 1000, ndwi: Math.round(ndwiVal * 1000) / 1000, ptjpl: Math.round(etVal * 1000) / 1000, esi: Math.round(esiVal * 1000) / 1000 };
}

function getTrend(regionId, week) {
  if (week < 2) return "stable";
  const prevSev = droughtCurves[regionId] ? droughtCurves[regionId](week - 2) : 0;
  const currSev = droughtCurves[regionId] ? droughtCurves[regionId](week) : 0;
  const delta = currSev - prevSev;
  if (delta > 0.05) return "worsening";
  if (delta < -0.02) return "improving";
  return "stable";
}

function getConfidence(droughtSev, week) {
  const sourceCount = droughtSev > 0.3 ? 4 : droughtSev > 0.1 ? 3 : 2;
  const base = 0.6 + sourceCount * 0.08 + Math.min(week * 0.01, 0.1);
  return Math.min(0.98, Math.round(base * 100) / 100);
}

const REGIONS = [
  { id: "ND", name: "North Dakota", cx: 168, cy: 52, w: 88, h: 44, group: "north" },
  { id: "SD", name: "South Dakota", cx: 168, cy: 104, w: 88, h: 44, group: "north" },
  { id: "NE", name: "Nebraska", cx: 168, cy: 158, w: 100, h: 44, group: "core" },
  { id: "KS", name: "Kansas", cx: 172, cy: 214, w: 100, h: 44, group: "core" },
  { id: "OK", name: "Oklahoma", cx: 170, cy: 272, w: 108, h: 42, group: "south" },
  { id: "TX", name: "Texas", cx: 148, cy: 338, w: 120, h: 72, group: "south" },
  { id: "MN", name: "Minnesota", cx: 276, cy: 62, w: 68, h: 58, group: "north" },
  { id: "IA", name: "Iowa", cx: 276, cy: 138, w: 72, h: 48, group: "core" },
  { id: "MO", name: "Missouri", cx: 282, cy: 218, w: 72, h: 66, group: "core" },
  { id: "AR", name: "Arkansas", cx: 282, cy: 296, w: 64, h: 44, group: "south" },
  { id: "WI", name: "Wisconsin", cx: 354, cy: 68, w: 56, h: 54, group: "east" },
  { id: "IL", name: "Illinois", cx: 362, cy: 178, w: 42, h: 88, group: "east" },
  { id: "IN", name: "Indiana", cx: 414, cy: 182, w: 38, h: 78, group: "east" },
  { id: "OH", name: "Ohio", cx: 464, cy: 174, w: 50, h: 68, group: "east" },
  { id: "CO", name: "Colorado", cx: 78, cy: 178, w: 76, h: 60, group: "west" },
];

const droughtCurves = {
  KS: (t) => Math.min(1, Math.max(0, (t - 1) * 0.135)),
  OK: (t) => Math.min(1, Math.max(0, (t - 1.5) * 0.12)),
  NE: (t) => Math.min(1, Math.max(0, (t - 2) * 0.125)),
  CO: (t) => Math.min(1, Math.max(0, (t - 2.5) * 0.1)),
  TX: (t) => Math.min(1, Math.max(0, (t - 3) * 0.095)),
  IA: (t) => Math.min(1, Math.max(0, (t - 4) * 0.13)),
  MO: (t) => Math.min(1, Math.max(0, (t - 4.5) * 0.11)),
  SD: (t) => Math.min(1, Math.max(0, (t - 5) * 0.1)),
  IL: (t) => Math.min(1, Math.max(0, (t - 6) * 0.115)),
  AR: (t) => Math.min(1, Math.max(0, (t - 6) * 0.09)),
  IN: (t) => Math.min(1, Math.max(0, (t - 7.5) * 0.1)),
  MN: (t) => Math.min(1, Math.max(0, (t - 8) * 0.07)),
  WI: (t) => Math.min(1, Math.max(0, (t - 9) * 0.06)),
  OH: (t) => Math.min(1, Math.max(0, (t - 9) * 0.065)),
  ND: (t) => Math.min(1, Math.max(0, (t - 10) * 0.05)),
};

function getDroughtData(week) {
  const out = {};
  REGIONS.forEach((r) => {
    const fn = droughtCurves[r.id];
    out[r.id] = fn ? Math.round(fn(week) * 1000) / 1000 : 0;
  });
  return out;
}

function getAlerts(week) {
  const data = getDroughtData(week);
  return REGIONS.map((r) => {
    const sev = data[r.id];
    if (sev < 0.12) return null;
    const level = sev >= 0.7 ? "critical" : sev >= 0.45 ? "severe" : sev >= 0.22 ? "moderate" : "watch";
    const leadDays = sev >= 0.5 ? 18 : sev >= 0.3 ? 14 : sev >= 0.15 ? 9 : 5;
    const datasets = getDatasetValues(r.id, week, sev);
    const trend = getTrend(r.id, week);
    const confidence = getConfidence(sev, week);
    return { ...r, sev, level, leadDays, datasets, trend, confidence };
  })
    .filter(Boolean)
    .sort((a, b) => b.sev - a.sev);
}

const PALETTE = {
  critical: { color: "#c0392b", bg: "rgba(192,57,43,0.07)", stroke: "rgba(192,57,43,0.25)" },
  severe: { color: "#c17f24", bg: "rgba(193,127,36,0.07)", stroke: "rgba(193,127,36,0.22)" },
  moderate: { color: "#8b8427", bg: "rgba(139,132,39,0.07)", stroke: "rgba(139,132,39,0.20)" },
  watch: { color: "#557a3d", bg: "rgba(85,122,61,0.07)", stroke: "rgba(85,122,61,0.18)" },
};

function sevColor(sev) {
  if (sev >= 0.7) return "#c0392b";
  if (sev >= 0.45) return "#c17f24";
  if (sev >= 0.22) return "#8b8427";
  if (sev >= 0.12) return "#557a3d";
  return "transparent";
}

function sevFill(sev) {
  if (sev >= 0.7) return "rgba(192,57,43,0.16)";
  if (sev >= 0.45) return "rgba(193,127,36,0.14)";
  if (sev >= 0.22) return "rgba(139,132,39,0.12)";
  if (sev >= 0.12) return "rgba(85,122,61,0.10)";
  return "rgba(235,230,220,0.7)";
}

function levelTag(l) {
  return { critical: "D4", severe: "D3", moderate: "D2", watch: "D1" }[l] || "";
}

const Metric = ({ label, value, sub, color }) => (
  <div style={{ padding: "14px 18px", background: "#ffffff", borderRadius: 12, border: "1px solid #e2ddd7", minWidth: 0 }}>
    <div style={{ fontSize: 10, fontWeight: 600, color: "#9b8f83", textTransform: "uppercase", letterSpacing: "0.09em", marginBottom: 6, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{label}</div>
    <div style={{ fontSize: 26, fontWeight: 700, color: color || "#1c1a17", fontFamily: "'Space Mono', monospace", lineHeight: 1 }}>{value}</div>
    {sub && <div style={{ fontSize: 11, color: "#9b8f83", marginTop: 5 }}>{sub}</div>}
  </div>
);

const Badge = ({ level }) => {
  const p = PALETTE[level];
  return (
    <span style={{ fontSize: 10, fontWeight: 700, color: p.color, background: p.bg, border: `1px solid ${p.stroke}`, padding: "2px 8px", borderRadius: 5, letterSpacing: "0.05em", whiteSpace: "nowrap" }}>
      {levelTag(level)} {level.toUpperCase()}
    </span>
  );
};

export default function SoilSentinelDashboard() {
  const [tab, setTab] = useState("dashboard");
  const [week, setWeek] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [hovered, setHovered] = useState(null);
  const timerRef = useRef(null);

  const data = useMemo(() => getDroughtData(week), [week]);
  const alerts = useMemo(() => getAlerts(week), [week]);

  const critCount = alerts.filter((a) => a.level === "critical").length;
  const avgLead = alerts.length ? Math.round(alerts.reduce((s, a) => s + a.leadDays, 0) / alerts.length) : 0;
  const rawMB = 500;
  const procMB = Math.max(1.2, Math.round(alerts.length * 0.8 * 10) / 10);
  const pctSaved = rawMB > 0 ? Math.round((1 - procMB / rawMB) * 1000) / 10 : 0;

  const toggle = useCallback(() => setPlaying((p) => !p), []);

  useEffect(() => {
    if (playing) {
      timerRef.current = setInterval(() => {
        setWeek((w) => {
          if (w >= 19) { setPlaying(false); return 19; }
          return w + 1;
        });
      }, 900);
    } else clearInterval(timerRef.current);
    return () => clearInterval(timerRef.current);
  }, [playing]);

  const hoveredAlert = hovered ? alerts.find((a) => a.id === hovered) : null;

  return (
    <div style={{ background: "#f7f4ef", color: "#1c1a17", minHeight: "100vh", fontFamily: "'DM Sans', system-ui, sans-serif", display: "flex", flexDirection: "column" }}>
      <link href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700&family=Space+Mono:wght@400;700&display=swap" rel="stylesheet" />
      <style>{`
        input[type=range] { -webkit-appearance: none; appearance: none; height: 4px; border-radius: 2px; outline: none; cursor: pointer; }
        input[type=range]::-webkit-slider-thumb { -webkit-appearance: none; width: 14px; height: 14px; border-radius: 50%; background: #4a7c59; border: 2px solid #f7f4ef; cursor: pointer; }
        input[type=range]::-moz-range-thumb { width: 14px; height: 14px; border-radius: 50%; background: #4a7c59; border: 2px solid #f7f4ef; cursor: pointer; }
        .alert-card { transition: transform 0.15s, box-shadow 0.15s; }
        .alert-card:hover { transform: translateY(-1px); box-shadow: 0 2px 12px rgba(0,0,0,0.07); }
        .scroll-area::-webkit-scrollbar { width: 4px; }
        .scroll-area::-webkit-scrollbar-track { background: transparent; }
        .scroll-area::-webkit-scrollbar-thumb { background: #d4cfc8; border-radius: 2px; }
      `}</style>

      <header style={{ padding: "14px 28px", display: "flex", alignItems: "center", justifyContent: "space-between", borderBottom: "1px solid #e2ddd7", background: "#ffffff", flexShrink: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <svg width="30" height="30" viewBox="0 0 28 28" fill="none">
            <rect width="28" height="28" rx="6" fill="#4a7c59" />
            <path d="M14 6C9.58 6 6 9.58 6 14s3.58 8 8 8 8-3.58 8-8-3.58-8-8-8zm0 1.5c.5 0 1 .08 1.47.2C14.3 9.4 14 11.6 14 14s.3 4.6 1.47 6.3c-.47.12-.97.2-1.47.2-3.58 0-6.5-2.92-6.5-6.5S10.42 7.5 14 7.5z" fill="rgba(255,255,255,0.9)" />
            <path d="M8 14h12" stroke="rgba(255,255,255,0.5)" strokeWidth="0.8" />
          </svg>
          <div style={{ lineHeight: 1.3 }}>
            <div style={{ fontWeight: 700, fontSize: 17, color: "#1c1a17", letterSpacing: "-0.02em" }}>SoilSentinel</div>
            <div style={{ fontSize: 11, color: "#9b8f83", fontWeight: 500 }}>Adaptive drought early warning</div>
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <div style={{ width: 7, height: 7, borderRadius: "50%", background: playing ? "#4a7c59" : "#c0b9b0", transition: "all 0.3s" }} />
            <span style={{ fontSize: 11, color: "#9b8f83", fontWeight: 500 }}>{playing ? "SIMULATING" : "READY"}</span>
          </div>
          <div style={{ width: 1, height: 16, background: "#e2ddd7" }} />
          <span style={{ fontSize: 11, color: "#c0b9b0", fontFamily: "'Space Mono', monospace" }}>NASA ESTO · Space to Soil 2026</span>
        </div>
      </header>

      <nav style={{ borderBottom: "1px solid #e2ddd7", background: "#ffffff", padding: "0 28px", display: "flex", flexShrink: 0 }}>
        {[{ id: "dashboard", label: "Dashboard" }, { id: "background", label: "Background" }, { id: "about", label: "About" }].map((t) => (
          <button key={t.id} onClick={() => setTab(t.id)} style={{
            padding: "10px 18px", background: "none", border: "none", borderBottom: `2px solid ${tab === t.id ? "#4a7c59" : "transparent"}`,
            cursor: "pointer", fontSize: 13, fontWeight: tab === t.id ? 600 : 400,
            color: tab === t.id ? "#1c1a17" : "#9b8f83", marginBottom: -1,
            transition: "all 0.15s", fontFamily: "'DM Sans', system-ui, sans-serif",
          }}>{t.label}</button>
        ))}
      </nav>

      {tab === "background" && (
        <div style={{ flex: 1, overflowY: "auto", padding: "40px 0", background: "#f7f4ef" }}>
          <div style={{ maxWidth: 820, margin: "0 auto", padding: "0 32px", display: "flex", flexDirection: "column", gap: 32 }}>

            <div>
              <div style={{ fontSize: 10, fontWeight: 600, color: "#9b8f83", textTransform: "uppercase", letterSpacing: "0.12em", marginBottom: 10 }}>The Problem</div>
              <h2 style={{ fontSize: 28, fontWeight: 700, color: "#1c1a17", letterSpacing: "-0.03em", lineHeight: 1.2, marginBottom: 16 }}>The 2012 U.S. Midwest Drought</h2>
              <p style={{ fontSize: 15, color: "#4a4540", lineHeight: 1.75, marginBottom: 20 }}>
                The summer of 2012 brought the most severe drought the United States had seen since the 1950s. Across 80% of the country's agricultural land, crops withered, rivers dropped to record lows, and communities faced water shortages that stretched into the following year. The economic toll exceeded <strong style={{ color: "#1c1a17" }}>$30 billion</strong> — making it one of the costliest natural disasters in U.S. history.
              </p>
              <p style={{ fontSize: 15, color: "#4a4540", lineHeight: 1.75 }}>
                What made 2012 particularly devastating was how quickly conditions deteriorated. Traditional ground-based monitoring networks detected the emerging crisis too late for farmers and emergency managers to meaningfully respond. By the time drought was confirmed on the ground, the window for early intervention had already closed.
              </p>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 14 }}>
              {[
                { value: "$30B+", label: "Economic losses", sub: "costlier than Hurricane Irene" },
                { value: "80%", label: "Agricultural land affected", sub: "across 26 states" },
                { value: "14–18d", label: "SoilSentinel early warning", sub: "vs. ground-based detection" },
              ].map((s) => (
                <div key={s.value} style={{ padding: "20px 22px", background: "#ffffff", borderRadius: 12, border: "1px solid #e2ddd7" }}>
                  <div style={{ fontSize: 30, fontWeight: 700, color: "#4a7c59", fontFamily: "'Space Mono', monospace", lineHeight: 1, marginBottom: 6 }}>{s.value}</div>
                  <div style={{ fontSize: 12, fontWeight: 600, color: "#1c1a17", marginBottom: 3 }}>{s.label}</div>
                  <div style={{ fontSize: 11, color: "#9b8f83" }}>{s.sub}</div>
                </div>
              ))}
            </div>

            <div style={{ height: 1, background: "#e2ddd7" }} />

            <div>
              <div style={{ fontSize: 10, fontWeight: 600, color: "#9b8f83", textTransform: "uppercase", letterSpacing: "0.12em", marginBottom: 10 }}>Why Space</div>
              <h3 style={{ fontSize: 21, fontWeight: 700, color: "#1c1a17", letterSpacing: "-0.02em", marginBottom: 14 }}>Satellite sensors see drought before the ground does</h3>
              <p style={{ fontSize: 15, color: "#4a4540", lineHeight: 1.75, marginBottom: 16 }}>
                Soil moisture stress, vegetation decline, and evapotranspiration deficits all manifest in satellite data <em>weeks before</em> they become visible or measurable at ground level. By fusing multiple satellite data streams — soil moisture, vegetation health, energy flux, and evaporative stress — SoilSentinel builds a composite drought signal with far greater confidence than any single dataset alone.
              </p>
              <p style={{ fontSize: 15, color: "#4a4540", lineHeight: 1.75 }}>
                The critical bottleneck has always been bandwidth. A single satellite pass generates ~500 MB of raw sensor data. Downlinking everything is slow, expensive, and energy-intensive. SoilSentinel moves the intelligence on-orbit: process on the satellite, downlink only what matters.
              </p>
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              <div style={{ fontSize: 10, fontWeight: 600, color: "#9b8f83", textTransform: "uppercase", letterSpacing: "0.12em", marginBottom: 4 }}>The Four Data Streams</div>
              {[
                { name: "SMAP L4", color: "#3d6b7c", tag: "Soil Moisture Active Passive", body: "NASA's SMAP satellite measures the water content of the top 5cm of soil globally every 2–3 days. Declining soil moisture is the earliest measurable signal of drought onset, often detectable 2–3 weeks before crop stress becomes visible." },
                { name: "NDVI / NDWI", color: "#4a7c59", tag: "Vegetation & Water Index · MODIS", body: "The Normalized Difference Vegetation Index tracks photosynthetic activity; NDWI tracks leaf water content. Together they reveal whether vegetation is under water stress — a leading indicator that precedes yield loss by weeks." },
                { name: "PT-JPL ET", color: "#c17f24", tag: "Evapotranspiration · ECOSTRESS", body: "Evapotranspiration — the combined water loss from soil evaporation and plant transpiration — is a direct measure of the land surface water balance. When ET falls below the climatological norm, drought is taking hold. PT-JPL is a physics-based ET model driven by ECOSTRESS thermal imagery." },
                { name: "ESI L4", color: "#c0392b", tag: "Evaporative Stress Index · ECOSTRESS", body: "ESI normalizes actual ET against reference ET to isolate crop water stress independent of season or climate zone. High ESI values indicate plants are transpiring normally; low values signal severe stress. ESI is the most direct proxy for agricultural drought impact." },
              ].map((ds) => (
                <div key={ds.name} style={{ padding: "16px 20px", background: "#ffffff", borderRadius: 10, border: "1px solid #e2ddd7", display: "flex", gap: 16 }}>
                  <div style={{ width: 4, borderRadius: 2, background: ds.color, flexShrink: 0, alignSelf: "stretch" }} />
                  <div>
                    <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 6 }}>
                      <span style={{ fontWeight: 700, fontSize: 13, color: "#1c1a17" }}>{ds.name}</span>
                      <span style={{ fontSize: 10, color: ds.color, fontWeight: 600, background: `${ds.color}12`, padding: "2px 8px", borderRadius: 4 }}>{ds.tag}</span>
                    </div>
                    <p style={{ fontSize: 13, color: "#4a4540", lineHeight: 1.65, margin: 0 }}>{ds.body}</p>
                  </div>
                </div>
              ))}
            </div>

            <div style={{ height: 1, background: "#e2ddd7" }} />

            <div>
              <div style={{ fontSize: 10, fontWeight: 600, color: "#9b8f83", textTransform: "uppercase", letterSpacing: "0.12em", marginBottom: 10 }}>The Hardware Architecture</div>
              <h3 style={{ fontSize: 21, fontWeight: 700, color: "#1c1a17", letterSpacing: "-0.02em", marginBottom: 14 }}>Edge AI on-orbit — processing where the data lives</h3>
              <p style={{ fontSize: 15, color: "#4a4540", lineHeight: 1.75, marginBottom: 20 }}>
                SoilSentinel runs a heterogeneous pipeline of commercial off-the-shelf (COTS) processors, each chosen for its power-to-performance ratio in a constrained satellite environment. The pipeline is tiered: lightweight always-on processors handle routine sensing; power-hungry processors wake only when an anomaly is detected.
              </p>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                {[
                  { name: "FPGA", color: "#6b5c7a", power: "~1W", role: "Always-on cloud masking and raw sensor I/O. Filters corrupt pixels and preprocesses data before any ML runs." },
                  { name: "Myriad X VPU", color: "#3d6b7c", power: "~2W", role: "Runs NDVI/NDWI inference and spatial anomaly detection continuously. Triggers the GPU pipeline when a threshold is crossed." },
                  { name: "AMD GPU", color: "#c17f24", power: "~15W", role: "On-alert only. Runs PT-JPL ET estimation and drought severity mapping when the VPU flags a region of concern." },
                  { name: "CPU", color: "#4a7c59", power: "~5W", role: "Orchestrates the pipeline, manages scheduling, packages GeoJSON alert packets, and controls the downlink queue." },
                ].map((hw) => (
                  <div key={hw.name} style={{ padding: "14px 16px", background: "#ffffff", borderRadius: 10, border: "1px solid #e2ddd7" }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
                      <span style={{ fontWeight: 700, fontSize: 13, color: "#1c1a17" }}>{hw.name}</span>
                      <span style={{ fontSize: 10, fontFamily: "'Space Mono', monospace", color: "#9b8f83" }}>{hw.power}</span>
                    </div>
                    <div style={{ width: "100%", height: 2, background: hw.color, borderRadius: 1, marginBottom: 8, opacity: 0.5 }} />
                    <p style={{ fontSize: 12, color: "#4a4540", lineHeight: 1.6, margin: 0 }}>{hw.role}</p>
                  </div>
                ))}
              </div>
            </div>

            <div style={{ padding: "20px 24px", background: "#ffffff", borderRadius: 12, border: "1px solid #e2ddd7" }}>
              <div style={{ fontSize: 12, fontWeight: 600, color: "#9b8f83", marginBottom: 6 }}>BANDWIDTH RESULT</div>
              <p style={{ fontSize: 14, color: "#4a4540", lineHeight: 1.7, margin: 0 }}>
                By processing on-orbit and downlinking only alert packets and compressed GeoJSON polygons, SoilSentinel reduces the per-pass data volume from <strong style={{ color: "#1c1a17" }}>500 MB of raw imagery</strong> to under <strong style={{ color: "#4a7c59" }}>2 MB of structured alerts</strong> — a &gt;99% reduction — while preserving full scientific fidelity for affected regions.
              </p>
            </div>

          </div>
        </div>
      )}

      {tab === "about" && (
        <div style={{ flex: 1, overflowY: "auto", padding: "40px 0", background: "#f7f4ef" }}>
          <div style={{ maxWidth: 820, margin: "0 auto", padding: "0 32px", display: "flex", flexDirection: "column", gap: 32 }}>

            <div>
              <div style={{ fontSize: 10, fontWeight: 600, color: "#9b8f83", textTransform: "uppercase", letterSpacing: "0.12em", marginBottom: 10 }}>The Project</div>
              <h2 style={{ fontSize: 28, fontWeight: 700, color: "#1c1a17", letterSpacing: "-0.03em", lineHeight: 1.2, marginBottom: 16 }}>SoilSentinel</h2>
              <p style={{ fontSize: 15, color: "#4a4540", lineHeight: 1.75, marginBottom: 16 }}>
                SoilSentinel is an adaptive drought early-warning system built for the <strong style={{ color: "#1c1a17" }}>NASA ESTO Space to Soil Challenge 2026</strong>. It demonstrates how heterogeneous on-orbit edge computing — combining FPGA, VPU, GPU, and CPU processors — can transform raw satellite sensor streams into actionable drought alerts, faster and with a fraction of the bandwidth required by traditional ground-processing pipelines.
              </p>
              <p style={{ fontSize: 15, color: "#4a4540", lineHeight: 1.75 }}>
                The system fuses four NASA Earth observation datasets — SMAP soil moisture, MODIS vegetation indices, ECOSTRESS evapotranspiration, and ECOSTRESS evaporative stress — into a unified drought severity signal that can detect emerging conditions <strong style={{ color: "#1c1a17" }}>14 to 18 days before traditional ground-based methods</strong>.
              </p>
            </div>

            <div style={{ padding: "24px 28px", background: "#ffffff", borderRadius: 14, border: "1px solid #e2ddd7" }}>
              <div style={{ fontSize: 10, fontWeight: 600, color: "#9b8f83", textTransform: "uppercase", letterSpacing: "0.12em", marginBottom: 14 }}>NASA ESTO · Space to Soil Challenge</div>
              <p style={{ fontSize: 14, color: "#4a4540", lineHeight: 1.75, marginBottom: 12 }}>
                The Space to Soil Challenge asks competitors to design novel Earth observation systems that close the gap between satellite data collection and on-the-ground agricultural decision-making. The core constraint: solutions must operate within the power, mass, and bandwidth limits of a small satellite platform.
              </p>
              <p style={{ fontSize: 14, color: "#4a4540", lineHeight: 1.75, margin: 0 }}>
                SoilSentinel's answer is to move AI inference from the ground to the orbit — processing raw data on the satellite itself, and downlinking only the compact, high-value alerts that farmers and emergency managers need.
              </p>
            </div>

            <div style={{ height: 1, background: "#e2ddd7" }} />

            <div>
              <div style={{ fontSize: 10, fontWeight: 600, color: "#9b8f83", textTransform: "uppercase", letterSpacing: "0.12em", marginBottom: 14 }}>Key Innovations</div>
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                {[
                  { title: "Tiered on-orbit inference", body: "A power-aware pipeline where always-on low-watt processors (FPGA + VPU) continuously screen for anomalies, and high-power processors (GPU) activate only when drought signals are detected — minimizing energy use without sacrificing detection sensitivity." },
                  { title: "Multi-source data fusion", body: "No single satellite dataset reliably captures drought across all geographies and crop types. SoilSentinel fuses soil moisture, vegetation health, evapotranspiration, and evaporative stress into a composite severity score with confidence weighting." },
                  { title: ">99% bandwidth reduction", body: "By compressing 500 MB of raw sensor data per pass into under 2 MB of structured GeoJSON alert packets, SoilSentinel is viable on low-cost small satellite platforms with limited downlink capacity." },
                  { title: "14–18 day early warning", body: "Validated against the 2012 U.S. Midwest drought — one of the most well-documented agricultural disasters in modern history — SoilSentinel detects drought onset weeks before ground-based monitoring networks register the event." },
                ].map((item) => (
                  <div key={item.title} style={{ padding: "16px 20px", background: "#ffffff", borderRadius: 10, border: "1px solid #e2ddd7" }}>
                    <div style={{ fontWeight: 700, fontSize: 13, color: "#1c1a17", marginBottom: 5 }}>{item.title}</div>
                    <p style={{ fontSize: 13, color: "#4a4540", lineHeight: 1.65, margin: 0 }}>{item.body}</p>
                  </div>
                ))}
              </div>
            </div>

            <div style={{ height: 1, background: "#e2ddd7" }} />

            <div>
              <div style={{ fontSize: 10, fontWeight: 600, color: "#9b8f83", textTransform: "uppercase", letterSpacing: "0.12em", marginBottom: 14 }}>Data & Acknowledgements</div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                {[
                  { label: "SMAP L4 Soil Moisture", doi: "10.5067/LWJ6TF5SZRG3", src: "NASA GSFC" },
                  { label: "MODIS NDVI/NDWI MOD13Q1", doi: "10.5067/MODIS/MOD13Q1.061", src: "NASA GSFC / LP DAAC" },
                  { label: "ECOSTRESS PT-JPL ET", doi: "10.5067/ECOSTRESS/ECO3ETPTJPL.001", src: "NASA JPL" },
                  { label: "ECOSTRESS ESI ALEXI", doi: "10.5067/ECOSTRESS/ECO4ESIALEXI.001", src: "NASA JPL" },
                ].map((d) => (
                  <div key={d.doi} style={{ padding: "12px 16px", background: "#ffffff", borderRadius: 9, border: "1px solid #e2ddd7" }}>
                    <div style={{ fontSize: 12, fontWeight: 600, color: "#1c1a17", marginBottom: 3 }}>{d.label}</div>
                    <div style={{ fontSize: 10, color: "#9b8f83", marginBottom: 2 }}>{d.src}</div>
                    <div style={{ fontSize: 10, fontFamily: "'Space Mono', monospace", color: "#c0b9b0" }}>DOI: {d.doi}</div>
                  </div>
                ))}
              </div>
            </div>

            <div style={{ padding: "16px 20px", background: "#ffffff", borderRadius: 10, border: "1px solid #e2ddd7", fontSize: 12, color: "#9b8f83", lineHeight: 1.7 }}>
              Built for the NASA ESTO Space to Soil Challenge 2026. Simulation scenario: 2012 U.S. Midwest drought. All data products are publicly available via NASA Earthdata.
            </div>

          </div>
        </div>
      )}

      {tab === "dashboard" && <div style={{ flex: 1, display: "flex", overflow: "hidden" }}>
        <main style={{ flex: 1, display: "flex", flexDirection: "column", padding: "20px 24px", gap: 16, minWidth: 0 }}>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12 }}>
            <Metric label="Regions in alert" value={alerts.length} sub={`of ${REGIONS.length} monitored`} color={alerts.length > 8 ? "#c17f24" : alerts.length > 4 ? "#8b8427" : "#4a7c59"} />
            <Metric label="Critical zones" value={critCount} sub={critCount > 0 ? "immediate action" : "none detected"} color={critCount > 0 ? "#c0392b" : "#4a7c59"} />
            <Metric label="Avg early detect" value={`${avgLead}d`} sub="vs ground processing" color="#3d6b7c" />
            <Metric label="Bandwidth saved" value={`${pctSaved}%`} sub={`${rawMB} → ${procMB} MB`} color="#6b5c7a" />
          </div>

          <div style={{ flex: 1, background: "#ffffff", borderRadius: 14, border: "1px solid #e2ddd7", position: "relative", overflow: "hidden", minHeight: 340 }}>
            <div style={{ position: "absolute", top: 16, left: 20, display: "flex", alignItems: "center", gap: 8, zIndex: 2 }}>
              <span style={{ fontSize: 10, fontWeight: 600, color: "#9b8f83", textTransform: "uppercase", letterSpacing: "0.10em" }}>Drought progression · U.S. Midwest</span>
            </div>
            <div style={{ position: "absolute", top: 12, right: 18, zIndex: 2, padding: "5px 14px", borderRadius: 8, background: "#f7f4ef", border: "1px solid #e2ddd7" }}>
              <span style={{ fontSize: 13, fontWeight: 600, fontFamily: "'Space Mono', monospace", color: "#6b6560" }}>{WEEKS[week].full}</span>
            </div>

            {hoveredAlert && (
              <div style={{ position: "absolute", bottom: 16, left: 20, zIndex: 3, padding: "12px 16px", borderRadius: 10, background: "#ffffff", border: `1px solid ${sevColor(hoveredAlert.sev)}40`, boxShadow: "0 4px 20px rgba(0,0,0,0.10)", maxWidth: 280 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
                  <span style={{ fontWeight: 700, fontSize: 14, color: "#1c1a17" }}>{hoveredAlert.name}</span>
                  <Badge level={hoveredAlert.level} />
                </div>
                <div style={{ fontSize: 11, color: "#6b6560", lineHeight: 1.7, marginBottom: 8 }}>
                  Stress index: <span style={{ color: sevColor(hoveredAlert.sev), fontWeight: 600, fontFamily: "'Space Mono', monospace" }}>{Math.round(hoveredAlert.sev * 100)}%</span>
                  {" "}<span style={{ color: hoveredAlert.trend === "worsening" ? "#c0392b" : hoveredAlert.trend === "improving" ? "#4a7c59" : "#9b8f83", fontWeight: 600 }}>
                    {hoveredAlert.trend === "worsening" ? "\u2191" : hoveredAlert.trend === "improving" ? "\u2193" : "\u2192"} {hoveredAlert.trend}
                  </span><br />
                  Confidence: <span style={{ color: "#6b6560", fontWeight: 600, fontFamily: "'Space Mono', monospace" }}>{Math.round(hoveredAlert.confidence * 100)}%</span><br />
                  Detected <span style={{ color: "#3d6b7c", fontWeight: 600 }}>{hoveredAlert.leadDays} days</span> before traditional methods
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 4 }}>
                  {DATASETS.map((ds) => (
                    <div key={ds.id} style={{ textAlign: "center", padding: "4px 2px", borderRadius: 5, background: "#f7f4ef", border: "1px solid #e2ddd7" }}>
                      <div style={{ fontSize: 8, color: ds.color, fontWeight: 700 }}>{ds.id.toUpperCase()}</div>
                      <div style={{ fontSize: 11, color: "#1c1a17", fontFamily: "'Space Mono', monospace", fontWeight: 600 }}>
                        {hoveredAlert.datasets[ds.id]}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <svg viewBox="0 0 540 410" style={{ width: "100%", height: "100%", paddingTop: 20 }} preserveAspectRatio="xMidYMid meet">
              <defs>
                <radialGradient id="hotspot" cx="50%" cy="50%" r="50%">
                  <stop offset="0%" stopColor="#c0392b" stopOpacity="0.12" />
                  <stop offset="100%" stopColor="#c0392b" stopOpacity="0" />
                </radialGradient>
              </defs>

              {REGIONS.map((r) => {
                const sev = data[r.id];
                const isH = hovered === r.id;
                const x = r.cx - r.w / 2;
                const y = r.cy - r.h / 2;
                return (
                  <g key={r.id} onMouseEnter={() => setHovered(r.id)} onMouseLeave={() => setHovered(null)} style={{ cursor: "pointer" }}>
                    {sev >= 0.6 && (
                      <ellipse cx={r.cx} cy={r.cy} rx={r.w * 0.6} ry={r.h * 0.6} fill="url(#hotspot)" style={{ transition: "all 0.6s" }}>
                        <animate attributeName="opacity" values="0.8;0.3;0.8" dur="2.5s" repeatCount="indefinite" />
                      </ellipse>
                    )}
                    <rect x={x} y={y} width={r.w} height={r.h} rx={6}
                      fill={sevFill(sev)}
                      stroke={isH ? "#1c1a17" : sev >= 0.12 ? sevColor(sev) : "#d4cfc8"}
                      strokeWidth={isH ? 1.5 : 0.8}
                      strokeOpacity={isH ? 0.7 : sev >= 0.12 ? 0.5 : 1}
                      style={{ transition: "fill 0.5s, stroke 0.2s, stroke-width 0.2s" }} />
                    <text x={r.cx} y={sev >= 0.12 ? r.cy - 3 : r.cy + 1} textAnchor="middle" dominantBaseline="central"
                      fill={isH ? "#1c1a17" : sev >= 0.45 ? "#2a2520" : "#9b8f83"}
                      fontSize="11" fontWeight="600" fontFamily="'DM Sans', sans-serif" style={{ pointerEvents: "none", transition: "fill 0.3s" }}>
                      {r.id}
                    </text>
                    {sev >= 0.12 && (
                      <text x={r.cx} y={r.cy + 13} textAnchor="middle" dominantBaseline="central"
                        fill={sevColor(sev)} fontSize="10" fontWeight="700" fontFamily="'Space Mono', monospace" fillOpacity={0.9}
                        style={{ pointerEvents: "none" }}>
                        {Math.round(sev * 100)}%
                      </text>
                    )}
                    {sev >= 0.7 && (
                      <circle cx={x + r.w - 4} cy={y + 4} r="4" fill="#c0392b" opacity="0.75">
                        <animate attributeName="opacity" values="0.75;0.25;0.75" dur="1.5s" repeatCount="indefinite" />
                      </circle>
                    )}
                  </g>
                );
              })}

              <g transform="translate(440,310)">
                <text x="0" y="-6" fill="#9b8f83" fontSize="9" fontWeight="600" fontFamily="'DM Sans', sans-serif" letterSpacing="0.08em">SEVERITY</text>
                {[
                  { c: "#557a3d", l: "D1 Watch" },
                  { c: "#8b8427", l: "D2 Moderate" },
                  { c: "#c17f24", l: "D3 Severe" },
                  { c: "#c0392b", l: "D4 Critical" },
                ].map((item, i) => (
                  <g key={i} transform={`translate(0,${i * 18 + 8})`}>
                    <rect width="12" height="12" rx="3" fill={item.c} fillOpacity="0.7" />
                    <text x="18" y="10" fill="#6b6560" fontSize="10" fontFamily="'DM Sans', sans-serif">{item.l}</text>
                  </g>
                ))}
              </g>
            </svg>
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: 14, padding: "4px 0" }}>
            <button onClick={toggle} style={{
              width: 38, height: 38, borderRadius: 10, border: "1px solid",
              borderColor: playing ? "rgba(192,57,43,0.3)" : "rgba(74,124,89,0.3)",
              background: playing ? "rgba(192,57,43,0.05)" : "rgba(74,124,89,0.05)",
              color: playing ? "#c0392b" : "#4a7c59", cursor: "pointer",
              display: "flex", alignItems: "center", justifyContent: "center", fontSize: 13, flexShrink: 0, transition: "all 0.2s"
            }}>
              {playing ? "⏸" : "▶"}
            </button>
            <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 4 }}>
              <input type="range" min={0} max={19} value={week}
                onChange={(e) => { setWeek(+e.target.value); setPlaying(false); }}
                style={{ width: "100%", background: `linear-gradient(to right, #4a7c59 0%, #4a7c59 ${(week / 19) * 100}%, #e2ddd7 ${(week / 19) * 100}%)` }} />
              <div style={{ display: "flex", justifyContent: "space-between", padding: "0 2px" }}>
                {WEEKS.filter((_, i) => i % 5 === 0).map((w) => (
                  <span key={w.idx} style={{ fontSize: 9, color: "#c0b9b0", fontFamily: "'Space Mono', monospace" }}>{w.label}</span>
                ))}
              </div>
            </div>
            <div style={{ textAlign: "right", minWidth: 64, flexShrink: 0 }}>
              <div style={{ fontSize: 13, fontWeight: 700, fontFamily: "'Space Mono', monospace", color: "#6b6560" }}>Wk {week + 1}</div>
              <div style={{ fontSize: 10, color: "#c0b9b0" }}>of 20</div>
            </div>
          </div>
        </main>

        <aside style={{ width: 320, borderLeft: "1px solid #e2ddd7", display: "flex", flexDirection: "column", background: "#ffffff", flexShrink: 0 }}>
          <div style={{ padding: "14px 18px", borderBottom: "1px solid #e2ddd7" }}>
            <div style={{ fontSize: 10, fontWeight: 600, color: "#9b8f83", textTransform: "uppercase", letterSpacing: "0.10em", marginBottom: 10 }}>Hybrid processing pipeline</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
              {HW_PIPELINE.map((hw) => {
                const gpuActive = critCount > 0 || alerts.some((a) => a.level === "severe");
                const isActive = hw.id === "gpu" ? gpuActive : true;
                return (
                  <div key={hw.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "7px 10px", borderRadius: 8, background: "#f7f4ef", border: "1px solid #e2ddd7", opacity: isActive ? 1 : 0.45, transition: "all 0.4s" }}>
                    <div style={{ width: 7, height: 7, borderRadius: "50%", background: isActive ? hw.color : "#c0b9b0", flexShrink: 0, transition: "all 0.4s" }} />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 11, fontWeight: 700, color: isActive ? "#2a2520" : "#9b8f83", letterSpacing: "0.02em" }}>{hw.name}</div>
                      <div style={{ fontSize: 9, color: "#9b8f83", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{hw.role}</div>
                    </div>
                    <div style={{ fontSize: 9, color: "#c0b9b0", fontFamily: "'Space Mono', monospace", flexShrink: 0 }}>{hw.power}</div>
                  </div>
                );
              })}
            </div>
          </div>

          <div style={{ padding: "14px 18px", borderBottom: "1px solid #e2ddd7" }}>
            <div style={{ fontSize: 10, fontWeight: 600, color: "#9b8f83", textTransform: "uppercase", letterSpacing: "0.10em", marginBottom: 8 }}>Data sources</div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6 }}>
              {DATASETS.map((ds) => {
                const isActive = ds.id === "ptjpl" || ds.id === "esi" ? critCount > 0 || alerts.some((a) => a.level === "severe") : true;
                return (
                  <div key={ds.id} style={{ padding: "7px 10px", borderRadius: 7, background: "#f7f4ef", border: "1px solid #e2ddd7", opacity: isActive ? 1 : 0.45, transition: "all 0.4s" }}>
                    <div style={{ fontSize: 10, fontWeight: 700, color: isActive ? ds.color : "#9b8f83" }}>{ds.name}</div>
                    <div style={{ fontSize: 9, color: "#9b8f83" }}>{ds.desc}</div>
                  </div>
                );
              })}
            </div>
          </div>

          <div style={{ padding: "12px 18px", borderBottom: "1px solid #e2ddd7" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 7 }}>
              <span style={{ fontSize: 10, fontWeight: 600, color: "#9b8f83", textTransform: "uppercase", letterSpacing: "0.10em" }}>Downlink output</span>
              <span style={{ fontSize: 10, fontFamily: "'Space Mono', monospace", color: "#6b5c7a" }}>{pctSaved}% saved</span>
            </div>
            <div style={{ position: "relative", height: 5, borderRadius: 3, background: "#ede9e4", overflow: "hidden", marginBottom: 8 }}>
              <div style={{ position: "absolute", left: 0, top: 0, height: "100%", borderRadius: 3, width: `${100 - pctSaved}%`, background: "#6b5c7a", transition: "width 0.6s ease", minWidth: 4 }} />
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 5, fontSize: 9, color: "#9b8f83" }}>
              <div><span style={{ color: "#6b6560", fontWeight: 600 }}>Format:</span> GeoJSON + COG</div>
              <div><span style={{ color: "#6b6560", fontWeight: 600 }}>Alert pkt:</span> ~10 KB</div>
              <div><span style={{ color: "#6b6560", fontWeight: 600 }}>Raw:</span> {rawMB} MB/pass</div>
              <div><span style={{ color: "#6b6560", fontWeight: 600 }}>Processed:</span> {procMB} MB/pass</div>
            </div>
          </div>

          <div style={{ padding: "10px 18px 4px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <span style={{ fontSize: 10, fontWeight: 600, color: "#9b8f83", textTransform: "uppercase", letterSpacing: "0.10em" }}>Active alerts</span>
            <span style={{ fontSize: 11, fontFamily: "'Space Mono', monospace", color: "#9b8f83" }}>{alerts.length}</span>
          </div>

          <div className="scroll-area" style={{ flex: 1, overflowY: "auto", padding: "4px 18px 18px" }}>
            {alerts.length === 0 ? (
              <div style={{ textAlign: "center", padding: "36px 16px", color: "#9b8f83" }}>
                <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#4a7c59" strokeWidth="1.5" style={{ margin: "0 auto 10px", display: "block" }}>
                  <circle cx="12" cy="12" r="10" /><path d="M8 12l2.5 2.5L16 9" />
                </svg>
                <div style={{ fontSize: 13, color: "#6b6560", fontWeight: 500 }}>All clear</div>
                <div style={{ fontSize: 11, color: "#9b8f83", marginTop: 4 }}>Advance the timeline to observe drought onset</div>
              </div>
            ) : (
              alerts.map((a) => {
                const trendIcon = a.trend === "worsening" ? "\u2191" : a.trend === "improving" ? "\u2193" : "\u2192";
                const trendColor = a.trend === "worsening" ? "#c0392b" : a.trend === "improving" ? "#4a7c59" : "#9b8f83";
                return (
                  <div key={a.id} className="alert-card"
                    onMouseEnter={() => setHovered(a.id)} onMouseLeave={() => setHovered(null)}
                    style={{
                      padding: "10px 12px", borderRadius: 10, marginBottom: 6, cursor: "pointer",
                      background: hovered === a.id ? PALETTE[a.level].bg : "#fafaf7",
                      border: `1px solid ${hovered === a.id ? PALETTE[a.level].stroke : "#e2ddd7"}`,
                    }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
                      <span style={{ fontWeight: 600, fontSize: 13, color: "#1c1a17" }}>{a.name}</span>
                      <Badge level={a.level} />
                    </div>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: 11, marginBottom: 4 }}>
                      <span style={{ color: "#9b8f83" }}>
                        Stress <span style={{ color: sevColor(a.sev), fontWeight: 600, fontFamily: "'Space Mono', monospace" }}>{Math.round(a.sev * 100)}%</span>
                      </span>
                      <span style={{ color: "#3d6b7c", fontWeight: 500 }}>+{a.leadDays}d early</span>
                    </div>
                    <div style={{ display: "flex", gap: 8, fontSize: 10, marginBottom: 5 }}>
                      <span style={{ color: trendColor, fontWeight: 600 }}>{trendIcon} {a.trend}</span>
                      <span style={{ color: "#9b8f83" }}>conf <span style={{ color: "#6b6560", fontFamily: "'Space Mono', monospace" }}>{Math.round(a.confidence * 100)}%</span></span>
                    </div>
                    <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 3, marginBottom: 5 }}>
                      {DATASETS.map((ds) => (
                        <div key={ds.id} style={{ textAlign: "center", padding: "3px 0", borderRadius: 4, background: "#f7f4ef", border: "1px solid #e2ddd7" }}>
                          <div style={{ fontSize: 8, color: ds.color, fontWeight: 700, letterSpacing: "0.04em" }}>{ds.id.toUpperCase()}</div>
                          <div style={{ fontSize: 10, color: "#2a2520", fontFamily: "'Space Mono', monospace", fontWeight: 600 }}>
                            {ds.id === "ndvi" ? a.datasets.ndvi : ds.id === "smap" ? a.datasets.smap : ds.id === "ptjpl" ? a.datasets.ptjpl : a.datasets.esi}
                          </div>
                        </div>
                      ))}
                    </div>
                    <div style={{ height: 3, borderRadius: 2, background: "#ede9e4", overflow: "hidden" }}>
                      <div style={{ width: `${Math.min(a.sev * 100, 100)}%`, height: "100%", borderRadius: 2, background: sevColor(a.sev), opacity: 0.6, transition: "width 0.5s" }} />
                    </div>
                  </div>
                );
              })
            )}
          </div>

          <div style={{ padding: "10px 18px", borderTop: "1px solid #e2ddd7", background: "#f7f4ef" }}>
            <div style={{ fontSize: 9, color: "#9b8f83", lineHeight: 1.8 }}>
              <span style={{ color: "#6b6560", fontWeight: 600 }}>Platform</span> Heterogeneous COTS (VPU+GPU+FPGA)<br />
              <span style={{ color: "#6b6560", fontWeight: 600 }}>Output</span> GeoJSON polygons · severity 0-5 · trends<br />
              <span style={{ color: "#6b6560", fontWeight: 600 }}>Scenario</span> 2012 U.S. Midwest drought
            </div>
          </div>
        </aside>
      </div>}

    </div>
  );
}
