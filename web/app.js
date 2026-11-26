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
// 요일 이름: 한국어(날짜 글자용), 영어(날짜 칩용)
const DAYS_KO = ["일", "월", "화", "수", "목", "금", "토"];
const DAYS_EN = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"];

// 화면 전체를 담는 상자
const app = document.getElementById("app");
// 뉴스가 있는 날짜 목록 (오래된 날 → 최근 날, 예: "2026-11-26")
let dates = [];
// 날짜별로 불러온 기사 목록 (한 번 받은 날짜는 다시 받지 않는다)
const newsByDate = {};
// 날짜별 판 종류: "weekday"(평일판) 또는 "weekend"(주말판)
const editions = {};
// 화면 그리기 순번 (느린 응답이 늦게 도착해 최신 화면을 덮어쓰지 않게)
let routeTurn = 0;

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
// 오늘 날짜 글자 ("2026-11-26")
function todayText() {
  return formatDate(new Date());
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
    const list = await fetchJson(`news_${text}.json`);
    if (list) {
      newsByDate[text] = list;   // 찾은 뉴스는 기억해 둔다
      return [text];
    }
  }
  return [];
}

// 한 날짜의 뉴스 5개를 읽는다 (이미 읽은 날짜면 기억해 둔 것을 쓴다)
async function loadNews(date) {
  if (!newsByDate[date]) {
    const list = await fetchJson(`news_${date}.json`);
    if (list) newsByDate[date] = list;   // 실패한 건 기억하지 않는다 (다음에 다시 시도)
  }
  return newsByDate[date] || null;
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

// ==== 화면 1: 목록 ====
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

// 이름 줄 + 날짜 띠를 그리고, 날짜 띠를 돌려준다
function renderHead(date) {
  app.replaceChildren();
  app.append(topBar(date));
  const strip = dayStrip(date);
  app.append(strip);
  scrollStrip(strip);   // 화면에 붙인 다음에 위치를 맞춰야 한다
}

function renderList(date, articles) {
  renderHead(date);

  // 손글씨 메모: 그 날의 기사 수와 읽는 시간 합계
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
  app.append(el("p", memo, { class: "pen memo" }));

  // 기사마다 카드를 하나씩 만든다
  articles.forEach((article, index) => {
    const card = el("button", "", { class: "card", type: "button" });
    card.append(thumbnail(article));                                  // 왼쪽: 썸네일
    const text = el("div", "", { class: "card-text" });               // 오른쪽: 글
    const number = `#${String(index + 1).padStart(2, "0")} `;         // "#01 "
    text.append(metaLabel(article, number, ` · ${article.read_minutes || 1} MIN`));
    text.append(el("h2", article.title, { class: "card-title" }));
    text.append(el("p", article.one_line, { class: "card-oneline" }));
    card.append(text);
    // 카드를 누르면 주소 끝을 #날짜/article-번호로 바꿔 기사 화면으로 간다
    card.addEventListener("click", () => { location.hash = `${date}/article-${index}`; });
    app.append(card);
  });
}

// 그 날짜 뉴스를 못 읽었을 때 (예: 오프라인인데 저장본이 없는 날)
function renderMissing(date) {
  renderHead(date);
  app.append(el("p", "이 날의 기록을 불러오지 못했어요. 인터넷 연결을 확인해주세요.", { class: "notice" }));
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

// 링크를 만든다 (새 탭에서 열린다)
function link(text, href) {
  return el("a", text, { href, target: "_blank", rel: "noopener noreferrer" });
}

// ==== 화면 2: 기사 ====
function renderArticle(date, articles, index) {
  const article = articles[index];
  // 없는 번호면 그 날짜 목록으로 돌아간다
  if (!article) { location.hash = date; return; }
  app.replaceChildren();

  // 뒤로 가기 버튼: "← 11월 26일 목요일" → 그 날짜 목록으로
  const back = el("button", `← ${shortDate(date)}`, { class: "back", type: "button" });
  back.addEventListener("click", () => { location.hash = date; });
  app.append(back);

  // 기사 본문을 담는 상자
  const box = el("article", "", { class: "article" });
  // 코드체 라벨: 분야 · 시간 · 출처
  const meta = metaLabel(article, "", ` · ${article.read_minutes || 1} MIN · ${article.source_site}`);
  meta.classList.add("article-meta");
  box.append(meta);

  // 제목: 물음표로 끝나는 마지막 구절에 형광펜
  const [head, marked, tail] = splitTitle(article.title);
  const title = el("h1", "", { class: "article-title" });
  title.append(head);
  if (marked) title.append(el("span", marked, { class: "marker" }));
  title.append(tail);
  box.append(title);

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
//   (없음)                 → 가장 최근 날짜 목록
//   #2026-11-25            → 그 날짜 목록
//   #2026-11-25/article-2  → 그 날짜의 3번째 기사
//   #article-2             → (예전 주소) 가장 최근 날짜의 3번째 기사
async function route() {
  const turn = ++routeTurn;                                       // 이번 그리기 순번
  const match = location.hash.match(/^#?(\d{4}-\d{2}-\d{2})?\/?(?:article-(\d+))?$/);
  const date = (match && match[1]) || dates[dates.length - 1];   // 날짜가 없으면 가장 최근
  const index = match && match[2] !== undefined ? Number(match[2]) : null;
  const articles = await loadNews(date);
  if (turn !== routeTurn) return;                                 // 그새 다른 화면을 눌렀으면 그만
  if (!articles) renderMissing(date);
  else if (index === null) renderList(date, articles);
  else renderArticle(date, articles, index);
}

// ==== 시작 ====
async function start() {
  dates = await loadDates();
  // 뉴스 파일을 하나도 못 찾으면 안내한다
  if (!dates.length) {
    app.replaceChildren(el("p", "뉴스를 읽지 못했어요. 인터넷 연결이나 로컬 서버를 확인해주세요.", { class: "status" }));
    return;
  }
  // 주소가 바뀔 때마다(칩·카드 누르기, 뒤로 가기) 화면을 다시 그린다
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
