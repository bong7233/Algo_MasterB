#!/usr/bin/env python3
"""Anki 임포트용 CSV 3종을 만든다 (CLAUDE.md §2-5).

    dist/anki/01_classify.csv    ::: classify 블록      — 유형 판별
    dist/anki/02_complexity.csv  각 챕터의 복잡도 표기  — 시간·공간
    dist/anki/03_patterns.csv    content/glossary.json  — 패턴·용어

왜 Anki 인가: 무료·오픈소스이고 AnkiDroid/AnkiMobile 로 폰에서 그대로 열린다.
별도 앱을 만들 이유가 없다. 알고리즘은 안 쓰면 즉시 휘발하므로(A-12) 반복은
앱 안의 SRS(§2-6)와 폰의 Anki 양쪽에서 돈다.

CSV 형식: UTF-8 / 쉼표 / **모든 필드 큰따옴표** / 기본 헤더 없음.
모든 필드를 인용하는 이유는 두 가지다. 본문에 쉼표가 흔하고, Anki 의 텍스트
임포터는 `#` 으로 시작하는 줄을 지시문으로 읽는다 — 전부 인용하면 어떤 줄도
`"` 로 시작하므로 그 함정에 걸리지 않는다.

사용법:
    python tools/export_flashcards.py
    python tools/export_flashcards.py --header      # 첫 줄에 Front,Back 추가
    python tools/export_flashcards.py --out dist/anki
"""

from __future__ import annotations

import argparse
import csv
import json
import re
import sys
from pathlib import Path

if sys.stdout is not None and hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

import build  # noqa: E402  (::: classify 파서를 빌드와 공유한다)

GLOSSARY = ROOT / "content" / "glossary.json"

COMPLEXITY_RE = re.compile(r"\*\*\s*복잡도\s*[:：]?\s*\*\*\s*[:：]?\s*(.+)$")
CODE_TITLE_RE = re.compile(r'^\s*`{3,}\s*\w+.*title\s*=\s*"([^"]+)"')
HEADING_RE = re.compile(r"^#{2,4}\s+(.+?)\s*$")


# $O(\log n)$ 같은 표기의 최소 정리. 앱과 같은 방침이다(CONTRACT §2.6) —
# 수식 렌더링 엔진이 없으므로 원문을 살리되 역슬래시 명령만 읽을 수 있게 바꾼다.
TEX = {
    r"\log": "log", r"\ln": "ln", r"\lg": "lg", r"\max": "max", r"\min": "min",
    r"\cdot": "·", r"\times": "×", r"\le": "≤", r"\ge": "≥", r"\neq": "≠",
    r"\alpha": "α", r"\ldots": "…", r"\dots": "…", r"\,": " ", r"\;": " ",
}


def clean(text: str) -> str:
    """마크다운 장식을 걷어낸다. 카드 앞뒤에 `**` 가 그대로 보이면 산만하다."""
    t = text.strip()
    t = re.sub(r"\$\$?([^$]*)\$\$?", r"\1", t)  # 수식 구분자
    for k, v in TEX.items():
        t = t.replace(k, v)
    t = re.sub(r"`([^`]*)`", r"\1", t)
    t = re.sub(r"\*\*([^*]*)\*\*", r"\1", t)
    t = re.sub(r"(?<!\*)\*([^*]+)\*(?!\*)", r"\1", t)
    t = re.sub(r"\[([^\]]*)\]\([^)]*\)", r"\1", t)  # 링크는 텍스트만
    t = re.sub(r"\s+", " ", t)
    return t.strip()


# --------------------------------------------------------------------------
# 덱 1 — 유형 판별
# --------------------------------------------------------------------------

def deck_classify(chapters: list[tuple[str, str, str, str]]) -> list[list[str]]:
    """앞면: 신호어 + 제약조건 / 뒷면: 챕터 제목 + 혼동 주의.

    앞면에 알고리즘 이름이 들어가면 안 된다 — 그 순간 카드가 답을 알려준다.
    이 덱이 훈련하는 것은 "지문을 보고 유형을 맞히는" 능력이다(A-06).
    """
    rows = []
    for cid, num, title, md in chapters:
        for item in build.collect_classify(cid, num, title, md):
            front_bits = []
            if item["signals"]:
                front_bits.append("신호어: " + clean(item["signals"]))
            if item["constraints"]:
                front_bits.append("제약조건: " + clean(item["constraints"]))
            if not front_bits:
                continue
            back_bits = [f'{num} {title}']
            if item["confusion"]:
                back_bits.append("혼동 주의: " + clean(item["confusion"]))
            if item["traps"]:
                back_bits.append("반례 함정: " + clean(item["traps"]))
            rows.append([" / ".join(front_bits), " / ".join(back_bits)])
    return rows


# --------------------------------------------------------------------------
# 덱 2 — 복잡도
# --------------------------------------------------------------------------

