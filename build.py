#!/usr/bin/env python3
"""content/ 의 마크다운을 브라우저가 바로 읽는 번들로 묶는다.

왜 번들인가: file:// 로 index.html 을 열면 fetch()가 CORS로 막힌다.
<script> 태그로 읽히는 JS 파일에 JSON을 박아두면 서버 없이도 동작한다.
(CLAUDE.md §2-1)

산출물
    assets/bundle.js          window.BOOK  — meta / toc / docs / classify
    assets/widgets.bundle.js  assets/widgets/*.js 를 하나로 이어붙인 것
    algobook.html             --single 일 때만. 전부 인라인된 단일 파일

사용법
    python build.py              # 한 번 빌드 + 검사기 3종 실행(경고만)
    python build.py --no-lint    # 검사기 건너뛰기
    python build.py --watch      # 파일 변경 시 자동 재빌드
    python build.py --serve      # 로컬 서버 (휴대폰 접속용)
    python build.py --single     # algobook.html 하나로 합치기
"""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import socket
import sys
import time
from pathlib import Path

# Windows 콘솔 기본 코드페이지(cp949)로는 이 스크립트의 한글 출력이 깨진다.
if sys.stdout is not None and hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

ROOT = Path(__file__).resolve().parent
CONTENT = ROOT / "content"
TOC_PATH = CONTENT / "toc.json"
GLOSSARY_PATH = CONTENT / "glossary.json"
OUT = ROOT / "assets" / "bundle.js"
WIDGET_DIR = ROOT / "assets" / "widgets"
WIDGET_OUT = ROOT / "assets" / "widgets.bundle.js"
INDEX = ROOT / "index.html"
SINGLE = ROOT / "algobook.html"

# index.html 안에서 버전 도장을 찍을 자산들.
#
# 위젯을 개별 <script> 태그로 심지 않고 widgets.bundle.js 하나로 합치는 이유:
#   1. index.html 은 통합 담당이 소유한다. 위젯이 늘 때마다 빌드가 남의 파일의
#      태그 목록을 다시 쓰면 병렬 작업에서 충돌하고, 사람이 손으로 넣은 태그를
#      빌드가 지워 버리는 사고가 난다. 태그는 한 번만 적히고 내용만 바뀌게 한다.
#   2. 버전 도장이 파일 하나에만 붙으면 되고, --single 인라이너도 태그 하나만
#      처리하면 된다. 위젯이 20개가 되어도 index.html 은 그대로다.
#   3. file:// 에서 <script> 20개는 그냥 느리다.
ASSETS = [
    "assets/style.css",
    "assets/highlight.js",
    "assets/markdown.js",
    "assets/bundle.js",
    "assets/widgets.bundle.js",
    "assets/app.js",
]

# ::: classify 의 불릿 라벨 → window.BOOK.classify 의 키 (CONTRACT §2.4)
# 공백이 없는 표기(`혼동주의`)도 실제로 자주 쓰여서 둘 다 받는다.
CLASSIFY_KEYS = {
    "신호어": "signals",
    "제약조건": "constraints",
    "혼동 주의": "confusion",
    "혼동주의": "confusion",
    "반례 함정": "traps",
    "반례함정": "traps",
}

# 불릿 한 줄. 라벨의 **굵게** 표기와 전각 콜론(：)까지 받는다.
BULLET_RE = re.compile(r"^\s*[-*+]\s+\*{0,2}([^:：*]{1,20})\*{0,2}\s*[:：]\s*(.*)$")


# --------------------------------------------------------------------------
# 마크다운 스캔 유틸
# --------------------------------------------------------------------------

def code_fence_mask(lines: list[str]) -> list[bool]:
    """각 줄이 코드 펜스(``` 안쪽 또는 펜스 줄 자체)인지 표시한다.

    왜 필요한가: 챕터가 자기 문법을 설명하느라 ```` ```markdown ```` 안에
    `::: classify` 예시를 적어 둘 수 있다. 그것까지 수집하면 플래시카드에
    유령 카드가 생긴다. 펜스는 백틱 3개 이상이고 같은 개수 이상으로 닫히므로
    여는 백틱 개수를 기억해 둔다.
    """
    mask = [False] * len(lines)
    fence: str | None = None
    for i, ln in enumerate(lines):
        m = re.match(r"^\s*(`{3,}|~{3,})", ln)
        if fence is None:
            if m:
                fence = m.group(1)
                mask[i] = True
            continue
        mask[i] = True
        # 닫는 펜스는 같은 문자, 같은 개수 이상, 뒤에 정보 문자열이 없다.
        if m and m.group(1)[0] == fence[0] and len(m.group(1)) >= len(fence):
            if not ln.strip()[len(m.group(1)):].strip():
                fence = None
    return mask


