import sys, time, random

n, q = 1_000_000, 100_000
a = list(range(0, 2 * n, 2))
random.seed(1)
qs = [random.randrange(2 * n) for _ in range(q)]

def run(trace, out):
    total = 0
    w = out.write
    for x in qs:
        lo, hi = 0, n
        step = 0
        while lo < hi:
            mid = lo + (hi - lo) // 2
            if trace:
                w(f"step={step} lo={lo} hi={hi} width={hi-lo} mid={mid} a[mid]={a[mid]}\n")
            if a[mid] >= x:
                hi = mid
            else:
                lo = mid + 1
            step += 1
        total += lo
    return total

devnull = open("/dev/null", "w")
t = time.perf_counter(); run(False, devnull); silent = time.perf_counter() - t
t = time.perf_counter(); run(True, devnull);  traced = time.perf_counter() - t
print(f"python silent={silent:.3f}s traced={traced:.3f}s ratio={traced/silent:.1f}x")
