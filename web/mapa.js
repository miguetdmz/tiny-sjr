// Mapa de teselas reutilizable (Fase J, J0): lo usan el mapa grande y el mapa chico del juego.
// Misma regla de dibujo que web/visor.js: teselas WebP en un canvas, bordes redondeados al pixel de pantalla,
// pirámide de niveles para ver de lejos (D-18) y zonas "fuera_del_mapa" ignoradas (D-22).
// u, v = pixeles nativos de la rejilla (src/rejilla.js). x, n = metros al este y al norte del origen, sobre el suelo.
import { camaraFija } from '../src/rejilla.js';
import { alturaCiudad } from '../src/relieve.js';

const BASE = new URL('..', import.meta.url);
const leer = (u) => fetch(u).then((r) => (r.ok ? r.json() : null), () => null);
const clamp = (x, a, b) => Math.min(b, Math.max(a, x));

/** Carga una sola vez lo que comparten todos los mapas: rejillas, pirámide y cámara */
export async function cargarDatos() {
  const cfg = await leer(new URL('config.json', BASE));
  const ids = Object.keys(cfg.zonas).filter((id) => !cfg.zonas[id].fuera_del_mapa);
  const rejillas = (await Promise.all(ids.map((id) => leer(new URL(`tiles/rejilla-${id}.json`, BASE))))).filter(Boolean);
  const T = rejillas[0].tamano_px;
  const teselas = [...new Set(rejillas.flatMap((r) => r.teselas.map((t) => `${t.i}_${t.j}`)))];
  const pir = await leer(new URL('tiles/piramide.json', BASE));
  const NIV = pir?.niveles ?? 0;
  const existen = [new Set(teselas), ...Array.from({ length: NIV }, (_, k) => new Set(pir.teselas[k + 1]))];
  const ij = teselas.map((k) => k.split('_').map(Number));
  const caja = {
    u0: Math.min(...ij.map((p) => p[0])) * T - T / 2, u1: (Math.max(...ij.map((p) => p[0])) + 1) * T - T / 2,
    v0: Math.min(...ij.map((p) => p[1])) * T - T / 2, v1: (Math.max(...ij.map((p) => p[1])) + 1) * T - T / 2,
  };
  const cam = camaraFija(cfg);
  // Suelo <-> pantalla. Con relieve (Fase 3c) el punto del mundo es [x, h(x, n), -n] (src/rejilla.js), con h del
  // relieve de la ciudad (scripts/21-relieve-ciudad.mjs). Apagado o sin archivo: el suelo es plano (h = 0), como en J0.
  // Solo si config.json → relieve.activo (D-28: apagado mientras el relieve se rehace solo para los cerros)
  const encab = cfg.relieve?.activo ? await leer(new URL('web/relieve-ciudad.json', BASE)) : null;
  const bin = encab && await fetch(new URL('web/relieve-ciudad.bin', BASE)).then((r) => (r.ok ? r.arrayBuffer() : null), () => null);
  const relieve = bin ? { ...encab, h: new Int16Array(bin) } : null;
  const altura = (x, n) => alturaCiudad(relieve, x, n);
  const { R, U, mpp } = cam;
  const det = -R[0] * U[2] + R[2] * U[0];
  const sueloAPantalla = (x, n) => { const h = altura(x, n); return { u: (x * R[0] + h * R[1] - n * R[2]) / mpp, v: -(x * U[0] + h * U[1] - n * U[2]) / mpp }; };
  // Punto del plano horizontal y = h que se ve en el pixel (u, v)
  const enPlano = (u, v, h) => {
    const a = u * mpp - h * R[1], b = -v * mpp - h * U[1]; // [[R0, -R2], [U0, -U2]] · [x, n] = [a, b]
    return { x: (a * -U[2] - -R[2] * b) / det, n: (R[0] * b - U[0] * a) / det };
  };
  // Pixel → suelo: se recorre la línea de vista de arriba hacia abajo y se toma el primer cruce con el terreno
  // (el que se ve; lo que queda detrás de un cerro no). Luego se afina por bisección.
  const pantallaASuelo = (u, v) => {
    if (!relieve) return enPlano(u, v, 0);
    const f = (h) => { const p = enPlano(u, v, h); return altura(p.x, p.n) - h; };
    let alto = relieve.max_m + 1;
    for (let h = alto - 1; h >= relieve.min_m - 1; h -= 1) {
      if (f(h) >= 0) { let lo = h, hi = h + 1; for (let k = 0; k < 20; k++) { const m = (lo + hi) / 2; if (f(m) >= 0) lo = m; else hi = m; } return enPlano(u, v, lo); }
    }
    return enPlano(u, v, 0);
  };
  return { cfg, T, NIV, existen, caja, cam, sueloAPantalla, pantallaASuelo, altura, BASE };
}

