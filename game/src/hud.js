// hud.js — DOM HUD: health/armour, ammo, money, round score + timer, killfeed,
// banners, buy menu, damage vignette and a canvas minimap (teammates always,
// enemies only in the seconds after they fire — like a real tac-shooter).

import { WORLD } from './world.js';

const $ = (id) => document.getElementById(id);

export class Hud {
  constructor() {
    this.els = {
      health: $('hp-value'), hpBar: $('hp-bar'), armor: $('armor-value'),
      ammoMag: $('ammo-mag'), ammoReserve: $('ammo-reserve'), ammoBox: $('ammo'),
      money: $('money-value'), weapon: $('weapon-name'),
      scoreA: $('score-atk'), scoreD: $('score-def'), timer: $('timer'), round: $('round-label'),
      feed: $('feed'), banner: $('banner'), bannerTitle: $('banner-title'), bannerSub: $('banner-sub'),
      objective: $('objective'), vignette: $('vignette'), hitmarker: $('hitmarker'),
      crosshair: $('crosshair'), plantBar: $('plant'), plantFill: $('plant-fill'), plantLabel: $('plant-label'),
      buy: $('buy'), buyMoney: $('buy-money'), buyItems: $('buy-items'),
      minimap: $('minimap'), lowHp: $('lowhp'),
    };
    this.mapCtx = this.els.minimap.getContext('2d');
    this.hitT = 0;
  }

  setHealth(hp, armor) {
    this.els.health.textContent = Math.max(0, Math.ceil(hp));
    this.els.hpBar.style.width = `${Math.max(0, hp)}%`;
    this.els.hpBar.style.background = hp <= 30 ? '#e5484d' : hp <= 60 ? '#f0a830' : '#7bc47f';
    this.els.armor.textContent = armor ? 'KEVLAR' : '';
    this.els.lowHp.style.opacity = hp > 0 && hp <= 30 ? 0.55 : 0;
  }
  setAmmo(mag, reserve, reloading) {
    this.els.ammoMag.textContent = reloading ? '--' : mag;
    this.els.ammoReserve.textContent = `/ ${reserve}`;
    this.els.ammoBox.classList.toggle('empty', mag === 0 && !reloading);
  }
  setWeapon(name) { this.els.weapon.textContent = name; }
  setMoney(m) { this.els.money.textContent = `$${m}`; }
  setScore(a, d, round, phase, t) {
    this.els.scoreA.textContent = a; this.els.scoreD.textContent = d;
    this.els.round.textContent = `ROUND ${round}`;
    const s = Math.max(0, Math.ceil(t));
    this.els.timer.textContent = phase === 'buy' ? `BUY ${s}` : `${(s / 60) | 0}:${String(s % 60).padStart(2, '0')}`;
    this.els.timer.style.color = phase === 'live' && t <= 10 ? '#e5484d' : '';
  }
  setObjective(text) { this.els.objective.textContent = text; }
  feed(html, color = '#e9e6df') {
    const div = document.createElement('div');
    div.className = 'feed-line'; div.style.color = color; div.innerHTML = html;
    this.els.feed.prepend(div);
    while (this.els.feed.children.length > 5) this.els.feed.lastChild.remove();
    setTimeout(() => { div.style.opacity = '0'; setTimeout(() => div.remove(), 600); }, 4200);
  }
  banner(title, sub = '', ms = 2600) {
    this.els.bannerTitle.textContent = title; this.els.bannerSub.textContent = sub;
    this.els.banner.hidden = false;
    clearTimeout(this._bannerT);
    if (ms > 0) this._bannerT = setTimeout(() => { this.els.banner.hidden = true; }, ms);
  }
  hideBanner() { this.els.banner.hidden = true; }
  hitmark(kill = false) {
    this.els.hitmarker.classList.add('on');
    this.els.hitmarker.style.filter = kill ? 'hue-rotate(-50deg) saturate(3)' : '';
    clearTimeout(this._hitT);
    this._hitT = setTimeout(() => this.els.hitmarker.classList.remove('on'), kill ? 220 : 110);
  }
  hurtFlash() {
    this.els.vignette.style.opacity = 0.75;
    clearTimeout(this._hurtT);
    this._hurtT = setTimeout(() => { this.els.vignette.style.opacity = 0; }, 160);
  }
  setCrosshairSpread(px) {
    this.els.crosshair.style.setProperty('--gap', `${px}px`);
  }
  setPlant(frac, label) {
    if (frac === null) { this.els.plantBar.hidden = true; return; }
    this.els.plantBar.hidden = false;
    this.els.plantFill.style.width = `${Math.round(frac * 100)}%`;
    this.els.plantLabel.textContent = label;
  }
  showBuy(money, owned, onBuy) {
    this.els.buy.hidden = false;
    this.els.buyMoney.textContent = `$${money}`;
    this.els.buyItems.innerHTML = '';
    for (const item of owned) {
      const b = document.createElement('button');
      b.className = 'buy-item'; b.disabled = item.disabled;
      b.innerHTML = `<b>${item.key}</b><span class="buy-name">${item.name}</span><span class="buy-price">${item.owned ? 'OWNED' : '$' + item.price}</span>`;
      b.addEventListener('click', () => onBuy(item.id));
      this.els.buyItems.appendChild(b);
    }
  }
  hideBuy() { this.els.buy.hidden = true; }

  drawMinimap(player, bots, tracersAge) {
    const g = this.mapCtx, S = 148, hx = WORLD.halfX, hz = WORLD.halfZ;
    const px = (x) => (x + hx) / (2 * hx) * S, pz = (z) => (z + hz) / (2 * hz) * S;
    g.clearRect(0, 0, S, S);
    g.fillStyle = 'rgba(20,24,30,0.88)'; g.fillRect(0, 0, S, S);
    // site
    g.strokeStyle = '#ffcf6e'; g.lineWidth = 1.5;
    g.beginPath(); g.arc(px(WORLD.site.x), pz(WORLD.site.z), WORLD.site.r / (2 * hx) * S, 0, 7); g.stroke();
    g.fillStyle = '#ffcf6e'; g.font = 'bold 9px monospace'; g.fillText('A', px(WORLD.site.x) - 3, pz(WORLD.site.z) + 3);
    // containers as blocks
    g.fillStyle = 'rgba(140,150,160,0.5)';
    for (const b of player.collidersForMap) {
      if (b.maxY < 1.2) continue;
      g.fillRect(px(b.minX), pz(b.minZ), Math.max(2, (b.maxX - b.minX) / (2 * hx) * S), Math.max(2, (b.maxZ - b.minZ) / (2 * hz) * S));
    }
    const dot = (x, z, color, r = 3) => { g.fillStyle = color; g.beginPath(); g.arc(px(x), pz(z), r, 0, 7); g.fill(); };
    for (const b of bots) {
      if (!b.alive) continue;
      if (b.team === 'atk') dot(b.x, b.z, '#39d0ba');
      else if ((b.lastShotAt || 0) > performance.now() - 2500) dot(b.x, b.z, '#e5484d');
    }
    // player arrow
    const X = px(player.pos.x), Y = pz(player.pos.z);
    g.save(); g.translate(X, Y); g.rotate(-player.yaw);
    g.fillStyle = '#fff'; g.beginPath(); g.moveTo(0, -5); g.lineTo(3.6, 4); g.lineTo(-3.6, 4); g.closePath(); g.fill();
    g.restore();
  }
}
