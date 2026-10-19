import './style.css';
import { Capacitor } from '@capacitor/core';
import { App } from '@capacitor/app';
import { StatusBar, Style } from '@capacitor/status-bar';
import { LocalNotifications } from '@capacitor/local-notifications';

/* ------------------------------------------------------------------ *
 *  Données de base
 * ------------------------------------------------------------------ */
const NATIVE = Capacitor.isNativePlatform();
const CHANNEL_ID = 'kairos-rappels';

const OUAGA = { id: 'ouaga', name: 'Ouagadougou', short: 'Ouaga', country: 'Burkina Faso', tz: 'Africa/Ouagadougou' };
const NY = { id: 'ny', name: 'New York', short: 'New York', country: 'États-Unis', tz: 'America/New_York' };
const PARIS = { id: 'paris', name: 'Paris', short: 'Paris', country: 'France', tz: 'Europe/Paris' };
const CITIES = [OUAGA, NY, PARIS];

// Jours des rappels : w = numéro Capacitor (1 = dimanche … 7 = samedi)
const DAYS = [
  { w: 2, short: 'Lun' },
  { w: 3, short: 'Mar' },
  { w: 4, short: 'Mer' },
  { w: 5, short: 'Jeu' },
  { w: 6, short: 'Ven' },
  { w: 7, short: 'Sam' },
  { w: 1, short: 'Dim' },
];

// Jours de la carte : lundi = 0 … dimanche = 6
const DAY_SHORT = ['Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam', 'Dim'];
const DAY_LONG = ['Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi', 'Samedi', 'Dimanche'];
const DAY_INITIAL = ['L', 'M', 'M', 'J', 'V', 'S', 'D'];
const EN_DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const LEVELS = ['Très faible', 'Faible', 'Modéré', 'Bon', 'Élevé', 'Très élevé'];

/* Engagement moyen sur X par jour et par heure (0 h → 23 h, heure locale de l'audience).
   Niveaux lus à l'œil sur une carte publiée par Sprout Social (7 nov. 2025 – 27 fév. 2026),
   approximation à ±1 niveau. 0 = très faible … 5 = très élevé. */
const HEAT = [
  [1, 1, 0, 0, 0, 0, 0, 1, 2, 2, 3, 4, 4, 4, 5, 5, 4, 5, 4, 4, 4, 4, 3, 2], // Lun
  [2, 1, 1, 0, 0, 1, 1, 1, 2, 3, 4, 4, 5, 5, 5, 5, 5, 5, 5, 4, 4, 4, 4, 3], // Mar
  [2, 1, 1, 0, 0, 1, 1, 2, 2, 3, 4, 4, 5, 5, 5, 5, 5, 5, 5, 4, 4, 4, 4, 3], // Mer
  [2, 1, 1, 0, 0, 1, 1, 2, 2, 3, 4, 4, 5, 5, 5, 5, 5, 5, 5, 4, 4, 4, 3, 2], // Jeu
  [2, 1, 1, 0, 0, 0, 1, 2, 2, 3, 3, 4, 4, 5, 5, 4, 4, 4, 4, 3, 3, 3, 2, 2], // Ven
  [2, 1, 1, 0, 0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 4, 4, 4, 4, 4, 3, 3, 3, 3, 2], // Sam
  [2, 1, 0, 0, 0, 0, 0, 1, 1, 2, 3, 3, 4, 4, 4, 4, 4, 4, 4, 3, 3, 3, 3, 2], // Dim
];

/* ------------------------------------------------------------------ *
 *  Utilitaires
 * ------------------------------------------------------------------ */
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
const pad = (n) => String(n).padStart(2, '0');
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const store = {
  get(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch {
      return fallback;
    }
  },
  set(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch {
      /* stockage indisponible */
    }
  },
};

let settings = { theme: 'light', h24: true, seconds: true, audience: 'ny', ...store.get('kairos.settings', {}) };
let reminders = store.get('kairos.reminders', []);
let nextId = store.get('kairos.nextId', 1);

let toastTimer;
function toast(msg) {
  const el = $('#toast');
  el.textContent = msg;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (el.hidden = true), 3200);
}

