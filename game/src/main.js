// main.js — DUSTFALL YARD, a round-based tactical FPS in three.js.
// Wardens (you + 2 bot teammates) attack a container yard at dusk: eliminate
// the Breachers or plant the charge at Site A and defend it. Breachers win by
// eliminating you, running the clock, or defusing. Money between rounds buys
// better guns and kevlar. First to 7 rounds takes the match.
// Everything is original: map, names, art and synthesized sounds.

import * as THREE from 'three';
import { buildWorld, collideMove, losClear, WORLD } from './world.js';
import { Bot, TEAM_NAMES } from './bots.js';
import { WEAPONS, ARMOR_PRICE, BUY_LIST, buildViewModel } from './weapons.js';
import { Hud } from './hud.js';
import { initAudio, sfx } from './audio.js';

// ---------- deterministic rng for screenshot staging ----------
const params = new URLSearchParams(location.search);
const SHOT = params.get('shot');
let seed = Number(params.get('seed') || 1) >>> 0;
function srand() { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; }

// ---------- renderer / scene ----------
const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(devicePixelRatio, 1.6));
renderer.setSize(innerWidth, innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.32;
document.getElementById('game').appendChild(renderer.domElement);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(78, innerWidth / innerHeight, 0.08, 300);
const world = buildWorld(scene);
const hud = new Hud();

// ---------- audio ----------
addEventListener('pointerdown', initAudio, { once: false });

// ---------- player ----------
const player = {
  team: 'atk', isPlayer: true,
  pos: { x: 0, z: 24 }, vel: { x: 0, z: 0 }, vy: 0, groundY: 0,
  yaw: 0, pitch: 0, hp: 100, armor: false, alive: true,
  money: 800, weapons: new Set(['pistol']), current: 'pistol',
  ammo: {}, reserve: {},
  speedNow: 0, crouch: false, eye: 1.62,
  lastShotAt: 0,
  aimPoint() { return new THREE.Vector3(this.pos.x, 1.3, this.pos.z); },
  get x() { return this.pos.x; }, get z() { return this.pos.z; },
  collidersForMap: world.colliders,
  takeDamage(dmg, from) {
    if (!player.alive || phase === 'over' || phase === 'menu') return 0;
    if (player.armor) dmg *= 0.55;
    player.hp -= dmg;
    hud.hurtFlash(); sfx.hurt();
    hud.setHealth(player.hp, player.armor);
    if (from && performance.now() - (player._hurtFeedT || 0) > 3500) {
      player._hurtFeedT = performance.now();
      hud.feed(`<b>${from.name || 'Enemy'}</b> is hitting you`, '#e5484d');
    }
    if (player.hp <= 0) { killPlayer(from); return 1; }
    return 0;
  },
};
function resetAmmo(id) { const w = WEAPONS[id]; player.ammo[id] = w.mag; player.reserve[id] = w.reserve; }
resetAmmo('pistol');

// view model
let viewModel = null;
function setViewModel() {
  if (viewModel) { camera.remove(viewModel); }
  viewModel = buildViewModel(WEAPONS[player.current].kind);
  camera.add(viewModel);
}
scene.add(camera);
{ // a soft fill so the view model and whatever is in front of it read at dusk
  const fill = new THREE.PointLight(0xffe0b8, 2.6, 6, 1.4);
  fill.position.set(0.15, -0.05, 0.1); camera.add(fill);
}
setViewModel();

// ---------- tracers / particles ----------
const tracerPool = [];
{
  const geo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]);
  for (let i = 0; i < 40; i++) {
    const mat = new THREE.LineBasicMaterial({ color: 0xffd9a0, transparent: true, opacity: 0 });
    const line = new THREE.Line(geo.clone(), mat); line.frustumCulled = false; scene.add(line);
    tracerPool.push({ line, t: 0 });
  }
}
let tracerI = 0;
function tracer(a, b, color = 0xffd9a0) {
  const tr = tracerPool[tracerI++ % tracerPool.length];
  const p = tr.line.geometry.attributes.position;
  p.setXYZ(0, a.x, a.y, a.z); p.setXYZ(1, b.x, b.y, b.z); p.needsUpdate = true;
  tr.line.material.color.setHex(color); tr.line.material.opacity = 0.85;
  tr.max = tr.t = SHOT ? 2.5 : 0.07;   // staged screenshots hold tracers so the shot reads
}
const burstGeo = new THREE.BufferGeometry();
const burstPos = new Float32Array(300 * 3); burstGeo.setAttribute('position', new THREE.BufferAttribute(burstPos, 3));
const burstPts = new THREE.Points(burstGeo, new THREE.PointsMaterial({ color: 0xffa050, size: 0.2, transparent: true, opacity: 0 }));
burstPts.frustumCulled = false; scene.add(burstPts);
let burstVel = [], burstT = 0;
function explosionFX(at) {
  for (let i = 0; i < 300; i++) {
    burstPos[i * 3] = at.x; burstPos[i * 3 + 1] = 1; burstPos[i * 3 + 2] = at.z;
    burstVel.push(new THREE.Vector3((Math.random() - 0.5) * 22, Math.random() * 17 + 3, (Math.random() - 0.5) * 22));
  }
  burstGeo.attributes.position.needsUpdate = true;
  burstPts.material.opacity = 1; burstT = 1.4;
  const flash = new THREE.PointLight(0xffa050, 900, 60, 1.6); flash.position.set(at.x, 3, at.z); scene.add(flash);
  setTimeout(() => scene.remove(flash), 350);
  sfx.explosion();
}

