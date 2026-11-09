// Tabstead's rules on their own, plus a random stress test: thousands of switches, new tabs, closes, pins and moves
// between windows, checking after every step that no tab was lost or closed by Tabstead and every window is consistent.
import { reconcile, switchPlan, applyPlan, isConsistent, uniqueName } from "../src/model.js";
import { creatableUrl, normalizeBackup, planRestore } from "../src/model.js";

let failed = 0, n = 0;
const check = (name, got, want) => {
  n++;
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) { failed++; console.log(`✘ ${name}\n   got  ${JSON.stringify(got)}\n   want ${JSON.stringify(want)}`); }
  else console.log(`✔ ${name}`);
};
const tab = (id, ws, extra = {}) => ({ id, windowId: 1, active: false, pinned: false, hidden: false, ws, ...extra });

// Switching hides the other workspace and shows this one, after moving the active tab into it
{
  const tabs = [tab(1, "A", { active: true }), tab(2, "A"), tab(3, "B", { hidden: true }), tab(4, "B", { hidden: true })];
  const plan = switchPlan(tabs, 1, "B");
  check("switch: show B", plan.show, [3, 4]);
  check("switch: hide A", plan.hide, [1, 2]);
  check("switch: activate a B tab first", plan.activate, 3);
  const after = applyPlan(tabs, plan, 1, "B");
  check("switch: consistent after", isConsistent(after, 1, "B"), true);
  check("switch: no tab lost", after.length, 4);
}
// An empty workspace gets a new tab, since the active tab can't be hidden
{
  const tabs = [tab(1, "A", { active: true })];
  const plan = switchPlan(tabs, 1, "C");
  check("empty workspace: needs a new tab", plan.needNewTab, true);
  const after = applyPlan(tabs, plan, 1, "C", 99);
  check("empty workspace: consistent", isConsistent(after, 1, "C"), true);
  check("empty workspace: the old tab is hidden, not closed", after.find((t) => t.id === 1).hidden, true);
}
// Pinned tabs stay in every workspace (Firefox can't hide them)
{
  const tabs = [tab(1, null, { pinned: true }), tab(2, "A", { active: true }), tab(3, "B", { hidden: true })];
  const after = applyPlan(tabs, switchPlan(tabs, 1, "B"), 1, "B");
  check("pinned: still shown in B", after.find((t) => t.id === 1).hidden, false);
  check("pinned: consistent", isConsistent(after, 1, "B"), true);
}
// Untagged tabs (from before Tabstead, or opened while it was off) join the active workspace
{
  const tabs = [tab(1, null, { active: true }), tab(2, null)];
  const plan = reconcile(tabs, 1, "Main");
  check("untagged: tagged into the active workspace", plan.tag, [1, 2]);
  check("untagged: nothing hidden", plan.hide, []);
}
// A crash half-way through a switch: some B tabs shown, some A tabs not yet hidden. Repair finishes it.
{
  const tabs = [tab(1, "A"), tab(2, "A", { hidden: false }), tab(3, "B", { active: true }), tab(4, "B", { hidden: true })];
  const after = applyPlan(tabs, reconcile(tabs, 1, "B"), 1, "B");
  check("repair after a half switch: consistent", isConsistent(after, 1, "B"), true);
}
// Another window is never touched
{
  const tabs = [tab(1, "A", { active: true }), tab(2, "B", { hidden: true }), { ...tab(3, "A", { active: true }), windowId: 2 }];
  const plan = switchPlan(tabs, 1, "B");
  check("other window untouched", [...plan.show, ...plan.hide, ...plan.tag].includes(3), false);
}
check("names: unique", uniqueName("Work", ["Work", "Work 2"]), "Work 3");
check("names: never empty", uniqueName("  ", []), "Workspace");

