const log = [];
browser.tabs.onCreated.addListener(async (t) => {
  const v0 = await browser.sessions.getTabValue(t.id, "ws");
  setTimeout(async () => { const v1 = await browser.sessions.getTabValue(t.id, "ws").catch(() => "gone"); log.push({ id: t.id, url: t.url, v0, v1, hidden: t.hidden, discarded: t.discarded }); }, 600);
});
browser.tabs.onActivated.addListener((i) => log.push({ activated: i.tabId }));
browser.runtime.onMessage.addListener(async (m) => {
  const win = (await browser.windows.getAll({ windowTypes: ["normal"] }))[0].id;
  if (m.do === "open") { const t = await browser.tabs.create({ url: m.url, windowId: m.windowId ?? win, active: false }); return t.id; }
  if (m.do === "tag") { await browser.sessions.setTabValue(m.id, "ws", m.v); return true; }
  if (m.do === "close") { await browser.tabs.remove(m.ids); return true; }
  if (m.do === "undo") { const c = await browser.sessions.getRecentlyClosed({ maxResults: 5 }); const x = c[0]; const r = await browser.sessions.restore((x.tab ?? x.window).sessionId); return { kind: x.tab ? "tab" : "window", r: !!r }; }
  if (m.do === "wtag") { await browser.sessions.setWindowValue(m.id, "activeWs", m.v); return true; }
  if (m.do === "lastclose") {
    const w = await browser.windows.create({ url: [m.u + "/x1", m.u + "/x2", m.u + "/x3"] });
    await new Promise((r) => setTimeout(r, 1500));
    const ts = await browser.tabs.query({ windowId: w.id });
    await browser.tabs.update(ts[0].id, { active: true });
    const g = await browser.tabs.group({ tabIds: [ts[1].id, ts[2].id], createProperties: { windowId: w.id } }).catch((e) => "group err " + e.message);
    const hid = await browser.tabs.hide([ts[1].id, ts[2].id]);
    const gh = await browser.tabs.group({ tabIds: [ts[2].id] }).catch((e) => "regroup hidden err " + e.message);
    await browser.tabs.remove(ts[0].id);
    await new Promise((r) => setTimeout(r, 1500));
    const left = await browser.tabs.query({ windowId: w.id }).catch((e) => "window gone: " + e.message);
    return { g, hid, gh, left: Array.isArray(left) ? left.map((t) => ({ url: t.url, hidden: t.hidden, active: t.active })) : left, wins: (await browser.windows.getAll()).length };
  }
  if (m.do === "hide") return browser.tabs.hide(m.ids);
  if (m.do === "dup") { const t = await browser.tabs.duplicate(m.id); return t.id; }
  if (m.do === "newwin") { const w = await browser.windows.create({ url: m.urls }); const ts = await browser.tabs.query({ windowId: w.id }); return { id: w.id, tabs: ts.map((t) => t.id) }; }
  if (m.do === "closewin") { await browser.windows.remove(m.id); return true; }
  if (m.do === "activate") { await browser.tabs.update(m.id, { active: true }); const t = await browser.tabs.get(m.id); return { hidden: t.hidden, active: t.active }; }
  if (m.do === "log") { await new Promise((r) => setTimeout(r, 900)); return log.splice(0); }
  if (m.do === "prefs") return { undo: (await browser.sessions.getRecentlyClosed()).length };
});
browser.windows.onCreated.addListener(async (w) => {
  const v0 = await browser.sessions.getWindowValue(w.id, "activeWs");
  setTimeout(async () => log.push({ win: w.id, v0, v1: await browser.sessions.getWindowValue(w.id, "activeWs").catch(() => "gone") }), 600);
});
