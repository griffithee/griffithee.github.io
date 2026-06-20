# Evolution Arena Play Notes

## Controls

- `1x`, `5x`, `20x`: change simulation speed.
- `Pause` / `Resume`: stop or restart the simulation loop.
- Click or tap the arena to drop a food pellet.
- Refresh the page to restart from random neural-network weights.

## Update Ritual

1. Edit `js/evolution.js` and/or `game.html`.
2. Run several generations at `20x` and confirm agents, food, HUD values, and generation rollover still behave correctly.
3. Run a syntax check:

```bash
node --check js/evolution.js
```

4. Confirm the homepage and project browser still link to the game.
5. Commit to `master` and push. GitHub Pages deploys from that branch.

## Current Scope

- 40 agents controlled by tiny neural networks.
- Genetic algorithm with top-parent selection, crossover, mutation, and elite carryover.
- Food placement, speed controls, pause/resume, and live HUD.
- No backend, API calls, persistence, or pre-trained model.