// ---------- bots & names ----------
const ALLY_NAMES = ['Vex', 'Odo'];
const ENEMY_NAMES = ['Rook', 'Sable', 'Mire'];
let bots = [];
function spawnBots() {
  for (const b of bots) scene.remove(b.mesh);
  bots = [];
  const mk = (team, name, spawn, role, skill) => {
    const b = new Bot(scene, world, team, spawn, role, skill);
    b.name = name;
    b.onShoot = (bot, muzzle, aim, hit, killed) => {
      tracer(muzzle, aim, bot.team === 'atk' ? 0x9fe8dc : 0xffb0a0);
      bot.lastShotAt = performance.now();
      if (killed) {
        const victim = bot.enemy;
        hud.feed(`<b>${name}</b> ▸ ${victim === player ? 'You' : victim.name}`, bot.team === 'atk' ? '#39d0ba' : '#e5484d');
        if (bot.team === 'atk') { /* team kill credit handled in checkRoundEnd */ }
      }
    };
    b.onDeath = (bot, from) => {
      if (from === player) { player.money += 300; hud.setMoney(player.money); hud.feed(`<b>You</b> ▸ ${bot.name}`, '#7bc47f'); }
      checkRoundEnd();
    };
    bots.push(b); return b;
  };
  // allies
  const a1 = mk('atk', ALLY_NAMES[0], WORLD.spawns.atk[0], 'rusher', 0.5);
  const a2 = mk('atk', ALLY_NAMES[1], WORLD.spawns.atk[2], 'support', 0.45);
  a1.armor = true; a2.armor = false;
  // defenders
  const d1 = mk('def', ENEMY_NAMES[0], { x: -16, z: -20 }, 'anchor', 0.55);
  const d2 = mk('def', ENEMY_NAMES[1], { x: 4, z: -16 }, 'mid', 0.5);
  const d3 = mk('def', ENEMY_NAMES[2], WORLD.spawns.def[2], 'rotate', 0.48);
  d1.armor = true; d2.armor = true;
  planBots();
}
function planBots() {
  for (const b of bots) {
    if (!b.alive) continue;
    if (phase === 'planted') {
      if (b.team === 'atk') b.setDestination(WORLD.site.x + (b.id % 3 - 1) * 4, WORLD.site.z + 3);
      else if (chargePos) b.setDestination(chargePos.x, chargePos.z);
    } else if (b.team === 'atk') {
      if (b.role === 'rusher') b.setDestination(-13, -9);
      else b.setDestination(-22, -11);
    } else {
      if (b.role === 'anchor') b.setDestination(-16.5, -18.5);
      else if (b.role === 'mid') b.setDestination(2, -13);
      else b.setDestination(19, -9);
    }
  }
}