def iter_boxes(md: str, kind: str) -> list[tuple[int, list[str]]]:
    """`::: <kind>` 상자를 (시작 줄 번호 1-base, 본문 줄들) 로 모은다.

    상자는 중첩된다(CONTRACT §2.3). 닫는 `:::` 는 항상 홀로 있는 줄이므로
    여는 것과 닫는 것을 스택 깊이로 센다.
    """
    lines = md.split("\n")
    mask = code_fence_mask(lines)
    out: list[tuple[int, list[str]]] = []
    i = 0
    while i < len(lines):
        if mask[i] or not re.match(rf"^:::\s*{re.escape(kind)}\b", lines[i].strip()):
            i += 1
            continue
        start = i + 1
        depth = 1
        body: list[str] = []
        i += 1
        while i < len(lines):
            s = lines[i].strip()
            if not mask[i] and s == ":::":
                depth -= 1
                if depth == 0:
                    break
            elif not mask[i] and re.match(r"^:::\s*\S", s):
                depth += 1
            body.append(lines[i])
            i += 1
        out.append((start, body))
        i += 1
    return out


def parse_classify_body(body: list[str]) -> dict[str, str]:
    """`::: classify` 본문의 4불릿을 키-값으로 바꾼다.

    불릿 다음 줄이 불릿이 아니면 앞 항목의 이어쓰기로 붙인다.
    한 항목이 길어지면 줄바꿈하는 것이 자연스러운데, 거기서 값이 잘리면
    플래시카드 앞면이 문장 중간에서 끊긴다.
    """
    got: dict[str, str] = {}
    cur: str | None = None
    for ln in body:
        m = BULLET_RE.match(ln)
        if m:
            label = m.group(1).strip()
            key = CLASSIFY_KEYS.get(label) or CLASSIFY_KEYS.get(
                re.sub(r"\s+", "", label)
            )
            if key:
                cur = key
                got[key] = m.group(2).strip()
                continue
            cur = None
            continue
        if cur and ln.strip():
            got[cur] = (got[cur] + " " + ln.strip()).strip()
    return got


def collect_classify(cid: str, num: str, title: str, md: str) -> list[dict]:
    """한 챕터의 모든 `::: classify` 를 window.BOOK.classify 항목으로."""
    items = []
    for _start, body in iter_boxes(md, "classify"):
        got = parse_classify_body(body)
        items.append(
            {
                "chapter": cid,
                "num": num,
                "title": title,
                "signals": got.get("signals", ""),
                "constraints": got.get("constraints", ""),
                "confusion": got.get("confusion", ""),
                "traps": got.get("traps", ""),
            }
        )
    return items


# `::: quiz` 안에서 대표문제 한 줄의 형식(§4-8): "**N. 백준 NNNN 제목 (난도)**"
# 뒤에 선택적으로 "— URL"이 붙는다. 손추적·검증 과제처럼 문제 번호가 없는 항목은
# 이 패턴에 안 걸려 자동으로 제외된다 — 색인은 "대표문제"만 다룬다(A-10, §4-8).
PROBLEM_RE = re.compile(
    r"\*\*\d+\.\s*백준\s*(\d+)\s+(.+?)\s*\(([^)]+)\)\s*\*\*"
    r"(?:[ \t]*[—–-][ \t]*(https://www\.acmicpc\.net/problem/\d+))?"
)