const lastHTML = new Map();
function setHTML(el, html) {
  if (lastHTML.get(el) !== html) {
    el.innerHTML = html;
    lastHTML.set(el, html);
  }
}

/* ------------------------------------------------------------------ *
 *  Heures et fuseaux (règles saisonnières via Intl, jamais de décalage fixe)
 * ------------------------------------------------------------------ */
const fmtCache = new Map();
function dtf(key, locale, opts) {
  let f = fmtCache.get(key);
  if (!f) {
    f = new Intl.DateTimeFormat(locale, opts);
    fmtCache.set(key, f);
  }
  return f;
}

function clockParts(date, tz) {
  const f = dtf(`c|${tz}|${settings.h24}`, 'fr-FR', {
    timeZone: tz,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: settings.h24 ? 'h23' : 'h12',
  });
  const p = {};
  for (const x of f.formatToParts(date)) p[x.type] = x.value;
  return { hm: `${p.hour}:${p.minute}`, s: p.second, ap: (p.dayPeriod || '').toUpperCase() };
}

function hourIn(date, tz) {
  const f = dtf(`h|${tz}`, 'en-GB', { timeZone: tz, hour: 'numeric', hourCycle: 'h23' });
  return parseInt(f.format(date), 10) % 24;
}

function dayIndex(date, tz) {
  return EN_DAYS.indexOf(dtf(`w|${tz}`, 'en-US', { timeZone: tz, weekday: 'short' }).format(date));
}

function dateLabel(date, tz) {
  const f = dtf(`d|${tz}`, 'fr-FR', { timeZone: tz, weekday: 'long', day: 'numeric', month: 'long' });
  return cap(f.format(date));
}

function ymd(date, tz) {
  return dtf(`y|${tz}`, 'en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);
}

function dayDiff(a, b) {
  return Math.round((Date.parse(a + 'T00:00:00Z') - Date.parse(b + 'T00:00:00Z')) / 86400000);
}

function offsetLabel(date, tz) {
  try {
    const f = dtf(`o|${tz}`, 'fr-FR', { timeZone: tz, timeZoneName: 'shortOffset' });
    const part = f.formatToParts(date).find((x) => x.type === 'timeZoneName');
    return part ? part.value.replace('-', '−') : '';
  } catch {
    return '';
  }
}

// Décalage (en ms) d'un fuseau à un instant donné
function tzOffsetMs(tz, ms) {
  const f = dtf(`x|${tz}`, 'en-US', {
    timeZone: tz,
    hourCycle: 'h23',
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: 'numeric',
    minute: 'numeric',
    second: 'numeric',
  });
  const p = {};
  for (const x of f.formatToParts(new Date(ms))) p[x.type] = +x.value;
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour % 24, p.minute, p.second);
  return asUtc - Math.floor(ms / 1000) * 1000;
}

// Instant UTC correspondant à une heure locale donnée dans un fuseau
function zonedToUtc(tz, y, m, d, h, min) {
  const guess = Date.UTC(y, m - 1, d, h, min);
  let t = guess - tzOffsetMs(tz, guess);
  t = guess - tzOffsetMs(tz, t);
  return t;
}

// Prochaine fois où il sera [jour dayIdx (lun = 0), heure hour] dans le fuseau tz
function nextOccurrence(tz, dayIdx, hour) {
  const now = Date.now();
  const [y, m, d] = ymd(new Date(now), tz).split('-').map(Number);
  for (let k = 0; k < 8; k++) {
    const day = new Date(Date.UTC(y, m - 1, d + k));
    if ((day.getUTCDay() + 6) % 7 !== dayIdx) continue;
    const utc = zonedToUtc(tz, day.getUTCFullYear(), day.getUTCMonth() + 1, day.getUTCDate(), hour, 0);
    if (utc > now) return new Date(utc);
  }
  return new Date(now);
}

function phase(h) {
  if (h >= 5 && h < 12) return { label: 'Matin', cls: 'day' };
  if (h >= 12 && h < 18) return { label: 'Après-midi', cls: 'day' };
  if (h >= 18 && h < 23) return { label: 'Soirée', cls: '' };
  return { label: 'Nuit', cls: '' };
}

