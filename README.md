# dustfall-yard

[![make.fun · threejs-fps-02](https://make.fun/badge/threejs-fps-02.svg)](https://make.fun/bounty/threejs-fps-02?utm_source=github&utm_medium=readme&utm_campaign=threejs-fps-02)
[![rank](https://make.fun/badge/threejs-fps-02/adriansyahbsc/dustfall-yard/rank.svg)](https://make.fun/bounty/threejs-fps-02/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=threejs-fps-02)
[![reward](https://make.fun/badge/threejs-fps-02/adriansyahbsc/dustfall-yard/reward.svg)](https://make.fun/bounty/threejs-fps-02?utm_source=github&utm_medium=readme&utm_campaign=threejs-fps-02)

**Dustfall Yard** — a round-based tactical FPS in three.js, Counter-Strike-STYLE and
wholly original: your own dusk container-yard map, teams (the Wardens vs the
Breachers), weapons, art and synthesized sounds. Single-player against bots:
you plus two bot teammates attack Site A against three bot defenders. Short
rounds won by elimination or by the objective — plant the charge at Site A and
defend it, or be eliminated / defused / out-timed. A money economy between
rounds buys better guns and kevlar, and accuracy counts more than speed:
spread blooms when you move or spray and settles when you stop, crouch or aim.

## Run it

```sh
node serve.ts        # serves game/ at http://localhost:8080
# or hand the entry in (copies game/ + screenshots/ to the output dir, writes dossier.json):
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts
```

Needs Node.js 22.18+ and a desktop browser with WebGL 2. No build step, no
network request: three.js 0.187.0 is vendored under `game/vendor/three/`
(byte-for-byte npm builds, as the bounty requires) and loaded through the one
import map in `game/index.html`.

## Controls

| Input | Action |
|---|---|
| W A S D / Space / Ctrl | Move / jump / crouch |
| Mouse, click, right-click | Look, fire, aim (zoom + tighter spread) |
| R · 1 / 2 | Reload · switch weapon |
| B, then 1–4 or click (buy phase) | Buy SMG / rifle / DMR / kevlar |
| E (hold, inside Site A) | Plant the charge (3.5 s) |

## What's in the game

- **Rounds & economy** — first to 7 rounds; 12 s buy phase, 100 s rounds,
  $800 start, kill/plant/win/loss bonuses, weapons lost when you die.
- **Four original guns** — P9 Patrol pistol, Kestrel-9 SMG, AR-7 Longshore
  rifle, Harpoon .308 DMR — distinct damage, cadence, spread and zoom,
  distance falloff, headshot multipliers, recoil and bloom.
- **Bots with a waypoint brain** — a line-of-sight waypoint graph over the
  yard; teammates rush and support the push, defenders anchor Site A, hold
  mid and rotate; everyone strafes and fires probability-modelled bursts
  with real tracers, and defenders retake and defuse a planted charge.
- **A full HUD** — health + kevlar, ammo, money, round score and timer,
  killfeed, hitmarkers, damage vignette, plant progress, buy menu, and a
  minimap (teammates always; enemies flash when they fire).
- **Original presentation** — procedural asphalt and container textures, a
  gantry-crane skyline, dusk lighting with shadows, and every sound
  synthesized live with WebAudio (shots, hits, beeps, the detonation).

## Layout

- `main.ts` — the hand-in program (Node 22, stdlib only): copies `game/` and
  `screenshots/` to `/output` (`MAKEFUN_OUTPUT_DIR` outside the grader) and
  writes `dossier.json` with `vendor/makefun-threejs.ts` (the kit's library,
  byte-identical).
- `game/` — the playable game as static ES modules; `game/src/` holds
  `main.js` (game/round logic), `world.js` (map, colliders, waypoints),
  `bots.js` (bot bodies + AI), `weapons.js`, `hud.js`, `audio.js`.
- `screenshots/` — real renders of this game in headless Chromium
  (`shots.json` lists the staged `?shot=` URLs used to take them).
- `serve.ts` — tiny static server for local play.

## Submission checklist (threejs-fps-02)

- [x] `main.ts` at root; `node main.ts` exits 0 and writes a dossier that the
      kit library reproduces byte-for-byte
- [x] `vendor/makefun-threejs.ts` unchanged from the kit (sha256 verified)
- [x] three.js 0.187.0 files under `game/vendor/three/` byte-for-byte, one
      import map mapping `three` to `./vendor/three/three.module.min.js`
- [x] 3 screenshots, JPEG, 1280×960, each ≤ 256 KiB, real renders of the game
- [x] MIT LICENSE with SPDX line
- [ ] Public GitHub repo created after 2026-11-14T21:30Z under
      `adriansyahbsc`, About set (homepage = the bounty page, topic `makefun`)
- [ ] Transcript bundle from the kit CLI + wallet-signed entry message —
      **at submit time only (the parent/user step; nothing submitted by the build)**

---

Entered on [make.fun](https://make.fun/?utm_source=github&utm_medium=readme&utm_campaign=threejs-fps-02) · AI agents build software for cash rewards
