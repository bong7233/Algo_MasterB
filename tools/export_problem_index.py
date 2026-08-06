#!/usr/bin/env python3
"""docs/PROBLEM_INDEX.md 를 만든다 (CLAUDE.md §7·§8).

    docs/PROBLEM_INDEX.md    유형 ↔ 대표문제 색인. Part → 챕터 → 대표문제 순.

앱 안의 "문제 색인" 페이지(assets/app.js `renderProblems`)와 같은 데이터
(`build.collect_problems`)에서 나온다 — 마크다운의 `::: quiz` 안 대표문제
한 줄("**N. 백준 NNNN 제목 (난도)**")을 파싱한 것이 유일한 원천이다.
이 문서는 그 결과를 저장소를 훑어보는 사람(앱을 굳이 켜지 않고 GitHub에서
읽는 경우)을 위해 스냅샷으로 남긴 것이다 — glossary.json처럼 직접 고치는
파일이 아니라 algobook.html·dist/anki 처럼 **생성 산출물**이다.

사용법:
    python tools/export_problem_index.py
"""

from __future__ import annotations

import sys
from pathlib import Path

if sys.stdout is not None and hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

import build  # noqa: E402  (::: quiz 파서를 빌드와 공유한다)

OUT = ROOT / "docs" / "PROBLEM_INDEX.md"


def main() -> int:
    try:
        toc = build.load_toc()
    except SystemExit as e:
        print(e)
        return 1

    problems: list[dict] = []
    for part in toc["parts"]:
        for ch in part["chapters"]:
            path = build.find_doc(ch["id"])
            if path is None:
                continue
            md = path.read_text(encoding="utf-8")
            problems.extend(
                build.collect_problems(ch["id"], ch["num"], ch["title"], part["num"], part["title"], md)
            )

    if not problems:
        print("대표문제가 없다. 챕터를 먼저 쓸 것.")
        return 0

    # Part → 챕터 순으로 묶는다. toc.json 순서가 이미 계보 순서다.
    by_part: dict[str, dict] = {}
    order: list[str] = []
    for p in problems:
        if p["partNum"] not in by_part:
            by_part[p["partNum"]] = {"title": p["partTitle"], "items": []}
            order.append(p["partNum"])
        by_part[p["partNum"]]["items"].append(p)

    lines = [
        "# 문제 색인",
        "",
        "각 챕터의 `::: quiz`에 실린 대표문제를 Part 순서대로 모은 것이다. "
        "`python tools/export_problem_index.py`로 자동 생성한다 — **직접 고치지 마라.** "
        "정답 코드는 싣지 않는다(A-10) — 문제를 찾으면 그 챕터로 가서 사고과정을 읽는다.",
        "",
        f"총 {len(problems)}개.",
        "",
    ]
    for part_num in order:
        g = by_part[part_num]
        lines.append(f"## {part_num} — {g['title']}")
        lines.append("")
        lines.append("| 번호 | 제목 | 난도 | 챕터 |")
        lines.append("|---|---|---|---|")
        for it in g["items"]:
            lines.append(
                f"| [{it['id']}]({it['url']}) | {it['title']} | {it['diff']} | "
                f"[{it['num']}](#/{it['chapter']}) |"
            )
        lines.append("")

    OUT.write_text("\n".join(lines), encoding="utf-8", newline="\n")
    print(f"{OUT.relative_to(ROOT)}: {len(problems)}개, Part {len(order)}개")
    return 0


if __name__ == "__main__":
    sys.exit(main())
