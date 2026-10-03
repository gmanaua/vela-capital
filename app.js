/* Vela Capital Management — lógica de la web
   Los datos llegan del Apps Script de Google Sheets (API_URL). Sin contraseña solo
   llegan porcentajes; con contraseña, también los importes. */

const BLOCKS = [
  { id: 'Core', color: 'var(--apricot)', perfil: 'Estabilidad y base defensiva' },
  { id: 'Value', color: 'var(--iris)', perfil: 'Convicción, value investing' },
  { id: 'Temáticos', color: 'var(--polar)', perfil: 'Crecimiento temático' },
  { id: 'Acciones', color: 'var(--fuchsia)', perfil: 'Alta convicción individual' },
];
const RF = 0.02; // tipo sin riesgo anual para Sharpe y Sortino (aprox. facilidad de depósito del BCE)
const MONTHS = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
const MONTHS_LONG = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/* ---------- formato ---------- */
const nf = (d) => new Intl.NumberFormat('es-ES', { minimumFractionDigits: d, maximumFractionDigits: d });
const num2 = (x) => (x < 0 ? '−' : '') + nf(2).format(Math.abs(x));
const sign = (x) => (x > 0 ? '+' : x < 0 ? '−' : '');
const pct = (x, d = 1) => sign(x) + nf(d).format(Math.abs(x * 100)) + ' %';
const pctPlain = (x, d = 1) => nf(d).format(x * 100) + ' %';
const eur = (x, d = 0) => (x < 0 ? '−' : '') + nf(d).format(Math.abs(x)) + ' €';
const eurSigned = (x, d = 0) => sign(x) + nf(d).format(Math.abs(x)) + ' €';
const arrow = (x) => (x > 0 ? '▲' : x < 0 ? '▼' : '■');
const delta = (x, d = 1) =>
  `<span class="delta ${x > 0 ? 'up' : x < 0 ? 'down' : ''}"><span class="arr" aria-hidden="true">${arrow(x)}</span>${pct(x, d)}</span>`;
const diffPP = (x) => `<span class="delta ${x > 0 ? 'up' : x < 0 ? 'down' : ''}"><span class="arr" aria-hidden="true">${arrow(x)}</span>${sign(x)}${nf(1).format(Math.abs(x * 100))} p.p.</span>`;
const parseDate = (s) => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
const fmtDate = (dt) => `${dt.getDate()} ${MONTHS[dt.getMonth()]} ${dt.getFullYear()}`;
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

/* ---------- datos ---------- */
// Dirección del Apps Script publicado (se rellena al desplegar). Vacía = datos de ejemplo incrustados.
const API_URL = window.VELA_API || '';
const KEY_STORE = 'vela-key';
const store = {
  get: () => { try { return sessionStorage.getItem(KEY_STORE); } catch { return null; } },
  set: (k) => { try { k ? sessionStorage.setItem(KEY_STORE, k) : sessionStorage.removeItem(KEY_STORE); } catch {} },
};

async function loadData(key) {
  if (!API_URL) {
    // Vista previa: simula la respuesta del Apps Script
    const d = window.VELA_DATA;
    if (key && key !== 'vela') return { ...toApi(d, false), error: 'clave' };
    return toApi(d, !!key);
  }
  const url = API_URL + (key ? '?key=' + encodeURIComponent(key) : '');
  const res = await fetch(url, { redirect: 'follow' });
  if (!res.ok) throw new Error('HTTP ' + res.status);
  return res.json();
}

// Solo para la vista previa: replica lo que devuelve el Apps Script
function toApi(d, priv) {
  const inv = d.posiciones.reduce((s, p) => s + p.valor, 0);
  const c = d.cartera.map((p, i, a) => {
    const o = { fecha: p.fecha, r: i ? (p.valor - a[i - 1].valor - p.aportacion) / a[i - 1].valor : 0 };
    if (priv) Object.assign(o, { valor: p.valor, aportacion: p.aportacion });
    return o;
  });
  const pos = d.posiciones.map((p) => {
    const o = { nombre: p.nombre, ticker: p.ticker, bloque: p.bloque, broker: p.broker, tipo: p.tipo, peso: p.valor / inv, rent: p.valor / p.invertido - 1 };
    if (priv) Object.assign(o, { invertido: p.invertido, valor: p.valor });
    return o;
  });
  const ideas = d.ideas.map((i) => ({ ...i, tipo: { 'ACC.': 'Acción', FONDO: 'Fondo', ETF: 'ETF' }[i.tipo] || i.tipo }));
  const out = { privado: priv, actualizado: d.actualizado, cashPct: d.cash / (d.cash + inv), cartera: c, posiciones: pos, ideas };
  if (priv) Object.assign(out, { patrimonio: d.patrimonio, cash: d.cash, realizado: d.realizado });
  return out;
}

// Tesis de inversión: tesis/index.json = { "NFLX": { "archivo": "tesis/nflx.html", "fecha": "2026-09-15" }, ... }
let TESIS = {};
async function loadTesis() {
  try { const r = await fetch('tesis/index.json', { cache: 'no-cache' }); if (r.ok) TESIS = await r.json(); } catch {}
}
const tesisDe = (p) => (p.ticker && TESIS[p.ticker]) || TESIS[p.nombre] || null;

