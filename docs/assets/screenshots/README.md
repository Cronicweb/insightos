# Screenshot & Demo Capture Kit

This directory holds the polished product imagery referenced by the top-level
README. The images themselves are **captured by a human from the running
application** — they are intentionally not generated — so that every screenshot
in the README reflects the real, current UI.

## How to produce the assets

1. Build the demo data and run the app locally:
   ```bash
   pip install ./packages/analytics-core
   insightos demo build --out apps/web/public/demo
   cd apps/web && npm install && npm run dev
   ```
2. Use the **banking** demo dataset for hero shots (it has the richest
   root-cause tree) and the **marketing** dataset for the forecast and
   recommendation shots.
3. Capture at a **1440×900** viewport, light theme, 2× device pixel ratio.
4. Export as PNG, optimise (e.g. `pngquant`/`oxipng`), and save with the exact
   filenames below so the README references resolve.

## Required shots

| Filename | Screen | Framing notes |
| --- | --- | --- |
| `landing.png` | Landing page | Hero + value proposition above the fold. |
| `overview.png` | Analysis overview | Scorecard, primary KPI, quality grade visible. |
| `root-cause.png` | Root-cause tree | Expanded tree with a driver and an offset colour-coded. |
| `forecast.png` | Forecast | KPI projection with the prediction interval band. |
| `recommendations.png` | Recommendations | A ranked card showing evidence + owner. |
| `executive-report.png` | Executive report | Headline, summary and a limitations section. |
| `insight-analyst.png` | Insight Analyst | A grounded answer with its evidence/trace panel. |
| `investigation-graph.png` | Investigation Graph | A small branched graph of question nodes. |
| `decision-replay.png` | Decision Replay | Old-vs-new comparison after a replay. |
| `ai-settings.png` | AI Settings | Provider/model + Strict Investigation Mode toggle. |
| `semantic-review.png` | Semantic Review | A proposal awaiting confirmation with its confidence. |
| `demo.gif` | End-to-end demo | ~30–45s: upload → semantic review → analytics → root cause → analyst → report. |

## Demo recording outline

Keep the emphasis on **deterministic analytics and explainability**, not the AI:

1. Landing page
2. Pick a demo dataset
3. Upload a CSV (show "data never leaves your device")
4. Semantic Review (confirm a mapping)
5. Analytics overview
6. Root-cause tree (open a driver)
7. Investigation Graph (branch a question)
8. Insight Analyst (ask a grounded question; show the evidence panel)
9. Decision Replay (replay against another dataset)
10. Executive Report

Target length: **under 60 seconds**. Record at 1440×900, export an optimised
GIF or MP4 as `demo.gif` / `demo.mp4` in this directory.
