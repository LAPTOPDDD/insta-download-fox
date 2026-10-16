const api = typeof browser !== "undefined" ? browser : chrome;

function extOf(url) {
  const m = url.match(/\.([a-zA-Z0-9]{2,5})(?:$|\?|#)/);
  if (m) {
    const e = m[1].toLowerCase();
    if (["mp4", "mov", "webm", "m3u8", "jpg", "jpeg", "png", "webp", "gif", "heic", "avif"].includes(e)) {
      return e === "jpeg" ? "jpg" : e;
    }
  }
  if (/\.mp4|video/i.test(url)) return "mp4";
  return "jpg";
}

async function doDownload(msg) {
  const files = Array.isArray(msg.files) ? msg.files : [];
  const code = String(msg.code || "post").replace(/[^\w.-]/g, "_").slice(0, 40) || "post";
  let ok = 0;
  let err = "";
  for (let i = 0; i < files.length; i++) {
    const url = files[i];
    if (!/^https?:/i.test(url)) continue;
    try {
      const filename = "InstaFox/" + code + "/" + String(i + 1).padStart(2, "0") + "_" + code + "." + extOf(url);
      await api.downloads.download({
        url: url,
        filename: filename,
        conflictAction: "uniquify",
        saveAs: false
      });
      ok++;
    } catch (e) {
      if (!err) err = String((e && e.message) || e);
    }
  }
  return { ok: ok, total: files.length, err: err };
}

api.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg && msg.type === "download") {
    doDownload(msg).then(sendResponse).catch(() => sendResponse({ ok: 0, total: 0 }));
    return true;
  }
  if (msg && msg.type === "ping") {
    sendResponse({ ok: true });
    return false;
  }
});
