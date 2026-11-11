import { SparseLdl } from "./sparse";

/**
 * A sparse convex QP solver: minimise ½xᵀPx + qᵀx + Σ_r w_r · dist(a_r·x, [l_r, u_r]) where w_r is
 * ∞ for a hard row (l ≤ a·x ≤ u, or a·x = l when l = u) and finite for a soft one (an exact L1
 * penalty for leaving the box). Each finite side of a soft row gets an elastic variable e ≥ 0
 * (a·x ≥ l − e at cost w·e), so a problem whose clearances cannot all be met is still feasible and
 * its solution shows where they are not met.
 *
 * Primal-dual interior point (Mehrotra predictor-corrector) on the reduced Newton system
 * [P + AᵢᵀDAᵢ, Aₑᵀ; Aₑ, −δ]: inequality slacks, elastic variables and their multipliers are
 * eliminated side by side, so each iteration factorises one sparse quasi-definite matrix (sparse.ts:
 * an LDLᵀ in a fixed minimum-degree order, the symbolic work done once) and solves it twice.
 *
 * Why not ADMM (OSQP's splitting, tried first): on the joint vertical problems (a 70 km component of
 * 54 runs, ~3,000 variables and ~30,000 rows, almost an LP: the objective is weak next to the
 * clearances) it used up 40,000 iterations without converging; the interior point took 40–60
 * factorisations on the same components. It is not immune to conditioning: in the full build 13 of
 * 640 solves broke down (non-finite steps), so the result carries a `status` and the caller reports
 * anything but "converged". Pivots of the wrong sign are regularised and each solve is refined
 * (sparse.ts). Why not a dense Cholesky (P1): 3,000³ flops per solve.
 */

export type Qp = {
  n: number;
  /** P as summed entries of its upper triangle (key i·n + j, i ≤ j). */
  P: Map<number, number>;
  q: Float64Array;
  /** Constraint rows: each a sparse list of [column, coefficient], no column twice. */
  rows: Array<Array<[number, number]>>;
  l: Float64Array;
  u: Float64Array;
  /** Per row: Infinity for a hard row, else the L1 weight for leaving [l, u]. */
  w: Float64Array;
};

/**
 * converged: the residuals and the gap met the tolerances. max_iter: the iterations ran out.
 * broken: a step became non-finite; `x` is the last finite iterate, not a solution.
 */
export type QpStatus = "converged" | "max_iter" | "broken";

export type QpResult = {
  status: QpStatus;
  /** Pivots the last factorisation had to regularise (wrong sign or too small). */
  regularised: number;
  x: Float64Array;
  iterations: number;
  primalResidual: number;
  dualResidual: number;
  gap: number;
};

/** Accumulates a QP row by row. */
export class QpBuilder {
  /** Keyed a·KEY_STRIDE + b while n is still growing; build() re-keys with the final n. */
  private readonly entries = new Map<number, number>();
  private readonly q: number[] = [];
  private readonly rows: Array<Array<[number, number]>> = [];
  private readonly l: number[] = [];
  private readonly u: number[] = [];
  private readonly w: number[] = [];
  n = 0;

  addVars(count: number): number {
    const first = this.n;
    this.n += count;
    for (let i = 0; i < count; i++) this.q.push(0);
    return first;
  }

  /** Adds weight · (a·x − target)² / 2 to the objective. */
  addSquare(row: ReadonlyArray<readonly [number, number]>, target: number, weight: number): void {
    for (const [a, va] of row) {
      this.q[a] -= weight * va * target;
      for (const [b, vb] of row) {
        if (a > b) continue;
        // The upper triangle stores each symmetric entry once (a row has no repeated column).
        const k = a * KEY_STRIDE + b;
        this.entries.set(k, (this.entries.get(k) ?? 0) + weight * va * vb);
      }
    }
  }

  addRow(row: Array<[number, number]>, lo: number, hi: number, weight = Infinity): void {
    this.rows.push(row);
    this.l.push(lo);
    this.u.push(hi);
    this.w.push(weight);
  }

