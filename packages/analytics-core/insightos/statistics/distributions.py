"""Pure-python statistical distributions.

InsightOS deliberately implements the small set of distribution functions it
needs instead of taking a hard dependency on SciPy.  This keeps the analytics
core installable anywhere (including slim containers and CI runners) and makes
every p-value in the product auditable: there is no black box between the data
and the number an executive sees.

Implemented
-----------
* ``norm_cdf`` / ``norm_ppf``           - standard normal
* ``t_sf`` / ``t_cdf``                  - Student's t (via regularised incomplete beta)
* ``f_sf``                              - Fisher-Snedecor F
* ``chi2_sf``                           - chi-square (via regularised incomplete gamma)
* ``betainc`` / ``gammainc_upper``      - the special functions the above rely on

All functions are scalar, side-effect free and validated against published
reference quantiles in ``tests/test_statistics.py``.
"""

from __future__ import annotations

import math

__all__ = [
    "norm_cdf",
    "norm_sf",
    "norm_ppf",
    "t_cdf",
    "t_sf",
    "f_sf",
    "chi2_sf",
    "betainc",
    "gammainc_upper",
]

_MAX_ITER = 300
_EPS = 3.0e-16
_TINY = 1.0e-300


# --------------------------------------------------------------------------- #
# Normal
# --------------------------------------------------------------------------- #
def norm_cdf(z: float) -> float:
    """P(Z <= z) for Z ~ N(0, 1)."""
    return 0.5 * math.erfc(-z / math.sqrt(2.0))


def norm_sf(z: float) -> float:
    """P(Z > z) for Z ~ N(0, 1)."""
    return 0.5 * math.erfc(z / math.sqrt(2.0))


