"""``insightos`` command line interface.

Three commands, each mapping to a real workflow:

``insightos analyse <file>``
    Run the full pipeline over any CSV/Parquet/JSON file and print - or export -
    the executive report. This is the "does it work on my data?" entry point.

``insightos demo build``
    Regenerate the static JSON artifacts the web demo is built from. This is what
    makes the GitHub Pages deployment possible: the entire analysis is precomputed
    here and the frontend only renders it.

``insightos profile <file>``
    Schema, quality and role detection only - fast, for checking a new source.
"""

from __future__ import annotations

import argparse
import json
import sys
import time
from datetime import date
from pathlib import Path
from typing import Any

from . import __version__

_DEMO_KEYS = ("banking", "ecommerce", "marketing", "retail",
              "healthcare", "hr", "manufacturing")


# --------------------------------------------------------------------------- #
def _rotating_seed(key: str) -> int:
    """A generator seed that changes once per calendar month.

    The demo datasets anchor themselves to "last completed month", so the window
    they describe moves with the calendar. The magnitudes did not: every rebuild
    reused the generators' fixed default seeds, so the published site showed the
    same headline percentages forever and read as a frozen mock-up.

    Rotating the seed monthly keeps every rebuild *within* a month reproducible
    (a re-run after a hotfix does not shuffle the numbers) while making the demo
    genuinely new data each period. The planted signals are structural, not
    random, so the story each dataset tells survives the seed change.

    The test-suite calls the generators directly and keeps their fixed default
    seeds, so this rotation never makes CI non-deterministic.
    """
    today = date.today()
    period = today.year * 12 + today.month
    return period * 1000 + _DEMO_KEYS.index(key) * 7 + 7


def _write_json(path: Path, payload: Any, *, minify: bool = True) -> int:
    path.parent.mkdir(parents=True, exist_ok=True)
    text = (json.dumps(payload, separators=(",", ":"), ensure_ascii=False)
            if minify else json.dumps(payload, indent=2, ensure_ascii=False))
    path.write_text(text, encoding="utf-8")
    return len(text.encode("utf-8"))


def _summary_of(key: str, dataset: Any, result: Any) -> dict[str, Any]:
    """The small payload the app loads first, before any dataset is chosen."""
    sc = result.scorecard
    return {
        "key": key,
        "name": dataset.name if dataset else key.title(),
        "description": getattr(dataset, "description", ""),
        "story": getattr(dataset, "story", ""),
        "domain": (getattr(result.domain.domain, "value", str(result.domain.domain))
                   if result.domain else "unknown"),
        "domainConfidence": result.domain.confidence if result.domain else None,
        "rows": result.rows,
        "columns": result.columns,
        "qualityScore": result.quality.score if result.quality else None,
        "qualityGrade": result.quality.grade if result.quality else None,
        "headline": result.report.headline if result.report else "",
        "kpiCount": len(sc.kpis) if sc else 0,
        "anomalyCount": (len(result.anomalies.anomalies) if result.anomalies else 0),
        "recommendationCount": (len(result.recommendations.recommendations)
                                if result.recommendations else 0),
        "primaryKpi": (
            {
                "id": sc.kpis[0].id,
                "label": sc.kpis[0].label,
                "value": sc.kpis[0].value,
                "unit": sc.kpis[0].unit,
                "deltaPct": sc.kpis[0].delta_pct,
                "isFavourable": sc.kpis[0].is_favourable,
            } if sc and sc.kpis else None
        ),
    }


# --------------------------------------------------------------------------- #
def cmd_demo_build(args: argparse.Namespace) -> int:
    from .demo import generate
    from .pipeline import AnalysisOptions, analyse

    out = Path(args.out)
    keys = args.datasets or list(_DEMO_KEYS)
    index: list[dict[str, Any]] = []
    total_bytes = 0

    for key in keys:
        t0 = time.perf_counter()
        seed = args.seed if args.seed is not None else _rotating_seed(key)
        print(f"  building {key} (seed {seed}) ...", flush=True)
        dataset = generate(key, seed=seed)
        result = analyse(dataset.frame, AnalysisOptions(dataset_name=dataset.name))

        if result.warnings:
            for w in result.warnings:
                print(f"    ! {w}", file=sys.stderr)
            if args.strict:
                print("    build failed: analysis produced warnings (--strict)",
                      file=sys.stderr)
                return 1

        payload = result.to_dict()
        payload["groundTruth"] = dataset.ground_truth
        payload["story"] = dataset.story
        payload["key"] = key
        total_bytes += _write_json(out / f"{key}.json", payload, minify=not args.pretty)

        if args.with_data:
            sample = dataset.frame.head(args.sample_rows)
            _write_json(out / f"{key}.sample.json",
                        json.loads(sample.to_json(orient="records", date_format="iso")),
                        minify=not args.pretty)

        index.append(_summary_of(key, dataset, result))
        print(f"    done in {time.perf_counter() - t0:.1f}s "
              f"({result.rows:,} rows, quality {result.quality.score:.1f})")

    total_bytes += _write_json(out / "index.json", {
        "generatedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "engineVersion": __version__,
        "datasets": index,
    }, minify=not args.pretty)

    print(f"\nWrote {len(index)} dataset(s) + index to {out} "
          f"({total_bytes / 1024:.0f} KB total)")
    return 0


