# ==== 발행 전 검사 ====
# GitHub Actions에서 Claude가 만든 뉴스 파일을 커밋하기 전에 검사하고, 숫자 계산을 바로잡는다.
# 사용법: python scripts/check_news.py 날짜 모드 판종류
#   예:   python scripts/check_news.py 2026-11-27 publish weekday
#         python scripts/check_news.py 2026-11-27 test weekday

# JSON 파일을 읽고 쓰는 파이썬 기본 도구
import json
# 실행할 때 붙인 값(날짜, 모드)을 읽는 기본 도구
import sys
# 파일 위치를 다루는 기본 도구
from pathlib import Path

# 저장소 맨 위 폴더 (이 파일이 있는 scripts 폴더의 한 칸 위)
ROOT = Path(__file__).resolve().parent.parent
# 기사마다 꼭 있어야 하는 항목들 (CLAUDE.md "저장 형식")
REQUIRED = ["type", "title", "field", "lead", "sections", "notes", "one_line", "image",
            "emoji", "read_minutes", "source_site", "original_title", "link", "sources"]
# 쓸 수 있는 분야 이름
FIELDS = {"물리·우주", "생명·의학", "기술·AI", "환경·기후"}
# 국내 기사로 세는 매체 (기사로 고를 수 있는 곳)
DOMESTIC = {"사이언스타임즈", "경향신문", "동아일보", "조선비즈"}

# 문제를 모아두는 목록 (하나라도 있으면 실패)
problems = []


# 문제를 기록하는 도우미
def fail(message):
    problems.append(message)


# 실행할 때 붙인 값 읽기
date, mode, edition = sys.argv[1], sys.argv[2], sys.argv[3]

if mode == "test":
    # ==== 시험 모드: 제목 목록 파일만 있으면 된다 ====
    test_file = ROOT / "review" / f"test-{date}.md"
    if not test_file.exists() or not test_file.read_text(encoding="utf-8").strip():
        fail(f"{test_file.name} 파일이 없거나 비어 있어요")
else:
    # ==== 발행 모드 ====
    news_file = ROOT / "data" / f"news_{date}.json"
    review_file = ROOT / "review" / f"{date}.md"
    index_file = ROOT / "data" / "index.json"

    # 1) 뉴스 파일 검사
    if not news_file.exists():
        fail(f"{news_file.name} 파일이 없어요")
    else:
        data = json.loads(news_file.read_text(encoding="utf-8"))
        # 형식: { "articles": [기사 10개], "more": [더 볼거리 6개] }
        news = data.get("articles") if isinstance(data, dict) else None
        if not isinstance(news, list) or not news:
            fail('뉴스 파일 형식이 { "articles": [...], "more": [...] } 가 아니거나 기사가 비어 있어요')
        else:
            # 더 볼거리 검사: 항목마다 site, title, link(http 주소)가 있어야 한다
            more = data.get("more", [])
            if not isinstance(more, list):
                fail('"more"가 목록 형식이 아니에요')
                more = []
            for number, item in enumerate(more, start=1):
                if not isinstance(item, dict) or not all(item.get(key) for key in ("site", "title", "link")):
                    fail(f"더 볼거리 {number}번에 site/title/link가 빠졌어요")
                elif not str(item["link"]).startswith(("http://", "https://")):
                    fail(f"더 볼거리 {number}번 링크가 http 주소가 아니에요")
            sites = [item.get("site") for item in more if isinstance(item, dict)]
            too_many = sorted({site for site in sites if sites.count(site) > 3})
            if len(more) != 6 or too_many:
                # 후보가 모자랄 수 있으니 발행은 한다. 기록만 남긴다.
                print(f"⚠ 더 볼거리는 6개(한 사이트 최대 3개)여야 해요: {len(more)}개, 사이트 {sites}")
            data["more"] = more
            if len(news) != 10:
                # 10개가 아니어도 발행은 한다 (본문을 못 읽어 줄었을 수 있음). 기록만 남긴다.
                print(f"⚠ 기사 수가 10개가 아니라 {len(news)}개예요")
            for number, article in enumerate(news, start=1):
                missing = [key for key in REQUIRED if key not in article]
                if missing:
                    fail(f"{number}번 기사에 항목이 빠졌어요: {missing}")
                    continue
                if article["field"] not in FIELDS:
                    fail(f"{number}번 기사 분야가 이상해요: {article['field']}")
                # 기사 링크는 원문 주소여야 한다 (구글 뉴스 주소면 원문을 못 읽은 것)
                if "news.google.com" in str(article["link"]) or not str(article["link"]).startswith("http"):
                    fail(f"{number}번 기사 링크가 원문 주소가 아니에요: {article['link']}")
                # 읽는 시간을 규칙대로 다시 계산한다 (도입부 + 본문 글자 수 ÷ 500, 반올림, 최소 1)
                chars = len(article["lead"]) + sum(len(s.get("body", "")) for s in article["sections"])
                article["read_minutes"] = max(1, int(chars / 500 + 0.5))
            # 국내 기사 수 (가능하면 4개 이상. 모자라도 발행은 하고 기록만 남긴다)
            domestic = sum(a.get("source_site") in DOMESTIC for a in news)
            if domestic < 4:
                print(f"⚠ 국내 기사가 {domestic}개예요 (목표 4개 이상)")
            # 다시 계산한 읽는 시간을 저장한다
            news_file.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    # 2) 검수 메모 검사
    if not review_file.exists() or not review_file.read_text(encoding="utf-8").strip():
        fail(f"review/{review_file.name} 파일이 없거나 비어 있어요")

    # 3) 목차(index.json)에 그 날짜가 맞는 판 종류로 들어 있게 맞춘다
    index = json.loads(index_file.read_text(encoding="utf-8"))
    issues = [issue for issue in index.get("issues", []) if issue.get("date") != date]
    issues.append({"date": date, "edition": edition})
    issues.sort(key=lambda issue: issue["date"])
    index_file.write_text(json.dumps({"issues": issues}, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

# ==== 결과 ====
if problems:
    print("❌ 검사 실패 — 발행하지 않아요")
    for problem in problems:
        print("  -", problem)
    sys.exit(1)
print("✅ 검사 통과")
