#!/usr/bin/env python3
"""집필 규범 검사기 — CLAUDE.md §7-1 의 7개 항목.

빌드를 막지 않는다. 종료 코드는 기본 0이고 `--strict` 일 때만 1이 된다.
왜: §7-1 이 "실패해도 빌드는 막지 않는다(경고만)"고 못박았다. 집필 중인
챕터의 미완성 상태 때문에 번들이 안 나오면 아무것도 확인할 수 없다.

출력은 `path:line: message` 한 줄 형식이다. 에디터·터미널에서 그대로
클릭해 그 줄로 점프하기 위해서다.

검사 항목
    1. `::: dual` 에 python 과 cpp 가 둘 다 있는가
    2. §4-5 필수 목록 챕터에 `::: trace` 가 있는가
    3. Part II~X 알고리즘 챕터에 `::: classify` 가 있는가
    4. `::: dual` 뒤 20줄 안에 복잡도 표기가 있는가
    5. 챕터 대비 glossary.json 항목이 늘었는가
    6. 본문이 6,000자 이상인가 (§4 밀도)
    7. `::: classify` 에 4항목이 다 있는가

사용법:
    python tools/check_content.py
    python tools/check_content.py --strict     # 경고가 있으면 종료 코드 1
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

# 상자·펜스 파서는 build.py 것을 그대로 쓴다.
# 왜 복사하지 않는가: 검사기가 build.py 와 다르게 파싱하면 "빌드는 수집했는데
# 검사기는 못 본" 상자가 생긴다. 그 순간 이 검사기는 거짓말을 시작한다.
import build  # noqa: E402

CONTENT = ROOT / "content"
GLOSSARY = CONTENT / "glossary.json"

MIN_CHARS = 6000  # §4 밀도 하한

# §4-5 손추적 필수 챕터 (생략 불가)
TRACE_REQUIRED = {
    "iii-4": "백트래킹",
    "iv-2": "DFS",
    "iv-3": "BFS",
    "v-1": "다익스트라",
    "vi-3": "투 포인터",
    "vii-1": "이분 탐색(경계 조건)",
    "ix-1": "유니온 파인드(경로 압축)",
    "ix-2": "세그먼트 트리(구간 분해)",
    "ix-7": "KMP(실패 함수)",
    "xv-2": "B-Tree(분할)",
    "xv-3": "LSM(컴팩션)",
    "xv-8": "일관성 해싱(노드 추가 시 재배치)",
}
# "모든 DP 챕터" — 챕터가 늘어나도 자동으로 걸리도록 접두사로 본다.
TRACE_REQUIRED_PREFIX = ("viii-",)

# §2-3: `::: classify` 는 Part II~X 의 모든 알고리즘 챕터에 필수.
# id 의 로마자 접두사로 판단한다. xi/xii/xiii/xv 는 여기 해당하지 않는다.
CLASSIFY_PARTS = {"ii", "iii", "iv", "v", "vi", "vii", "viii", "ix", "x"}

COMPLEXITY_RE = re.compile(r"O\s*\(|복잡도")


class Reporter:
    def __init__(self) -> None:
        self.n = 0

    def warn(self, path: Path | str, line: int, msg: str) -> None:
        rel = path if isinstance(path, str) else str(path.relative_to(ROOT))
        self.n += 1
        print(f"{rel}:{line}: {msg}")


def part_prefix(cid: str) -> str:
    return cid.split("-", 1)[0].lower()


def fence_langs(body: list[str]) -> list[str]:
    """상자 본문에 들어 있는 코드 펜스의 언어 목록."""
    return [
        m.group(1).lower()
        for m in (re.match(r"^\s*`{3,}\s*([A-Za-z+#]+)", ln) for ln in body)
        if m
    ]


def glossary_entries() -> tuple[int, set[str]]:
    """glossary.json 의 (항목 수, 언급된 챕터 id 집합).

    스키마가 아직 확정 전이라 흔한 형태를 모두 받아넘긴다. 용어 사전 담당이
    키 이름을 바꿨다고 검사기가 죽으면 안 된다.
    """
    if not GLOSSARY.exists():
        return 0, set()
    try:
        data = json.loads(GLOSSARY.read_text(encoding="utf-8"))
    except json.JSONDecodeError:
        return 0, set()

    items: list = []
    if isinstance(data, list):
        items = data
    elif isinstance(data, dict):
        for key in ("terms", "entries", "items", "glossary"):
            if isinstance(data.get(key), list):
                items = data[key]
                break
        else:
            items = list(data.values())

    chapters: set[str] = set()
    for it in items:
        if isinstance(it, dict):
            for key in ("chapter", "ch", "first", "defined_in", "src"):
                v = it.get(key)
                if isinstance(v, str) and v:
                    chapters.add(v.lower())
                    break
    return len(items), chapters


def check_chapter(rp: Reporter, path: Path, cid: str, md: str) -> None:
    lines = md.split("\n")

    # 1. 이중 언어 누락
    for start, body in build.iter_boxes(md, "dual"):
        langs = fence_langs(body)
        has_py = "python" in langs or "py" in langs
        has_cpp = "cpp" in langs or "c++" in langs
        if not (has_py and has_cpp):
            missing = "C++" if has_py else ("Python" if has_cpp else "Python·C++")
            rp.warn(
                path,
                start,
                f"::: dual 에 {missing} 코드가 없다 — 이중 언어는 이 책의 정체성이다(§2-2)",
            )

        # 4. 복잡도 표기 누락 — 상자가 닫힌 뒤 20줄 안 (느슨한 검사)
        end = start + len(body)  # 닫는 ::: 의 0-base 인덱스
        tail = "\n".join(lines[end + 1 : end + 21])
        if not COMPLEXITY_RE.search(tail):
            rp.warn(
                path,
                end + 1,
                "::: dual 뒤 20줄 안에 복잡도 표기가 없다 — 근거 한 줄까지 붙일 것(§4-4)",
            )

    # 2. ::: trace 누락
    needs_trace = cid in TRACE_REQUIRED or cid.startswith(TRACE_REQUIRED_PREFIX)
    if needs_trace and not build.iter_boxes(md, "trace"):
        why = TRACE_REQUIRED.get(cid, "DP 챕터")
        rp.warn(path, 1, f"::: trace 가 없다 — {why} 는 손추적 필수 챕터다(§4-5)")

    # 3·7. ::: classify 누락 / 4항목 누락
    boxes = build.iter_boxes(md, "classify")
    if not boxes and part_prefix(cid) in CLASSIFY_PARTS:
        rp.warn(
            path,
            1,
            "::: classify 가 없다 — 플래시카드 덱과 Part I 부록에 구멍이 난다(§2-3)",
        )
    for start, body in boxes:
        got = build.parse_classify_body(body)
        lack = [
            label
            for label, key in (
                ("신호어", "signals"),
                ("제약조건", "constraints"),
                ("혼동 주의", "confusion"),
                ("반례 함정", "traps"),
            )
            if not got.get(key)
        ]
        if lack:
            rp.warn(
                path,
                start,
                f"::: classify 에 {', '.join(lack)} 항목이 비었다 — 4항목 전부 필요(§5.2)",
            )

    # 6. 밀도
    chars = build.word_count(md)
    if chars < MIN_CHARS:
        rp.warn(
            path,
            1,
            f"본문 {chars:,}자 — 기준 {MIN_CHARS:,}자 미만(§4). "
            "늘리라는 뜻이 아니라 빠진 단계가 없는지 보라는 뜻이다",
        )


def main() -> int:
    ap = argparse.ArgumentParser(description="집필 규범 검사 (CLAUDE.md §7-1)")
    ap.add_argument("--strict", action="store_true", help="경고가 있으면 종료 코드 1")
    args = ap.parse_args()

    rp = Reporter()

    try:
        toc = build.load_toc()
    except SystemExit as e:
        print(e)
        return 1 if args.strict else 0

    written: list[str] = []
    for part in toc["parts"]:
        for ch in part["chapters"]:
            cid = ch["id"]
            path = build.find_doc(cid)
            if path is None:
                continue
            written.append(cid)
            check_chapter(rp, path, cid, path.read_text(encoding="utf-8"))

    # 5. 용어 사전 갱신
    n_terms, covered = glossary_entries()
    if n_terms == 0:
        rp.warn(
            "content/glossary.json",
            1,
            "용어 항목이 0개다 — 챕터를 쓰면 용어도 같이 쌓여야 한다(§7-1.5)",
        )
    else:
        naked = [c for c in written if c not in covered]
        if naked:
            head = ", ".join(naked[:8]) + (" …" if len(naked) > 8 else "")
            rp.warn(
                "content/glossary.json",
                1,
                f"glossary.json 이 다루지 않는 챕터 {len(naked)}개: {head} "
                "— 새 챕터를 썼는데 추가 용어가 0개는 아닌지 볼 것",
            )

    if rp.n:
        print(f"\n콘텐츠 경고 {rp.n}건. (경고는 빌드를 막지 않는다 — §7-1)")
        return 1 if args.strict else 0
    print("콘텐츠 규범 이상 없음.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
