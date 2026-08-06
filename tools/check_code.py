#!/usr/bin/env python3
"""본문에 실린 코드를 실제로 실행해 본다.

왜 필요한가
    STYLE.md §6.4 는 "모든 코드는 실행 가능해야 한다" 를 요구하고, §4 의 ::: dual
    강제 규칙은 두 언어가 같은 알고리즘이어야 한다고 못 박는다. 다른 검사기들은
    문서를 읽기만 한다. 코드가 도는지는 돌려 봐야 안다.

    책이 신뢰를 잃는 가장 빠른 길은 실리지 않는 코드다. 하나가 안 돌면
    나머지 전부가 의심받는다.

무엇을 하는가
    1. ::: dual 안의 python / cpp 블록을 뽑는다.
    2. python3.13 으로 실행하고, g++ -std=c++17 -O2 로 컴파일·실행한다.
    3. 두 출력이 다르면 보고한다. 다른 것이 의도일 수 있으므로(정수 오버플로,
       vector 증폭, 람다 캡처처럼 언어 차이가 곧 교훈인 경우) 블록 뒤에
       "언어 차이" 표가 있으면 선언된 차이로 보고 통과시킨다.

    선언 없는 불일치가 진짜 결함이다. 독자는 두 코드가 같은 일을 한다고 믿는다.

무엇을 건너뛰는가
    - 표준입력이 필요한 블록 (input() / cin >> / stdin)
    - tools/code_check_skip.txt 에 적힌 것. 형식: `경로:줄 # 이유`
      조각(앞 블록의 정의를 이어받는 코드)이 여기 해당한다. 이유를 반드시 적는다 —
      건너뛰는 데 마찰이 있어야 아무거나 건너뛰지 않는다.

사용법
    python3 tools/check_code.py              # 전체
    python3 tools/check_code.py 0-2 i-5      # 특정 챕터만
    python3 tools/check_code.py --strict     # 불일치도 실패로 (CI 아님)
"""

from __future__ import annotations

import pathlib
import re
import subprocess
import sys
import tempfile

ROOT = pathlib.Path(__file__).resolve().parent.parent
CONTENT = ROOT / "content"
SKIPFILE = ROOT / "tools" / "code_check_skip.txt"

PY = "python3.13"
CXX = ["g++", "-std=c++17", "-O2"]

FENCE = re.compile(r"^```(\w+)(.*)$")
# 제목에 "(조각)" 이 붙은 블록은 앞 블록의 정의를 이어받는다. 단독 실행이 불가능한 것이
# 정상이므로 건너뛴다. 이 표기는 검사기만이 아니라 독자에게도 같은 사실을 알린다 —
# STYLE.md §6.4 가 요구하는 "조각이면 조각임을 밝힌다" 를 한 번에 만족시킨다.
FRAGMENT = "(조각)"
# 표준입력을 읽는 코드는 입력 없이는 못 돌린다. 이런 블록은 챕터가 입력 예시를
# 본문에 함께 싣는 형태라 여기서 판정할 수 없다.
NEEDS_STDIN = re.compile(r"\binput\s*\(|sys\.stdin|std::cin|\bcin\s*>>|getline\s*\(")


def load_skips() -> dict[tuple[str, int], str]:
    skips: dict[tuple[str, int], str] = {}
    if not SKIPFILE.exists():
        return skips
    for raw in SKIPFILE.read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if not line or line.startswith("#"):
            continue
        loc, _, reason = line.partition("#")
        path, _, num = loc.strip().partition(":")
        if not num.strip().isdigit():
            continue
        skips[(path.strip(), int(num))] = reason.strip() or "(이유 없음)"
    return skips


def dual_blocks(md: str) -> list[tuple[int, dict[str, str]]]:
    """(::: dual 시작 줄번호, {lang: code}) 목록."""
    lines = md.split("\n")
    out: list[tuple[int, dict[str, str]]] = []
    i = 0
    while i < len(lines):
        if lines[i].strip() == "::: dual":
            start = i + 1
            i += 1
            blocks: dict[str, str] = {}
            while i < len(lines) and lines[i].strip() != ":::":
                m = FENCE.match(lines[i])
                if m:
                    lang = m.group(1)
                    if FRAGMENT in (m.group(2) or ""):
                        lang = "_frag_" + lang
                    i += 1
                    body: list[str] = []
                    while i < len(lines) and not lines[i].startswith("```"):
                        body.append(lines[i])
                        i += 1
                    i += 1
                    blocks.setdefault(lang, "\n".join(body))
                else:
                    i += 1
            out.append((start, blocks))
        i += 1
    return out


def has_diff_table(md: str, after_line: int, max_scan: int = 400) -> bool:
    """블록 뒤에 '언어 차이' 표가 있는가. 있으면 선언된 차이로 본다.

    줄 수로 자르면 안 된다. 코드가 길거나 console 블록·복잡도 서술이 사이에 끼면
    표가 100줄 넘게 밀리는데, 그것은 표가 없는 것이 아니라 챕터가 두꺼운 것이다.
    **다음 ::: dual 이 나오기 전까지**가 이 블록의 영역이다 — 그 뒤의 표는 남의 것이다.
    """
    lines = md.split("\n")
    end = min(len(lines), after_line + max_scan)
    for i in range(after_line, end):
        if lines[i].strip() == "::: dual":
            end = i
            break
    return "언어 차이" in "\n".join(lines[after_line:end])


# 생략 표시가 있는 줄은 대조하지 않는다. 챕터가 긴 출력의 앞부분만 싣는 것은
# 정당하고 흔하다("앞 9개" 식). 생략을 결함으로 세면 검사기가 시끄러워져 무시당한다.
ELISION = re.compile(r"\.\.\.|…|\(생략\)|이하 생략")