def collect_problems(cid: str, num: str, title: str, part_num: str, part_title: str, md: str) -> list[dict]:
    """한 챕터의 `::: quiz` 안 대표문제를 window.BOOK.problems 항목으로.

    난도 문자열 앞부분(브론즈/실버/골드/플래티넘)을 등급 필터용으로 따로 뽑는다.
    """
    items = []
    for _start, body in iter_boxes(md, "quiz"):
        text = "\n".join(body)
        for m in PROBLEM_RE.finditer(text):
            boj_id, boj_title, diff, url = m.groups()
            tier_m = re.match(r"(브론즈|실버|골드|플래티넘|다이아몬드)", diff)
            items.append(
                {
                    "id": boj_id,
                    "title": boj_title.strip(),
                    "diff": diff.strip(),
                    "tier": tier_m.group(1) if tier_m else "",
                    "url": url or f"https://www.acmicpc.net/problem/{boj_id}",
                    "chapter": cid,
                    "num": num,
                    "chTitle": title,
                    "partNum": part_num,
                    "partTitle": part_title,
                }
            )
    return items


# --------------------------------------------------------------------------
# 자산 버전 도장
# --------------------------------------------------------------------------

def build_widget_bundle() -> int:
    """assets/widgets/*.js 를 하나로 이어붙인다. 없으면 껍데기만 만든다.

    M1 시점에는 위젯이 하나도 없다. 그래도 파일은 만든다 — app.js 가
    window.Widgets 를 전제하므로(CONTRACT §1.4) 빈 객체라도 있어야 하고,
    index.html 의 <script> 태그가 404 나는 것을 막는다.
    """
    srcs = sorted(WIDGET_DIR.glob("*.js")) if WIDGET_DIR.exists() else []
    parts = [
        "/* 자동 생성 파일 — 직접 고치지 말 것. `python build.py` 로 다시 만든다. */",
        "/* 원본: assets/widgets/*.js */",
        "window.Widgets = window.Widgets || {};",
    ]
    for p in srcs:
        parts.append(f"\n/* ==== {p.name} ==== */")
        parts.append(p.read_text(encoding="utf-8").rstrip("\n"))
    WIDGET_OUT.parent.mkdir(parents=True, exist_ok=True)
    WIDGET_OUT.write_text("\n".join(parts) + "\n", encoding="utf-8", newline="\n")
    return len(srcs)


def stamp_versions() -> str:
    """index.html 의 자산 URL에 내용 해시를 붙인다.

    브라우저(특히 휴대폰)는 같은 이름의 JS/CSS를 공격적으로 캐싱한다.
    내용이 바뀌면 URL이 바뀌어야 새로 받는다.
    """
    h = hashlib.sha256()
    for rel in ASSETS:
        p = ROOT / rel
        if p.exists():
            h.update(p.read_bytes())
    ver = h.hexdigest()[:10]

    if not INDEX.exists():
        return ver

    html = INDEX.read_text(encoding="utf-8")
    for rel in ASSETS:
        # 기존 쿼리스트링은 형태와 무관하게 통째로 걷어낸다.
        # \?v=[0-9a-f]+ 로만 잡으면 손으로 넣은 ?v=x 같은 것이 남아
        # ?v=<해시>?v=x 로 겹쳐 붙는다.
        html = re.sub(rf'({re.escape(rel)})(\?[^"\']*)?', rf"\1?v={ver}", html)
    INDEX.write_text(html, encoding="utf-8", newline="\n")
    return ver


# --------------------------------------------------------------------------
# 빌드
# --------------------------------------------------------------------------

_doc_index: dict[str, list[Path]] | None = None


def refresh_doc_index() -> None:
    """content/ 를 한 번만 훑어 <id> → 파일 목록 색인을 만든다.

    왜 캐시하는가: 챕터가 147개다. 챕터마다 rglob 을 돌면 트리를 147번 훑는다.
    --watch 는 매 재빌드마다 무효화한다(새 파일이 생겨야 잡힌다).
    """
    global _doc_index
    idx: dict[str, list[Path]] = {}
    if CONTENT.exists():
        for p in CONTENT.rglob("*.md"):
            idx.setdefault(p.stem, []).append(p)
    _doc_index = idx


def find_doc(chapter_id: str) -> Path | None:
    """content/ 어디에 있든 <id>.md 를 찾는다 (CLAUDE.md §2-1)."""
    if _doc_index is None:
        refresh_doc_index()
    hits = sorted(_doc_index.get(chapter_id, []))  # type: ignore[union-attr]
    if len(hits) > 1:
        raise SystemExit(f"[에러] '{chapter_id}.md' 가 여러 곳에 있습니다: {hits}")
    return hits[0] if hits else None


