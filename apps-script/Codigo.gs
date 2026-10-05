/**
 * Vela Capital Management — conexión entre Google Sheets y la web.
 *
 * Qué hace:
 *  - configurar(): crea (o rehace) la hoja "WEB" con las posiciones y el resumen,
 *    enlazados con fórmulas a GENERAL. Las semanas (CARTERA, PATRIMONIO) y las ideas
 *    (IDEAS) se leen directamente de sus hojas.
 *  - doGet(): responde a la web con los datos en formato JSON.
 *      · Sin contraseña  → solo porcentajes (rentabilidades y pesos).
 *      · Con contraseña  → además, los importes en euros.
 *  - cambiarClave(): guarda la contraseña de la zona privada (no se escribe en el código).
 *
 * Tú solo tienes que seguir apuntando en tus hojas de siempre.
 * Si añades o quitas una posición, añade o quita también su fila en la hoja WEB.
 */

const HOJA = 'WEB';

/* Índice de referencia: iShares Core MSCI World cotizado en euros (Ámsterdam) */
const BENCH = { simbolo: 'IWDA.AS', nombre: 'MSCI World' };

/* Posiciones actuales: [nombre, ticker, bloque, broker, tipo, fila en GENERAL] */
const POSICIONES = [
  ['Neuberger Berman Short Duration Euro Bond Fund', '', 'Core', 'MyInvestor', 'Fondo RF', 11],
  ['Roboadvisor', '', 'Core', 'MyInvestor', 'Roboadvisor', 12],
  ['Fidelity MSCI World', '', 'Core', 'MyInvestor', 'Fondo indexado', 13],
  ['MyInvestor Value', '', 'Value', 'MyInvestor', 'Fondo', 16],
  ['Cobas International', '', 'Value', 'MyInvestor', 'Fondo', 17],
  ['MSCI EM', '', 'Temáticos', 'Trade Republic', 'ETF', 20],
  ['MSCI China', '', 'Temáticos', 'Trade Republic', 'ETF', 21],
  ['Robeco Smart Energy', '', 'Temáticos', 'MyInvestor', 'Fondo', 22],
  ['IREN Ltd', 'IREN', 'Acciones', 'IBKR', 'Acción', 25],
  ['Uber Technologies', 'UBER', 'Acciones', 'IBKR', 'Acción', 26],
  ['Lithium Americas', 'LAC', 'Acciones', 'IBKR', 'Acción', 27],
  ['Amper', 'AMP', 'Acciones', 'Trade Republic', 'Acción', 28],
  ['Netflix', 'NFLX', 'Acciones', 'IBKR', 'Acción', 29],
  ['Nueva Expresión Textil', 'NXT', 'Acciones', 'IBKR', 'Acción', 30],
  ['Banco Sabadell', 'SAB', 'Acciones', 'Trade Republic', 'Acción', 31],
];

/* ------------------------------------------------------------------ */
/*  1. Ejecuta esta función UNA vez para crear la hoja WEB             */
/* ------------------------------------------------------------------ */
function configurar() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sh = ss.getSheetByName(HOJA) || ss.insertSheet(HOJA);
  sh.clear();

  // A:G — Posiciones
  sh.getRange('A1:G1').setValues([['Posición', 'Ticker', 'Bloque', 'Broker', 'Tipo', 'Invertido €', 'Valor €']]);
  const filas = POSICIONES.map(([n, t, b, br, ti, f]) => [n, t, b, br, ti, `=GENERAL!F${f}`, `=GENERAL!G${f}`]);
  sh.getRange(2, 1, filas.length, 7).setValues(filas);

  // P:Q — Resumen
  sh.getRange('P1:Q5').setValues([
    ['Concepto', 'Importe €'],
    ['Liquidez', '=GENERAL!C6'],
    ['Ganancias realizadas', '=GENERAL!C50+GENERAL!C83'],
    ['Dividendos', '=GENERAL!C58'],
    ['Intereses', '=GENERAL!D48'],
  ]);

  // Pestaña BITÁCORA (solo se crea si no existe; nunca se borra lo que escribas)
  if (!ss.getSheetByName('BITÁCORA')) {
    const bt = ss.insertSheet('BITÁCORA');
    bt.getRange('A1:C1').setValues([['Fecha', 'Título', 'Texto']]).setFontWeight('bold');
    bt.setFrozenRows(1);
    bt.getRange('A:A').setNumberFormat('dd/mm/yyyy');
    bt.setColumnWidth(1, 110); bt.setColumnWidth(2, 260); bt.setColumnWidth(3, 620);
    bt.getRange('C:C').setWrap(true);
  }

  sh.getRange('1:1').setFontWeight('bold');
  sh.setFrozenRows(1);
  sh.getRange('F:G').setNumberFormat('#,##0.00 €');
  sh.getRange('Q:Q').setNumberFormat('#,##0.00 €');
  sh.autoResizeColumns(1, 17);
  SpreadsheetApp.getUi().alert('Hoja WEB lista (y pestaña BITÁCORA, si no existía). Revisa que las cifras coinciden con GENERAL y CARTERA.');
}

