/**
 * Sparse LDLᵀ of a symmetric quasi-definite matrix (positive definite, or [H, Aᵀ; A, −δ] with H
 * positive definite) with a fixed pattern. The pattern and a minimum-degree order are found once;
 * `factor` refills the values (each interior-point iteration) and `solve` runs the triangular
 * solves. Quasi-definite matrices factorise in any symmetric order without pivoting (Vanderbei
 * 1995), so the order can be chosen for sparsity alone.
 */
export class SparseLdl {
  /** perm[k] = the variable eliminated k-th; pos is its inverse. */
  private readonly perm: Int32Array;
  private readonly pos: Int32Array;
  private readonly colStart: Int32Array;
  /** Row (elimination position) of each off-diagonal entry, ascending within a column. */
  private readonly rowIdx: Int32Array;
  readonly vals: Float64Array;
  private readonly diag: Float64Array;
  /** For each column, the pairs of its entries and where their product goes (−1 = a diagonal). */
  private readonly updStart: Int32Array;
  private readonly updA: Int32Array;
  private readonly updB: Int32Array;
  private readonly updTarget: Int32Array;
  private readonly work: Float64Array;

  constructor(
    readonly n: number,
    adjacency: Array<Set<number>>,
  ) {
    const order = minimumDegree(n, adjacency);
    this.perm = order.perm;
    this.pos = new Int32Array(n);
    for (let k = 0; k < n; k++) this.pos[this.perm[k]] = k;
    // Column k's pattern: the neighbours of perm[k] still uneliminated at its turn, as positions.
    const starts = new Int32Array(n + 1);
    for (let k = 0; k < n; k++) starts[k + 1] = starts[k] + order.patterns[k].length;
    this.colStart = starts;
    this.rowIdx = new Int32Array(starts[n]);
    for (let k = 0; k < n; k++) {
      const rows = order.patterns[k].map((v) => this.pos[v]).sort((a, b) => a - b);
      this.rowIdx.set(rows, starts[k]);
    }
    this.vals = new Float64Array(starts[n]);
    this.diag = new Float64Array(n);
    this.origVals = new Float64Array(starts[n]);
    this.origDiag = new Float64Array(n);
    this.work = new Float64Array(n);
    const find = (col: number, row: number) => {
      let lo = this.colStart[col];
      let hi = this.colStart[col + 1] - 1;
      while (lo <= hi) {
        const mid = (lo + hi) >> 1;
        const r = this.rowIdx[mid];
        if (r === row) return mid;
        if (r < row) lo = mid + 1;
        else hi = mid - 1;
      }
      throw new Error(`LDLᵀ pattern misses (${row}, ${col})`);
    };
    let total = 0;
    for (let k = 0; k < n; k++) {
      const c = starts[k + 1] - starts[k];
      total += (c * (c + 1)) / 2;
    }
    this.updStart = new Int32Array(n + 1);
    this.updA = new Int32Array(total);
    this.updB = new Int32Array(total);
    this.updTarget = new Int32Array(total);
    let t = 0;
    for (let k = 0; k < n; k++) {
      this.updStart[k] = t;
      for (let a = starts[k]; a < starts[k + 1]; a++) {
        for (let b = a; b < starts[k + 1]; b++) {
          this.updA[t] = a;
          this.updB[t] = b;
          this.updTarget[t] = a === b ? -1 - this.rowIdx[a] : find(this.rowIdx[a], this.rowIdx[b]);
          t++;
        }
      }
    }
    this.updStart[n] = t;
  }