def cmd_analyse(args: argparse.Namespace) -> int:
    from .io import load_dataframe
    from .pipeline import AnalysisOptions, analyse
    from .reporting import render_markdown

    df = load_dataframe(args.path)
    result = analyse(df, AnalysisOptions(dataset_name=Path(args.path).stem))

    for w in result.warnings:
        print(f"! {w}", file=sys.stderr)

    if args.json:
        _write_json(Path(args.json), result.to_dict(), minify=False)
        print(f"Wrote analysis to {args.json}")
    if args.markdown:
        Path(args.markdown).write_text(render_markdown(result.report), encoding="utf-8")
        print(f"Wrote report to {args.markdown}")
    if not args.json and not args.markdown:
        print(render_markdown(result.report))
    return 0


def cmd_profile(args: argparse.Namespace) -> int:
    from .io import load_dataframe
    from .kpi import detect_domain, resolve_roles
    from .profiling import infer_schema
    from .quality import assess_quality

    df = load_dataframe(args.path)
    schema = infer_schema(df)
    quality = assess_quality(df, schema)
    roles = resolve_roles(df, schema)
    domain = detect_domain(df, schema, roles)

    print(f"{Path(args.path).name}: {len(df):,} rows x {len(df.columns)} columns")
    domain_label = getattr(domain.domain, "value", str(domain.domain))
    print(f"domain   : {domain_label} (confidence {domain.confidence:.0%})")
    print(f"quality  : {quality.score:.1f}/100 (grade {quality.grade})")
    print(f"key      : {', '.join(schema.primary_key or []) or 'none detected'}")
    print(f"date     : {', '.join(schema.time_columns or []) or 'none detected'}")
    print(f"measures : {', '.join(schema.measures or [])}")
    print(f"dimensions: {', '.join(schema.dimensions or [])}")
    print("\nroles detected:")
    for line in roles.explain():
        print(f"  {line}")
    if quality.issues:
        print("\ntop quality issues:")
        for issue in quality.issues[:5]:
            print(f"  [{issue.severity.value:8s}] {issue.title} - {issue.detail}")
    return 0


# --------------------------------------------------------------------------- #
def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="insightos",
        description="InsightOS - an analytics engine that explains itself.",
    )
    parser.add_argument("--version", action="version", version=f"insightos {__version__}")
    sub = parser.add_subparsers(dest="command", required=True)

    p_analyse = sub.add_parser("analyse", aliases=["analyze"],
                               help="run the full pipeline over a data file")
    p_analyse.add_argument("path")
    p_analyse.add_argument("--json", help="write the full result to this JSON file")
    p_analyse.add_argument("--markdown", help="write the executive report to this file")
    p_analyse.set_defaults(func=cmd_analyse)

    p_profile = sub.add_parser("profile", help="schema, quality and role detection only")
    p_profile.add_argument("path")
    p_profile.set_defaults(func=cmd_profile)

    p_demo = sub.add_parser("demo", help="demo dataset utilities")
    demo_sub = p_demo.add_subparsers(dest="demo_command", required=True)
    p_build = demo_sub.add_parser(
        "build", help="precompute the static JSON the web demo renders")
    p_build.add_argument("--out", default="apps/web/public/demo",
                         help="output directory (default: apps/web/public/demo)")
    p_build.add_argument("--datasets", nargs="*", choices=list(_DEMO_KEYS),
                         help="subset of demo datasets to build")
    p_build.add_argument("--pretty", action="store_true", help="indent the JSON output")
    p_build.add_argument("--with-data", action="store_true",
                         help="also emit a row sample for the data preview table")
    p_build.add_argument("--sample-rows", type=int, default=200)
    p_build.add_argument("--seed", type=int, default=None,
                         help="pin the generator seed (default: rotates monthly, "
                              "so the published demo is new data each period)")
    p_build.add_argument("--strict", action="store_true",
                         help="fail the build if any analysis stage warns")
    p_build.set_defaults(func=cmd_demo_build)

    return parser


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    return int(args.func(args) or 0)


if __name__ == "__main__":  # pragma: no cover
    raise SystemExit(main())
