#!/usr/bin/env python3
"""내부 참조 무결성 검사 — 링크·위젯 타입·제목·다음 절.

이 검사기만 유일하게 CI 를 빨갛게 만들 수 있다(CLAUDE.md §7-3):
**깨진 내부 링크는 종료 코드 1.** 나머지(미구현 위젯, 제목 불일치,
다음 절 누락)는 경고이고 종료 코드 0이다.

왜 링크만 실패인가: 깨진 `#/id` 는 독자가 클릭했을 때 빈 화면이 뜨는
런타임 버그다. 반면 아직 안 만든 위젯은 자리표시자가 뜨고 책은 읽힌다.

검사 항목
    1. 본문의 `[텍스트](#/id)` 가 toc.json 의 id 로 풀리는가      → 에러
    2. `::: widget <type>` 이 assets/widgets/<type>.js 이거나
       CLAUDE.md §5 위젯 표에 있는가                              → 경고
    3. `# 제목` H1 이 toc.json 의 num + title 과 정확히 같은가    → 경고
    4. `**다음 절**` 링크가 있고 살아 있는 id 를 가리키는가        → 경고 / 에러

사용법:
    python tools/check_links.py
"""

from __future__ import annotations

import argparse
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

import build  # noqa: E402  (상자·펜스 파서를 빌드와 공유한다)

CONTENT = ROOT / "content"
WIDGET_DIR = ROOT / "assets" / "widgets"
CLAUDE_MD = ROOT / "CLAUDE.md"

# 챕터가 아닌 앱 내부 경로. app.js 가 처리하는 특수 라우트다.
APP_ROUTES = {"", "/", "home", "glossary", "problems", "search", "review", "index"}

LINK_RE = re.compile(r"\[[^\]\n]*\]\(#/([^)\s]*)\)")
WIDGET_RE = re.compile(r"^:::\s*widget\s+([A-Za-z0-9_.-]+)")
NEXT_RE = re.compile(r"\*\*다음\s*절\*\*")


def widget_table_types() -> set[str]:
    """CLAUDE.md §5 위젯 표에 이름이 올라 있는 타입들.

    표에 있으면 "계획된 위젯"이므로 아직 파일이 없어도 경고로 끝낸다.
    표에도 없는 타입은 오타일 가능성이 높아 따로 알린다.
    """
    if not CLAUDE_MD.exists():
        return set()
    text = CLAUDE_MD.read_text(encoding="utf-8")
    # 제목에 "위젯"이 들어간 절만 본다. 그냥 `^## 5\.` 로 잡으면 §4-10 챕터
    # 템플릿 안의 `## 5. 어디에 쓰이는가` 가 먼저 걸린다 — 실제로 걸렸다.
    # (re.S 에서 `.` 는 개행도 먹으므로 제목 줄은 [^\n]* 로 묶는다.)
    m = re.search(r"^##[ \t][^\n]*위젯[^\n]*\n(.*?)(?=^##[ \t]|\Z)", text, re.S | re.M)
    section = m.group(1) if m else text
    types = set()
    for row in re.findall(r"^\|\s*`([a-z0-9-]+)`\s*\|", section, re.M):
        types.add(row)
    return types


class Reporter:
    def __init__(self) -> None:
        self.warns = 0
        self.errors = 0

    def _say(self, path, line: int, msg: str) -> None:
        rel = path if isinstance(path, str) else str(Path(path).relative_to(ROOT))
        print(f"{rel}:{line}: {msg}")

    def warn(self, path, line: int, msg: str) -> None:
        self.warns += 1
        self._say(path, line, msg)

    def error(self, path, line: int, msg: str) -> None:
        self.errors += 1
        self._say(path, line, f"[에러] {msg}")


