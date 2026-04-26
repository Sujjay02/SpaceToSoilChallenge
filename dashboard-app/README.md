# SoilSentinel Dashboard

Interactive visualization of the onboard drought detection pipeline.
Live demo: **https://spacechallenge.vercel.app**

## Quick start

```bash
cd dashboard-app
npm install
npm run dev
```

Open http://localhost:5173 in your browser.

## Build for production

```bash
npm run build   # output goes to dist/
npm run preview # serve the production build locally
```

## Tech stack

- React 19 + Vite 8
- Pure CSS (no UI library) — all chart/map rendering is hand-coded SVG
- No backend: the simulation runs entirely in the browser using the same
  deterministic formulas as `pipeline/pipeline.py`
