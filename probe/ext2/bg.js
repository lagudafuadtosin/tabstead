// Runs on every Firefox start. First start: make tabs, groups, tags, hide one group. Later starts: report what survived.
const LOG = "http://127.0.0.1:8789/";
// The test can answer "close": the add-on then closes every window, the way a person quits Firefox
const report = async (what, data) => {
  try {
    const r = await fetch(LOG, { method: "POST", body: JSON.stringify({ what, data }) });
    if ((await r.text()) === "close") { await new Promise((ok) => setTimeout(ok, 2500)); for (const w of await browser.windows.getAll()) await browser.windows.remove(w.id); }
  } catch {}
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function state() {
  const out = [];
  for (const t of await browser.tabs.query({})) {
    const m = /\/(a|b|c)$/.exec(t.url || "");
    if (m) out.push({ tab: m[1], hidden: t.hidden, groupId: t.groupId, ws: await browser.sessions.getTabValue(t.id, "ws"), discarded: t.discarded });
  }
  out.sort((x, y) => x.tab.localeCompare(y.tab));
  const groups = (await browser.tabGroups.query({})).map((g) => ({ id: g.id, title: g.title, color: g.color }));
  return { tabs: out, groups };
}

(async () => {
  await sleep(5000); // let Firefox finish restoring the session
  const { phase = 0 } = await browser.storage.local.get("phase");
  if (phase === 0) {
    const win = (await browser.windows.getAll())[0];
    const mk = (p) => browser.tabs.create({ url: "http://127.0.0.1:8789/" + p, windowId: win.id, active: false });
    const a = await mk("a"), b = await mk("b"), c = await mk("c");
    const g1 = await browser.tabs.group({ tabIds: [a.id, b.id] });
    await browser.tabGroups.update(g1, { title: "Hidden work", color: "red" });
    const g2 = await browser.tabs.group({ tabIds: [c.id] });
    await browser.tabGroups.update(g2, { title: "Shown", color: "green" });
    for (const [t, ws] of [[a, "W1"], [b, "W1"], [c, "W2"]]) await browser.sessions.setTabValue(t.id, "ws", ws);
    await browser.tabs.hide([a.id, b.id]);
    await browser.storage.local.set({ phase: 1 });
    await sleep(2500);
    report("before", await state());
  } else {
    await browser.storage.local.set({ phase: phase + 1 });
    report("after-start-" + phase, await state());
  }
})();
