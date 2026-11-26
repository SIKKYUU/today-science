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
# 웹페이지를 읽어오는 파이썬 기본 도구를 불러온다 (사이언스타임즈 원문 찾기에 쓴다)
import urllib.request
# 링크 끝의 추적용 꼬리(utm_...)를 지울 때 쓰는 기본 도구를 불러온다
from urllib.parse import urlsplit, urlunsplit, parse_qsl, urlencode
# 여러 페이지를 동시에 읽어 시간을 줄이는 기본 도구를 불러온다
from concurrent.futures import ThreadPoolExecutor

# ==== 설정: 숫자만 바꾸면 된다 ====
# 해외 공식 RSS에서 꺼내 볼 기사 개수
OFFICIAL_LIMIT = 20
# 국내 일간지 과학면 RSS에서 꺼내 볼 기사 개수
DAILY_LIMIT = 50
# 구글 뉴스 RSS에서 꺼내 볼 기사 개수 (구글은 최대 100개를 준다)
GOOGLE_LIMIT = 100
# 며칠 이내의 기사만 남길지
RECENT_DAYS = 3
# 사이언스타임즈 원문을 찾을 때 최신 번호부터 몇 개까지 거슬러 올라가 볼지
SCIENCETIMES_SCAN = 200

# ==== 사이트 목록: 여기서 줄을 넣거나 빼면 된다 ====
# 형식: ("화면에 보일 이름", "RSS 주소", 꺼내 볼 기사 개수, "종류"),
# 종류:
#   "direct"       = RSS 링크가 바로 원문 → 기사로 고를 수 있다
#   "sciencetimes" = 구글 뉴스 링크 → 사이언스타임즈 원문 주소를 찾아서 붙인다 (못 찾으면 "원문 없음")
#   "more_only"    = 본문을 자동으로 읽으면 안 되거나(robots.txt) 원문 주소를 못 얻는 곳 → "더 볼거리" 후보로만
SITES = [
    # 해외 (공식 RSS)
    ("Science News", "https://www.sciencenews.org/feed", OFFICIAL_LIMIT, "direct"),
    ("New Scientist", "https://www.newscientist.com/feed/home/", OFFICIAL_LIMIT, "direct"),
    ("Live Science", "https://www.livescience.com/feeds.xml", OFFICIAL_LIMIT, "direct"),
    # 국내 일간지 과학면 (공식 RSS, robots.txt가 막지 않음)
    ("경향신문", "https://www.khan.co.kr/rss/rssdata/science_news.xml", DAILY_LIMIT, "direct"),
    ("동아일보", "https://rss.donga.com/science.xml", DAILY_LIMIT, "direct"),
    ("조선비즈", "https://biz.chosun.com/arc/outboundfeeds/rss/category/science-chosun/?outputType=xml", DAILY_LIMIT, "direct"),
    # 국내 과학 매체 (구글 뉴스 RSS. 주소 안의 {DATES}는 아래에서 날짜 범위로 바뀐다)
    ("사이언스타임즈", "https://news.google.com/rss/search?q=site:sciencetimes.co.kr{DATES}&hl=ko&gl=KR&ceid=KR:ko", GOOGLE_LIMIT, "sciencetimes"),
    # 더 볼거리 후보로만 쓰는 곳
    ("동아사이언스", "https://news.google.com/rss/search?q=site:dongascience.com{DATES}&hl=ko&gl=KR&ceid=KR:ko", GOOGLE_LIMIT, "more_only"),   # robots.txt가 자동 접근을 막음
    ("YTN 사이언스", "https://news.google.com/rss/search?q=site:science.ytn.co.kr{DATES}&hl=ko&gl=KR&ceid=KR:ko", GOOGLE_LIMIT, "more_only"),  # 원문 주소를 얻을 방법이 없음
    ("한겨레", "https://www.hani.co.kr/rss/science/", DAILY_LIMIT, "more_only"),   # robots.txt가 Claude의 본문 읽기를 막음
]
# RSS에 날짜가 없는 곳(한겨레)은 맨 앞(최신) 몇 개만 최근 기사로 본다
NO_DATE_LIMIT = 15
# 이런 제목은 기사가 아니라 메뉴 페이지라서 뺀다
MENU_TITLE = re.compile(r"/사용자메뉴/|^(과학기술|과학정책|과학문화)$")
# 국내 매체 이름 (요약표에서 "국내 후보 중 원문 링크 있는 수"를 셀 때 쓴다)
DOMESTIC = {"경향신문", "동아일보", "조선비즈", "사이언스타임즈", "동아사이언스", "YTN 사이언스", "한겨레"}

