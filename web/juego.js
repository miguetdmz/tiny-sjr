// Fase J (D-20). Dos modos ("¿Dónde caí?" y "Encuéntralo"), niveles SANJUANENSE V0 a V3 (N2, D-76), 5 rondas y puntaje real.
// J2: "¿Dónde caí?" saca sus 5 rondas al azar del catálogo del nivel elegido (web/juego-lugares.json, D-29/D-30).
// J3: "Encuéntralo" también saca sus 5 rondas del catálogo del nivel, con la descripción de cada lugar (qué es + dónde, D-36).
// J4: pantalla final con las 5 rondas en el mapa y Compartir en texto (D-38). Aspecto de la portada (D-37).
// Todo corre en el navegador ($0, sin servidor).
// Flujo tomado del género (D-20); nombres, textos, iconos y colores propios.
import { cargarDatos, crearMapa } from './mapa.js';

// ---------- Reglas (ESTIMADO: se ajustan en la revisión de J0) ----------
const RONDAS = 5;
const MAX = 5000;
const RADIO_CAER_M = 300;        // cuánto puedes moverte alrededor del punto donde caíste
const PISTA_COSTO = 1000;
const PISTA_RADIO_M = 500;       // círculo de la pista
/** Puntos (D-76): 5 000 dentro del radio del lugar (r = radio_m, 25-150 m según qué tan junto está de otros); luego bajan como
 *  exponencial con escala de 800 m. f = tolerancia del nivel: V0 1,0 · V1 0,9 · V2 0,8 · V3 0,7 (cada nivel 10 % más estricto). */
const puntaje = (d, r = 25, f = 1) => (d <= r * f ? MAX : Math.round(MAX * Math.exp(-(d - r * f) / (800 * f))));
const MENSAJES = [[4500, '¡En el blanco!'], [3000, '¡Muy cerca!'], [1500, 'Vas bien'], [400, 'Te faltó'], [0, 'Ni de cerca']];
/** Rango de una ronda (4 = en el blanco … 0 = ni de cerca): el mismo color en la ficha final (--r#) y en Compartir */
const rango = (pts) => 4 - MENSAJES.findIndex(([m]) => pts >= m);
const CUADROS = ['⬛', '🟥', '🟧', '🟨', '🟩'];
/** Mensaje de la partida según el promedio por ronda (mismos cortes que la ronda) */
const MENSAJES_FIN = ['Hay que darse una vuelta por San Juan', 'Te falta caminar la ciudad', 'Vas bien: sigue paseando', 'Conoces bien San Juan', '¡Sanjuanense de verdad!'];
// N2 (D-76): 4 niveles por popularidad (N1). f = tolerancia de puntos del nivel.
const NIVELES = {
  V0: { leyenda: 'Turista', color: '--v0', f: 1.0 }, V1: { leyenda: 'Vecino', color: '--v1', f: 0.9 },
  V2: { leyenda: 'Adoptado', color: '--v2', f: 0.8 }, V3: { leyenda: 'De toda la vida', color: '--v3', f: 0.7 },
};
const MODOS = { caer: '¿Dónde caí?', encontrar: 'Encuéntralo' };

const $ = (id) => document.getElementById(id);
const fmt = (n) => Math.round(n).toLocaleString('es-MX').replace(/,/g, ' ');
const fmtDist = (m) => (m < 1000 ? `a ${Math.round(m)} m` : `a ${(m / 1000).toFixed(1).replace('.', ',')} km`);
const mostrar = (id, si = true) => $(id).classList.toggle('oculto', !si);

$('carga').classList.remove('oculto');
const datos = await cargarDatos();
const leerJSON = (f) => fetch(new URL(f, import.meta.url)).then((r) => r.json());
const catalogo = await leerJSON('juego-lugares.json');
const TIPOS = { cerro: 'Cerro', comercio: 'Comercio', escuela: 'Escuela', estacion: 'Estación', gobierno: 'Gobierno', mercado: 'Mercado',
  museo: 'Museo', parque: 'Parque', plaza: 'Plaza', puente: 'Puente', salud: 'Salud', templo: 'Templo', colonia: 'Colonia',
  panteon: 'Panteón', servicio: 'Servicio', deporte: 'Deporte', esquina: 'Esquina', historico: 'Histórico', arqueologia: 'Zona arqueológica' };
