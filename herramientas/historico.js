/**
 * Genera historico.json: la rentabilidad semanal de la cartera ANTES de la primera semana de la Google Sheet.
 *
 * Fuente: Portfolio Performance → Cuentas → Todas las transacciones → Exportar como CSV.
 * Con las operaciones y los cierres de mercado (Yahoo Finance) se reconstruye la cartera día a día y se
 * calcula la rentabilidad ponderada por tiempo de lo invertido (sin liquidez), igual que la pestaña CARTERA.
 * El resultado se guarda SOLO en porcentajes: el CSV, con importes en euros, no se sube al repositorio.
 *
 * Uso:  node herramientas/historico.js "<CSV de transacciones>" <hasta AAAA-MM-DD> [<desde AAAA-MM-DD>] [--prueba]
 *   hasta    = primera fecha de la pestaña CARTERA de la Sheet (ahí enlazan las dos series).
 *   desde    = primer día del histórico; por defecto, la primera operación.
 *   --prueba = muestra el resultado sin escribir historico.json.
 */
const fs = require('fs');
const path = require('path');

const args = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const PRUEBA = process.argv.includes('--prueba');
const [csv, hasta, desdeArg] = args;
if (!csv || !/^\d{4}-\d{2}-\d{2}$/.test(hasta || '')) { console.error('Uso: node herramientas/historico.js "<CSV>" <hasta AAAA-MM-DD> [<desde>] [--prueba]'); process.exit(1); }

const BENCH = { simbolo: 'IWDA.AS', nombre: 'MSCI World' };
/* Activo en Portfolio Performance → [símbolo en Yahoo, divisa]. Si compras un valor nuevo antes de `hasta`, añádelo aquí. */
const SIMBOLOS = {
  'ISHARES CORE MSCI WORLD': ['IWDA.AS', 'EUR'], 'NVIDIA CORP': ['NVD.DE', 'EUR'], 'VANG FTSE HDY USDA': ['VGWE.DE', 'EUR'],
  'ISHARES PHYSICAL GOLD ETC': ['PPFB.DE', 'EUR'], 'REPSOL SA': ['REP.MC', 'EUR'], 'CAIXABANK SA': ['CABK.MC', 'EUR'],
  'BANCO DE SABADELL SA': ['SAB.MC', 'EUR'], 'ISHARES NASDAQ 100 USD ACC': ['SXRV.DE', 'EUR'], 'LYXOR CORE EURSTX 600 DR': ['MEUD.PA', 'EUR'],
  'UBER TECHNOLOGIES INC': ['UT8.DE', 'EUR'], 'Bitcoin': ['BTC-EUR', 'EUR'], 'ISHARES MSCI EM ACC': ['IEMA.AS', 'EUR'],
  'ISHARES MSCI CHINA USD ACC': ['ICGA.DE', 'EUR'], 'AMPER SA': ['AMP.MC', 'EUR'], 'NUEVA EXPRESION TEXTIL SA': ['NXT.MC', 'EUR'],
  'OBRASCON HUARTE LAIN S.A.': ['OHLA.MC', 'EUR'], 'ONDAS INC': ['ONDS', 'USD'], 'SATELLOGIC INC-A': ['SATL', 'USD'],
  'MyInvestor Value': ['0P0001T8V7.F', 'EUR'], 'Cobas International Fund-P Acc EUR': ['0P0001A94B.F', 'EUR'], 'Robeco Smart Energy': ['LU2145461757.SG', 'EUR'],
  'iShares US Equity Index Fund clase S': ['0P0001XF42.F', 'EUR'], 'iShares Developed World ESG Screened Index Fund (IE) D Acc EUR': ['0P0001XF41.F', 'EUR'],
  'iShares Emerging Markets Index Fund (IE) S Acc EUR': ['0P0001XF3Z.F', 'EUR'], 'Fidelity MSCI Japan Index Fund P-ACC-EUR': ['0P0001CLDI.F', 'EUR'],
  'Fidelity MSCI Europe Index Fund P-ACC-EUR': ['0P0001CJGN.F', 'EUR'], 'Vanguard US Equity Index Fund EUR Hedged': ['0P00006TV8.F', 'EUR'],
  'Fidelity MSCI Pacific ex Japan': ['FEP0.MU', 'EUR'],
};

