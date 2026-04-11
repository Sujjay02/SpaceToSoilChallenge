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
  { id: "smap", name: "SMAP L4", desc: "Soil Moisture", doi: "10.5067/LWJ6TF5SZRG3", hw: "VPU", color: "#3b82f6" },
  { id: "ndvi", name: "NDVI/NDWI", desc: "Vegetation Indices", doi: "10.5067/MODIS/MOD13Q1.061", hw: "VPU", color: "#22c55e" },
  { id: "ptjpl", name: "PT-JPL ET", desc: "Evapotranspiration", doi: "10.5067/ECOSTRESS/ECO3ETPTJPL.001", hw: "GPU", color: "#f59e0b" },
  { id: "esi", name: "ESI L4", desc: "Evaporative Stress", doi: "10.5067/ECOSTRESS/ECO4ESIALEXI.001", hw: "GPU", color: "#ef4444" },
];

const HW_PIPELINE = [
  { id: "fpga", name: "FPGA", role: "Cloud mask & sensor I/O", power: "~1W", status: "always-on", color: "#8b5cf6" },
  { id: "vpu", name: "Myriad X VPU", role: "NDVI/NDWI + anomaly detect", power: "~2W", status: "always-on", color: "#06b6d4" },
  { id: "gpu", name: "AMD GPU", role: "PT-JPL & severity mapping", power: "~15W", status: "on-alert", color: "#f97316" },
  { id: "cpu", name: "CPU", role: "Scheduling & downlink logic", power: "~5W", status: "always-on", color: "#10b981" },
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
  critical: { color: "#ef4444", bg: "rgba(239,68,68,0.10)", stroke: "rgba(239,68,68,0.35)" },
  severe: { color: "#f97316", bg: "rgba(249,115,22,0.10)", stroke: "rgba(249,115,22,0.30)" },
  moderate: { color: "#eab308", bg: "rgba(234,179,8,0.10)", stroke: "rgba(234,179,8,0.25)" },
  watch: { color: "#a3e635", bg: "rgba(163,230,53,0.08)", stroke: "rgba(163,230,53,0.20)" },
};

function sevColor(sev) {
  if (sev >= 0.7) return "#ef4444";
  if (sev >= 0.45) return "#f97316";
  if (sev >= 0.22) return "#eab308";
  if (sev >= 0.12) return "#a3e635";
  return "transparent";
}

function sevFill(sev) {
  if (sev >= 0.7) return "rgba(239,68,68,0.35)";
  if (sev >= 0.45) return "rgba(249,115,22,0.28)";
  if (sev >= 0.22) return "rgba(234,179,8,0.22)";
  if (sev >= 0.12) return "rgba(163,230,53,0.14)";
  return "rgba(255,255,255,0.025)";
}

function levelTag(l) {
  return { critical: "D4", severe: "D3", moderate: "D2", watch: "D1" }[l] || "";
}

