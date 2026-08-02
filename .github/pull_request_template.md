## What changed

<!-- One paragraph. What does this PR do, and why is it the right shape? -->

## Analytical impact

- [ ] No change to any published figure
- [ ] Changes engine output (explain which datasets and metrics move, and why the new
      numbers are more correct than the old ones)

## Checklist

- [ ] `ruff check insightos tests` passes
- [ ] `pytest` passes
- [ ] New engine behaviour is covered by a test against planted ground truth
- [ ] Every new `ChartSpec` carries a narrative (the constructor enforces this)
- [ ] No figure is produced by an LLM
