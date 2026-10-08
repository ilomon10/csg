// Tiny deterministic SDF ray-marcher used to draw ORIGINAL placeholder sprites
// for the website until the real export pipeline (spec 005) can produce them.
// It mimics the product idea on purpose: modular 3D parts -> orthographic
// camera -> toon bands + outline -> small pixel frames. No randomness, no clock.

// ---------- vector helpers ----------
const len3 = (x, y, z) => Math.sqrt(x * x + y * y + z * z);
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

function sdSphere(x, y, z, r) {
  return len3(x, y, z) - r;
}
function sdEllipsoid(x, y, z, rx, ry, rz) {
  const k0 = len3(x / rx, y / ry, z / rz);
  const k1 = len3(x / (rx * rx), y / (ry * ry), z / (rz * rz));
  return k1 === 0 ? -Math.min(rx, ry, rz) : (k0 * (k0 - 1)) / k1;
}
function sdRoundBox(x, y, z, bx, by, bz, r) {
  const qx = Math.abs(x) - bx + r;
  const qy = Math.abs(y) - by + r;
  const qz = Math.abs(z) - bz + r;
  return (
    len3(Math.max(qx, 0), Math.max(qy, 0), Math.max(qz, 0)) +
    Math.min(Math.max(qx, qy, qz), 0) -
    r
  );
}
function sdCapsule(x, y, z, ax, ay, az, bx, by, bz, r) {
  const pax = x - ax;
  const pay = y - ay;
  const paz = z - az;
  const bax = bx - ax;
  const bay = by - ay;
  const baz = bz - az;
  const h = clamp(
    (pax * bax + pay * bay + paz * baz) / (bax * bax + bay * bay + baz * baz),
    0,
    1,
  );
  return len3(pax - bax * h, pay - bay * h, paz - baz * h) - r;
}
function sdTorus(x, y, z, R, r) {
  const q = Math.sqrt(x * x + z * z) - R;
  return Math.sqrt(q * q + y * y) - r;
}
// Capped cone along +y from y=0 (radius r1) to y=h (radius r2).
function sdCone(x, y, z, h, r1, r2) {
  const qx = Math.sqrt(x * x + z * z);
  const qy = y - h / 2;
  const hh = h / 2;
  const k1x = r2;
  const k1y = hh;
  const k2x = r2 - r1;
  const k2y = 2 * hh;
  const cax = qx - Math.min(qx, qy < 0 ? r1 : r2);
  const cay = Math.abs(qy) - hh;
  const t = clamp(
    ((k1x - qx) * k2x + (k1y - qy) * k2y) / (k2x * k2x + k2y * k2y),
    0,
    1,
  );
  const cbx = qx - k1x + k2x * t;
  const cby = qy - k1y + k2y * t;
  const s = cbx < 0 && cay < 0 ? -1 : 1;
  return s * Math.sqrt(Math.min(cax * cax + cay * cay, cbx * cbx + cby * cby));
}
// Rotate (y, z) about the x axis by angle a (used for limb swing).
function rotX(y, z, a) {
  const c = Math.cos(a);
  const s = Math.sin(a);
  return [y * c - z * s, y * s + z * c];
}

// ---------- character model ----------
/**
 * @typedef {{
 *   kind?: 'human' | 'robot',
 *   head?: number, legs?: number, torso?: number,
 *   hat?: 'none' | 'wizard' | 'helm',
 *   backpack?: boolean, scarf?: boolean, cape?: boolean,
 *   explode?: number,
 * }} Build
 */

/**
 * Builds the part list for one pose. Each part: {mat, d(x,y,z)} in local space,
 * +z is the character's forward, +y up, feet near y=0.
 * @param {Build} b
 * @param {number} phase walk phase in radians
 */
