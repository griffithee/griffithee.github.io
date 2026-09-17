# Site Update Ritual — griffithee.github.io

**Target time:** < 20 minutes  
**Frequency:** When a chain worth showing closes, a project changes status, or content needs correcting.

Working clone: `~/projects/griffithee.github.io` (WSL). A second clone exists at
`/mnt/c/Users/eabfd/griffithee.github.io`; keep it fast-forwarded (`git pull`) after pushing, or ignore it.

---

## When to run this

- A significant handoff chain closed in agent-brain and deserves the public visualizer
- A project changed status (new project, phase complete, production launch, halted, paused)
- Content on a page needs a factual correction
- After a major agent system milestone worth documenting

---

## Order of operations

### 1. Pull latest agent-brain (1 min)

```bash
cd /mnt/c/Users/eabfd/agent-brain
git pull
```

### 2. Curate and refresh chain visualizer data (3 min)

The watcher registers **every** dispatch in `watcher/chain-registry.json`, including weekly tickler nudges.
Curation is the `"public": true` flag on a root, not membership in the file
(`agent-brain/watcher/README.md` → "Public Chain Visualizer Curation").

1. In `chain-registry.json`, add `"public": true` to any root worth showing.
2. If a chain finished while the watcher was down, set its `status` to `"closed"` by hand.
3. Commit and push agent-brain.
4. Regenerate:

```bash
cd ~/projects/griffithee.github.io
python3 scripts/refresh-chains.py
```

Only flagged roots are published. If no root is flagged the script publishes everything and warns; `--all` forces that. Output is sorted by date. Verify `data/chains.json` reads right.

The visualizer toolbar snapshot label auto-updates from `data/chains.json` metadata.

### 3. Update project status if needed (5 min)

Edit `data/projects.json`:
- `status` must be one of the keys in `STATUS_TAG_CLASS` in `js/projects-browser.js`
  (`production`, `active`, `complete`, `prototype`, `paused`, `halted`, `scaffolded`). The site check enforces this.
- Add new projects following the existing schema; set `"updated"` to today.

Long-form pages: `projects.html` (per-project sections), `experiments.html` (timeline, learnings, open questions).

### 4. Content edits (5 min, if needed)

- `experiments.html` timeline: keep it chronological; one `active` item at the bottom
- `experiments.html` learnings and open questions: move resolved questions to learnings
- `about.html` "Current focus" and the agent roster
- `index.html` stat cards: the `data-stat="closed-chains"` / `"active-chains"` values must match `data/chains.json` (the check fails otherwise)

Ground truth for counts: SaveWisdom = `last_answered_number` in
`agent-brain/projects/savewisdom/state/savewisdom-question-coach.json`; automation status = an observed run, not a doc.

### 5. Check (1 min)

```bash
cd ~/projects/griffithee.github.io
python3 scripts/check-site.py
python3 -m pytest -q scripts/
git diff --check
```

All three must be clean.

### 6. Commit and push (2 min)

```bash
git add -A
git commit -m "Claude Code: refresh chains snapshot + project status"
git push
```

### 7. Verify deploy (2 min)

GitHub Pages deploys on push to `master`, usually within 1–2 minutes. Compare live to local:

```bash
for p in index projects experiments about; do curl -s https://griffithee.github.io/$p.html | cmp -s - $p.html && echo "$p live" || echo "$p not yet"; done
```

---

## Quick reference: file map

| What you're updating | File |
|---|---|
| Chain visualizer data | `data/chains.json` (run the script, don't hand-edit) |
| Chain curation | `agent-brain/watcher/chain-registry.json` (`"public": true`) |
| Projects browser data | `data/projects.json` |
| Long-form project write-ups | `projects.html` |
| Timeline, learnings, open questions | `experiments.html` |
| About / agent system narrative | `about.html` |
| Home hero / featured projects / stat cards | `index.html` |
| Design system, global styles | `css/style.css` |
| Chain refresh script + tests | `scripts/refresh-chains.py`, `scripts/test_refresh_chains.py` |
| Site gate check | `scripts/check-site.py` |

---

## Automation

The handoff watcher that used to run this ritual from a Hermes cron is dormant (Hermes retired September 2026).
Run it from a Claude Code session: "Do a review and update griffithee.github.io."

---

*Last tested: 2026-09-17 (curated refresh, site check, live compare)*