// ---------- round / match state ----------
let phase = 'menu';            // menu | buy | live | planted | over | matchover
let roundNum = 0, scoreAtk = 0, scoreDef = 0;
let phaseT = 0, roundT = 0;
let chargePos = null, chargeMesh = null, defuseT = 0, plantT = 0;
let playerDiedThisRound = false;
const WIN_SCORE = 7, ROUND_TIME = 100, BUY_TIME = 12, PLANT_TIME = 32;

function startMatch() {
  scoreAtk = 0; scoreDef = 0; roundNum = 0;
  player.money = 800; player.weapons = new Set(['pistol']); player.current = 'pistol'; player.armor = false;
  resetAmmo('pistol'); setViewModel();
  startRound();
}

function startRound() {
  roundNum++;
  if (playerDiedThisRound) { player.weapons = new Set(['pistol']); if (!player.weapons.has(player.current)) player.current = 'pistol'; player.armor = false; }
  playerDiedThisRound = false;
  player.alive = true; player.hp = 100;
  player.pos = { x: WORLD.spawns.atk[1].x, z: WORLD.spawns.atk[1].z };
  player.yaw = 0; player.pitch = 0; player.vy = 0;
  for (const id of player.weapons) resetAmmo(id);
  if (!player.weapons.has(player.current)) player.current = 'pistol';
  setViewModel();
  chargePos = null; defuseT = 0; plantT = 0;
  if (chargeMesh) { scene.remove(chargeMesh); chargeMesh = null; }
  spawnBots();
  phase = 'buy'; phaseT = BUY_TIME;
  hud.setHealth(100, player.armor); hud.setMoney(player.money);
  hud.setWeapon(WEAPONS[player.current].name);
  hud.setAmmo(player.ammo[player.current], player.reserve[player.current], false);
  hud.setObjective('Buy phase — press B · then push Site A');
  hud.banner(`ROUND ${roundNum}`, `${TEAM_NAMES.atk} ${scoreAtk} — ${scoreDef} ${TEAM_NAMES.def}`, 2400);
  showBuyMenu();
}

function buyItemsState() {
  return BUY_LIST.map((id, i) => {
    if (id === 'armor') return { id, key: String(i + 1), name: 'Kevlar Vest', price: ARMOR_PRICE, owned: player.armor, disabled: player.armor || player.money < ARMOR_PRICE };
    const w = WEAPONS[id];
    return { id, key: String(i + 1), name: w.name, price: w.price, owned: player.weapons.has(id), disabled: player.weapons.has(id) || player.money < w.price };
  });
}
function showBuyMenu() { hud.showBuy(player.money, buyItemsState(), doBuy); }
function doBuy(id) {
  if (phase !== 'buy') return;
  if (id === 'armor') {
    if (player.armor || player.money < ARMOR_PRICE) { sfx.denied(); return; }
    player.armor = true; player.money -= ARMOR_PRICE;
  } else {
    const w = WEAPONS[id];
    if (player.weapons.has(id) || player.money < w.price) { sfx.denied(); return; }
    player.weapons.add(id); resetAmmo(id); player.current = id; setViewModel();
    hud.setWeapon(w.name); hud.setAmmo(player.ammo[id], player.reserve[id], false);
  }
  sfx.buy(); hud.setMoney(player.money); hud.setHealth(player.hp, player.armor);
  showBuyMenu();
}

function endRound(winner, reason) {
  if (phase === 'over' || phase === 'matchover') return;
  phase = 'over'; phaseT = 4.2;
  hud.hideBuy(); hud.setPlant(null);
  if (winner === 'atk') { scoreAtk++; player.money += 2700; } else { scoreDef++; player.money += 1900; }
  player.money = Math.min(9000, player.money);
  hud.setMoney(player.money);
  const won = winner === 'atk';
  hud.banner(won ? 'ROUND WON' : 'ROUND LOST', reason, 4000);
  if (won) sfx.roundWin(); else sfx.roundLose();
  if (scoreAtk >= WIN_SCORE || scoreDef >= WIN_SCORE) {
    phase = 'matchover'; phaseT = 9;
    hud.banner(scoreAtk > scoreDef ? 'MATCH WON' : 'MATCH LOST', `Final ${scoreAtk} — ${scoreDef} · click to play again`, 9000);
  }
}