def next_console_block(md: str, after_line: int) -> tuple[int, list[str]] | None:
    """dual 블록 뒤에 처음 나오는 ```console 블록. 다음 dual 이나 다음 절 제목 전까지만 본다.

    본문이 싣는 출력과 실제 출력이 어긋나는 것은 독자가 절대 알아챌 수 없는 결함이다 —
    코드는 돌고 두 언어도 일치하는데 지면의 숫자만 옛날 것인 경우가 실제로 나온다.
    """
    lines = md.split("\n")
    i = after_line
    while i < len(lines):
        s = lines[i].strip()
        if s == "::: dual" or s.startswith("## "):
            return None
        if s.startswith("```console"):
            body: list[str] = []
            i += 1
            while i < len(lines) and not lines[i].startswith("```"):
                body.append(lines[i])
                i += 1
            return (i, body)
        i += 1
    return None


def console_mismatches(actual: str, shown: list[str]) -> list[str]:
    """본문에 실린 줄 중 실제 출력에 없는 것. 순서는 보지 않고 존재만 본다."""
    have = {ln.rstrip() for ln in actual.split("\n")}
    missing = []
    for ln in shown:
        t = ln.rstrip()
        if not t.strip() or ELISION.search(t):
            continue
        if t not in have:
            missing.append(t)
    return missing


def run(cmd: list[str], *, timeout: int = 90) -> tuple[int, str]:
    try:
        r = subprocess.run(cmd, capture_output=True, text=True, timeout=timeout)
        return r.returncode, (r.stdout or "") + (r.stderr or "")
    except subprocess.TimeoutExpired:
        return -1, "TIMEOUT"
    except FileNotFoundError as e:
        return -3, f"실행기 없음: {e}"


def main() -> int:
    args = [a for a in sys.argv[1:] if not a.startswith("-")]
    strict = "--strict" in sys.argv

    skips = load_skips()
    targets = sorted(CONTENT.rglob("*.md"))
    if args:
        targets = [t for t in targets if t.stem in args]

    tmp = pathlib.Path(tempfile.mkdtemp(prefix="algobook-code-"))
    total = ran = failed = undeclared = skipped = stale = 0

    for path in targets:
        rel = str(path.relative_to(ROOT))
        md = path.read_text(encoding="utf-8")

        for line, blocks in dual_blocks(md):
            total += 1
            if (rel, line) in skips:
                skipped += 1
                continue

            outs: dict[str, str] = {}

            py = blocks.get("python")
            if py and not NEEDS_STDIN.search(py):
                f = tmp / "x.py"
                f.write_text(py, encoding="utf-8")
                rc, out = run([PY, str(f)])
                ran += 1
                if rc != 0:
                    failed += 1
                    print(f"{rel}:{line}: Python 실행 실패 (rc={rc})")
                    print("    " + out.strip().replace("\n", "\n    ")[:400])
                else:
                    outs["python"] = out.rstrip()

            cpp = blocks.get("cpp")
            if cpp and not NEEDS_STDIN.search(cpp):
                f = tmp / "x.cpp"
                b = tmp / "x.bin"
                f.write_text(cpp, encoding="utf-8")
                rc, out = run(CXX + [str(f), "-o", str(b)], timeout=180)
                if rc != 0:
                    failed += 1
                    print(f"{rel}:{line}: C++ 컴파일 실패")
                    print("    " + out.strip().replace("\n", "\n    ")[:400])
                else:
                    rc2, out2 = run([str(b)])
                    ran += 1
                    if rc2 != 0:
                        failed += 1
                        print(f"{rel}:{line}: C++ 실행 실패 (rc={rc2})")
                        print("    " + out2.strip().replace("\n", "\n    ")[:400])
                    else:
                        outs["cpp"] = out2.rstrip()

            declared = False
            if "python" in outs and "cpp" in outs and outs["python"] != outs["cpp"]:
                if has_diff_table(md, line):
                    declared = True
                else:
                    undeclared += 1
                    print(f"{rel}:{line}: 두 언어 출력이 다른데 '언어 차이' 표가 없다")
                    print("    py : " + outs["python"].replace("\n", " / ")[:180])
                    print("    cpp: " + outs["cpp"].replace("\n", " / ")[:180])

            # 본문에 실린 출력과 실제 출력의 대조. 두 언어가 서로 일치하는 것만으로는
            # 지면의 숫자가 최신이라는 보장이 되지 않는다.
            cands = [v for v in (outs.get("python"), outs.get("cpp")) if v]
            if cands:
                found = next_console_block(md, line)
                if found:
                    cline, shown = found
                    # 언어 차이가 선언된 블록은 언어별 console 블록을 둘 두는 것이 정상이다.
                    # 어느 한쪽과도 안 맞을 때만 지면이 낡은 것이다. 더 적게 어긋난 후보를
                    # "실제 출력"으로 보여준다 — 어느 쪽과 비교했는지 독자가 알 수 있어야 한다.
                    best_actual, missing = min(
                        ((a, console_mismatches(a, shown)) for a in cands), key=lambda p: len(p[1])
                    )
                    if missing:
                        stale += 1
                        print(f"{rel}:{cline}: 본문 console 블록에 실제 출력에 없는 줄이 있다")
                        for m in missing[:4]:
                            print("    실린 것: " + m[:150])
                        print("    실제   : " + best_actual.replace("\n", " / ")[:200])

    print(
        f"\n::: dual {total}개 · 실행 {ran}회 · 실패 {failed} · "
        f"선언 없는 불일치 {undeclared} · 실린 출력 불일치 {stale} · 건너뜀 {skipped}"
    )
    if failed == 0 and undeclared == 0 and stale == 0:
        print("본문 코드 이상 없음.")

    if failed:
        return 1
    if (undeclared or stale) and strict:
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
