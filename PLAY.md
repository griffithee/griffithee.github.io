# Arcade Run Play Notes

## Controls

- `Left` / `Right` arrows or `A` / `D`: move.
- `Space`: fire.
- `M`: toggle sound.
- `R`: restart.
- On touch, the left/right/fire buttons work and the canvas can be dragged to steer.

## Update Ritual

1. Edit `js/galaga.js` and/or `game.html`.
2. Play through at least a couple of waves and check whether the loop still feels fair.
3. Run a syntax check:

```bash
node --check js/galaga.js
```

4. Confirm the homepage and project browser still link to the game.
5. Commit to `master` and push. GitHub Pages deploys from that branch.

## Phase 1 Scope

- Player ship movement and shooting.
- Formation enemies with dive attacks and return-to-grid behavior.
- Score, lives, wave progression, and simple sound.
- No tractor beam, no bosses, no long progression layer.