export function buildCharacter(b, phase) {
  const kind = b.kind ?? 'human';
  const L = b.legs ?? 9;
  const T = b.torso ?? 6;
  const hs = b.head ?? 1;
  const ex = b.explode ?? 0;
  const swing = 0.55 * Math.sin(phase);
  const bob = 0.7 * Math.cos(2 * phase);
  const hipY = 3.1 + L + bob;
  const neckY = hipY + 2 * T - 0.2;
  const shoulderY = neckY - 2.2;
  const armLen = 6.6 + L * 0.18;
  const R = 8.2 * hs;
  const headY = neckY + R * 0.92;
  const parts = [];
  const add = (mat, off, d) =>
    parts.push({
      mat,
      d: (x, y, z) => d(x - off[0] * ex, y - off[1] * ex, z - off[2] * ex),
    });

  const robot = kind === 'robot';
  for (const side of [-1, 1]) {
    const a = side * swing;
    const hx = side * 2.8;
    // Leg + boot share one swing transform around the hip.
    add(robot ? 'metal' : 'pants', [side * 3, -4, 0], (x, y, z) => {
      const [ly, lz] = rotX(y - hipY, z, a);
      return sdCapsule(x - hx, ly, lz, 0, 0, 0, 0, -L, 0, robot ? 2.1 : 2.3);
    });
    add(robot ? 'dark' : 'boots', [side * 3, -6, 0], (x, y, z) => {
      const [ly, lz] = rotX(y - hipY, z, a);
      return sdRoundBox(x - hx, ly + L + 0.6, lz - 0.9, 2.5, 1.7, 3.2, 0.9);
    });
    // Arm swings opposite to the leg on the same side.
    const sx = side * (5.2 + 1.3 * Math.min(1, T / 6));
    add(robot ? 'metal' : 'tunic', [side * 6, 0, 0], (x, y, z) => {
      const [ly, lz] = rotX(y - shoulderY, z, -a * 0.75);
      return sdCapsule(x - sx, ly, lz, 0, 0, 0, side * 0.9, -armLen, 0, 1.9);
    });
    add(robot ? 'dark' : 'skin', [side * 7, -1, 0], (x, y, z) => {
      const [ly, lz] = rotX(y - shoulderY, z, -a * 0.75);
      return sdSphere(x - sx - side * 0.9, ly + armLen + 0.6, lz, 2.2);
    });
  }
  const torsoMid = hipY + T - 0.6;
  if (robot) {
    add('metal', [0, 0, 0], (x, y, z) =>
      sdRoundBox(x, y - torsoMid, z, 5.4, T, 3.8, 1.6),
    );
    add('accent', [0, 0, 3], (x, y, z) =>
      sdRoundBox(x, y - torsoMid - 1, z - 3.6, 2.4, 1.6, 0.6, 0.4),
    );
    add('metal', [0, 5, 0], (x, y, z) =>
      sdRoundBox(x, y - headY, z, 7.2 * hs, 6.2 * hs, 6.4 * hs, 2.2),
    );
    add('accent', [0, 5, 3], (x, y, z) =>
      sdRoundBox(x, y - headY - 0.5, z - 6.1 * hs, 5 * hs, 1.6, 0.8, 0.6),
    );
    add('dark', [0, 9, 0], (x, y, z) =>
      sdCapsule(x, y, z, 0, headY + 6 * hs, 0, 0, headY + 10 * hs, 0, 0.7),
    );
    add('accent', [0, 10, 0], (x, y, z) =>
      sdSphere(x, y - headY - 10.6 * hs, z, 1.5),
    );
    return parts;
  }

  add('tunic', [0, 0, 0], (x, y, z) =>
    sdRoundBox(x, y - torsoMid, z, 5.1, T, 3.5, 2.4),
  );
  add('belt', [0, -1, 2], (x, y, z) =>
    sdRoundBox(x, y - (hipY + 1.2), z, 5.6, 0.9, 3.9, 0.6),
  );
  add('skin', [0, 6, 0], (x, y, z) =>
    sdEllipsoid(x, y - headY, z - 0.3, R * 1.05, R, R),
  );
  add('eye', [0, 6, 1], (x, y, z) =>
    Math.min(
      sdSphere(x - 3 * hs, y - (headY - 0.2 * hs), z - (R - 0.4), 1.2),
      sdSphere(x + 3 * hs, y - (headY - 0.2 * hs), z - (R - 0.4), 1.2),
    ),
  );
  const hat = b.hat ?? 'none';
  if (hat !== 'helm') {
    add('hair', [0, 9, -1], (x, y, z) => {
      const ly = y - headY;
      const shell = sdSphere(x, ly - 1.1 * hs, z + 0.9, R * 1.07);
      const cut = 0.4 * hs + 0.5 * z - ly;
      return Math.max(shell, cut);
    });
  } else {
    add('metal', [0, 9, 0], (x, y, z) => {
      const ly = y - headY;
      const shell = sdSphere(x, ly - 0.8, z + 0.3, R * 1.12);
      const cut = 0.4 * hs + 0.1 * z - ly;
      return Math.max(shell, cut);
    });
    add('metal', [0, 9, 2], (x, y, z) =>
      sdRoundBox(x, y - headY + 1.5, z - R - 0.2, 0.8, 3, 0.8, 0.4),
    );
  }
  if (hat === 'wizard') {
    add('hat', [0, 13, 0], (x, y, z) =>
      sdTorus(x, y - headY - 4.2 * hs, z + 0.5, R * 1.05, 1.1),
    );
    add('hat', [0, 15, 0], (x, y, z) => {
      const [ly, lz] = rotX(y - headY - 4 * hs, z + 0.5, 0.35);
      return sdCone(x, ly, lz, 12, R * 0.95, 0.6);
    });
  }
  if (b.scarf !== false) {
    add('accent', [0, 2, 0], (x, y, z) =>
      sdTorus(x, y - (neckY + 0.4), z, 4.2, 1.7),
    );
    add('accent', [0, 2, -3], (x, y, z) =>
      sdCapsule(
        x,
        y,
        z,
        1.6,
        neckY,
        -3.4,
        2.9 + 0.4 * Math.sin(phase),
        neckY - 5.5,
        -5.1,
        1.25,
      ),
    );
  }
  if (b.backpack) {
    add('belt', [0, 0, -6], (x, y, z) =>
      sdRoundBox(x, y - (torsoMid + 0.8), z + 4.7, 3.7, 4.3, 1.9, 1.2),
    );
  }
  if (b.cape) {
    add('accent', [0, 0, -6], (x, y, z) => {
      const top = neckY - 0.5;
      const ly = y - top;
      const zz = z + 4 + 0.12 * -ly + 0.5 * Math.sin(phase + ly * 0.3);
      const half = 5.4 - 0.1 * ly;
      return sdRoundBox(x, ly + 7.5, zz, half, 7.8, 0.7, 0.5);
    });
  }
  return parts;
}

