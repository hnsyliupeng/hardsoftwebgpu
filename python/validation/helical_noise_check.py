"""Expected effect of rotation noise on helical plate volume (plates only, exact per-ply clip area).

Each ply is a 2 x 2 unit square rotated by theta_i and clipped to [-1,1]^2; its volume is t * area(theta_i).
Plies are separate slabs, so the total is sum_i t * area(theta_i). The area is evaluated on a fine grid.
Noise: theta_i -> i*rot + U(-n, n). Compares the expected volume with and without noise, for the upstream
ply centring (plies outside z in [0,2] clipped) and for the repo centring (full coverage).
Usage: python3 python/validation/helical_noise_check.py [num_plies=10] [rot=10] [noise=5] [draws=20000]
"""
import math
import sys

import numpy as np


def clip_area(theta_deg, g=1201):
    """Area of the rotated square (|x'|,|y'| <= 1) inside the box [-1,1]^2."""
    th = math.radians(theta_deg)
    c, s = math.cos(th), math.sin(th)
    xs = np.linspace(-1, 1, g)
    X, Y = np.meshgrid(xs, xs)
    xr = c * X + s * Y
    yr = -s * X + c * Y
    inside = (np.abs(xr) <= 1) & (np.abs(yr) <= 1)
    return inside.mean() * 4.0


def main():
    n = int(sys.argv[1]) if len(sys.argv) > 1 else 10
    rot = float(sys.argv[2]) if len(sys.argv) > 2 else 10.0
    noise = float(sys.argv[3]) if len(sys.argv) > 3 else 5.0
    draws = int(sys.argv[4]) if len(sys.argv) > 4 else 20000
    t = 2.0 / n
    base = [clip_area(i * rot) for i in range(n)]
    v0 = sum(base) * t * 1000.0
    rng = np.random.default_rng(5)
    vals = []
    cache = {}
    for _ in range(draws):
        total = 0.0
        for i in range(n):
            th = round(i * rot + rng.uniform(-noise, noise), 1)
            if th not in cache:
                cache[th] = clip_area(th, g=401)
            total += cache[th]
        vals.append(total * t * 1000.0)
    vals = np.array(vals)
    print(f"noise-free volume (repo centring, full coverage): {v0:.1f} mm3")
    print(f"noisy: mean {vals.mean():.1f}  sd {vals.std():.1f}  "
          f"min {vals.min():.1f}  max {vals.max():.1f}  (draws {draws}, noise +-{noise} deg)")
    print(f"expected change from noise: {100 * (vals.mean() - v0) / v0:+.3f} %")


if __name__ == "__main__":
    main()