def word_count(md: str) -> int:
    """코드 블록을 제외한 본문 글자 수 (분량 추정용, §4 밀도 기준)."""
    body = re.sub(r"```[\s\S]*?```", "", md)
    return len(re.sub(r"\s+", "", body))


def load_glossary() -> list[dict]:
    """용어 사전을 목록으로 편다. 사전 파일은 이름을 키로 쓰지만 앱은 정렬된 배열이 편하다.

    가나다 → 알파벳 순으로 정렬한다. 한글과 영문이 섞여 있어 기본 정렬에 맡기면
    영문이 앞으로 나오는데, 이 책의 용어는 대부분 한글이라 그 편이 찾기 나쁘다.
    """
    if not GLOSSARY_PATH.exists():
        return []
    raw = json.loads(GLOSSARY_PATH.read_text(encoding="utf-8"))
    items = []
    for key, v in raw.items():
        items.append({
            "term": v.get("term", key),
            "en": v.get("en", ""),
            "def": v.get("def", ""),
            "chapter": v.get("chapter", ""),
            "aliases": v.get("aliases", []),
        })

    def sort_key(it: dict) -> tuple[int, str]:
        t = it["term"]
        # 한글이 먼저, 그다음 나머지. ord 경계는 한글 음절 블록이다.
        hangul = bool(t) and "\uac00" <= t[0] <= "\ud7a3"
        return (0 if hangul else 1, t)

    items.sort(key=sort_key)
    return items


def load_toc() -> dict:
    if not TOC_PATH.exists():
        raise SystemExit(f"[에러] {TOC_PATH.relative_to(ROOT)} 가 없습니다.")
    return json.loads(TOC_PATH.read_text(encoding="utf-8"))


def build() -> dict:
    toc = load_toc()
    refresh_doc_index()

    docs: dict[str, str] = {}
    classify: list[dict] = []
    problems: list[dict] = []
    seen: set[str] = set()
    missing: list[str] = []
    total_chars = 0

    for part in toc["parts"]:
        for ch in part["chapters"]:
            cid = ch["id"]
            if cid in seen:
                raise SystemExit(f"[에러] 챕터 id 중복: {cid}")
            seen.add(cid)

            path = find_doc(cid)
            if path is None:
                # 목차에만 있고 아직 안 쓴 절. 빌드를 멈출 이유가 없다 —
                # 이 책은 목차 전체가 먼저 서고 챕터가 뒤따라 채워진다.
                missing.append(f'{ch["num"]} {ch["title"]}')
                continue
            md = path.read_text(encoding="utf-8")
            docs[cid] = md
            total_chars += word_count(md)
            classify.extend(collect_classify(cid, ch["num"], ch["title"], md))
            problems.extend(
                collect_problems(cid, ch["num"], ch["title"], part["num"], part["title"], md)
            )

    # 목차에 없는 고아 마크다운 경고
    for stem, paths in sorted((_doc_index or {}).items()):
        if stem in seen:
            continue
        for p in sorted(paths):
            if not p.name.startswith("_"):
                print(f"[경고] 목차에 없는 파일: {p.relative_to(ROOT)}")

    glossary = load_glossary()

    payload = {
        "meta": toc["meta"],
        "toc": [
            {
                "id": p["id"],
                "num": p["num"],
                "title": p["title"],
                "desc": p.get("desc", ""),
                "chapters": p["chapters"],
            }
            for p in toc["parts"]
        ],
        "docs": docs,
        "classify": classify,
        # 용어 사전(§8). 항목마다 최초 정의 챕터가 붙어 있어 클릭하면 그리로 간다.
        # 본문에서 처음 만났을 때 배우는 것이 기본 경로이고(§4-3), 이 페이지는
        # 돌아와서 찾는 곳이다.
        "glossary": glossary,
        # 문제 색인(§7·§8). ::: quiz 의 대표문제를 Part·유형별로 모은 것 —
        # docs/PROBLEM_INDEX.md 와 같은 데이터에서 나온다(tools/export_problem_index.py).
        "problems": problems,
    }

    OUT.parent.mkdir(parents=True, exist_ok=True)
    # newline="\n": 윈도우에서 기본값은 \n 을 \r\n 으로 바꾼다. 그러면 같은 내용인데도
    # 디스크 바이트가 달라져 stamp_versions() 의 해시가 OS마다 달라진다.
    js = (
        "/* 자동 생성 파일 — 직접 고치지 말 것. `python build.py` 로 다시 만든다. */\n"
        "window.BOOK = "
        + json.dumps(payload, ensure_ascii=False, separators=(",", ":"))
        + ";\n"
    )
    OUT.write_text(js, encoding="utf-8", newline="\n")

    widgets = build_widget_bundle()
    ver = stamp_versions()

    return {
        "written": len(docs),
        "total": len(seen),
        "missing": missing,
        "classify": len(classify),
        "problems": len(problems),
        "widgets": widgets,
        "chars": total_chars,
        "size": OUT.stat().st_size,
        "ver": ver,
    }