function relHours(date, tz) {
  const ms = date.getTime();
  const diff = (tzOffsetMs(tz, ms) - tzOffsetMs(OUAGA.tz, ms)) / 3600000;
  if (!diff) return '';
  return `${diff > 0 ? '+' : '−'}${Math.abs(diff)} h par rapport à Ouagadougou`;
}

function inText(ms) {
  const diff = ms - Date.now();
  if (diff <= 0) return 'en ce moment';
  const min = Math.round(diff / 60000);
  const d = Math.floor(min / 1440);
  const h = Math.floor((min % 1440) / 60);
  const m = min % 60;
  if (d >= 1) return `dans ${d} j${h ? ` ${h} h` : ''}`;
  if (h >= 1) return `dans ${h} h${m ? ` ${pad(m)}` : ''}`;
  return `dans ${m} min`;
}

// « Paris 20:00 · Ouaga 18:00 » : les autres villes à l'instant donné
function othersText(date, a) {
  const refDay = ymd(date, a.tz);
  return CITIES.filter((c) => c.id !== a.id)
    .map((c) => {
      const diff = dayDiff(ymd(date, c.tz), refDay);
      const tag = diff ? ` (${diff > 0 ? '+' : '−'}${Math.abs(diff)} j)` : '';
      const t = clockParts(date, c.tz);
      return `${c.short} ${t.hm}${t.ap ? ' ' + t.ap : ''}${tag}`;
    })
    .join(' · ');
}

/* ------------------------------------------------------------------ *
 *  Thème clair / sombre / auto
 * ------------------------------------------------------------------ */
const SUN =
  '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 2v2"/><path d="M12 20v2"/><path d="m4.93 4.93 1.41 1.41"/><path d="m17.66 17.66 1.41 1.41"/><path d="M2 12h2"/><path d="M20 12h2"/><path d="m6.34 17.66-1.41 1.41"/><path d="m19.07 4.93-1.41 1.41"/></svg>';
const MOON = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"/></svg>';

const darkQuery = window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : null;

function resolvedTheme() {
  if (settings.theme === 'auto') return darkQuery && darkQuery.matches ? 'dark' : 'light';
  return settings.theme === 'dark' ? 'dark' : 'light';
}

async function applyTheme() {
  const t = resolvedTheme();
  const bg = t === 'dark' ? '#0f0c1a' : '#f4f0ff';
  document.documentElement.setAttribute('data-theme', t);
  const meta = $('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', bg);
  $('#theme-btn').innerHTML = t === 'dark' ? SUN : MOON;
  $$('#theme-seg [data-theme-opt]').forEach((b) => b.classList.toggle('active', b.dataset.themeOpt === settings.theme));
  if (NATIVE) {
    try {
      await StatusBar.setStyle({ style: t === 'dark' ? Style.Dark : Style.Light });
      await StatusBar.setBackgroundColor({ color: bg });
    } catch {
      /* barre d'état non réglable */
    }
  }
}

/* ------------------------------------------------------------------ *
 *  Cartes horaires (écrans Horloges et Convertisseur)
 * ------------------------------------------------------------------ */
function dayTagHTML(date, now, tz) {
  const d = dayDiff(ymd(date, tz), ymd(now, tz));
  if (d === 0) return '<span class="daytag">Aujourd’hui</span>';
  if (d === 1) return '<span class="daytag shift">Demain</span>';
  if (d === -1) return '<span class="daytag shift">Hier</span>';
  return `<span class="daytag shift">${d > 0 ? '+' : '−'}${Math.abs(d)} j</span>`;
}

function cardHTML(city, date, { seconds, now }) {
  const c = clockParts(date, city.tz);
  const ph = phase(hourIn(date, city.tz));
  const rel = city.id === OUAGA.id ? '' : relHours(date, city.tz);
  return `
    <article class="card clock">
      <div class="clock-top">
        <div>
          <h3 class="city">${city.name}</h3>
          <p class="sub">${city.country} · ${offsetLabel(date, city.tz)}</p>
        </div>
        <span class="phase ${ph.cls}">${ph.label}</span>
      </div>
      <div class="time">
        <span class="hm">${c.hm}</span>
        ${seconds ? `<span class="sec">${c.s}</span>` : ''}
        ${c.ap ? `<span class="ap">${c.ap}</span>` : ''}
      </div>
      <p class="date">${dateLabel(date, city.tz)}${now ? dayTagHTML(date, now, city.tz) : ''}</p>
      ${rel ? `<p class="rel">${rel}</p>` : ''}
    </article>`;
}

