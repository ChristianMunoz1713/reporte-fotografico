/* Reporte Fotográfico de Calidad — ANTES / DESPUÉS
   App web instalable (PWA). Todo se guarda en el dispositivo (IndexedDB). */
'use strict';

/* ---------------- Utilidades ---------------- */
const $ = (s, el = document) => el.querySelector(s);
const esc = (t) => String(t ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
const hoyISO = () => { const d = new Date(); d.setMinutes(d.getMinutes() - d.getTimezoneOffset()); return d.toISOString().slice(0, 10); };
const fechaLarga = (iso) => { if (!iso) return ''; const [y, m, d] = iso.split('-'); return `${d}/${m}/${y}`; };
const FASES = { antes: 'ANTES', despues: 'DESPUÉS' };

function aviso(msg, ms = 2500) {
  const el = $('#aviso');
  el.textContent = msg;
  el.classList.add('visible');
  clearTimeout(aviso.t);
  aviso.t = setTimeout(() => el.classList.remove('visible'), ms);
}

/* ---------------- Ajustes (localStorage) ---------------- */
const AJUSTES_DEF = { empresa: 'AUTOCOM SERVICES', taller: '', supervisor: '', sello: true, incluirOmitidos: false };
function leerAjustes() {
  try { return { ...AJUSTES_DEF, ...JSON.parse(localStorage.getItem('ajustes') || '{}') }; } catch { return { ...AJUSTES_DEF }; }
}
function guardarAjustes(a) { try { localStorage.setItem('ajustes', JSON.stringify(a)); } catch { /* sin almacenamiento */ } }

/* ---------------- Base de datos (IndexedDB) ---------------- */
const DB = {
  db: null,
  abrir() {
    if (this.db) return Promise.resolve(this.db);
    return new Promise((res, rej) => {
      const r = indexedDB.open('reporte-foto', 1);
      r.onupgradeneeded = () => {
        const db = r.result;
        db.createObjectStore('reportes', { keyPath: 'id' });
        db.createObjectStore('fotos');
      };
      r.onsuccess = () => { this.db = r.result; res(this.db); };
      r.onerror = () => rej(r.error);
    });
  },
  async tx(store, modo, fn) {
    const db = await this.abrir();
    return new Promise((res, rej) => {
      const t = db.transaction(store, modo);
      const s = t.objectStore(store);
      const out = fn(s);
      t.oncomplete = () => res(out && 'result' in out ? out.result : undefined);
      t.onerror = () => rej(t.error);
      t.onabort = () => rej(t.error);
    });
  },
  get: (st, k) => DB.tx(st, 'readonly', (s) => s.get(k)),
  todos: (st) => DB.tx(st, 'readonly', (s) => s.getAll()),
  poner: (st, v, k) => DB.tx(st, 'readwrite', (s) => (k === undefined ? s.put(v) : s.put(v, k))),
  borrar: (st, k) => DB.tx(st, 'readwrite', (s) => s.delete(k)),
};

const claveFoto = (repId, defId, fase) => `${repId}|${defId}|${fase}`;
const urls = new Map(); // caché de miniaturas
async function urlFoto(clave) {
  if (urls.has(clave)) return urls.get(clave);
  const blob = await DB.get('fotos', clave);
  if (!blob) return null;
  const u = URL.createObjectURL(blob);
  urls.set(clave, u);
  return u;
}
function olvidarUrl(clave) { if (urls.has(clave)) { URL.revokeObjectURL(urls.get(clave)); urls.delete(clave); } }

async function guardarReporte(r) { r.actualizado = Date.now(); await DB.poner('reportes', r); }

/* ---------------- Procesamiento de fotos ---------------- */
function cargarImagen(src) {
  return new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = src; });
}
async function procesarFoto(file) {
  const ajustes = leerAjustes();
  const u = URL.createObjectURL(file);
  try {
    const img = await cargarImagen(u); // el navegador ya respeta la orientación EXIF
    const MAX = 1280;
    const k = Math.min(1, MAX / Math.max(img.naturalWidth, img.naturalHeight));
    const w = Math.round(img.naturalWidth * k), h = Math.round(img.naturalHeight * k);
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    const g = c.getContext('2d');
    g.drawImage(img, 0, 0, w, h);
    if (ajustes.sello) {
      const d = new Date(file.lastModified || Date.now());
      const p = (n) => String(n).padStart(2, '0');
      const txt = `${p(d.getDate())}/${p(d.getMonth() + 1)}/${String(d.getFullYear()).slice(2)} ${p(d.getHours())}:${p(d.getMinutes())}`;
      const fs = Math.round(Math.max(w, h) * 0.028);
      g.font = `600 ${fs}px system-ui, sans-serif`;
      g.textAlign = 'right'; g.textBaseline = 'bottom';
      g.lineWidth = Math.max(2, fs / 6); g.strokeStyle = 'rgba(0,0,0,.75)'; g.fillStyle = '#fff';
      g.strokeText(txt, w - fs * 0.5, h - fs * 0.35);
      g.fillText(txt, w - fs * 0.5, h - fs * 0.35);
    }
    return await new Promise((res) => c.toBlob(res, 'image/jpeg', 0.8));
  } finally { URL.revokeObjectURL(u); }
}

/* ---------------- Navegación ---------------- */
let instalarEvt = null;
const estado = { fase: 'antes', importacion: null };

function ir(hash) { if (location.hash === hash) render(); else location.hash = hash; }
window.addEventListener('hashchange', render);