def report(st: dict) -> None:
    pages = st["chars"] / 1400  # 한글 기준 대략 한 페이지
    print(
        f"빌드 완료: {st['written']}/{st['total']} 절 · "
        f"본문 {st['chars']:,}자 (약 {pages:,.0f}쪽) · "
        f"유형판별 {st['classify']}개 · 대표문제 {st['problems']}개 · 위젯 {st['widgets']}개 · "
        f"번들 {st['size'] / 1024:,.0f} KB · v{st['ver']}"
    )
    if st["missing"]:
        print(f"  아직 비어 있는 절 {len(st['missing'])}개")
    if not INDEX.exists():
        print("  [경고] index.html 이 없어 자산 버전 도장을 건너뛰었다.")


# --------------------------------------------------------------------------
# --watch / --serve
# --------------------------------------------------------------------------

def snapshot() -> dict[Path, float]:
    # 빌드가 직접 쓰는 산출물(bundle.js, widgets.bundle.js, index.html)은
    # 감시 대상에서 뺀다. 넣으면 빌드 → 변경 감지 → 빌드로 무한 루프가 된다.
    generated = {"assets/bundle.js", "assets/widgets.bundle.js"}
    watched = [ROOT / a for a in ASSETS if a not in generated]
    watched += sorted(WIDGET_DIR.glob("*.js")) if WIDGET_DIR.exists() else []
    files = list(CONTENT.rglob("*.md")) + [TOC_PATH] + watched
    return {p: p.stat().st_mtime for p in files if p.exists()}


def watch() -> None:
    report(build())
    print("변경 감시 중… (Ctrl+C 로 종료)")
    prev = snapshot()
    try:
        while True:
            time.sleep(0.7)
            cur = snapshot()
            if cur != prev:
                prev = cur
                try:
                    report(build())
                except SystemExit as e:
                    print(e)
    except KeyboardInterrupt:
        print("\n종료합니다.")


def lan_ip() -> str:
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        s.connect(("8.8.8.8", 80))
        return s.getsockname()[0]
    except OSError:
        return "127.0.0.1"
    finally:
        s.close()


def serve(port: int) -> None:
    import http.server
    import socketserver

    report(build())

    class Handler(http.server.SimpleHTTPRequestHandler):
        def __init__(self, *a, **kw):
            super().__init__(*a, directory=str(ROOT), **kw)

        def end_headers(self):
            # 개발 중에는 캐시가 오히려 방해다. 버전 도장은 배포용이다.
            self.send_header("Cache-Control", "no-store")
            super().end_headers()

        def log_message(self, *a):
            pass

    socketserver.TCPServer.allow_reuse_address = True
    with socketserver.TCPServer(("0.0.0.0", port), Handler) as httpd:
        print(f"\n  PC     :  http://localhost:{port}/")
        print(f"  휴대폰 :  http://{lan_ip()}:{port}/   (같은 와이파이)")
        print("\nCtrl+C 로 종료합니다.")
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            print("\n종료합니다.")


# --------------------------------------------------------------------------
# 검사기
# --------------------------------------------------------------------------

CHECKERS = ["check_content.py", "check_links.py", "check_diagrams.py"]