function renderClocks() {
  const now = new Date();
  setHTML($('#clock-list'), CITIES.map((c) => cardHTML(c, now, { seconds: settings.seconds, now: null })).join(''));
}

/* ------------------------------------------------------------------ *
 *  Écran 1 — Carte de chaleur (accueil)
 * ------------------------------------------------------------------ */
let mapView = 'heat';
let sel = null; // { d, h } : case touchée, ou null
let detailPreset = null;
let currentSlots = [];
let lastMapMin = -1;

const audience = () => CITIES.find((c) => c.id === settings.audience) || NY;

function renderPills() {
  const now = new Date();
  const html = CITIES.map((c) => {
    const t = clockParts(now, c.tz);
    return `<div><small>${c.short}</small><b>${t.hm}${t.ap ? `<i>${t.ap}</i>` : ''}</b></div>`;
  }).join('');
  setHTML($('#pills'), html);
}

function renderAudience() {
  const html = CITIES.map(
    (c) => `<button type="button" class="chip ${c.id === settings.audience ? 'on' : ''}" data-aud="${c.id}">${c.short}</button>`
  ).join('');
  setHTML($('#aud-chips'), html);
}

function renderGrid() {
  const a = audience();
  const now = new Date();
  const nd = dayIndex(now, a.tz);
  const nh = hourIn(now, a.tz);
  let html = '<div></div>';
  for (let i = 0; i < 24; i++) html += `<div class="hm-h">${i % 6 === 0 ? i : ''}</div>`;
  HEAT.forEach((row, d) => {
    html += `<div class="hm-d">${DAY_INITIAL[d]}</div>`;
    row.forEach((lv, h) => {
      const cls = `hm-c lv${lv}${nd === d && nh === h ? ' now' : ''}${sel && sel.d === d && sel.h === h ? ' sel' : ''}`;
      html += `<button type="button" class="${cls}" data-d="${d}" data-h="${h}" aria-label="${DAY_LONG[d]} ${h} h : engagement ${LEVELS[lv].toLowerCase()}"></button>`;
    });
  });
  setHTML($('#heat-grid'), html);
}

// Prochaine heure de niveau maximal (5) chez l'audience, dans les 7 jours
function nextPeak(a) {
  const base = Math.floor(Date.now() / 3600000) * 3600000;
  for (let i = 0; i < 24 * 7; i++) {
    const ms = base + i * 3600000;
    const dt = new Date(ms);
    const d = dayIndex(dt, a.tz);
    const h = hourIn(dt, a.tz);
    if (HEAT[d][h] >= 5) return { ms, d, h };
  }
  return null;
}

function renderDetail() {
  const a = audience();
  const box = $('#detail');
  let date;
  let kick;
  let d;
  let h;
  if (sel) {
    d = sel.d;
    h = sel.h;
    date = nextOccurrence(a.tz, d, h);
    kick = `${LEVELS[HEAT[d][h]]} · ${inText(date.getTime())}`;
  } else {
    const p = nextPeak(a);
    if (!p) {
      detailPreset = null;
      setHTML(box, '');
      return;
    }
    d = p.d;
    h = p.h;
    date = new Date(p.ms);
    kick = `Prochain pic · ${inText(p.ms)}`;
  }
  detailPreset = {
    hour: date.getHours(),
    minute: date.getMinutes(),
    days: [date.getDay() + 1],
    label: `${a.short} · ${DAY_SHORT[d]} ${h} h`,
  };
  setHTML(
    box,
    `<div>
      <p class="kick">${kick}</p>
      <p class="main">${DAY_LONG[d]} ${pad(h)}:00 <span class="muted">· ${a.short}</span></p>
      <p class="sub">${othersText(date, a)}</p>
    </div>
    <button type="button" class="btn primary" data-act="remind">Rappel</button>`
  );
}

