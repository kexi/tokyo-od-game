import { describe, expect, it } from "vitest";
import { QpBuilder, solveQp } from "../src/expressway/qp";
import { SparseLdl } from "../src/expressway/sparse";

// The joint vertical problems rest on these two: a sparse LDLᵀ of quasi-definite matrices and an
// interior-point QP with soft (L1) rows. Each case has a solution worked out by hand.

/** Adjacency of a symmetric pattern given as [i, j] pairs. */
function pattern(n: number, pairs: Array<[number, number]>): Array<Set<number>> {
  const adj = Array.from({ length: n }, () => new Set<number>());
  for (const [i, j] of pairs) {
    adj[i].add(j);
    adj[j].add(i);
  }
  return adj;
}

/** Factor a dense symmetric matrix through the slots. */
function factorDense(ldl: SparseLdl, a: number[][], signs?: Int8Array) {
  const n = a.length;
  const diagonal = new Float64Array(n);
  const offdiag = new Float64Array(ldl.vals.length);
  for (let i = 0; i < n; i++) {
    for (let j = i; j < n; j++) {
      if (a[i][j] === 0 && i !== j) continue;
      const slot = ldl.slot(i, j);
      if (slot < 0) diagonal[-1 - slot] = a[i][j];
      else offdiag[slot] = a[i][j];
    }
  }
  ldl.factor(diagonal, offdiag, signs);
}

describe("疎な LDLᵀ（sparse.ts）", () => {
  it("solves a positive definite tridiagonal system exactly", () => {
    // [[4,1,0],[1,4,1],[0,1,4]] x = [5,6,5] → x = [1,1,1].
    const a = [
      [4, 1, 0],
      [1, 4, 1],
      [0, 1, 4],
    ];
    const ldl = new SparseLdl(
      3,
      pattern(3, [
        [0, 1],
        [1, 2],
      ]),
    );
    factorDense(ldl, a);
    const b = Float64Array.from([5, 6, 5]);
    ldl.solve(b);
    for (const v of b) expect(v).toBeCloseTo(1, 12);
    expect(ldl.regularised).toBe(0);
  });

  it("solves a quasi-definite KKT system [H, Aᵀ; A, −δ] in any order (negative pivots kept)", () => {
    // min ½(x0² + x1²) s.t. x0 + x1 = 2 → x = (1, 1), multiplier −1 (H x + Aᵀ y = 0).
    const a = [
      [1, 0, 1],
      [0, 1, 1],
      [1, 1, -1e-9],
    ];
    const ldl = new SparseLdl(
      3,
      pattern(3, [
        [0, 2],
        [1, 2],
      ]),
    );
    factorDense(ldl, a, Int8Array.from([1, 1, -1]));
    const b = Float64Array.from([0, 0, 2]);
    ldl.solve(b);
    expect(b[0]).toBeCloseTo(1, 7);
    expect(b[1]).toBeCloseTo(1, 7);
    expect(b[2]).toBeCloseTo(-1, 7);
    expect(ldl.regularised).toBe(0);
  });

  it("regularises a pivot of the wrong sign and still solves the given matrix by refinement", () => {
    // A singular x block (a zero diagonal) that the equality row makes solvable.
    const a = [
      [0, 1],
      [1, -1e-9],
    ];
    const ldl = new SparseLdl(2, pattern(2, [[0, 1]]));
    factorDense(ldl, a, Int8Array.from([1, -1]));
    expect(ldl.regularised).toBeGreaterThan(0);
    const b = Float64Array.from([3, 2]);
    ldl.solve(b);
    // [0,1;1,−1e-9]·[x0,x1] = [3,2] → x1 = 3, x0 = 2 + 3e-9.
    expect(b[1]).toBeCloseTo(3, 6);
    expect(b[0]).toBeCloseTo(2, 6);
  });
});

describe("内点法の QP（qp.ts）", () => {
  it("finds the known optimum of a QP with a hard inequality and a hard equality", () => {
    // min (x0−1)² + (x1−2)²  s.t.  x0 + x1 ≤ 2,  x0 = x1  →  x = (1, 1).
    const b = new QpBuilder();
    b.addVars(2);
    b.addSquare([[0, 1]], 1, 2);
    b.addSquare([[1, 1]], 2, 2);
    b.addRow(
      [
        [0, 1],
        [1, 1],
      ],
      -Infinity,
      2,
    );
    b.addRow(
      [
        [0, 1],
        [1, -1],
      ],
      0,
      0,
    );
    const r = solveQp(b.build());
    expect(r.status).toBe("converged");
    expect(r.x[0]).toBeCloseTo(1, 6);
    expect(r.x[1]).toBeCloseTo(1, 6);
  });

  it("an L1 soft row gives way only where a hard row forbids it, and costs exactly w per unit", () => {
    // min (x−3)² with soft x ≤ 1 (w = 1): the penalty's slope 1 balances 2(x−3) at x = 2.5,
    // above the box. With w = 10 the box holds (x = 1: the slope 2·2 = 4 < 10).
    for (const [w, expected] of [
      [1, 2.5],
      [10, 1],
    ] as const) {
      const b = new QpBuilder();
      b.addVars(1);
      b.addSquare([[0, 1]], 3, 2);
      b.addRow([[0, 1]], -Infinity, 1, w);
      const r = solveQp(b.build());
      expect(r.status).toBe("converged");
      expect(r.x[0]).toBeCloseTo(expected, 5);
    }
  });

  it("converges on a satisfied soft equality (the degenerate case of every junction row)", () => {
    // min (x0 − 4)² + (x1)² with soft x0 = x1 (w = 100) and hard x1 = 2: the equality is met
    // exactly (x0 = 2) since moving x0 towards 4 costs 100 per metre against a slope of 4.
    const b = new QpBuilder();
    b.addVars(2);
    b.addSquare([[0, 1]], 4, 2);
    b.addSquare([[1, 1]], 0, 2);
    b.addRow(
      [
        [0, 1],
        [1, -1],
      ],
      0,
      0,
      100,
    );
    b.addRow([[1, 1]], 2, 2);
    const r = solveQp(b.build());
    expect(r.status).toBe("converged");
    expect(r.x[0]).toBeCloseTo(2, 6);
    expect(r.x[1]).toBeCloseTo(2, 6);
  });

  it("says so when it stops early: max_iter, never a silent answer", () => {
    const b = new QpBuilder();
    b.addVars(2);
    b.addSquare([[0, 1]], 5, 1);
    b.addRow(
      [
        [0, 1],
        [1, 1],
      ],
      -Infinity,
      1,
    );
    const r = solveQp(b.build(), { maxIter: 2 });
    expect(r.status).toBe("max_iter");
    expect(r.iterations).toBe(2);
  });
});