  build(): Qp {
    const P = new Map<number, number>();
    for (const [k, v] of this.entries) {
      const a = Math.floor(k / KEY_STRIDE);
      const b = k - a * KEY_STRIDE;
      P.set(a * this.n + b, v);
    }
    return {
      n: this.n,
      P,
      q: Float64Array.from(this.q),
      rows: this.rows,
      l: Float64Array.from(this.l),
      u: Float64Array.from(this.u),
      w: Float64Array.from(this.w),
    };
  }
}

const KEY_STRIDE = 1e7;
const DELTA_X = 1e-9;
const DELTA_Y = 1e-9;
/** Smallest pivot magnitude the factor accepts before regularising it. */
const PIVOT_DELTA = 1e-12;
/** Floor for slacks and multipliers in the scaling D (s/λ is 0/0 when both reach 0). */
const TINY = 1e-300;
const STEP_FRACTION = 0.99;

/** Stop when the residuals are below tol (primal, relative to the bounds; gap) and dualTol (relative to q). */
export type QpOptions = { maxIter?: number; tol?: number; dualTol?: number };

/**
 * The QP's constraints as the interior point sees them: hard equalities (with a multiplier each)
 * and one-sided "sides" σ(a·x − β) + e ≥ 0 for every finite bound of the other rows (e only on soft
 * rows), with the sparse structure of the reduced system.
 */
class Structure {
  readonly rowStart: Int32Array;
  readonly col: Int32Array;
  readonly val: Float64Array;
  readonly eqRows: number[] = [];
  readonly sideRow: number[] = [];
  readonly sideSig: number[] = [];
  readonly sideBeta: number[] = [];
  readonly sideW: number[] = [];
  readonly isSideRow: Uint8Array;
  readonly ldl: SparseLdl;
  readonly pi: Int32Array;
  readonly pj: Int32Array;
  readonly pv: Float64Array;
  private readonly pSlots: Int32Array;
  private readonly pairStart: Int32Array;
  private readonly pairSlot: Int32Array;
  private readonly pairCoef: Float64Array;
  private readonly eqSlot: Int32Array;
  private readonly xDiag: Int32Array;
  private readonly yDiag: Int32Array;
  private readonly diagonal: Float64Array;
  private readonly offdiag: Float64Array;
  private readonly rowD: Float64Array;
  /** Sign each pivot must have: + for x, − for the equality multipliers (quasi-definite). */
  private readonly signs: Int8Array;