# 웹페이지를 읽을 때 쓰는 브라우저 이름표
USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/130 Safari/537.36"
# 사이언스타임즈 기사 주소 형식 (번호만 바뀐다)
SCIENCETIMES_ARTICLE = "https://www.sciencetimes.co.kr/nscvrg/view/menu/248?nscvrgSn={}"

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
# 구글 뉴스 검색에 붙일 날짜 범위 (구글은 날짜순이 아니라서, 기간을 정해줘야 최근 기사가 나온다)
# 예: " after:2026-11-22 before:2026-11-27" (공백은 주소에서 "+"로 쓴다)
GOOGLE_DATES = f"+after:{(cutoff - timedelta(days=1)):%Y-%m-%d}+before:{(now + timedelta(days=1)):%Y-%m-%d}"
# 마지막 요약표에 쓸 기록을 모아두는 목록
summary = []
# 모든 사이트의 후보 기사를 모아서 파일로 저장할 목록
candidates = []


# 링크 끝의 추적용 꼬리(utm_...)를 지운다
def clean_link(link):
    parts = urlsplit(link)
    query = [(k, v) for k, v in parse_qsl(parts.query) if not k.startswith("utm_")]
    return urlunsplit((parts.scheme, parts.netloc, parts.path, urlencode(query), parts.fragment))


# 웹페이지 글자를 읽어온다 (실패하면 빈 글자)
def get_page(url):
    try:
        request = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
        return urllib.request.urlopen(request, timeout=20).read().decode("utf-8", "replace")
    except Exception:
        return ""


# 제목 비교용으로 띄어쓰기·따옴표·말줄임표·기호를 모두 지운다
def normalize(title):
    return re.sub(r"[\s\"'“”‘’…·.,!?()\[\]<>《》「」『』:;~\-–—]", "", html.unescape(title)).lower()


# 두 제목이 같은 기사인지 (한쪽이 잘려 있어도 앞부분 10글자 이상이 같으면 같다고 본다)
def same_title(a, b):
    a, b = normalize(a), normalize(b)
    if not a or not b:
        return False
    if a == b:
        return True
    short, long = sorted([a, b], key=len)
    return len(short) >= 10 and long.startswith(short)


# 사이언스타임즈 기사 번호 하나를 열어 og:title(제목)을 읽는다
def sciencetimes_title(number):
    page = get_page(SCIENCETIMES_ARTICLE.format(number))
    match = re.search(r'<meta[^>]+property=["\']og:title["\'][^>]*content="([^>]*?)"\s*/?>', page)
    return number, html.unescape(match.group(1)).strip() if match else ""


# 사이언스타임즈 후보들의 원문 주소를 찾아 "original_link"에 넣는다
# 방법: 첫 화면에서 가장 큰 기사 번호를 찾고, 거기서부터 거꾸로 하나씩 열어 제목이 같은 기사를 찾는다
def find_sciencetimes_originals(items):
    if not items:
        return
    home = get_page("https://www.sciencetimes.co.kr/")
    numbers = [int(n) for n in re.findall(r"nscvrgSn=(\d+)", home)]
    if not numbers:
        print("  ⚠ 사이언스타임즈 첫 화면에서 기사 번호를 못 찾았어요 → 모두 '원문 없음'")
        return
    newest = max(numbers)
    waiting = list(items)                       # 아직 원문을 못 찾은 후보
    # 20개씩 묶어서 동시에 열어 본다 (모두 찾으면 일찍 멈춘다)
    with ThreadPoolExecutor(max_workers=8) as pool:
        for start in range(newest, newest - SCIENCETIMES_SCAN, -20):
            batch = range(start, max(start - 20, newest - SCIENCETIMES_SCAN), -1)
            for number, title in pool.map(sciencetimes_title, batch):
                if not title:
                    continue
                for item in waiting:
                    if same_title(item["title"], title):
                        item["original_link"] = SCIENCETIMES_ARTICLE.format(number)
                        waiting.remove(item)
                        break
            if not waiting:
                break


