// Rejilla de teselas de TODA la ciudad, en el espacio de pantalla de la cámara fija.
// Lo usan el renderizador (navegador) y los scripts (Node): una sola regla para todos.
//
// Coordenadas de mundo: x = este, y = arriba, z = -norte (metros desde el origen UTM de config.json).
// Coordenadas de pantalla (pixeles a resolución nativa): u hacia la derecha, v hacia abajo,
// con (0, 0) en el origen de la ciudad. La tesela (0, 0) tiene el origen en su CENTRO.

export function camaraFija(cfg) {
  const C = cfg.camara, rad = Math.PI / 180;
  const el = C.elevacion_grados * rad, az = C.azimut_grados * rad;
  // d: del objetivo hacia la cámara
  const d = [Math.sin(az) * Math.cos(el), Math.sin(el), -Math.cos(az) * Math.cos(el)];
  // derecha = arriba × d ; arriba_pantalla = d × derecha  (igual que lookAt de three.js)
  let R = [d[2], 0, -d[0]]; const n = Math.hypot(...R); R = R.map((v) => v / n);
  const U = [d[1] * R[2] - d[2] * R[1], d[2] * R[0] - d[0] * R[2], d[0] * R[1] - d[1] * R[0]];
  return { d, R, U, mpp: C.metros_por_pixel, T: cfg.tesela.tamano_px };
}

const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

/** Punto del mundo [x, y, z] → pixel de pantalla {u, v} a resolución nativa */
export function aPantalla(cam, p) {
  return { u: dot(p, cam.R) / cam.mpp, v: -dot(p, cam.U) / cam.mpp };
}

/** Pixel de pantalla → tesela {i, j} que lo contiene */
export function teselaDe(cam, { u, v }) {
  return { i: Math.floor((u + cam.T / 2) / cam.T), j: Math.floor((v + cam.T / 2) / cam.T) };
}

/** Límites del frustum ortográfico (en metros, relativos al origen) de la tesela (i, j) */
export function frustumTesela(cam, i, j) {
  const T = cam.T, m = cam.mpp;
  const u0 = i * T - T / 2, v0 = j * T - T / 2;
  return { left: u0 * m, right: (u0 + T) * m, top: -v0 * m, bottom: -(v0 + T) * m };
}

/** Nombre de archivo estándar de una tesela */
export const nombreTesela = (i, j) => `${i}_${j}`;
