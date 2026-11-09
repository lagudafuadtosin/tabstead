window.addEventListener("message", async (e) => {
  if (!e.data?.probe) return;
  const result = await browser.runtime.sendMessage(e.data);
  window.postMessage({ probeResult: result }, "*");
});