// Stress: random actions, checked after every one
{
  let seed = 12345;
  const rnd = (k) => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed % k; };
  const spaces = ["A", "B", "C", "D"];
  let nextId = 1;
  const active = { 1: "A", 2: "A" };
  let tabs = [];
  for (const w of [1, 2]) tabs.push({ id: nextId++, windowId: w, active: true, pinned: false, hidden: false, ws: "A" });
  let everCreated = new Set(tabs.map((t) => t.id)), userClosed = new Set();
  let steps = 0, bad = null;
  for (let i = 0; i < 20000 && !bad; i++) {
    const w = 1 + rnd(2);
    const a = rnd(10);
    if (a < 3) { // switch
      active[w] = spaces[rnd(spaces.length)];
      tabs = applyPlan(tabs, switchPlan(tabs, w, active[w]), w, active[w], nextId);
      if (!everCreated.has(nextId) && tabs.some((t) => t.id === nextId)) { everCreated.add(nextId); nextId++; }
    } else if (a < 6) { // a new tab, tagged by Tabstead into the window's workspace and made active
      tabs.forEach((t) => { if (t.windowId === w) t.active = false; });
      tabs.push({ id: nextId, windowId: w, active: true, pinned: false, hidden: false, ws: active[w] });
      everCreated.add(nextId++);
    } else if (a < 7) { // the user closes a visible tab (never the last one in a window)
      const vis = tabs.filter((t) => t.windowId === w && !t.hidden);
      if (vis.length > 1) {
        const c = vis[rnd(vis.length)];
        tabs = tabs.filter((t) => t.id !== c.id); userClosed.add(c.id);
        if (c.active) { const nv = tabs.find((t) => t.windowId === w && !t.hidden); if (nv) nv.active = true; }
      }
    } else if (a < 8) { // pin or unpin a visible tab
      const vis = tabs.filter((t) => t.windowId === w && !t.hidden);
      const p = vis[rnd(vis.length)];
      if (p) { p.pinned = !p.pinned; if (!p.pinned && !p.ws) p.ws = active[w]; }
    } else if (a < 9) { // a visible tab is dragged to the other window: it joins that window's workspace
      const vis = tabs.filter((t) => t.windowId === w && !t.hidden && !t.active);
      const m = vis[rnd(vis.length)];
      if (m) { const o = w === 1 ? 2 : 1; m.windowId = o; m.ws = m.pinned ? m.ws : active[o]; m.active = false; }
    } else { // a crash: repair every window from the tags
      for (const win of [1, 2]) tabs = applyPlan(tabs, reconcile(tabs, win, active[win]), win, active[win], nextId);
      if (!everCreated.has(nextId) && tabs.some((t) => t.id === nextId)) { everCreated.add(nextId); nextId++; }
    }
    for (const win of [1, 2]) tabs = applyPlan(tabs, reconcile(tabs, win, active[win]), win, active[win], nextId);
    if (!everCreated.has(nextId) && tabs.some((t) => t.id === nextId)) { everCreated.add(nextId); nextId++; }
    steps++;
    // Every tab ever made is still there unless the user closed it, and each window is consistent
    const present = new Set(tabs.map((t) => t.id));
    for (const id of everCreated) if (!present.has(id) && !userClosed.has(id)) bad = `tab ${id} lost at step ${steps}`;
    if (new Set(tabs.map((t) => t.id)).size !== tabs.length) bad = `duplicate tab at step ${steps}`;
    for (const win of [1, 2]) if (!isConsistent(tabs, win, active[win])) bad = `window ${win} inconsistent at step ${steps}`;
  }
  check(`stress: 20,000 random steps, no tab lost or duplicated, windows consistent (${bad ?? "ok"})`, bad, null);
}

// ---------- Restore, backups and Simple Tab Groups import ----------
check("url: web pages open", creatableUrl("https://a.com/x"), "https://a.com/x");
check("url: blank and new tab pages are skipped", [creatableUrl("about:blank"), creatableUrl("about:newtab"), creatableUrl("about:home")], [null, null, null]);
check("url: reader view opens the page itself", creatableUrl("about:reader?url=https%3A%2F%2Fb.com%2Fy"), "https://b.com/y");
check("url: placeholder pages open the page they stand for", creatableUrl("moz-extension://abc/help/open.html?url=https%3A%2F%2Fc.com"), "https://c.com");
check("url: pages Firefox won't let an add-on open are skipped", [creatableUrl("file:///C:/x.txt"), creatableUrl("about:config"), creatableUrl("javascript:alert(1)"), creatableUrl("data:text/html,x"), creatableUrl("not a url"), creatableUrl(null)], [null, null, null, null, null, null]);
check("url: a placeholder can't loop", creatableUrl("about:reader?url=about%3Areader%3Furl%3Dabout%253Ablank"), null);

const stg = { version: "5.3.1", groups: [
  { id: 1, title: "Work", iconColor: "#f00", isArchive: false, tabs: [{ url: "https://w1.com", title: "W1" }, { url: "about:newtab", title: "New Tab" }, { url: "file:///x", title: "F" }] },
  { id: 2, title: "", isArchive: true, tabs: [{ url: "https://old.com", title: "Old", cookieStoreId: "firefox-container-1" }] },
  { id: 3, title: "Bad", tabs: "nope" }, null ],
  pinnedTabs: [{ url: "https://mail.com", title: "Mail" }] };
