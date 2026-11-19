// Entregable 4: visor web estático mínimo, sin librerías.
// Dibuja las teselas WebP en un canvas, redondeando cada borde al pixel de pantalla
// para que no aparezcan rayas entre teselas a ningún zoom. Los pines van encima, en HTML.
// Coordenadas: u, v = pixeles nativos de la rejilla (src/rejilla.js); la tesela i_j
// cubre u ∈ [i·T − T/2, i·T + T/2) y v ∈ [j·T − T/2, j·T + T/2).
const BASE = new URL('..', import.meta.url); // raíz del proyecto (web/ está un nivel abajo)
// Todas las zonas de config.json que ya tengan rejilla y pines (las que falten se ignoran)
const cfg = await fetch(new URL('config.json', BASE)).then((r) => r.json());
const ZONAS = Object.keys(cfg.zonas).filter((id) => !cfg.zonas[id].fuera_del_mapa); // D-22: salientes fuera del mapa
const leer = (u) => fetch(u).then((r) => (r.ok ? r.json() : null), () => null);
const zonas = (await Promise.all(ZONAS.map(async (id) => ({ id, rej: await leer(new URL(`tiles/rejilla-${id}.json`, BASE)), lug: await leer(new URL(`lugares-${id}.json`, import.meta.url)) }))))
  .filter((z) => z.rej && z.lug);
const T = zonas[0].rej.tamano_px;
const rej = { teselas: [...new Map(zonas.flatMap((z) => z.rej.teselas).map((t) => [`${t.i}_${t.j}`, t])).values()] };
const lug = { lugares: zonas.flatMap((z) => z.lug.lugares.map((l) => ({ ...l, zona: z.id, nombre_zona: z.lug.nombre_zona ?? z.id }))) };
// D-34: grupo "Cerros" al final (web/lugares-cerros.json, de scripts/26-pines-cerros.mjs)
const cerros = await leer(new URL('lugares-cerros.json', import.meta.url));
if (cerros) lug.lugares.push(...cerros.lugares.map((l) => ({ ...l, zona: 'cerros', nombre_zona: cerros.nombre_zona })));
// Catálogo del juego (D-29), para el buscador y la brújula
const catalogo = await leer(new URL('juego-lugares.json', import.meta.url));
const mapa = document.getElementById('mapa'), lienzo = document.getElementById('lienzo'), capaPines = document.getElementById('pines');
const ctx = lienzo.getContext('2d');

// ---------- Vista: centro (u, v) y zoom ----------
const ZMAX = 6;
const PINES_ZOOM = 0.08; // ESTIMADO: zoom desde el que se ven los pines
let zoomPines = PINES_ZOOM; // D-42: baja al zoom de la vista inicial para que al abrir se vean todos los pines
const PINES_RADIO = 10000; // ESTIMADO (D-42): la vista inicial encuadra los pines a menos de esta distancia de la plaza (deja fuera Cerro Gordo, muy al oriente)
let ZMIN = 0.015; // se recalcula abajo: alejar hasta ver la ciudad entera en cualquier pantalla (D-18, D-19)
const vista = { u: 0, v: 0, zoom: 1 };
const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
const aPantalla = (u, v) => ({ x: innerWidth / 2 + (u - vista.u) * vista.zoom, y: innerHeight / 2 + (v - vista.v) * vista.zoom });

// ---------- Teselas (pirámide, D-18) ----------
// Nivel 0 = teselas nativas. Nivel k = versión reducida: cada tesela de 512 px cubre 2^k × 2^k nativas.
// Solo se cargan las teselas visibles del nivel que corresponde al zoom, y se olvidan las que no se usan:
// así la ciudad completa abre también en el teléfono.
const pir = await leer(new URL('tiles/piramide.json', BASE));
const NIV = pir?.niveles ?? 0;
// Caja de toda la ciudad (pixeles nativos) y zoom mínimo para que quepa entera, también en el teléfono
const caja = (() => { const is = rej.teselas.map((t) => t.i), js = rej.teselas.map((t) => t.j);
  return { u0: Math.min(...is) * T - T / 2, u1: (Math.max(...is) + 1) * T - T / 2, v0: Math.min(...js) * T - T / 2, v1: (Math.max(...js) + 1) * T - T / 2 }; })();