// Les 5 meilleurs créneaux des prochaines 24 h chez l'audience
function renderSlots() {
  const a = audience();
  const now = new Date();
  const base = Math.ceil(Date.now() / 3600000) * 3600000;
  const list = [];
  for (let i = 0; i < 24; i++) {
    const ms = base + i * 3600000;
    const dt = new Date(ms);
    const d = dayIndex(dt, a.tz);
    const h = hourIn(dt, a.tz);
    list.push({ ms, d, h, lv: HEAT[d][h] });
  }
  currentSlots = list
    .sort((x, y) => y.lv - x.lv || x.ms - y.ms)
    .slice(0, 5)
    .sort((x, y) => x.ms - y.ms);

  const html = currentSlots
    .map((s, i) => {
      const dt = new Date(s.ms);
      const t = clockParts(dt, a.tz);
      const diff = dayDiff(ymd(dt, a.tz), ymd(now, a.tz));
      const tag = diff === 0 ? 'Aujourd’hui' : diff === 1 ? 'Demain' : DAY_SHORT[s.d];
      return `
      <article class="slot">
        <div class="t">${t.hm}${t.ap ? ' ' + t.ap : ''}<small>${tag} · ${a.short}</small></div>
        <button type="button" class="btn primary" data-slot="${i}">Rappel</button>
        <div class="o">${othersText(dt, a)}</div>
        <div class="lvl"><span class="dot lv${s.lv}"></span>${LEVELS[s.lv]} · ${inText(s.ms)}</div>
      </article>`;
    })
    .join('');
  setHTML($('#slots-list'), html);
}

function renderMap() {
  renderPills();
  renderAudience();
  $('#heat-view').hidden = mapView !== 'heat';
  $('#slots-view').hidden = mapView !== 'slots';
  $$('#view-seg .seg-btn').forEach((b) => b.classList.toggle('active', b.dataset.view === mapView));
  if (mapView === 'heat') {
    renderGrid();
    renderDetail();
  } else {
    renderSlots();
  }
}

function slotToReminder(i) {
  const s = currentSlots[i];
  if (!s) return;
  const a = audience();
  const dt = new Date(s.ms);
  openSheet(null, {
    hour: dt.getHours(),
    minute: dt.getMinutes(),
    days: [dt.getDay() + 1],
    label: `${a.short} · ${DAY_SHORT[s.d]} ${s.h} h`,
  });
}

/* ------------------------------------------------------------------ *
 *  Écran 3 — Convertisseur (pas de 15 minutes, de −12 h à +12 h, ou date choisie)
 * ------------------------------------------------------------------ */
let offsetQ = 0; // en quarts d'heure
let picked = null; // instant choisi (ms) ou null

function offsetText(q) {
  if (q === 0) return 'Heure actuelle';
  const total = Math.abs(q) * 15;
  const h = Math.floor(total / 60);
  const m = total % 60;
  return `${q > 0 ? '+' : '−'}${h} h${m ? ' ' + pad(m) : ''}`;
}

function renderConverter() {
  const now = new Date();
  const sim = picked != null ? new Date(picked) : new Date(now.getTime() + offsetQ * 15 * 60000);
  $('#conv-label').textContent = picked != null ? 'Date choisie' : offsetText(offsetQ);
  $('#conv-slider').value = picked != null ? 0 : offsetQ;
  setHTML($('#conv-clocks'), CITIES.map((c) => cardHTML(c, sim, { seconds: false, now })).join(''));
}

function setOffset(q) {
  picked = null;
  $('#conv-date').value = '';
  offsetQ = Math.max(-48, Math.min(48, q));
  renderConverter();
}

/* ------------------------------------------------------------------ *
 *  Écran 4 — Rappels
 * ------------------------------------------------------------------ */
function daysText(days) {
  const set = new Set(days);
  if (set.size === 7) return 'Tous les jours';
  if (set.size === 5 && [2, 3, 4, 5, 6].every((w) => set.has(w))) return 'Lun – Ven';
  if (set.size === 2 && set.has(7) && set.has(1)) return 'Week-end';
  return DAYS.filter((d) => set.has(d.w)).map((d) => d.short).join(' ');
}

