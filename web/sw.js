// ==== 오늘 과학 서비스 워커 ====
// 서비스 워커 = 브라우저 안에서 앱과 인터넷 사이에 서서, 파일 요청을 대신 처리해주는 작은 프로그램.
// 덕분에 인터넷이 끊겨도 저장해둔 파일로 화면을 열 수 있다.

// ★ 버전: web 폴더 파일(html, css, js, 아이콘)을 고치면 이 숫자를 꼭 올린다 (v1 → v2 …)
//   숫자가 바뀌면 아이폰이 "새 버전이 있다"는 걸 알아채고 화면 파일을 새로 받는다.
const VERSION = "v3";

// 저장소(캐시) 이름들
const SHELL = `shell-${VERSION}`;  // 화면 파일 저장소 (버전마다 새로 만든다)
const DATA = "data";               // 뉴스 json 저장소
const FONTS = "fonts";             // 글꼴 저장소
const IMAGES = "images";           // 기사 사진 저장소

// 저장소마다 최대 몇 개까지 남길지 (넘으면 오래된 것부터 지운다)
const DATA_LIMIT = 14;             // 뉴스 파일: 약 2주치
const IMAGE_LIMIT = 60;            // 기사 사진: 약 2주치

// 구글 폰트 CSS 주소 (index.html에 있는 것과 똑같아야 한다)
const FONT_CSS = "https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500;600&family=IBM+Plex+Sans+KR:wght@400;500;700&family=Nanum+Pen+Script&display=swap";

// 설치할 때 미리 저장해둘 화면 파일 (이 파일 위치 기준)
const SHELL_FILES = [
  "./",                    // 화면 주소 그대로 열었을 때
  "index.html",
  "style.css",
  "app.js",
  "manifest.json",
  "icon.svg",
  "apple-touch-icon.png",
  "icon-192.png",
  "icon-512.png",
];

// 이 서비스 워커가 맡는 폴더 경로 (예: "/today-science/web/")
const SCOPE_PATH = new URL("./", self.location).pathname;

// ==== 1. 설치: 화면 파일을 미리 저장한다 ====
self.addEventListener("install", (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(SHELL);
    // cache: "reload" → 브라우저 임시 보관본 말고 서버에서 새로 받아 저장한다
    await cache.addAll(SHELL_FILES.map((url) => new Request(url, { cache: "reload" })));
    // 글꼴 CSS도 저장해둔다 (실패해도 설치는 계속한다)
    try {
      const fonts = await caches.open(FONTS);
      await fonts.add(new Request(FONT_CSS, { mode: "cors" }));
    } catch (error) {
      console.warn("글꼴 CSS 저장 실패", error);
    }
    // 새 버전이면 기다리지 않고 바로 일을 시작한다
    await self.skipWaiting();
  })());
});

// ==== 2. 활성화: 옛날 버전 화면 파일을 지운다 ====
self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    for (const name of await caches.keys()) {
      // "shell-"로 시작하는데 지금 버전이 아니면 지운다
      if (name.startsWith("shell-") && name !== SHELL) await caches.delete(name);
    }
    // 이미 열려 있는 화면도 바로 이 서비스 워커가 맡는다
    await self.clients.claim();
  })());
});

// ==== 3. 요청 처리: 파일 종류마다 다른 방법을 쓴다 ====
self.addEventListener("fetch", (event) => {
  const request = event.request;
  // 읽기(GET) 요청만 다룬다
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  const sameSite = url.origin === self.location.origin;

  // ① 뉴스 파일(data의 json): 인터넷 먼저, 안 되면 저장본
  if (sameSite && url.pathname.includes("/data/") && url.pathname.endsWith(".json")) {
    event.respondWith(networkFirst(request));
    return;
  }
  // ② 글꼴: 저장본 먼저, 없으면 받아서 저장
  if (url.hostname === "fonts.googleapis.com" || url.hostname === "fonts.gstatic.com") {
    event.respondWith(cacheFirst(request, FONTS));
    return;
  }
  // ③ 화면 파일(web 폴더): 저장본으로 빠르게 연다
  if (sameSite && url.pathname.startsWith(SCOPE_PATH)) {
    event.respondWith(shellFirst(request));
    return;
  }
  // ④ 기사 사진(다른 사이트 이미지): 한 번 본 것만 저장
  if (request.destination === "image") {
    event.respondWith(imageCache(request));
    return;
  }
  // 그 밖의 요청은 서비스 워커가 손대지 않는다
});

// 화면 파일: 저장본이 있으면 그걸 주고, 없으면 인터넷에서 받는다
async function shellFirst(request) {
  const cache = await caches.open(SHELL);
  // ?가 붙은 주소도 같은 파일로 본다
  const saved = await cache.match(request, { ignoreSearch: true });
  if (saved) return saved;
  try {
    return await fetch(request);
  } catch (error) {
    // 오프라인에서 화면 주소를 열면 저장해둔 첫 화면을 준다
    if (request.mode === "navigate") {
      const page = await cache.match("./");
      if (page) return page;
    }
    return Response.error();
  }
}

// 뉴스 파일: 인터넷에서 새로 받아 저장하고, 실패하면 저장본을 준다
async function networkFirst(request) {
  const cache = await caches.open(DATA);
  try {
    const response = await fetch(request);
    // 파일이 있을 때(200)만 저장한다 (없는 날짜 404는 저장하지 않는다)
    if (response.ok) {
      await cache.put(request, response.clone());
      trim(DATA, DATA_LIMIT);
    }
    return response;
  } catch (error) {
    const saved = await cache.match(request, { ignoreSearch: true });
    // 저장본도 없으면 "없음(404)"으로 답한다 → app.js가 하루 전 파일을 찾으러 간다
    return saved || new Response("", { status: 404, statusText: "Offline" });
  }
}

// 글꼴: 저장본 먼저, 없으면 인터넷에서 받아 저장한다
async function cacheFirst(request, cacheName) {
  const cache = await caches.open(cacheName);
  const saved = await cache.match(request, { ignoreVary: true });
  if (saved) return saved;
  const response = await fetch(request);   // 오프라인이면 실패 → 기본 글꼴로 보인다
  if (response.ok || response.type === "opaque") await cache.put(request, response.clone());
  return response;
}

// 기사 사진: 한 번 본 사진만 저장하고, 오프라인에서 없으면 실패로 답한다
async function imageCache(request) {
  const cache = await caches.open(IMAGES);
  const saved = await cache.match(request, { ignoreVary: true });
  if (saved) return saved;
  try {
    const response = await fetch(request);
    // 다른 사이트 사진은 내용을 들여다볼 수 없는 형태(opaque)로 오는데, 그래도 저장할 수 있다
    if (response.ok || response.type === "opaque") {
      await cache.put(request, response.clone());
      trim(IMAGES, IMAGE_LIMIT);
    }
    return response;
  } catch (error) {
    // 실패로 답하면 app.js가 사진 대신 이모지 썸네일을 보여준다
    return Response.error();
  }
}

// 저장소가 max개를 넘으면 오래된 것부터 지운다
async function trim(cacheName, max) {
  const cache = await caches.open(cacheName);
  const keys = await cache.keys();
  for (const key of keys.slice(0, Math.max(0, keys.length - max))) await cache.delete(key);
}
