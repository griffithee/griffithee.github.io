# Site Update Ritual — griffithee.github.io

**Target time:** < 20 minutes  
**Frequency:** When new chains appear, projects change status, or content needs updating.

---

## When to run this

- A new handoff chain completed in agent-brain (new roots or delegations in chain-registry.json)
- A project changed status (new project, phase complete, production launch)
- Content on a page needs a factual correction
- After a major agent system milestone worth documenting

---

## Order of operations

### 1. Pull latest agent-brain (1 min)

```bash
cd /mnt/c/Users/eabfd/agent-brain
git pull
```

Check for new roots in `watcher/chain-registry.json`. If nothing changed and you're only updating content, skip to step 3.

---

### 2. Refresh chain visualizer data (2 min)

```bash
cd /mnt/c/Users/eabfd/griffithee.github.io
python3 scripts/refresh-chains.py
```

This reads `agent-brain/watcher/chain-registry.json` and regenerates `data/chains.json`.

**Verify:** open `data/chains.json` and confirm the root count and descriptions look right.

If the registry path differs from the default (`/mnt/c/Users/eabfd/agent-brain`):

```bash
python3 scripts/refresh-chains.py --registry /path/to/chain-registry.json
```

Update the snapshot date shown in the visualizer toolbar in `experiments.html`:
```html
<span class="visualizer-title">watcher/chain-registry.json · snapshot YYYY-MM-DD</span>
```

---

### 3. Update project status if needed (5 min)

Edit `data/projects.json` to reflect current project state:
- Change `status` field: `"production"`, `"active"`, `"prototype"`, `"scaffolded"`
- Add new projects (follow the existing object schema)
- Update `"updated"` field to today's date
- Update `"desc"` if the one-liner has changed

Corresponding long-form pages:
- `projects.html` — SaveWisdom, Enough, agent-brain, tax-autofill, gene-toolbox detail sections
- `experiments.html` — autonomy timeline, learnings, open questions

---

### 4. Content edits (5 min, if needed)

Common edit targets:
- `experiments.html` timeline — add a `done` item for completed milestones, update the `active` item
- `experiments.html` learnings — add a new card for a non-obvious finding
- `experiments.html` open questions — move resolved questions to learnings; add new ones
- `about.html` "Current focus" callout — update if focus has shifted
- `projects.html` progress card for Enough — update prompt count, phase status

---

### 5. Syntax check (1 min)

```bash
cd /mnt/c/Users/eabfd/griffithee.github.io
git diff --check
```

Open the changed HTML files in a browser locally if you want to spot-check layout.

---

### 6. Commit and push (2 min)

```bash
cd /mnt/c/Users/eabfd/griffithee.github.io
git add data/chains.json data/projects.json experiments.html projects.html about.html
git commit -m "Update site — refresh chains snapshot + project status"
git push
```

Adjust the `git add` list to only include files you actually changed.

---

### 7. Verify deploy (2 min)

GitHub Pages deploys automatically on push to `master`. Usually live within 1–2 minutes.

Check:
- https://griffithee.github.io/experiments.html — chain visualizer shows updated data
- https://griffithee.github.io/experiments.html#projects-browser — projects browser reflects changes
- No broken links or missing assets (quick scan is enough)

---

## Quick reference: file map

| What you're updating | File |
|---|---|
| Chain visualizer data | `data/chains.json` (run the script, don't hand-edit) |
| Projects browser data | `data/projects.json` |
| Long-form project write-ups | `projects.html` |
| Timeline, learnings, open questions | `experiments.html` |
| About / agent system narrative | `about.html` |
| Home hero / featured projects | `index.html` |
| Design system, global styles | `css/style.css` |
| Chain refresh script | `scripts/refresh-chains.py` |

---

## Automating with the agent system

If you want to hand the update ritual to Claude Code as a handoff:

```
From: Grok (or user)
To: Claude Code
Task: Run the update ritual for griffithee.github.io
  1. git pull agent-brain
  2. python3 scripts/refresh-chains.py
  3. Update data/projects.json if any project status changed
  4. git add changed files, commit, push
  5. Verify GitHub Pages deployed
```

Claude Code can run this end-to-end via the watcher dispatch system.

---

*Last tested: 2026-05-31 (Phase 3 deploy)*