async function render() {
  const h = location.hash || '#/';
  const partes = h.slice(2).split('/');
  $('#btnAtras').hidden = h === '#/' || h === '#';
  try {
    if (partes[0] === 'reporte' && partes[1]) await vistaReporte(partes[1]);
    else if (partes[0] === 'importar') vistaImportar();
    else if (partes[0] === 'ajustes') vistaAjustes();
    else await vistaInicio();
  } catch (e) {
    console.error(e);
    $('#vista').innerHTML = `<div class="tarjeta">Ocurrió un error: ${esc(e.message)}</div>`;
  }
  window.scrollTo(0, 0);
}

$('#btnAtras').onclick = () => ir('#/');
$('#btnAjustes').onclick = () => ir('#/ajustes');

/* ---------------- Vista: inicio ---------------- */
function progreso(r, fase) {
  const activos = r.defectos.filter((d) => !d.omitir);
  const hechos = activos.filter((d) => d.fotos[fase]).length;
  return { hechos, total: activos.length };
}

async function vistaInicio() {
  $('#titulo').textContent = 'Reporte Fotográfico';
  const reps = (await DB.todos('reportes')).sort((a, b) => b.actualizado - a.actualizado);
  const lista = reps.map((r) => {
    const a = progreso(r, 'antes'), d = progreso(r, 'despues');
    const omit = r.defectos.filter((x) => x.omitir).length;
    const pct = a.total + d.total ? Math.round(((a.hechos + d.hechos) / (a.total + d.total)) * 100) : 0;
    return `<div class="tarjeta reporte-item" data-abrir="${r.id}">
      <div class="info">
        <div class="unidad">${esc(r.unidad || 'Sin unidad')}</div>
        <div class="sub">${esc(fechaLarga(r.fecha))} · ${r.defectos.length} defectos${omit ? ` · ${omit} sin foto` : ''}</div>
        <div class="sub">Antes ${a.hechos}/${a.total} · Después ${d.hechos}/${d.total}</div>
        <div class="barra-progreso"><div style="width:${pct}%"></div></div>
      </div>
      <div style="font-size:1.4rem;color:var(--gris)">&#8250;</div>
    </div>`;
  }).join('');

  $('#vista').innerHTML = `
    <div class="fila-botones" style="margin-bottom:16px">
      <button class="btn primario" id="btnImportar">Importar archivo de Tcar</button>
      <button class="btn" id="btnNuevo">Nuevo reporte manual</button>
    </div>
    ${lista || '<div class="vacio">Aún no hay reportes.<br>Importa el archivo de defectos exportado de Tcar para empezar.</div>'}`;

  $('#btnImportar').onclick = () => ir('#/importar');
  $('#btnNuevo').onclick = async () => {
    const aj = leerAjustes();
    const r = { id: uid(), unidad: '', fecha: hoyISO(), supervisor: aj.supervisor, taller: aj.taller, orden: '', idFoto: { antes: false, despues: false }, defectos: [], creado: Date.now() };
    await guardarReporte(r);
    ir('#/reporte/' + r.id);
  };
  $('#vista').querySelectorAll('[data-abrir]').forEach((el) => (el.onclick = () => ir('#/reporte/' + el.dataset.abrir)));
}

/* ---------------- Vista: ajustes ---------------- */
function vistaAjustes() {
  $('#titulo').textContent = 'Ajustes';
  const a = leerAjustes();
  $('#vista').innerHTML = `
    <div class="tarjeta">
      <h2>Datos del reporte</h2>
      <div class="campos">
        <label class="campo">Empresa<input id="ajEmpresa" value="${esc(a.empresa)}"></label>
        <label class="campo">Taller<input id="ajTaller" value="${esc(a.taller)}" placeholder="Ej. APIZACO"></label>
      </div>
    </div>
    <div class="tarjeta">
      <h2>Fotos y PDF</h2>
      <label class="check"><input type="checkbox" id="ajSello" ${a.sello ? 'checked' : ''}> Imprimir fecha y hora en cada foto</label>
      <label class="check"><input type="checkbox" id="ajOmit" ${a.incluirOmitidos ? 'checked' : ''}> Agregar al PDF la lista de defectos sin foto</label>
    </div>
    <button class="btn primario" id="ajGuardar" style="width:100%">Guardar</button>
    <p class="sub" style="margin-top:16px">Los reportes y fotos se guardan solo en este dispositivo. Genera y comparte el PDF antes de borrar un reporte.</p>`;
  $('#ajGuardar').onclick = () => {
    guardarAjustes({
      empresa: $('#ajEmpresa').value.trim(), taller: $('#ajTaller').value.trim(),
      sello: $('#ajSello').checked, incluirOmitidos: $('#ajOmit').checked,
    });
    aviso('Ajustes guardados');
    ir('#/');
  };
}

/* ---------------- Vista: importar de Tcar ---------------- */
const CAMPOS_MAPEO = [
  { k: 'inicial', t: 'Inicial / marca (opcional)', re: /inicial|initial|marca|siglas|reporting/i },
  { k: 'unidad', t: 'Número de unidad', re: /unidad|carro|equipo|vag[oó]n|car.?(no|num)|^car$|econ[oó]mico|n[uú]m.*(unidad|carro)|^n[uú]mero$/i },
  { k: 'ubicacion', t: 'Ubicación', re: /ubic|locat|^loc|posici|zona|lado|^ub$/i },
  { k: 'codigo', t: 'Motivo', re: /motivo|motive/i },
  { k: 'descripcion', t: 'Descripción del defecto', re: /descrip|defect|concepto|actividad|observ|falla/i },
];

