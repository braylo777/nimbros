chrome.runtime.sendMessage({ type: "nb-get-coins" }, (res) => {
  const el = document.getElementById("status");
  if (chrome.runtime.lastError || !res) {
    el.textContent = "Couldn't reach the background worker.";
    return;
  }
  const n = Object.keys(res.byTicker || {}).length;
  el.innerHTML = n > 0 ? `Tracking <span class="n">${n}</span> coins right now.` : "No coins loaded yet — give it a moment.";
});
