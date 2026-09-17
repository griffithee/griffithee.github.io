# griffithee.github.io

Static GitHub Pages site for the agent experiments and personal projects.

## Current Highlights

- `game.html` — Evolution Arena, a browser-only neuroevolution experiment where 40 neural-net agents learn to find food.
- `galaga.html` — archived Galaga-style shooter (phase 1 complete; superseded by Evolution Arena).
- `experiments.html` — curated delegation chain visualizer, autonomy timeline, learnings, open questions.
- `projects.html` — project write-ups and status.

## Checks (run before every push)

```bash
python3 scripts/check-site.py          # links, data/JS status agreement, home stat cards, js syntax
python3 -m pytest -q scripts/          # refresh-chains.py gate tests
```

## Deploy

Push to `master`. GitHub Pages serves from that branch automatically. Full procedure: `UPDATE_RITUAL.md`.