const n1 = normalizeBackup(stg);
check("STG: every group becomes a workspace", n1.workspaces.map((w) => w.name), ["Work", "Group 2 (archived)", "Bad"]);
check("STG: tabs come across", n1.workspaces[0].tabs.map((t) => t.url), ["https://w1.com", "about:newtab", "file:///x"]);
check("STG: pinned tabs come across", n1.pinned, [{ url: "https://mail.com", title: "Mail" }]);
check("not a backup: a clear error", (() => { try { normalizeBackup({ hello: 1 }); } catch (e) { return e.message; } })(), "This file is not a Tabstead or Simple Tab Groups backup.");
check("not a backup: null", (() => { try { normalizeBackup(null); } catch (e) { return e.message; } })(), "This file is not a backup.");

const p1 = planRestore(n1, { workspaces: [{ id: "m", name: "Main" }, { id: "wk", name: "work" }], tabs: [] });
check("restore: a workspace with the same name (any case) is reused", p1.add.filter((a) => a.wsKey === "wk").map((a) => a.url), ["https://w1.com"]);
check("restore: new workspaces only when they get tabs", p1.newWorkspaces.map((w) => w.name), ["Group 2 (archived)"]);
check("restore: unsupported pages counted, blank pages ignored", p1.unsupported, 1);
check("restore: pinned tabs added", p1.pinned.map((t) => t.url), ["https://mail.com"]);

const own = { workspaces: [{ id: "wk", name: "Renamed", tabs: [{ url: "https://w1.com", title: "" }, { url: "https://w1.com", title: "" }, { url: "https://w2.com", title: "", group: { key: "g1", title: "Docs", color: "red" } }] }], pinned: [{ url: "https://mail.com", title: "" }] };
const p2 = planRestore(normalizeBackup({ app: "tabstead", version: 1, ...own }), { workspaces: [{ id: "wk", name: "Work" }], tabs: [{ url: "https://w1.com", ws: "wk" }, { url: "https://w2.com", ws: "other" }, { url: "https://mail.com", pinned: true }] });
check("restore: matched by id even after a rename", p2.newWorkspaces, []);
check("restore: never doubles a tab (2 saved, 1 open: adds 1)", p2.add.map((a) => a.url), ["https://w1.com", "https://w2.com"]);
check("restore: the same page in another workspace still comes back", p2.add[1].wsKey, "wk");
check("restore: an open pinned tab isn't doubled", p2.pinned, []);
check("restore: skipped count", p2.skipped, 2);
check("restore: groups kept", p2.add[1].group, { key: "g1", title: "Docs", color: "red", collapsed: false });
const twice = planRestore(normalizeBackup({ app: "tabstead", ...own }), { workspaces: [{ id: "wk", name: "Work" }], tabs: [{ url: "https://w1.com", ws: "wk" }, { url: "https://w1.com", ws: "wk" }, { url: "https://w2.com", ws: "wk" }, { url: "https://mail.com", pinned: true }] });
check("restore twice: the second time adds nothing", twice.add.length + twice.pinned.length, 0);
const dupNames = planRestore({ workspaces: [{ name: "X", tabs: [{ url: "https://1.com" }] }, { name: "x", tabs: [{ url: "https://2.com" }] }], pinned: [] }, { workspaces: [], tabs: [] });
check("restore: two saved workspaces with one name make one workspace", dupNames.newWorkspaces.length, 1);
check("restore: empty id doesn't match anything", planRestore({ workspaces: [{ id: "", name: "Y", tabs: [{ url: "https://1.com" }] }], pinned: [] }, { workspaces: [{ id: "", name: "Z" }], tabs: [] }).newWorkspaces.length, 1);

const slow = planRestore({ workspaces: [{ id: "b", name: "B", tabs: [{ url: "https://x.com" }, { url: "https://y.com" }] }], pinned: [] }, { workspaces: [{ id: "a", name: "A" }, { id: "b", name: "B" }], tabs: [{ url: "https://x.com", ws: null }] });
check("restore: a tab whose workspace hasn't arrived yet is not doubled", slow.add.map((x) => x.url), ["https://y.com"]);
const start = planRestore({ workspaces: [{ id: "a", name: "A", tabs: [{ url: "https://home.com" }] }], pinned: [] }, { workspaces: [{ id: "a", name: "A" }], tabs: [{ url: "https://home.com", ws: null }] });
check("restore: a start page just opened is not doubled", start.add.length, 0);
const pinnedOnly = planRestore({ workspaces: [{ id: "a", name: "A", tabs: [{ url: "https://mail.com" }] }], pinned: [{ url: "https://mail.com" }] }, { workspaces: [{ id: "a", name: "A" }], tabs: [{ url: "https://mail.com", ws: "a", pinned: true }] });
check("restore: an open pinned tab doesn't stand in for the same page in a workspace", [pinnedOnly.add.length, pinnedOnly.pinned.length], [1, 0]);

console.log(failed ? `\n${failed} of ${n} failed` : `\nall ${n} passed`);
process.exit(failed ? 1 : 0);