function checkRoundEnd() {
  if (phase !== 'live' && phase !== 'planted') return;
  const atkAlive = (player.alive ? 1 : 0) + bots.filter((b) => b.team === 'atk' && b.alive).length;
  const defAlive = bots.filter((b) => b.team === 'def' && b.alive).length;
  if (defAlive === 0) endRound('atk', 'Breachers eliminated');
  else if (atkAlive === 0) endRound('def', 'Wardens eliminated');
}

function killPlayer(from) {
  player.alive = false; playerDiedThisRound = true; player.hp = 0;
  hud.setHealth(0, player.armor);
  hud.banner('YOU ARE DOWN', 'Your team fights on — watching at double speed', 2600);
  document.exitPointerLock?.();
  checkRoundEnd();
}

// ---------- input ----------
const keys = {};
let locked = false, firing = false, aiming = false, reloadUntil = 0, nextShotAt = 0, bloom = 0;
addEventListener('keydown', (e) => {
  keys[e.code] = true;
  if (phase === 'buy' && ['Digit1', 'Digit2', 'Digit3', 'Digit4'].includes(e.code)) doBuy(BUY_LIST[Number(e.code.slice(-1)) - 1]);
  if (e.code === 'KeyB' && phase === 'buy') showBuyMenu();
  if (e.code === 'KeyR') startReload();
  if (e.code === 'Digit1' && player.weapons.has('pistol')) switchWeapon('pistol');
  if (e.code === 'Digit2') { const owned = [...player.weapons].filter((w) => w !== 'pistol')[0]; if (owned) switchWeapon(owned); }
  if (['Space', 'KeyW', 'KeyA', 'KeyS', 'KeyD'].includes(e.code)) e.preventDefault();
});
addEventListener('keyup', (e) => { keys[e.code] = false; });
addEventListener('mousedown', (e) => {
  initAudio();
  if (!locked) return;
  if (e.button === 0) firing = true;
  if (e.button === 2) aiming = true;
});
addEventListener('mouseup', (e) => { if (e.button === 0) firing = false; if (e.button === 2) aiming = false; });
addEventListener('contextmenu', (e) => e.preventDefault());
document.addEventListener('pointerlockchange', () => {
  locked = document.pointerLockElement === renderer.domElement;
  if (!locked) { firing = false; aiming = false; }
  document.getElementById('overlay').hidden = locked || phase === 'menu' || !!SHOT;
  if (!locked && (phase === 'live' || phase === 'planted') && player.alive) {
    document.getElementById('overlay-title').textContent = 'Paused';
    document.getElementById('overlay-copy').textContent = 'Click to get back in.';
    document.getElementById('overlay').hidden = false;
  }
});
addEventListener('mousemove', (e) => {
  if (!locked) return;
  const sens = aiming ? 0.0011 : 0.0021;
  player.yaw -= e.movementX * sens;
  player.pitch = Math.max(-1.45, Math.min(1.45, player.pitch - e.movementY * sens));
});

function switchWeapon(id) {
  if (player.current === id || performance.now() < reloadUntil) return;
  player.current = id; setViewModel();
  hud.setWeapon(WEAPONS[id].name);
  hud.setAmmo(player.ammo[id], player.reserve[id], false);
}
function startReload() {
  const w = WEAPONS[player.current];
  if (performance.now() < reloadUntil || player.ammo[player.current] >= w.mag || player.reserve[player.current] <= 0) return;
  reloadUntil = performance.now() + w.reloadMs;
  sfx.reload();
  hud.setAmmo(player.ammo[player.current], player.reserve[player.current], true);
}
function finishReload() {
  const w = WEAPONS[player.current];
  const take = Math.min(w.mag - player.ammo[player.current], player.reserve[player.current]);
  player.ammo[player.current] += take; player.reserve[player.current] -= take;
  hud.setAmmo(player.ammo[player.current], player.reserve[player.current], false);
}

