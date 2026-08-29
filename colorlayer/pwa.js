(() => {
  const channel = location.pathname.toLowerCase().includes("colorlayer-dev") ? "DEV" : "LIVE";
  const channelBadge = document.getElementById("channelBadge");
  const networkBadge = document.getElementById("networkBadge");
  const toast = document.getElementById("updateToast");
  const reloadBtn = document.getElementById("reloadAppBtn");
  if (channelBadge) { channelBadge.textContent = channel; channelBadge.classList.toggle("dev", channel === "DEV"); }
  const updateNetwork = () => { if (!networkBadge) return; const online = navigator.onLine; networkBadge.textContent = online ? "Online" : "Offline"; networkBadge.classList.toggle("offline", !online); };
  addEventListener("online", updateNetwork); addEventListener("offline", updateNetwork); updateNetwork();
  if (!("serviceWorker" in navigator)) return;
  addEventListener("load", async () => {
    try {
      const reg = await navigator.serviceWorker.register("./sw.js", {scope:"./"});
      const showUpdate = () => { if (toast) toast.hidden = false; };
      if (reg.waiting) showUpdate();
      reg.addEventListener("updatefound", () => {
        const worker = reg.installing;
        if (!worker) return;
        worker.addEventListener("statechange", () => { if (worker.state === "installed" && navigator.serviceWorker.controller) showUpdate(); });
      });
      reloadBtn?.addEventListener("click", () => location.reload());
      setInterval(() => reg.update().catch(()=>{}), 5 * 60 * 1000);
    } catch (err) { console.warn("PWA registration failed", err); }
  });
})();
