window.addEventListener("message", async (e) => { if (!e.data?.p) return; const r = await browser.runtime.sendMessage(e.data.p); window.postMessage({ r }, "*"); });