// ---------- shooting ----------
const raycaster = new THREE.Raycaster();
const botBody = new THREE.Box3(), botHead = new THREE.Box3();
function shoot(now) {
  const w = WEAPONS[player.current];
  if (now < nextShotAt || now < reloadUntil) return;
  if (player.ammo[player.current] <= 0) { sfx.dryFire(); nextShotAt = now + 300; startReload(); return; }
  nextShotAt = now + 60000 / w.rpm;
  player.ammo[player.current]--;
  hud.setAmmo(player.ammo[player.current], player.reserve[player.current], false);
  sfx.shot(w.kind);
  bloom = Math.min(0.05, bloom + 0.006);
  // recoil + muzzle flash
  player.pitch += 0.011 + Math.random() * 0.005;
  player.yaw += (Math.random() - 0.5) * 0.003;
  if (viewModel) { viewModel.position.z = -0.38; viewModel.userData.flash.material.opacity = 0.95; }
  const spread = (w.spread + (player.speedNow > 0.5 ? w.moveSpread : 0) + bloom) * (aiming ? 0.55 : 1) * (player.crouch ? 0.7 : 1);
  const dir = new THREE.Vector3(0, 0, -1).applyEuler(new THREE.Euler(player.pitch, player.yaw, 0, 'YXZ'));
  dir.x += (Math.random() - 0.5) * 2 * spread; dir.y += (Math.random() - 0.5) * 2 * spread; dir.z += (Math.random() - 0.5) * 2 * spread;
  dir.normalize();
  const origin = new THREE.Vector3(player.pos.x, player.eye, player.pos.z);
  // nearest wall hit
  raycaster.set(origin, dir); raycaster.far = w.range + 40;
  const wallHits = raycaster.intersectObject(world.solids, false);
  let wallDist = wallHits.length ? wallHits[0].distance : Infinity;
  // nearest bot hit (head/body boxes)
  let hitBot = null, hitHead = false, hitDist = Infinity;
  for (const b of bots) {
    if (!b.alive || b.team === 'atk') continue;
    botBody.set(new THREE.Vector3(b.x - 0.3, 0.75, b.z - 0.3), new THREE.Vector3(b.x + 0.3, 1.45, b.z + 0.3));
    botHead.set(new THREE.Vector3(b.x - 0.19, 1.44, b.z - 0.19), new THREE.Vector3(b.x + 0.19, 1.82, b.z + 0.19));
    const p = new THREE.Vector3();
    if (raycaster.ray.intersectBox(botHead, p)) { const d = origin.distanceTo(p); if (d < hitDist) { hitDist = d; hitBot = b; hitHead = true; } }
    if (raycaster.ray.intersectBox(botBody, p)) { const d = origin.distanceTo(p); if (d < hitDist) { hitDist = d; hitBot = b; hitHead = false; } }
  }
  const muzzle = new THREE.Vector3(player.pos.x, player.eye - 0.12, player.pos.z).addScaledVector(dir, 0.6);
  if (hitBot && hitDist < wallDist) {
    const fall = hitDist > w.range ? 0.45 : 1;
    const dmg = w.damage * (hitHead ? w.headMult : 1) * fall;
    const killed = hitBot.takeDamage(dmg, player);
    tracer(muzzle, raycaster.ray.at(hitDist, new THREE.Vector3()));
    hud.hitmark(!!killed);
    if (killed) sfx.kill(); else sfx.hit();   // kill $300 is credited in Bot.onDeath
  } else if (wallDist < Infinity) {
    tracer(muzzle, raycaster.ray.at(wallDist, new THREE.Vector3()));
  } else {
    tracer(muzzle, raycaster.ray.at(60, new THREE.Vector3()));
  }
  player.lastShotAt = now;
}

