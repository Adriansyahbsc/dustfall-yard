// bots.js — low-poly soldiers with a waypoint brain: advance on an objective,
// engage on line-of-sight with burst fire, strafe while fighting, fall when hit
// for 0. Shooting is probability-based per bullet (distance, target speed and
// the bot's skill), with real tracers drawn to the hit or miss point, so fights
// read fairly from both sides.

import * as THREE from 'three';
import { collideMove, losClear } from './world.js';
import { sfx } from './audio.js';

export const TEAM_COLORS = { atk: 0x2a9d8f, def: 0xb5502f };
export const TEAM_NAMES = { atk: 'Wardens', def: 'Breachers' };

let botSeq = 0;

export function buildSoldier(team) {
  const g = new THREE.Group();
  const suit = new THREE.MeshStandardMaterial({ color: TEAM_COLORS[team], roughness: 0.8 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x23272d, roughness: 0.7 });
  const skin = new THREE.MeshStandardMaterial({ color: 0x9a7850, roughness: 0.85 });
  const add = (geo, mat, x, y, z) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.castShadow = true; g.add(m); return m; };
  const legL = add(new THREE.BoxGeometry(0.17, 0.78, 0.2), dark, -0.11, 0.39, 0);
  const legR = add(new THREE.BoxGeometry(0.17, 0.78, 0.2), dark, 0.11, 0.39, 0);
  const torso = add(new THREE.BoxGeometry(0.52, 0.62, 0.28), suit, 0, 1.09, 0);
  add(new THREE.BoxGeometry(0.54, 0.2, 0.3), dark, 0, 0.86, 0);              // belt / armour skirt
  const armL = add(new THREE.BoxGeometry(0.13, 0.55, 0.15), suit, -0.34, 1.12, 0.05);
  const armR = add(new THREE.BoxGeometry(0.13, 0.55, 0.15), suit, 0.34, 1.12, 0.05);
  armL.rotation.x = -0.5; armR.rotation.x = -0.9;
  const head = add(new THREE.BoxGeometry(0.3, 0.32, 0.3), skin, 0, 1.58, 0);
  add(new THREE.BoxGeometry(0.34, 0.12, 0.34), dark, 0, 1.78, 0);           // helmet
  add(new THREE.BoxGeometry(0.36, 0.07, 0.1), dark, 0, 1.72, -0.16);        // brim
  const gun = add(new THREE.BoxGeometry(0.07, 0.11, 0.62), dark, 0.22, 1.22, -0.34);
  const muzzle = new THREE.Object3D(); muzzle.position.set(0.22, 1.24, -0.68); g.add(muzzle);
  const flash = new THREE.Mesh(new THREE.SphereGeometry(0.09, 8, 6), new THREE.MeshBasicMaterial({ color: 0xffcf7a, transparent: true, opacity: 0 }));
  flash.position.copy(muzzle.position); flash.scale.set(1, 1, 1.8); g.add(flash);
  g.userData = { legL, legR, torso, head, gun, muzzle, flash };
  return g;
}

export class Bot {
  constructor(scene, world, team, spawn, role, skill = 0.5) {
    this.id = ++botSeq;
    this.team = team; this.role = role; this.skill = skill;
    this.world = world;
    this.pos = { x: spawn.x, z: spawn.z };
    this.yaw = team === 'atk' ? Math.PI : 0;
    this.hp = 100; this.armor = false; this.alive = true;
    this.weaponKind = team === 'def' && role === 'anchor' ? 'dmr' : 'rifle';
    this.mesh = buildSoldier(team);
    this.mesh.position.set(this.pos.x, 0, this.pos.z);
    scene.add(this.mesh);
    this.path = []; this.pathI = 0; this.repathT = 0;
    this.targetPos = null;           // strategic destination {x,z}
    this.enemy = null;               // current visible opponent (Bot or player proxy)
    this.seenT = 0;                  // time since enemy last seen
    this.burstLeft = 0; this.fireCd = 0; this.thinkT = Math.random() * 0.2;
    this.strafeDir = Math.random() < 0.5 ? -1 : 1; this.strafeT = 0;
    this.walkPhase = Math.random() * 6;
    this.flashT = 0; this.hitT = 0;
    this.onShoot = null;             // (bot, targetPos, hit, killed) => void, set by game
    this.onDeath = null;
  }
  get x() { return this.pos.x; } get z() { return this.pos.z; }
  eyeY() { return 1.58; }
  aimPoint() { return new THREE.Vector3(this.pos.x, 1.25, this.pos.z); }

  setDestination(x, z) {
    this.targetPos = { x, z };
    this.path = this.world.findPath(this.pos.x, this.pos.z, x, z);
    this.pathI = 0;
  }

  takeDamage(dmg, from) {
    if (!this.alive) return 0;
    if (this.armor) dmg *= 0.55;
    this.hp -= dmg; this.hitT = 0.12;
    if (from && !this.enemy) { this.enemy = from; this.seenT = 0; }
    if (this.hp <= 0) {
      this.alive = false; this.hp = 0;
      this.mesh.rotation.x = -Math.PI / 2; this.mesh.position.y = 0.25;
      if (this.onDeath) this.onDeath(this, from);
      return 1;
    }
    return 0;
  }

