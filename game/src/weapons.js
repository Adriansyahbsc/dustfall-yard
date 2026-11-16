// weapons.js — the Dustfall Yard armoury: four original guns with distinct
// damage / cadence / spread trade-offs. Accuracy counts: spread blooms while
// moving or spraying and settles when you stop, crouch or aim.

import * as THREE from 'three';

export const WEAPONS = {
  pistol: { id: 'pistol', name: 'P9 Patrol', kind: 'pistol', price: 0,    damage: 27, headMult: 3.2, rpm: 340, auto: false, mag: 12, reserve: 72,  reloadMs: 1050, spread: 0.011, moveSpread: 0.02,  range: 70, pellets: 1, zoom: 1.15 },
  smg:    { id: 'smg',    name: 'Kestrel-9', kind: 'smg',    price: 1300, damage: 21, headMult: 2.6, rpm: 820, auto: true,  mag: 32, reserve: 128, reloadMs: 1500, spread: 0.02,  moveSpread: 0.045, range: 48, pellets: 1, zoom: 1.15 },
  rifle:  { id: 'rifle',  name: 'AR-7 Longshore', kind: 'rifle', price: 2700, damage: 34, headMult: 3.4, rpm: 600, auto: true, mag: 30, reserve: 120, reloadMs: 1750, spread: 0.008, moveSpread: 0.03, range: 90, pellets: 1, zoom: 1.25 },
  dmr:    { id: 'dmr',    name: 'Harpoon .308', kind: 'dmr',  price: 3300, damage: 72, headMult: 3.6, rpm: 165, auto: false, mag: 10, reserve: 40,  reloadMs: 2100, spread: 0.002, moveSpread: 0.05, range: 130, pellets: 1, zoom: 2.4 },
};
export const ARMOR_PRICE = 650;
export const BUY_LIST = ['smg', 'rifle', 'dmr', 'armor'];

// A low-poly first-person view model built from boxes: receiver, barrel,
// magazine, sight. One per weapon kind, tinted by price tier.
export function buildViewModel(kind) {
  const g = new THREE.Group();
  const dark = new THREE.MeshStandardMaterial({ color: 0x22262c, roughness: 0.45, metalness: 0.65 });
  const mid = new THREE.MeshStandardMaterial({ color: 0x3a4149, roughness: 0.5, metalness: 0.55 });
  const accent = new THREE.MeshStandardMaterial({ color: kind === 'dmr' ? 0x8a6b35 : 0x2a9d8f, roughness: 0.5, metalness: 0.3 });
  const box = (w, h, d, x, y, z, mat = dark) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat); m.position.set(x, y, z); g.add(m); return m;
  };
  if (kind === 'pistol') {
    box(0.055, 0.09, 0.21, 0, 0, -0.05, mid);
    box(0.045, 0.11, 0.06, 0, -0.09, 0.02, dark);
    box(0.012, 0.03, 0.012, 0, 0.06, -0.14, accent);
  } else if (kind === 'smg') {
    box(0.06, 0.09, 0.4, 0, 0, -0.12, mid);
    box(0.035, 0.035, 0.2, 0, 0.005, -0.4, dark);
    box(0.045, 0.16, 0.055, 0, -0.12, -0.1, dark);
    box(0.05, 0.06, 0.12, 0, -0.02, 0.12, dark);
    box(0.014, 0.035, 0.014, 0, 0.065, -0.3, accent);
  } else if (kind === 'dmr') {
    box(0.06, 0.085, 0.52, 0, 0, -0.18, mid);
    box(0.03, 0.03, 0.3, 0, 0.01, -0.55, dark);
    box(0.045, 0.13, 0.05, 0, -0.1, -0.14, dark);
    box(0.055, 0.05, 0.16, 0, 0.085, -0.16, dark);            // scope body
    box(0.02, 0.02, 0.02, 0, 0.085, -0.25, accent);           // scope lens glint
    box(0.05, 0.07, 0.14, 0, -0.03, 0.14, dark);
  } else { // rifle
    box(0.062, 0.095, 0.48, 0, 0, -0.16, mid);
    box(0.032, 0.032, 0.24, 0, 0.005, -0.5, dark);
    box(0.048, 0.17, 0.058, 0, -0.125, -0.12, dark);
    box(0.052, 0.06, 0.15, 0, -0.02, 0.15, dark);
    box(0.05, 0.045, 0.09, 0, 0.075, -0.2, dark);             // carry sight
    box(0.014, 0.035, 0.014, 0, 0.07, -0.42, accent);
  }
  // hands: two simple mitts so it reads as held, not floating
  const skin = new THREE.MeshStandardMaterial({ color: 0x8a6844, roughness: 0.8 });
  const glove = new THREE.Mesh(new THREE.BoxGeometry(0.075, 0.06, 0.11), skin);
  glove.position.set(0.01, -0.075, -0.3); g.add(glove);
  const glove2 = new THREE.Mesh(new THREE.BoxGeometry(0.075, 0.06, 0.1), skin);
  glove2.position.set(-0.015, -0.1, 0.03); g.add(glove2);
  const flash = new THREE.Mesh(
    new THREE.SphereGeometry(0.05, 8, 6),
    new THREE.MeshBasicMaterial({ color: 0xffcf7a, transparent: true, opacity: 0 }),
  );
  flash.position.set(0, 0.01, kind === 'dmr' ? -0.72 : kind === 'pistol' ? -0.17 : -0.62);
  flash.scale.set(1, 1, 1.9); g.add(flash);
  g.userData.flash = flash;
  g.position.set(0.25, -0.235, -0.48);
  g.scale.setScalar(0.85);
  return g;
}