// ---------- plant / defuse ----------
function tryPlant(dt) {
  const inSite = Math.hypot(player.pos.x - WORLD.site.x, player.pos.z - WORLD.site.z) < WORLD.site.r;
  const want = keys['KeyE'] && inSite && player.alive && phase === 'live';
  if (!want) { if (phase === 'live') hud.setPlant(null); plantT = 0; return; }
  plantT += dt;
  hud.setPlant(plantT / 3.5, 'PLANTING THE CHARGE…');
  if ((plantT * 2 | 0) !== ((plantT - dt) * 2 | 0)) sfx.beep();
  if (plantT >= 3.5) {
    plantT = 0; hud.setPlant(null);
    phase = 'planted'; phaseT = PLANT_TIME;
    chargePos = { x: player.pos.x, z: player.pos.z };
    chargeMesh = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.28, 0.36), new THREE.MeshStandardMaterial({ color: 0x2b2f36, roughness: 0.5 }));
    chargeMesh.position.set(chargePos.x, 0.14, chargePos.z); scene.add(chargeMesh);
    const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.05, 8, 6), new THREE.MeshBasicMaterial({ color: 0xff4444 }));
    lamp.position.set(0, 0.2, 0); chargeMesh.add(lamp); chargeMesh.userData.lamp = lamp;
    sfx.plantDone();
    hud.banner('CHARGE PLANTED', 'Defend Site A', 2200);
    hud.setObjective('Charge planted — defend it');
    player.money += 300; hud.setMoney(player.money);
    planBots();
  }
}
function updateDefuse(dt) {
  if (phase !== 'planted' || !chargePos) return;
  const def = bots.find((b) => b.team === 'def' && b.alive && Math.hypot(b.x - chargePos.x, b.z - chargePos.z) < 1.8);
  const guarded = bots.some((b) => b.team === 'atk' && b.alive && Math.hypot(b.x - chargePos.x, b.z - chargePos.z) < 7) || player.alive && Math.hypot(player.pos.x - chargePos.x, player.pos.z - chargePos.z) < 7;
  if (def && !guarded) {
    defuseT += dt;
    if (defuseT >= 5) { endRound('def', 'The charge was defused'); return; }
  } else defuseT = Math.max(0, defuseT - dt);
  // beeps accelerate
  const interval = phaseT > 10 ? 1 : phaseT > 5 ? 0.5 : 0.25;
  if ((phaseT % interval) < dt) sfx.beep(phaseT <= 0.3);
  if (chargeMesh) chargeMesh.userData.lamp.material.color.setHex((performance.now() % 500) < 250 ? 0xff4444 : 0x551111);
}