function vistaImportar() {
  $('#titulo').textContent = 'Importar de Tcar';
  const imp = estado.importacion;
  if (!imp) {
    $('#vista').innerHTML = `
      <div class="tarjeta">
        <h2>1. Archivo exportado de Tcar</h2>
        <p class="sub">Selecciona la tarjeta de inspección (Excel) de la unidad. Puedes elegir varias tarjetas a la vez.</p>
        <button class="btn primario" id="btnArchivo" style="width:100%">Elegir archivo (.xlsx / .csv)</button>
      </div>
      <div class="tarjeta">
        <h2>…o pega la tabla</h2>
        <p class="sub">Copia la tabla de defectos en Tcar (incluyendo encabezados) y pégala aquí.</p>
        <label class="campo"><textarea id="txtPegar" rows="6" placeholder="Unidad&#9;Ubicación&#9;Código&#9;Descripción"></textarea></label>
        <button class="btn" id="btnPegar" style="width:100%;margin-top:10px">Usar texto pegado</button>
      </div>`;
    $('#btnArchivo').onclick = () => $('#archivoTcar').click();
    $('#btnPegar').onclick = () => {
      const t = $('#txtPegar').value.trim();
      if (!t) return aviso('Pega primero la tabla');
      const sep = t.includes('\t') ? '\t' : (t.split('\n')[0].includes(';') ? ';' : ',');
      const filas = t.split(/\r?\n/).map((l) => l.split(sep).map((c) => c.trim()));
      iniciarMapeo({ nombre: 'Texto pegado', hojas: { Pegado: filas } });
    };
    return;
  }

  const filas = imp.hojas[imp.hoja];
  const enc = filas[imp.filaEnc] || [];
  const opciones = (sel) => `<option value="-1">— ninguna —</option>` + enc.map((h, i) =>
    `<option value="${i}" ${sel === i ? 'selected' : ''}>${esc(h || 'Columna ' + (i + 1))}</option>`).join('');
  const defs = construirDefectos(imp);
  const unidades = [...defs.keys()];
  const muestra = unidades.slice(0, 1).flatMap((u) => defs.get(u).slice(0, 6).map((d) => [u, d]));

  $('#vista').innerHTML = `
    <div class="tarjeta">
      <h2>2. Columnas</h2>
      <p class="sub">${esc(imp.nombre)}</p>
      <div class="campos">
        ${Object.keys(imp.hojas).length > 1 ? `<label class="campo">Hoja<select id="selHoja">${Object.keys(imp.hojas).map((h) => `<option ${h === imp.hoja ? 'selected' : ''}>${esc(h)}</option>`).join('')}</select></label>` : ''}
        <label class="campo">Fila de encabezados<input type="number" id="numEnc" min="1" value="${imp.filaEnc + 1}"></label>
        ${imp.mapa.unidad < 0 ? `<label class="campo">Unidad (de la tarjeta)<input id="unidadFija" value="${esc(imp.unidadFija)}" placeholder="Ej. TTGX706759"></label>` : ''}
        ${CAMPOS_MAPEO.map((c) => `<label class="campo">${c.t}<select data-map="${c.k}">${opciones(imp.mapa[c.k])}</select></label>`).join('')}
      </div>
      <p class="sub" style="margin-top:12px">La leyenda se arma solo con <b>UBICACIÓN X MOTIVO - DESCRIPCIÓN</b>, igual que en sus reportes.</p>
    </div>
    <div class="tarjeta">
      <h2>Vista previa</h2>
      ${muestra.length ? `<div class="desplazable"><table class="tabla-prev"><tr><th>Unidad</th><th>Leyenda</th></tr>
        ${muestra.map(([u, d]) => `<tr><td>${esc(u)}</td><td>${esc(d)}</td></tr>`).join('')}</table></div>`
        : '<p class="sub">Elige al menos la columna de unidad y la de descripción.</p>'}
    </div>
    <div class="tarjeta lista-unidades">
      <h2>3. Unidades encontradas (${unidades.length})</h2>
      ${unidades.map((u) => `<label><input type="checkbox" data-unidad="${esc(u)}" checked> <span style="flex:1"><b>${esc(u)}</b></span> <span class="sub">${defs.get(u).length} defectos</span></label>`).join('') || '<p class="sub">Sin unidades.</p>'}
    </div>
    <div class="pie-fijo"><div class="interno">
      <button class="btn" id="btnOtro">Otro archivo</button>
      <button class="btn primario" id="btnCrear" ${unidades.length ? '' : 'disabled'}>Crear reportes</button>
    </div></div>`;

  const sh = $('#selHoja');
  if (sh) sh.onchange = () => { imp.hoja = sh.value; autoMapear(imp); vistaImportar(); };
  $('#numEnc').onchange = (e) => { imp.filaEnc = Math.max(0, (+e.target.value || 1) - 1); autoMapear(imp, true); vistaImportar(); };
  $('#vista').querySelectorAll('[data-map]').forEach((s) => (s.onchange = () => { imp.mapa[s.dataset.map] = +s.value; vistaImportar(); }));
  $('#btnOtro').onclick = () => { estado.importacion = null; vistaImportar(); };
  $('#btnCrear').onclick = async () => {
    const elegidas = [...$('#vista').querySelectorAll('[data-unidad]:checked')].map((c) => c.dataset.unidad);
    if (!elegidas.length) return aviso('Selecciona al menos una unidad');
    const { nuevos, actualizados, ultimo } = await crearReportes(defs, elegidas, imp.taller);
    estado.importacion = null;
    aviso(`${nuevos} reporte(s) creados${actualizados ? `, ${actualizados} actualizados` : ''}`);
    ir(elegidas.length === 1 ? '#/reporte/' + ultimo.id : '#/');
  };
  const uf = $('#unidadFija');
  if (uf) uf.onchange = () => { imp.unidadFija = uf.value.replace(/\s+/g, '').toUpperCase(); vistaImportar(); };
}