const calcularZmin = () => { if (innerWidth && innerHeight) ZMIN = Math.min(0.015, 0.6 * Math.min(innerWidth / (caja.u1 - caja.u0), innerHeight / (caja.v1 - caja.v0))); };
calcularZmin();
const existen = [new Set(rej.teselas.map((t) => `${t.i}_${t.j}`)), ...Array.from({ length: NIV }, (_, k) => new Set(pir.teselas[k + 1]))];
const imagenes = new Map(); // "k/i_j" -> Image (el orden del Map sirve para olvidar las más viejas)
function imagen(k, i, j, pedir = true) {
  const clave = `${k}/${i}_${j}`;
  let img = imagenes.get(clave);
  if (img) { imagenes.delete(clave); imagenes.set(clave, img); return img; }
  if (!pedir) return null;
  img = new Image();
  img.onload = () => pedirDibujo();
  img.src = new URL(k === 0 ? `tiles/nativo/${i}_${j}.webp` : `tiles/nivel-${k}/${i}_${j}.webp`, BASE).href;
  imagenes.set(clave, img);
  return img;
}
const lista = (img) => img && img.complete && img.naturalWidth;
let pendiente = false;
const pedirDibujo = () => { if (!pendiente) { pendiente = true; requestAnimationFrame(dibujar); } };
function dibujar() {
  pendiente = false;
  const dpr = devicePixelRatio || 1, w = innerWidth, h = innerHeight;
  if (lienzo.width !== Math.round(w * dpr) || lienzo.height !== Math.round(h * dpr)) { lienzo.width = Math.round(w * dpr); lienzo.height = Math.round(h * dpr); }
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = '#1e2a33'; ctx.fillRect(0, 0, lienzo.width, lienzo.height);
  ctx.imageSmoothingEnabled = vista.zoom * dpr < 1.5; // con zoom grande, pixeles nítidos
  const k = NIV ? clamp(Math.floor(Math.log2(1 / (vista.zoom * dpr))), 0, NIV) : 0;
  const S = T * 2 ** k; // tamaño de una tesela del nivel k, en pixeles nativos
  const u0 = vista.u - w / 2 / vista.zoom, u1 = vista.u + w / 2 / vista.zoom, v0 = vista.v - h / 2 / vista.zoom, v1 = vista.v + h / 2 / vista.zoom;
  const caja = (uA, vA, uB, vB) => { const a = aPantalla(uA, vA), b = aPantalla(uB, vB); return [Math.round(a.x * dpr), Math.round(a.y * dpr), Math.round(b.x * dpr), Math.round(b.y * dpr)]; };
  for (let i = Math.floor((u0 + T / 2) / S); i <= Math.floor((u1 + T / 2) / S); i++) {
    for (let j = Math.floor((v0 + T / 2) / S); j <= Math.floor((v1 + T / 2) / S); j++) {
      if (!existen[k].has(`${i}_${j}`)) continue;
      const [x0, y0, x1, y1] = caja(i * S - T / 2, j * S - T / 2, (i + 1) * S - T / 2, (j + 1) * S - T / 2);
      const img = imagen(k, i, j);
      if (lista(img)) { ctx.drawImage(img, x0, y0, x1 - x0, y1 - y0); continue; }
      // mientras carga, se dibuja el pedazo correspondiente de un nivel más reducido que ya esté en memoria
      for (let kk = k + 1; kk <= NIV; kk++) {
        const f = 2 ** (kk - k), I = Math.floor(i / f), J = Math.floor(j / f), p = imagen(kk, I, J, kk === NIV); // D-37: el nivel más ligero sí se pide, para no ver la pantalla vacía al abrir
        if (!lista(p)) continue;
        const sx = ((i - I * f) / f) * T, sy = ((j - J * f) / f) * T;
        ctx.drawImage(p, sx, sy, T / f, T / f, x0, y0, x1 - x0, y1 - y0); break;
      }
    }
  }
  for (const [clave, img] of imagenes) { if (imagenes.size <= 250) break; imagenes.delete(clave); img.src = ''; } // olvidar las más viejas
  // D-37: de lejos los pines del centro se enciman; aparecen al acercarse (el que está abierto, siempre)
  const verPines = vista.zoom >= zoomPines * 0.999;
  for (const p of pines) {
    const s = aPantalla(p.l.u, p.l.v); p.el.style.transform = `translate(${s.x}px, ${s.y}px)`;
    p.el.style.display = verPines || p.el.classList.contains('activo') ? '' : 'none';
  }
  if (buscado) { const s = aPantalla(buscado.u, buscado.v); pinBuscado.style.transform = `translate(${s.x}px, ${s.y}px)`; pinBuscado.style.display = ''; }
  else pinBuscado.style.display = 'none';
  dibujarChico();
}

