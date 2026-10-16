const api = typeof browser !== "undefined" ? browser : chrome;

const status = document.getElementById("status");

document.getElementById("dl").addEventListener("click", async () => {
  try {
    const tabs = await api.tabs.query({ active: true, currentWindow: true });
    const tab = tabs && tabs[0];
    if (!tab || !/^https?:\/\/([^/]*\.)?instagram\.com\//i.test(tab.url || "")) {
      status.style.color = "#ff6b6b";
      status.textContent = "Откройте страницу Instagram.";
      return;
    }
    await api.tabs.sendMessage(tab.id, { type: "downloadVisible" });
    status.style.color = "#7ee08a";
    status.textContent = "Запрошена загрузка…";
    setTimeout(() => (status.textContent = ""), 3000);
  } catch (e) {
    status.style.color = "#ff6b6b";
    status.textContent = "Ошибка: " + (e && e.message ? e.message : e);
  }
});