function renderReminders() {
  const list = $('#rem-list');
  if (!reminders.length) {
    list.innerHTML = '<div class="empty">Aucun rappel pour l’instant.<br />Appuie sur + ou touche « Rappel » sur la carte.</div>';
    lastHTML.delete(list);
    return;
  }
  const sorted = [...reminders].sort((a, b) => a.hour * 60 + a.minute - (b.hour * 60 + b.minute));
  list.innerHTML = sorted
    .map(
      (r) => `
      <article class="card reminder ${r.enabled ? '' : 'off'}" data-id="${r.id}">
        <div>
          <div class="rtime">${pad(r.hour)}:${pad(r.minute)}</div>
          <div class="rmeta">${r.label ? esc(r.label) + ' · ' : ''}${daysText(r.days)}</div>
        </div>
        <input type="checkbox" class="switch" data-toggle="${r.id}" ${r.enabled ? 'checked' : ''} aria-label="Activer le rappel" />
      </article>`
    )
    .join('');
  lastHTML.delete(list);
}

function persistReminders() {
  store.set('kairos.reminders', reminders);
  store.set('kairos.nextId', nextId);
}

/* --- Notifications locales --- */
async function ensureChannel() {
  if (!NATIVE) return;
  try {
    await LocalNotifications.createChannel({
      id: CHANNEL_ID,
      name: 'Rappels de publication',
      description: 'Rappels programmés dans Kairos',
      importance: 5,
      visibility: 1,
      vibration: true,
    });
  } catch {
    /* canal déjà créé ou non pris en charge */
  }
}

async function ensurePermission() {
  const status = await LocalNotifications.checkPermissions();
  if (status.display === 'granted') return true;
  const asked = await LocalNotifications.requestPermissions();
  return asked.display === 'granted';
}

const notifIds = (r) => DAYS.map((d) => ({ id: r.id * 10 + d.w }));

async function cancelReminder(r) {
  if (!NATIVE) return;
  try {
    await LocalNotifications.cancel({ notifications: notifIds(r) });
  } catch {
    /* rien à annuler */
  }
}

async function applyReminder(r) {
  if (!NATIVE) {
    if (r.enabled) toast('Rappel enregistré (les notifications fonctionnent dans l’application Android).');
    return;
  }
  try {
    await cancelReminder(r);
    if (!r.enabled) return;
    if (!(await ensurePermission())) {
      toast('Notifications refusées : autorise-les dans les réglages Android.');
      return;
    }
    await ensureChannel();
    await LocalNotifications.schedule({
      notifications: r.days.map((w) => ({
        id: r.id * 10 + w,
        title: 'Kairos — c’est l’heure de publier',
        body: r.label || 'Un rappel de publication t’attend.',
        channelId: CHANNEL_ID,
        schedule: { on: { weekday: w, hour: r.hour, minute: r.minute }, allowWhileIdle: true },
      })),
    });
  } catch (e) {
    toast('Impossible de programmer le rappel.');
    console.error(e);
  }
}

// Au lancement : on remet en place les rappels actifs si la permission est déjà accordée
async function syncAll() {
  if (!NATIVE) return;
  try {
    const status = await LocalNotifications.checkPermissions();
    if (status.display !== 'granted') return;
    await ensureChannel();
    for (const r of reminders) await applyReminder(r);
  } catch (e) {
    console.error(e);
  }
}

/* --- Fenêtre d'édition --- */
let editingId = null;
let selectedDays = new Set();

function buildChips() {
  $('#r-days').innerHTML = DAYS.map((d) => `<button type="button" class="chip" data-day="${d.w}">${d.short}</button>`).join('');
}

function paintChips() {
  $$('#r-days .chip').forEach((c) => c.classList.toggle('on', selectedDays.has(+c.dataset.day)));
}

function openSheet(id, preset = {}) {
  showScreen('reminders');
  const r = id != null ? reminders.find((x) => x.id === id) : null;
  editingId = r ? r.id : null;
  $('#sheet-title').textContent = r ? 'Modifier le rappel' : 'Nouveau rappel';
  $('#r-label').value = r ? r.label : preset.label || '';
  const hour = r ? r.hour : preset.hour ?? 18;
  const minute = r ? r.minute : preset.minute ?? 30;
  $('#r-time').value = `${pad(hour)}:${pad(minute)}`;
  selectedDays = new Set(r ? r.days : preset.days || DAYS.map((d) => d.w));
  paintChips();
  $('#r-delete').hidden = !r;
  $('#sheet').hidden = false;
}