const num = (s) => (s === '' || s == null ? 0 : Number(String(s).replace(/\./g, '').replace(',', '.')));
const ops = fs.readFileSync(csv, 'utf8').replace(/^﻿/, '').trim().split(/\r?\n/).slice(1).map((l) => {
  const c = l.split(';');
  return { fecha: c[0].slice(0, 10), tipo: c[1], activo: c[2].replace(/"/g, '').trim(), tit: num(c[3]), precio: num(c[4]), neto: num(c[8]) };
}).filter((o) => o.activo && /^(Compra|Venta|Dividendo)$/.test(o.tipo) && o.fecha <= hasta).sort((a, b) => (a.fecha < b.fecha ? -1 : a.fecha > b.fecha ? 1 : 0));

const utc = (s) => new Date(s + 'T00:00:00Z');
const iso = (d) => d.toISOString().slice(0, 10);
const desde = desdeArg || ops[0].fecha;

async function cierres(simbolo) {
  const p1 = Math.floor(utc(ops[0].fecha) / 1000) - 12 * 86400, p2 = Math.floor(utc(hasta) / 1000) + 3 * 86400;
  try {
    const res = await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(simbolo)}?interval=1d&period1=${p1}&period2=${p2}`, { headers: { 'User-Agent': 'Mozilla/5.0' } });
    const r = (await res.json()).chart.result[0];
    return r.timestamp.map((t, i) => [iso(new Date(t * 1000)), r.indicators.quote[0].close[i]]).filter((p) => typeof p[1] === 'number');
  } catch { return null; }
}
// último cierre disponible en o antes de la fecha
const en = (serie, f) => { let v = null; if (serie) for (const [d, p] of serie) { if (d <= f) v = p; else break; } return v; };

(async () => {
  const activos = [...new Set(ops.map((o) => o.activo))];
  const px = {}, avisos = [];
  const fx = await cierres('EURUSD=X');
  for (const a of activos) {
    const s = SIMBOLOS[a];
    px[a] = s ? await cierres(s[0]) : null;
    if (!px[a]) avisos.push(`Sin cotizaciones para "${a}": se valora al precio de su última operación.`);
  }
  const precio = (a, f) => {
    let p = en(px[a], f);
    if (p != null && SIMBOLOS[a][1] === 'USD') p /= en(fx, f);
    if (p == null) { const o = ops.filter((x) => x.activo === a && x.fecha <= f && x.precio).pop(); p = o ? o.precio : 0; } // sin cotización: precio de la última operación
    return p;
  };

  // Cartera día a día. Rentabilidad del día = (valor final + ventas + dividendos) / (valor inicial + compras) − 1
  const tit = {};
  let vPrev = 0, acum = 1;
  const diario = [];
  for (let d = utc(ops[0].fecha); iso(d) <= hasta; d = new Date(d.getTime() + 864e5)) {
    const f = iso(d);
    let compras = 0, ventas = 0;
    for (const o of ops) {
      if (o.fecha !== f) continue;
      if (o.tipo === 'Compra') { tit[o.activo] = (tit[o.activo] || 0) + o.tit; compras += o.neto; }
      else if (o.tipo === 'Venta') { tit[o.activo] = (tit[o.activo] || 0) - o.tit; if (Math.abs(tit[o.activo]) < 1e-6) delete tit[o.activo]; ventas += o.neto; }
      else ventas += o.neto; // dividendo: sale de la cartera como efectivo, pero es rendimiento
    }
    const v = Object.keys(tit).reduce((s, a) => s + tit[a] * precio(a, f), 0);
    const r = vPrev + compras > 0 ? (v + ventas) / (vPrev + compras) - 1 : 0;
    if (f > desde) acum *= 1 + r; // el día de inicio es la base: lo anterior no cuenta
    diario.push({ f, v, acum: f >= desde ? acum : null });
    vPrev = v;
  }
  const acumEn = new Map(diario.filter((x) => x.acum != null).map((x) => [x.f, x.acum]));

  // Fechas: el día de inicio y, después, cada viernes hasta la fecha de enlace
  const fechas = [desde];
  for (let d = new Date(utc(desde).getTime() + 864e5); iso(d) <= hasta; d = new Date(d.getTime() + 864e5)) if (d.getUTCDay() === 5) fechas.push(iso(d));
  if (fechas[fechas.length - 1] !== hasta) fechas.push(hasta);
  const cartera = fechas.map((f, i) => ({ fecha: f, r: i ? acumEn.get(f) / acumEn.get(fechas[i - 1]) - 1 : 0 }));

  // Índice de referencia en las mismas fechas (último cierre en o antes de cada una), como hace el Apps Script
  const sb = await cierres(BENCH.simbolo);
  const cb = (f) => en(sb, f);
  const bench = sb ? { ...BENCH, acum: fechas.map((f) => cb(f) / cb(desde) - 1) } : null;

  const red = (x) => Math.round(x * 1e6) / 1e6;
  const out = { fuente: 'Operaciones de Portfolio Performance y cierres de Yahoo Finance', desde, hasta, cartera: cartera.map((p) => ({ fecha: p.fecha, r: red(p.r) })), bench: bench && { ...bench, acum: bench.acum.map(red) } };
  avisos.forEach((a) => console.warn('Aviso:', a));
  console.log(`${fechas.length} puntos, ${desde} -> ${hasta}. Cartera ${((acumEn.get(hasta) - 1) * 100).toFixed(2)} %` + (bench ? `, ${BENCH.nombre} ${(bench.acum[bench.acum.length - 1] * 100).toFixed(2)} %` : '') + `. Valor reconstruido a ${hasta}: ${diario[diario.length - 1].v.toFixed(2)} €`);
  if (PRUEBA) { module.exports = { diario, cartera, bench }; if (process.env.DETALLE) console.log(JSON.stringify({ diario: diario.map((x) => [x.f, +x.v.toFixed(2), x.acum && +x.acum.toFixed(5)]) })); return; }
  fs.writeFileSync(path.join(__dirname, '..', 'historico.json'), JSON.stringify(out) + '\n');
})();