// ---------- per-frame update ----------
const clock = new THREE.Clock();
let minimapT = 0;
function update() {
  requestAnimationFrame(update);
  let dt = Math.min(clock.getDelta(), 0.05);
  const now = performance.now();
  const timeScale = (!player.alive && (phase === 'live' || phase === 'planted')) ? 2.4 : 1;
  dt *= timeScale;

  // phase timers
  if (phase === 'buy') {
    phaseT -= dt;
    hud.setObjective('Buy phase — press B · then push Site A');
    if (phaseT <= 0) { phase = 'live'; phaseT = ROUND_TIME; hud.hideBuy(); hud.banner('ROUND LIVE', 'Eliminate the Breachers — or plant at Site A', 1800); hud.setObjective('Plant the charge at Site A · or eliminate the Breachers'); }
  } else if (phase === 'live') {
    phaseT -= dt;
    if (phaseT <= 0) endRound('def', 'Time expired — Site A holds');
  } else if (phase === 'planted') {
    phaseT -= dt;
    if (phaseT <= 0 && phase === 'planted') {
      explosionFX(chargePos);
      endRound('atk', 'The charge detonated at Site A');
    }
  } else if (phase === 'over' || phase === 'matchover') {
    phaseT -= dt;
    if (phaseT <= 0) {
      if (phase === 'matchover') { hud.banner('MATCH OVER', 'Click Play to run it again', 0); phase = 'menu'; showMenu(); }
      else startRound();
    }
  }
  hud.setScore(scoreAtk, scoreDef, Math.max(1, roundNum), phase, phaseT);

  // player movement (not in buy freeze, alive, locked or shot mode)
  const canMove = player.alive && phase !== 'buy' && phase !== 'over' && phase !== 'matchover' && (locked || SHOT);
  player.crouch = !!(keys['ControlLeft'] || keys['KeyC']);
  if (canMove) {
    const speed = player.crouch ? 2.6 : 5.3;
    let fx = 0, fz = 0;
    if (keys['KeyW']) fz -= 1; if (keys['KeyS']) fz += 1;
    if (keys['KeyA']) fx -= 1; if (keys['KeyD']) fx += 1;
    const l = Math.hypot(fx, fz) || 1; fx /= l; fz /= l;
    const sin = Math.sin(player.yaw), cos = Math.cos(player.yaw);
    const wx = (fx * cos - fz * sin), wz = (fx * sin + fz * cos);
    // note: forward is -Z at yaw 0; rotate input by yaw
    const mx = (fx * Math.cos(player.yaw) + fz * Math.sin(player.yaw));
    const mz = (-fx * Math.sin(player.yaw) + fz * Math.cos(player.yaw));
    void wx; void wz;
    collideMove(world.colliders, player.pos, mx * speed * dt, mz * speed * dt, 0.45);
    player.speedNow = (fx || fz) ? speed : 0;
    if (keys['Space'] && player.groundY === 0) player.vy = 4.8;
  } else player.speedNow = 0;
  // gravity / jump
  player.vy -= 13 * (dt / timeScale);
  player.groundY = Math.max(0, player.groundY + player.vy * (dt / timeScale));
  if (player.groundY === 0) player.vy = 0;
  const targetEye = (player.crouch ? 1.18 : 1.62) + player.groundY;
  player.eye += (targetEye - player.eye) * Math.min(1, dt * 10);
  // camera: first person when alive, slow orbit of the site when down
  if (player.alive) {
    camera.position.set(player.pos.x, player.eye, player.pos.z);
    camera.rotation.order = 'YXZ';
    camera.rotation.set(player.pitch, player.yaw, 0);
    camera.fov += (((aiming && locked) ? 78 / WEAPONS[player.current].zoom : 78) - camera.fov) * Math.min(1, dt * 12);
    camera.updateProjectionMatrix();
  } else if (phase === 'live' || phase === 'planted' || phase === 'over') {
    const t = now * 0.00012;
    camera.position.set(WORLD.site.x + Math.cos(t) * 17, 10.5, WORLD.site.z + Math.sin(t) * 17);
    camera.lookAt(WORLD.site.x, 0, WORLD.site.z);
    if (viewModel) viewModel.visible = false;
  }
  if (player.alive && viewModel) viewModel.visible = true;
  // view model recovery / flash fade
  if (viewModel) {
    viewModel.position.z += (-0.45 - viewModel.position.z) * Math.min(1, dt * 14);
    viewModel.userData.flash.material.opacity *= 0.6;
    viewModel.rotation.x = player.crouch ? 0.04 : 0;
  }
  bloom = Math.max(0, bloom - dt * 0.03);
  hud.setCrosshairSpread(6 + bloom * 300 + player.speedNow * 1.6);
  if (reloadUntil && now >= reloadUntil) { reloadUntil = 0; finishReload(); }
  if (firing && locked && player.alive && (phase === 'live' || phase === 'planted')) {
    shoot(now);
    if (!WEAPONS[player.current].auto) firing = false;
  }

  tryPlant(dt / timeScale);
  updateDefuse(dt);
  // bots think & fight (frozen in buy phase)
  if (phase === 'live' || phase === 'planted' || phase === 'over') {
    const opponents = [player, ...bots];
    for (const b of bots) b.update(dt, opponents, null);
    checkRoundEnd();
  }
  // tracers fade
  for (const tr of tracerPool) if (tr.t > 0) { tr.t -= dt; tr.line.material.opacity = Math.max(0, tr.t / (tr.max || 0.07)) * 0.85; }
  // explosion particles
  if (burstT > 0) {
    burstT -= dt;
    for (let i = 0; i < burstVel.length; i++) {
      burstPos[i * 3] += burstVel[i].x * dt; burstPos[i * 3 + 1] = Math.max(0.1, burstPos[i * 3 + 1] + burstVel[i].y * dt); burstPos[i * 3 + 2] += burstVel[i].z * dt;
      burstVel[i].y -= 9 * dt;
    }
    burstGeo.attributes.position.needsUpdate = true;
    burstPts.material.opacity = Math.max(0, burstT / 1.4);
    if (burstT <= 0) burstVel = [];
  }
  // minimap ~10 fps
  minimapT -= dt;
  if (minimapT <= 0) { minimapT = 0.1; hud.drawMinimap(player, bots); }
  renderer.render(scene, camera);
}

