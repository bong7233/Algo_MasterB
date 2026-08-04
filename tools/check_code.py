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


def has_diff_table(md: str, after_line: int, window: int = 90) -> bool:
    """블록 뒤에 '언어 차이' 표가 있는가. 있으면 선언된 차이로 본다."""
    lines = md.split("\n")
    chunk = "\n".join(lines[after_line : after_line + window])
    return "언어 차이" in chunk


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
    total = ran = failed = undeclared = skipped = 0

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
                    outs["python"] = out.strip()

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
                        outs["cpp"] = out2.strip()

            if "python" in outs and "cpp" in outs and outs["python"] != outs["cpp"]:
                if has_diff_table(md, line):
                    continue  # 선언된 차이
                undeclared += 1
                print(f"{rel}:{line}: 두 언어 출력이 다른데 '언어 차이' 표가 없다")
                print("    py : " + outs["python"].replace("\n", " / ")[:180])
                print("    cpp: " + outs["cpp"].replace("\n", " / ")[:180])

    print(
        f"\n::: dual {total}개 · 실행 {ran}회 · 실패 {failed} · "
        f"선언 없는 불일치 {undeclared} · 건너뜀 {skipped}"
    )
    if failed == 0 and undeclared == 0:
        print("본문 코드 이상 없음.")

    if failed:
        return 1
    if undeclared and strict:
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
