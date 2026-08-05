#!/usr/bin/env python3
"""아스키 다이어그램의 상자 정렬을 검사한다 (STYLE.md §6.3 / CLAUDE.md §4-9).

왜 필요한가: 한글은 고정폭 글꼴에서 두 칸을 차지한다(East Asian Width = W/F).
상자 안에 한글을 한 글자만 넣어도 테두리가 어긋나는데, 원본 텍스트에서는
줄이 맞아 보여서 사람 눈으로는 잡기 어렵다.

검사 규칙 — 두 칸 문자가 **선 문자보다 왼쪽에** 오면 그 줄의 선이 밀린다.
그래서 딱 그것만 잡는다. 선보다 오른쪽의 꼬리 주석은 한글이어도 무해하다.

  OK   ├── node        <- 설명은 한글이어도 된다 (선보다 오른쪽)
  OK   a ──▶ ┌──────┐
  BAD  정점 2개  ┌───┐   (한글이 상자를 오른쪽으로 밀어낸다)
  BAD  │ 정점 객체 │      (상자 안의 한글이 테두리를 깬다)

사용법:
    python tools/check_diagrams.py            # 경고만, 종료 코드 0
    python tools/check_diagrams.py --strict   # 문제가 있으면 종료 코드 1

기본 종료 코드가 0인 이유: 다이어그램 정렬은 CLAUDE.md §7-3의 "콘텐츠 규범
경고" 쪽이다. CI 를 빨갛게 만들 대상은 빌드 실패와 깨진 내부 링크뿐이다.
집필 중인 그림 한 줄 때문에 파이프라인 전체가 막히면 안 된다.
"""

from __future__ import annotations

import argparse
import re
import sys
import unicodedata
from pathlib import Path

if sys.stdout is not None and hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

ROOT = Path(__file__).resolve().parent.parent
CONTENT = ROOT / "content"

# 화살표(▶ ◀)도 선의 일부로 센다 — `a ──▶ b` 처럼 선의 오른쪽 끝에 오므로
# 이것을 빼면 화살표 뒤에 시작하는 상자의 밀림을 놓친다.
LINE_CHARS = "│┌┐└┘├┤┬┴┼─▶◀"


def is_wide(c: str) -> bool:
    """고정폭 글꼴에서 두 칸을 차지하는가.

    박스 드로잉 문자와 화살표(◀ ▶)는 East Asian Width 가 'A'(모호)지만,
    이 책이 쓰는 라틴 계열 고정폭 글꼴에서는 한 칸으로 그려진다. 그래서
    'W'/'F'(한글·한자·전각) 만 두 칸으로 센다.
    """
    return unicodedata.east_asian_width(c) in ("W", "F")


def find_text_blocks(md: str) -> list[tuple[int, list[str]]]:
    """```text 펜스의 (본문 첫 줄 번호 0-base, 줄들) 목록.

    ```text nolines 처럼 뒤에 옵션이 붙어도 같은 블록이다.
    """
    blocks: list[tuple[int, list[str]]] = []
    lines = md.split("\n")
    i = 0
    while i < len(lines):
        if not re.match(r"^\s*```text\b", lines[i]):
            i += 1
            continue
        start = i + 1
        body: list[str] = []
        i += 1
        while i < len(lines) and not re.match(r"^\s*```\s*$", lines[i]):
            body.append(lines[i])
            i += 1
        blocks.append((start, body))
        i += 1
    return blocks


def check_block(path_label: str, start: int, body: list[str]) -> list[str]:
    problems = []
    for n, ln in enumerate(body):
        last_line_char = max(
            (i for i, c in enumerate(ln) if c in LINE_CHARS), default=-1
        )
        if last_line_char < 0:
            continue  # 선이 없는 줄은 아무것도 밀어내지 못한다
        offenders = sorted({c for c in ln[:last_line_char] if is_wide(c)})
        if offenders:
            problems.append(
                f"{path_label}:{start + n + 1}: 선 문자 왼쪽에 두 칸 문자 "
                f"{''.join(offenders)!r} — 이 줄의 선이 밀린다. "
                f"선 왼쪽에는 ASCII만 쓸 것\n    {ln!r}"
            )
    return problems


def main() -> int:
    ap = argparse.ArgumentParser(description="아스키 다이어그램 정렬 검사")
    ap.add_argument(
        "--strict", action="store_true", help="문제가 있으면 종료 코드 1"
    )
    args = ap.parse_args()

    bad = 0
    for md_path in sorted(CONTENT.rglob("*.md")):
        md = md_path.read_text(encoding="utf-8")
        label = str(md_path.relative_to(ROOT))
        for start, body in find_text_blocks(md):
            for p in check_block(label, start, body):
                bad += 1
                print(p)

    if bad:
        print(f"\n아스키 다이어그램 문제 {bad}건.")
        return 1 if args.strict else 0
    print("아스키 다이어그램 정렬 이상 없음.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