function derive(d) {
  const priv = !!d.privado;
  // Rentabilidad ponderada por tiempo (cada semana ya descuenta aportaciones)
  const c = d.cartera.map((p) => ({ ...p, date: parseDate(p.fecha) }));
  let acc = 1;
  c.forEach((p) => { acc *= 1 + p.r; p.acum = acc - 1; });

  // Rentabilidad mensual encadenando las semanas de cada mes
  const months = [];
  c.slice(1).forEach((p) => {
    const key = p.date.getFullYear() * 12 + p.date.getMonth();
    let m = months.find((x) => x.key === key);
    if (!m) { m = { key, y: p.date.getFullYear(), m: p.date.getMonth(), f: 1, last: p.date }; months.push(m); }
    m.f *= 1 + p.r; m.last = p.date;
  });
  months.forEach((m) => {
    m.r = m.f - 1;
    m.partial = (new Date(m.y, m.m + 1, 0) - m.last) / 864e5 > 6;
  });

  const pos = d.posiciones.map((p) => ({ ...p, pl: priv ? p.valor - p.invertido : 0 }));
  // El peso hace de valor relativo; el coste relativo es peso / (1 + rent)
  const blocks = BLOCKS.map((b) => {
    const ps = pos.filter((p) => p.bloque === b.id);
    const w = ps.reduce((s, p) => s + p.peso, 0);
    const k = ps.reduce((s, p) => s + p.peso / (1 + p.rent), 0);
    const valor = priv ? ps.reduce((s, p) => s + p.valor, 0) : 0;
    return { ...b, n: ps.length, peso: w, rent: k ? w / k - 1 : 0, valor };
  });

  const out = {
    raw: d, priv, c, months, pos, blocks,
    bench: d.bench && Array.isArray(d.bench.acum) && d.bench.acum.length === c.length ? d.bench : null,
    twr: c[c.length - 1].acum,
    since: c[0].date,
    updated: parseDate(d.actualizado),
    cashPct: d.cashPct,
  };
  out.risk = riskMetrics(c, out.bench);
  const sorted = [...pos].sort((a, b) => b.rent - a.rent);
  out.best = sorted[0]; out.worst = sorted[sorted.length - 1];
  out.biggest = [...pos].sort((a, b) => b.peso - a.peso)[0];
  out.rf = pos.filter((p) => p.tipo === 'Fondo RF').reduce((s, p) => s + p.peso, 0);
  out.rv = 1 - out.rf;
  out.emChina = pos.filter((p) => /MSCI (EM|China)/.test(p.nombre)).reduce((s, p) => s + p.peso, 0);

  if (priv) {
    out.invested = pos.reduce((s, p) => s + p.valor, 0);
    out.cost = pos.reduce((s, p) => s + p.invertido, 0);
    out.total = out.invested + d.cash;
    out.pat = d.patrimonio.map((p) => ({ ...p, date: parseDate(p.fecha) }));
    out.brokers = {};
    pos.forEach((p) => (out.brokers[p.broker] = (out.brokers[p.broker] || 0) + p.valor));
  }
  return out;
}

/* ---------- riesgo ---------- */
function riskMetrics(c, bench) {
  const r = c.slice(1).map((p) => p.r);
  const n = r.length;
  if (n < 4) return null;
  const mean = r.reduce((s, x) => s + x, 0) / n;
  const sd = Math.sqrt(r.reduce((s, x) => s + (x - mean) ** 2, 0) / (n - 1));
  const vol = sd * Math.sqrt(52);
  const ann = Math.pow(1 + c[c.length - 1].acum, 52 / n) - 1;
  const rfw = Math.pow(1 + RF, 1 / 52) - 1;
  const down = Math.sqrt(r.reduce((s, x) => s + Math.min(0, x - rfw) ** 2, 0) / n) * Math.sqrt(52);
  // caídas desde máximos (cartera e índice)
  const dd = (vals) => { let peak = 1; return vals.map((v) => { const lvl = 1 + v; peak = Math.max(peak, lvl); return lvl / peak - 1; }); };
  const ddV = dd(c.map((p) => p.acum));
  let maxDD = 0, ddAt = 0;
  ddV.forEach((v, i) => { if (v < maxDD) { maxDD = v; ddAt = i; } });
  const out = { n, vol, ann, sharpe: (ann - RF) / vol, sortino: down ? (ann - RF) / down : null, ddV, maxDD, ddDate: c[ddAt].date, ddNow: ddV[ddV.length - 1] };
  if (bench) {
    const b = bench.acum;
    const pairs = [];
    for (let i = 1; i < b.length; i++) if (b[i] != null && b[i - 1] != null) pairs.push([c[i].r, (1 + b[i]) / (1 + b[i - 1]) - 1]);
    if (pairs.length >= 4) {
      const mx = pairs.reduce((s, p) => s + p[0], 0) / pairs.length, my = pairs.reduce((s, p) => s + p[1], 0) / pairs.length;
      let cov = 0, vx = 0, vy = 0;
      pairs.forEach(([x, y]) => { cov += (x - mx) * (y - my); vx += (x - mx) ** 2; vy += (y - my) ** 2; });
      out.beta = cov / vy; out.corr = cov / Math.sqrt(vx * vy);
    }
    out.ddB = dd(b.map((v, i) => (v == null ? (i ? null : 0) : v)).map((v) => v ?? 0));
  }
  return out;
}

/* ---------- utilidades de gráfico ---------- */
function niceTicks(min, max, count = 5) {
  const span = max - min || Math.abs(max) || 1;
  const step0 = span / count;
  const mag = Math.pow(10, Math.floor(Math.log10(step0)));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => span / s <= count) || 10 * mag;
  const lo = Math.floor(min / step) * step;
  const hi = Math.ceil(max / step) * step;
  const t = [];
  for (let v = lo; v <= hi + step / 2; v += step) t.push(+v.toFixed(10));
  return t;
}
const svgEl = (tag, attrs = {}) => {
  const e = document.createElementNS('http://www.w3.org/2000/svg', tag);
  for (const k in attrs) e.setAttribute(k, attrs[k]);
  return e;
};