def lint_content() -> None:
    """검사기 3종을 돌리고 출력만 한다.

    왜 종료 코드를 무시하는가: CLAUDE.md §7-1 — 콘텐츠 규범 위반은 경고이지
    빌드 실패가 아니다. 집필 중인 챕터 때문에 번들이 안 나오면 아무것도 못 본다.
    깨진 내부 링크는 CI 에서 check_links.py 를 따로 돌려 잡는다(§7-3).
    """
    import subprocess

    for name in CHECKERS:
        checker = ROOT / "tools" / name
        if not checker.exists():
            continue
        r = subprocess.run(
            [sys.executable, str(checker)],
            capture_output=True,
            text=True,
            encoding="utf-8",
        )
        out = (r.stdout or "").strip()
        err = (r.stderr or "").strip()
        if out:
            print(out)
        if err:
            print(f"[{name}] {err}")


# --------------------------------------------------------------------------
# --single
# --------------------------------------------------------------------------

def build_single() -> None:
    """CSS·JS·본문을 index.html 안에 전부 집어넣어 파일 하나로 만든다.

    왜 필요한가(A-11): 휴대폰에는 파이썬이 없어서 build.py 를 못 돌리고,
    index.html 만 옮겨 봐야 assets/ 를 못 찾는다. 파일 하나면 메일이든
    메신저든 클라우드든 아무거나로 옮겨서 그냥 열면 된다. 인터넷도 필요 없다.
    """
    report(build())  # 먼저 번들을 최신으로

    if not INDEX.exists():
        raise SystemExit("[에러] index.html 이 없어 단일 파일을 만들 수 없습니다.")

    html = INDEX.read_text(encoding="utf-8")

    def inline_css(m: re.Match) -> str:
        css = (ROOT / "assets" / "style.css").read_text(encoding="utf-8")
        return "<style>\n" + css + "\n</style>"

    html = re.sub(
        r'<link[^>]*rel="stylesheet"[^>]*href="assets/style\.css[^"]*"[^>]*>',
        inline_css,
        html,
    )

    def inline_js(m: re.Match) -> str:
        p = ROOT / "assets" / m.group(1)
        if not p.exists():
            raise SystemExit(f"[에러] 인라인할 파일이 없습니다: assets/{m.group(1)}")
        src = p.read_text(encoding="utf-8")
        # 문자열 안에 </script> 가 있으면 태그가 거기서 닫혀 버린다.
        # JSON·JS 문자열 안에서 <\/script> 는 같은 값으로 읽히므로 안전하다.
        src = src.replace("</script", "<\\/script")
        return "<script>\n" + src + "\n</script>"

    # 위젯까지 감당하려면 경로에 `/` 와 `.` 이 들어올 수 있다.
    html = re.sub(
        r'<script[^>]*src="assets/([A-Za-z0-9_./-]+\.js)[^"]*"[^>]*></script>',
        inline_js,
        html,
    )

    # 실제 태그 참조만 본다. 그냥 "assets/" 로 검사하면 인라인된 CSS·JS 주석에
    # 적힌 파일 경로까지 잡아서 멀쩡한 빌드가 실패한다.
    left = re.findall(r'(?:src|href)="assets/[^"]*"', html)
    if left:
        raise SystemExit(f"[에러] 인라인되지 않은 참조가 남았습니다: {left}")

    SINGLE.write_text(html, encoding="utf-8", newline="\n")
    print(
        f"\n단일 파일: {SINGLE.name} ({SINGLE.stat().st_size / 1024 / 1024:.1f} MB)\n"
        "  이 파일 하나만 휴대폰으로 옮겨서 열면 된다. 서버도 인터넷도 필요 없다."
    )


# --------------------------------------------------------------------------

def main() -> int:
    ap = argparse.ArgumentParser(description="Algorithmic — 빌드 스크립트")
    ap.add_argument("--watch", action="store_true", help="파일 변경 시 자동 재빌드")
    ap.add_argument("--serve", action="store_true", help="로컬 서버 실행 (휴대폰 접속용)")
    ap.add_argument(
        "--single", action="store_true", help="algobook.html 하나로 합치기"
    )
    ap.add_argument("--port", type=int, default=8800)
    ap.add_argument("--no-lint", action="store_true", help="검사기 3종 건너뛰기")
    args = ap.parse_args()

    if args.single:
        build_single()
    elif args.serve:
        serve(args.port)
    elif args.watch:
        watch()
    else:
        report(build())
        if not args.no_lint:
            lint_content()
    return 0


if __name__ == "__main__":
    sys.exit(main())
