// Relieve del terreno (Fase 3c). Lo usan el script que lo calcula (Node) y la escena 3D (navegador).
//
// El relieve de una zona es una malla regular de alturas (esc.relieve):
//   { x0, n0, paso, nx, ny, h: [ny·nx alturas, fila por fila] }   en metros de la rejilla de la ciudad,
// con la altura relativa a la Plaza (la Plaza = 0). Los nodos caen en múltiplos de "paso" desde el origen
// de la ciudad, así dos zonas vecinas comparten exactamente los mismos nodos en su borde y el suelo embona.
//
// Entre nodos el suelo es plano por triángulos: cada celda se parte en dos por la diagonal (i, j)–(i+1, j+1).
// Todo lo que se asienta (suelo, calles, árboles, casas) usa esta misma regla, así nada flota ni se hunde.

const sub = (rel, i, j) => rel.h[Math.min(rel.ny - 1, Math.max(0, j)) * rel.nx + Math.min(rel.nx - 1, Math.max(0, i))];

/** Celda (i, j) y coordenadas locales (fx, fy ∈ [0, 1]) del punto (x, n) */
function celda(rel, x, n) {
  const gx = (x - rel.x0) / rel.paso, gy = (n - rel.n0) / rel.paso;
  const i = Math.min(rel.nx - 2, Math.max(0, Math.floor(gx))), j = Math.min(rel.ny - 2, Math.max(0, Math.floor(gy)));
  return { i, j, fx: Math.min(1, Math.max(0, gx - i)), fy: Math.min(1, Math.max(0, gy - j)) };
}

/** Pesos de los 3 nodos del triángulo de la celda que contiene el punto */
function pesos(c) {
  const { i, j, fx, fy } = c;
  // triángulo de abajo: (i,j) (i+1,j) (i+1,j+1) si fx ≥ fy; de arriba: (i,j) (i+1,j+1) (i,j+1)
  return fx >= fy
    ? [[i, j, 1 - fx], [i + 1, j, fx - fy], [i + 1, j + 1, fy]]
    : [[i, j, 1 - fy], [i + 1, j + 1, fx], [i, j + 1, fy - fx]];
}

/** Altura del suelo (m, relativa a la Plaza) en el punto (x, n). Sin relieve: 0 */
export function alturaRelieve(rel, x, n) {
  if (!rel) return 0;
  let y = 0;
  for (const [i, j, w] of pesos(celda(rel, x, n))) y += w * sub(rel, i, j);
  return y;
}

/** Normal suave del suelo en (x, n) para el sombreado: [x, y, z] del mundo (z = −norte) */
export function normalRelieve(rel, x, n) {
  if (!rel) return [0, 1, 0];
  rel._nrm ??= nodosNormales(rel);
  let a = 0, b = 0, c = 0;
  for (const [i, j, w] of pesos(celda(rel, x, n))) { const k = 3 * (j * rel.nx + i); a += w * rel._nrm[k]; b += w * rel._nrm[k + 1]; c += w * rel._nrm[k + 2]; }
  const L = Math.hypot(a, b, c) || 1;
  return [a / L, b / L, c / L];
}
function nodosNormales(rel) {
  const out = new Float32Array(3 * rel.nx * rel.ny), d = 2 * rel.paso;
  for (let j = 0; j < rel.ny; j++) for (let i = 0; i < rel.nx; i++) {
    const hx = (sub(rel, i + 1, j) - sub(rel, i - 1, j)) / d, hn = (sub(rel, i, j + 1) - sub(rel, i, j - 1)) / d;
    const L = Math.hypot(hx, 1, hn), k = 3 * (j * rel.nx + i);
    out[k] = -hx / L; out[k + 1] = 1 / L; out[k + 2] = hn / L; // normal de la superficie (x, h, −n)
  }
  return out;
}

// Recorta el polígono convexo P (lista de [x, n]) con el semiplano a·x + b·n + c ≥ 0 (Sutherland–Hodgman)
function cortar(P, a, b, c) {
  const out = [];
  for (let k = 0; k < P.length; k++) {
    const p = P[k], q = P[(k + 1) % P.length];
    const dp = a * p[0] + b * p[1] + c, dq = a * q[0] + b * q[1] + c;
    if (dp >= 0) out.push(p);
    if ((dp >= 0) !== (dq >= 0)) { const t = dp / (dp - dq); out.push([p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t]); }
  }
  return out;
}
// Semiplano "a la izquierda" de la arista p→q (para un triángulo en sentido antihorario)
const lado = (p, q) => { const a = -(q[1] - p[1]), b = q[0] - p[0]; return [a, b, -(a * p[0] + b * p[1])]; };