// ---------- Pines ----------
const ficha = document.getElementById('ficha');
const pines = lug.lugares.map((l, k) => {
  const el = document.createElement('div');
  el.className = 'pin';
  el.innerHTML = `<button aria-label="${l.nombre}"><svg viewBox="0 0 26 34"><path d="M13 33C13 33 1 19.5 1 12.5a12 12 0 0 1 24 0C25 19.5 13 33 13 33Z" fill="#e8c15a" stroke="#1e2a33" stroke-width="1.5"/></svg><span class="num">${k + 1}</span></button>`;
  const btn = el.querySelector('button');
  btn.addEventListener('click', (e) => { e.stopPropagation(); mostrar(k); });
  btn.addEventListener('pointerdown', (e) => e.stopPropagation());
  capaPines.appendChild(el);
  if (k === 0 || lug.lugares[k - 1].zona !== l.zona) {
    const h = document.createElement('li'); h.className = 'zona'; h.textContent = l.nombre_zona;
    document.getElementById('lista').appendChild(h);
  }
  const li = document.createElement('li');
  li.textContent = l.nombre; li.value = k + 1;
  li.onclick = () => {
    mostrar(k);
    // D-42: la lista tapaba el lugar elegido; se cierra siempre y el pin queda entre la barra de arriba y la ficha
    abrirLista(false);
    centrarEn(l.u, l.v);
  };
  document.getElementById('lista').appendChild(li);
  return { el, l };
});
// Pin extra para lo que se encuentra con el buscador y no tiene pin propio (lugares del juego)
const pinBuscado = document.createElement('div');
pinBuscado.className = 'pin activo';
pinBuscado.innerHTML = '<button aria-hidden="true" tabindex="-1"><svg viewBox="0 0 26 34"><path d="M13 33C13 33 1 19.5 1 12.5a12 12 0 0 1 24 0C25 19.5 13 33 13 33Z" fill="#fff" stroke="#1e2a33" stroke-width="1.5"/><circle cx="13" cy="12.5" r="4" fill="#1e2a33"/></svg></button>';
pinBuscado.style.display = 'none';
capaPines.appendChild(pinBuscado);
let buscado = null;
function abrirFicha(nombre, detalle) {
  document.getElementById('f-nombre').textContent = nombre;
  document.getElementById('f-detalle').textContent = detalle ?? '';
  ficha.style.display = 'block';
}
function mostrar(k) {
  buscado = null;
  pines.forEach((p, n) => p.el.classList.toggle('activo', n === k));
  abrirFicha(lug.lugares[k].nombre, lug.lugares[k].detalle);
  pedirDibujo();
}
document.getElementById('cerrar').onclick = () => { ficha.style.display = 'none'; buscado = null; pines.forEach((p) => p.el.classList.remove('activo')); pedirDibujo(); };
/** Lleva el punto (u, v) al espacio libre: debajo de la barra de arriba y arriba de la ficha */
function centrarEn(u, v) {
  const z = Math.max(vista.zoom, 1.5);
  const arriba = Math.max(document.getElementById('marca').getBoundingClientRect().bottom, document.getElementById('barra').getBoundingClientRect().bottom) + 10;
  const abajo = (ficha.style.display === 'block' ? ficha.getBoundingClientRect().top : innerHeight - 90) - 10;
  const libreY = (arriba + abajo) / 2 + 17; // el pin mide ~34 px hacia arriba
  irA(u, v - (libreY - innerHeight / 2) / z, z);
}

