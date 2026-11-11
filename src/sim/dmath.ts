/**
 * Maths that gives bit-identical results on every JavaScript engine.
 *
 * Math.sin, Math.cos, Math.pow and Math.hypot are allowed to differ in their
 * last digit between browsers and Node, and in a bouncing-ball simulation one
 * digit is enough to change a whole run. Leaderboard scores are checked by
 * replaying the run on the server, so the simulation uses only these, which
 * are built from + - * / and Math.sqrt (all exactly specified).
 */

const HALF_PI = Math.PI / 2;

/** sin(x) for |x| <= pi/4, Taylor series to x^15 (error below 1e-16). */
function sinPoly(x: number): number {
  const x2 = x * x;
  return (
    x *
    (1 +
      x2 *
        (-1 / 6 +
          x2 *
            (1 / 120 +
              x2 * (-1 / 5040 + x2 * (1 / 362880 + x2 * (-1 / 39916800 + x2 * (1 / 6227020800 + x2 * (-1 / 1307674368000))))))))
  );
}

/** cos(x) for |x| <= pi/4, Taylor series to x^16. */
function cosPoly(x: number): number {
  const x2 = x * x;
  return (
    1 +
    x2 *
      (-1 / 2 +
        x2 *
          (1 / 24 +
            x2 *
              (-1 / 720 +
                x2 * (1 / 40320 + x2 * (-1 / 3628800 + x2 * (1 / 479001600 + x2 * (-1 / 87178291200 + x2 * (1 / 20922789888000))))))))
  );
}

export function dsin(x: number): number {
  const k = Math.round(x / HALF_PI);
  const r = x - k * HALF_PI;
  switch (((k % 4) + 4) % 4) {
    case 0:
      return sinPoly(r);
    case 1:
      return cosPoly(r);
    case 2:
      return -sinPoly(r);
    default:
      return -cosPoly(r);
  }
}

export const dcos = (x: number): number => dsin(x + HALF_PI);

/** base^n for a whole number n >= 0, by repeated squaring. */
export function ipow(base: number, n: number): number {
  let result = 1;
  let b = base;
  let e = Math.max(0, Math.floor(n));
  while (e > 0) {
    if (e % 2 === 1) result *= b;
    b *= b;
    e = Math.floor(e / 2);
  }
  return result;
}

export const length = (x: number, y: number): number => Math.sqrt(x * x + y * y);
