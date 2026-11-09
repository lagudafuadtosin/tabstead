// Builds dist/firefox from src, and dist/firefox-test: the same add-on plus a bridge a local test page can drive.
import { cpSync, mkdirSync, rmSync, readFileSync, writeFileSync } from "node:fs";
for (const out of ["dist/firefox", "dist/firefox-test"]) { rmSync(out, { recursive: true, force: true }); mkdirSync(out, { recursive: true }); cpSync("src", out, { recursive: true }); }
const m = JSON.parse(readFileSync("src/manifest.json", "utf8"));
m.content_scripts = [{ matches: ["http://127.0.0.1/*", "http://localhost/*"], js: ["test-bridge.js"], run_at: "document_start" }];
writeFileSync("dist/firefox-test/manifest.json", JSON.stringify(m, null, 2));
writeFileSync("dist/firefox-test/test-bridge.js", `window.addEventListener("message", async (e) => {
  if (!e.data?.tabsteadTest) return;
  const r = await browser.runtime.sendMessage({ action: "__test", ...e.data.tabsteadTest });
  window.postMessage({ tabsteadResult: r, id: e.data.id }, "*");
});`);
// The test build's background answers "__test" commands: run any action, or read every tab's state
const bg = readFileSync("dist/firefox-test/background.js", "utf8");
writeFileSync("dist/firefox-test/background.js", bg + `
const bootedAt = Date.now() + Math.random();
// Answers only test commands: an async listener would answer every other message with nothing, and the sidebar would get no reply
const testCmd = async (m, sender) => {
  const win = sender?.tab?.windowId ?? (await browser.windows.getAll({ windowTypes: ["normal"] }))[0].id;
  if (m.do === "boot") return bootedAt;
  if (m.do === "spin") { (async () => { for (let i = 1; i <= m.n; i++) { await new Promise((r) => setTimeout(r, 500)); if (m.api) await browser.tabs.query({}); if (!m.pure || i === m.n) await browser.storage.session.set({ spin: i }); } })(); return bootedAt; }
  if (m.do === "spinState") return { boot: bootedAt, spin: (await browser.storage.session.get("spin")).spin };
  if (m.do === "state") {
    const tabs = await browser.tabs.query({});
    return Promise.all(tabs.map(async (t) => ({ id: t.id, windowId: t.windowId, url: t.url, active: t.active, hidden: t.hidden, pinned: t.pinned, groupId: t.groupId, ws: await browser.sessions.getTabValue(t.id, "ws"), grp: await browser.sessions.getTabValue(t.id, "grp") })));
  }
  if (m.do === "open") {
    const t = await browser.tabs.create({ url: m.url, windowId: win, active: !!m.active });
    for (let i = 0; i < 50; i++) { const x = await browser.tabs.get(t.id); if (x.url === m.url) break; await new Promise((r) => setTimeout(r, 100)); }
    return t.id;
  }
  if (m.do === "group") { const g = await browser.tabs.group({ tabIds: m.tabIds, createProperties: { windowId: (await browser.tabs.get(m.tabIds[0])).windowId } }); if (m.title) await browser.tabGroups.update(g, { title: m.title }); return g; }
  if (m.do === "pinMe") { await browser.tabs.update(sender.tab.id, { pinned: true }); return true; }
  if (m.do === "storageGet") return browser.storage.local.get(m.key);
  if (m.do === "storageSet") { await browser.storage.local.set(m.value); return true; }
  if (m.do === "close") { await browser.tabs.remove(m.ids); return true; }
  if (m.do === "undoClose") { const c = await browser.sessions.getRecentlyClosed({ maxResults: 5 }); const x = c.find((e) => m.window ? e.window : e.tab); await browser.sessions.restore((x.tab ?? x.window).sessionId); return true; }
  if (m.do === "dup") return (await browser.tabs.duplicate(m.tabId)).id;
  if (m.do === "newWindow") { const w = await browser.windows.create({ url: m.urls }); return w.id; }
  if (m.do === "closeWindow") { await browser.windows.remove(m.id); return true; }
  if (m.do === "toWindow") { await browser.tabs.move(m.tabId, { windowId: m.windowId, index: -1 }); return true; }
  if (m.do === "windows") return (await browser.windows.getAll({ windowTypes: ["normal"] })).map((w) => w.id);
  if (m.do === "winWs") return browser.sessions.getWindowValue(m.windowId, "activeWs");
  if (m.do === "groups") return (await browser.tabGroups.query({})).map((g) => ({ id: g.id, title: g.title, color: g.color, windowId: g.windowId }));
  if (m.do === "menuClick") { const tab = await browser.tabs.get(m.tabId); await __tabstead.queue(() => __tabstead.menuClick({ menuItemId: m.item }, tab)); return true; }
  if (m.do === "storage") return browser.storage.local.get(m.key);
  if (m.do === "settle") { await __tabstead.queue(() => __tabstead.settleAll()); return true; }
  if (m.do === "running") return String(__tabstead.running());
  if (m.do === "timing") {
    const out = {}; let t0 = performance.now();
    const tabs = await browser.tabs.query({}); out.query = performance.now() - t0; t0 = performance.now();
    await Promise.all(tabs.map((t) => browser.sessions.getTabValue(t.id, "ws"))); out.getTabValueAll = performance.now() - t0; t0 = performance.now();
    await __tabstead.readTabs(); out.readTabs = performance.now() - t0; t0 = performance.now();
    await __tabstead.snapshot(); out.snapshot = performance.now() - t0;
    const hidden = tabs.filter((t) => t.hidden).slice(0, 100).map((t) => t.id);
    t0 = performance.now(); await browser.tabs.show(hidden); out.show100 = performance.now() - t0;
    t0 = performance.now(); await browser.tabs.hide(hidden); out.hide100 = performance.now() - t0;
    out.n = tabs.length; out.running = String(__tabstead.running());
    return out;
  }
  if (m.do === "startInfo") return { trail: (await browser.storage.session.get("trail")).trail, ...__tabstead.startInfo(), live: (await browser.storage.local.get("live")).live?.workspaces.map((w) => w.tabs.length) };
  if (m.do === "idle") { while (!__tabstead.started()) await new Promise((r) => setTimeout(r, 100)); return __tabstead.queue(async () => true); }
  if (m.do === "inWindow") return __tabstead.queue(() => __tabstead.actions[m.act]({ ...m, windowId: m.windowId }));
  if (m.do === "activate") { await browser.tabs.update(m.tabId, { active: true }); return true; }
  // Like Tabstead's own pages: questions that only read skip the queue
  if (["overview", "search", "backups", "exportBackup"].includes(m.do)) return __tabstead.actions[m.do]({ windowId: win, ...m });
  return __tabstead.queue(() => __tabstead.actions[m.do]({ windowId: win, ...m }));
};
browser.runtime.onMessage.addListener((m, sender) => m?.action === "__test" ? testCmd(m, sender) : undefined);`);
console.log("built dist/firefox and dist/firefox-test");