function irA(u, v, zoom = vista.zoom) { Object.assign(vista, { u, v, zoom: clamp(zoom, ZMIN, ZMAX) }); pedirDibujo(); }
function zoomEn(px, py, factor) {
  const z1 = clamp(vista.zoom * factor, ZMIN, ZMAX);
  const u = vista.u + (px - innerWidth / 2) / vista.zoom, v = vista.v + (py - innerHeight / 2) / vista.zoom; // punto bajo el cursor
  vista.u = u - (px - innerWidth / 2) / z1; vista.v = v - (py - innerHeight / 2) / z1; vista.zoom = z1;
  pedirDibujo();
}

// Vista inicial: D-37 la ciudad completa (botón casita); D-42 al abrir, acercada a los lugares con pin, en el espacio libre
// entre la barra de arriba y el botón Lugares (y a la derecha del mapa chico en la compu)
const cercanos = lug.lugares.filter((l) => Math.hypot(l.u, l.v) <= PINES_RADIO);
const cajaPines = { u0: Math.min(...cercanos.map((l) => l.u)) - 300, u1: Math.max(...cercanos.map((l) => l.u)) + 300,
  v0: Math.min(...cercanos.map((l) => l.v)) - 450, v1: Math.max(...cercanos.map((l) => l.v)) + 150 }; // el pin sobresale ~34 px hacia arriba
let modoInicial = 'pines';
function vistaInicial(modo = modoInicial) {
  modoInicial = modo;
  const C = modo === 'pines' ? cajaPines : caja;
  const arriba = Math.max(document.getElementById('marca').getBoundingClientRect().bottom, document.getElementById('barra').getBoundingClientRect().bottom) + 10;
  const abajo = document.getElementById('b-lugares').getBoundingClientRect().top - 10;
  const tel = innerWidth <= 700, der = innerWidth - (tel ? 64 : 74);
  let izq = 10, bajo = abajo;
  const ajuste = (i, b) => Math.min((der - i) / (C.u1 - C.u0), (b - arriba) / (C.v1 - C.v0));
  // En la compu el mapa chico tapa la esquina de abajo a la izquierda: los pines van a su derecha o arriba de él (lo que deje más zoom)
  const chico = $('chico').getBoundingClientRect();
  if (modo === 'pines' && chico.width) {
    if (ajuste(chico.right + 10, abajo) >= ajuste(10, Math.min(abajo, chico.top - 10))) izq = chico.right + 10; else bajo = Math.min(abajo, chico.top - 10);
  }
  const z = clamp(ajuste(izq, bajo), ZMIN, ZMAX);
  vista.zoom = z;
  if (modo === 'pines') zoomPines = Math.min(PINES_ZOOM, z);
  vista.u = (C.u0 + C.u1) / 2 - ((izq + der) / 2 - innerWidth / 2) / z;
  vista.v = (C.v0 + C.v1) / 2 - ((arriba + bajo) / 2 - innerHeight / 2) / z;
  pedirDibujo();
}
const $ = (id) => document.getElementById(id);
// Lista de lugares tras el botón «Lugares ▲» (abajo al centro)
function abrirLista(si) {
  $('panel').classList.toggle('oculto', !si);
  $('b-lugares').setAttribute('aria-expanded', String(si));
  $('flecha').textContent = si ? '▼' : '▲';
  if (si) ficha.style.display = 'none';
}
$('b-lugares').onclick = () => abrirLista($('panel').classList.contains('oculto'));
$('inicio').onclick = () => { tocado = false; vistaInicial('ciudad'); };
if (!document.fullscreenEnabled) $('pantalla').classList.add('oculto'); // el iPhone no deja pantalla completa en una página
$('pantalla').onclick = () => (document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen?.());