// ---------- palettes ----------
const hex = h => [
  parseInt(h.slice(1, 3), 16),
  parseInt(h.slice(3, 5), 16),
  parseInt(h.slice(5, 7), 16),
];
/** Each material: [light, mid, shadow]. */
export const BASE_PALETTE = {
  skin: ['#f4cba4', '#dc9e76', '#a9654b'],
  hair: ['#7a4630', '#56301f', '#331b14'],
  tunic: ['#5b8fbf', '#3f6894', '#2a4568'],
  pants: ['#58506a', '#3e384c', '#2a2533'],
  boots: ['#93613f', '#6f462c', '#48291b'],
  belt: ['#c4945a', '#986c3c', '#644626'],
  accent: ['#f39345', '#d2672d', '#994221'],
  eye: ['#2a2030', '#2a2030', '#2a2030'],
  metal: ['#c9ced6', '#929aa7', '#5e6573'],
  dark: ['#5a5f6b', '#3d414b', '#272a31'],
  hat: ['#6c5bb0', '#4d3f87', '#33295c'],
  outline: '#211b27',
};

/** @param {Record<string, string[] | string>} overrides */
export function palette(overrides = {}) {
  const merged = {...BASE_PALETTE, ...overrides};
  const out = {};
  for (const [k, v] of Object.entries(merged))
    out[k] = Array.isArray(v) ? v.map(hex) : hex(v);
  return out;
}

// ---------- rendering ----------
const LIGHT = (() => {
  const l = [-0.55, 0.75, 0.62];
  const n = len3(l[0], l[1], l[2]);
  return l.map(v => v / n);
})();