  constructor(readonly qp: Qp) {
    const { n, P, rows, l, u, w } = qp;
    const m = rows.length;
    this.rowStart = new Int32Array(m + 1);
    for (let r = 0; r < m; r++) this.rowStart[r + 1] = this.rowStart[r] + rows[r].length;
    this.col = new Int32Array(this.rowStart[m]);
    this.val = new Float64Array(this.rowStart[m]);
    for (let r = 0; r < m; r++) {
      rows[r].forEach(([c, a], k) => {
        this.col[this.rowStart[r] + k] = c;
        this.val[this.rowStart[r] + k] = a;
      });
    }
    this.isSideRow = new Uint8Array(m);
    for (let r = 0; r < m; r++) {
      const isHardEq = w[r] === Infinity && u[r] - l[r] < 1e-12;
      if (isHardEq) {
        this.eqRows.push(r);
        continue;
      }
      for (const [sig, beta] of [
        [1, l[r]],
        [-1, u[r]],
      ] as const) {
        if (!Number.isFinite(beta)) continue;
        this.sideRow.push(r);
        this.sideSig.push(sig);
        this.sideBeta.push(beta);
        this.sideW.push(w[r]);
        this.isSideRow[r] = 1;
      }
    }
    const me = this.eqRows.length;
    const N = n + me;
    this.pi = new Int32Array(P.size);
    this.pj = new Int32Array(P.size);
    this.pv = new Float64Array(P.size);
    const adjacency = Array.from({ length: N }, () => new Set<number>());
    const link = (a: number, b: number) => {
      if (a === b) return;
      adjacency[a].add(b);
      adjacency[b].add(a);
    };
    let e = 0;
    for (const [key, v] of P) {
      const i = Math.floor(key / n);
      this.pi[e] = i;
      this.pj[e] = key - i * n;
      this.pv[e] = v;
      link(this.pi[e], this.pj[e]);
      e++;
    }
    const { rowStart, col, val } = this;
    for (let r = 0; r < m; r++) {
      if (!this.isSideRow[r]) continue;
      for (let a = rowStart[r]; a < rowStart[r + 1]; a++)
        for (let b = rowStart[r]; b < rowStart[r + 1]; b++) link(col[a], col[b]);
    }
    this.eqRows.forEach((r, k) => {
      for (let a = rowStart[r]; a < rowStart[r + 1]; a++) link(col[a], n + k);
    });
    const ldl = new SparseLdl(N, adjacency);
    this.ldl = ldl;
    this.pSlots = Int32Array.from(this.pi, (i, k) => ldl.slot(i, this.pj[k]));
    this.pairStart = new Int32Array(m + 1);
    for (let r = 0; r < m; r++) {
      const c = this.isSideRow[r] ? rowStart[r + 1] - rowStart[r] : 0;
      this.pairStart[r + 1] = this.pairStart[r] + (c * (c + 1)) / 2;
    }
    this.pairSlot = new Int32Array(this.pairStart[m]);
    this.pairCoef = new Float64Array(this.pairStart[m]);
    for (let r = 0; r < m; r++) {
      if (!this.isSideRow[r]) continue;
      let t = this.pairStart[r];
      for (let a = rowStart[r]; a < rowStart[r + 1]; a++) {
        for (let b = a; b < rowStart[r + 1]; b++) {
          this.pairSlot[t] = ldl.slot(col[a], col[b]);
          this.pairCoef[t] = val[a] * val[b];
          t++;
        }
      }
    }
    this.eqSlot = new Int32Array(this.rowStart[m]).fill(0);
    this.eqRows.forEach((r, k) => {
      for (let a = rowStart[r]; a < rowStart[r + 1]; a++) this.eqSlot[a] = ldl.slot(col[a], n + k);
    });
    this.xDiag = Int32Array.from({ length: n }, (_, i) => ldl.slot(i, i));
    this.yDiag = Int32Array.from({ length: me }, (_, k) => ldl.slot(n + k, n + k));
    this.diagonal = new Float64Array(N);
    this.offdiag = new Float64Array(ldl.vals.length);
    this.rowD = new Float64Array(m);
    this.signs = new Int8Array(N).fill(1);
    for (let k = n; k < N; k++) this.signs[k] = -1;
  }

  private add(slot: number, v: number): void {
    if (slot < 0) this.diagonal[-1 - slot] += v;
    else this.offdiag[slot] += v;
  }

  /** Factorise [P + Σ D_k a aᵀ + δ, Aₑᵀ; Aₑ, −δ]. */
  factor(D: Float64Array): void {
    const { rowStart, val } = this;
    this.diagonal.fill(0);
    this.offdiag.fill(0);
    for (const s of this.xDiag) this.add(s, DELTA_X);
    for (const s of this.yDiag) this.add(s, -DELTA_Y);
    for (let k = 0; k < this.pv.length; k++) this.add(this.pSlots[k], this.pv[k]);
    this.rowD.fill(0);
    for (let k = 0; k < D.length; k++) this.rowD[this.sideRow[k]] += D[k];
    const m = this.qp.rows.length;
    for (let r = 0; r < m; r++) {
      if (!this.isSideRow[r]) continue;
      for (let t = this.pairStart[r]; t < this.pairStart[r + 1]; t++)
        this.add(this.pairSlot[t], this.rowD[r] * this.pairCoef[t]);
    }
    for (const r of this.eqRows)
      for (let a = rowStart[r]; a < rowStart[r + 1]; a++) this.add(this.eqSlot[a], val[a]);
    this.ldl.factor(this.diagonal, this.offdiag, this.signs, PIVOT_DELTA);
  }

  dot(r: number, v: Float64Array): number {
    let s = 0;
    for (let k = this.rowStart[r]; k < this.rowStart[r + 1]; k++) s += this.val[k] * v[this.col[k]];
    return s;
  }

  /** out += f · a_r. */
  axpy(r: number, f: number, out: Float64Array): void {
    for (let k = this.rowStart[r]; k < this.rowStart[r + 1]; k++) out[this.col[k]] += f * this.val[k];
  }
}