// ---------- Aviso breve ----------
let tAviso;
function aviso(txt) { $('aviso').textContent = txt; $('aviso').classList.remove('oculto'); clearTimeout(tAviso); tAviso = setTimeout(() => $('aviso').classList.add('oculto'), 2200); }

// ---------- Compartir: el enlace guarda la vista (#u,v,zoom); sin servidor ----------
function enlace() { const u = new URL(location.href); u.hash = `${Math.round(vista.u)},${Math.round(vista.v)},${vista.zoom.toFixed(4)}`; return u.href; }
async function compartir() {
  const url = enlace();
  if (navigator.share && innerWidth <= 700) { try { await navigator.share({ title: 'Tiny San Juan del Río', url }); return; } catch { return; } }
  try { await navigator.clipboard.writeText(url); aviso('Enlace copiado'); } catch { prompt('Copia el enlace:', url); }
}
$('compartir').onclick = compartir; $('compartir-tel').onclick = compartir;
function vistaDelEnlace() {
  const [u, v, z] = location.hash.slice(1).split(',').map(Number);
  if (![u, v, z].every(Number.isFinite)) return false;
  Object.assign(vista, { u, v, zoom: clamp(z, ZMIN, ZMAX) }); tocado = true; pedirDibujo(); return true;
}

// ---------- Acerca de ----------
const abrirInfo = (si) => $('info').classList.toggle('oculto', !si);
$('b-info').onclick = () => abrirInfo(true); $('info-tel').onclick = () => abrirInfo(true); $('acerca').onclick = () => abrirInfo(true);
$('info').onclick = (e) => { if (e.target === $('info') || e.target.classList.contains('cerrar')) abrirInfo(false); };

// ---------- Buscador: lugares del visor + catálogo del juego (D-29), sin servidor ----------
const norm = (t) => t.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
const buscables = (() => {
  const vistos = new Set(), out = [];
  lug.lugares.forEach((l, k) => { vistos.add(norm(l.nombre)); out.push({ nombre: l.nombre, detalle: l.detalle, grupo: l.nombre_zona, u: l.u, v: l.v, k }); });
  for (const l of catalogo?.lugares ?? []) if (!vistos.has(norm(l.nombre))) { vistos.add(norm(l.nombre)); out.push({ nombre: l.nombre, detalle: `${l.descripcion} · OSM, por confirmar`, grupo: l.descripcion.split(' · ')[0], u: l.u, v: l.v }); }
  return out.map((x) => ({ ...x, n: norm(x.nombre) }));
})();
let hallados = [], sel = 0;
function pintarResultados() {
  const ul = $('resultados'), q = norm($('buscar').value.trim());
  if (!q) { ul.classList.add('oculto'); return; }
  const palabras = q.split(/\s+/);
  hallados = buscables.filter((x) => palabras.every((p) => x.n.includes(p))).sort((a, b) => (a.n.startsWith(q) ? 0 : 1) - (b.n.startsWith(q) ? 0 : 1)).slice(0, 8);
  sel = 0;
  ul.innerHTML = hallados.length ? '' : '<li class="nada">Sin resultados</li>';
  hallados.forEach((x, i) => {
    const li = document.createElement('li'); li.className = i === sel ? 'sel' : '';
    li.textContent = x.nombre; const sm = document.createElement('small'); sm.textContent = x.grupo; li.appendChild(sm);
    li.onpointerdown = (e) => { e.preventDefault(); elegir(i); };
    ul.appendChild(li);
  });
  ul.classList.remove('oculto');
}
function elegir(i) {
  const x = hallados[i]; if (!x) return;
  $('buscar').value = ''; $('resultados').classList.add('oculto'); $('buscar').blur(); abrirLista(false);
  if (x.k !== undefined) mostrar(x.k);
  else { pines.forEach((p) => p.el.classList.remove('activo')); buscado = x; abrirFicha(x.nombre, x.detalle); }
  centrarEn(x.u, x.v);
}
// En pantallas angostas el texto completo no cabe
const ajustarBuscador = () => { $('buscar').placeholder = $('buscar').clientWidth < 290 ? 'Busca un lugar' : 'Busca un lugar de San Juan del Río'; };
ajustarBuscador(); addEventListener('resize', ajustarBuscador);
$('buscar').addEventListener('input', pintarResultados);
$('buscar').addEventListener('focus', pintarResultados);
$('buscar').addEventListener('blur', () => setTimeout(() => $('resultados').classList.add('oculto'), 100));
$('buscar').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') { e.preventDefault(); elegir(sel); }
  else if (e.key === 'Escape') { $('buscar').value = ''; pintarResultados(); $('buscar').blur(); }
  else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    e.preventDefault(); sel = clamp(sel + (e.key === 'ArrowDown' ? 1 : -1), 0, hallados.length - 1);
    [...$('resultados').children].forEach((li, i) => li.classList.toggle('sel', i === sel));
  }
});

