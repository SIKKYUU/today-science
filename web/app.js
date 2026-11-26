// ==== 설정 ====
// 뉴스 파일이 있는 폴더 (web 폴더 기준으로 한 칸 위의 data 폴더)
const DATA_DIR = "../data/";
// 목차(index.json)를 못 읽을 때, 며칠 전까지 거슬러 올라가며 뉴스를 찾을지
const LOOKBACK_DAYS = 30;
// 분야 이름을 코드체 영어 라벨로 바꾸는 표
const FIELD_LABELS = {
  "물리·우주": "PHYSICS·SPACE",
  "생명·의학": "BIO·MED",
  "기술·AI": "TECH·AI",
  "환경·기후": "EARTH·CLIMATE",
};
// 요일 이름: 한국어(날짜 글자용), 영어(날짜 칩·머리말용)
const DAYS_KO = ["일", "월", "화", "수", "목", "금", "토"];
const DAYS_EN = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"];
// 읽음·저장 기록을 기기 안(localStorage)에 넣어둘 이름
const STORE_KEY = "today-science";

// 화면 전체를 담는 상자
const app = document.getElementById("app");
// 뉴스가 있는 날짜 목록 (오래된 날 → 최근 날, 예: "2026-11-26")
let dates = [];
// 날짜별로 불러온 뉴스 { articles: [기사…], more: [더 볼거리…] } (한 번 받은 날짜는 다시 받지 않는다)
const newsByDate = {};
// 날짜별 판 종류: "weekday"(평일판) 또는 "weekend"(주말판)
const editions = {};
// 화면 그리기 순번 (느린 응답이 늦게 도착해 최신 화면을 덮어쓰지 않게)
let routeTurn = 0;
// 마지막으로 본 목록 화면: 날짜("2026-11-26"), "all"(모아보기), "saved"(저장)
let lastList = null;
// 카드를 눌러 기사로 들어왔는지 (그렇다면 뒤로 가기 = 브라우저 뒤로 가기)
let openedFromCard = false;
// 바로 전 화면이 기사였는지 (목록으로 돌아올 때 스크롤 위치를 되살리기 위해)
let lastWasArticle = false;
// 목록별 스크롤 위치 기억
const scrollMemory = {};
// 모아보기·저장 탭에서 고른 분야 ("" = 전체)
const fieldFilter = { all: "", saved: "" };

// ==== 날짜 도우미 ====
// Date → "2026-11-26"
function formatDate(date) {
  const y = date.getFullYear();                              // 연도
  const m = String(date.getMonth() + 1).padStart(2, "0");    // 월 (두 자리)
  const d = String(date.getDate()).padStart(2, "0");         // 일 (두 자리)
  return `${y}-${m}-${d}`;
}
// "2026-11-26" → Date (내 컴퓨터 시간대 기준)
function parseDate(text) {
  const [y, m, d] = text.split("-").map(Number);
  return new Date(y, m - 1, d);
}
// "2026-11-26" → "2026년 11월 26일 목요일"
function longDate(text) {
  const d = parseDate(text);
  return `${d.getFullYear()}년 ${shortDate(text)}`;
}
// "2026-11-26" → "11월 26일 목요일"
function shortDate(text) {
  const d = parseDate(text);
  return `${d.getMonth() + 1}월 ${d.getDate()}일 ${DAYS_KO[d.getDay()]}요일`;
}
// "2026-11-27" → "11.27 FRI" (모아보기 날짜 머리말)
function dayHeader(text) {
  const d = parseDate(text);
  return `${d.getMonth() + 1}.${String(d.getDate()).padStart(2, "0")} ${DAYS_EN[d.getDay()]}`;
}
// 오늘 날짜 글자 ("2026-11-26")
function todayText() {
  return formatDate(new Date());
}