/**
 * Crea un mapa dentro de `contenedor` (un div con tamaño). Opciones:
 *   alDibujar(ctx, P, dpr)  dibuja encima de las teselas; P(u, v) da el pixel del canvas
 *   alTocar(u, v)           toque o clic sin arrastre
 *   limitar(vista)          corrige la vista después de cada movimiento (radio limitado, etc.)
 *   zmax                    zoom máximo (por omisión 6)
 */
export function crearMapa(datos, contenedor, opciones = {}) {
  const { T, NIV, existen, caja, BASE: base } = datos;
  const lienzo = document.createElement('canvas');
  lienzo.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;display:block';
  contenedor.appendChild(lienzo);
  contenedor.style.touchAction = 'none';
  const ctx = lienzo.getContext('2d');
  const vista = { u: 0, v: 0, zoom: 1 };
  const ancho = () => contenedor.clientWidth, alto = () => contenedor.clientHeight;
  let zmin = 0.015, zmax = opciones.zmax ?? 6, zminFijo = null;
  const calcularZmin = () => { if (ancho() && alto()) zmin = zminFijo ?? Math.min(0.015, 0.9 * Math.min(ancho() / (caja.u1 - caja.u0), alto() / (caja.v1 - caja.v0))); };
  const aPantalla = (u, v) => ({ x: ancho() / 2 + (u - vista.u) * vista.zoom, y: alto() / 2 + (v - vista.v) * vista.zoom });
  const aNativo = (x, y) => ({ u: vista.u + (x - ancho() / 2) / vista.zoom, v: vista.v + (y - alto() / 2) / vista.zoom });

  const imagenes = new Map();
  function imagen(k, i, j, pedir = true) {
    const clave = `${k}/${i}_${j}`;
    let img = imagenes.get(clave);
    if (img) { imagenes.delete(clave); imagenes.set(clave, img); return img; }
    if (!pedir) return null;
    img = new Image();
    img.onload = () => pedirDibujo();
    img.src = new URL(k === 0 ? `tiles/nativo/${i}_${j}.webp` : `tiles/nivel-${k}/${i}_${j}.webp`, base).href;
    imagenes.set(clave, img);
    return img;
  }
  const lista = (img) => img && img.complete && img.naturalWidth;
  let pendiente = false;
  const pedirDibujo = () => { if (!pendiente) { pendiente = true; requestAnimationFrame(dibujar); } };
  function dibujar() {
    pendiente = false;
    const dpr = devicePixelRatio || 1, w = ancho(), h = alto();
    if (!w || !h) return;
    if (lienzo.width !== Math.round(w * dpr) || lienzo.height !== Math.round(h * dpr)) { lienzo.width = Math.round(w * dpr); lienzo.height = Math.round(h * dpr); }
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = opciones.fondo ?? '#1e2a33'; ctx.fillRect(0, 0, lienzo.width, lienzo.height);
    ctx.imageSmoothingEnabled = vista.zoom * dpr < 1.5;
    const k = NIV ? clamp(Math.floor(Math.log2(1 / (vista.zoom * dpr))), 0, NIV) : 0;
    const S = T * 2 ** k;
    const u0 = vista.u - w / 2 / vista.zoom, u1 = vista.u + w / 2 / vista.zoom, v0 = vista.v - h / 2 / vista.zoom, v1 = vista.v + h / 2 / vista.zoom;
    const cajaPx = (uA, vA, uB, vB) => { const a = aPantalla(uA, vA), b = aPantalla(uB, vB); return [Math.round(a.x * dpr), Math.round(a.y * dpr), Math.round(b.x * dpr), Math.round(b.y * dpr)]; };
    for (let i = Math.floor((u0 + T / 2) / S); i <= Math.floor((u1 + T / 2) / S); i++) {
      for (let j = Math.floor((v0 + T / 2) / S); j <= Math.floor((v1 + T / 2) / S); j++) {
        if (!existen[k].has(`${i}_${j}`)) continue;
        const [x0, y0, x1, y1] = cajaPx(i * S - T / 2, j * S - T / 2, (i + 1) * S - T / 2, (j + 1) * S - T / 2);
        const img = imagen(k, i, j);
        if (lista(img)) { ctx.drawImage(img, x0, y0, x1 - x0, y1 - y0); continue; }
        for (let kk = k + 1; kk <= NIV; kk++) {
          const f = 2 ** (kk - k), I = Math.floor(i / f), J = Math.floor(j / f), p = imagen(kk, I, J, false);
          if (!lista(p)) continue;
          const sx = ((i - I * f) / f) * T, sy = ((j - J * f) / f) * T;
          ctx.drawImage(p, sx, sy, T / f, T / f, x0, y0, x1 - x0, y1 - y0); break;
        }
      }
    }
    for (const [clave, img] of imagenes) { if (imagenes.size <= 250) break; imagenes.delete(clave); img.src = ''; }
    if (opciones.alDibujar) {
      const P = (u, v) => { const s = aPantalla(u, v); return { x: s.x * dpr, y: s.y * dpr }; };
      ctx.save(); opciones.alDibujar(ctx, P, dpr); ctx.restore();
    }
  }

  const ajustar = () => { vista.zoom = clamp(vista.zoom, zmin, zmax); opciones.limitar?.(vista); pedirDibujo(); };
  function irA(u, v, zoom = vista.zoom) { Object.assign(vista, { u, v, zoom }); ajustar(); }
  function zoomEn(px, py, factor) {
    const z1 = clamp(vista.zoom * factor, zmin, zmax);
    const p = aNativo(px, py);
    vista.u = p.u - (px - ancho() / 2) / z1; vista.v = p.v - (py - alto() / 2) / z1; vista.zoom = z1;
    ajustar();
  }
  /** Encuadra la caja [u0, v0, u1, v1] con un margen en pixeles de pantalla */
  function encuadrar(u0, v0, u1, v1, margen = 40) {
    calcularZmin(); // el contenedor pudo cambiar de tamaño (p. ej. el mapa que se abre en el teléfono)
    const z = Math.min((ancho() - 2 * margen) / Math.max(u1 - u0, 1), (alto() - 2 * margen) / Math.max(v1 - v0, 1));
    irA((u0 + u1) / 2, (v0 + v1) / 2, z);
  }
  const ciudad = () => encuadrar(caja.u0, caja.v0, caja.u1, caja.v1, 10);

  // ---------- Arrastre, pellizco, rueda y toque ----------
  let activo = true;
  const punteros = new Map();
  let pellizco = null, inicio = null, movido = 0;
  contenedor.addEventListener('pointerdown', (e) => {
    if (!activo) return;
    contenedor.setPointerCapture(e.pointerId); punteros.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (punteros.size === 1) { inicio = { x: e.clientX, y: e.clientY }; movido = 0; } else movido = 99;
    contenedor.style.cursor = 'grabbing';
  });
  contenedor.addEventListener('pointermove', (e) => {
    const prev = punteros.get(e.pointerId); if (!prev || !activo) return;
    const act = { x: e.clientX, y: e.clientY };
    if (punteros.size === 1) {
      movido = Math.max(movido, Math.hypot(act.x - inicio.x, act.y - inicio.y));
      if (movido > 6) { vista.u -= (act.x - prev.x) / vista.zoom; vista.v -= (act.y - prev.y) / vista.zoom; ajustar(); }
    }
    punteros.set(e.pointerId, act);
    if (punteros.size === 2) {
      const [a, b] = [...punteros.values()];
      const r = contenedor.getBoundingClientRect();
      const dist = Math.hypot(a.x - b.x, a.y - b.y);
      if (pellizco) zoomEn((a.x + b.x) / 2 - r.left, (a.y + b.y) / 2 - r.top, dist / pellizco);
      pellizco = dist;
    }
  });
  const soltar = (e) => {
    if (!punteros.has(e.pointerId)) return;
    punteros.delete(e.pointerId);
    if (punteros.size < 2) pellizco = null;
    if (!punteros.size) {
      contenedor.style.cursor = '';
      if (e.type === 'pointerup' && movido <= 6 && opciones.alTocar) {
        const r = contenedor.getBoundingClientRect(); const p = aNativo(e.clientX - r.left, e.clientY - r.top);
        opciones.alTocar(p.u, p.v);
      }
    }
  };
  contenedor.addEventListener('pointerup', soltar);
  contenedor.addEventListener('pointercancel', soltar);
  contenedor.addEventListener('wheel', (e) => {
    e.preventDefault(); if (!activo) return;
    const r = contenedor.getBoundingClientRect(); zoomEn(e.clientX - r.left, e.clientY - r.top, Math.exp(-e.deltaY * 0.0015));
  }, { passive: false });
  new ResizeObserver(() => { calcularZmin(); ajustar(); }).observe(contenedor);
  calcularZmin();

  return {
    vista, irA, zoomEn, encuadrar, ciudad, pedirDibujo, aPantalla, aNativo, lienzo,
    centro: () => zoomEn(ancho() / 2, alto() / 2, 1),
    acercar: (f) => zoomEn(ancho() / 2, alto() / 2, f),
    set interactivo(b) { activo = b; },
    /** Rango de zoom propio (null = el de la ciudad entera) */
    rangoZoom(a, b) { zminFijo = a; zmax = b ?? opciones.zmax ?? 6; calcularZmin(); ajustar(); },
  };
}
