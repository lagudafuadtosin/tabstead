// What really happens to Firefox's own tab groups when an add-on hides their tabs, and whether tab tags survive.
const log = [];
const note = (k, v) => log.push([k, v]);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function run() {
  const win = (await browser.windows.getAll())[0];
  const t = [];
  for (const u of ["about:blank#a", "about:blank#b", "about:blank#c", "about:blank#d"]) t.push(await browser.tabs.create({ url: u, windowId: win.id, active: false }));
  note("apis", { group: typeof browser.tabs.group, tabGroups: typeof browser.tabGroups, hide: typeof browser.tabs.hide, setTabValue: typeof browser.sessions?.setTabValue });

  const gid = await browser.tabs.group({ tabIds: [t[0].id, t[1].id] });
  await browser.tabGroups.update(gid, { title: "Work", color: "blue" });
  note("group made", { gid, info: await browser.tabGroups.get(gid) });

  // Hide both tabs of the group
  try { await browser.tabs.hide([t[0].id, t[1].id]); note("hide group tabs", "ok"); } catch (e) { note("hide group tabs", "ERR " + e.message); }
  await sleep(300);
  const h0 = await browser.tabs.get(t[0].id);
  note("after hide: tab0", { hidden: h0.hidden, groupId: h0.groupId });
  try { note("after hide: group still exists", await browser.tabGroups.get(gid)); } catch (e) { note("after hide: group still exists", "ERR " + e.message); }

  // Show again
  await browser.tabs.show([t[0].id, t[1].id]);
  await sleep(300);
  const s0 = await browser.tabs.get(t[0].id);
  note("after show: tab0", { hidden: s0.hidden, groupId: s0.groupId });
  try { note("after show: group", await browser.tabGroups.get(gid)); } catch (e) { note("after show: group", "ERR " + e.message); }

  // Hide only one tab of a group
  await browser.tabs.hide([t[0].id]);
  await sleep(300);
  try { note("one hidden: group", await browser.tabGroups.get(gid)); } catch (e) { note("one hidden: group", "ERR " + e.message); }
  note("one hidden: tab1", (({ hidden, groupId }) => ({ hidden, groupId }))(await browser.tabs.get(t[1].id)));
  await browser.tabs.show([t[0].id]);

  // Collapse a group
  await browser.tabGroups.update(gid, { collapsed: true });
  note("collapsed", (await browser.tabGroups.get(gid)).collapsed);
  await browser.tabGroups.update(gid, { collapsed: false });

  // Tags on tabs through Firefox's own session store
  await browser.sessions.setTabValue(t[2].id, "ws", "A");
  note("tab tag read back", await browser.sessions.getTabValue(t[2].id, "ws"));

  // Ungroup, group again, move a group to a new window
  await browser.tabs.ungroup([t[1].id]);
  note("ungroup one: tab1 groupId", (await browser.tabs.get(t[1].id)).groupId);
  const w2 = await browser.windows.create({ url: "about:blank#w2" });
  try { await browser.tabGroups.move(gid, { windowId: w2.id, index: -1 }); note("move group to new window", "ok"); } catch (e) { note("move group to new window", "ERR " + e.message); }
  note("tabGroups.query all", (await browser.tabGroups.query({})).map((g) => ({ id: g.id, title: g.title, windowId: g.windowId })));

  // Discarded (unloaded) tabs in a group, for safe restores
  const d = await browser.tabs.create({ url: "http://localhost:1/#later", active: false, discarded: true, title: "Later" });
  note("discarded create", { discarded: (await browser.tabs.get(d.id)).discarded });
  try { const g2 = await browser.tabs.group({ tabIds: [d.id], createProperties: { windowId: win.id } }); note("group a discarded tab", { ok: true, g2 }); } catch (e) { note("group a discarded tab", "ERR " + e.message); }
  return log;
}

browser.runtime.onMessage.addListener((m) => (m?.probe === "run" ? run().catch((e) => [["CRASH", e.message]]) : undefined));