const nuevoDefecto = (leyenda) => ({ id: uid(), leyenda, omitir: false, fotos: { antes: false, despues: false } });

async function leerArchivo(f) {
  const wb = XLSX.read(await f.arrayBuffer(), { type: 'array', cellDates: true });
  const hojas = {};
  wb.SheetNames.forEach((n) => {
    const filas = XLSX.utils.sheet_to_json(wb.Sheets[n], { header: 1, defval: '', raw: false, blankrows: false });
    if (filas.length) hojas[n] = filas.map((fila) => fila.map((c) => String(c ?? '').trim()));
  });
  return { nombre: f.name, hojas };
}

$('#archivoTcar').onchange = async (e) => {
  const archivos = [...e.target.files];
  e.target.value = '';
  if (!archivos.length) return;
  try {
    if (archivos.length === 1) {
      const datos = await leerArchivo(archivos[0]);
      if (!Object.keys(datos.hojas).length) return aviso('El archivo está vacío');
      return iniciarMapeo(datos);
    }
    // Varias tarjetas a la vez: se importan directo, una unidad por archivo
    let nuevos = 0, actualizados = 0;
    const fallidos = [];
    for (const f of archivos) {
      try {
        const imp = prepararImportacion(await leerArchivo(f));
        const defs = construirDefectos(imp);
        if (!defs.size) { fallidos.push(f.name); continue; }
        const r = await crearReportes(defs, [...defs.keys()], imp.taller);
        nuevos += r.nuevos; actualizados += r.actualizados;
      } catch { fallidos.push(f.name); }
    }
    estado.importacion = null;
    aviso(`${nuevos} reporte(s) creados${actualizados ? `, ${actualizados} actualizados` : ''}${fallidos.length ? `. No se pudo leer: ${fallidos.join(', ')}` : ''}`, 5000);
    ir('#/');
  } catch (err) {
    console.error(err);
    aviso('No se pudo leer el archivo');
  }
};

/** Tarjeta de inspección de Tcar: la unidad viene en el encabezado (INICIAL / NÚMERO) y no en cada renglón */
function leerTarjeta(filas) {
  const debajo = (re) => {
    for (let i = 0; i < Math.min(filas.length - 1, 30); i++) {
      const j = filas[i].findIndex((c) => re.test(c));
      if (j >= 0 && filas[i + 1][j]) return filas[i + 1][j].trim();
    }
    return '';
  };
  const ini = debajo(/^inicial/i), num = debajo(/^n[uú]mero/i);
  return { unidad: (ini + num).replace(/\s+/g, '').toUpperCase(), taller: debajo(/^ciudad/i).toUpperCase() };
}

function prepararImportacion({ nombre, hojas }) {
  // Hoja con defectos: la que tenga encabezados reconocibles; si no, la de más filas
  const nombres = Object.keys(hojas);
  const puntos = (h) => hojas[h].slice(0, 25).reduce((m, f) => Math.max(m, CAMPOS_MAPEO.filter((c) => f.some((x) => c.re.test(x))).length), 0);
  const hoja = nombres.sort((a, b) => puntos(b) - puntos(a) || hojas[b].length - hojas[a].length)[0];
  const t = leerTarjeta(hojas[hoja]);
  const imp = { nombre, hojas, hoja, filaEnc: 0, mapa: {}, unidadFija: t.unidad, taller: t.taller };
  autoMapear(imp);
  return imp;
}

function iniciarMapeo(datos) {
  estado.importacion = prepararImportacion(datos);
  vistaImportar();
}

/** Crea o actualiza reportes a partir de Map(unidad -> leyendas) */
async function crearReportes(defs, unidades, taller) {
  const aj = leerAjustes();
  const existentes = await DB.todos('reportes');
  let nuevos = 0, actualizados = 0, ultimo = null;
  for (const u of unidades) {
    const leyendas = defs.get(u) || [];
    let r = existentes.find((x) => x.unidad.toUpperCase() === u.toUpperCase());
    if (r) {
      const ya = new Set(r.defectos.map((d) => d.leyenda.toUpperCase()));
      leyendas.filter((l) => !ya.has(l.toUpperCase())).forEach((l) => r.defectos.push(nuevoDefecto(l)));
      actualizados++;
    } else {
      r = { id: uid(), unidad: u, fecha: hoyISO(), supervisor: aj.supervisor, taller: taller || aj.taller, orden: '', idFoto: { antes: false, despues: false }, defectos: leyendas.map(nuevoDefecto), creado: Date.now() };
      existentes.push(r);
      nuevos++;
    }
    await guardarReporte(r);
    ultimo = r;
  }
  return { nuevos, actualizados, ultimo };
}

function autoMapear(imp, conservarFila) {
  const filas = imp.hojas[imp.hoja];
  if (!conservarFila) {
    // fila de encabezados: la primera (de las 25 iniciales) con más coincidencias de nombres conocidos
    let mejor = 0, puntos = -1;
    filas.slice(0, 25).forEach((f, i) => {
      const p = CAMPOS_MAPEO.reduce((s, c) => s + (f.some((h) => c.re.test(h)) ? 2 : 0), 0) + f.filter(Boolean).length * 0.1;
      if (p > puntos) { puntos = p; mejor = i; }
    });
    imp.filaEnc = mejor;
  }
  const enc = filas[imp.filaEnc] || [];
  const usados = new Set();
  imp.mapa = {};
  for (const c of [...CAMPOS_MAPEO].sort((a, b) => (a.k === 'unidad') - (b.k === 'unidad'))) {
    const i = enc.findIndex((h, j) => !usados.has(j) && c.re.test(h));
    imp.mapa[c.k] = i;
    if (i >= 0) usados.add(i);
  }
}