  /** Index of the stored value of entry (i, j) of the original matrix (−1 − pos for a diagonal). */
  slot(i: number, j: number): number {
    const a = this.pos[i];
    const b = this.pos[j];
    if (a === b) return -1 - a;
    const col = Math.min(a, b);
    const row = Math.max(a, b);
    let lo = this.colStart[col];
    let hi = this.colStart[col + 1] - 1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      const r = this.rowIdx[mid];
      if (r === row) return mid;
      if (r < row) lo = mid + 1;
      else hi = mid - 1;
    }
    throw new Error(`LDLᵀ pattern misses (${i}, ${j})`);
  }

  /**
   * Factorise the matrix whose entries are at the slots given by slot(): `diagonal` by elimination
   * position (slot −1 − k), `offdiag` by slot. `signs[v]` is the sign the pivot of variable v must
   * have (+1 for the x block, −1 for the equality block of a quasi-definite matrix): a pivot of the
   * wrong sign or below `delta` in size is replaced by sign · delta (static regularisation, as
   * QDLDL/OSQP do), counted in `regularised`, and `solve` refines against the unregularised matrix.
   * `shift` (by elimination position) is added to the diagonal of the factor alone, the same way.
   */
  factor(
    diagonal: Float64Array,
    offdiag: Float64Array,
    signs?: Int8Array,
    delta = 1e-9,
    shift?: Float64Array,
  ): void {
    const { n, vals, diag } = this;
    this.origDiag.set(diagonal);
    this.origVals.set(offdiag);
    diag.set(diagonal);
    // A static regularisation of the factor only: `solve` refines against the matrix without it.
    if (shift) for (let k = 0; k < n; k++) diag[k] += shift[k];
    vals.set(offdiag);
    this.regularised = 0;
    for (let k = 0; k < n; k++) {
      const sign = signs ? signs[this.perm[k]] : diag[k] >= 0 ? 1 : -1;
      const isBad = diag[k] * sign < delta || !Number.isFinite(diag[k]);
      if (isBad) {
        diag[k] = sign * delta;
        this.regularised++;
      }
      const d = diag[k];
      for (let t = this.updStart[k]; t < this.updStart[k + 1]; t++) {
        const v = (vals[this.updA[t]] * vals[this.updB[t]]) / d;
        const target = this.updTarget[t];
        if (target < 0) diag[-1 - target] -= v;
        else vals[target] -= v;
      }
      for (let e = this.colStart[k]; e < this.colStart[k + 1]; e++) vals[e] /= d;
    }
  }

  /** Pivots replaced by the last factor() (0 when the matrix factorised as it was). */
  regularised = 0;
  private readonly origDiag: Float64Array;
  private readonly origVals: Float64Array;

  /** out = K·x for the matrix last given to factor() (before regularisation), in variable order. */
  private multiply(x: Float64Array, out: Float64Array): void {
    const { n } = this;
    out.fill(0);
    for (let k = 0; k < n; k++) {
      const vk = this.perm[k];
      out[vk] += this.origDiag[k] * x[vk];
      for (let e = this.colStart[k]; e < this.colStart[k + 1]; e++) {
        const vr = this.perm[this.rowIdx[e]];
        out[vk] += this.origVals[e] * x[vr];
        out[vr] += this.origVals[e] * x[vk];
      }
    }
  }

  private triangular(b: Float64Array): void {
    const { n, vals, diag, work: y } = this;
    for (let k = 0; k < n; k++) y[k] = b[this.perm[k]];
    for (let k = 0; k < n; k++) {
      const yk = y[k];
      if (yk === 0) continue;
      for (let e = this.colStart[k]; e < this.colStart[k + 1]; e++) y[this.rowIdx[e]] -= vals[e] * yk;
    }
    for (let k = 0; k < n; k++) y[k] /= diag[k];
    for (let k = n - 1; k >= 0; k--) {
      let s = y[k];
      for (let e = this.colStart[k]; e < this.colStart[k + 1]; e++) s -= vals[e] * y[this.rowIdx[e]];
      y[k] = s;
    }
    for (let k = 0; k < n; k++) b[this.perm[k]] = y[k];
  }

  /**
   * Solve K x = b in place, with `refine` steps of iterative refinement against the matrix as given
   * (it undoes the regularisation and the rounding of an ill-conditioned factor).
   */
  solve(b: Float64Array, refine = 2): void {
    const rhs = Float64Array.from(b);
    this.triangular(b);
    if (refine === 0) return;
    const r = new Float64Array(this.n);
    for (let step = 0; step < refine; step++) {
      this.multiply(b, r);
      for (let i = 0; i < this.n; i++) r[i] = rhs[i] - r[i];
      this.triangular(r);
      for (let i = 0; i < this.n; i++) b[i] += r[i];
    }
  }
}

/**
 * Minimum-degree elimination on the explicit graph (adjacency sets, updated as nodes are
 * eliminated), lowest degree first with ties to the lowest index, so the order is deterministic.
 * Why not AMD's quotient graph: the graphs here are near trees of chains, the fill is small and the
 * explicit sets stay small too.
 */
function minimumDegree(n: number, adjacency: Array<Set<number>>): { perm: Int32Array; patterns: number[][] } {
  const adj = adjacency.map((s) => new Set(s));
  const eliminated = new Uint8Array(n);
  const perm = new Int32Array(n);
  const patterns: number[][] = [];
  // Buckets by degree; stale entries are skipped when popped.
  const buckets: number[][] = [];
  const degree = new Int32Array(n);
  const push = (v: number) => {
    const d = adj[v].size;
    degree[v] = d;
    (buckets[d] ??= []).push(v);
  };
  for (let v = n - 1; v >= 0; v--) push(v);
  let low = 0;
  for (let k = 0; k < n; k++) {
    let v = -1;
    while (v < 0) {
      const bucket = buckets[low];
      const isEmpty = bucket === undefined || bucket.length === 0;
      if (isEmpty) {
        low++;
        continue;
      }
      const cand = bucket.pop()!;
      const isLive = !eliminated[cand] && degree[cand] === low && adj[cand].size === low;
      if (isLive) v = cand;
    }
    eliminated[v] = 1;
    perm[k] = v;
    const nbrs = [...adj[v]];
    patterns.push(nbrs);
    for (const a of nbrs) {
      adj[a].delete(v);
      for (const b of nbrs) if (a !== b) adj[a].add(b);
    }
    for (const a of nbrs) {
      push(a);
      low = Math.min(low, adj[a].size);
    }
    adj[v].clear();
  }
  return { perm, patterns };
}
