// Install page + shared helper: register the service worker and offer "Install" where the browser allows it.
(() => {
  if ("serviceWorker" in navigator) navigator.serviceWorker.register("/sw.js").catch(() => {});

  const root = document.getElementById("install");
  if (!root) return;

  const ua = navigator.userAgent;
  const isAndroid = /Android/.test(ua);
  // iPads report themselves as Macs, so a touch-screen "Mac" is an iPad.
  const isIOS = !isAndroid && (/iPhone|iPad|iPod/.test(ua) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1));
  const standalone = window.matchMedia("(display-mode: standalone)").matches || navigator.standalone === true;
  const show = (id) => {
    document.querySelectorAll("[data-platform]").forEach((el) => { el.hidden = el.dataset.platform !== id; });
  };

  if (standalone) show("installed");
  else if (isIOS) show("ios");
  else if (isAndroid) show("android");
  else show("desktop");

  // Android / desktop Chrome & Edge: one-tap install when the browser offers it.
  let prompt = null;
  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault();
    prompt = e;
    document.querySelectorAll(".install-btn").forEach((b) => { b.hidden = false; });
  });
  document.querySelectorAll(".install-btn").forEach((b) =>
    b.addEventListener("click", async () => {
      if (!prompt) return;
      prompt.prompt();
      const { outcome } = await prompt.userChoice;
      prompt = null;
      if (outcome === "accepted") show("installed");
    })
  );
  window.addEventListener("appinstalled", () => show("installed"));

  // Let people switch instructions if we guessed wrong.
  document.querySelectorAll("[data-show]").forEach((a) =>
    a.addEventListener("click", (e) => { e.preventDefault(); show(a.dataset.show); })
  );
})();
