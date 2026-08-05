# Accessibility Audit — InsightOS Web Client

**Scope:** `apps/web` (Next.js 14 static export). Reviewed against **WCAG 2.1 AA**.
**Method:** Manual source review of every interactive component, landmark,
form control and loading state. Automated/browser-based auditing (axe,
Lighthouse) is **not** included in this pass — see *Verification limitations*.
**Date:** 2026-05-08 · **Reviewer:** RC engineering pass.

> **Verification limitations.** The local sandbox cannot run the toolchain
> (`npm install` is OOM-killed), so this audit is a **static/manual** review of
> source, not a runtime axe-core or screen-reader test. Runtime AT testing
> (NVDA/VoiceOver + keyboard) is listed as a deferred verification task. Any
> code change that results from this audit is verified by **GitHub Actions CI**,
> which is the authoritative gate for this Release Candidate.

## Summary

The web client is **already accessibility-conscious**. The review found a broad
set of correct patterns already in place and a **small** number of genuine,
low-severity gaps. Nothing found rises to a blocker for a 1.0 Release Candidate.

| Severity | Count | Status |
| --- | --- | --- |
| Critical | 0 | — |
| High | 0 | — |
| Medium | 1 | Fixed in RC (A-01) |
| Low | 4 | 1 fixed (A-02); 3 deferred/documented |
| Advisory | 3 | Documented |

## Strengths already present (no change required)

These are verified in source and intentionally **not** modified:

- **Skip link** to main content: `app/page.tsx` and `landing-page.tsx` render
  `<a href="#workspace-main" class="sr-only focus:not-sr-only …">Skip to analysis</a>`.
- **Landmark regions:** `<header>` (`top-nav.tsx`), `<nav aria-label="Workspace views">`
  (top and mobile), `<main id="workspace-main">` on every route.
- **Single `<h1>` per view:** landing hero, workspace dataset title, settings page.
- **Icon-only controls are named:** every icon button carries an `aria-label`
  (`Open datasets and metrics`, `Toggle colour theme`, `Source on GitHub`,
  `Close the navigation sheet`, …) and decorative icons are `aria-hidden`.
- **Visible focus:** `focus-visible:outline focus-visible:outline-2
  focus-visible:outline-offset-2 focus-visible:outline-accent` is applied
  consistently across buttons, links and tabs.
- **Current state exposed:** navigation uses `aria-current="page"`.
- **Dialogs:** the mobile "More views" sheet uses `role="dialog"`,
  `aria-modal="true"`, an `aria-label`, Escape-to-close, and moves focus to the
  first control on open (`mobile-nav.tsx`).
- **Touch targets:** icon buttons are `h-11 w-11` (44px); mobile nav items are
  `min-h-[56px]`; secondary sheet rows `min-h-[52px]`; the workspace "Upload
  dataset" button is `min-h-[44px]`.
- **Data tables are described:** `<caption class="sr-only">` on the SQL results,
  governance and explainability tables; the SQL input has an `sr-only <label>`.
- **Document language:** `<html lang="en">` in `app/layout.tsx`.
- **Brand SVG is labelled:** `brand-mark.tsx` uses `role="img"` +
  `aria-label="InsightOS"`.
- **Reduced-motion friendliness:** the only motion is the skeleton pulse and
  colour transitions; no parallax or autoplaying media.

## Findings

### A-01 — Loading state is not announced to assistive technology · **Medium** · *Fixed in RC*

- **Component:** `apps/web/app/page.tsx` (`LoadingState`), consuming
  `Skeleton` from `components/ui/primitives.tsx`.
- **Observed:** while analysis loads, the UI renders bare `<Skeleton>` blocks.
  There is no `role="status"`, `aria-live` or `aria-busy` anywhere on the path
  (grep: `role="status"` = 0, `aria-live` = 1 total in the app). A screen-reader
  user hears nothing between navigation and content appearing.
- **WCAG:** 4.1.3 Status Messages (AA).
- **Recommendation:** wrap the skeleton group in a container with
  `role="status"` + `aria-live="polite"` and a visually-hidden
  "Loading analysis…" label; mark the decorative skeleton blocks `aria-hidden`.
  No layout or behavioural change.
- **Status:** **Implemented** in the RC (isolated commit). Verified by CI.

### A-02 — `Skeleton` primitive has no way to hide decorative pulses from AT · **Low** · *Fixed in RC*