def deck_complexity(chapters: list[tuple[str, str, str, str]]) -> list[list[str]]:
    """`**복잡도:**` 줄을 카드로. 앞면은 "무엇의 복잡도인가"다.

    무엇의 복잡도인지는 바로 위 코드 블록의 title= 이 가장 정확하다.
    없으면 소제목, 그것도 없으면 챕터 제목으로 물러선다.
    """
    rows = []
    for _cid, num, title, md in chapters:
        lines = md.split("\n")
        for i, ln in enumerate(lines):
            m = COMPLEXITY_RE.search(ln)
            if not m:
                continue

            body = [m.group(1).strip()]
            # 복잡도 근거(§4-4)가 다음 줄로 이어지는 경우가 있다. 빈 줄 전까지 붙인다.
            for nxt in lines[i + 1 : i + 3]:
                if not nxt.strip() or re.match(r"^\s*(#|\||:::|`{3,}|>)", nxt):
                    break
                body.append(nxt.strip())

            # 80줄까지 거슬러 본다. `::: dual` 의 코드가 길어서 40줄로는
            # title= 에 닿지 못하고 챕터 제목으로 밀려나는 일이 실제로 있었다.
            subject = ""
            for back in range(i - 1, max(i - 80, -1), -1):
                cm = CODE_TITLE_RE.match(lines[back])
                if cm:
                    subject = cm.group(1)
                    break
                hm = HEADING_RE.match(lines[back])
                if hm:
                    subject = re.sub(r"^\d+\.\s*", "", hm.group(1))
                    break
            name = clean(subject) or title
            rows.append(
                [f"{name} ({num}) — 시간·공간 복잡도?", clean(" ".join(body))]
            )
    return rows


# --------------------------------------------------------------------------
# 덱 3 — 패턴·용어
# --------------------------------------------------------------------------

def deck_patterns() -> list[list[str]]:
    """glossary.json → 용어 카드.

    스키마가 아직 확정 전이라 흔한 키 이름을 모두 받아넘긴다. 용어 사전
    담당이 키를 바꿨다고 내보내기가 죽으면 마일스톤이 멈춘다.
    """
    if not GLOSSARY.exists():
        return []
    try:
        data = json.loads(GLOSSARY.read_text(encoding="utf-8"))
    except json.JSONDecodeError as e:
        print(f"[경고] glossary.json 을 읽지 못했다: {e}")
        return []

    items: list[tuple[str, dict | str]] = []
    if isinstance(data, list):
        items = [(str(i), it) for i, it in enumerate(data)]
    elif isinstance(data, dict):
        for key in ("terms", "entries", "items", "glossary"):
            if isinstance(data.get(key), list):
                items = [(str(i), it) for i, it in enumerate(data[key])]
                break
        else:
            items = list(data.items())

    def pick(d: dict, *keys: str) -> str:
        for k in keys:
            v = d.get(k)
            if isinstance(v, str) and v.strip():
                return v.strip()
            if isinstance(v, list) and v:
                return ", ".join(str(x) for x in v)
        return ""

    rows = []
    for key, it in items:
        if isinstance(it, str):
            term, definition, example, chapter = key, it, "", ""
        elif isinstance(it, dict):
            term = pick(it, "term", "name", "title", "용어") or key
            definition = pick(it, "def", "definition", "desc", "description", "정의")
            example = pick(it, "example", "usage", "domain", "실사례", "practice")
            chapter = pick(it, "chapter", "ch", "first", "defined_in")
        else:
            continue
        if not term or not definition:
            continue
        back = clean(definition)
        if example:
            back += " · 실사례: " + clean(example)
        if chapter:
            back += f" ({chapter})"
        rows.append([clean(term), back])
    return rows


# --------------------------------------------------------------------------

def write_csv(path: Path, rows: list[list[str]], header: bool) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    # newline="": csv 모듈이 줄 끝을 직접 넣는다. 이걸 빼면 윈도우에서 \r\r\n 이 된다.
    with path.open("w", encoding="utf-8", newline="") as f:
        w = csv.writer(f, quoting=csv.QUOTE_ALL, lineterminator="\n")
        if header:
            w.writerow(["Front", "Back"])
        w.writerows(rows)


def main() -> int:
    ap = argparse.ArgumentParser(description="Anki CSV 내보내기 (CLAUDE.md §2-5)")
    ap.add_argument("--out", default="dist/anki", help="출력 디렉터리")
    ap.add_argument("--header", action="store_true", help="첫 줄에 Front,Back 추가")
    args = ap.parse_args()

    out_dir = (ROOT / args.out) if not Path(args.out).is_absolute() else Path(args.out)

    try:
        toc = build.load_toc()
    except SystemExit as e:
        print(e)
        return 1

    chapters: list[tuple[str, str, str, str]] = []
    for part in toc["parts"]:
        for ch in part["chapters"]:
            path = build.find_doc(ch["id"])
            if path is None:
                continue
            chapters.append(
                (ch["id"], ch["num"], ch["title"], path.read_text(encoding="utf-8"))
            )

    decks = [
        ("01_classify.csv", deck_classify(chapters), "::: classify"),
        ("02_complexity.csv", deck_complexity(chapters), "복잡도 표기"),
        ("03_patterns.csv", deck_patterns(), "glossary.json"),
    ]

    made = 0
    for name, rows, src in decks:
        if not rows:
            print(f"{name}: 소스({src})가 비어 있어 건너뛴다.")
            continue
        write_csv(out_dir / name, rows, args.header)
        made += 1
        print(f"{name}: {len(rows)}장")

    if made:
        rel = out_dir.relative_to(ROOT) if out_dir.is_relative_to(ROOT) else out_dir
        print(f"\n{rel} 에 덱 {made}종을 썼다. Anki 에서 파일 → 가져오기.")
    else:
        print("\n만들 덱이 없다. 챕터를 먼저 쓸 것.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