/**
 * Asienta un triángulo plano (en [x, n], sentido antihorario) sobre el relieve: lo parte en pedazos que caen
 * cada uno dentro de un solo triángulo de la malla, donde el suelo es plano, así el pedazo queda pegado al suelo.
 * Llama a emitir(a, b, c) con cada triángulo resultante (mismo sentido de giro que el original).
 */
export function asentarTriangulo(rel, tri, emitir) {
  const xs = tri.map((p) => p[0]), ns = tri.map((p) => p[1]);
  const i0 = Math.max(0, Math.floor((Math.min(...xs) - rel.x0) / rel.paso)), i1 = Math.min(rel.nx - 2, Math.floor((Math.max(...xs) - rel.x0) / rel.paso));
  const j0 = Math.max(0, Math.floor((Math.min(...ns) - rel.n0) / rel.paso)), j1 = Math.min(rel.ny - 2, Math.floor((Math.max(...ns) - rel.n0) / rel.paso));
  if (i0 > i1 || j0 > j1) { emitir(...tri); return; } // fuera de la malla: tal cual (altura del borde)
  for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
    const X0 = rel.x0 + i * rel.paso, X1 = X0 + rel.paso, N0 = rel.n0 + j * rel.paso, N1 = N0 + rel.paso;
    for (const g of [[[X0, N0], [X1, N0], [X1, N1]], [[X0, N0], [X1, N1], [X0, N1]]]) {
      let P = tri;
      for (let k = 0; k < 3 && P.length >= 3; k++) P = cortar(P, ...lado(g[k], g[(k + 1) % 3]));
      if (P.length < 3) continue;
      for (let k = 1; k < P.length - 1; k++) emitir(P[0], P[k], P[k + 1]);
    }
  }
}

// ---------- Cañada del río sobre el relieve (3c.2) ----------
// El CEM de 15 m ya trae una parte de la cañada, suavizada. Para no hundirla dos veces, dentro de la cañada el suelo
// no toma el CEM: toma la altura de sus dos orillas (interpolada de una a otra) y a eso se le resta el perfil de la
// cañada (0 en la orilla, −profundidad en el cauce). Fuera de la cañada, el relieve tal cual.

/** Tramos del río de una escena (los propios y los de zonas vecinas) con su semiancho por punto */
export function tramosRio(rio) {
  if (!rio) return [];
  const propios = (rio.tramos ?? [{ linea: rio.linea, normales: rio.normales }]).map((t) => ({ ...t, semiancho: t.semiancho ?? t.linea.map(() => rio.semiancho_m) }));
  return [...propios, ...(rio.ajenos ?? []).map((t) => ({ ...t, semiancho: t.semiancho ?? t.linea.map(() => rio.semiancho_m) }))];
}

/** Perfil de la cañada: 0 en la orilla, −profundidad en el cauce (curva coseno) */
export function perfilCanada(rio, d, w) {
  const a = rio.ancho_agua_m / 2;
  if (d <= a) return -rio.profundidad_m;
  if (d >= w) return 0;
  const t = (d - a) / (w - a);
  return -rio.profundidad_m * 0.5 * (1 + Math.cos(Math.PI * t));
}

/**
 * Suelo de una zona: relieve + cañada. Devuelve
 *   base(x, n)   suelo sin el hueco de la cañada (ahí van calles, parques y casas, igual que antes iban a 0)
 *   total(x, n)  suelo con la cañada (ahí van árboles, agua y el fondo bajo los puentes)
 *   seccion(c, nrm, w) alturas de las dos orillas de una sección transversal [izquierda, derecha]
 */