const DIRECTIONS = {
  S: 0,
  SW: -45,
  W: -90,
  NW: -135,
  N: 180,
  NE: 135,
  E: 90,
  SE: 45,
};
export const DIRECTION_ORDER = ['S', 'SW', 'W', 'NW', 'N', 'NE', 'E', 'SE'];

function sceneFn(parts, yawDeg) {
  // The camera faces -z; the character's forward (+z local) is rotated by yaw.
  const a = (yawDeg * Math.PI) / 180;
  const c = Math.cos(a);
  const s = Math.sin(a);
  return (x, y, z) => {
    // world -> local: rotate by -yaw around y.
    const lx = c * x - s * z;
    const lz = s * x + c * z;
    let best = Infinity;
    let mat = null;
    for (const p of parts) {
      const d = p.d(lx, y, lz);
      if (d < best) {
        best = d;
        mat = p.mat;
      }
    }
    return [best, mat];
  };
}

function march(scene, ox, oy, oz, dx, dy, dz) {
  let t = 0;
  for (let i = 0; i < 96; i++) {
    const x = ox + dx * t;
    const y = oy + dy * t;
    const z = oz + dz * t;
    const [d, mat] = scene(x, y, z);
    if (d < 0.02) return {t, x, y, z, mat};
    t += d;
    if (t > 260) break;
  }
  return null;
}

function normalAt(scene, x, y, z) {
  const e = 0.05;
  const nx = scene(x + e, y, z)[0] - scene(x - e, y, z)[0];
  const ny = scene(x, y + e, z)[0] - scene(x, y - e, z)[0];
  const nz = scene(x, y, z + e)[0] - scene(x, y, z - e)[0];
  const n = len3(nx, ny, nz) || 1;
  return [nx / n, ny / n, nz / n];
}

const BAYER4 = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5].map(
  v => (v + 0.5) / 16,
);

/**
 * Renders one pixel-art frame into `out` (RGBA) at (ox, oy).
 * @param {object} o
 */
export function renderPixelFrame(o) {
  const {
    build,
    phase = 0,
    direction = 'S',
    pitch = 30,
    cell = 64,
    scale = 1.2,
    pal,
    look = 'toon',
    outline = true,
    target = [0, 20, 0],
    out,
    outW,
    ox = 0,
    oy = 0,
  } = o;
  const parts = buildCharacter(build, phase);
  const scene = sceneFn(parts, DIRECTIONS[direction] ?? 0);
  const ph = (pitch * Math.PI) / 180;
  const fwd = [0, -Math.sin(ph), -Math.cos(ph)];
  const up = [0, Math.cos(ph), -Math.sin(ph)];
  const ids = new Array(cell * cell).fill(null);
  const depth = new Float32Array(cell * cell).fill(Infinity);
  const cols = new Array(cell * cell).fill(null);
  for (let py = 0; py < cell; py++) {
    for (let px = 0; px < cell; px++) {
      const u = (px + 0.5 - cell / 2) / scale;
      const v = (cell * 0.56 - (py + 0.5)) / scale;
      const sx = target[0] + u - fwd[0] * 120;
      const sy = target[1] + up[1] * v - fwd[1] * 120;
      const sz = target[2] + up[2] * v - fwd[2] * 120;
      const hit = march(scene, sx, sy, sz, fwd[0], fwd[1], fwd[2]);
      if (!hit) continue;
      const i = py * cell + px;
      const n = normalAt(scene, hit.x, hit.y, hit.z);
      const ndl = n[0] * LIGHT[0] + n[1] * LIGHT[1] + n[2] * LIGHT[2];
      const ramp = pal[hit.mat] ?? pal.skin;
      let band;
      if (look === 'dither') {
        const th = BAYER4[(py % 4) * 4 + (px % 4)];
        const k = clamp((ndl + 0.15) / 0.9, 0, 1);
        band = k > th ? 0 : 2;
        if (ndl > 0.62) band = 0;
      } else {
        band = ndl > 0.5 ? 0 : ndl > 0.02 ? 1 : 2;
      }
      ids[i] = hit.mat;
      depth[i] = hit.t;
      cols[i] = ramp[band];
    }
  }
  // Depth-edge lines inside the silhouette, then a 1px outer outline.
  const result = cols.slice();
  for (let py = 0; py < cell; py++) {
    for (let px = 0; px < cell; px++) {
      const i = py * cell + px;
      const nb = [
        [px - 1, py],
        [px + 1, py],
        [px, py - 1],
        [px, py + 1],
      ];
      if (ids[i] === null) {
        if (!outline) continue;
        for (const [nx, ny] of nb) {
          if (nx < 0 || ny < 0 || nx >= cell || ny >= cell) continue;
          if (ids[ny * cell + nx] !== null) {
            result[i] = pal.outline;
            break;
          }
        }
      } else if (outline) {
        for (const [nx, ny] of nb) {
          if (nx < 0 || ny < 0 || nx >= cell || ny >= cell) continue;
          const j = ny * cell + nx;
          if (ids[j] !== null && depth[i] - depth[j] > 3.2) {
            result[i] = (pal[ids[i]] ?? pal.skin)[2];
            if (ids[i] === ids[j]) result[i] = pal.outline;
            break;
          }
        }
      }
    }
  }
  for (let py = 0; py < cell; py++) {
    for (let px = 0; px < cell; px++) {
      const c = result[py * cell + px];
      if (!c) continue;
      const k = ((oy + py) * outW + ox + px) * 4;
      out[k] = c[0];
      out[k + 1] = c[1];
      out[k + 2] = c[2];
      out[k + 3] = 255;
    }
  }
}