// ---------- menu / boot ----------
const overlay = document.getElementById('overlay');
function showMenu() {
  overlay.hidden = false;
  document.getElementById('overlay-title').textContent = 'DUSTFALL YARD';
  document.getElementById('overlay-copy').textContent = 'Round-based tactical FPS in a dusk container yard. You lead the Wardens: plant the charge at Site A or clear the Breachers. First to 7 rounds.';
  document.getElementById('play').textContent = 'Click to play';
}
document.getElementById('play').addEventListener('click', () => {
  initAudio();
  overlay.hidden = true;
  if (phase === 'menu') startMatch();
  renderer.domElement.requestPointerLock();
});
overlay.addEventListener('click', (e) => {
  if (e.target === overlay && phase !== 'menu' && player.alive) renderer.domElement.requestPointerLock();
});
addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});

// ---------- screenshot staging (?shot=start|play|end&seed=n) ----------
function stageShot(kind) {
  overlay.hidden = true;
  roundNum = 3; scoreAtk = 2; scoreDef = 1;
  player.weapons = new Set(['pistol', 'rifle']); player.current = 'rifle'; setViewModel();
  player.money = 2450;
  spawnBots();
  if (kind === 'start') {
    phase = 'buy'; phaseT = BUY_TIME;
    player.pos = { x: 0, z: 24 }; player.yaw = 0.35; player.pitch = -0.02;
    hud.setHealth(100, true); hud.setMoney(player.money); hud.setWeapon('AR-7 Longshore');
    hud.setAmmo(30, 120, false); hud.setObjective('Buy phase — press B · then push Site A');
    hud.banner('ROUND 3', 'Wardens 2 — 1 Breachers', 0);
    showBuyMenu();
  } else if (kind === 'play') {
    phase = 'live'; phaseT = 47;
    player.pos = { x: -1, z: 7 }; player.yaw = 0.5; player.pitch = -0.03;
    player.hp = 78; player.armor = true;
    hud.setHealth(78, true); hud.setMoney(player.money); hud.setWeapon('AR-7 Longshore');
    hud.setAmmo(24, 90, false); hud.setObjective('Plant the charge at Site A · or eliminate the Breachers');
    // stage a visible firefight down mid lane
    const foe = bots.find((b) => b.team === 'def' && b.role === 'mid');
    foe.pos.x = -5.6; foe.pos.z = -3.2; foe.mesh.position.set(foe.pos.x, 0, foe.pos.z);
    foe.mesh.rotation.y = Math.atan2(-(player.pos.x - foe.pos.x), -(player.pos.z - foe.pos.z));
    const ally = bots.find((b) => b.team === 'atk');
    ally.pos.x = -4.2; ally.pos.z = 2.5; ally.mesh.position.set(ally.pos.x, 0, ally.pos.z);
    hud.feed('<b>Vex</b> ▸ Mire', '#39d0ba'); hud.feed('<b>Rook</b> is hitting you', '#e5484d');
    setTimeout(() => {
      const a = new THREE.Vector3(player.pos.x, 1.5, player.pos.z);
      const b = new THREE.Vector3(foe.pos.x, 1.25, foe.pos.z);
      tracer(a, b, 0xffd9a0); tracer(b, a.clone().add(new THREE.Vector3(0.4, 0.2, 0)), 0xffb0a0);
    }, 350);
  } else { // end
    phase = 'over'; phaseT = 60; scoreAtk = 4; scoreDef = 2;
    player.pos = { x: -11, z: -7 }; player.yaw = 0.66; player.pitch = -0.1; // looking at Site A
    hud.setHealth(46, true); hud.setMoney(5150); hud.setWeapon('AR-7 Longshore');
    hud.setAmmo(17, 60, false); hud.setObjective('Charge detonated');
    chargePos = { x: WORLD.site.x, z: WORLD.site.z };
    explosionFX(chargePos);
    hud.banner('ROUND WON', 'The charge detonated at Site A', 0);
    for (const b of bots) if (b.team === 'def') { b.alive = false; b.mesh.rotation.x = -Math.PI / 2; b.mesh.position.y = 0.25; }
  }
  hud.setScore(scoreAtk, scoreDef, roundNum, phase === 'buy' ? 'buy' : 'live', phaseT);
  hud.drawMinimap(player, bots);
}

if (SHOT) {
  stageShot(SHOT);
  let frames = 0;
  const iv = setInterval(() => { if (++frames >= 12) { window.__shotReady = true; clearInterval(iv); } }, 100);
} else {
  showMenu();
}
update();