// ---------- Brújula: hacia dónde queda el norte en la pantalla (cámara fija, D-07) ----------
// Con los lugares del catálogo (metros x, n y pixeles u, v) se ajusta u = a·x + b·n + c y v = d·x + e·n + f; el norte es (b, e).
if (catalogo?.lugares?.length >= 3) {
  const P = catalogo.lugares, r = (k) => { const L = P[k]; return [L.x, L.n, L.u, L.v]; };
  // dos lugares lejanos entre sí en n bastan para la dirección; se usan mínimos cuadrados simples sobre todos
  let sxx = 0, sxn = 0, snn = 0, sxu = 0, snu = 0, sxv = 0, snv = 0; const mx = P.reduce((a, l) => a + l.x, 0) / P.length, mn = P.reduce((a, l) => a + l.n, 0) / P.length, mu = P.reduce((a, l) => a + l.u, 0) / P.length, mv = P.reduce((a, l) => a + l.v, 0) / P.length;
  for (let k = 0; k < P.length; k++) { const [x, n, u, v] = r(k), X = x - mx, N = n - mn, U = u - mu, V = v - mv; sxx += X * X; sxn += X * N; snn += N * N; sxu += X * U; snu += N * U; sxv += X * V; snv += N * V; }
  const det = sxx * snn - sxn * sxn, b = (sxx * snu - sxn * sxu) / det, e = (sxx * snv - sxn * sxv) / det;
  const ang = (Math.atan2(b, -e) * 180) / Math.PI; // 0° = arriba
  $('aguja').setAttribute('transform', `rotate(${ang.toFixed(1)} 20 20)`);
  const rad = (ang * Math.PI) / 180; $('letra-n').setAttribute('x', (20 + 15.5 * Math.sin(rad)).toFixed(1)); $('letra-n').setAttribute('y', (23 - 15.5 * Math.cos(rad)).toFixed(1));
}