/** Devuelve Map(unidad -> [leyendas]) según el mapeo actual */
function construirDefectos(imp) {
  const filas = imp.hojas[imp.hoja].slice(imp.filaEnc + 1);
  const m = imp.mapa;
  const val = (f, k) => (m[k] >= 0 ? String(f[m[k]] ?? '').trim() : '');
  const res = new Map();
  let ultimaUnidad = m.unidad < 0 ? imp.unidadFija || '' : '';
  if ((m.unidad < 0 && !ultimaUnidad) || m.descripcion < 0) return res;
  for (const f of filas) {
    const ini = val(f, 'inicial'), num = val(f, 'unidad');
    // Si el número ya trae la inicial (NKCR65988) no se repite
    let u = ini && num && !num.toUpperCase().replace(/\s/g, '').startsWith(ini.toUpperCase()) ? ini + num : num || '';
    // Celdas combinadas en Excel: si la unidad viene vacía, se usa la de la fila anterior
    if (!u) u = ultimaUnidad; else ultimaUnidad = u;
    const desc = val(f, 'descripcion');
    if (!u || !desc) continue;
    const ub = val(f, 'ubicacion'), cod = val(f, 'codigo');
    const pre = [ub, cod].filter(Boolean).join(' X ');
    const leyenda = (pre ? `${pre} - ${desc}` : desc).replace(/\s+/g, ' ').toUpperCase();
    u = u.replace(/\s+/g, '').toUpperCase();
    if (!res.has(u)) res.set(u, []);
    res.get(u).push(leyenda);
  }
  return res;
}

/* ---------------- Vista: reporte ---------------- */
let objetivoFoto = null; // { repId, defId, fase }

async function vistaReporte(id) {
  const r = await DB.get('reportes', id);
  if (!r) return ir('#/');
  const fase = estado.fase;
  $('#titulo').textContent = r.unidad || 'Nuevo reporte';

  const filaFoto = (defId, leyenda, tiene, omitido, esId) => `
    <div class="tarjeta defecto ${omitido ? 'omitido' : ''}" data-def="${defId}">
      <div class="foto ${tiene ? 'tiene' : ''}" data-foto="${defId}" aria-label="Foto">${tiene ? '' : '&#128247;'}</div>
      <div class="cuerpo">
        <div class="leyenda">${esc(leyenda)}</div>
        <div>${omitido ? '<span class="etiqueta omit">No requiere foto</span>' : tiene ? '<span class="etiqueta ok">Foto tomada</span>' : '<span class="etiqueta pend">Pendiente</span>'}</div>
        <div class="acciones">
          ${omitido ? '' : `<button class="btn chico" data-galeria="${defId}">Galería</button>`}
          ${esId ? '' : `<button class="btn chico" data-omitir="${defId}">${omitido ? 'Requiere foto' : 'Saltar'}</button>
          <button class="btn chico" data-editar="${defId}">Editar</button>`}
        </div>
      </div>
    </div>`;

  const a = progreso(r, 'antes'), d = progreso(r, 'despues');
  $('#vista').innerHTML = `
    <details class="tarjeta" ${r.unidad ? '' : 'open'}>
      <summary style="cursor:pointer;font-weight:700">Datos de la unidad</summary>
      <div class="campos" style="margin-top:12px">
        <label class="campo">Unidad<input data-campo="unidad" value="${esc(r.unidad)}" placeholder="Ej. NKCR65988"></label>
        <label class="campo">Fecha<input type="date" data-campo="fecha" value="${esc(r.fecha)}"></label>
        <label class="campo">Taller<input data-campo="taller" value="${esc(r.taller)}"></label>
        <label class="campo">Orden / referencia<input data-campo="orden" value="${esc(r.orden)}"></label>
      </div>
      <button class="btn peligro chico" id="btnEliminar" style="margin-top:12px">Eliminar reporte</button>
    </details>

    <div class="pestanas">
      <button data-fase="antes" class="${fase === 'antes' ? 'activa' : ''}">ANTES <span class="cuenta">${a.hechos}/${a.total}</span></button>
      <button data-fase="despues" class="${fase === 'despues' ? 'activa' : ''}">DESPUÉS <span class="cuenta">${d.hechos}/${d.total}</span></button>
    </div>

    ${filaFoto('ID', 'IDENTIFICACIÓN DE LA UNIDAD (opcional)', r.idFoto[fase], false, true)}
    ${r.defectos.map((x) => filaFoto(x.id, x.leyenda, x.fotos[fase], x.omitir, false)).join('')}

    <div class="tarjeta">
      <div style="display:flex;gap:8px">
        <input id="nuevoDef" placeholder="Agregar defecto: B X 02 - SOLDADURA…" style="flex:1;border:1px solid var(--borde);border-radius:8px;padding:10px;min-width:0">
        <button class="btn" id="btnAgregar">Agregar</button>
      </div>
    </div>

    <div class="pie-fijo"><div class="interno">
      <button class="btn acento" id="btnPdf">Generar PDF</button>
    </div></div>`;

  // Miniaturas
  for (const el of $('#vista').querySelectorAll('[data-foto]')) {
    const u = await urlFoto(claveFoto(r.id, el.dataset.foto, fase));
    if (u) el.style.backgroundImage = `url("${u}")`;
  }

  // Datos de la unidad
  $('#vista').querySelectorAll('[data-campo]').forEach((inp) => (inp.onchange = async () => {
    r[inp.dataset.campo] = inp.dataset.campo === 'unidad' ? inp.value.trim().toUpperCase() : inp.value.trim();
    await guardarReporte(r);
    if (inp.dataset.campo === 'unidad') $('#titulo').textContent = r.unidad;
  }));

  $('#vista').querySelectorAll('[data-fase]').forEach((b) => (b.onclick = () => { estado.fase = b.dataset.fase; vistaReporte(id); }));

  $('#vista').querySelectorAll('[data-foto]').forEach((el) => (el.onclick = async () => {
    const defId = el.dataset.foto;
    const def = r.defectos.find((x) => x.id === defId);
    if (def && def.omitir) return;
    const tiene = defId === 'ID' ? r.idFoto[fase] : def.fotos[fase];
    objetivoFoto = { repId: r.id, defId, fase };
    if (tiene) abrirVisor(r, defId, fase);
    else $('#camara').click();
  }));
  $('#vista').querySelectorAll('[data-galeria]').forEach((b) => (b.onclick = () => {
    objetivoFoto = { repId: r.id, defId: b.dataset.galeria, fase };
    $('#galeria').click();
  }));
  $('#vista').querySelectorAll('[data-omitir]').forEach((b) => (b.onclick = async () => {
    const def = r.defectos.find((x) => x.id === b.dataset.omitir);
    def.omitir = !def.omitir;
    await guardarReporte(r);
    vistaReporte(id);
  }));
  $('#vista').querySelectorAll('[data-editar]').forEach((b) => (b.onclick = async () => {
    const def = r.defectos.find((x) => x.id === b.dataset.editar);
    const t = prompt('Leyenda del defecto (deja vacío para eliminarlo):', def.leyenda);
    if (t === null) return;
    if (!t.trim()) {
      if (!confirm('¿Eliminar este defecto y sus fotos?')) return;
      for (const f of Object.keys(FASES)) { const k = claveFoto(r.id, def.id, f); await DB.borrar('fotos', k); olvidarUrl(k); }
      r.defectos = r.defectos.filter((x) => x !== def);
    } else def.leyenda = t.trim().toUpperCase();
    await guardarReporte(r);
    vistaReporte(id);
  }));
  const agregar = async () => {
    const t = $('#nuevoDef').value.trim();
    if (!t) return;
    r.defectos.push(nuevoDefecto(t.toUpperCase()));
    await guardarReporte(r);
    vistaReporte(id);
  };
  $('#btnAgregar').onclick = agregar;
  $('#nuevoDef').onkeydown = (e) => { if (e.key === 'Enter') agregar(); };

  $('#btnEliminar').onclick = async () => {
    if (!confirm(`¿Eliminar el reporte ${r.unidad} y todas sus fotos? No se puede deshacer.`)) return;
    for (const defId of ['ID', ...r.defectos.map((x) => x.id)]) {
      for (const f of Object.keys(FASES)) { const k = claveFoto(r.id, defId, f); await DB.borrar('fotos', k); olvidarUrl(k); }
    }
    await DB.borrar('reportes', r.id);
    aviso('Reporte eliminado');
    ir('#/');
  };

  $('#btnPdf').onclick = () => generarPdf(r);
}