function closeSheet() {
  $('#sheet').hidden = true;
  editingId = null;
}

async function saveSheet() {
  const value = $('#r-time').value;
  if (!value) return toast('Choisis une heure.');
  if (!selectedDays.size) return toast('Choisis au moins un jour.');
  const [hour, minute] = value.split(':').map(Number);
  const label = $('#r-label').value.trim();
  const days = DAYS.map((d) => d.w).filter((w) => selectedDays.has(w));

  let r;
  if (editingId != null) {
    r = reminders.find((x) => x.id === editingId);
    await cancelReminder(r);
    Object.assign(r, { hour, minute, label, days, enabled: true });
  } else {
    r = { id: nextId++, hour, minute, label, days, enabled: true };
    reminders.push(r);
  }
  persistReminders();
  closeSheet();
  renderReminders();
  await applyReminder(r);
}

async function deleteFromSheet() {
  const r = reminders.find((x) => x.id === editingId);
  if (!r) return closeSheet();
  await cancelReminder(r);
  reminders = reminders.filter((x) => x.id !== r.id);
  persistReminders();
  closeSheet();
  renderReminders();
  toast('Rappel supprimé.');
}

/* ------------------------------------------------------------------ *
 *  Écran 5 — Réglages
 * ------------------------------------------------------------------ */
function saveSettings() {
  store.set('kairos.settings', settings);
}

async function testNotification() {
  if (!NATIVE) return toast('Disponible dans l’application Android.');
  try {
    if (!(await ensurePermission())) return toast('Notifications refusées dans Android.');
    await ensureChannel();
    await LocalNotifications.schedule({
      notifications: [
        {
          id: 999999,
          title: 'Kairos — test',
          body: 'Les notifications fonctionnent.',
          channelId: CHANNEL_ID,
          schedule: { at: new Date(Date.now() + 3000), allowWhileIdle: true },
        },
      ],
    });
    toast('Notification test dans 3 secondes…');
  } catch (e) {
    toast('Le test a échoué.');
    console.error(e);
  }
}

async function exactAlarms() {
  if (!NATIVE) return toast('Disponible dans l’application Android.');
  try {
    const s = await LocalNotifications.checkExactNotificationSetting();
    if (s.exact_alarm === 'granted') return toast('Alarmes exactes déjà autorisées.');
    await LocalNotifications.changeExactNotificationSetting();
  } catch {
    toast('Réglage non nécessaire sur cette version d’Android.');
  }
}

/* ------------------------------------------------------------------ *
 *  Navigation
 * ------------------------------------------------------------------ */
function showScreen(name) {
  $$('.screen').forEach((s) => s.classList.toggle('active', s.id === `screen-${name}`));
  $$('.tab').forEach((t) => t.classList.toggle('active', t.dataset.screen === name));
  $('#screen-title').textContent = $(`#screen-${name}`).dataset.title;
  $('#eyebrow').textContent = cap(new Intl.DateTimeFormat('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' }).format(new Date()));
  window.scrollTo(0, 0);
  if (name === 'map') renderMap();
  if (name === 'clocks') renderClocks();
  if (name === 'convert') renderConverter();
  if (name === 'reminders') renderReminders();
}

/* ------------------------------------------------------------------ *
 *  Démarrage
 * ------------------------------------------------------------------ */
