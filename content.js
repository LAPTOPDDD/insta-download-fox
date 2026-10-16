(() => {
  if (window.__instaFoxLoaded) return;
  window.__instaFoxLoaded = true;

  const api = typeof browser !== "undefined" ? browser : chrome;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  /* ---------- сниффер сети (page context) ---------- */

  const mediaMap = new Map();

  window.addEventListener("message", (e) => {
    const d = e.data;
    if (!d || d.__ifx !== "media" || typeof d.code !== "string") return;
    mediaMap.set(d.code, {
      videos: Array.isArray(d.videos) ? d.videos : [],
      images: Array.isArray(d.images) ? d.images : [],
      carousel: !!d.carousel
    });
  });

  function injectSniffer() {
    const run = () => {
      try {
        const s = document.createElement("script");
        s.src = api.runtime.getURL("sniffer.js");
        s.async = false;
        s.onload = () => {
          s.remove();
          window.postMessage({ __ifx: "query" }, "*");
        };
        (document.head || document.documentElement).appendChild(s);
        window.postMessage({ __ifx: "query" }, "*");
      } catch (e) {}
    };
    if (document.documentElement) run();
    else document.addEventListener("readystatechange", function once() {
      run();
      document.removeEventListener("readystatechange", once);
    });
  }
  injectSniffer();

  let mousePost = null;

  document.addEventListener(
    "mouseover",
    (e) => {
      const c = postOf(e.target);
      if (c) mousePost = c;
    },
    true
  );

  function postOf(el) {
    if (!(el instanceof Element)) return null;
    return el.closest('article, div[role="dialog"]');
  }

  function dedupe(arr) {
    return Array.from(new Set(arr.filter(Boolean)));
  }

  function toast(text, ms) {
    const t = document.createElement("div");
    t.className = "ifx-toast";
    t.textContent = text;
    document.documentElement.appendChild(t);
    requestAnimationFrame(() => t.classList.add("ifx-show"));
    setTimeout(() => {
      t.classList.remove("ifx-show");
      setTimeout(() => t.remove(), 400);
    }, ms || 2600);
  }

  const POST_PATH = /\/(?:p|reel|reels|tv)\/[A-Za-z0-9_-]+/;

  function codeFromUrl(u) {
    if (!u) return null;
    const m = String(u).match(/\/(?:p|reel|reels|tv)\/([A-Za-z0-9_-]+)/);
    return m ? m[1] : null;
  }

  function postCode() {
    return codeFromUrl(location.href) || "post";
  }

  function isPermalink() {
    return POST_PATH.test(location.pathname);
  }

  function isMediaUrl(u) {
    return /\.(mp4|mov|m3u8|webm)(\?|#|$)/i.test(u) || /\.mp4/i.test(u);
  }

  /* ---------- сбор медиа из DOM ---------- */

  function gatherMedia(container) {
    const urls = [];

    container.querySelectorAll("video").forEach((v) => {
      const s = v.currentSrc || v.src;
      if (s && /^https?:/i.test(s)) urls.push(s);
      v.querySelectorAll("source").forEach((so) => {
        if (so.src && /^https?:/i.test(so.src)) urls.push(so.src);
      });
    });

    container.querySelectorAll("img").forEach((img) => {
      const src = img.currentSrc || img.src;
      if (!src || !/^https?:/i.test(src)) return;
      if (/rsrc\.php|emoji|\/static\//i.test(src)) return;
      const alt = img.alt || "";
      if (/profile picture|аватар|фото профиля|снимок профиля|profile photo/i.test(alt)) return;
      const r = img.getBoundingClientRect();
      const big = r.width >= 150 && r.height >= 150;
      const described = alt.length > 15;
      if (!big && !described) return;
      urls.push(src);
    });

    return dedupe(urls);
  }

  /* ---------- поиск кнопок "вперёд/назад" в карусели ---------- */

  function findNav(container, dir) {
    const cRect = container.getBoundingClientRect();
    if (cRect.width < 100) return null;

    const btns = Array.from(container.querySelectorAll('button,[role="button"],a[role="button"]'));
    const re = /^(next|далее|следующ|вперёд|вперед)/i;
    const rePrev = /^(prev|назад|предыдущ)/i;
    const bad = /(like|нрав|comment|коммент|share|подел|save|сохран|menu|меню|more|ещё|еще|follow|подпис|close|закры|report|жалоб|copy|копир|embed|адрес)/i;

    for (const b of btns) {
      if (b.dataset.ifx) continue;
      const al = b.getAttribute("aria-label") || "";
      const wanted = dir > 0 ? re : rePrev;
      if (wanted.test(al.trim())) return b;
    }

    const cand = btns.filter((b) => {
      if (b.dataset.ifx) return false;
      const al = b.getAttribute("aria-label") || "";
      if (bad.test(al)) return false;
      const r = b.getBoundingClientRect();
      if (r.width < 8 || r.width > 90 || r.height < 8 || r.height > 90) return false;
      const cx = r.left + r.width / 2;
      const cy = r.top + r.height / 2;
      if (cy < cRect.top + cRect.height * 0.25 || cy > cRect.top + cRect.height * 0.75) return false;
      if (dir > 0 && cx < cRect.left + cRect.width * 0.55) return false;
      if (dir < 0 && cx > cRect.left + cRect.width * 0.45) return false;
      return true;
    });
    return cand[0] || null;
  }

  async function traverseCarousel(container, sink) {
    let steps = 0;
    let stale = 0;

    if (!findNav(container, 1)) return 0;

    for (let i = 0; i < 12; i++) {
      if (!document.contains(container)) break;
      const before = gatherMedia(container).length;
      const btn = findNav(container, 1);
      if (!btn) break;
      btn.click();
      steps++;
      await sleep(800);
      const added = gatherMedia(container);
      sink(added);
      if (added.length <= before) {
        stale++;
        if (stale >= 2) break;
      } else {
        stale = 0;
      }
    }

    for (let i = 0; i < steps; i++) {
      const p = findNav(container, -1);
      if (!p || !document.contains(container)) break;
      p.click();
      await sleep(450);
    }
    return steps;
  }

  /* ---------- чтение JSON публикации (/p/, /reel/) ---------- */

  function findPermalink(container) {
    if (container) {
      for (const a of container.querySelectorAll("a[href]")) {
        const href = a.getAttribute("href") || "";
        if (POST_PATH.test(href)) {
          try {
            return new URL(href, location.origin).href;
          } catch (e) {}
        }
      }
    }
    if (isPermalink()) return location.origin + location.pathname;
    return null;
  }

  function grabJson(html, rx) {
    const out = [];
    let m;
    while ((m = rx.exec(html))) {
      try {
        out.push(JSON.parse('"' + m[1] + '"'));
      } catch (e) {}
    }
    return out;
  }

  async function fetchPostInfo(url) {
    if (!url) return null;
    try {
      const r = await fetch(url, { credentials: "include" });
      if (!r.ok) return null;
      const html = await r.text();

      const videos = dedupe(
        grabJson(html, /"(?:video_url)":"((?:[^"\\]|\\.)+)"/g)
          .concat(grabJson(html, /"contentUrl":"((?:[^"\\]|\\.)+)"/g))
          .filter((u) => /\.(mp4|mov|m3u8)|video/i.test(u))
      );

      let images = dedupe(grabJson(html, /"display_url":"((?:[^"\\]|\\.)+)"/g));

      const carousel = html.indexOf("edge_sidecar_to_children") !== -1;
      if (!carousel && videos.length) images = [];

      return { videos: videos, images: images, carousel: carousel };
    } catch (e) {
      return null;
    }
  }

  /* ---------- кнопка ---------- */

  function actionBar(container) {
    const labels = Array.from(container.querySelectorAll("[aria-label]"));
    const like = labels.find((n) => /^(like|нравится)$/i.test(n.getAttribute("aria-label").trim()));
    if (!like) return null;
    let bar = like.parentElement;
    for (let i = 0; i < 4 && bar; i++) {
      const cnt = bar.querySelectorAll('button,[role="button"]').length;
      if (cnt >= 3) return bar;
      bar = bar.parentElement;
    }
    return null;
  }

  function makeBtn(container) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "ifx-dl-btn";
    b.dataset.ifx = "1";
    b.title = "Скачать видео / карусель";
    b.textContent = "⬇ DL";
    b.addEventListener(
      "click",
      (ev) => {
        ev.preventDefault();
        ev.stopPropagation();
        downloadPost(container);
      },
      true
    );
    return b;
  }

  function injectButtons() {
    const roots = document.querySelectorAll('article, div[role="dialog"]');
    roots.forEach((container) => {
      if (container.dataset.ifxDone) return;
      if (!container.querySelector("video, img")) return;
      container.dataset.ifxDone = "1";

      const btn = makeBtn(container);
      const bar = actionBar(container);
      if (bar) {
        bar.appendChild(btn);
      } else {
        if (getComputedStyle(container).position === "static") container.style.position = "relative";
        btn.classList.add("ifx-float");
        container.appendChild(btn);
      }
    });
  }

  /* ---------- основной процесс ---------- */

  async function downloadPost(container) {
    if (!container || container.dataset.ifxBusy) return;
    container.dataset.ifxBusy = "1";
    toast("InstaFox: собираю медиа…");

    try {
      const permalink = findPermalink(container);
      const code = codeFromUrl(permalink) || codeFromUrl(location.href) || "post";

      const cached = mediaMap.get(code);
      let videos = [];
      let images = [];

      if (cached && (cached.videos.length || cached.images.length)) {
        videos = cached.videos.slice();
        if (cached.carousel || !cached.videos.length) images = cached.images.slice();
      } else {
        const info = await fetchPostInfo(permalink);
        if (info && (info.videos.length || info.images.length)) {
          videos = info.videos;
          images = info.images;
        }
      }

      if (!videos.length && !images.length) {
        const dom = gatherMedia(container);
        await traverseCarousel(container, (u) => dom.push(...u));
        const all = dedupe(dom).filter((u) => !/^blob:/i.test(u));
        videos = all.filter(isMediaUrl);
        images = all.filter((u) => !isMediaUrl(u));
      } else {
        const dom = gatherMedia(container).filter((u) => !/^blob:/i.test(u) && isMediaUrl(u));
        videos = dedupe(videos.concat(dom));
      }

      const og = document.querySelector('meta[property="og:video:url"],meta[property="og:video"]');
      if (og && og.content && /^https?:/i.test(og.content)) videos.push(og.content);

      const urls = dedupe(videos.concat(images)).filter((u) => /^https?:/i.test(u));

      if (!urls.length) {
        toast("InstaFox: медиа не найдено. Откройте пост и повторите.", 4000);
        return;
      }

      if (!videos.length && container.querySelector("video")) {
        toast("InstaFox: ссылка на видео не найдена — пролистайте пост заново и нажмите кнопку", 4000);
      }

      const res = await api.runtime.sendMessage({
        type: "download",
        files: urls,
        code: code
      });

      if (res && res.ok === res.total) {
        toast("InstaFox: сохранено файлов: " + res.ok + " → папка InstaFox");
      } else if (res && res.ok > 0) {
        toast("InstaFox: сохранено " + res.ok + " из " + res.total + (res.err ? " (" + res.err + ")" : ""));
      } else {
        toast("InstaFox: не удалось скачать" + (res && res.err ? " — " + res.err : ""), 4000);
      }
    } catch (e) {
      toast("InstaFox: ошибка — " + (e && e.message ? e.message : e));
    } finally {
      delete container.dataset.ifxBusy;
    }
  }

  function bestVisiblePost() {
    const dialog = document.querySelector('div[role="dialog"]');
    if (dialog && dialog.querySelector("video, img")) return dialog;

    const roots = Array.from(document.querySelectorAll("article"));
    let best = null;
    let bestScore = 0;
    for (const r of roots) {
      const rect = r.getBoundingClientRect();
      if (rect.width < 100 || rect.height < 100) continue;
      const visW = Math.min(rect.bottom, innerHeight) - Math.max(rect.top, 0);
      const visH = Math.min(rect.right, innerWidth) - Math.max(rect.left, 0);
      const score = Math.max(0, visW) * Math.max(0, visH);
      if (score > bestScore) {
        bestScore = score;
        best = r;
      }
    }
    if (best) return best;
    if (mousePost && document.contains(mousePost)) return mousePost;
    return roots[0] || null;
  }

  api.runtime.onMessage.addListener((msg) => {
    if (msg && msg.type === "downloadVisible") {
      const p = bestVisiblePost();
      if (p) downloadPost(p);
      else toast("InstaFox: публикация не найдена на странице");
    }
  });

  /* ---------- наблюдатель за DOM ---------- */

  let timer = null;
  const mo = new MutationObserver(() => {
    if (timer) return;
    timer = setTimeout(() => {
      timer = null;
      injectButtons();
    }, 700);
  });

  function startObserver() {
    const root = document.documentElement;
    if (!root) {
      document.addEventListener("readystatechange", function once() {
        document.removeEventListener("readystatechange", once);
        startObserver();
      });
      return;
    }
    mo.observe(root, { childList: true, subtree: true });
    injectButtons();
    setTimeout(injectButtons, 1500);
  }
  startObserver();
})();