// ==== 읽음·저장 기록 (기기 안에 저장) ====
// 저장이 막힌 환경(사생활 보호 모드 등)에서도 앱이 멈추지 않게 모두 try/catch로 감싼다
function readStore() {
  try {
    const data = JSON.parse(localStorage.getItem(STORE_KEY) || "{}");
    return {
      read: data && typeof data.read === "object" && data.read ? data.read : {},     // 읽은 기사 { 링크: 시각 }
      saved: data && typeof data.saved === "object" && data.saved ? data.saved : {}, // 저장한 기사 { 링크: {date, at} }
    };
  } catch (error) {
    return { read: {}, saved: {} };   // 못 읽으면 빈 기록으로 시작
  }
}
const store = readStore();
function writeStore() {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(store));
  } catch (error) {
    // 저장이 안 되는 환경이면 이번에 연 동안만 기억한다
  }
}
// 읽은 기사인지
function isRead(article) {
  return Boolean(store.read[article.link]);
}
// 읽음으로 표시
function markRead(article) {
  if (isRead(article)) return;
  store.read[article.link] = Date.now();
  writeStore();
}
// 저장한 기사인지
function isSaved(article) {
  return Boolean(store.saved[article.link]);
}
// 저장 / 저장 취소
function toggleSaved(article, date) {
  if (isSaved(article)) delete store.saved[article.link];
  else store.saved[article.link] = { date, at: Date.now() };
  writeStore();
}

// ==== 데이터 읽기 ====
// data 폴더의 json 파일을 읽는다 (없거나 실패하면 null)
async function fetchJson(fileName) {
  try {
    const response = await fetch(DATA_DIR + fileName, { cache: "no-store" });
    return response.ok ? await response.json() : null;
  } catch (error) {
    return null;   // 인터넷이 끊겼고 저장본도 없을 때
  }
}

// 뉴스 파일 내용을 { articles, more } 모양으로 맞춘다
// (예전 파일은 기사 목록만 있고, 새 파일은 { "articles": [...], "more": [...] })
function normalizeNews(data) {
  if (Array.isArray(data)) return { articles: data, more: [] };
  if (data && Array.isArray(data.articles)) return { articles: data.articles, more: Array.isArray(data.more) ? data.more : [] };
  return null;
}

// 뉴스가 있는 날짜 목록을 만든다
async function loadDates() {
  // 1) 목차 파일(index.json)을 먼저 읽는다
  const index = await fetchJson("index.json");
  // 지금 형식: { "issues": [ { "date": "2026-11-26", "edition": "weekday" }, ... ] }
  if (index && Array.isArray(index.issues) && index.issues.length) {
    for (const issue of index.issues) editions[issue.date] = issue.edition;   // 날짜별 판 종류 기억
    return index.issues.map((issue) => issue.date).sort();                   // 날짜순 정렬 (오래된 → 최근)
  }
  // 예전 형식: { "dates": ["2026-11-25", ...] } (저장본이 옛날 것일 때 대비)
  if (index && Array.isArray(index.dates) && index.dates.length) {
    return [...index.dates].sort();
  }
  // 2) 목차가 없으면: 오늘부터 거슬러 올라가 가장 최근 뉴스 하나를 찾는다
  for (let back = 0; back <= LOOKBACK_DAYS; back++) {
    const date = new Date();
    date.setDate(date.getDate() - back);
    const text = formatDate(date);
    const news = normalizeNews(await fetchJson(`news_${text}.json`));
    if (news) {
      newsByDate[text] = news;   // 찾은 뉴스는 기억해 둔다
      return [text];
    }
  }
  return [];
}

// 한 날짜의 뉴스를 읽는다 (이미 읽은 날짜면 기억해 둔 것을 쓴다)
async function loadNews(date) {
  if (!newsByDate[date]) {
    const news = normalizeNews(await fetchJson(`news_${date}.json`));
    if (news) newsByDate[date] = news;   // 실패한 건 기억하지 않는다 (다음에 다시 시도)
  }
  return newsByDate[date] || null;
}

// 모든 날짜의 뉴스를 최신 날짜부터 읽는다 (오프라인이면 저장된 날짜만)
async function loadAllNews() {
  const newestFirst = [...dates].reverse();
  const results = await Promise.all(newestFirst.map(async (date) => ({ date, news: await loadNews(date) })));
  return results.filter((result) => result.news);   // 못 읽은 날짜는 뺀다
}