function init() {
  buildChips();

  // Navigation
  $$('.tab').forEach((t) => t.addEventListener('click', () => showScreen(t.dataset.screen)));

  // Thème
  $('#theme-btn').addEventListener('click', () => {
    settings.theme = resolvedTheme() === 'dark' ? 'light' : 'dark';
    saveSettings();
    applyTheme();
  });
  $$('#theme-seg [data-theme-opt]').forEach((b) =>
    b.addEventListener('click', () => {
      settings.theme = b.dataset.themeOpt;
      saveSettings();
      applyTheme();
    })
  );
  if (darkQuery && darkQuery.addEventListener) {
    darkQuery.addEventListener('change', () => {
      if (settings.theme === 'auto') applyTheme();
    });
  }

  // Carte de chaleur
  $('#view-seg').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-view]');
    if (!btn) return;
    mapView = btn.dataset.view;
    renderMap();
  });
  $('#aud-chips').addEventListener('click', (e) => {
    const chip = e.target.closest('[data-aud]');
    if (!chip) return;
    settings.audience = chip.dataset.aud;
    sel = null;
    saveSettings();
    renderMap();
  });
  $('#heat-grid').addEventListener('click', (e) => {
    const cell = e.target.closest('.hm-c');
    if (!cell) return;
    const d = +cell.dataset.d;
    const h = +cell.dataset.h;
    sel = sel && sel.d === d && sel.h === h ? null : { d, h };
    renderGrid();
    renderDetail();
  });
  $('#detail').addEventListener('click', (e) => {
    if (e.target.closest('[data-act="remind"]') && detailPreset) openSheet(null, detailPreset);
  });
  $('#slots-list').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-slot]');
    if (btn) slotToReminder(+btn.dataset.slot);
  });

  // Convertisseur
  $('#conv-slider').addEventListener('input', (e) => setOffset(+e.target.value));
  $('#conv-reset').addEventListener('click', () => setOffset(0));
  $('#conv-minus').addEventListener('click', () => setOffset((picked != null ? 0 : offsetQ) - 4));
  $('#conv-plus').addEventListener('click', () => setOffset((picked != null ? 0 : offsetQ) + 4));
  $('#conv-date').addEventListener('change', (e) => {
    if (!e.target.value) return;
    const ms = new Date(e.target.value).getTime();
    if (Number.isNaN(ms)) return;
    picked = ms;
    renderConverter();
  });

  // Rappels
  $('#rem-add').addEventListener('click', () => openSheet(null));
  $('#rem-list').addEventListener('click', async (e) => {
    const toggle = e.target.closest('[data-toggle]');
    if (toggle) {
      const r = reminders.find((x) => x.id === +toggle.dataset.toggle);
      r.enabled = toggle.checked;
      persistReminders();
      renderReminders();
      await applyReminder(r);
      return;
    }
    const card = e.target.closest('.reminder');
    if (card) openSheet(+card.dataset.id);
  });
  $('#r-days').addEventListener('click', (e) => {
    const chip = e.target.closest('[data-day]');
    if (!chip) return;
    const w = +chip.dataset.day;
    selectedDays.has(w) ? selectedDays.delete(w) : selectedDays.add(w);
    paintChips();
  });
  $('#r-save').addEventListener('click', saveSheet);
  $('#r-delete').addEventListener('click', deleteFromSheet);
  $$('[data-close]').forEach((el) => el.addEventListener('click', closeSheet));

  // Réglages
  $('#set-h24').checked = settings.h24;
  $('#set-seconds').checked = settings.seconds;
  $('#set-h24').addEventListener('change', (e) => {
    settings.h24 = e.target.checked;
    saveSettings();
    lastHTML.clear();
    tick(true);
  });
  $('#set-seconds').addEventListener('change', (e) => {
    settings.seconds = e.target.checked;
    saveSettings();
    tick(true);
  });
  $('#btn-test').addEventListener('click', testNotification);
  $('#btn-exact').addEventListener('click', exactAlarms);

  // Bouton retour Android : ferme la fenêtre, revient à la carte, puis quitte
  if (NATIVE) {
    App.addListener('backButton', () => {
      if (!$('#sheet').hidden) return closeSheet();
      if ($('.screen.active').id !== 'screen-map') return showScreen('map');
      App.exitApp();
    });
  }

  applyTheme();
  showScreen('map');
  setInterval(tick, 250);
  syncAll();
}

function tick(force) {
  const id = $('.screen.active').id;
  if (id === 'screen-map') {
    renderPills();
    const m = Math.floor(Date.now() / 60000);
    if (force === true || m !== lastMapMin) {
      lastMapMin = m;
      renderMap();
    }
  } else if (id === 'screen-clocks') {
    renderClocks();
  } else if (id === 'screen-convert') {
    renderConverter();
  }
}

init();