const tip = document.createElement('div');
tip.className = 'tip';
tip.setAttribute('role', 'status');
document.body.appendChild(tip);
function showTip(html, x, y) {
  tip.innerHTML = html;
  tip.style.opacity = 1;
  const r = tip.getBoundingClientRect();
  let left = x + 16, top = y - r.height - 12;
  if (left + r.width > window.innerWidth - 8) left = x - r.width - 16;
  if (top < 8) top = y + 16;
  tip.style.transform = `translate(${left}px, ${top}px)`;
}
const hideTip = () => (tip.style.opacity = 0);

/* Gráfico de línea con área, cruz de seguimiento y animación de trazado */
function lineChart(host, pts, opt) {
  host.innerHTML = '';
  const W = host.clientWidth, H = opt.height || 360;
  const m = { t: 16, r: opt.right || 12, b: 32, l: opt.left || 56 };
  const svg = svgEl('svg', { width: W, height: H, viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': opt.label });
  const ref = (opt.ref || []).filter((p) => p.y != null);
  const xs = pts.map((p) => p.x.getTime()), ys = pts.map((p) => p.y).concat(ref.map((p) => p.y));
  const x0 = Math.min(...xs), x1 = Math.max(...xs);
  const ticks = niceTicks(Math.min(...ys, opt.zero ? 0 : Infinity), Math.max(...ys), 4);
  const y0 = ticks[0], y1 = ticks[ticks.length - 1];
  const X = (t) => m.l + ((t - x0) / (x1 - x0)) * (W - m.l - m.r);
  const Y = (v) => m.t + (1 - (v - y0) / (y1 - y0)) * (H - m.t - m.b);

  const grid = svgEl('g', { class: 'grid' });
  ticks.forEach((t) => {
    grid.appendChild(svgEl('line', { x1: m.l, x2: W - m.r, y1: Y(t), y2: Y(t), class: t === 0 && opt.zero ? 'zero' : '' }));
    const lab = svgEl('text', { x: m.l - 10, y: Y(t) + 4, 'text-anchor': 'end' });
    lab.textContent = opt.fmtAxis(t);
    grid.appendChild(lab);
  });
  // etiquetas de mes
  const first = new Date(x0); let d = new Date(first.getFullYear(), first.getMonth() + 1, 1);
  const every = W < 560 ? 2 : 1;
  let i = 0;
  while (d.getTime() <= x1) {
    if (i++ % every === 0) {
      const lab = svgEl('text', { x: X(d.getTime()), y: H - 8, 'text-anchor': 'middle' });
      lab.textContent = MONTHS[d.getMonth()];
      grid.appendChild(lab);
    }
    d = new Date(d.getFullYear(), d.getMonth() + 1, 1);
  }
  svg.appendChild(grid);

  const defs = svgEl('defs');
  const gid = 'g' + Math.random().toString(36).slice(2, 7);
  const lg = svgEl('linearGradient', { id: gid, x1: 0, x2: 0, y1: 0, y2: 1 });
  lg.appendChild(svgEl('stop', { offset: '0', 'stop-color': '#ffcf9e', 'stop-opacity': '0.85' }));
  lg.appendChild(svgEl('stop', { offset: '1', 'stop-color': '#ffcf9e', 'stop-opacity': '0' }));
  defs.appendChild(lg);
  svg.appendChild(defs);

  const line = pts.map((p, k) => `${k ? 'L' : 'M'}${X(p.x.getTime()).toFixed(1)},${Y(p.y).toFixed(1)}`).join('');
  const base = Y(Math.max(y0, Math.min(0, y1)) || y0);
  const area = svgEl('path', { d: `${line}L${X(x1)},${opt.zero ? Y(0) : H - m.b}L${X(x0)},${opt.zero ? Y(0) : H - m.b}Z`, fill: `url(#${gid})`, class: 'area' });
  const path = svgEl('path', { d: line, class: 'line' });
  svg.appendChild(area);
  if (ref.length) {
    const rl = ref.map((p, k) => `${k ? 'L' : 'M'}${X(p.x.getTime()).toFixed(1)},${Y(p.y).toFixed(1)}`).join('');
    const rp = svgEl('path', { d: rl, class: 'refline' });
    svg.appendChild(rp);
    const rlast = ref[ref.length - 1], last0 = pts[pts.length - 1];
    // etiquetas directas al final de cada línea, separadas si se solapan
    let yA = Y(last0.y), yB = Y(rlast.y);
    if (Math.abs(yA - yB) < 16) { const mid = (yA + yB) / 2, s = yA <= yB ? -1 : 1; yA = mid + s * 8; yB = mid - s * 8; }
    const la = svgEl('text', { x: W - m.r + 10, y: yA + 4, class: 'endlab' }); la.textContent = opt.mainLabel || '';
    const lb = svgEl('text', { x: W - m.r + 10, y: yB + 4, class: 'endlab ref' }); lb.textContent = opt.refLabel || '';
    if ((opt.right || 12) >= 60) { svg.appendChild(la); svg.appendChild(lb); }
  }
  svg.appendChild(path);

  const last = pts[pts.length - 1];
  const dot = svgEl('circle', { cx: X(last.x.getTime()), cy: Y(last.y), r: 4.5, class: 'enddot' });
  svg.appendChild(dot);

  const cross = svgEl('line', { class: 'cross', y1: m.t, y2: H - m.b, opacity: 0 });
  const hov = svgEl('circle', { r: 5, class: 'hovdot', opacity: 0 });
  svg.appendChild(cross);
  svg.appendChild(hov);
  const hit = svgEl('rect', { x: m.l, y: 0, width: W - m.l - m.r, height: H, fill: 'transparent' });
  svg.appendChild(hit);
  const move = (ev) => {
    const r = svg.getBoundingClientRect();
    const cx = (ev.touches ? ev.touches[0].clientX : ev.clientX) - r.left;
    let best = pts[0], bd = Infinity;
    pts.forEach((p) => { const dd = Math.abs(X(p.x.getTime()) - cx); if (dd < bd) { bd = dd; best = p; } });
    const px = X(best.x.getTime()), py = Y(best.y);
    cross.setAttribute('x1', px); cross.setAttribute('x2', px); cross.setAttribute('opacity', 1);
    hov.setAttribute('cx', px); hov.setAttribute('cy', py); hov.setAttribute('opacity', 1);
    showTip(opt.tip(best), r.left + px, r.top + py);
  };
  hit.addEventListener('mousemove', move);
  hit.addEventListener('touchmove', move, { passive: true });
  const leave = () => { cross.setAttribute('opacity', 0); hov.setAttribute('opacity', 0); hideTip(); };
  hit.addEventListener('mouseleave', leave);
  hit.addEventListener('touchend', leave);

  host.appendChild(svg);

  if (!reduceMotion && !host.dataset.drawn) {
    const len = path.getTotalLength();
    path.style.strokeDasharray = len;
    path.style.strokeDashoffset = len;
    area.style.opacity = 0; dot.style.opacity = 0;
    const io = new IntersectionObserver((es) => {
      if (es[0].isIntersecting) {
        io.disconnect();
        host.dataset.drawn = 1;
        path.style.transition = 'stroke-dashoffset 1.6s cubic-bezier(.65,0,.35,1)';
        path.style.strokeDashoffset = 0;
        area.style.transition = 'opacity .9s ease 1.1s'; area.style.opacity = 1;
        dot.style.transition = 'opacity .3s ease 1.5s'; dot.style.opacity = 1;
      }
    }, { threshold: 0.35 });
    io.observe(host);
  }
}

/* Barras de rentabilidad mensual */
function barChart(host, months) {
  host.innerHTML = '';
  const W = host.clientWidth, H = 220;
  const m = { t: 24, r: 8, b: 30, l: 8 };
  const svg = svgEl('svg', { width: W, height: H, viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': 'Rentabilidad mensual' });
  const vals = months.map((x) => x.r);
  const lo = Math.min(0, ...vals), hi = Math.max(0, ...vals);
  const pad = (hi - lo) * 0.18;
  const Y = (v) => m.t + (1 - (v - (lo - (lo < 0 ? pad : 0))) / (hi + pad - (lo - (lo < 0 ? pad : 0)))) * (H - m.t - m.b);
  const bw = (W - m.l - m.r) / months.length;
  const barW = Math.min(44, bw * 0.56);
  svg.appendChild(svgEl('line', { x1: m.l, x2: W - m.r, y1: Y(0), y2: Y(0), class: 'baseline' }));
  months.forEach((mo, i) => {
    const cx = m.l + bw * i + bw / 2;
    const y = Y(Math.max(mo.r, 0)), h = Math.abs(Y(mo.r) - Y(0));
    const g = svgEl('g', { class: 'bar' + (mo.partial ? ' partial' : '') });
    g.appendChild(svgEl('rect', { x: cx - barW / 2, y, width: barW, height: Math.max(h, 1.5) }));
    const v = svgEl('text', { x: cx, y: mo.r >= 0 ? y - 7 : y + h + 15, 'text-anchor': 'middle', class: 'val', 'font-size': bw < 52 ? 10.5 : 12 });
    v.textContent = pct(mo.r, 1);
    g.appendChild(v);
    const l = svgEl('text', { x: cx, y: H - 8, 'text-anchor': 'middle', class: 'lab' });
    l.textContent = MONTHS[mo.m] + (mo.partial ? '*' : '');
    g.appendChild(l);
    const hit = svgEl('rect', { x: m.l + bw * i, y: 0, width: bw, height: H, fill: 'transparent' });
    hit.addEventListener('mousemove', (e) =>
      showTip(`<b>${MONTHS_LONG[mo.m]} ${mo.y}</b>${delta(mo.r, 2)}${mo.partial ? '<small>Mes en curso</small>' : ''}`, e.clientX, e.clientY));
    hit.addEventListener('mouseleave', hideTip);
    g.appendChild(hit);
    svg.appendChild(g);
  });
  host.appendChild(svg);
}

/* ---------- esfera de partículas del hero ---------- */
function sphere(canvas) {
  const ctx = canvas.getContext('2d');
  const N = window.innerWidth < 600 ? 1400 : 2600;
  const P = [];
  const ga = Math.PI * (3 - Math.sqrt(5));
  for (let i = 0; i < N; i++) {
    const y = 1 - (i / (N - 1)) * 2;
    const rad = Math.sqrt(1 - y * y);
    const th = ga * i;
    P.push([Math.cos(th) * rad, y, Math.sin(th) * rad, Math.random()]);
  }
  let W, H, R, cx, cy, dpr;
  const size = () => {
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    W = canvas.clientWidth; H = canvas.clientHeight;
    canvas.width = W * dpr; canvas.height = H * dpr;
    R = Math.min(W * 0.42, 520);
    cx = W / 2; cy = H - R * 0.12;
  };
  size();
  window.addEventListener('resize', size);
  let mx = 0, my = 0;
  window.addEventListener('pointermove', (e) => { mx = e.clientX / window.innerWidth - 0.5; my = e.clientY / window.innerHeight - 0.5; });
  let a = 0;
  const tilt = 0.42;
  const frame = () => {
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);
    const ay = a + mx * 0.6, ax = tilt + my * 0.25;
    const sa = Math.sin(ay), ca = Math.cos(ay), sx = Math.sin(ax), cxx = Math.cos(ax);
    for (const [x, y, z, k] of P) {
      let X1 = x * ca + z * sa, Z1 = -x * sa + z * ca;
      let Y1 = y * cxx - Z1 * sx; Z1 = y * sx + Z1 * cxx;
      const depth = (Z1 + 1) / 2;
      const px = cx + X1 * R, py = cy + Y1 * R;
      if (py > H + 4) continue;
      const s = 0.5 + depth * 1.3;
      ctx.globalAlpha = 0.1 + depth * 0.75;
      ctx.fillStyle = k < 0.08 ? '#d98a3d' : k < 0.14 ? '#7b80d6' : '#3a3a3e';
      ctx.fillRect(px - s / 2, py - s / 2, s, s);
    }
    ctx.globalAlpha = 1;
    a += 0.0016;
    if (!reduceMotion) requestAnimationFrame(frame);
  };
  frame();
}

/* ---------- cifra que cuenta ---------- */
function countUp(el, to, fmt, dur = 1600) {
  if (reduceMotion) { el.textContent = fmt(to); return; }
  const t0 = performance.now();
  const step = (t) => {
    const k = Math.min(1, (t - t0) / dur);
    const e = 1 - Math.pow(1 - k, 4);
    el.textContent = fmt(to * e);
    if (k < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

/* ---------- render ---------- */
// Sin acceso privado, los importes se sustituyen por una cifra ficticia difuminada
const money = (x, f = eur) => (S.priv ? f(x) : '0.000 €');
let S, unlocked = false, perfMode = 'pct', sortKey = 'peso', sortDir = -1;

function renderHero() {
  const n = document.getElementById('heroNum');
  countUp(n, S.twr, (v) => pct(v, 1));
  document.getElementById('heroSince').textContent = `${MONTHS_LONG[S.since.getMonth()]} de ${S.since.getFullYear()}`;
  document.querySelectorAll('[data-updated]').forEach((e) => (e.textContent = fmtDate(S.updated)));
}

function renderPerf() {
  const host = document.getElementById('perfChart');
  const lastC = S.c[S.c.length - 1];
  if (perfMode === 'pct') {
    const bench = S.bench;
    const narrow = host.clientWidth < 560;
    const lg = document.getElementById('perfLegend'); lg.hidden = !(bench && narrow);
    if (bench) document.getElementById('refName').textContent = bench.nombre;
    lineChart(host, S.c.map((p, i) => ({ x: p.date, y: p.acum, p, i })), {
      label: bench ? 'Rentabilidad acumulada semanal frente al MSCI World' : 'Rentabilidad acumulada semanal', zero: true, left: 52,
      ref: bench ? S.c.map((p, i) => ({ x: p.date, y: bench.acum[i] })) : null,
      right: bench && !narrow ? 104 : 12,
      mainLabel: narrow ? '' : 'Vela', refLabel: narrow ? '' : bench ? bench.nombre : '',
      fmtAxis: (t) => nf(0).format(t * 100) + ' %',
      tip: (b) => {
        let h = `<b>Semana del ${fmtDate(b.x)}</b><span class="row">Vela ${delta(b.y, 2)}</span>`;
        if (bench && bench.acum[b.i] != null) h += `<span class="row">${bench.nombre} ${delta(bench.acum[b.i], 2)}</span>`;
        return h + `<span class="row">Semana ${delta(b.p.r, 2)}</span>`;
      },
    });
    document.getElementById('perfNote').textContent = 'Rentabilidad ponderada por tiempo: las aportaciones y retiradas no cuentan como rendimiento.';
  } else {
    lineChart(host, S.pat.map((p) => ({ x: p.date, y: p.total })), {
      label: 'Patrimonio total semanal', left: 64,
      fmtAxis: (t) => nf(0).format(t / 1000) + ' k€',
      tip: (b) => `<b>${fmtDate(b.x)}</b><span class="row">${eur(b.y)}</span>`,
    });
    document.getElementById('perfLegend').hidden = true;
    document.getElementById('perfNote').textContent = 'Patrimonio total: inversiones más liquidez, incluidas las aportaciones.';
  }
  const best = [...S.c].slice(1).sort((a, b) => b.r - a.r)[0];
  const worst = [...S.c].slice(1).sort((a, b) => a.r - b.r)[0];
  const up = S.c.slice(1).filter((p) => p.r > 0).length;
  document.getElementById('perfStats').innerHTML = `
    <div><dt>Acumulada</dt><dd>${delta(lastC.acum, 2)}</dd></div>
    ${S.bench && S.bench.acum[S.c.length - 1] != null ? `<div><dt>Frente al ${S.bench.nombre}</dt><dd>${diffPP(lastC.acum - S.bench.acum[S.c.length - 1])}<small>${S.bench.nombre} ${pct(S.bench.acum[S.c.length - 1], 2)} en el mismo periodo</small></dd></div>` : ''}
    <div><dt>Mejor semana</dt><dd>${delta(best.r, 2)}<small>${fmtDate(best.date)}</small></dd></div>
    <div><dt>Peor semana</dt><dd>${delta(worst.r, 2)}<small>${fmtDate(worst.date)}</small></dd></div>
    <div><dt>Semanas en positivo</dt><dd>${up} de ${S.c.length - 1}</dd></div>`;
  barChart(document.getElementById('monthChart'), S.months);
}

function renderRisk() {
  const sec = document.getElementById('riesgo');
  const R = S.risk;
  sec.hidden = !R;
  if (!R) return;
  const bench = S.bench;
  const ddl = document.getElementById('ddLegend'); ddl.hidden = !(bench && R.ddB && document.getElementById('ddChart').clientWidth < 560);
  if (bench) document.getElementById('ddRefName').textContent = bench.nombre;
  lineChart(document.getElementById('ddChart'), S.c.map((p, i) => ({ x: p.date, y: R.ddV[i], i })), {
    label: 'Caída de la cartera desde su máximo anterior', zero: true, left: 52, height: 240,
    ref: bench && R.ddB ? S.c.map((p, i) => ({ x: p.date, y: R.ddB[i] })) : null,
    right: bench && document.getElementById('ddChart').clientWidth >= 560 ? 104 : 12,
    mainLabel: 'Vela', refLabel: bench ? bench.nombre : '',
    fmtAxis: (t) => nf(0).format(t * 100) + ' %',
    tip: (b) => `<b>${fmtDate(b.x)}</b><span class="row">Vela ${delta(b.y, 2)}</span>` +
      (bench && R.ddB ? `<span class="row">${bench.nombre} ${delta(R.ddB[b.i], 2)}</span>` : ''),
  });
  document.getElementById('ddNote').textContent = R.ddNow < -0.0005
    ? `Ahora mismo la cartera está un ${pctPlain(-R.ddNow)} por debajo de su máximo.`
    : 'La cartera está en máximos.';
  const k = [
    { t: 'Máxima caída', v: pct(R.maxDD), s: `Peor momento: ${fmtDate(R.ddDate)}`, fill: true },
    { t: 'Volatilidad anualizada', v: pctPlain(R.vol), s: 'Desviación de las rentabilidades semanales, llevada a un año' },
    { t: 'Ratio de Sharpe', v: num2(R.sharpe), s: `Rentabilidad anualizada sobre el ${nf(0).format(RF * 100)} % sin riesgo, por unidad de volatilidad` },
    { t: 'Ratio de Sortino', v: R.sortino != null ? num2(R.sortino) : '—', s: 'Como el Sharpe, pero solo penaliza las semanas negativas' },
  ];
  if (R.beta != null) {
    k.push({ t: `Beta frente al ${bench.nombre}`, v: num2(R.beta), s: 'Cuánto se mueve la cartera por cada 1 % que se mueve el índice' });
    k.push({ t: 'Correlación', v: num2(R.corr), s: `Con el ${bench.nombre}, de −1 a 1` });
  }
  document.getElementById('riskKpis').innerHTML = k
    .map((x) => `<div class="kpi ${x.fill ? 'fill' : ''}"><dt>${x.t}</dt><dd>${x.v}</dd><small>${esc(x.s)}</small></div>`).join('');
  document.getElementById('riskNote').textContent =
    `Calculado con ${R.n} semanas. Con menos de un año de historia, las cifras anualizadas son orientativas.`;
}

function renderAlloc() {
  const bar = document.getElementById('allocBar');
  bar.innerHTML = S.blocks
    .map((b) => `<span style="flex:${b.peso};background:${b.color}" title="${b.id} ${pctPlain(b.peso)}"></span>`)
    .join('');
  document.getElementById('allocList').innerHTML = S.blocks
    .map((b) => `
    <li>
      <span class="sw" style="background:${b.color}"></span>
      <div class="name"><strong>${b.id}</strong><small>${b.perfil}, ${b.n} ${b.n === 1 ? 'posición' : 'posiciones'}</small></div>
      <span class="w">${pctPlain(b.peso)}</span>
      <span class="r">${delta(b.rent)}</span>
      <span class="v priv">${money(b.valor)}</span>
    </li>`)
    .join('');
  document.getElementById('liqBar').innerHTML =
    `<span style="flex:${1 - S.cashPct}"></span><span style="flex:${S.cashPct}"></span>`;
  document.getElementById('liqText').innerHTML =
    `<span><i class="k inv"></i>Invertido ${pctPlain(1 - S.cashPct)}</span><span><i class="k cash"></i>Liquidez ${pctPlain(S.cashPct)}</span>`;
}

function renderTable() {
  const rows = [...S.pos].sort((a, b) => {
    const va = a[sortKey], vb = b[sortKey];
    return (typeof va === 'string' ? va.localeCompare(vb) : va - vb) * sortDir;
  });
  const maxW = Math.max(...S.pos.map((p) => p.peso));
  document.querySelector('#posTable tbody').innerHTML = rows
    .map((p) => {
      const b = BLOCKS.find((x) => x.id === p.bloque);
      return `<tr>
      <td class="pn"><span class="sw" style="background:${b.color}"></span><span><strong>${esc(p.nombre)}</strong><small>${p.ticker ? esc(p.ticker) + ', ' : ''}${esc(p.tipo)}, ${esc(p.broker)}</small>${tesisDe(p) ? `<button class="tlink" data-tesis="${esc(p.ticker || p.nombre)}">Leer tesis</button>` : ''}</span></td>
      <td class="hide-s">${p.bloque}</td>
      <td class="num"><span class="wbar"><i style="width:${(p.peso / maxW) * 100}%"></i></span>${pctPlain(p.peso)}</td>
      <td class="num">${delta(p.rent)}</td>
      <td class="num priv">${money(p.valor)}</td>
      <td class="num priv hide-s">${money(p.pl, eurSigned)}</td>
    </tr>`;
    })
    .join('');
  document.querySelectorAll('#posTable th[data-k]').forEach((th) => {
    th.setAttribute('aria-sort', th.dataset.k === sortKey ? (sortDir > 0 ? 'ascending' : 'descending') : 'none');
  });
}

function renderKpis() {
  const k = [
    { t: 'Renta variable', v: pctPlain(S.rv), s: 'Todo lo que no es el fondo de bonos a corto plazo', fill: 'apricot' },
    { t: 'Renta fija defensiva', v: pctPlain(S.rf), s: 'Neuberger Berman Short Duration Euro Bond' },
    { t: 'Mayor posición', v: pctPlain(S.biggest.peso), s: S.biggest.nombre },
    { t: 'Exposición EM + China', v: pctPlain(S.emChina), s: 'Solapamiento geográfico a vigilar' },
    { t: 'Mejor posición', v: pct(S.best.rent), s: S.best.nombre },
    { t: 'Peor posición', v: pct(S.worst.rent), s: S.worst.nombre },
  ];
  document.getElementById('kpis').innerHTML = k
    .map((x) => `<div class="kpi ${x.fill ? 'fill' : ''}"><dt>${x.t}</dt><dd>${x.v}</dd><small>${esc(x.s)}</small></div>`)
    .join('');
}

function renderLog() {
  const items = (S.raw.bitacora || []).slice().sort((a, b) => (a.fecha < b.fecha ? 1 : -1));
  const sec = document.getElementById('bitacora');
  sec.hidden = !items.length;
  if (!items.length) return;
  const all = sec.dataset.all === '1';
  const show = all ? items : items.slice(0, 4);
  document.getElementById('logList').innerHTML = show.map((e) => {
    const d = parseDate(e.fecha);
    return `<article class="log"><time datetime="${e.fecha}">${d.getDate()} ${MONTHS[d.getMonth()]}<span>${d.getFullYear()}</span></time>
      <div><h3>${esc(e.titulo)}</h3>${esc(e.texto).split(/\n+/).map((p) => `<p>${p}</p>`).join('')}</div></article>`;
  }).join('');
  const more = document.getElementById('logMore');
  more.hidden = items.length <= 4;
  more.textContent = all ? 'Ver menos' : `Ver las ${items.length} entradas`;
}

function renderIdeas() {
  document.getElementById('ideas').innerHTML = S.raw.ideas
    .map((i) => `<li><strong>${esc(i.nombre)}</strong><span>${i.ticker ? esc(i.ticker) : esc(i.isin)}</span><em>${esc(
i.tipo)}</em></li>`)
    .join('');
}

function renderPrivate() {
  if (!S.priv) { document.getElementById('privKpis').innerHTML = ''; document.getElementById('brokers').innerHTML = ''; return; }
  const d = S.raw;
  const pl = S.invested - S.cost;
  document.getElementById('privKpis').innerHTML = `
    <div class="kpi fill big"><dt>Patrimonio total</dt><dd data-c="${S.total}">${eur(S.total)}</dd><small>A ${fmtDate(S.updated)}</small></div>
    <div class="kpi"><dt>Invertido</dt><dd>${eur(S.invested)}</dd><small>Coste ${eur(S.cost)}</small></div>
    <div class="kpi"><dt>Liquidez</dt><dd>${eur(d.cash)}</dd><small>${pctPlain(S.cashPct)} del patrimonio</small></div>
    <div class="kpi"><dt>Plusvalía latente</dt><dd>${eurSigned(pl)}</dd><small>${pct(pl / S.cost)} sobre coste</small></div>
    <div class="kpi"><dt>Ganancias realizadas</dt><dd>${eurSigned(d.realizado.ventas)}</dd><small>Por ventas cerradas</small></div>
    <div class="kpi"><dt>Dividendos e intereses</dt><dd>${eurSigned(d.realizado.dividendos + d.realizado.intereses)}</dd><small>${eur(d.realizado.dividendos, 2)} dividendos, ${eur(d.realizado.intereses, 2)} intereses</small></div>`;
  const tot = Object.values(S.brokers).reduce((a, b) => a + b, 0);
  document.getElementById('brokers').innerHTML = Object.entries(S.brokers)
    .sort((a, b) => b[1] - a[1])
    .map(([k, v]) => `<li><span>${k}</span><span class="wbar"><i style="width:${(v / tot) * 100}%"></i></span><span class="num">${eur(v)}</span><span class="num muted">${pctPlain(v / tot)}</span></li>`)
    .join('');
}

function setUnlocked(v) {
  unlocked = v;
  document.body.classList.toggle('unlocked', v);
  document.querySelectorAll('[data-lockbtn]').forEach((b) => (b.textContent = v ? 'Ocultar importes' : 'Ver importes'));
  document.querySelector('[data-mode="eur"]').disabled = !v;
  if (!v && perfMode === 'eur') perfMode = 'pct';
  syncSeg();
}
function renderAll(first) {
  if (first) renderHero(); else document.querySelectorAll('[data-updated]').forEach((e) => (e.textContent = fmtDate(S.updated)));
  const pc = document.getElementById('perfChart');
  if (!first) { pc.dataset.drawn = 1; document.getElementById('ddChart').dataset.drawn = 1; }
  renderPerf(); renderRisk(); renderAlloc(); renderTable(); renderKpis(); renderLog(); renderIdeas(); renderPrivate();
}
function syncSeg() {
  document.querySelectorAll('.seg button').forEach((b) => b.setAttribute('aria-pressed', b.dataset.mode === perfMode));
}

/* ---------- arranque ---------- */
(async function init() {
  // Si ya se desbloqueó en esta pestaña, se pide directamente la versión privada
  const saved = store.get();
  let data;
  try {
    [data] = await Promise.all([loadData(saved), loadTesis()]);
    if (data.error === 'clave') { store.set(null); data = await loadData(); }
    if (data.error) throw new Error(data.detalle || data.error);
  } catch (err) {
    document.body.classList.add('failed');
    document.getElementById('loadErr').hidden = false;
    console.error(err);
    return;
  }
  S = derive(data);
  document.body.classList.remove('loading');
  renderAll(true);
  sphere(document.getElementById('sphere'));
  const por = document.getElementById('portrait');
  if (reduceMotion) por.classList.add('in');
  else { const pio = new IntersectionObserver((es) => { if (es[0].isIntersecting) { por.classList.add('in'); pio.disconnect(); } }, { threshold: 0.3 }); pio.observe(por); }
  const top = document.querySelector('.top');
  const onScroll = () => top.classList.toggle('solid', window.scrollY > window.innerHeight * 0.6);
  window.addEventListener('scroll', onScroll, { passive: true }); onScroll();
  setUnlocked(S.priv);

  document.querySelectorAll('.seg button').forEach((b) =>
    b.addEventListener('click', () => {
      if (b.disabled) return;
      perfMode = b.dataset.mode; syncSeg(); delete document.getElementById('perfChart').dataset.drawn; renderPerf();
    }));
  syncSeg();

  document.querySelectorAll('#posTable th[data-k]').forEach((th) => {
    const go = () => {
      if (sortKey === th.dataset.k) sortDir *= -1; else { sortKey = th.dataset.k; sortDir = th.dataset.k === 'nombre' || th.dataset.k === 'bloque' ? 1 : -1; }
      renderTable();
    };
    th.addEventListener('click', go);
    th.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); go(); } });
  });

  document.getElementById('logMore').addEventListener('click', () => {
    const sec = document.getElementById('bitacora'); sec.dataset.all = sec.dataset.all === '1' ? '' : '1'; renderLog();
  });

  // Tesis
  const panel = document.getElementById('tesis');
  const closeTesis = () => { panel.classList.remove('open'); document.body.style.overflow = ''; setTimeout(() => { if (!panel.classList.contains('open')) panel.querySelector('iframe').src = 'about:blank'; }, 400); };
  document.querySelector('#posTable tbody').addEventListener('click', (e) => {
    const b = e.target.closest('[data-tesis]');
    if (!b) return;
    const p = S.pos.find((x) => (x.ticker || x.nombre) === b.dataset.tesis);
    const t = tesisDe(p);
    panel.querySelector('h2').textContent = p.nombre;
    panel.querySelector('small').textContent = t.fecha ? `Tesis de ${fmtDate(parseDate(t.fecha))}` : 'Tesis de inversión';
    panel.querySelector('iframe').src = t.archivo;
    panel.querySelector('.ext').href = t.archivo;
    panel.classList.add('open'); document.body.style.overflow = 'hidden';
    panel.querySelector('.close').focus();
  });
  panel.querySelector('.close').addEventListener('click', closeTesis);
  panel.addEventListener('click', (e) => { if (e.target === panel) closeTesis(); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && panel.classList.contains('open')) closeTesis(); });

  // Compartir: hoja nativa del móvil o, si no existe, copiar el enlace
  const toast = (t) => { const el = document.getElementById('toast'); el.textContent = t; el.classList.add('show'); clearTimeout(toast.t); toast.t = setTimeout(() => el.classList.remove('show'), 2200); };
  document.querySelectorAll('[data-share]').forEach((b) => b.addEventListener('click', async () => {
    const url = 'https://gmanaua.github.io/vela-capital/';
    const data = { title: 'Vela Capital Management', text: 'Rumbo al largo plazo. Mi cartera personal, semana a semana.', url };
    if (navigator.share && matchMedia('(pointer: coarse)').matches) { try { await navigator.share(data); } catch {} return; }
    try { await navigator.clipboard.writeText(url); toast('Enlace copiado'); } catch { prompt('Copia el enlace:', url); }
  }));

  // Menú
  const menu = document.getElementById('menu'), mbtn = document.getElementById('menuBtn');
  const toggleMenu = (open) => {
    menu.classList.toggle('open', open); mbtn.setAttribute('aria-expanded', open);
    document.body.style.overflow = open ? 'hidden' : '';
  };
  mbtn.addEventListener('click', () => toggleMenu(!menu.classList.contains('open')));
  menu.querySelectorAll('a').forEach((a) => a.addEventListener('click', () => toggleMenu(false)));
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') { toggleMenu(false); closeLock(); } });

  // Acceso privado: la contraseña la comprueba el Apps Script, no la web
  const dlg = document.getElementById('lock');
  const closeLock = () => dlg.classList.remove('open');
  document.querySelectorAll('[data-lockbtn]').forEach((b) =>
    b.addEventListener('click', async () => {
      if (unlocked) { store.set(null); S = derive(await loadData()); setUnlocked(false); renderAll(false); return; }
      toggleMenu(false);
      dlg.classList.add('open'); document.getElementById('pw').value = ''; document.getElementById('pwErr').textContent = '';
      setTimeout(() => document.getElementById('pw').focus(), 50);
    }));
  dlg.querySelector('.close').addEventListener('click', closeLock);
  dlg.addEventListener('click', (e) => { if (e.target === dlg) closeLock(); });
  document.getElementById('lockForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const key = document.getElementById('pw').value;
    const btn = e.target.querySelector('.solid'), err = document.getElementById('pwErr');
    btn.disabled = true; btn.textContent = 'Comprobando…'; err.textContent = '';
    try {
      const d = await loadData(key);
      if (d.error === 'clave' || !d.privado) err.textContent = 'Contraseña incorrecta. Vuelve a intentarlo.';
      else { store.set(key); S = derive(d); setUnlocked(true); renderAll(false); closeLock(); }
    } catch { err.textContent = 'No se han podido cargar los datos. Inténtalo de nuevo.'; }
    btn.disabled = false; btn.textContent = 'Ver importes';
  });

  let rt;
  window.addEventListener('resize', () => {
    clearTimeout(rt);
    rt = setTimeout(() => { document.querySelectorAll('[data-drawn]').forEach((e) => (e.dataset.drawn = 1)); renderPerf(); renderRisk(); }, 150);
  });
})();
