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
        news = json.loads(news_file.read_text(encoding="utf-8"))
        if not isinstance(news, list) or not news:
            fail("뉴스 파일이 비어 있거나 목록 형식이 아니에요")
        else:
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
                # 읽는 시간을 규칙대로 다시 계산한다 (도입부 + 본문 글자 수 ÷ 500, 반올림, 최소 1)
                chars = len(article["lead"]) + sum(len(s.get("body", "")) for s in article["sections"])
                article["read_minutes"] = max(1, int(chars / 500 + 0.5))
            # 다시 계산한 읽는 시간을 저장한다
            news_file.write_text(json.dumps(news, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

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
