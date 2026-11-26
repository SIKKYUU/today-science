// ==== 설정 ====
// 뉴스 파일이 있는 폴더 (web 폴더 기준으로 한 칸 위의 data 폴더)
const DATA_DIR = "../data/";
// 오늘 파일이 없을 때 며칠 전까지 거슬러 올라가며 찾을지
const LOOKBACK_DAYS = 30;
// 분야 이름을 코드체 영어 라벨로 바꾸는 표
const FIELD_LABELS = {
  "물리·우주": "PHYSICS·SPACE",
  "생명·의학": "BIO·MED",
  "기술·AI": "TECH·AI",
  "환경·기후": "EARTH·CLIMATE",
};

// 화면 전체를 담는 상자
const app = document.getElementById("app");
// 불러온 뉴스 기사 목록과 그 날짜를 담아둘 곳
let articles = [];
let newsDate = null;

// 날짜를 "2026-11-25"(구분자 "-") 또는 "2026.11.25"(구분자 ".") 형식으로 바꾼다
function formatDate(date, sep = "-") {
  const y = date.getFullYear();                              // 연도
  const m = String(date.getMonth() + 1).padStart(2, "0");    // 월 (두 자리)
  const d = String(date.getDate()).padStart(2, "0");         // 일 (두 자리)
  return [y, m, d].join(sep);                                // 구분자로 이어 붙이기
}

// 오늘부터 하루씩 거슬러 올라가며, 가장 최근 news_날짜.json을 찾아 읽는다
async function loadLatestNews() {
  for (let back = 0; back <= LOOKBACK_DAYS; back++) {
    // 오늘에서 back일 전 날짜를 만든다
    const date = new Date();
    date.setDate(date.getDate() - back);
    // 그 날짜의 파일을 요청한다
    const response = await fetch(`${DATA_DIR}news_${formatDate(date)}.json`, { cache: "no-store" });
    // 파일이 있으면 내용을 읽어서 돌려준다
    if (response.ok) return { date, list: await response.json() };
  }
  // 끝까지 못 찾으면 null을 돌려준다
  return null;
}

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
function renderList() {
  app.replaceChildren();
  // 맨 위 줄: 앱 이름 + LOG 날짜
  const top = el("header", "", { class: "top" });
  top.append(el("h1", "오늘과학 🔬", { class: "app-name" }));
  top.append(el("span", `LOG ${formatDate(newsDate, ".")}`, { class: "mono" }));
  app.append(top);

  // 손글씨 메모: 기사 수와 읽는 시간 합계
  const total = articles.reduce((sum, a) => sum + (a.read_minutes || 1), 0);
  app.append(el("p", `오늘 관찰 기록 ${articles.length}건 ✍️ 다 읽어도 ${total}분!`, { class: "pen memo" }));

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
    // 카드를 누르면 주소 끝을 #article-번호로 바꿔 기사 화면으로 간다
    card.addEventListener("click", () => { location.hash = `article-${index}`; });
    app.append(card);
  });

  // 맨 아래 손글씨
  app.append(el("p", "내일 아침, 다음 기록 →", { class: "pen end" }));
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
function renderArticle(index) {
  const article = articles[index];
  // 없는 번호면 목록으로 돌아간다
  if (!article) { location.hash = ""; return; }
  app.replaceChildren();

  // 뒤로 가기 버튼 (코드체)
  const back = el("button", `← LOG ${formatDate(newsDate, ".")}`, { class: "back", type: "button" });
  back.addEventListener("click", () => { location.hash = ""; });
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

// 주소 끝(#article-번호)을 보고 어떤 화면을 그릴지 정한다
function route() {
  const match = location.hash.match(/^#article-(\d+)$/);
  if (match) renderArticle(Number(match[1]));
  else renderList();
}

// ==== 시작 ====
async function start() {
  try {
    const result = await loadLatestNews();
    // 뉴스 파일을 못 찾으면 안내한다
    if (!result) {
      app.replaceChildren(el("p", `최근 ${LOOKBACK_DAYS}일 안에 만든 뉴스 파일이 없어요.`, { class: "status" }));
      return;
    }
    articles = result.list;
    newsDate = result.date;
    // 주소가 바뀔 때마다(카드 누르기, 뒤로 가기) 화면을 다시 그린다
    window.addEventListener("hashchange", route);
    route();
  } catch (error) {
    // 파일을 더블클릭해서 열면 여기로 온다 (브라우저가 파일 읽기를 막기 때문)
    app.replaceChildren(el("p", "뉴스를 읽지 못했어요. 로컬 서버로 열었는지 확인해주세요.", { class: "status" }));
    console.error(error);
  }
}

start();