export function crearSuelo(rel, rio, tramos = tramosRio(rio)) {
  const h = (x, n) => alturaRelieve(rel, x, n);
  if (!rio || !tramos.length) return { base: h, total: h, seccion: (c) => [h(...c), h(...c)], rio: null };
  // Índice por celdas de 64 m: cada segmento se anota en las celdas que toca su cañada
  const C = 64, celdas = new Map(), segs = [];
  for (const tr of tramos) for (let i = 0; i < tr.linea.length - 1; i++) {
    const [ax, an] = tr.linea[i], [bx, bn] = tr.linea[i + 1], w = Math.max(tr.semiancho[i], tr.semiancho[i + 1]);
    const s = { tr, i }; segs.push(s);
    for (let cx = Math.floor((Math.min(ax, bx) - w) / C); cx <= Math.floor((Math.max(ax, bx) + w) / C); cx++)
      for (let cn = Math.floor((Math.min(an, bn) - w) / C); cn <= Math.floor((Math.max(an, bn) + w) / C); cn++) {
        const k = cx + ',' + cn; if (!celdas.has(k)) celdas.set(k, []); celdas.get(k).push(s);
      }
  }
  const seccion = (c, nrm, w) => [h(c[0] - nrm[0] * w, c[1] - nrm[1] * w), h(c[0] + nrm[0] * w, c[1] + nrm[1] * w)];
  // Punto más cercano del río: distancia, lado (con signo) y semiancho
  function cerca(x, n) {
    const lista = celdas.get(Math.floor(x / C) + ',' + Math.floor(n / C));
    if (!lista) return null;
    let best = null;
    for (const { tr, i } of lista) {
      const [ax, an] = tr.linea[i], [bx, bn] = tr.linea[i + 1], dx = bx - ax, dn = bn - an, L2 = dx * dx + dn * dn || 1;
      const t = Math.max(0, Math.min(1, ((x - ax) * dx + (n - an) * dn) / L2));
      const cx = ax + t * dx, cn = an + t * dn, d = Math.hypot(x - cx, n - cn);
      if (!best || d < best.d) best = { d, tr, i, t, c: [cx, cn] };
    }
    if (!best) return null;
    const { tr, i, t } = best, w = tr.semiancho[i] + (tr.semiancho[i + 1] - tr.semiancho[i]) * t;
    if (best.d >= w) return null;
    let nx = tr.normales[i][0] * (1 - t) + tr.normales[i + 1][0] * t, nn = tr.normales[i][1] * (1 - t) + tr.normales[i + 1][1] * t;
    const L = Math.hypot(nx, nn) || 1; nx /= L; nn /= L;
    const o = Math.max(-w, Math.min(w, (x - best.c[0]) * nx + (n - best.c[1]) * nn));
    return { d: best.d, w, o, c: best.c, nrm: [nx, nn] };
  }
  const base = (x, n) => {
    const r = cerca(x, n); if (!r) return h(x, n);
    const [hi, hd] = seccion(r.c, r.nrm, r.w);
    return hi + (hd - hi) * (r.o + r.w) / (2 * r.w);
  };
  const total = (x, n) => {
    const r = cerca(x, n); if (!r) return h(x, n);
    const [hi, hd] = seccion(r.c, r.nrm, r.w);
    return hi + (hd - hi) * (r.o + r.w) / (2 * r.w) + perfilCanada(rio, r.d, r.w);
  };
  return { base, total, seccion, rio };
}

// ---------- Relieve de toda la ciudad para el juego y los pines (3c.2) ----------
// web/relieve-ciudad.bin: alturas del suelo (con cañadas) en decímetros, Int16, fila por fila desde el suroeste;
// web/relieve-ciudad.json: { x0, n0, paso, nx, ny, decimetros: true }.

/** Altura del suelo (m) en (x, n) leyendo la malla de la ciudad (bilineal). Fuera de la malla: 0 */
export function alturaCiudad(m, x, n) {
  if (!m) return 0;
  const gx = (x - m.x0) / m.paso, gy = (n - m.n0) / m.paso;
  if (gx < 0 || gy < 0 || gx > m.nx - 1 || gy > m.ny - 1) return 0;
  const i = Math.min(m.nx - 2, Math.floor(gx)), j = Math.min(m.ny - 2, Math.floor(gy)), fx = gx - i, fy = gy - j;
  const v = (a, b) => m.h[b * m.nx + a] / 10;
  return v(i, j) * (1 - fx) * (1 - fy) + v(i + 1, j) * fx * (1 - fy) + v(i, j + 1) * (1 - fx) * fy + v(i + 1, j + 1) * fx * fy;
}