- **Component:** `components/ui/primitives.tsx` (`Skeleton`).
- **Observed:** `Skeleton` renders a plain `<div>` with no prop to pass through
  `aria-hidden`/`className` semantics beyond `className`. It already accepts
  `className`, but consumers cannot mark it decorative without extra wrappers.
- **Recommendation:** allow `Skeleton` to spread standard div attributes so a
  caller can pass `aria-hidden`. Purely additive and type-safe.
- **Status:** **Implemented** alongside A-01. Verified by CI.

### A-03 — `Segmented` control uses tab roles without full tabs-pattern semantics · **Low** · *Deferred (documented)*

- **Component:** `components/ui/primitives.tsx` (`Segmented`).
- **Observed:** it renders `role="tablist"` with `role="tab"`/`aria-selected`
  children, but there is no associated `role="tabpanel"`, no `aria-controls`,
  and no arrow-key roving-tabindex — so it advertises the ARIA tabs pattern
  without fully implementing it. In practice it is used as a segmented
  *toggle*, not a tabbed panel switch.
- **WCAG:** 4.1.2 Name, Role, Value (A).
- **Recommendation (deferred):** the *correct* minimal fix is to change the
  roles to a radio-group semantic (`role="radiogroup"` + `role="radio"`), which
  matches its real behaviour, **or** add full arrow-key handling. Both alter
  keyboard/interaction behaviour, which is out of scope for the RC "safe,
  non-functional" rule. **Deferred to v1.1** and tracked in `KNOWN_ISSUES.md`.
- **Status:** Documented, not changed (RC stability rule).

### A-04 — Colour-contrast tokens not instrumented · **Low** · *Deferred (documented)*

- **Component:** design tokens (`text-subtle`, `text-muted`, badge tones) via
  Tailwind + CSS variables in `globals.css`.
- **Observed:** the palette *appears* to meet AA for body text, but contrast
  ratios were **not** measured in this pass (no runtime tooling available).
  Small `text-2xs`/`text-subtle` labels are the most likely to be marginal.
- **Recommendation (deferred):** run axe/Lighthouse contrast checks in CI or
  locally on a machine with the toolchain; adjust the two or three lowest tokens
  only if measured below 4.5:1 (normal) / 3:1 (large). No speculative changes
  now — that would risk the visual system for an unmeasured benefit.
- **Status:** Deferred to a measured pass (v1.1); tracked in `KNOWN_ISSUES.md`.

### A-05 — Charts convey information without a text alternative in some panels · **Low** · *Deferred (documented)*

- **Component:** `components/charts/*` (waterfall, marimekko, donut, area,
  forecast).
- **Observed:** the product's core principle guarantees a **narrative** beside
  every chart (`ChartSpec` requires `narrative`), which mitigates this well —
  the *meaning* is always in text next to the visual. However, the SVG chart
  elements themselves are not individually labelled (`role="img"` + `aria-label`
  summarising the trend).
- **Recommendation (deferred):** add a concise `aria-label`/`<title>` to each
  chart's root SVG summarising what the adjacent narrative already states. Low
  risk but touches many chart components, so batched for a focused v1.1 pass to
  keep RC commits small and reviewable.
- **Status:** Deferred to v1.1; tracked in `KNOWN_ISSUES.md`.

## Advisory (no action required for 1.0)

- **AD-1 — Theme toggle announces generically.** `aria-label="Toggle colour
  theme"` is correct; an enhancement would be to reflect state
  (`aria-pressed`), but the label is not misleading. Advisory only.
- **AD-2 — `aria-live` for AI answers.** The Insight Analyst streams grounded
  answers; announcing completion via a polite live region would help AT users.
  Additive, but touches the AI runtime path — **out of scope** for the RC "no AI
  changes" rule. Advisory for v1.1.
- **AD-3 — Runtime AT test matrix.** Establish an NVDA + VoiceOver + keyboard-only
  smoke checklist executed per release. Process improvement, not a code defect.

## Implementation status (this RC)

| ID | Severity | Action | Commit | Verification |
| --- | --- | --- | --- | --- |
| A-01 | Medium | `role="status"` + polite live region + hidden label on loading | isolated | GitHub Actions CI |
| A-02 | Low | `Skeleton` spreads div attrs so callers can mark decorative | with A-01 | GitHub Actions CI |
| A-03 | Low | Documented, deferred to v1.1 | — | — |
| A-04 | Low | Documented, deferred to measured pass | — | — |
| A-05 | Low | Documented, deferred to v1.1 | — | — |

No change in this audit alters analytics, the deterministic engine, the AI
architecture, layout, or any workflow.