/* ------------------------------------------------------------------ */
/*  2. Ejecuta esta función para poner o cambiar la contraseña         */
/* ------------------------------------------------------------------ */
function cambiarClave() {
  const ui = SpreadsheetApp.getUi();
  const r = ui.prompt('Contraseña de la zona privada', 'Escribe la nueva contraseña (mínimo 10 caracteres):', ui.ButtonSet.OK_CANCEL);
  if (r.getSelectedButton() !== ui.Button.OK) return;
  const k = r.getResponseText().trim();
  if (k.length < 10) return ui.alert('Demasiado corta. Usa al menos 10 caracteres.');
  PropertiesService.getScriptProperties().setProperty('CLAVE', k);
  ui.alert('Contraseña guardada.');
}

/* ------------------------------------------------------------------ */
/*  3. Lo que llama la web                                             */
/* ------------------------------------------------------------------ */
function doGet(e) {
  const p = (e && e.parameter) || {};
  const clave = PropertiesService.getScriptProperties().getProperty('CLAVE');
  const privado = !!(p.key && clave && p.key === clave);
  let out;
  try {
    out = construir(privado);
    if (p.key && !privado) { Utilities.sleep(1500); out.error = 'clave'; }
  } catch (err) {
    out = { error: 'datos', detalle: String(err) };
  }
  return ContentService.createTextOutput(JSON.stringify(out)).setMimeType(ContentService.MimeType.JSON);
}

function construir(privado) {
  const sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(HOJA);
  if (!sh) throw new Error('Falta la hoja WEB. Ejecuta configurar().');
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const v = sh.getDataRange().getValues();
  const leer = (hoja, rango) => ss.getSheetByName(hoja).getRange(rango).getValues();
  const num = (x) => (typeof x === 'number' && isFinite(x) ? x : 0);
  const iso = (d) => Utilities.formatDate(d, 'Europe/Madrid', 'yyyy-MM-dd');
  const hoy = new Date();

  // Semanas
  const semanas = [];
  leer('CARTERA', 'C6:E500').forEach(([f, val, aport]) => {
    if (f instanceof Date && typeof val === 'number' && f <= hoy) semanas.push({ f, valor: val, aport: num(aport) });
  });
  semanas.sort((a, b) => a.f - b.f);
  const cartera = semanas.map((s, i) => {
    const r = i === 0 ? 0 : (s.valor - semanas[i - 1].valor - s.aport) / semanas[i - 1].valor;
    const o = { fecha: iso(s.f), r };
    if (privado) { o.valor = round(s.valor); o.aportacion = round(s.aport); }
    return o;
  });

  // Posiciones
  const pos = [];
  for (let i = 1; i < v.length; i++) {
    const nombre = v[i][0];
    if (!nombre) continue;
    pos.push({ nombre: String(nombre), ticker: v[i][1] ? String(v[i][1]) : null, bloque: v[i][2], broker: v[i][3], tipo: v[i][4], invertido: num(v[i][5]), valor: num(v[i][6]) });
  }
  const invertido = pos.reduce((s, x) => s + x.valor, 0);
  const posiciones = pos.map((x) => {
    const o = { nombre: x.nombre, ticker: x.ticker, bloque: x.bloque, broker: x.broker, tipo: x.tipo, peso: x.valor / invertido, rent: x.invertido ? x.valor / x.invertido - 1 : 0 };
    if (privado) { o.invertido = round(x.invertido); o.valor = round(x.valor); }
    return o;
  });

  // Resumen
  const resumen = {};
  for (let i = 1; i < v.length; i++) if (v[i][15]) resumen[v[i][15]] = num(v[i][16]);
  const cash = resumen['Liquidez'] || 0;

  // Ideas
  const tipos = { 'ACC.': 'Acción', FONDO: 'Fondo', ETF: 'ETF' };
  const ideas = [];
  leer('IDEAS', 'C4:F18').forEach(([n, t, isin, tipo]) => {
    if (n) ideas.push({ nombre: String(n), ticker: t ? String(t) : null, isin: isin ? String(isin) : null, tipo: tipos[tipo] || tipo });
  });

  // Bitácora
  const bitacora = [];
  const bt = ss.getSheetByName('BITÁCORA');
  if (bt && bt.getLastRow() > 1) {
    bt.getRange(2, 1, bt.getLastRow() - 1, 3).getValues().forEach(([f, t, x]) => {
      if (f instanceof Date && (t || x)) bitacora.push({ fecha: iso(f), titulo: String(t || ''), texto: String(x || '') });
    });
  }

  const out = {
    privado,
    bitacora,
    bench: referencia(semanas.map((s) => s.f)),
    actualizado: cartera.length ? cartera[cartera.length - 1].fecha : null,
    cashPct: cash / (cash + invertido),
    cartera, posiciones, ideas,
  };

  if (privado) {
    const patrimonio = [];
    leer('PATRIMONIO', 'C3:D500').forEach(([f, t]) => {
      if (f instanceof Date && typeof t === 'number' && f <= hoy) patrimonio.push({ fecha: iso(f), total: round(t) });
    });
    patrimonio.sort((a, b) => (a.fecha < b.fecha ? -1 : 1));
    out.patrimonio = patrimonio;
    out.cash = round(cash);
    out.realizado = { ventas: round(resumen['Ganancias realizadas'] || 0), dividendos: round(resumen['Dividendos'] || 0), intereses: round(resumen['Intereses'] || 0) };
  }
  return out;
}