/**
 * Smooth (pre-pixel) render, anti-aliased, for the "3D parts" illustrations.
 * @param {object} o
 */
export function renderSmooth(o) {
  const {
    build,
    phase = 0,
    direction = 'SE',
    pitch = 22,
    size = 256,
    scale = 4.6,
    pal,
    target = [0, 22, 0],
    out,
    outW,
    ox = 0,
    oy = 0,
    ss = 3,
  } = o;
  const parts = buildCharacter(build, phase);
  const scene = sceneFn(parts, DIRECTIONS[direction] ?? 0);
  const ph = (pitch * Math.PI) / 180;
  const fwd = [0, -Math.sin(ph), -Math.cos(ph)];
  const up = [0, Math.cos(ph), -Math.sin(ph)];
  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      let r = 0;
      let g = 0;
      let bl = 0;
      let cov = 0;
      for (let sy = 0; sy < ss; sy++) {
        for (let sx = 0; sx < ss; sx++) {
          const u = (px + (sx + 0.5) / ss - size / 2) / scale;
          const v = (size * 0.54 - (py + (sy + 0.5) / ss)) / scale;
          const ox3 = target[0] + u - fwd[0] * 120;
          const oy3 = target[1] + up[1] * v - fwd[1] * 120;
          const oz3 = target[2] + up[2] * v - fwd[2] * 120;
          const hit = march(scene, ox3, oy3, oz3, fwd[0], fwd[1], fwd[2]);
          if (!hit) continue;
          const n = normalAt(scene, hit.x, hit.y, hit.z);
          const ndl = Math.max(
            0,
            n[0] * LIGHT[0] + n[1] * LIGHT[1] + n[2] * LIGHT[2],
          );
          const base = (pal[hit.mat] ?? pal.skin)[1];
          const hemi = 0.5 + 0.5 * n[1];
          const k = 0.42 + 0.2 * hemi + 0.62 * ndl;
          r += Math.min(255, base[0] * k);
          g += Math.min(255, base[1] * k);
          bl += Math.min(255, base[2] * k);
          cov++;
        }
      }
      if (!cov) continue;
      const kk = ((oy + py) * outW + ox + px) * 4;
      out[kk] = Math.round(r / cov);
      out[kk + 1] = Math.round(g / cov);
      out[kk + 2] = Math.round(bl / cov);
      out[kk + 3] = Math.round((255 * cov) / (ss * ss));
    }
  }
}
