# RSS를 쉽게 읽어주는 도구(feedparser)를 불러온다
import feedparser
# 날짜·시간 계산에 쓰는 파이썬 기본 도구를 불러온다
from datetime import datetime, timedelta, timezone
# JSON 파일로 저장할 때 쓰는 파이썬 기본 도구를 불러온다
import json
# 글자 속 HTML 표시(<a> 같은 것)를 지울 때 쓰는 기본 도구를 불러온다
import re
import html
# 파일·폴더 위치를 다루는 파이썬 기본 도구를 불러온다
from pathlib import Path
# 실행할 때 붙인 값(날짜)을 읽는 파이썬 기본 도구를 불러온다
import sys

# ==== 설정: 숫자만 바꾸면 된다 ====
# 해외 공식 RSS에서 꺼내 볼 기사 개수
OFFICIAL_LIMIT = 20
# 구글 뉴스 RSS에서 꺼내 볼 기사 개수 (구글은 최대 100개를 준다)
GOOGLE_LIMIT = 100
# 며칠 이내의 기사만 남길지
RECENT_DAYS = 3

# ==== 사이트 목록: 여기서 줄을 넣거나 빼면 된다 ====
# 형식: ("화면에 보일 이름", "RSS 주소", 꺼내 볼 기사 개수),
SITES = [
    ("Science News", "https://www.sciencenews.org/feed", OFFICIAL_LIMIT),
    ("New Scientist", "https://www.newscientist.com/feed/home/", OFFICIAL_LIMIT),
    ("Live Science", "https://www.livescience.com/feeds.xml", OFFICIAL_LIMIT),
    ("동아사이언스", "https://news.google.com/rss/search?q=site:dongascience.com&hl=ko&gl=KR&ceid=KR:ko", GOOGLE_LIMIT),
    ("사이언스타임즈", "https://news.google.com/rss/search?q=site:sciencetimes.co.kr&hl=ko&gl=KR&ceid=KR:ko", GOOGLE_LIMIT),
    ("YTN 사이언스", "https://news.google.com/rss/search?q=site:science.ytn.co.kr&hl=ko&gl=KR&ceid=KR:ko", GOOGLE_LIMIT),
]

# 저장할 폴더: 이 파이썬 파일이 있는 곳 옆의 data 폴더
DATA_DIR = Path(__file__).parent / "data"

# 한국 시간(UTC+9)을 나타내는 값 (날짜를 한국 기준으로 다루기 위해)
KST = timezone(timedelta(hours=9))
# 지금 시각(한국 시간)
now = datetime.now(KST)
# 날짜를 붙여 실행하면(예: python fetch_all.py 2026-11-24) 그 날짜판 후보를 모은다
if len(sys.argv) > 1:
    # 그 날짜의 밤 11시 59분 59초(한국 시간)를 기준 시각으로 삼는다
    day_end = datetime.strptime(sys.argv[1], "%Y-%m-%d").replace(hour=23, minute=59, second=59, tzinfo=KST)
    # 오늘이거나 미래 날짜가 아니면(=지난 날짜면) 기준 시각을 그날 밤으로 바꾼다
    if day_end < now:
        now = day_end
# 지금 시각에서 RECENT_DAYS일을 뺀 시각 = 이보다 오래된 기사는 버린다
cutoff = now - timedelta(days=RECENT_DAYS)
# 마지막 요약표에 쓸 기록을 모아두는 목록
summary = []
# 모든 사이트의 후보 기사를 모아서 파일로 저장할 목록
candidates = []