const round = (x) => Math.round(x * 100) / 100;

/* Rentabilidad acumulada del índice en las mismas fechas que tu cartera.
   Usa el último cierre disponible en o antes de cada fecha. Si falla, la web lo oculta. */
function referencia(fechas) {
  if (!fechas.length) return null;
  try {
    const cache = CacheService.getScriptCache();
    let serie = cache.get('bench');
    if (serie) serie = JSON.parse(serie);
    else {
      const desde = Math.floor(fechas[0].getTime() / 1000) - 10 * 86400;
      const hasta = Math.floor(Date.now() / 1000) + 86400;
      const url = 'https://query1.finance.yahoo.com/v8/finance/chart/' + BENCH.simbolo + '?interval=1d&period1=' + desde + '&period2=' + hasta;
      const res = UrlFetchApp.fetch(url, { muteHttpExceptions: true, headers: { 'User-Agent': 'Mozilla/5.0' } });
      if (res.getResponseCode() !== 200) return null;
      const r = JSON.parse(res.getContentText()).chart.result[0];
      const t = r.timestamp, c = r.indicators.quote[0].close;
      serie = t.map((x, i) => [x * 1000, c[i]]).filter((p) => typeof p[1] === 'number');
      cache.put('bench', JSON.stringify(serie), 6 * 3600);
    }
    const cierre = (f) => {
      const lim = f.getTime() + 86400000; // incluye el cierre de ese mismo día
      let v = null;
      for (const [t, p] of serie) { if (t <= lim) v = p; else break; }
      return v;
    };
    const base = cierre(fechas[0]);
    if (!base) return null;
    return { nombre: BENCH.nombre, simbolo: BENCH.simbolo, acum: fechas.map((f) => { const v = cierre(f); return v ? v / base - 1 : null; }) };
  } catch (err) {
    return null;
  }
}

/* Prueba rápida: muestra en el registro lo que recibiría la web */
function probar() {
  const d = construir(false);
  Logger.log('Semanas: %s, última: %s, rentabilidad última semana: %s', d.cartera.length, d.actualizado, d.cartera[d.cartera.length - 1].r);
  Logger.log('Posiciones: %s, ideas: %s, liquidez: %s', d.posiciones.length, d.ideas.length, d.cashPct);
  Logger.log('MSCI World: %s', d.bench ? 'acumulada ' + d.bench.acum[d.bench.acum.length - 1] : 'no disponible');
}

/* Menú para tenerlo a mano dentro de la hoja */
function onOpen() {
  SpreadsheetApp.getUi().createMenu('Vela web')
    .addItem('Crear / rehacer hoja WEB', 'configurar')
    .addItem('Cambiar contraseña', 'cambiarClave')
    .addToUi();
}