  // opponents: array of {x,z,alive,aimPoint(),takeDamage,isPlayer,team,speed}
  update(dt, opponents, game) {
    if (!this.alive) return;
    const W = this.world;
    this.thinkT -= dt; this.fireCd -= dt; this.seenT += dt;
    if (this.flashT > 0) { this.flashT -= dt; if (this.flashT <= 0) this.mesh.userData.flash.material.opacity = 0; }
    if (this.hitT > 0) { this.hitT -= dt; this.mesh.userData.torso.material.emissive?.setHex(this.hitT > 0 ? 0x661111 : 0x000000); }

    // Perception every ~0.15 s: nearest visible living opponent.
    if (this.thinkT <= 0) {
      this.thinkT = 0.15;
      let best = null, bd = 42;
      for (const o of opponents) {
        if (!o.alive || o.team === this.team) continue;
        const d = Math.hypot(o.x - this.pos.x, o.z - this.pos.z);
        if (d < bd && losClear(W.colliders, this.pos.x, this.pos.z, o.x, o.z)) { best = o; bd = d; }
      }
      if (best) { this.enemy = best; this.seenT = 0; }
      else if (this.seenT > 2.2) this.enemy = null;
      // (Re)path toward the strategic target when not fighting.
      this.repathT -= 0.15;
      if (!this.enemy && this.targetPos && this.repathT <= 0) {
        const d = Math.hypot(this.targetPos.x - this.pos.x, this.targetPos.z - this.pos.z);
        if (d > 2.2) { this.setDestination(this.targetPos.x, this.targetPos.z); this.repathT = 1.6; }
      }
    }

    let mx = 0, mz = 0, speed = 3.1;
    if (this.enemy && this.enemy.alive && this.seenT < 0.6) {
      // Face the enemy, strafe, keep a fighting distance, fire in bursts.
      const dx = this.enemy.x - this.pos.x, dz = this.enemy.z - this.pos.z;
      const d = Math.hypot(dx, dz) || 1;
      this.yaw = Math.atan2(-dx, -dz); // model forward is local -Z; point it at the enemy
      this.strafeT -= dt;
      if (this.strafeT <= 0) { this.strafeT = 0.7 + Math.random() * 0.9; this.strafeDir *= -1; }
      const px = -dz / d, pz = dx / d;
      mx = px * this.strafeDir * 0.8; mz = pz * this.strafeDir * 0.8;
      if (d > 26) { mx += dx / d * 0.9; mz += dz / d * 0.9; speed = 3.6; }
      if (d < 7) { mx -= dx / d * 0.5; mz -= dz / d * 0.5; }
      this.tryFire(dt, d, game);
    } else if (this.path.length && this.pathI < this.path.length) {
      const wp = this.path[this.pathI];
      const dx = wp.x - this.pos.x, dz = wp.z - this.pos.z;
      const d = Math.hypot(dx, dz);
      if (d < 0.9) this.pathI++;
      else {
        mx = dx / d; mz = dz / d; speed = this.role === 'rusher' ? 3.9 : 3.3;
        this.yaw = Math.atan2(dx, dz) + Math.PI;
      }
    } else if (this.targetPos) {
      const dx = this.targetPos.x - this.pos.x, dz = this.targetPos.z - this.pos.z;
      if (Math.hypot(dx, dz) > 1.6) this.setDestination(this.targetPos.x, this.targetPos.z);
      else this.yaw += dt * 0.4 * Math.sin(performance.now() * 0.0004 + this.id); // idle scan
    }

    const ml = Math.hypot(mx, mz);
    if (ml > 0.01) {
      mx = mx / Math.max(1, ml); mz = mz / Math.max(1, ml);
      collideMove(W.colliders, this.pos, mx * speed * dt, mz * speed * dt, 0.45);
      this.walkPhase += dt * speed * 2.4;
    }
    this.mesh.position.set(this.pos.x, 0, this.pos.z);
    this.mesh.rotation.y = this.yaw;
    const sw = Math.sin(this.walkPhase) * 0.4;
    this.mesh.userData.legL.rotation.x = ml > 0.01 ? sw : 0;
    this.mesh.userData.legR.rotation.x = ml > 0.01 ? -sw : 0;
  }

  tryFire(dt, dist, game) {
    if (this.fireCd > 0) return;
    if (this.burstLeft <= 0) {
      this.burstLeft = 3 + (Math.random() * 3 | 0);
      this.fireCd = 0.45 + Math.random() * 0.55 - this.skill * 0.2;
      return;
    }
    this.burstLeft--;
    this.fireCd = this.weaponKind === 'dmr' ? 0.85 : 0.13;
    const target = this.enemy;
    // Hit probability: base by skill, worse vs fast/far targets, better up close.
    let p = 0.16 + this.skill * 0.3 - dist * 0.004 - (target.speedNow || 0) * 0.03;
    p = Math.max(0.05, Math.min(0.62, p));
    const hit = Math.random() < p;
    const muzzle = new THREE.Vector3();
    this.mesh.userData.muzzle.getWorldPosition(muzzle);
    const aim = target.aimPoint();
    if (!hit) { aim.x += (Math.random() - 0.5) * 2.4; aim.y += Math.random() * 1.2; aim.z += (Math.random() - 0.5) * 2.4; }
    this.mesh.userData.flash.material.opacity = 0.95; this.flashT = 0.05;
    sfx.shot(this.weaponKind, true);
    let killed = 0;
    if (hit) killed = target.takeDamage(this.weaponKind === 'dmr' ? 55 : 24, this) ? 1 : 0;
    if (this.onShoot) this.onShoot(this, muzzle, aim, hit, killed);
  }
}
