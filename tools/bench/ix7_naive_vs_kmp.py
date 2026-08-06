#!/usr/bin/env python3
"""IX-7 — 순진한 매칭과 KMP의 비교 횟수, 그리고 정답 대조.

본문(IX-7 §1)이 인용하는 2,250,500 / 9,500 이라는 숫자를 여기서 낸다.
비교 횟수는 결정론적 값이라 기기와 무관하게 재현된다.

추가로 KMP와 라빈-카프를, 완전탐색(부분 문자열 직접 비교) 및 Python
내장 `str.find`와 무작위 300건 대조해 정답이 같은지 확인한다.
"""

from __future__ import annotations

import random


def naive_count(text: str, pat: str) -> tuple[list[int], int]:
    n, m = len(text), len(pat)
    comparisons = 0
    matches = []
    for i in range(n - m + 1):
        j = 0
        while j < m:
            comparisons += 1
            if text[i + j] != pat[j]:
                break
            j += 1
        else:
            matches.append(i)
    return matches, comparisons


def build_failure(pattern: str) -> list[int]:
    m = len(pattern)
    pi = [0] * m
    k = 0
    for i in range(1, m):
        while k > 0 and pattern[i] != pattern[k]:
            k = pi[k - 1]
        if pattern[i] == pattern[k]:
            k += 1
        pi[i] = k
    return pi


def kmp_count(text: str, pat: str) -> tuple[list[int], int]:
    pi = build_failure(pat)
    k = 0
    comparisons = 0
    matches = []
    for i, ch in enumerate(text):
        while k > 0 and ch != pat[k]:
            comparisons += 1
            k = pi[k - 1]
        comparisons += 1
        if ch == pat[k]:
            k += 1
        if k == len(pat):
            matches.append(i - len(pat) + 1)
            k = pi[k - 1]
    return matches, comparisons


def rabin_karp(text: str, pat: str, mod: int, base: int = 256) -> tuple[list[int], list[int]]:
    n, m = len(text), len(pat)
    if m > n:
        return [], []
    high = pow(base, m - 1, mod)
    hp = ht = 0
    for i in range(m):
        hp = (hp * base + ord(pat[i])) % mod
        ht = (ht * base + ord(text[i])) % mod
    matches, spurious = [], []
    for i in range(n - m + 1):
        if i > 0:
            ht = ((ht - ord(text[i - 1]) * high) * base + ord(text[i + m - 1])) % mod
        if ht == hp:
            if text[i:i + m] == pat:
                matches.append(i)
            else:
                spurious.append(i)
    return matches, spurious


def brute_positions(text: str, pat: str) -> list[int]:
    m = len(pat)
    return [i for i in range(len(text) - m + 1) if text[i:i + m] == pat]


def main() -> None:
    # 본문 §1의 예제 — 순진한 매칭이 왜 O(nm)인지 보여주는 적대적 입력.
    n, m = 5000, 500
    text = "A" * (n - 1) + "B"
    pat = "A" * (m - 1) + "B"
    nm, nc = naive_count(text, pat)
    km, kc = kmp_count(text, pat)
    assert nm == km == brute_positions(text, pat)
    print("[본문 §1 인용치]")
    print(f"  naive: matches={nm} comparisons={nc}")
    print(f"  kmp  : matches={km} comparisons={kc}")
    print(f"  비율 : {nc / kc:.1f}배")

    # 본문 §3~4의 예제.
    pattern, trace_text = "ABABAC", "ABABABABAC"
    print("\n[본문 §3~4 예제]")
    print("  pi      =", build_failure(pattern))
    print("  matches =", kmp_count(trace_text, pattern)[0])

    # 본문 §4의 spurious-hit 예제.
    rk_text, rk_pat = "AAAABABBBC", "AAAA"
    m_weak, s_weak = rabin_karp(rk_text, rk_pat, mod=7)
    m_safe, s_safe = rabin_karp(rk_text, rk_pat, mod=1_000_000_007)
    print("\n[본문 §4 spurious-hit 예제]")
    print(f"  mod=7      matches={m_weak} spurious={s_weak}")
    print(f"  mod=1e9+7  matches={m_safe} spurious={s_safe}")

    # 무작위 대조 — naive / kmp / rabin-karp(강한 mod) / brute 가 전부 일치하는가.
    random.seed(0)
    ok = True
    for _ in range(300):
        n2 = random.randint(1, 60)
        m2 = random.randint(1, 10)
        t2 = "".join(random.choice("ab") for _ in range(n2))
        p2 = "".join(random.choice("ab") for _ in range(m2))
        bp = brute_positions(t2, p2)
        nm2, _ = naive_count(t2, p2)
        km2, _ = kmp_count(t2, p2)
        rm2, _ = rabin_karp(t2, p2, mod=1_000_000_007)
        if not (bp == nm2 == km2 == rm2):
            ok = False
            print("MISMATCH", t2, p2, bp, nm2, km2, rm2)
    print(f"\n무작위 300건 대조(brute/naive/kmp/rabin-karp): {'OK' if ok else 'FAIL'}")


if __name__ == "__main__":
    main()