# 사이트 목록에서 이름, 주소, 개수, 종류를 하나씩 꺼낸다
for name, url, limit, kind in SITES:
    # 어느 사이트인지 눈에 띄게 제목줄을 출력한다
    print(f"===== [{name}] =====")
    # 문제가 생겨도 멈추지 않도록 try로 감싼다
    try:
        # RSS 주소에 접속해서 내용을 읽어온다 (구글 뉴스 주소에는 날짜 범위를 넣는다)
        feed = feedparser.parse(url.replace("{DATES}", GOOGLE_DATES), agent=USER_AGENT)
        # 앞에서부터 정해진 개수만큼만 기사를 꺼낸다
        entries = feed.entries[:limit]
        # 기사가 하나도 없으면 실패로 기록하고 다음 사이트로 넘어간다
        if not entries:
            print("  ⚠ 기사를 가져오지 못했어요 (주소나 인터넷 연결을 확인하세요)\n")
            summary.append((name, "실패", None))
            continue

        # 조건을 통과한 기사를 모아둘 목록
        kept = []
        # 꺼낸 기사를 하나씩 살펴본다
        for position, entry in enumerate(entries):
            # 날짜 정보(UTC 기준): 발행일(published)이 없으면 수정일(updated, 경향신문은 이쪽)을 쓴다
            parsed = entry.get("published_parsed") or entry.get("updated_parsed")
            if parsed:
                # feedparser가 준 날짜를 계산 가능한 시각으로 바꾸고, 한국 시간으로 옮긴다
                published = datetime(*parsed[:6], tzinfo=timezone.utc).astimezone(KST)
            elif kind == "more_only" and position < NO_DATE_LIMIT:
                # 날짜가 아예 없는 RSS(한겨레)는 맨 앞 몇 개만 기준 시각의 기사로 본다 (더 볼거리 후보 전용)
                published = now
            else:
                # 그 밖에 날짜가 없는 기사는 최신인지 알 수 없으니 건너뛴다
                continue
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
            # 메뉴 페이지(예: "사이언스타임즈/사용자메뉴/…")는 기사가 아니니 건너뛴다
            if MENU_TITLE.search(title):
                continue
            # 짧은 소개를 꺼내고, HTML 표시를 지운 뒤 &nbsp; 같은 기호를 글자로 바꾼다
            intro = html.unescape(re.sub(r"<[^>]+>", " ", entry.get("summary", ""))).strip()
            # 소개가 제목을 그대로 반복한 것(구글 뉴스)이면 소개가 없는 것으로 본다
            if title in intro:
                intro = ""
            # 링크 (추적용 꼬리는 지운다)
            link = clean_link(entry.get("link", ""))
            # 통과한 기사를 하나의 묶음(사전)으로 담는다
            kept.append({
                "site": name,                      # 사이트 이름
                "title": title,                    # 제목
                "date": published.isoformat(),     # 날짜와 시각 (한국 시간, 표준 형식)
                "link": link,                      # 기사 링크 (구글 뉴스면 구글 주소)
                "summary": intro[:300],            # 짧은 소개 (없으면 빈 글자, 너무 길면 자름)
                # 원문 주소: 바로 가는 RSS면 링크 그대로, 사이언스타임즈는 아래에서 찾아 채움, 나머지는 "원문 없음"
                "original_link": link if kind == "direct" else "원문 없음",
                # 더 볼거리 후보로만 쓰는 곳이면 true (Claude는 기사로 고르지 않는다)
                "more_only": kind == "more_only",
            })

        # 사이언스타임즈는 원문 주소를 찾아 붙인다
        if kind == "sciencetimes":
            find_sciencetimes_originals(kept)

        # 날짜를 기준으로 최신 기사가 위로 오게 정렬한다
        kept.sort(key=lambda article: article["date"], reverse=True)
        # 남은 기사가 없으면 알려준다
        if not kept:
            print(f"  (최근 {RECENT_DAYS}일 이내 기사가 없어요)")
        # 남은 기사를 번호를 붙여 출력한다
        for number, article in enumerate(kept, start=1):
            # 저장해둔 표준 형식 날짜를 다시 시각으로 바꿔서
            published = datetime.fromisoformat(article["date"])
            # 번호와 제목, 날짜, 원문 여부를 출력한다
            mark = "더 볼거리" if article["more_only"] else ("원문 있음" if article["original_link"] != "원문 없음" else "원문 없음")
            print(f"{number}. {article['title']}  ({published.month}월 {published.day}일, {mark})")
        # 사이트 사이에 빈 줄을 넣는다
        print()
        # 이 사이트의 후보 기사를 전체 목록에 더한다
        candidates.extend(kept)
        # 요약표용으로 "가져온 수 → 남은 수"와 원문 있는 수를 기록한다
        with_original = sum(a["original_link"] != "원문 없음" for a in kept)
        summary.append((name, f"{len(entries)}개 → {len(kept)}개", with_original))
    # 예상치 못한 오류가 나면 내용을 보여주고 다음 사이트로 넘어간다
    except Exception as error:
        print(f"  ⚠ 오류가 났어요: {error}\n")
        summary.append((name, "오류", None))

# 모든 사이트를 다 돌고 나면 요약표를 출력한다
print(f"===== 요약 (최근 {RECENT_DAYS}일 기준, 가져온 수 → 남은 수, 원문 링크 있는 수) =====")
# 기록해둔 사이트별 결과를 한 줄씩 출력한다
for name, result, with_original in summary:
    extra = f", 원문 링크 {with_original}개" if with_original is not None else ""
    print(f"  {name}: {result}{extra}")
# 국내 후보 중 기사로 고를 수 있는(원문 링크 있고 더 볼거리 전용이 아닌) 수
domestic = [a for a in candidates if a["site"] in DOMESTIC]
usable = [a for a in domestic if a["original_link"] != "원문 없음" and not a["more_only"]]
print(f"  국내 후보 {len(domestic)}개 중 원문 링크가 있어 기사로 고를 수 있는 것: {len(usable)}개")

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
