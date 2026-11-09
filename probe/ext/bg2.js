// Restart probe. Step "setup": make a group, tag tabs, hide one group. Step "check": read it all back after a restart.
browser.runtime.onMessage.addListener(async (m) => {
  if (m?.probe === "setup") {
    const win = (await browser.windows.getAll())[0];
    const a = await browser.tabs.create({ url: "http://localhost:" + m.port + "/a", windowId: win.id, active: false });
    const b = await browser.tabs.create({ url: "http://localhost:" + m.port + "/b", windowId: win.id, active: false });
    const c = await browser.tabs.create({ url: "http://localhost:" + m.port + "/c", windowId: win.id, active: false });
    const g1 = await browser.tabs.group({ tabIds: [a.id, b.id] });
    await browser.tabGroups.update(g1, { title: "Hidden work", color: "red" });
    const g2 = await browser.tabs.group({ tabIds: [c.id] });
    await browser.tabGroups.update(g2, { title: "Shown", color: "green" });
    for (const [t, ws] of [[a, "W1"], [b, "W1"], [c, "W2"]]) await browser.sessions.setTabValue(t.id, "ws", ws);
    await browser.tabs.hide([a.id, b.id]);
    return "setup done";
  }
  if (m?.probe === "check") {
    const tabs = await browser.tabs.query({});
    const out = [];
    for (const t of tabs) {
      if (!/\/(a|b|c)$/.test(t.url || "")) continue;
      out.push({ url: t.url.slice(-2), hidden: t.hidden, groupId: t.groupId, ws: await browser.sessions.getTabValue(t.id, "ws"), discarded: t.discarded });
    }
    const groups = (await browser.tabGroups.query({})).map((g) => ({ id: g.id, title: g.title, color: g.color }));
    return { tabs: out, groups };
  }
});
