(function () {
  if (window.__instaFoxSniffer) return;
  window.__instaFoxSniffer = true;

  var media = Object.create(null);
  var KEY = /video_versions|video_url|display_url|image_versions2/;

  function uniq(arr) {
    var seen = Object.create(null);
    var out = [];
    for (var i = 0; i < arr.length; i++) {
      var v = arr[i];
      if (!v || seen[v]) continue;
      seen[v] = 1;
      out.push(v);
    }
    return out;
  }

  function collect(m, acc) {
    if (!m || typeof m !== "object") return;
    if (Array.isArray(m.video_versions)) {
      for (var i = 0; i < m.video_versions.length; i++) {
        var v = m.video_versions[i];
        if (v && v.url) acc.videos.push(v.url);
      }
    }
    if (typeof m.video_url === "string") acc.videos.push(m.video_url);
    if (typeof m.display_url === "string") acc.images.push(m.display_url);
    if (m.image_versions2 && Array.isArray(m.image_versions2.candidates)) {
      for (var j = 0; j < m.image_versions2.candidates.length; j++) {
        var c = m.image_versions2.candidates[j];
        if (c && c.url) {
          acc.images.push(c.url);
          break;
        }
      }
    }
    if (Array.isArray(m.carousel_media)) {
      for (var k = 0; k < m.carousel_media.length; k++) collect(m.carousel_media[k], acc);
    }
  }

  function broadcast(code) {
    var d = media[code];
    if (!d) return;
    try {
      window.postMessage(
        {
          __ifx: "media",
          code: code,
          videos: d.videos,
          images: d.images,
          carousel: d.carousel
        },
        location.origin
      );
    } catch (e) {}
  }

  function walk(node, depth) {
    if (!node || typeof node !== "object" || depth > 16) return;
    if (Array.isArray(node)) {
      for (var i = 0; i < node.length; i++) walk(node[i], depth + 1);
      return;
    }

    var code = node.code || node.shortcode;
    var isMedia =
      node.video_versions || node.video_url || node.display_url || node.image_versions2 || node.carousel_media;

    if (
      typeof code === "string" &&
      code.length >= 6 &&
      code.length <= 32 &&
      /^[A-Za-z0-9_-]+$/.test(code) &&
      isMedia
    ) {
      var acc = { videos: [], images: [] };
      collect(node, acc);
      var prev = media[code] || { videos: [], images: [], carousel: false };
      media[code] = {
        videos: uniq(prev.videos.concat(acc.videos)),
        images: uniq(prev.images.concat(acc.images)),
        carousel: !!prev.carousel || Array.isArray(node.carousel_media)
      };
      broadcast(code);
    }

    for (var k in node) walk(node[k], depth + 1);
  }

  function scanText(text) {
    if (!text || typeof text !== "string" || text.length > 8e6 || !KEY.test(text)) return;
    try {
      walk(JSON.parse(text), 0);
    } catch (e) {}
  }

  var _fetch = window.fetch;
  if (typeof _fetch === "function") {
    window.fetch = function () {
      var p = _fetch.apply(this, arguments);
      try {
        p.then(function (res) {
          try {
            res.clone()
              .text()
              .then(scanText)
              .catch(function () {});
          } catch (e) {}
        }).catch(function () {});
      } catch (e) {}
      return p;
    };
  }

  var XO = window.XMLHttpRequest;
  if (XO && XO.prototype && !XO.prototype.__ifxPatched) {
    XO.prototype.__ifxPatched = true;
    var _send = XO.prototype.send;
    XO.prototype.send = function () {
      var self = this;
      try {
        self.addEventListener("load", function () {
          try {
            scanText(self.responseText);
          } catch (e) {}
        });
      } catch (e) {}
      return _send.apply(this, arguments);
    };
  }

  function scanScripts() {
    try {
      var list = document.querySelectorAll('script[type="application/json"],script[data-sjs]');
      for (var i = 0; i < list.length; i++) scanText(list[i].textContent);
    } catch (e) {}
  }

  window.addEventListener("message", function (e) {
    if (e.source !== window) return;
    if (!e.data || e.data.__ifx !== "query") return;
    for (var code in media) broadcast(code);
  });

  scanScripts();
  document.addEventListener("DOMContentLoaded", scanScripts);
  var n = 0;
  var t = setInterval(function () {
    scanScripts();
    if (++n > 12) clearInterval(t);
  }, 1200);
})();
