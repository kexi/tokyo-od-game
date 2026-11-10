/**
 * A small dense convex QP solver: minimise ½xᵀPx + qᵀx subject to l ≤ Ax ≤ u, by the ADMM splitting
 * OSQP uses (Stellato et al. 2020) with ρ adaptation. The vertical alignment problems are a few
 * hundred variables, so dense Cholesky is simpler than sparse and fast enough at build time.
 *
 * Why not an active-set or simplex method: ADMM handles equality rows (l = u) and bounds the same
 * way, never cycles, and its result is checked against the exact constraints afterwards anyway
 * (vertical.ts), so its modest accuracy only has to beat the margins the caller leaves.
 */

export type Qp = {
  n: number;
  /** n×n, row-major, symmetric positive semidefinite. */
  P: Float64Array;
  q: Float64Array;
  /** Constraint rows: each a sparse list of [column, coefficient]. */
  rows: Array<Array<[number, number]>>;
  l: Float64Array;
  u: Float64Array;
};

export type QpResult = { x: Float64Array; iterations: number; primalResidual: number; dualResidual: number };

function cholesky(n: number, K: Float64Array): void {
  for (let j = 0; j < n; j++) {
    let d = K[j * n + j];
    for (let k = 0; k < j; k++) d -= K[j * n + k] ** 2;
    d = Math.sqrt(Math.max(d, 1e-300));
    K[j * n + j] = d;
    for (let i = j + 1; i < n; i++) {
      let s = K[i * n + j];
      for (let k = 0; k < j; k++) s -= K[i * n + k] * K[j * n + k];
      K[i * n + j] = s / d;
    }
  }
}

function cholSolve(n: number, L: Float64Array, b: Float64Array): void {
  for (let i = 0; i < n; i++) {
    let s = b[i];
    for (let k = 0; k < i; k++) s -= L[i * n + k] * b[k];
    b[i] = s / L[i * n + i];
  }
  for (let i = n - 1; i >= 0; i--) {
    let s = b[i];
    for (let k = i + 1; k < n; k++) s -= L[k * n + i] * b[k];
    b[i] = s / L[i * n + i];
  }
}

const SIGMA = 1e-6;
const ALPHA = 1.6;

export function solveQp(qp: Qp, maxIter = 20000, eps = 1e-9): QpResult {
  const { n, P, q, rows, l, u } = qp;
  const m = rows.length;
  const isEq = rows.map((_, i) => u[i] - l[i] < 1e-12);
  let rhoBase = 0.1;
  const rho = new Float64Array(m);
  const K = new Float64Array(n * n);
  const factor = () => {
    for (let i = 0; i < m; i++) rho[i] = isEq[i] ? rhoBase * 1e3 : rhoBase;
    K.set(P);
    for (let i = 0; i < n; i++) K[i * n + i] += SIGMA;
    for (let r = 0; r < m; r++) {
      const row = rows[r];
      for (const [a, va] of row) for (const [b, vb] of row) K[a * n + b] += rho[r] * va * vb;
    }
    cholesky(n, K);
  };
  factor();
  const x = new Float64Array(n);
  const z = new Float64Array(m);
  const y = new Float64Array(m);
  const xt = new Float64Array(n);
  const zt = new Float64Array(m);
  const ax = (v: Float64Array, out: Float64Array) => {
    for (let r = 0; r < m; r++) {
      let s = 0;
      for (const [c, a] of rows[r]) s += a * v[c];
      out[r] = s;
    }
  };
  let primal = Infinity;
  let dual = Infinity;
  let iter = 0;
  const axv = new Float64Array(m);
  for (; iter < maxIter; iter++) {
    for (let i = 0; i < n; i++) xt[i] = SIGMA * x[i] - q[i];
    for (let r = 0; r < m; r++) {
      const w = rho[r] * z[r] - y[r];
      for (const [c, a] of rows[r]) xt[c] += a * w;
    }
    cholSolve(n, K, xt);
    ax(xt, zt);
    for (let i = 0; i < n; i++) x[i] = ALPHA * xt[i] + (1 - ALPHA) * x[i];
    for (let r = 0; r < m; r++) {
      const zr = ALPHA * zt[r] + (1 - ALPHA) * z[r];
      const zn = Math.min(u[r], Math.max(l[r], zr + y[r] / rho[r]));
      y[r] += rho[r] * (zr - zn);
      z[r] = zn;
    }
    const isCheck = iter % 25 === 24;
    if (!isCheck) continue;
    ax(x, axv);
    let pr = 0;
    let scaleP = 1e-12;
    for (let r = 0; r < m; r++) {
      pr = Math.max(pr, Math.abs(axv[r] - z[r]));
      scaleP = Math.max(scaleP, Math.abs(axv[r]), Math.abs(z[r]));
    }
    const grad = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      let s = q[i];
      for (let j = 0; j < n; j++) s += P[i * n + j] * x[j];
      grad[i] = s;
    }
    for (let r = 0; r < m; r++) for (const [c, a] of rows[r]) grad[c] += a * y[r];
    let du = 0;
    for (let i = 0; i < n; i++) du = Math.max(du, Math.abs(grad[i]));
    primal = pr;
    dual = du;
    const isDone = pr <= eps * (1 + scaleP) && du <= eps * 1e3;
    if (isDone) break;
    // An infeasible problem keeps a primal residual of the size of the gap; stop wasting time on it
    // (the caller checks the exact constraints and falls back anyway).
    const isHopeless = iter > 4000 && pr > 1e-4 * (1 + scaleP);
    if (isHopeless) break;
    const isAdapt = iter % 200 === 199;
    if (!isAdapt) continue;
    const ratio = Math.sqrt(pr / scaleP / Math.max(du, 1e-300));
    const isFar = ratio > 5 || ratio < 0.2;
    if (!isFar) continue;
    const next = Math.min(1e6, Math.max(1e-6, rhoBase * ratio));
    // y stays in the original units: changing ρ only changes the step, so it carries over.
    rhoBase = next;
    factor();
  }
  return { x, iterations: iter, primalResidual: primal, dualResidual: dual };
}