// ---------- Mapa chico (abajo a la izquierda): la ciudad entera con el recuadro de lo que se ve ----------
const chicoLienzo = $('chico-lienzo'), cctx = chicoLienzo.getContext('2d');
function chicoEscala() {
  // D-42: sin margen y 15 % más cerca (ESTIMADO): las puntas del rombo se recortan un poco y casi no queda fondo oscuro
  const w = chicoLienzo.clientWidth, h = chicoLienzo.clientHeight;
  const s = 1.15 * Math.min(w / (caja.u1 - caja.u0), h / (caja.v1 - caja.v0));
  return { w, h, s, ox: w / 2 - ((caja.u0 + caja.u1) / 2) * s, oy: h / 2 - ((caja.v0 + caja.v1) / 2) * s };
}
function dibujarChico() {
  if (!chicoLienzo.clientWidth) return;
  const dpr = devicePixelRatio || 1, E = chicoEscala();
  if (chicoLienzo.width !== Math.round(E.w * dpr)) { chicoLienzo.width = Math.round(E.w * dpr); chicoLienzo.height = Math.round(E.h * dpr); }
  cctx.setTransform(dpr, 0, 0, dpr, 0, 0); cctx.clearRect(0, 0, E.w, E.h);
  const S = T * 2 ** NIV;
  for (const id of existen[NIV] ?? []) {
    const [i, j] = id.split('_').map(Number), img = imagen(NIV, i, j);
    if (lista(img)) cctx.drawImage(img, E.ox + (i * S - T / 2) * E.s, E.oy + (j * S - T / 2) * E.s, S * E.s, S * E.s);
  }
  const w2 = innerWidth / 2 / vista.zoom, h2 = innerHeight / 2 / vista.zoom;
  const x0 = E.ox + (vista.u - w2) * E.s, y0 = E.oy + (vista.v - h2) * E.s, ww = 2 * w2 * E.s, hh = 2 * h2 * E.s;
  cctx.lineWidth = 2.5; cctx.strokeStyle = '#1d1a16'; cctx.strokeRect(x0, y0, ww, hh);
  cctx.lineWidth = 1.2; cctx.strokeStyle = '#e8b13a'; cctx.strokeRect(x0, y0, ww, hh);
}
let chicoArrastre = false;
const chicoIr = (e) => { const E = chicoEscala(), r = chicoLienzo.getBoundingClientRect(); irA((e.clientX - r.left - E.ox) / E.s, (e.clientY - r.top - E.oy) / E.s); tocado = true; };
chicoLienzo.addEventListener('pointerdown', (e) => { chicoArrastre = true; chicoLienzo.setPointerCapture(e.pointerId); chicoIr(e); });
chicoLienzo.addEventListener('pointermove', (e) => { if (chicoArrastre) chicoIr(e); });
chicoLienzo.addEventListener('pointerup', () => { chicoArrastre = false; });

// ---------- Arrastre y pellizco ----------
const punteros = new Map();
let pellizco = null;
mapa.addEventListener('pointerdown', (e) => { mapa.setPointerCapture(e.pointerId); punteros.set(e.pointerId, { x: e.clientX, y: e.clientY }); mapa.classList.add('arrastrando'); });
mapa.addEventListener('pointermove', (e) => {
  const prev = punteros.get(e.pointerId); if (!prev) return;
  const act = { x: e.clientX, y: e.clientY };
  if (punteros.size === 1) { vista.u -= (act.x - prev.x) / vista.zoom; vista.v -= (act.y - prev.y) / vista.zoom; pedirDibujo(); }
  punteros.set(e.pointerId, act);
  if (punteros.size === 2) {
    const [a, b] = [...punteros.values()];
    const dist = Math.hypot(a.x - b.x, a.y - b.y);
    if (pellizco) zoomEn((a.x + b.x) / 2, (a.y + b.y) / 2, dist / pellizco);
    pellizco = dist;
  }
});
const soltar = (e) => { punteros.delete(e.pointerId); if (punteros.size < 2) pellizco = null; if (!punteros.size) mapa.classList.remove('arrastrando'); };
mapa.addEventListener('pointerup', soltar);
mapa.addEventListener('pointercancel', soltar);
mapa.addEventListener('wheel', (e) => { e.preventDefault(); zoomEn(e.clientX, e.clientY, Math.exp(-e.deltaY * 0.0015)); }, { passive: false });
mapa.addEventListener('dblclick', (e) => zoomEn(e.clientX, e.clientY, 2));
document.getElementById('mas').onclick = () => zoomEn(innerWidth / 2, innerHeight / 2, 1.5);
document.getElementById('menos').onclick = () => zoomEn(innerWidth / 2, innerHeight / 2, 1 / 1.5);
let tocado = false; // si la página abrió con la ventana sin tamaño (pestaña oculta), se reacomoda al aparecer
mapa.addEventListener('pointerdown', () => { tocado = true; });
mapa.addEventListener('wheel', () => { tocado = true; });
addEventListener('resize', () => { calcularZmin(); if (!tocado) vistaInicial(); pedirDibujo(); });

if (!vistaDelEnlace()) vistaInicial();
pedirDibujo();
window.__visor = { vista, irA, lista: true };