def main() -> int:
    argparse.ArgumentParser(description="내부 참조 무결성 검사").parse_args()

    rp = Reporter()
    try:
        toc = build.load_toc()
    except SystemExit as e:
        print(e)
        return 1

    chapter_ids: list[str] = []
    meta: dict[str, dict] = {}
    for part in toc["parts"]:
        for ch in part["chapters"]:
            chapter_ids.append(ch["id"])
            meta[ch["id"]] = ch
    valid_ids = set(chapter_ids) | {p["id"] for p in toc["parts"]} | APP_ROUTES

    table = widget_table_types()
    have_widget = (
        {p.stem for p in WIDGET_DIR.glob("*.js")} if WIDGET_DIR.exists() else set()
    )

    for idx, cid in enumerate(chapter_ids):
        path = build.find_doc(cid)
        if path is None:
            continue
        md = path.read_text(encoding="utf-8")
        lines = md.split("\n")
        mask = build.code_fence_mask(lines)

        # 3. H1 이 toc 의 num + title 과 정확히 같은가 (STYLE.md §3)
        expect = f'{meta[cid]["num"]} {meta[cid]["title"]}'
        h1_line = next(
            (i for i, ln in enumerate(lines) if not mask[i] and ln.startswith("# ")),
            None,
        )
        if h1_line is None:
            rp.warn(path, 1, "H1 `# 제목` 이 없다 — toc.json 의 num + title 과 같아야 한다")
        else:
            got = lines[h1_line][2:].strip()
            if got != expect:
                rp.warn(
                    path,
                    h1_line + 1,
                    f"H1 불일치: 본문 {got!r} ≠ toc.json {expect!r} (STYLE.md §3)",
                )

        # 1. 내부 링크
        for i, ln in enumerate(lines):
            if mask[i]:
                continue  # 코드 예시 안의 링크 문법은 참조가 아니다
            for target in LINK_RE.findall(ln):
                tid = target.strip().split("?")[0].split("#")[0]
                if tid not in valid_ids:
                    rp.error(
                        path,
                        i + 1,
                        f"내부 링크 `#/{target}` 가 toc.json 에 없는 id 다",
                    )

        # 2. 위젯 타입
        for i, ln in enumerate(lines):
            if mask[i]:
                continue
            m = WIDGET_RE.match(ln.strip())
            if not m:
                continue
            t = m.group(1)
            if t in have_widget:
                continue
            if t in table:
                rp.warn(
                    path,
                    i + 1,
                    f"위젯 `{t}` 는 §5 표에 있으나 assets/widgets/{t}.js 가 아직 없다 "
                    "— 자리표시자로 렌더된다",
                )
            else:
                rp.warn(
                    path,
                    i + 1,
                    f"위젯 `{t}` 는 §5 위젯 표에도 없고 파일도 없다 — 오타인지 확인할 것",
                )

        # 4. 다음 절
        is_last = idx == len(chapter_ids) - 1
        nxt = [
            (i, ln) for i, ln in enumerate(lines) if not mask[i] and NEXT_RE.search(ln)
        ]
        if not nxt:
            if not is_last:
                rp.warn(
                    path,
                    len(lines),
                    "마지막 줄의 **다음 절** 링크가 없다 (CLAUDE.md §4-10 템플릿)",
                )
        else:
            i, ln = nxt[-1]
            targets = LINK_RE.findall(ln)
            if not targets:
                rp.warn(path, i + 1, "**다음 절** 에 `#/id` 링크가 없다")
            else:
                # 링크 자체의 유효성은 위에서 이미 에러로 잡았다. 여기서는
                # "다음 절인데 자기 자신을 가리키는" 흔한 복사 실수만 더 본다.
                if targets[-1] == cid:
                    rp.warn(path, i + 1, "**다음 절** 이 자기 자신을 가리킨다")
                elif not is_last and targets[-1] != chapter_ids[idx + 1]:
                    rp.warn(
                        path,
                        i + 1,
                        f"**다음 절** 이 `#/{targets[-1]}` 인데 toc.json 상 다음 절은 "
                        f"`#/{chapter_ids[idx + 1]}` 다",
                    )

    print()
    if rp.errors:
        print(f"깨진 내부 링크 {rp.errors}건 — CI 실패 대상(§7-3). 경고 {rp.warns}건.")
        return 1
    print(f"내부 링크 이상 없음. 경고 {rp.warns}건.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
