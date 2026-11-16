// world.js — Dustfall Yard: an original container-port map at dusk.
// Builds the three.js scene geometry, the AABB collider list every mover shares,
// a waypoint graph for the bots (links computed by line-of-sight), team spawns
// and Site A, the plant objective. No external assets: textures are painted on
// a canvas at load, geometry is boxes and cylinders, light is one sun + sky.

import * as THREE from 'three';

export const WORLD = {
  halfX: 38,          // yard is 76 x 56 metres
  halfZ: 28,
  site: { x: -19, z: -17, r: 6.5 },
  spawns: {
    atk: [ { x: -6, z: 23 }, { x: 0, z: 24 }, { x: 6, z: 23 } ],
    def: [ { x: -24, z: -21 }, { x: 14, z: -22 }, { x: 24, z: -14 } ],
  },
};

const CONTAINER_COLORS = [0xb5502f, 0x2f6db5, 0x77813a, 0xc2a15a, 0x2a9d8f, 0x8a4b7a];

function asphaltTexture() {
  const c = document.createElement('canvas'); c.width = c.height = 512;
  const g = c.getContext('2d');
  g.fillStyle = '#565d66'; g.fillRect(0, 0, 512, 512);
  for (let i = 0; i < 2600; i++) {
    g.fillStyle = `rgba(${20 + Math.random() * 40 | 0},${22 + Math.random() * 40 | 0},${26 + Math.random() * 40 | 0},0.13)`;
    g.fillRect(Math.random() * 512, Math.random() * 512, 2, 2);
  }
  for (let i = 0; i < 14; i++) { // oil stains
    const x = Math.random() * 512, y = Math.random() * 512, r = 14 + Math.random() * 42;
    const grad = g.createRadialGradient(x, y, 2, x, y, r);
    grad.addColorStop(0, 'rgba(12,12,16,0.5)'); grad.addColorStop(1, 'rgba(12,12,16,0)');
    g.fillStyle = grad; g.beginPath(); g.arc(x, y, r, 0, 7); g.fill();
  }
  g.strokeStyle = 'rgba(230,190,90,0.5)'; g.lineWidth = 3; g.setLineDash([26, 20]);
  g.beginPath(); g.moveTo(0, 256); g.lineTo(512, 256); g.stroke();
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(8, 6);
  t.anisotropy = 4; t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function containerTexture(base) {
  const c = document.createElement('canvas'); c.width = 256; c.height = 128;
  const g = c.getContext('2d');
  const col = new THREE.Color(base);
  g.fillStyle = `#${col.getHexString()}`; g.fillRect(0, 0, 256, 128);
  g.fillStyle = 'rgba(0,0,0,0.16)';
  for (let x = 8; x < 256; x += 24) g.fillRect(x, 0, 7, 128);      // corrugation
  g.fillStyle = 'rgba(255,255,255,0.10)'; g.fillRect(0, 0, 256, 8); g.fillRect(0, 120, 256, 8);
  g.fillStyle = 'rgba(0,0,0,0.28)';
  for (let i = 0; i < 26; i++) g.fillRect(Math.random() * 256, 96 + Math.random() * 32, 3, 3); // grime
  g.font = 'bold 26px monospace'; g.fillStyle = 'rgba(255,255,255,0.55)';
  g.fillText('DFY-' + (1000 + (base % 8999)), 18, 44);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// Segment (2D) vs AABB intersection, for waypoint line-of-sight.
function segHitsBox(x1, z1, x2, z2, b) {
  const dx = x2 - x1, dz = z2 - z1;
  let t0 = 0, t1 = 1;
  for (const [p, d, lo, hi] of [[x1, dx, b.minX, b.maxX], [z1, dz, b.minZ, b.maxZ]]) {
    if (Math.abs(d) < 1e-9) { if (p < lo || p > hi) return false; }
    else {
      let ta = (lo - p) / d, tb = (hi - p) / d;
      if (ta > tb) [ta, tb] = [tb, ta];
      t0 = Math.max(t0, ta); t1 = Math.min(t1, tb);
      if (t0 > t1) return false;
    }
  }
  return true;
}

export function losClear(colliders, x1, z1, x2, z2, ignoreLow = true) {
  for (const b of colliders) {
    if (ignoreLow && b.maxY < 1.2) continue;          // crates you can see over
    if (b.maxY < 0.4) continue;
    if (segHitsBox(x1, z1, x2, z2, b)) return false;
  }
  return true;
}

export function buildWorld(scene) {
  const colliders = [];   // {minX,maxX,minZ,maxZ,minY,maxY}
  const solids = new THREE.Group(); scene.add(solids);
  const boxGeoCache = new Map();
  const boxGeo = (w, h, d) => {
    const k = `${w},${h},${d}`;
    if (!boxGeoCache.has(k)) boxGeoCache.set(k, new THREE.BoxGeometry(w, h, d));
    return boxGeoCache.get(k);
  };
  const addSolid = (mesh, x, y, z) => {
    mesh.position.set(x, y, z); mesh.castShadow = true; mesh.receiveShadow = true;
    solids.add(mesh);
    const s = new THREE.Box3().setFromObject(mesh);
    colliders.push({ minX: s.min.x, maxX: s.max.x, minZ: s.min.z, maxZ: s.max.z, minY: s.min.y, maxY: s.max.y });
    return mesh;
  };

  // Sky, fog, lights — dusk at the port.
  scene.background = new THREE.Color(0x3d4c68);
  scene.fog = new THREE.Fog(0x3d4c68, 60, 140);
  const hemi = new THREE.HemisphereLight(0x9db2d6, 0x4a3f30, 1.35); scene.add(hemi);
  const sun = new THREE.DirectionalLight(0xffb36b, 2.5);
  sun.position.set(-30, 38, -14); sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.left = -50; sun.shadow.camera.right = 50;
  sun.shadow.camera.top = 50; sun.shadow.camera.bottom = -50; sun.shadow.camera.far = 120;
  sun.shadow.bias = -0.0004;
  scene.add(sun);
  const siteGlow = new THREE.PointLight(0xffcf6e, 30, 22, 1.8);
  siteGlow.position.set(WORLD.site.x, 4.5, WORLD.site.z); scene.add(siteGlow);

  // Ground.
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(WORLD.halfX * 2 + 30, WORLD.halfZ * 2 + 30),
    new THREE.MeshStandardMaterial({ map: asphaltTexture(), roughness: 0.95 }),
  );
  ground.rotation.x = -Math.PI / 2; ground.receiveShadow = true; scene.add(ground);

  // Perimeter walls.
  const wallMat = new THREE.MeshStandardMaterial({ color: 0x565d66, roughness: 0.9 });
  const wall = (w, h, d, x, z) => addSolid(new THREE.Mesh(boxGeo(w, h, d), wallMat), x, h / 2, z);
  wall(WORLD.halfX * 2 + 2, 4.5, 1, 0, -WORLD.halfZ - 0.5);
  wall(WORLD.halfX * 2 + 2, 4.5, 1, 0, WORLD.halfZ + 0.5);
  wall(1, 4.5, WORLD.halfZ * 2 + 2, -WORLD.halfX - 0.5, 0);
  wall(1, 4.5, WORLD.halfZ * 2 + 2, WORLD.halfX + 0.5, 0);

  // Shipping containers: [x, z, rotY(0|1 = along z), level]
  const contMats = CONTAINER_COLORS.map((col) => new THREE.MeshStandardMaterial({ map: containerTexture(col), roughness: 0.72, metalness: 0.25 }));
  let ci = 0;
  const container = (x, z, alongZ, level = 0) => {
    const w = alongZ ? 2.44 : 6.06, d = alongZ ? 6.06 : 2.44;
    const m = new THREE.Mesh(boxGeo(w, 2.59, d), contMats[ci++ % contMats.length]);
    return addSolid(m, x, 1.3 + level * 2.6, z);
  };
  // West stack + site cover
  container(-26, -8, true); container(-26, -1.4, true); container(-26, -8, true, 1);
  container(-14, -24.5, false); container(-14, -24.5, false, 1);
  container(-30, -20, false);
  // Mid lanes
  container(-8, -6, false); container(-8, 1, true); container(4, -10, true);
  container(4, -3.4, true); container(12, -14, false); container(12, -14, false, 1);
  container(16, 4, true); container(-2, 10, false); container(-16, 8, true);
  // East stacks
  container(26, -6, true); container(26, 0.6, true); container(28, 14, false);
  container(20, 18, true); container(-24, 16, false); container(8, 18, false);
  container(30, -20, false); container(-4, -20, true);

  // Warehouse block, north-east: a long shed you fight around, not through.
  const shedMat = new THREE.MeshStandardMaterial({ color: 0x707a68, roughness: 0.85 });
  addSolid(new THREE.Mesh(boxGeo(16, 5.5, 7), shedMat), 22, 2.75, -24);
  const roofMat = new THREE.MeshStandardMaterial({ color: 0x49505a, roughness: 0.8 });
  const roof = new THREE.Mesh(boxGeo(17, 0.3, 8), roofMat); roof.position.set(22, 5.65, -24); scene.add(roof);

  // Crates and barriers (low cover, 1.1 m).
  const crateMat = new THREE.MeshStandardMaterial({ color: 0x9a7d4f, roughness: 0.95 });
  const barrierMat = new THREE.MeshStandardMaterial({ color: 0xc7c9cc, roughness: 0.7 });
  const crate = (x, z, s = 1.1) => addSolid(new THREE.Mesh(boxGeo(s, s, s), crateMat), x, s / 2, z);
  const barrier = (x, z, alongZ) => addSolid(new THREE.Mesh(boxGeo(alongZ ? 0.5 : 3, 1.05, alongZ ? 3 : 0.5), barrierMat), x, 0.53, z);
  crate(-19, -17); crate(-17.8, -17); crate(-19, -15.8); crate(-18.4, -16.4, 1.1); // site stack
  crate(-6, -16); crate(0, 4); crate(10, 8); crate(-12, 18); crate(18, -8); crate(24, 8);
  barrier(-10, -12, false); barrier(6, -18, true); barrier(-20, 2, false); barrier(14, 14, true); barrier(-2, -2, false);

  // Site A marker: painted ring + posts + a light gantry.
  const ring = new THREE.Mesh(
    new THREE.RingGeometry(WORLD.site.r - 0.5, WORLD.site.r, 40),
    new THREE.MeshBasicMaterial({ color: 0xffcf6e, transparent: true, opacity: 0.75, side: THREE.DoubleSide }),
  );
  ring.rotation.x = -Math.PI / 2; ring.position.set(WORLD.site.x, 0.03, WORLD.site.z); scene.add(ring);
  const postMat = new THREE.MeshStandardMaterial({ color: 0x333a42, roughness: 0.6, metalness: 0.5 });
  for (const [x, z] of [[-33, -26], [33, -26], [-33, 24], [33, 24], [0, -26]]) {
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 7, 8), postMat);
    pole.position.set(x, 3.5, z); pole.castShadow = true; scene.add(pole);
    const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.28, 10, 8), new THREE.MeshBasicMaterial({ color: 0xffe2a8 }));
    lamp.position.set(x, 7.05, z); scene.add(lamp);
    const pl = new THREE.PointLight(0xffd9a0, 12, 20, 1.9); pl.position.set(x, 6.8, z); scene.add(pl);
  }
  // A gantry crane silhouette for skyline.
  const craneMat = new THREE.MeshStandardMaterial({ color: 0x37404c, roughness: 0.7, metalness: 0.4 });
  for (const x of [-36, 36]) {
    const leg = new THREE.Mesh(boxGeo(0.8, 16, 0.8), craneMat); leg.position.set(x, 8, -30); scene.add(leg);
  }
  const beam = new THREE.Mesh(boxGeo(74, 0.9, 0.9), craneMat); beam.position.set(0, 16, -30); scene.add(beam);

  // Waypoint graph: nodes on a loose grid + hand nodes at lanes/site, linked by LOS.
  const nodes = [];
  const addNode = (x, z) => { nodes.push({ x, z, links: [] }); return nodes.length - 1; };
  for (let gx = -32; gx <= 32; gx += 8) for (let gz = -24; gz <= 24; gz += 8) {
    // skip nodes inside solids
    let inside = false;
    for (const b of colliders) if (gx > b.minX - 0.6 && gx < b.maxX + 0.6 && gz > b.minZ - 0.6 && gz < b.maxZ + 0.6 && b.maxY > 1.2) { inside = true; break; }
    if (!inside) addNode(gx + (gz % 16 === 0 ? 2 : -1), gz);
  }
  addNode(WORLD.site.x, WORLD.site.z); addNode(-19, -8); addNode(-6, -22); addNode(8, -22);
  addNode(0, 16); addNode(-14, 14); addNode(20, 10); addNode(24, -16); addNode(-30, 8);
  for (let i = 0; i < nodes.length; i++) for (let j = i + 1; j < nodes.length; j++) {
    const a = nodes[i], b = nodes[j];
    const d = Math.hypot(a.x - b.x, a.z - b.z);
    if (d < 13 && losClear(colliders, a.x, a.z, b.x, b.z)) { a.links.push(j); b.links.push(i); }
  }
  const nearestNode = (x, z) => {
    let best = 0, bd = 1e9;
    nodes.forEach((n, i) => { const d = (n.x - x) ** 2 + (n.z - z) ** 2; if (d < bd) { bd = d; best = i; } });
    return best;
  };
  const findPath = (x1, z1, x2, z2) => {
    const start = nearestNode(x1, z1), goal = nearestNode(x2, z2);
    if (start === goal) return [{ x: x2, z: z2 }];
    const prev = new Map([[start, -1]]); const q = [start];
    while (q.length) {
      const cur = q.shift();
      if (cur === goal) break;
      for (const nb of nodes[cur].links) if (!prev.has(nb)) { prev.set(nb, cur); q.push(nb); }
    }
    if (!prev.has(goal)) return [{ x: x2, z: z2 }];
    const path = []; let cur = goal;
    while (cur !== -1) { path.push({ x: nodes[cur].x, z: nodes[cur].z }); cur = prev.get(cur); }
    path.reverse(); path.push({ x: x2, z: z2 });
    return path;
  };

  return { colliders, solids, nodes, findPath, nearestNode };
}

// Move a capsule (x,z + radius r) against AABB colliders, axis separated. Mutates pos {x,z}.
export function collideMove(colliders, pos, dx, dz, r = 0.45) {
  pos.x += dx;
  for (const b of colliders) {
    if (b.maxY < 0.5) continue;
    if (pos.x > b.minX - r && pos.x < b.maxX + r && pos.z > b.minZ - r && pos.z < b.maxZ + r) {
      pos.x = dx > 0 ? b.minX - r : b.maxX + r;
    }
  }
  pos.z += dz;
  for (const b of colliders) {
    if (b.maxY < 0.5) continue;
    if (pos.x > b.minX - r && pos.x < b.maxX + r && pos.z > b.minZ - r && pos.z < b.maxZ + r) {
      pos.z = dz > 0 ? b.minZ - r : b.maxZ + r;
    }
  }
  pos.x = Math.max(-WORLD.halfX + r, Math.min(WORLD.halfX - r, pos.x));
  pos.z = Math.max(-WORLD.halfZ + r, Math.min(WORLD.halfZ - r, pos.z));
}