/** Solve a QP (see the top of the file). */
export function solveQp(qp: Qp, options: QpOptions = {}): QpResult {
  const maxIter = options.maxIter ?? 150;
  const tol = options.tol ?? 1e-9;
  const dualTol = options.dualTol ?? 1e-6;
  const S = new Structure(qp);
  const { n, q, l } = qp;
  const { eqRows, sideRow, sideSig, sideBeta, sideW } = S;
  const me = eqRows.length;
  const K = sideRow.length;
  const x = new Float64Array(n);
  const last = new Float64Array(n);
  const y = new Float64Array(me);
  const sl = new Float64Array(K);
  const lam = new Float64Array(K);
  const el = new Float64Array(K);
  const mu = new Float64Array(K);
  const soft = Uint8Array.from(sideW, (v) => (v < Infinity ? 1 : 0));
  for (let k = 0; k < K; k++) {
    el[k] = soft[k] ? 1 : 0;
    sl[k] = Math.max(1, sideSig[k] * -sideBeta[k] + el[k]);
    lam[k] = soft[k] ? Math.min(1, sideW[k] / 2) : 1;
    mu[k] = soft[k] ? sideW[k] - lam[k] : 0;
  }
  const rx = new Float64Array(n);
  const re = new Float64Array(me);
  const rs = new Float64Array(K);
  const rmu = new Float64Array(K);
  const D = new Float64Array(K);
  const h = new Float64Array(K);
  const rhs = new Float64Array(n + me);
  const dx = new Float64Array(n);
  const dy = new Float64Array(me);
  const dl = new Float64Array(K);
  const ds = new Float64Array(K);
  const de = new Float64Array(K);
  const dm = new Float64Array(K);
  const aff = {
    l: new Float64Array(K),
    s: new Float64Array(K),
    e: new Float64Array(K),
    m: new Float64Array(K),
  };
  let qMax = 1;
  for (let i = 0; i < n; i++) qMax = Math.max(qMax, Math.abs(q[i]));
  let betaMax = 1;
  for (let k = 0; k < K; k++) betaMax = Math.max(betaMax, Math.abs(sideBeta[k]));
  for (const r of eqRows) betaMax = Math.max(betaMax, Math.abs(l[r]));

  /**
   * One Newton direction for the complementarity residuals rc_k (of λs) and rd_k (of μe). The side
   * unknowns are eliminated: Δλ = D(h − σ a·Δx) with D = 1 / (s/λ + e/μ).
   */
  const newton = (rc: (k: number) => number, rd: (k: number) => number) => {
    for (let k = 0; k < K; k++) {
      h[k] = rs[k] - rc(k) / lam[k] + (soft[k] ? (rd(k) - el[k] * rmu[k]) / mu[k] : 0);
    }
    for (let i = 0; i < n; i++) rhs[i] = -rx[i];
    for (let k = 0; k < K; k++) S.axpy(sideRow[k], sideSig[k] * D[k] * h[k], rhs);
    for (let k = 0; k < me; k++) rhs[n + k] = -re[k];
    S.ldl.solve(rhs);
    for (let i = 0; i < n; i++) dx[i] = rhs[i];
    for (let k = 0; k < me; k++) dy[k] = rhs[n + k];
    for (let k = 0; k < K; k++) {
      dl[k] = D[k] * (h[k] - sideSig[k] * S.dot(sideRow[k], dx));
      ds[k] = (-rc(k) - sl[k] * dl[k]) / lam[k];
      de[k] = soft[k] ? (-rd(k) + el[k] * dl[k] + el[k] * rmu[k]) / mu[k] : 0;
      dm[k] = soft[k] ? -dl[k] - rmu[k] : 0;
    }
  };
  /** Longest step in (0, 1] that keeps s, λ, e, μ non-negative. */
  const maxStep = () => {
    let a = 1;
    for (let k = 0; k < K; k++) {
      if (dl[k] < 0) a = Math.min(a, -lam[k] / dl[k]);
      if (ds[k] < 0) a = Math.min(a, -sl[k] / ds[k]);
      if (!soft[k]) continue;
      if (de[k] < 0) a = Math.min(a, -el[k] / de[k]);
      if (dm[k] < 0) a = Math.min(a, -mu[k] / dm[k]);
    }
    return a;
  };
  let iter = 0;
  let status: QpStatus = "max_iter";
  let primal = Infinity;
  let dual = Infinity;
  let gapNow = Infinity;
  for (; iter < maxIter; iter++) {
    rx.set(q);
    for (let k = 0; k < S.pv.length; k++) {
      rx[S.pi[k]] += S.pv[k] * x[S.pj[k]];
      if (S.pi[k] !== S.pj[k]) rx[S.pj[k]] += S.pv[k] * x[S.pi[k]];
    }
    for (let k = 0; k < K; k++) S.axpy(sideRow[k], -lam[k] * sideSig[k], rx);
    eqRows.forEach((r, k) => {
      S.axpy(r, y[k], rx);
      re[k] = S.dot(r, x) - l[r];
    });
    let gap = 0;
    let count = 0;
    primal = 0;
    dual = 0;
    for (let k = 0; k < K; k++) {
      rs[k] = sl[k] - (sideSig[k] * (S.dot(sideRow[k], x) - sideBeta[k]) + el[k]);
      rmu[k] = soft[k] ? mu[k] + lam[k] - sideW[k] : 0;
      primal = Math.max(primal, Math.abs(rs[k]));
      dual = Math.max(dual, Math.abs(rmu[k]));
      gap += lam[k] * sl[k] + mu[k] * el[k];
      count += soft[k] ? 2 : 1;
    }
    for (let k = 0; k < me; k++) primal = Math.max(primal, Math.abs(re[k]));
    for (let i = 0; i < n; i++) dual = Math.max(dual, Math.abs(rx[i]));
    gapNow = gap / Math.max(1, count);
    const isBroken = !Number.isFinite(primal + dual + gapNow);
    if (isBroken) {
      // A step went numerically wrong: return the last finite iterate, said so in the status.
      x.set(last);
      status = "broken";
      break;
    }
    last.set(x);
    const isDone = primal <= tol * betaMax && dual <= dualTol * qMax && gapNow <= tol;
    if (isDone) {
      status = "converged";
      break;
    }
    for (let k = 0; k < K; k++) {
      const sOverL = Math.max(sl[k], TINY) / Math.max(lam[k], TINY);
      const eOverM = soft[k] ? Math.max(el[k], TINY) / Math.max(mu[k], TINY) : 0;
      D[k] = 1 / (sOverL + eOverM);
    }
    S.factor(D);
    // Predictor: towards complementarity 0.
    newton(
      (k) => lam[k] * sl[k],
      (k) => mu[k] * el[k],
    );
    const aAff = maxStep();
    let gapAff = 0;
    for (let k = 0; k < K; k++) {
      gapAff +=
        (lam[k] + aAff * dl[k]) * (sl[k] + aAff * ds[k]) + (mu[k] + aAff * dm[k]) * (el[k] + aAff * de[k]);
      aff.l[k] = dl[k];
      aff.s[k] = ds[k];
      aff.e[k] = de[k];
      aff.m[k] = dm[k];
    }
    const sigma = Math.min(1, (gapAff / Math.max(gap, 1e-300)) ** 3);
    const target = (sigma * gap) / Math.max(1, count);
    // Corrector: the centring target and Mehrotra's second-order term, same factorisation.
    newton(
      (k) => lam[k] * sl[k] + aff.l[k] * aff.s[k] - target,
      (k) => mu[k] * el[k] + aff.m[k] * aff.e[k] - target,
    );
    const a = Math.min(1, STEP_FRACTION * maxStep());
    for (let i = 0; i < n; i++) x[i] += a * dx[i];
    for (let k = 0; k < me; k++) y[k] += a * dy[k];
    for (let k = 0; k < K; k++) {
      lam[k] += a * dl[k];
      sl[k] += a * ds[k];
      if (!soft[k]) continue;
      el[k] += a * de[k];
      mu[k] += a * dm[k];
    }
  }
  return {
    status,
    regularised: S.ldl.regularised,
    x,
    iterations: iter,
    primalResidual: primal,
    dualResidual: dual,
    gap: gapNow,
  };
}