// ==== 화면 요소 도우미 ====
// 태그 이름과 글자, 속성을 받아 화면 요소를 만드는 도우미
// (글자는 textContent로 넣어서, 데이터에 이상한 코드가 있어도 실행되지 않는다)
function el(tag, text, attrs = {}) {
  const node = document.createElement(tag);
  if (text) node.textContent = text;
  for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, value);
  return node;
}

// 선 아이콘(SVG)을 만든다. shapes = [["path", {d: "..."}], ...]
const SVG_NS = "http://www.w3.org/2000/svg";
function icon(shapes) {
  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("aria-hidden", "true");
  for (const [tag, attrs] of shapes) {
    const shape = document.createElementNS(SVG_NS, tag);
    for (const [key, value] of Object.entries(attrs)) shape.setAttribute(key, value);
    svg.append(shape);
  }
  return svg;
}
// 아이콘 모양들
const ICONS = {
  // 오늘: 반원 해 + 수평선 + 물결 두 줄 (앱 아이콘과 같은 모양)
  today: [
    ["path", { d: "M6.5 14a5.5 5.5 0 0 1 11 0z", class: "sun" }],
    ["path", { d: "M3 14h18", class: "line" }],
    ["path", { d: "M8 17.5h8M10.5 20.5h3", class: "line" }],
  ],
  // 모아보기: 세로 책 두 권 + 비스듬한 책 한 권
  all: [
    ["path", { d: "M4 4.5h3.5v15H4z" }],
    ["path", { d: "M9.5 6.5H13v13H9.5z" }],
    ["path", { d: "M14.6 8.1l3.4-.9 3.3 12.4-3.4.9z" }],
  ],
  // 저장: 책갈피
  saved: [["path", { d: "M6.5 3.5h11v17l-5.5-4.2-5.5 4.2z" }]],
};