$('carga').classList.add('oculto');

// ---------- Estado ----------
const J = { nivel: 'V0', modo: 'caer', fase: 'menu', ronda: 0, orden: [], puntos: [], pin: null, pista: null, lugar: null, sonido: localStorage.getItem('tsjr-sonido') !== '0' };
const suelo = (u, v) => datos.pantallaASuelo(u, v);
const distancia = (a, b) => Math.hypot(a.x - b.x, a.n - b.n);

// ---------- Dibujo de pin, banderita, línea y círculo de pista ----------
function dibujarPin(ctx, p, dpr, color = '#e8b13a') {
  const s = dpr; ctx.save(); ctx.translate(p.x, p.y);
  ctx.beginPath(); ctx.moveTo(0, 0);
  ctx.bezierCurveTo(-3 * s, -9 * s, -11 * s, -14 * s, -11 * s, -22 * s);
  ctx.arc(0, -22 * s, 11 * s, Math.PI, 0);
  ctx.bezierCurveTo(11 * s, -14 * s, 3 * s, -9 * s, 0, 0);
  ctx.fillStyle = color; ctx.strokeStyle = '#1d1a16'; ctx.lineWidth = 2.5 * s; ctx.fill(); ctx.stroke();
  ctx.beginPath(); ctx.arc(0, -22 * s, 4 * s, 0, 2 * Math.PI); ctx.fillStyle = '#1d1a16'; ctx.fill();
  ctx.restore();
}
function dibujarBandera(ctx, p, dpr) {
  const s = dpr, color = getComputedStyle(document.documentElement).getPropertyValue(NIVELES[J.nivel].color).trim();
  ctx.save(); ctx.translate(p.x, p.y);
  ctx.strokeStyle = '#1d1a16'; ctx.lineWidth = 3 * s; ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(0, -34 * s); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(0, -34 * s); ctx.lineTo(22 * s, -27 * s); ctx.lineTo(0, -20 * s); ctx.closePath();
  ctx.fillStyle = color; ctx.fill(); ctx.lineWidth = 1.5 * s; ctx.stroke();
  ctx.beginPath(); ctx.ellipse(0, 0, 6 * s, 3 * s, 0, 0, 2 * Math.PI); ctx.fillStyle = 'rgba(0,0,0,.35)'; ctx.fill();
  ctx.restore();
}
function dibujarLinea(ctx, a, b, dpr, g = 1) {
  ctx.save(); ctx.setLineDash([7 * dpr * g, 6 * dpr * g]); ctx.lineWidth = 3 * dpr * g;
  ctx.strokeStyle = '#1d1a16'; ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
  ctx.lineWidth = 1.6 * dpr * g; ctx.strokeStyle = '#fff'; ctx.stroke(); ctx.restore();
}
/** Número de ronda en un cuadrito crema con borde de tinta, junto a la bandera (pantalla final) */
function dibujarNumero(ctx, p, k, dpr) {
  const s = dpr, x = p.x + 8 * s, y = p.y - 52 * s, w = 20 * s;
  ctx.save(); ctx.fillStyle = '#fbf3e2'; ctx.strokeStyle = '#1d1a16'; ctx.lineWidth = 2.5 * s;
  ctx.beginPath(); ctx.roundRect(x, y, w, w, 5 * s); ctx.fill(); ctx.stroke();
  ctx.fillStyle = '#1d1a16'; ctx.font = `900 ${12 * s}px ui-rounded, system-ui, sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText(String(k), x + w / 2, y + w / 2 + 0.5 * s); ctx.restore();
}
/** Círculo de radio r metros sobre el suelo (en la vista isométrica se ve como elipse) */
function dibujarCirculo(ctx, P, c, r, dpr) {
  ctx.save(); ctx.setLineDash([8 * dpr, 6 * dpr]); ctx.lineWidth = 2.5 * dpr; ctx.strokeStyle = '#1d1a16'; ctx.fillStyle = 'rgba(232,177,58,.22)';
  ctx.beginPath();
  for (let k = 0; k <= 64; k++) { const a = (k / 64) * 2 * Math.PI, q = datos.sueloAPantalla(c.x + r * Math.cos(a), c.n + r * Math.sin(a)), p = P(q.u, q.v); k ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y); }
  ctx.fill(); ctx.stroke(); ctx.restore();
}

// ---------- Mapas ----------
const grande = crearMapa(datos, $('grande'), {
  alDibujar(ctx, P, dpr) {
    if (J.fase === 'jugando' && J.modo === 'encontrar') {
      if (J.pista) dibujarCirculo(ctx, P, J.pista, PISTA_RADIO_M, dpr);
      if (J.pin) dibujarPin(ctx, P(J.pin.u, J.pin.v), dpr);
    }
    if (J.fase === 'resultado') {
      const a = P(J.pin.u, J.pin.v), b = P(J.lugar.u, J.lugar.v);
      dibujarLinea(ctx, a, b, dpr); dibujarBandera(ctx, b, dpr); dibujarPin(ctx, a, dpr);
    }
    if (J.fase === 'final') { // las 5 rondas: pin, banderita con su número y línea
      const pares = J.historial.map((h) => [P(h.pin.u, h.pin.v), P(h.lugar.u, h.lugar.v)]);
      for (const [a, b] of pares) dibujarLinea(ctx, a, b, dpr, 1.5);
      pares.forEach(([, b], k) => { dibujarBandera(ctx, b, dpr); dibujarNumero(ctx, b, k + 1, dpr); });
      for (const [a] of pares) dibujarPin(ctx, a, dpr * 0.85);
    }
  },
  alTocar(u, v) { if (J.fase === 'jugando' && J.modo === 'encontrar') ponerPin(u, v); },
  limitar(vista) {
    if (J.fase !== 'jugando' || J.modo !== 'caer') return;
    const c = suelo(vista.u, vista.v), d = distancia(c, J.lugar);
    if (d > RADIO_CAER_M) {
      const f = RADIO_CAER_M / d, q = datos.sueloAPantalla(J.lugar.x + (c.x - J.lugar.x) * f, J.lugar.n + (c.n - J.lugar.n) * f);
      vista.u = q.u; vista.v = q.v;
    }
  },
});
const chico = crearMapa(datos, $('chico'), {
  fondo: '#26343e',
  alDibujar(ctx, P, dpr) {
    if (J.modo === 'caer' && J.pista) dibujarCirculo(ctx, P, J.pista, PISTA_RADIO_M, dpr);
    if (J.modo === 'caer' && J.pin) dibujarPin(ctx, P(J.pin.u, J.pin.v), dpr * 0.8);
    if (J.modo === 'encontrar') { // recuadro de lo que se ve en el mapa grande
      const g = grande.vista, w = innerWidth / 2 / g.zoom, h = innerHeight / 2 / g.zoom, a = P(g.u - w, g.v - h), b = P(g.u + w, g.v + h);
      ctx.strokeStyle = '#e8b13a'; ctx.lineWidth = 2.5 * dpr; ctx.strokeRect(a.x, a.y, b.x - a.x, b.y - a.y);
    }
  },
  alTocar(u, v) {
    if (J.fase !== 'jugando') return;
    if (J.modo === 'caer') ponerPin(u, v);
    else grande.irA(u, v, Math.max(grande.vista.zoom, 0.25));
  },
});
// El recuadro del mapa chico sigue al grande
const redibujarGrande = grande.pedirDibujo;
grande.pedirDibujo = () => { redibujarGrande(); if (J.modo === 'encontrar') chico.pedirDibujo(); };
$('grande').addEventListener('pointermove', () => J.modo === 'encontrar' && chico.pedirDibujo());
$('grande').addEventListener('wheel', () => J.modo === 'encontrar' && chico.pedirDibujo());

// ---------- Sonido (tonos cortos con WebAudio, sin archivos) ----------
let audio = null;
function tono(frec, dur = 0.12, cuando = 0) {
  if (!J.sonido) return;
  audio ??= new AudioContext();
  const o = audio.createOscillator(), g = audio.createGain(), t = audio.currentTime + cuando;
  o.type = 'triangle'; o.frequency.value = frec; g.gain.setValueAtTime(0.12, t); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
  o.connect(g).connect(audio.destination); o.start(t); o.stop(t + dur);
}
function iconoSonido() {
  $('sonido').innerHTML = J.sonido
    ? '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M3 8h3l4-3v10l-4-3H3z" fill="currentColor"/><path d="M13 7a4 4 0 0 1 0 6M15 5a7 7 0 0 1 0 10"/></svg>'
    : '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M3 8h3l4-3v10l-4-3H3z" fill="currentColor"/><path d="M13 8l4 4M17 8l-4 4"/></svg>';
}
$('sonido').onclick = () => { J.sonido = !J.sonido; localStorage.setItem('tsjr-sonido', J.sonido ? '1' : '0'); iconoSonido(); tono(660); };
iconoSonido();

// ---------- Menú ----------
function elegirNivel(n) {
  J.nivel = n;
  document.documentElement.style.setProperty('--nivel', `var(${NIVELES[n].color})`);
  for (const b of document.querySelectorAll('.nivel')) b.setAttribute('aria-pressed', String(b.dataset.nivel === n));
}
for (const b of document.querySelectorAll('.nivel')) b.onclick = () => elegirNivel(b.dataset.nivel);
// D-65: el número de lugares por nivel ya no se le muestra al jugador
for (const b of document.querySelectorAll('.modo-b')) b.onclick = () => empezar(b.dataset.modo);
$('menu-cerrar').onclick = () => { location.href = './index.html'; };
// ---------- Qué se ve (una sola regla para compu y teléfono) ----------
// Teléfono, "¿Dónde caí?": el mapa chico no está siempre; el botón Mapa lo abre a casi toda la pantalla, con × y el pin abajo.
// Teléfono, "Encuéntralo": sin mapa chico; zoom con pellizco y botón de inicio. Compu: mapa chico siempre; M lo agranda.
const esTel = () => innerWidth <= 600;
function acomodar() {
  const jugando = J.fase === 'jugando', caer = J.modo === 'caer', tel = esTel();
  const chicoVisible = jugando && (caer ? !tel || J.mapaAbierto : !tel);
  mostrar('barra', jugando || J.fase === 'resultado');
  mostrar('chico', chicoVisible);
  $('chico').classList.toggle('ubicar', !caer);
  $('chico').classList.toggle('abierto', jugando && caer && J.mapaAbierto);
  $('chico').style.top = tel && jugando && caer && J.mapaAbierto ? `${$('barra').getBoundingClientRect().bottom + 8}px` : '';
  mostrar('ver-mapa', jugando && caer && tel && !J.mapaAbierto);
  mostrar('accion', jugando && (!caer || !tel || J.mapaAbierto));
  mostrar('cerrar-mapa', jugando && caer && J.mapaAbierto);
  mostrar('aviso', !J.pin); mostrar('adivinar', !!J.pin);
  mostrar('ayudas', jugando); mostrar('volver', jugando && caer);
  mostrar('indicacion', jugando && caer); mostrar('reto', J.modo === 'encontrar' && (jugando || J.fase === 'resultado'));
  mostrar('controles', jugando || J.fase === 'resultado');
  for (const id of ['c-mas', 'c-menos', 'c-pantalla']) mostrar(id, !tel);
  mostrar('c-inicio', !(jugando && caer));
  $('controles').style.top = tel ? `${$('barra').getBoundingClientRect().bottom + 10}px` : '';
  // La primera vez que se ve el mapa chico en la ronda, se encuadra la ciudad entera
  if (chicoVisible && !J.chicoListo) requestAnimationFrame(() => { chico.ciudad(); J.chicoListo = true; });
  grande.pedirDibujo(); chico.pedirDibujo();
}
addEventListener('resize', acomodar);
function abrirMapa(si = !J.mapaAbierto) { if (J.fase !== 'jugando' || J.modo !== 'caer') return; J.mapaAbierto = si; acomodar(); }
$('ver-mapa').onclick = () => abrirMapa(true);
$('cerrar-mapa').onclick = () => abrirMapa(false);
$('volver').onclick = () => { if (J.fase === 'jugando') grande.irA(J.lugar.u, J.lugar.v, 1.2); };

function abrirMenu() {
  J.fase = 'menu';
  for (const id of ['barra', 'chico', 'controles', 'accion', 'resultado', 'final', 'ver-mapa']) mostrar(id, false);
  grande.rangoZoom(null, 6);
  mostrar('menu');
  grande.ciudad();
}

// ---------- Partida ----------
/** Mezcla sin sesgo (Fisher-Yates) */
function mezclar(a) { a = [...a]; for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; }
/**
 * Saca n lugares de la lista sin repetir los que ya salieron en partidas anteriores del mismo nivel y modo, hasta agotarla
 * (como una bolsa: cuando se vacía, se vuelve a llenar). Se guarda en el navegador (localStorage), sin servidor.
 */
function sacar(lista, n, clave) {
  const ids = new Set(lista.map((l) => l.id));
  let bolsa = []; try { bolsa = JSON.parse(localStorage.getItem(clave)) ?? []; } catch {}
  bolsa = bolsa.filter((id) => ids.has(id));
  const fuera = [];
  while (fuera.length < n) {
    if (!bolsa.length) bolsa = mezclar([...ids].filter((id) => !fuera.includes(id)));
    if (!bolsa.length) break;
    fuera.push(bolsa.pop());
  }
  try { localStorage.setItem(clave, JSON.stringify(bolsa)); } catch {}
  return fuera.map((id) => lista.find((l) => l.id === id));
}
function empezar(modo) {
  J.modo = modo; J.ronda = 0; J.puntos = []; J.historial = [];
  J.orden = sacar(catalogo.lugares.filter((l) => l.nivel_juego === J.nivel), RONDAS, `tsjr-bolsa-${modo}-${J.nivel}`);
  mostrar('menu', false); mostrar('final', false);
  $('b-modo').textContent = MODOS[modo];
  // En la barra solo el nivel (cabe en el teléfono); la leyenda va de título y en la pantalla final
  $('b-nivel').textContent = NIVELES[J.nivel].leyenda; $('b-nivel').title = `Nivel ${J.nivel}`; // D-82: sin «SANJUANENSE»
  $('fin-nivel').textContent = `NIVEL ${NIVELES[J.nivel].leyenda.toUpperCase()}`;
  ronda();
}
function actualizarBarra() {
  $('b-ronda').textContent = `${J.ronda + 1}/${RONDAS}`;
  $('b-puntos').textContent = fmt(J.puntos.reduce((a, b) => a + b, 0));
}
function ronda() {
  J.lugar = J.orden[J.ronda]; J.pin = null; J.pista = null; J.fase = 'jugando'; J.mapaAbierto = false; J.chicoListo = false;
  actualizarBarra();
  mostrar('resultado', false);
  const caer = J.modo === 'caer';
  $('chico-etq').textContent = caer ? 'Toca dónde crees que estás' : 'Tu vista';
  $('aviso').textContent = 'Pon el pin en el mapa';
  $('pista').disabled = false;
  if (caer) {
    // Caer: pantalla breve de carga y la vista salta al lugar; solo se puede mover un poco alrededor
    $('carga-txt').textContent = 'Cayendo en algún lugar de San Juan…'; mostrar('carga');
    grande.rangoZoom(0.5, 4); grande.irA(J.lugar.u, J.lugar.v, 1.2);
    chico.rangoZoom(null, 3);
    setTimeout(() => { mostrar('carga', false); tono(520); tono(780, 0.15, 0.1); }, 900);
  } else {
    $('r-nombre').textContent = J.lugar.nombre; $('r-desc').textContent = J.lugar.descripcion;
    grande.rangoZoom(null, 6); grande.ciudad();
    chico.rangoZoom(null, 1);
  }
  acomodar();
}
function ponerPin(u, v) {
  J.pin = { u, v, ...suelo(u, v) };
  tono(880, 0.06);
  acomodar();
}
$('pista').onclick = () => {
  if (J.fase !== 'jugando' || J.pista) return;
  // El centro del círculo se corre al azar (hasta la mitad del radio) para que no marque el punto exacto
  const a = Math.random() * 2 * Math.PI, r = Math.random() * PISTA_RADIO_M * 0.5;
  J.pista = { x: J.lugar.x + r * Math.cos(a), n: J.lugar.n + r * Math.sin(a) };
  $('pista').disabled = true; tono(330, 0.2);
  const c = datos.sueloAPantalla(J.pista.x, J.pista.n), lado = (2.4 * PISTA_RADIO_M) / datos.cam.mpp;
  // "¿Dónde caí?": la pista se marca en el mapa chico (en el teléfono, lo abre). "Encuéntralo": en el grande.
  if (J.modo === 'caer') {
    J.mapaAbierto = J.mapaAbierto || esTel(); J.chicoListo = true; acomodar();
    requestAnimationFrame(() => chico.encuadrar(c.u - lado / 2, c.v - lado / 2, c.u + lado / 2, c.v + lado / 2, 10));
  } else grande.encuadrar(c.u - lado / 2, c.v - lado / 2, c.u + lado / 2, c.v + lado / 2, 20);
};
function adivinar() {
  if (J.fase !== 'jugando' || !J.pin) return;
  const d = distancia(J.pin, J.lugar);
  let pts = puntaje(d, J.lugar.radio_m ?? 25, NIVELES[J.nivel].f);
  if (J.pista) pts = Math.max(0, pts - PISTA_COSTO);
  J.puntos.push(pts); J.historial.push({ pin: J.pin, lugar: J.lugar, d, pts, pista: !!J.pista }); J.fase = 'resultado';
  actualizarBarra(); $('b-ronda').textContent = `${J.ronda + 1}/${RONDAS}`;
  J.mapaAbierto = false; acomodar();
  // La vista se aleja y muestra tu pin, la banderita en el lugar real y la línea entre ambos
  grande.rangoZoom(null, 3);
  $('res-msg').textContent = MENSAJES.find(([m]) => pts >= m)[1];
  $('res-pts').textContent = fmt(pts);
  $('res-barra').style.width = `${(100 * pts) / MAX}%`;
  $('res-lugar').textContent = J.lugar.nombre;
  $('res-dist').textContent = 'Tu pin quedó ' + fmtDist(d) + (J.pista ? ` · pista −${fmt(PISTA_COSTO)}` : '');
  $('res-desc').textContent = J.modo === 'encontrar' ? J.lugar.descripcion : (TIPOS[J.lugar.tipo] ?? '');
  $('siguiente').firstChild.textContent = J.ronda + 1 < RONDAS ? 'Siguiente ronda' : 'Ver resultado';
  mostrar('resultado');
  // Espacio libre: entre la barra de arriba y la ficha de resultado
  verEntre([J.pin, J.lugar], { x0: 0, x1: innerWidth, y0: $('barra').getBoundingClientRect().bottom + 10, y1: $('resultado').getBoundingClientRect().top - 10 });
  if (pts >= 3000) { tono(660); tono(880, 0.12, 0.1); tono(1320, 0.2, 0.2); } else tono(300, 0.25);
  grande.pedirDibujo();
}
/** Encuadra los puntos (u, v) dentro del rectángulo libre de la pantalla (px CSS), con aire para pines y banderas */
function verEntre(puntos, { x0, x1, y0, y1 }) {
  const us = puntos.map((p) => p.u), vs = puntos.map((p) => p.v);
  const u0 = Math.min(...us), u1 = Math.max(...us), v0 = Math.min(...vs), v1 = Math.max(...vs);
  const ancho = Math.max(x1 - x0, 120), alto = Math.max(y1 - y0, 120), m = 80; // m: margen en pixeles nativos (pin y bandera ~35 px)
  const z = Math.min((ancho - 60) / (u1 - u0 + 2 * m), (alto - 50) / (v1 - v0 + 2 * m));
  grande.irA((u0 + u1) / 2 - ((x0 + x1) / 2 - innerWidth / 2) / z, (v0 + v1) / 2 - 15 / z - ((y0 + y1) / 2 - innerHeight / 2) / z, z);
}
function siguiente() {
  if (J.fase !== 'resultado') return;
  J.ronda++;
  if (J.ronda < RONDAS) ronda(); else final();
}
const total = () => J.puntos.reduce((a, b) => a + b, 0);
function final() {
  J.fase = 'final';
  acomodar(); mostrar('resultado', false);
  const t = total();
  $('fin-titulo').textContent = MODOS[J.modo];
  $('fin-total').textContent = fmt(t);
  $('fin-de').textContent = `de ${fmt(MAX * RONDAS)} puntos`;
  $('fin-barra').style.width = `${(100 * t) / (MAX * RONDAS)}%`;
  $('fin-msg').textContent = MENSAJES_FIN[rango(t / RONDAS)];
  $('fin-rondas').innerHTML = '';
  J.historial.forEach((h, k) => {
    const li = document.createElement('li');
    li.innerHTML = `<span class="num"></span><span class="nom"><span></span><small></small></span><span class="pts"></span>`;
    li.querySelector('.num').textContent = k + 1;
    li.querySelector('.num').style.background = `var(--r${rango(h.pts)})`;
    if (rango(h.pts) === 0) li.querySelector('.num').style.color = '#fbf3e2';
    li.querySelector('.nom span').textContent = h.lugar.nombre;
    li.querySelector('small').textContent = 'Tu pin quedó ' + fmtDist(h.d) + (h.pista ? ' · con pista' : '');
    li.querySelector('.pts').textContent = fmt(h.pts);
    $('fin-rondas').append(li);
  });
  $('copiado').textContent = '';
  mostrar('final');
  // El mapa muestra las 5 rondas en el espacio que deja la tarjeta (a la izquierda en compu, abajo en teléfono)
  grande.rangoZoom(null, 3);
  const c = $('final').getBoundingClientRect(), tel = esTel();
  verEntre(J.historial.flatMap((h) => [h.pin, h.lugar]),
    tel ? { x0: 0, x1: innerWidth, y0: 10, y1: c.top - 10 } : { x0: c.right + 10, x1: innerWidth - 10, y0: 10, y1: innerHeight - 10 });
  tono(523); tono(659, 0.12, 0.12); tono(784, 0.12, 0.24); tono(1047, 0.25, 0.36);
}
/** Texto para compartir (sin servidor): modo, nivel, un cuadrito de color por ronda, total y el enlace al juego en ese nivel */
function textoCompartir() {
  const enlace = new URL(`juego.html?nivel=${J.nivel}`, location.href).href;
  return `Tiny San Juan del Río · ${MODOS[J.modo]}\nNivel ${NIVELES[J.nivel].leyenda}\n`
    + `${J.puntos.map((p) => CUADROS[rango(p)]).join('')} ${fmt(total())} / ${fmt(MAX * RONDAS)}\n¿Me ganas? ${enlace}`;
}
$('adivinar').onclick = adivinar;
$('siguiente').onclick = siguiente;
$('salir').onclick = abrirMenu;
$('fin-otra').onclick = () => empezar(J.modo);
$('fin-menu').onclick = abrirMenu;
$('fin-compartir').onclick = async () => {
  const texto = textoCompartir();
  // Teléfono: menú de compartir del sistema. Compu: se copia. Si nada de eso se puede, se muestra el texto para copiarlo a mano.
  if (navigator.share && esTel()) { try { await navigator.share({ text: texto }); return; } catch (e) { if (e.name === 'AbortError') return; } }
  try { await navigator.clipboard.writeText(texto); $('copiado').textContent = '¡Copiado! Pégalo donde quieras:\n' + texto; }
  catch { $('copiado').textContent = 'Cópialo y pégalo donde quieras:\n' + texto; }
};

// Botones de zoom
$('c-mas').onclick = () => grande.acercar(1.5);
$('c-menos').onclick = () => grande.acercar(1 / 1.5);
$('c-inicio').onclick = () => grande.ciudad();
$('c-pantalla').onclick = () => (document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen?.());

// Teclado: Espacio adivina o pasa de ronda; Esc sale al menú
addEventListener('keydown', (e) => {
  if (e.code === 'Space') { e.preventDefault(); if (J.fase === 'jugando') adivinar(); else if (J.fase === 'resultado') siguiente(); }
  if (e.code === 'KeyM') abrirMapa();
  if (e.code === 'Escape') { if (J.fase === 'menu') location.href = './index.html'; else abrirMenu(); }
});

// El enlace de Compartir abre el menú con el nivel de quien lo mandó (?nivel=V1)
const nivelURL = new URLSearchParams(location.search).get('nivel');
elegirNivel(NIVELES[nivelURL] ? nivelURL : 'V0');
abrirMenu();
window.__juego = { J, grande, chico, datos, puntaje, catalogo, textoCompartir };