def norm_ppf(p: float) -> float:
    """Inverse standard normal CDF (Acklam's rational approximation + refinement).

    Absolute error < 1e-15 after the Halley refinement below.
    """
    if not 0.0 < p < 1.0:
        if p <= 0.0:
            return -math.inf
        if p >= 1.0:
            return math.inf
        raise ValueError("p must be in (0, 1)")

    a = (
        -3.969683028665376e01,
        2.209460984245205e02,
        -2.759285104469687e02,
        1.383577518672690e02,
        -3.066479806614716e01,
        2.506628277459239e00,
    )
    b = (
        -5.447609879822406e01,
        1.615858368580409e02,
        -1.556989798598866e02,
        6.680131188771972e01,
        -1.328068155288572e01,
    )
    c = (
        -7.784894002430293e-03,
        -3.223964580411365e-01,
        -2.400758277161838e00,
        -2.549732539343734e00,
        4.374664141464968e00,
        2.938163982698783e00,
    )
    d = (
        7.784695709041462e-03,
        3.224671290700398e-01,
        2.445134137142996e00,
        3.754408661907416e00,
    )
    p_low, p_high = 0.02425, 1.0 - 0.02425

    if p < p_low:
        q = math.sqrt(-2.0 * math.log(p))
        x = (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / (
            (((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1.0
        )
    elif p <= p_high:
        q = p - 0.5
        r = q * q
        x = (((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q / (
            ((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1.0
        )
    else:
        q = math.sqrt(-2.0 * math.log(1.0 - p))
        x = -(((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / (
            (((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1.0
        )

    # Halley refinement against the true CDF. Two steps costs nothing and makes
    # the result insensitive to the accuracy of the rational starting point.
    for _ in range(2):
        e = norm_cdf(x) - p
        u = e * math.sqrt(2.0 * math.pi) * math.exp(min(x * x / 2.0, 700.0))
        x = x - u / (1.0 + x * u / 2.0)
    return x


# --------------------------------------------------------------------------- #
# Special functions
# --------------------------------------------------------------------------- #
def _betacf(a: float, b: float, x: float) -> float:
    """Continued fraction for the incomplete beta function (Lentz's algorithm)."""
    qab, qap, qam = a + b, a + 1.0, a - 1.0
    c = 1.0
    d = 1.0 - qab * x / qap
    if abs(d) < _TINY:
        d = _TINY
    d = 1.0 / d
    h = d
    for m in range(1, _MAX_ITER + 1):
        m2 = 2 * m
        aa = m * (b - m) * x / ((qam + m2) * (a + m2))
        d = 1.0 + aa * d
        if abs(d) < _TINY:
            d = _TINY
        c = 1.0 + aa / c
        if abs(c) < _TINY:
            c = _TINY
        d = 1.0 / d
        h *= d * c
        aa = -(a + m) * (qab + m) * x / ((a + m2) * (qap + m2))
        d = 1.0 + aa * d
        if abs(d) < _TINY:
            d = _TINY
        c = 1.0 + aa / c
        if abs(c) < _TINY:
            c = _TINY
        d = 1.0 / d
        delta = d * c
        h *= delta
        if abs(delta - 1.0) < _EPS:
            break
    return h


def betainc(a: float, b: float, x: float) -> float:
    """Regularised incomplete beta function I_x(a, b)."""
    if x <= 0.0:
        return 0.0
    if x >= 1.0:
        return 1.0
    lbeta = (
        math.lgamma(a + b)
        - math.lgamma(a)
        - math.lgamma(b)
        + a * math.log(x)
        + b * math.log(1.0 - x)
    )
    front = math.exp(lbeta)
    if x < (a + 1.0) / (a + b + 2.0):
        return front * _betacf(a, b, x) / a
    return 1.0 - math.exp(
        math.lgamma(a + b)
        - math.lgamma(a)
        - math.lgamma(b)
        + b * math.log(1.0 - x)
        + a * math.log(x)
    ) * _betacf(b, a, 1.0 - x) / b


def _gser(a: float, x: float) -> float:
    """Lower regularised incomplete gamma P(a, x) via its series representation."""
    ap = a
    total = 1.0 / a
    delta = total
    for _ in range(_MAX_ITER):
        ap += 1.0
        delta *= x / ap
        total += delta
        if abs(delta) < abs(total) * _EPS:
            break
    return total * math.exp(-x + a * math.log(x) - math.lgamma(a))


def _gcf(a: float, x: float) -> float:
    """Upper regularised incomplete gamma Q(a, x) via continued fraction."""
    b = x + 1.0 - a
    c = 1.0 / _TINY
    d = 1.0 / b
    h = d
    for i in range(1, _MAX_ITER + 1):
        an = -i * (i - a)
        b += 2.0
        d = an * d + b
        if abs(d) < _TINY:
            d = _TINY
        c = b + an / c
        if abs(c) < _TINY:
            c = _TINY
        d = 1.0 / d
        delta = d * c
        h *= delta
        if abs(delta - 1.0) < _EPS:
            break
    return math.exp(-x + a * math.log(x) - math.lgamma(a)) * h


def gammainc_upper(a: float, x: float) -> float:
    """Upper regularised incomplete gamma Q(a, x) = 1 - P(a, x)."""
    if x < 0.0 or a <= 0.0:
        raise ValueError("gammainc_upper requires a > 0 and x >= 0")
    if x == 0.0:
        return 1.0
    if x < a + 1.0:
        return 1.0 - _gser(a, x)
    return _gcf(a, x)


# --------------------------------------------------------------------------- #
# Test distributions
# --------------------------------------------------------------------------- #
def t_sf(t: float, df: float) -> float:
    """Upper tail P(T > t) for Student's t with ``df`` degrees of freedom."""
    if df <= 0:
        return float("nan")
    if math.isinf(t):
        return 0.0 if t > 0 else 1.0
    x = df / (df + t * t)
    prob = 0.5 * betainc(df / 2.0, 0.5, x)
    return prob if t > 0 else 1.0 - prob


def t_cdf(t: float, df: float) -> float:
    """P(T <= t) for Student's t."""
    return 1.0 - t_sf(t, df)


def f_sf(f: float, dfn: float, dfd: float) -> float:
    """Upper tail P(F > f) for the F distribution."""
    if f <= 0:
        return 1.0
    x = dfd / (dfd + dfn * f)
    return betainc(dfd / 2.0, dfn / 2.0, x)


def chi2_sf(x: float, df: float) -> float:
    """Upper tail P(X > x) for the chi-square distribution."""
    if x <= 0:
        return 1.0
    return gammainc_upper(df / 2.0, x / 2.0)