const Metric = ({ label, value, sub, color }) => (
  <div style={{ padding: "12px 16px", background: "rgba(255,255,255,0.02)", borderRadius: 12, border: "1px solid rgba(255,255,255,0.05)", minWidth: 0 }}>
    <div style={{ fontSize: 10, fontWeight: 600, color: "#52607a", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 6, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{label}</div>
    <div style={{ fontSize: 24, fontWeight: 700, color: color || "#e2e8f0", fontFamily: "'Space Mono', monospace", lineHeight: 1 }}>{value}</div>
    {sub && <div style={{ fontSize: 11, color: "#475569", marginTop: 4 }}>{sub}</div>}
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
    <div style={{ background: "#060c18", color: "#cbd5e1", minHeight: "100vh", fontFamily: "'DM Sans', system-ui, sans-serif", display: "flex", flexDirection: "column" }}>
      <link href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700&family=Space+Mono:wght@400;700&display=swap" rel="stylesheet" />
      <style>{`
        input[type=range] { -webkit-appearance: none; appearance: none; height: 5px; border-radius: 3px; outline: none; cursor: pointer; }
        input[type=range]::-webkit-slider-thumb { -webkit-appearance: none; width: 16px; height: 16px; border-radius: 50%; background: #10b981; border: 2px solid #060c18; box-shadow: 0 0 8px rgba(16,185,129,0.4); cursor: pointer; }
        input[type=range]::-moz-range-thumb { width: 16px; height: 16px; border-radius: 50%; background: #10b981; border: 2px solid #060c18; box-shadow: 0 0 8px rgba(16,185,129,0.4); cursor: pointer; }
        .alert-card { transition: transform 0.15s, box-shadow 0.15s; }
        .alert-card:hover { transform: translateY(-1px); box-shadow: 0 4px 16px rgba(0,0,0,0.3); }
        .scroll-area::-webkit-scrollbar { width: 4px; }
        .scroll-area::-webkit-scrollbar-track { background: transparent; }
        .scroll-area::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.08); border-radius: 2px; }
      `}</style>

      <header style={{ padding: "12px 24px", display: "flex", alignItems: "center", justifyContent: "space-between", borderBottom: "1px solid rgba(255,255,255,0.05)", background: "rgba(255,255,255,0.015)", flexShrink: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <svg width="28" height="28" viewBox="0 0 28 28" fill="none">
            <rect width="28" height="28" rx="7" fill="url(#lg)" />
            <defs><linearGradient id="lg" x1="0" y1="0" x2="28" y2="28"><stop stopColor="#059669" /><stop offset="1" stopColor="#0d9488" /></linearGradient></defs>
            <path d="M14 6C9.58 6 6 9.58 6 14s3.58 8 8 8 8-3.58 8-8-3.58-8-8-8zm0 1.5c.5 0 1 .08 1.47.2C14.3 9.4 14 11.6 14 14s.3 4.6 1.47 6.3c-.47.12-.97.2-1.47.2-3.58 0-6.5-2.92-6.5-6.5S10.42 7.5 14 7.5z" fill="rgba(255,255,255,0.85)" />
            <path d="M8 14h12" stroke="rgba(255,255,255,0.5)" strokeWidth="0.8" />
          </svg>
          <div style={{ lineHeight: 1.2 }}>
            <div style={{ fontWeight: 700, fontSize: 16, color: "#f1f5f9", letterSpacing: "-0.02em" }}>SoilSentinel</div>
            <div style={{ fontSize: 11, color: "#475569", fontWeight: 500 }}>Adaptive drought early warning</div>
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
            <div style={{ width: 6, height: 6, borderRadius: "50%", background: playing ? "#22c55e" : "#475569", boxShadow: playing ? "0 0 10px rgba(34,197,94,0.6)" : "none", transition: "all 0.3s" }} />
            <span style={{ fontSize: 11, color: "#64748b", fontWeight: 500 }}>{playing ? "SIMULATING" : "READY"}</span>
          </div>
          <div style={{ width: 1, height: 16, background: "rgba(255,255,255,0.06)" }} />
          <span style={{ fontSize: 11, color: "#334155", fontFamily: "'Space Mono', monospace" }}>NASA ESTO · Space to Soil 2026</span>
        </div>
      </header>

      <div style={{ flex: 1, display: "flex", overflow: "hidden" }}>
        <main style={{ flex: 1, display: "flex", flexDirection: "column", padding: "16px 20px", gap: 12, minWidth: 0 }}>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 10 }}>
            <Metric label="Regions in alert" value={alerts.length} sub={`of ${REGIONS.length} monitored`} color={alerts.length > 8 ? "#f97316" : alerts.length > 4 ? "#eab308" : "#10b981"} />
            <Metric label="Critical zones" value={critCount} sub={critCount > 0 ? "immediate action" : "none detected"} color={critCount > 0 ? "#ef4444" : "#10b981"} />
            <Metric label="Avg early detect" value={`${avgLead}d`} sub="vs ground processing" color="#06b6d4" />
            <Metric label="Bandwidth saved" value={`${pctSaved}%`} sub={`${rawMB} → ${procMB} MB`} color="#a78bfa" />
          </div>

          <div style={{ flex: 1, background: "rgba(255,255,255,0.015)", borderRadius: 14, border: "1px solid rgba(255,255,255,0.05)", position: "relative", overflow: "hidden", minHeight: 340 }}>
            <div style={{ position: "absolute", top: 14, left: 18, display: "flex", alignItems: "center", gap: 8, zIndex: 2 }}>
              <span style={{ fontSize: 10, fontWeight: 600, color: "#3e4c63", textTransform: "uppercase", letterSpacing: "0.08em" }}>Drought progression · U.S. Midwest</span>
            </div>
            <div style={{ position: "absolute", top: 10, right: 16, zIndex: 2, padding: "5px 12px", borderRadius: 8, background: "rgba(0,0,0,0.4)", backdropFilter: "blur(8px)", border: "1px solid rgba(255,255,255,0.06)" }}>
              <span style={{ fontSize: 13, fontWeight: 600, fontFamily: "'Space Mono', monospace", color: "#94a3b8" }}>{WEEKS[week].full}</span>
            </div>

            {hoveredAlert && (
              <div style={{ position: "absolute", bottom: 14, left: 18, zIndex: 3, padding: "10px 14px", borderRadius: 10, background: "rgba(6,12,24,0.92)", border: `1px solid ${sevColor(hoveredAlert.sev)}44`, backdropFilter: "blur(12px)", maxWidth: 280 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
                  <span style={{ fontWeight: 700, fontSize: 14, color: "#f1f5f9" }}>{hoveredAlert.name}</span>
                  <Badge level={hoveredAlert.level} />
                </div>
                <div style={{ fontSize: 11, color: "#64748b", lineHeight: 1.6, marginBottom: 8 }}>
                  Stress index: <span style={{ color: sevColor(hoveredAlert.sev), fontWeight: 600, fontFamily: "'Space Mono', monospace" }}>{Math.round(hoveredAlert.sev * 100)}%</span>
                  {" "}<span style={{ color: hoveredAlert.trend === "worsening" ? "#ef4444" : hoveredAlert.trend === "improving" ? "#22c55e" : "#64748b", fontWeight: 600 }}>
                    {hoveredAlert.trend === "worsening" ? "\u2191" : hoveredAlert.trend === "improving" ? "\u2193" : "\u2192"} {hoveredAlert.trend}
                  </span><br />
                  Confidence: <span style={{ color: "#94a3b8", fontWeight: 600, fontFamily: "'Space Mono', monospace" }}>{Math.round(hoveredAlert.confidence * 100)}%</span><br />
                  Detected <span style={{ color: "#06b6d4", fontWeight: 600 }}>{hoveredAlert.leadDays} days</span> before traditional methods
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 4 }}>
                  {DATASETS.map((ds) => (
                    <div key={ds.id} style={{ textAlign: "center", padding: "4px 2px", borderRadius: 5, background: `${ds.color}0c`, border: `1px solid ${ds.color}18` }}>
                      <div style={{ fontSize: 8, color: ds.color, fontWeight: 700 }}>{ds.id.toUpperCase()}</div>
                      <div style={{ fontSize: 11, color: "#e2e8f0", fontFamily: "'Space Mono', monospace", fontWeight: 600 }}>
                        {hoveredAlert.datasets[ds.id]}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <svg viewBox="0 0 540 410" style={{ width: "100%", height: "100%", paddingTop: 20 }} preserveAspectRatio="xMidYMid meet">
              <defs>
                <filter id="glow2"><feGaussianBlur stdDeviation="4" result="b" /><feMerge><feMergeNode in="b" /><feMergeNode in="SourceGraphic" /></feMerge></filter>
                <radialGradient id="hotspot" cx="50%" cy="50%" r="50%">
                  <stop offset="0%" stopColor="#ef4444" stopOpacity="0.3" />
                  <stop offset="100%" stopColor="#ef4444" stopOpacity="0" />
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
                        <animate attributeName="opacity" values="0.6;0.2;0.6" dur="2.5s" repeatCount="indefinite" />
                      </ellipse>
                    )}
                    <rect x={x} y={y} width={r.w} height={r.h} rx={6}
                      fill={sevFill(sev)}
                      stroke={isH ? "#fff" : sev >= 0.12 ? sevColor(sev) : "rgba(255,255,255,0.06)"}
                      strokeWidth={isH ? 1.8 : 0.6}
                      strokeOpacity={isH ? 0.8 : sev >= 0.12 ? 0.4 : 1}
                      style={{ transition: "fill 0.5s, stroke 0.2s, stroke-width 0.2s" }} />
                    <text x={r.cx} y={sev >= 0.12 ? r.cy - 3 : r.cy + 1} textAnchor="middle" dominantBaseline="central"
                      fill={isH ? "#fff" : sev >= 0.45 ? "#f1f5f9" : "#64748b"}
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
                      <circle cx={x + r.w - 4} cy={y + 4} r="5" fill="#ef4444" filter="url(#glow2)">
                        <animate attributeName="opacity" values="1;0.3;1" dur="1.2s" repeatCount="indefinite" />
                        <animate attributeName="r" values="4;6;4" dur="1.2s" repeatCount="indefinite" />
                      </circle>
                    )}
                  </g>
                );
              })}

              <g transform="translate(440,310)">
                <text x="0" y="-6" fill="#3e4c63" fontSize="9" fontWeight="600" fontFamily="'DM Sans', sans-serif" letterSpacing="0.08em">SEVERITY</text>
                {[
                  { c: "#a3e635", l: "D1 Watch", o: 0.5 },
                  { c: "#eab308", l: "D2 Moderate", o: 0.6 },
                  { c: "#f97316", l: "D3 Severe", o: 0.7 },
                  { c: "#ef4444", l: "D4 Critical", o: 0.8 },
                ].map((item, i) => (
                  <g key={i} transform={`translate(0,${i * 18 + 8})`}>
                    <rect width="14" height="12" rx="3" fill={item.c} fillOpacity={item.o} />
                    <text x="20" y="10" fill="#52607a" fontSize="10" fontFamily="'DM Sans', sans-serif">{item.l}</text>
                  </g>
                ))}
              </g>
            </svg>
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "4px 0" }}>
            <button onClick={toggle} style={{
              width: 38, height: 38, borderRadius: 10, border: "1px solid",
              borderColor: playing ? "rgba(239,68,68,0.25)" : "rgba(16,185,129,0.25)",
              background: playing ? "rgba(239,68,68,0.08)" : "rgba(16,185,129,0.08)",
              color: playing ? "#ef4444" : "#10b981", cursor: "pointer",
              display: "flex", alignItems: "center", justifyContent: "center", fontSize: 13, flexShrink: 0, transition: "all 0.2s"
            }}>
              {playing ? "⏸" : "▶"}
            </button>
            <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 4 }}>
              <input type="range" min={0} max={19} value={week}
                onChange={(e) => { setWeek(+e.target.value); setPlaying(false); }}
                style={{ width: "100%", background: `linear-gradient(to right, #059669 0%, #059669 ${(week / 19) * 100}%, rgba(255,255,255,0.06) ${(week / 19) * 100}%)` }} />
              <div style={{ display: "flex", justifyContent: "space-between", padding: "0 2px" }}>
                {WEEKS.filter((_, i) => i % 5 === 0).map((w) => (
                  <span key={w.idx} style={{ fontSize: 9, color: "#334155", fontFamily: "'Space Mono', monospace" }}>{w.label}</span>
                ))}
              </div>
            </div>
            <div style={{ textAlign: "right", minWidth: 64, flexShrink: 0 }}>
              <div style={{ fontSize: 13, fontWeight: 700, fontFamily: "'Space Mono', monospace", color: "#94a3b8" }}>Wk {week + 1}</div>
              <div style={{ fontSize: 10, color: "#334155" }}>of 20</div>
            </div>
          </div>
        </main>

        <aside style={{ width: 320, borderLeft: "1px solid rgba(255,255,255,0.05)", display: "flex", flexDirection: "column", background: "rgba(255,255,255,0.01)", flexShrink: 0 }}>
          <div style={{ padding: "12px 16px", borderBottom: "1px solid rgba(255,255,255,0.05)" }}>
            <div style={{ fontSize: 10, fontWeight: 600, color: "#3e4c63", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 10 }}>Hybrid processing pipeline</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              {HW_PIPELINE.map((hw) => {
                const gpuActive = critCount > 0 || alerts.some((a) => a.level === "severe");
                const isActive = hw.id === "gpu" ? gpuActive : true;
                return (
                  <div key={hw.id} style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 8px", borderRadius: 8, background: isActive ? `${hw.color}08` : "rgba(255,255,255,0.015)", border: `1px solid ${isActive ? `${hw.color}20` : "rgba(255,255,255,0.03)"}`, transition: "all 0.4s" }}>
                    <div style={{ width: 6, height: 6, borderRadius: "50%", background: isActive ? hw.color : "#334155", boxShadow: isActive ? `0 0 8px ${hw.color}60` : "none", flexShrink: 0, transition: "all 0.4s" }}>
                      {isActive && hw.id !== "gpu" && <style>{`@keyframes pulse-${hw.id}{0%,100%{opacity:1}50%{opacity:0.4}}`}</style>}
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 10, fontWeight: 700, color: isActive ? hw.color : "#475569", letterSpacing: "0.04em" }}>{hw.name}</div>
                      <div style={{ fontSize: 9, color: "#3e4c63", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{hw.role}</div>
                    </div>
                    <div style={{ fontSize: 9, color: "#334155", fontFamily: "'Space Mono', monospace", flexShrink: 0 }}>{hw.power}</div>
                  </div>
                );
              })}
            </div>
          </div>

          <div style={{ padding: "12px 16px", borderBottom: "1px solid rgba(255,255,255,0.05)" }}>
            <div style={{ fontSize: 10, fontWeight: 600, color: "#3e4c63", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 8 }}>Data sources</div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 4 }}>
              {DATASETS.map((ds) => {
                const isActive = ds.id === "ptjpl" || ds.id === "esi" ? critCount > 0 || alerts.some((a) => a.level === "severe") : true;
                return (
                  <div key={ds.id} style={{ padding: "6px 8px", borderRadius: 7, background: isActive ? `${ds.color}0a` : "rgba(255,255,255,0.015)", border: `1px solid ${isActive ? `${ds.color}18` : "rgba(255,255,255,0.03)"}`, transition: "all 0.4s" }}>
                    <div style={{ fontSize: 10, fontWeight: 700, color: isActive ? ds.color : "#475569" }}>{ds.name}</div>
                    <div style={{ fontSize: 9, color: "#3e4c63" }}>{ds.desc}</div>
                  </div>
                );
              })}
            </div>
          </div>

          <div style={{ padding: "10px 16px", borderBottom: "1px solid rgba(255,255,255,0.05)" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
              <span style={{ fontSize: 10, fontWeight: 600, color: "#3e4c63", textTransform: "uppercase", letterSpacing: "0.08em" }}>Downlink output</span>
              <span style={{ fontSize: 10, fontFamily: "'Space Mono', monospace", color: "#a78bfa" }}>{pctSaved}% saved</span>
            </div>
            <div style={{ position: "relative", height: 6, borderRadius: 3, background: "rgba(255,255,255,0.04)", overflow: "hidden", marginBottom: 8 }}>
              <div style={{ position: "absolute", left: 0, top: 0, height: "100%", borderRadius: 3, width: `${100 - pctSaved}%`, background: "linear-gradient(90deg, #7c3aed, #a78bfa)", transition: "width 0.6s ease", minWidth: 4 }} />
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6, fontSize: 9, color: "#3e4c63" }}>
              <div><span style={{ color: "#475569", fontWeight: 600 }}>Format:</span> GeoJSON + COG</div>
              <div><span style={{ color: "#475569", fontWeight: 600 }}>Alert pkt:</span> ~10 KB</div>
              <div><span style={{ color: "#475569", fontWeight: 600 }}>Raw:</span> {rawMB} MB/pass</div>
              <div><span style={{ color: "#475569", fontWeight: 600 }}>Processed:</span> {procMB} MB/pass</div>
            </div>
          </div>

          <div style={{ padding: "8px 16px 4px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <span style={{ fontSize: 10, fontWeight: 600, color: "#3e4c63", textTransform: "uppercase", letterSpacing: "0.08em" }}>Active alerts</span>
            <span style={{ fontSize: 11, fontFamily: "'Space Mono', monospace", color: "#475569" }}>{alerts.length}</span>
          </div>

          <div className="scroll-area" style={{ flex: 1, overflowY: "auto", padding: "4px 16px 16px" }}>
            {alerts.length === 0 ? (
              <div style={{ textAlign: "center", padding: "36px 16px", color: "#1e293b" }}>
                <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#1e3a2f" strokeWidth="1.5" style={{ margin: "0 auto 10px", display: "block" }}>
                  <circle cx="12" cy="12" r="10" /><path d="M8 12l2.5 2.5L16 9" />
                </svg>
                <div style={{ fontSize: 13, color: "#334155", fontWeight: 500 }}>All clear</div>
                <div style={{ fontSize: 11, color: "#1e293b", marginTop: 4 }}>Advance the timeline to observe drought onset</div>
              </div>
            ) : (
              alerts.map((a) => {
                const trendIcon = a.trend === "worsening" ? "\u2191" : a.trend === "improving" ? "\u2193" : "\u2192";
                const trendColor = a.trend === "worsening" ? "#ef4444" : a.trend === "improving" ? "#22c55e" : "#64748b";
                return (
                  <div key={a.id} className="alert-card"
                    onMouseEnter={() => setHovered(a.id)} onMouseLeave={() => setHovered(null)}
                    style={{
                      padding: "10px 12px", borderRadius: 10, marginBottom: 6, cursor: "pointer",
                      background: hovered === a.id ? `${PALETTE[a.level].bg}` : "rgba(255,255,255,0.015)",
                      border: `1px solid ${hovered === a.id ? PALETTE[a.level].stroke : "rgba(255,255,255,0.04)"}`,
                    }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
                      <span style={{ fontWeight: 600, fontSize: 13, color: "#e2e8f0" }}>{a.name}</span>
                      <Badge level={a.level} />
                    </div>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: 11, marginBottom: 4 }}>
                      <span style={{ color: "#52607a" }}>
                        Stress <span style={{ color: sevColor(a.sev), fontWeight: 600, fontFamily: "'Space Mono', monospace" }}>{Math.round(a.sev * 100)}%</span>
                      </span>
                      <span style={{ color: "#0891b2", fontWeight: 500 }}>+{a.leadDays}d early</span>
                    </div>
                    <div style={{ display: "flex", gap: 8, fontSize: 10, marginBottom: 5 }}>
                      <span style={{ color: trendColor, fontWeight: 600 }}>{trendIcon} {a.trend}</span>
                      <span style={{ color: "#475569" }}>conf <span style={{ color: "#94a3b8", fontFamily: "'Space Mono', monospace" }}>{Math.round(a.confidence * 100)}%</span></span>
                    </div>
                    <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 3, marginBottom: 5 }}>
                      {DATASETS.map((ds) => (
                        <div key={ds.id} style={{ textAlign: "center", padding: "3px 0", borderRadius: 4, background: `${ds.color}08`, border: `1px solid ${ds.color}12` }}>
                          <div style={{ fontSize: 8, color: ds.color, fontWeight: 700, letterSpacing: "0.04em" }}>{ds.id.toUpperCase()}</div>
                          <div style={{ fontSize: 10, color: "#94a3b8", fontFamily: "'Space Mono', monospace", fontWeight: 600 }}>
                            {ds.id === "ndvi" ? a.datasets.ndvi : ds.id === "smap" ? a.datasets.smap : ds.id === "ptjpl" ? a.datasets.ptjpl : a.datasets.esi}
                          </div>
                        </div>
                      ))}
                    </div>
                    <div style={{ height: 3, borderRadius: 2, background: "rgba(255,255,255,0.04)", overflow: "hidden" }}>
                      <div style={{ width: `${Math.min(a.sev * 100, 100)}%`, height: "100%", borderRadius: 2, background: sevColor(a.sev), opacity: 0.7, transition: "width 0.5s" }} />
                    </div>
                  </div>
                );
              })
            )}
          </div>

          <div style={{ padding: "8px 16px", borderTop: "1px solid rgba(255,255,255,0.05)", background: "rgba(255,255,255,0.01)" }}>
            <div style={{ fontSize: 9, color: "#1e293b", lineHeight: 1.8 }}>
              <span style={{ color: "#334155", fontWeight: 600 }}>Platform</span> Heterogeneous COTS (VPU+GPU+FPGA)<br />
              <span style={{ color: "#334155", fontWeight: 600 }}>Output</span> GeoJSON polygons · severity 0-5 · trends<br />
              <span style={{ color: "#334155", fontWeight: 600 }}>Scenario</span> 2012 U.S. Midwest drought
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
}
