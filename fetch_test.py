# RSS를 쉽게 읽어주는 도구(feedparser)를 불러온다
import feedparser

# 가져올 RSS 주소 (Science News)
FEED_URL = "https://www.sciencenews.org/feed"

# RSS 주소에 접속해서 내용을 읽고, 파이썬이 다루기 쉬운 형태로 바꾼다
feed = feedparser.parse(FEED_URL)

# 기사 목록(entries)에서 앞의 5개만 하나씩 꺼낸다 (번호는 1부터 센다)
for number, entry in enumerate(feed.entries[:5], start=1):
    # 기사 번호와 제목을 출력한다
    print(f"{number}. {entry.title}")
    # 기사가 올라온 날짜를 출력한다
    print(f"   날짜: {entry.published}")
    # 기사 원문 링크를 출력한다
    print(f"   링크: {entry.link}")
    # 기사 사이에 빈 줄을 넣어 보기 좋게 한다
    print()