# 사이트 목록에서 이름, 주소, 개수를 하나씩 꺼낸다
for name, url, limit in SITES:
    # 어느 사이트인지 눈에 띄게 제목줄을 출력한다
    print(f"===== [{name}] =====")
    # 문제가 생겨도 멈추지 않도록 try로 감싼다
    try:
        # RSS 주소에 접속해서 내용을 읽어온다
        feed = feedparser.parse(url)
        # 앞에서부터 정해진 개수만큼만 기사를 꺼낸다
        entries = feed.entries[:limit]
        # 기사가 하나도 없으면 실패로 기록하고 다음 사이트로 넘어간다
        if not entries:
            print("  ⚠ 기사를 가져오지 못했어요 (주소나 인터넷 연결을 확인하세요)\n")
            summary.append((name, "실패"))
            continue

        # 조건을 통과한 기사를 모아둘 목록
        kept = []
        # 꺼낸 기사를 하나씩 살펴본다
        for entry in entries:
            # 날짜 정보(UTC 기준)가 없는 기사는 최신인지 알 수 없으니 건너뛴다
            if not entry.get("published_parsed"):
                continue
            # feedparser가 준 날짜를 계산 가능한 시각으로 바꾸고, 한국 시간으로 옮긴다
            published = datetime(*entry.published_parsed[:6], tzinfo=timezone.utc).astimezone(KST)
            # 기준 시각보다 오래된 기사는 건너뛴다
            if published < cutoff:
                continue
            # 기준 시각보다 나중 기사도 건너뛴다 (지난 날짜판을 만들 때 그 뒤 기사가 섞이지 않게)
            if published > now:
                continue
            # 제목을 꺼낸다 (없으면 '제목 없음')
            title = entry.get("title", "제목 없음")
            # 기사에 적힌 출처 이름을 꺼낸다 (구글 뉴스에만 있고, 없으면 빈 글자)
            source = entry.get("source", {}).get("title", "")
            # 제목이 " - 출처이름"으로 끝나면 그 꼬리를 잘라낸다
            if source and title.endswith(" - " + source):
                title = title[: -len(" - " + source)]
            # 짧은 소개를 꺼내고, HTML 표시를 지운 뒤 &nbsp; 같은 기호를 글자로 바꾼다
            intro = html.unescape(re.sub(r"<[^>]+>", " ", entry.get("summary", ""))).strip()
            # 소개가 제목을 그대로 반복한 것(구글 뉴스)이면 소개가 없는 것으로 본다
            if title in intro:
                intro = ""
            # 통과한 기사를 하나의 묶음(사전)으로 담는다
            kept.append({
                "site": name,                      # 사이트 이름
                "title": title,                    # 제목
                "date": published.isoformat(),     # 날짜와 시각 (한국 시간, 표준 형식)
                "link": entry.get("link", ""),     # 기사 링크
                "summary": intro,                  # 짧은 소개 (없으면 빈 글자)
            })

        # 날짜를 기준으로 최신 기사가 위로 오게 정렬한다
        kept.sort(key=lambda article: article["date"], reverse=True)
        # 남은 기사가 없으면 알려준다
        if not kept:
            print(f"  (최근 {RECENT_DAYS}일 이내 기사가 없어요)")
        # 남은 기사를 번호를 붙여 출력한다
        for number, article in enumerate(kept, start=1):
            # 저장해둔 표준 형식 날짜를 다시 시각으로 바꿔서
            published = datetime.fromisoformat(article["date"])
            # 번호와 제목을 출력한다
            print(f"{number}. {article['title']}")
            # 날짜를 "11월 24일" 형식으로 출력한다
            print(f"   날짜: {published.month}월 {published.day}일")
            # 링크를 출력한다
            print(f"   링크: {article['link']}")
        # 사이트 사이에 빈 줄을 넣는다
        print()
        # 이 사이트의 후보 기사를 전체 목록에 더한다
        candidates.extend(kept)
        # 요약표용으로 "가져온 수 → 남은 수"를 기록한다
        summary.append((name, f"{len(entries)}개 → {len(kept)}개"))
    # 예상치 못한 오류가 나면 내용을 보여주고 다음 사이트로 넘어간다
    except Exception as error:
        print(f"  ⚠ 오류가 났어요: {error}\n")
        summary.append((name, "오류"))

# 모든 사이트를 다 돌고 나면 요약표를 출력한다
print(f"===== 요약 (최근 {RECENT_DAYS}일 기준, 가져온 수 → 남은 수) =====")
# 기록해둔 사이트별 결과를 한 줄씩 출력한다
for name, result in summary:
    print(f"  {name}: {result}")

# ==== 파일로 저장하기 ====
# data 폴더가 없으면 만든다 (이미 있으면 그냥 넘어간다)
DATA_DIR.mkdir(exist_ok=True)
# 기준 날짜(한국 시간, 보통 오늘)로 파일 이름을 정한다. 예: candidates_2026-11-25.json
output_path = DATA_DIR / f"candidates_{now.strftime('%Y-%m-%d')}.json"
# 파일을 쓰기 모드로 연다 (같은 이름 파일이 있으면 덮어쓴다)
with open(output_path, "w", encoding="utf-8") as file:
    # 후보 기사 목록을 JSON으로 저장한다 (한글을 그대로, 보기 좋게 들여쓰기)
    json.dump(candidates, file, ensure_ascii=False, indent=2)
# 저장한 위치와 총 기사 수를 출력한다
print(f"\n저장 완료: {output_path}")
print(f"총 기사 수: {len(candidates)}개")