// 링크를 만든다 (새 탭에서 열린다). http/https 주소가 아니면 링크 없이 글자만 보여준다
function link(text, href) {
  if (!/^https?:\/\//i.test(href || "")) return el("span", text);
  return el("a", text, { href, target: "_blank", rel: "noopener noreferrer" });
}

// 코드체 라벨을 만든다. 예: "#01 PHYSICS·SPACE · 3 MIN"
// before = 분야 앞 글자, after = 분야 뒤 글자
function metaLabel(article, before, after) {
  const label = el("p", "", { class: "mono", "data-field": article.field });
  if (before) label.append(before);                                                  // 예: "#01 "
  label.append(el("span", FIELD_LABELS[article.field] || article.field, { class: "field" }));  // 분야 (분야 색)
  label.append(after);                                                               // 예: " · 3 MIN"
  return label;
}

// 썸네일을 만든다: 사진이 있으면 사진, 없거나 안 열리면 분야 색 + 모눈 + 이모지
function thumbnail(article, extraClass = "") {
  const box = el("div", "", { class: `thumb ${extraClass}`, "data-field": article.field });
  // 사진 대신 이모지를 넣는 함수
  const useEmoji = () => box.replaceChildren(el("span", article.emoji || "🔬", { class: "thumb-emoji" }));
  if (article.image) {
    // referrerpolicy=no-referrer: 다른 사이트에 "어디서 왔는지"를 알리지 않는다 (사진 막힘 줄이기)
    const img = el("img", "", { src: article.image, alt: "", loading: "lazy", referrerpolicy: "no-referrer" });
    img.addEventListener("error", useEmoji);   // 사진이 안 열리면 이모지로 바꾼다
    box.append(img);
  } else {
    useEmoji();                                // 사진 주소가 없으면 바로 이모지
  }
  return box;
}

// 제목을 [앞부분, 형광펜 부분, 뒷부분]으로 나눈다
// 형광펜 부분 = 물음표로 끝나는 마지막 구절 (쉼표가 있으면 쉼표 뒤, 없으면 뒤쪽 40% 정도)
function splitTitle(title) {
  const end = title.lastIndexOf("?") + 1;          // 물음표 바로 다음 위치
  if (end === 0) return [title, "", ""];           // 물음표가 없으면 형광펜 없음
  const comma = title.lastIndexOf(", ", end);      // 물음표 앞의 마지막 쉼표
  const start = comma >= 0
    ? comma + 2                                    // 쉼표가 있으면 쉼표 뒤부터
    : title.lastIndexOf(" ", Math.floor(end * 0.6)) + 1;  // 없으면 60% 지점 앞 띄어쓰기 뒤부터
  return [title.slice(0, start), title.slice(start, end), title.slice(end)];
}

// 책갈피(저장) 버튼. 누르면 저장/취소하고 모양을 바꾼다
function saveButton(article, date) {
  const button = el("button", "", { class: "save-btn", type: "button" });
  const paint = () => {
    const saved = isSaved(article);
    button.classList.toggle("is-saved", saved);                         // 저장: 잉크 파랑으로 채움
    button.setAttribute("aria-pressed", String(saved));
    button.setAttribute("aria-label", saved ? "저장 취소" : "저장하기");
  };
  button.append(icon(ICONS.saved));
  paint();
  button.addEventListener("click", (event) => {
    event.stopPropagation();          // 카드 전체 누르기(기사 열기)로 번지지 않게
    toggleSaved(article, date);
    paint();
    // 저장 탭 목록에서 취소하면 목록에서 빠지게 다시 그린다 (보던 위치는 그대로)
    if (location.hash === "#saved") {
      const y = window.scrollY;
      route().then(() => window.scrollTo(0, y));
    }
  });
  return button;
}

// 기사 카드 하나 (오늘·모아보기·저장 탭이 같은 모양을 쓴다)
function articleCard(article, date, index) {
  const read = isRead(article);
  const card = el("div", "", { class: read ? "card is-read" : "card", role: "link", tabindex: "0" });
  card.append(thumbnail(article));                                  // 왼쪽: 썸네일
  const text = el("div", "", { class: "card-text" });               // 오른쪽: 글
  const number = `#${String(index + 1).padStart(2, "0")} `;         // "#01 "
  const label = metaLabel(article, number, ` · ${article.read_minutes || 1} MIN`);
  if (read) label.append(el("span", "✓ 읽음", { class: "read-mark" }));   // 읽은 기사 표시
  text.append(label);
  text.append(el("h2", article.title, { class: "card-title" }));
  text.append(el("p", article.one_line, { class: "card-oneline" }));
  card.append(text);
  card.append(saveButton(article, date));                           // 오른쪽 위: 책갈피
  // 카드를 누르면(또는 Enter) 기사 화면으로
  const open = () => {
    scrollMemory[lastList] = window.scrollY;   // 돌아올 때 같은 위치를 보여주려고 기억
    openedFromCard = true;
    location.hash = `${date}/article-${index}`;
  };
  card.addEventListener("click", open);
  card.addEventListener("keydown", (event) => {
    if (event.key === "Enter" || event.key === " ") { event.preventDefault(); open(); }
  });
  return card;
}

// ==== 하단 탭 ====
const TABS = [["today", "오늘"], ["all", "모아보기"], ["saved", "저장"]];
function buildTabBar() {
  const bar = el("nav", "", { class: "tabbar", "aria-label": "화면 고르기" });
  const inner = el("div", "", { class: "tabbar-inner" });
  for (const [key, label] of TABS) {
    const tab = el("button", "", { class: "tab", type: "button", "data-tab": key });
    tab.append(icon(ICONS[key]), el("span", label));
    tab.addEventListener("click", () => {
      // 오늘 탭 = 가장 최근 날짜, 나머지는 #all / #saved
      const target = key === "today" ? dates[dates.length - 1] : key;
      if (location.hash === `#${target}`) window.scrollTo(0, 0);   // 이미 그 화면이면 맨 위로
      else location.hash = target;
    });
    inner.append(tab);
  }
  bar.append(inner);
  document.body.append(bar);
}
// 선택한 탭 표시
function setActiveTab(key) {
  for (const tab of document.querySelectorAll(".tab")) {
    const active = tab.dataset.tab === key;
    tab.classList.toggle("active", active);
    if (active) tab.setAttribute("aria-current", "page");
    else tab.removeAttribute("aria-current");
  }
}
// 목록 이름 → 탭 이름 (날짜 목록은 "오늘" 탭)
function tabOf(listKey) {
  return listKey === "all" || listKey === "saved" ? listKey : "today";
}

// 목록 화면을 그린 뒤 스크롤 위치: 기사에서 돌아왔으면 전에 보던 곳, 아니면 맨 위
function placeScroll(listKey) {
  const y = lastWasArticle && openedFromCard ? scrollMemory[listKey] : 0;
  window.scrollTo(0, y || 0);
}

// ==== 화면 1: 오늘(날짜별 목록) ====
// 맨 위 줄: 왼쪽 앱 이름 + 오른쪽 보고 있는 날짜
function topBar(date) {
  const top = el("header", "", { class: "top" });
  top.append(el("h1", "오늘 과학 🔬", { class: "app-name" }));
  top.append(el("span", longDate(date), { class: "top-date" }));
  return top;
}

// 날짜 띠: 뉴스가 있는 날짜만 칩으로 가로로 늘어놓는다
function dayStrip(current) {
  const strip = el("nav", "", { class: "days", "aria-label": "날짜 고르기" });
  const today = todayText();
  for (const date of dates) {
    const d = parseDate(date);
    const chip = el("button", "", { class: "day", type: "button", "aria-label": longDate(date) });
    if (date === today) chip.classList.add("today");          // 오늘 칩: 형광 노랑
    if (date === current) {                                   // 보고 있는 칩: 검은 테두리
      chip.classList.add("current");
      chip.setAttribute("aria-current", "date");
    }
    chip.append(el("span", DAYS_EN[d.getDay()], { class: "day-name" }));  // 위: 영어 요일
    chip.append(el("b", String(d.getDate())));                           // 아래: 날짜 숫자
    // 누르면 주소 끝이 #날짜로 바뀌고 → 그 날짜 뉴스로 다시 그린다
    chip.addEventListener("click", () => { location.hash = date; });
    strip.append(chip);
  }
  return strip;
}

// 날짜 띠를 오른쪽 끝(가장 최근)에 맞추고, 보고 있는 칩이 가려져 있으면 보이게 옮긴다
function scrollStrip(strip) {
  strip.scrollLeft = strip.scrollWidth;                        // 먼저 오른쪽 끝으로
  const chip = strip.querySelector(".current");
  if (chip && chip.offsetLeft < strip.scrollLeft) {            // 보고 있는 칩이 왼쪽에 가려졌으면
    strip.scrollLeft = chip.offsetLeft - 8;                    // 그 칩이 보이게 옮긴다
  }
}

// 이름 줄 + 날짜 띠를 그린다
function renderHead(date) {
  app.replaceChildren();
  app.append(topBar(date));
  const strip = dayStrip(date);
  app.append(strip);
  scrollStrip(strip);   // 화면에 붙인 다음에 위치를 맞춰야 한다
}

function renderList(date, news) {
  const articles = news.articles;
  renderHead(date);

  // 손글씨 메모: 그 날의 기사 수, 읽는 시간 합계, 읽은 기사 수
  const total = articles.reduce((sum, a) => sum + (a.read_minutes || 1), 0);
  let memo;
  if (editions[date] === "weekend") {
    // 주말판: 이번 주 놓친 소식 모음
    memo = `주말 특집 · 이번 주 놓친 기록 ${articles.length}건 ✍️ 다 읽어도 ${total}분!`;
  } else {
    // 평일판: 오늘이면 "오늘", 지난 날이면 "이날"
    const when = date === todayText() ? "오늘" : "이날";
    memo = `${when} 관찰 기록 ${articles.length}건 ✍️ 다 읽어도 ${total}분!`;
  }
  const readCount = articles.filter(isRead).length;
  if (readCount) memo += ` · ${readCount}건 읽음`;   // 읽은 게 있을 때만
  app.append(el("p", memo, { class: "pen memo" }));

  // 기사마다 카드를 하나씩 만든다
  articles.forEach((article, index) => app.append(articleCard(article, date, index)));

  // 맨 아래: 더 볼거리 (more가 있는 날만)
  const more = news.more.filter((item) => item && item.title && /^https?:\/\//i.test(item.link || ""));
  if (more.length) {
    const box = el("section", "", { class: "more" });
    box.append(el("h3", "📰 더 볼거리", { class: "more-title" }));
    const list = el("ul");
    for (const item of more) {
      const row = el("li");
      row.append(link(`· ${item.title} ↗`, item.link));          // 누르면 원문이 새 창으로
      row.append(el("span", item.site || "", { class: "more-site" }));
      list.append(row);
    }
    box.append(list);
    app.append(box);
  }
}

// 그 날짜 뉴스를 못 읽었을 때 (예: 오프라인인데 저장본이 없는 날)
function renderMissing(date) {
  renderHead(date);
  app.append(el("p", "이 날의 기록을 불러오지 못했어요. 인터넷 연결을 확인해주세요.", { class: "notice" }));
}

// ==== 화면 2: 모아보기 / 저장 ====
// 분야 칩: 전체 / PHYSICS·SPACE / BIO·MED / TECH·AI / EARTH·CLIMATE
function fieldChips(kind) {
  const row = el("nav", "", { class: "fields", "aria-label": "분야 고르기" });
  const options = [["", "전체"], ...Object.entries(FIELD_LABELS)];
  for (const [field, label] of options) {
    const chip = el("button", label, { class: "field-chip", type: "button" });
    if (field) chip.setAttribute("data-field", field);          // 글자를 분야 색으로
    if (fieldFilter[kind] === field) {
      chip.classList.add("selected");                           // 고른 칩: 형광 노랑 + 검은 테두리
      chip.setAttribute("aria-pressed", "true");
    }
    chip.addEventListener("click", () => {
      fieldFilter[kind] = field;
      route();                                                  // 그 분야만 보이게 다시 그린다
    });
    row.append(chip);
  }
  return row;
}

// kind = "all"(모아보기) 또는 "saved"(저장)
function renderCollection(kind, groups) {
  app.replaceChildren();
  // 날짜별 기사들을 한 줄로 펼친다 (최신 날짜부터)
  let items = [];
  for (const { date, news } of groups) {
    news.articles.forEach((article, index) => items.push({ date, index, article }));
  }
  if (kind === "saved") items = items.filter((item) => isSaved(item.article));

  // 맨 위: 이름 + 오른쪽 "전체 N건"
  const top = el("header", "", { class: "top" });
  top.append(el("h1", kind === "all" ? "모아보기" : "저장", { class: "app-name" }));
  top.append(el("span", `전체 ${items.length}건`, { class: "mono top-count" }));
  app.append(top);

  // 저장한 게 없을 때
  if (kind === "saved" && !items.length) {
    app.append(el("p", "아직 저장한 기록이 없어요. 책갈피를 눌러보세요", { class: "pen memo" }));
    return;
  }

  app.append(fieldChips(kind));
  const field = fieldFilter[kind];
  const shown = field ? items.filter((item) => item.article.field === field) : items;
  if (!shown.length) {
    app.append(el("p", "이 분야에는 아직 기록이 없어요.", { class: "notice" }));
    return;
  }
  // 날짜가 바뀔 때마다 "11.27 FRI" 머리말을 넣고 카드를 늘어놓는다
  let currentDate = null;
  for (const { date, index, article } of shown) {
    if (date !== currentDate) {
      currentDate = date;
      app.append(el("h2", dayHeader(date), { class: "day-head" }));
    }
    app.append(articleCard(article, date, index));
  }
}

// "라벨 이모지: 설명" 한 줄을 "이모지 + 굵은 라벨 + 설명" 목록 항목으로 만든다
function pointItem(text) {
  const item = el("li");
  const cut = text.indexOf(": ");                      // 라벨과 설명을 가르는 첫 ": "
  if (cut < 0) { item.textContent = text; return item; }  // 형식이 다르면 그대로 쓴다
  let label = text.slice(0, cut);                      // 예: "정확도 🎯"
  let emoji = "";
  const space = label.lastIndexOf(" ");                // 라벨의 마지막 띄어쓰기
  const tail = label.slice(space + 1);                 // 그 뒤 글자 (이모지일 것)
  if (space > 0 && /\p{Extended_Pictographic}/u.test(tail)) {  // 정말 이모지면
    emoji = tail;                                      // 이모지만 따로 떼고
    label = label.slice(0, space);                     // 라벨은 글자만 남긴다
  }
  item.append(el("span", emoji, { class: "emoji" }));  // 맨 앞: 이모지
  const body = el("span");                             // 뒤: 굵은 라벨 + 설명
  body.append(el("b", label), text.slice(cut + 2));
  item.append(body);
  return item;
}

// 본문 글을 문단과 목록으로 나눠 화면 요소로 만든다
function renderBody(body) {
  const parts = [];
  // 빈 줄(\n\n)을 기준으로 덩어리를 나눈다
  for (const block of body.split("\n\n")) {
    const lines = block.split("\n");
    // 모든 줄이 "- "로 시작하면 목록으로 만든다
    if (lines.every((line) => line.startsWith("- "))) {
      const list = el("ul", "", { class: "points" });
      for (const line of lines) list.append(pointItem(line.slice(2)));
      parts.push(list);
    } else {
      // 그 밖의 덩어리는 문단 하나로 만든다
      parts.push(el("p", block));
    }
  }
  return parts;
}

// ==== 화면 3: 기사 ====
function renderArticle(date, articles, index) {
  const article = articles[index];
  // 없는 번호면 그 날짜 목록으로 돌아간다
  if (!article) { location.hash = date; return; }
  markRead(article);   // 기사를 한 번 열면 읽음
  app.replaceChildren();

  // 뒤로 가기 버튼: 들어온 목록 이름을 보여준다
  const fromList = lastList || date;
  const backText = fromList === "all" ? "← 모아보기" : fromList === "saved" ? "← 저장" : `← ${shortDate(date)}`;
  const back = el("button", backText, { class: "back", type: "button" });
  back.addEventListener("click", () => {
    if (openedFromCard) history.back();                        // 카드를 눌러 들어왔으면 그 목록으로 그대로 돌아간다
    else location.hash = fromList === "all" || fromList === "saved" ? fromList : date;
  });
  app.append(back);

  // 기사 본문을 담는 상자
  const box = el("article", "", { class: "article" });
  // 코드체 라벨: 분야 · 시간 · 출처
  const meta = metaLabel(article, "", ` · ${article.read_minutes || 1} MIN · ${article.source_site}`);
  meta.classList.add("article-meta");
  box.append(meta);

  // 제목(물음표로 끝나는 마지막 구절에 형광펜) + 오른쪽 책갈피
  const [head, marked, tail] = splitTitle(article.title);
  const title = el("h1", "", { class: "article-title" });
  title.append(head);
  if (marked) title.append(el("span", marked, { class: "marker" }));
  title.append(tail);
  const titleRow = el("div", "", { class: "title-row" });
  titleRow.append(title, saveButton(article, date));
  box.append(titleRow);

  // 큰 썸네일과 도입부
  box.append(thumbnail(article, "thumb-big"));
  box.append(el("p", article.lead, { class: "lead" }));

  // 소제목(Q1, Q2...)과 본문
  article.sections.forEach((section, i) => {
    const heading = el("h2", "", { class: "section-heading" });
    heading.append(el("span", `Q${i + 1}`, { class: "q" }), section.heading);
    box.append(heading, ...renderBody(section.body));
  });

  // 용어 풀이 (있을 때만)
  if (article.notes && article.notes.length) {
    const notes = el("section", "", { class: "glossary" });
    notes.append(el("h3", "📖 GLOSSARY"));
    const dl = el("dl");
    for (const note of article.notes) dl.append(el("dt", note.term), el("dd", note.desc));
    notes.append(dl);
    box.append(notes);
  }

  // 출처
  const source = el("section", "", { class: "sources" });
  source.append(el("span", "src · 출처", { class: "mono" }));
  const original = el("p");
  original.append(`${article.source_site} · `, link(article.original_title, article.link));
  source.append(original);
  // 보충 자료 (있을 때만)
  if (article.sources && article.sources.length) {
    source.append(el("span", "ref · 보충 자료", { class: "mono" }));
    const list = el("ul");
    for (const extra of article.sources) {
      const item = el("li");
      item.append(link(extra.name, extra.link));
      list.append(item);
    }
    source.append(list);
  }
  box.append(source);

  app.append(box);
  // 기사를 열면 맨 위부터 보이게 한다
  window.scrollTo(0, 0);
}

// ==== 주소 보고 화면 고르기 ====
// 주소 끝 모양:
//   (없음)                 → 가장 최근 날짜 목록 (오늘 탭)
//   #2026-11-25            → 그 날짜 목록 (오늘 탭)
//   #2026-11-25/article-2  → 그 날짜의 3번째 기사
//   #article-2             → (예전 주소) 가장 최근 날짜의 3번째 기사
//   #all                   → 모아보기 탭
//   #saved                 → 저장 탭
async function route() {
  const turn = ++routeTurn;                                       // 이번 그리기 순번
  const hash = location.hash.replace(/^#/, "");

  // 모아보기 / 저장 탭
  if (hash === "all" || hash === "saved") {
    setActiveTab(hash);
    // 아직 안 받은 날짜가 있으면 잠깐 안내를 띄운다
    if (dates.some((date) => !newsByDate[date])) {
      app.replaceChildren(el("p", "관찰 기록을 모으는 중이에요…", { class: "status" }));
    }
    const groups = await loadAllNews();
    if (turn !== routeTurn) return;                               // 그새 다른 화면을 눌렀으면 그만
    renderCollection(hash, groups);
    placeScroll(hash);
    lastList = hash;
    lastWasArticle = false;
    openedFromCard = false;
    return;
  }

  // 날짜 목록 / 기사
  const match = hash.match(/^(\d{4}-\d{2}-\d{2})?\/?(?:article-(\d+))?$/);
  const date = (match && match[1]) || dates[dates.length - 1];   // 날짜가 없으면 가장 최근
  const index = match && match[2] !== undefined ? Number(match[2]) : null;
  const news = await loadNews(date);
  if (turn !== routeTurn) return;

  if (index === null) {
    // 날짜 목록 (오늘 탭)
    setActiveTab("today");
    if (!news) renderMissing(date);
    else renderList(date, news);
    placeScroll(date);
    lastList = date;
    lastWasArticle = false;
    openedFromCard = false;
  } else {
    // 기사: 들어온 목록의 탭을 켜 둔다
    setActiveTab(tabOf(lastList));
    if (!news) renderMissing(date);
    else renderArticle(date, news.articles, index);
    lastWasArticle = true;
  }
}

// ==== 시작 ====
async function start() {
  dates = await loadDates();
  // 뉴스 파일을 하나도 못 찾으면 안내한다
  if (!dates.length) {
    app.replaceChildren(el("p", "뉴스를 읽지 못했어요. 인터넷 연결이나 로컬 서버를 확인해주세요.", { class: "status" }));
    return;
  }
  buildTabBar();
  // 주소가 바뀔 때마다(탭·칩·카드 누르기, 뒤로 가기) 화면을 다시 그린다
  window.addEventListener("hashchange", route);
  route();
}

// ==== 오프라인 안내 ====
// 인터넷 연결 상태에 따라 맨 위 손글씨 안내를 켜고 끈다
const offlineNote = document.getElementById("offline");
function showConnection() {
  offlineNote.hidden = navigator.onLine;   // 연결돼 있으면 숨기고, 끊기면 보인다
}
window.addEventListener("online", showConnection);    // 연결이 돌아오면
window.addEventListener("offline", showConnection);   // 연결이 끊기면
showConnection();                                      // 처음 열었을 때 한 번

// ==== 서비스 워커(오프라인 저장 담당) 등록 ====
if ("serviceWorker" in navigator) {
  // 이미 서비스 워커가 맡고 있던 화면인지 기억한다 (처음 설치 때는 새로고침하지 않기 위해)
  const hadWorker = Boolean(navigator.serviceWorker.controller);
  let reloaded = false;
  // 새 버전 서비스 워커가 일을 맡으면 한 번만 새로고침해서 새 화면 파일을 보여준다
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (hadWorker && !reloaded) { reloaded = true; location.reload(); }
  });
  // sw.js를 등록한다 (실패해도 화면은 그대로 동작한다)
  navigator.serviceWorker.register("sw.js").then((registration) => {
    // 앱을 다시 열어 화면에 돌아올 때마다 새 버전이 있는지 확인한다
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible") registration.update().catch(() => {});
    });
  }).catch((error) => console.warn("서비스 워커 등록 실패", error));
}

start();