async function recibirFoto(e) {
  const f = e.target.files[0];
  e.target.value = '';
  if (!f || !objetivoFoto) return;
  const { repId, defId, fase } = objetivoFoto;
  aviso('Guardando foto…', 1200);
  const blob = await procesarFoto(f);
  const k = claveFoto(repId, defId, fase);
  await DB.poner('fotos', blob, k);
  olvidarUrl(k);
  const r = await DB.get('reportes', repId);
  if (defId === 'ID') r.idFoto[fase] = true;
  else r.defectos.find((x) => x.id === defId).fotos[fase] = true;
  await guardarReporte(r);
  // Al tomar foto, desplazarse al siguiente pendiente
  const y = window.scrollY;
  await vistaReporte(repId);
  window.scrollTo(0, y);
  const sig = r.defectos.find((x) => !x.omitir && !x.fotos[fase]);
  if (sig) $(`[data-def="${sig.id}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
}
$('#camara').onchange = recibirFoto;
$('#galeria').onchange = recibirFoto;

async function abrirVisor(r, defId, fase) {
  const u = await urlFoto(claveFoto(r.id, defId, fase));
  const v = document.createElement('div');
  v.className = 'visor';
  v.innerHTML = `<img src="${u}" alt="Foto">
    <div class="fila-botones" style="width:100%;max-width:500px">
      <button class="btn" data-a="retomar">Tomar otra</button>
      <button class="btn" data-a="galeria">Galería</button>
      <button class="btn peligro" data-a="borrar">Borrar</button>
      <button class="btn primario" data-a="cerrar">Cerrar</button>
    </div>`;
  document.body.appendChild(v);
  v.onclick = async (e) => {
    const a = e.target.dataset.a;
    if (!a && e.target !== v) return;
    v.remove();
    if (a === 'retomar') $('#camara').click();
    if (a === 'galeria') $('#galeria').click();
    if (a === 'borrar') {
      const k = claveFoto(r.id, defId, fase);
      await DB.borrar('fotos', k);
      olvidarUrl(k);
      if (defId === 'ID') r.idFoto[fase] = false;
      else r.defectos.find((x) => x.id === defId).fotos[fase] = false;
      await guardarReporte(r);
      vistaReporte(r.id);
    }
  };
}

/* ---------------- PDF ---------------- */
let logoCache = null;
async function logoEmpresa() {
  if (logoCache) return logoCache;
  try {
    const url = await blobADataUrl(await (await fetch('icons/logo.jpg')).blob());
    const img = await cargarImagen(url);
    logoCache = { url, ratio: img.naturalWidth / img.naturalHeight };
  } catch { logoCache = null; }
  return logoCache;
}

function blobADataUrl(b) {
  return new Promise((res) => { const fr = new FileReader(); fr.onload = () => res(fr.result); fr.readAsDataURL(b); });
}

async function generarPdf(r) {
  const aj = leerAjustes();
  const pendientes = Object.keys(FASES).map((f) => {
    const p = progreso(r, f);
    return p.total - p.hechos ? `${FASES[f]}: ${p.total - p.hechos} sin foto` : '';
  }).filter(Boolean);
  if (!r.unidad && !confirm('El reporte no tiene número de unidad. ¿Generar de todos modos?')) return;
  if (pendientes.length && !confirm(`Faltan fotos (${pendientes.join(', ')}).\nEsos defectos no aparecerán en esa sección. ¿Generar de todos modos?`)) return;

  const btn = $('#btnPdf');
  btn.disabled = true; btn.textContent = 'Generando…';
  try {
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'letter' });
    const W = doc.internal.pageSize.getWidth(), H = doc.internal.pageSize.getHeight();
    const M = 10, COLS = 3, FILAS = 2, GAP = 5;
    const ARRIBA = 40, PIE = 14, LEY = 12;
    const celW = (W - 2 * M - GAP * (COLS - 1)) / COLS;
    const celH = (H - ARRIBA - PIE - GAP * (FILAS - 1)) / FILAS;
    const fotoH = celH - LEY;
    const AZUL = [16, 46, 140], ROJO = [192, 40, 30], TINTA = [30, 41, 59], GRIS = [100, 116, 139], CLARO = [243, 245, 250], LINEA = [214, 220, 232];
    const logo = await logoEmpresa();
    let paginas = 0;

    const encabezado = (insignia, colorInsignia) => {
      // Logo y título
      if (logo) doc.addImage(logo.url, 'JPEG', M, 8, 9 * logo.ratio, 9, 'logo', 'FAST');
      else { doc.setFont('helvetica', 'bold'); doc.setFontSize(18); doc.setTextColor(...AZUL); doc.text(aj.empresa || '', M, 15); }
      doc.setFont('helvetica', 'bold'); doc.setFontSize(15); doc.setTextColor(...AZUL);
      doc.text('REPORTE FOTOGRÁFICO', W - M, 12.5, { align: 'right' });
      doc.setFont('helvetica', 'normal'); doc.setFontSize(8.5); doc.setTextColor(...GRIS);
      doc.text('Evidencia fotográfica de reparación de unidad', W - M, 17.5, { align: 'right' });
      // Franja con los colores de la marca
      doc.setFillColor(...AZUL); doc.rect(M, 21, W - 2 * M, 1, 'F');
      doc.setFillColor(...ROJO); doc.rect(M, 22, W - 2 * M, 0.5, 'F');
      // Datos de la unidad
      const datos = [['UNIDAD', r.unidad || '—'], ['TALLER', r.taller], ['ORDEN / REFERENCIA', r.orden]].filter(([, v]) => v);
      const insW = 72;
      doc.setFillColor(...CLARO); doc.setDrawColor(...LINEA); doc.setLineWidth(0.2);
      doc.roundedRect(M, 25.5, W - 2 * M - insW - 4, 10.5, 1.5, 1.5, 'FD');
      let x = M + 5;
      datos.forEach(([k, v], i) => {
        if (i) { doc.setDrawColor(...LINEA); doc.line(x - 5, 27.5, x - 5, 34); }
        doc.setFont('helvetica', 'normal'); doc.setFontSize(6.5); doc.setTextColor(...GRIS);
        doc.text(k, x, 29.3);
        doc.setFont('helvetica', 'bold'); doc.setFontSize(11); doc.setTextColor(...AZUL);
        doc.text(String(v), x, 34);
        x += Math.max(doc.getTextWidth(String(v)), 30) + 10;
      });
      doc.setFillColor(...colorInsignia);
      doc.roundedRect(W - M - insW, 25.5, insW, 10.5, 1.5, 1.5, 'F');
      doc.setFont('helvetica', 'bold'); doc.setFontSize(11); doc.setTextColor(255);
      doc.text(insignia, W - M - insW / 2, 32.2, { align: 'center' });
    };

    const SECCION = { antes: ['ANTES DE LA REPARACIÓN', ROJO], despues: ['DESPUÉS DE LA REPARACIÓN', AZUL] };
    for (const fase of Object.keys(FASES)) {
      const items = [];
      if (r.idFoto[fase]) items.push({ clave: claveFoto(r.id, 'ID', fase), leyenda: `IDENTIFICACIÓN DE LA UNIDAD ${r.unidad}`.trim() });
      r.defectos.filter((x) => !x.omitir && x.fotos[fase]).forEach((x) => items.push({ clave: claveFoto(r.id, x.id, fase), leyenda: x.leyenda }));
      if (!items.length) continue;

      for (let i = 0; i < items.length; i++) {
        const pos = i % (COLS * FILAS);
        if (pos === 0) { if (paginas++) doc.addPage(); encabezado(...SECCION[fase]); }
        const cx = M + (pos % COLS) * (celW + GAP);
        const cy = ARRIBA + Math.floor(pos / COLS) * (celH + GAP);
        const blob = await DB.get('fotos', items[i].clave);
        const dataUrl = await blobADataUrl(blob);
        const img = await cargarImagen(dataUrl);
        // Foto (ajustada sin deformar)
        doc.setFillColor(...CLARO);
        doc.rect(cx, cy, celW, fotoH, 'F');
        const k = Math.min(celW / img.naturalWidth, fotoH / img.naturalHeight);
        const iw = img.naturalWidth * k, ih = img.naturalHeight * k;
        doc.addImage(dataUrl, 'JPEG', cx + (celW - iw) / 2, cy + (fotoH - ih) / 2, iw, ih, undefined, 'FAST');
        // Leyenda con número
        doc.setFillColor(...CLARO);
        doc.rect(cx, cy + fotoH, celW, LEY, 'F');
        doc.setFillColor(...SECCION[fase][1]);
        doc.rect(cx, cy + fotoH, 9, LEY, 'F');
        doc.setFont('helvetica', 'bold'); doc.setFontSize(9); doc.setTextColor(255);
        doc.text(String(i + 1).padStart(2, '0'), cx + 4.5, cy + fotoH + LEY / 2 + 1.2, { align: 'center' });
        doc.setFontSize(7.8); doc.setTextColor(...TINTA);
        const lineas = doc.splitTextToSize(items[i].leyenda, celW - 13).slice(0, 3);
        const altoTxt = lineas.length * 3.3;
        doc.text(lineas, cx + 11.5, cy + fotoH + (LEY - altoTxt) / 2 + 2.6);
        doc.setDrawColor(...LINEA); doc.setLineWidth(0.25);
        doc.rect(cx, cy, celW, celH);
      }
    }

    // Lista opcional de defectos sin foto
    const omitidos = r.defectos.filter((x) => x.omitir);
    if (aj.incluirOmitidos && omitidos.length) {
      if (paginas++) doc.addPage();
      encabezado('SIN EVIDENCIA FOTOGRÁFICA', GRIS);
      let y = ARRIBA + 2;
      omitidos.forEach((x, i) => {
        if (y > H - PIE - 8) { doc.addPage(); encabezado('SIN EVIDENCIA FOTOGRÁFICA', GRIS); y = ARRIBA + 2; }
        if (i % 2 === 0) { doc.setFillColor(...CLARO); doc.rect(M, y - 4.6, W - 2 * M, 7, 'F'); }
        doc.setFont('helvetica', 'bold'); doc.setFontSize(9); doc.setTextColor(...GRIS);
        doc.text(String(i + 1).padStart(2, '0'), M + 3, y);
        doc.setTextColor(...TINTA);
        doc.text(x.leyenda, M + 13, y);
        y += 7;
      });
    }

    if (!paginas) { aviso('No hay fotos para el reporte'); return; }

    const total = doc.getNumberOfPages();
    for (let p = 1; p <= total; p++) {
      doc.setPage(p);
      doc.setDrawColor(...LINEA); doc.setLineWidth(0.3);
      doc.line(M, H - 10, W - M, H - 10);
      doc.setFont('helvetica', 'normal'); doc.setFontSize(7.5); doc.setTextColor(...GRIS);
      doc.text([aj.empresa, `Reporte fotográfico de la unidad ${r.unidad || ''}`].filter(Boolean).join('   ·   '), M, H - 6);
      doc.text(`Página ${p} de ${total}`, W - M, H - 6, { align: 'right' });
    }

    const nombre = `REPORTE FOTOGRAFICO ${r.unidad || 'SIN UNIDAD'}.pdf`;
    const blob = doc.output('blob');
    mostrarResultadoPdf(blob, nombre);
  } catch (e) {
    console.error(e);
    aviso('Error al generar el PDF: ' + e.message, 4000);
  } finally {
    btn.disabled = false; btn.textContent = 'Generar PDF';
  }
}

function mostrarResultadoPdf(blob, nombre) {
  const archivo = new File([blob], nombre, { type: 'application/pdf' });
  const url = URL.createObjectURL(blob);
  const puedeCompartir = navigator.canShare && navigator.canShare({ files: [archivo] });
  const v = document.createElement('div');
  v.className = 'visor';
  v.innerHTML = `<div class="tarjeta" style="width:100%;max-width:420px;text-align:center">
      <h2>PDF listo</h2>
      <p class="sub" style="word-break:break-word">${esc(nombre)} · ${(blob.size / 1048576).toFixed(1)} MB</p>
      <div class="fila-botones" style="flex-direction:column">
        <a class="btn primario" href="${url}" download="${esc(nombre)}" data-a="x">Descargar</a>
        ${puedeCompartir ? '<button class="btn acento" data-a="compartir">Compartir (WhatsApp, correo…)</button>' : ''}
        <a class="btn" href="${url}" target="_blank" rel="noopener">Ver</a>
        <button class="btn" data-a="cerrar">Cerrar</button>
      </div></div>`;
  document.body.appendChild(v);
  v.onclick = async (e) => {
    const a = e.target.dataset.a;
    if (a === 'compartir') {
      try { await navigator.share({ files: [archivo], title: nombre }); } catch { /* cancelado */ }
    } else if (a === 'cerrar' || e.target === v) {
      v.remove();
      setTimeout(() => URL.revokeObjectURL(url), 60000);
    }
  };
}

/* ---------------- Instalación (PWA) ---------------- */
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  instalarEvt = e;
  $('#btnInstalar').hidden = false;
});
$('#btnInstalar').onclick = async () => {
  if (!instalarEvt) return;
  instalarEvt.prompt();
  await instalarEvt.userChoice;
  instalarEvt = null;
  $('#btnInstalar').hidden = true;
};
window.addEventListener('appinstalled', () => { $('#btnInstalar').hidden = true; aviso('App instalada'); });

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch((e) => console.warn('SW', e)));
}
if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});

render();
