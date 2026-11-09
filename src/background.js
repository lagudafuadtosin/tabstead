// Tabstead's background: keeps every window showing its active workspace, tags new tabs, repairs at start-up, keeps a
// live copy of every workspace (so nothing is lost when Firefox doesn't restore the last session or a window closes),
// makes backups and answers the sidebar. The rules live in model.js; this file only reads and changes real tabs.
import { reconcile, uniqueName, normalizeBackup, planRestore } from "./model.js";

const api = globalThis.browser;
const WS = "ws";           // a tab's workspace, kept by Firefox's own session store (survives restarts and crashes)
const ACTIVE = "activeWs"; // a window's active workspace, kept the same way
const GRP = "grp";         // a put-away tab's Firefox tab group (name, colour, folded), made again when it comes back
const COLORS = ["blue", "red", "green", "yellow", "purple", "orange", "cyan", "pink", "grey"];
const KEEP_BACKUPS = 20;
const BATCH = 20;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const quiet = (p) => Promise.resolve(p).catch(() => undefined); // a tab closed half-way through is not an error

// While Firefox is still restoring tabs at start-up, their tags arrive with them: new-tab handling waits for the repair
let starting = true;
let started = false;
let busy = Promise.resolve();
let running = null; // what the queue is doing now (shown by the test build when something hangs)
const queue = (fn) => {
  const go = async () => { running = String(fn).slice(0, 120); try { return await fn(); } finally { running = null; } };
  const run = busy.then(go, go);
  busy = run.catch((e) => console.error("Tabstead:", e));
  return run;
};
// A short trail of what start-up did, kept for this Firefox session (read by the tests when something goes wrong)
const trail = (line) => quiet((async () => {
  const { trail: t = [] } = await api.storage.session.get("trail");
  t.push(`${new Date().toISOString().slice(11, 23)} ${line}`);
  await api.storage.session.set({ trail: t.slice(-60) });
})());
trail("loaded");
const ours = new Set(); // tabs Tabstead itself made (restores, a fresh tab for an empty workspace)

// ---------- Workspaces and windows ----------

// The first workspace is made once: on a fresh install the sidebar (which Firefox opens) and the start-up repair both
// ask at the same moment, and two different "Main"s would leave the open tabs tagged to one that isn't kept
let makingFirst = null;
async function workspaces() {
  const { workspaces: list } = await api.storage.local.get("workspaces");
  if (list?.length) return list;
  makingFirst ??= (async () => {
    const first = [{ id: "w" + Date.now().toString(36), name: "Main", color: "blue" }];
    await api.storage.local.set({ workspaces: first });
    return first;
  })().finally(() => { makingFirst = null; });
  return makingFirst;
}

const normalWindows = async () => (await api.windows.getAll({ windowTypes: ["normal"] })).filter((w) => !w.incognito);

async function activeWs(windowId) {
  const list = await workspaces();
  const id = await quiet(api.sessions.getWindowValue(windowId, ACTIVE));
  if (id && list.some((w) => w.id === id)) return id;
  // A new window starts in the workspace you were last in
  const { lastWs } = await api.storage.session.get("lastWs");
  const pick = list.some((w) => w.id === lastWs) ? lastWs : list[0].id;
  await quiet(api.sessions.setWindowValue(windowId, ACTIVE, pick));
  return pick;
}

async function readTabs(windowId) {
  const tabs = await api.tabs.query(windowId == null ? {} : { windowId });
  return Promise.all(tabs.map(async (t) => ({
    id: t.id, windowId: t.windowId, active: t.active, pinned: t.pinned, hidden: !!t.hidden, incognito: t.incognito,
    url: t.url, title: t.title, groupId: t.groupId ?? -1,
    ws: (await quiet(api.sessions.getTabValue(t.id, WS))) ?? null,
    grp: (await quiet(api.sessions.getTabValue(t.id, GRP))) ?? null,
  })));
}

// Every workspace tag Tabstead writes goes through here, so a later change it didn't make can be told apart
const written = new Map();
const setWs = (tabId, ws) => { written.set(tabId, ws); return quiet(api.sessions.setTabValue(tabId, WS, ws)); };

// Firefox refuses a whole call if one tab in it has gone; then each tab is tried on its own
async function each(fn, ids) {
  if (!ids.length) return;
  ownHiding++;
  try {
    try { await fn(ids); } catch { for (const id of ids) await quiet(fn([id])); }
  } finally {
    // Firefox reports the change a moment later; it still counts as Tabstead's
    setTimeout(() => { ownHiding--; }, 100);
  }
}

/** Makes a window show exactly its active workspace. Hides and shows only: never closes a tab. */
async function settle(windowId) {
  const win = await quiet(api.windows.get(windowId));
  if (!win || win.incognito || win.type !== "normal") return;
  const ws = await activeWs(windowId);
  // A tag for a workspace that no longer exists counts as no tag: the tab joins the workspace shown, never stays hidden
  const valid = new Set((await workspaces()).map((w) => w.id));
  const tabs = await readTabs(windowId);
  const plan = reconcile(tabs.map((t) => (t.ws && !valid.has(t.ws) ? { ...t, ws: null } : t)), windowId, ws);
  for (const id of plan.tag) await setWs(id, ws);
  await each((ids) => api.tabs.show(ids), plan.show);
  const shown = new Set(plan.show);
  await bringBackGroups(windowId, tabs.filter((t) => t.grp && !t.pinned && (shown.has(t.id) || !t.hidden)));
  if (plan.needNewTab) {
    const t = await api.tabs.create({ windowId, active: true });
    ours.add(t.id);
    await setWs(t.id, ws);
  } else if (plan.activate != null) {
    await quiet(api.tabs.update(plan.activate, { active: true }));
  }
  // Tabs being put away leave their groups first (and any hidden tab still in a group, after a crash half-way)
  const away = new Set(plan.hide);
  for (const t of tabs) if (t.hidden && !shown.has(t.id) && t.groupId !== -1 && !t.pinned) away.add(t.id);
  await putAwayGroups(windowId, tabs.filter((t) => away.has(t.id) && t.groupId !== -1 && !t.pinned));
  await each((ids) => api.tabs.hide(ids), plan.hide);
  saveSoon();
}

// Firefox shows a tab group's name in the tab bar even when every tab in it is hidden, so a workspace being put away
// would leave its group names behind. Each tab remembers its group instead, and the group is made again, with the same
// name, colour and folding, when the workspace comes back.
async function putAwayGroups(windowId, tabs) {
  if (!tabs.length || !api.tabs.ungroup) return;
  const stamp = Date.now().toString(36);
  const info = new Map();
  for (const t of tabs) {
    if (!info.has(t.groupId)) {
      const g = await quiet(api.tabGroups.get(t.groupId));
      info.set(t.groupId, { key: t.groupId + ":" + stamp, gid: t.groupId, title: g?.title ?? "", color: g?.color ?? "grey", collapsed: !!g?.collapsed });
    }
    await quiet(api.sessions.setTabValue(t.id, GRP, info.get(t.groupId)));
  }
  await each((ids) => api.tabs.ungroup(ids), tabs.map((t) => t.id));
}

async function bringBackGroups(windowId, tabs) {
  if (!tabs.length || !api.tabs.group) return;
  const sets = new Map();
  for (const t of tabs) {
    if (t.groupId !== -1) continue; // you put it in a group yourself since: that stays
    if (!sets.has(t.grp.key)) sets.set(t.grp.key, { g: t.grp, ids: [] });
    sets.get(t.grp.key).ids.push(t.id);
  }
  const done = new Set(tabs.filter((t) => t.groupId !== -1).map((t) => t.id));
  for (const { g, ids } of sets.values()) {
    // Part of the group may still be open in this window (a tab of it moved to another workspace): join it
    const live = g.gid != null ? await quiet(api.tabGroups.get(g.gid)) : null;
    let gid;
    if (live && live.windowId === windowId && (live.title ?? "") === g.title) gid = await quiet(api.tabs.group({ groupId: g.gid, tabIds: ids }));
    else {
      gid = await quiet(api.tabs.group({ tabIds: ids, createProperties: { windowId } }));
      if (gid != null) await quiet(api.tabGroups.update(gid, { title: g.title, color: COLORS.includes(g.color) ? g.color : "grey", collapsed: !!g.collapsed }));
    }
    if (gid != null) for (const id of ids) done.add(id);
  }
  for (const id of done) await quiet(api.sessions.removeTabValue(id, GRP));
}

async function switchTo(windowId, wsId) {
  await api.sessions.setWindowValue(windowId, ACTIVE, wsId);
  await api.storage.session.set({ lastWs: wsId });
  await settle(windowId);
}

async function settleAll() {
  for (const w of await normalWindows()) await settle(w.id);
}

// Windows seen being made, and when: a tab arriving in a window made in the last few seconds is part of that window
// being restored, so its workspace is kept as it was
async function markWindow(id, at) {
  const { seen = {} } = await api.storage.session.get("seen");
  seen[id] = at;
  await api.storage.session.set({ seen });
}
async function windowIsNew(id) {
  const { seen = {} } = await api.storage.session.get("seen");
  return seen[id] == null || Date.now() - seen[id] < 4000;
}

// ---------- Tabs coming and going ----------

const createdAt = new Map();

api.tabs.onCreated.addListener((tab) => {
  createdAt.set(tab.id, Date.now());
  queue(async () => {
    if (starting || tab.incognito || ours.has(tab.id)) return;
    const ws = await activeWs(tab.windowId);
    const tag = await quiet(api.sessions.getTabValue(tab.id, WS));
    if (!tag) {
      if (!tab.pinned) await setWs(tab.id, ws);
    } else if (tag !== ws && !(await windowIsNew(tab.windowId))) {
      // A tab you brought back (reopen closed tab, a saved Firefox group) joins the workspace you're in, so you see it
      await setWs(tab.id, ws);
      await settle(tab.windowId);
    }
    saveSoon();
  });
  // Firefox puts back a reopened tab's saved workspace a moment after it appears: a second look puts it right, unless
  // you have moved it since. Tabstead's own tabs (restores) need none.
  setTimeout(() => { if (!ours.has(tab.id) && !starting) queue(() => secondLook(tab.id)); }, 700);
});

// Whenever a tab is hidden or shown by anything but Tabstead (Firefox putting back a reopened tab's old state, another
// add-on), the window is put right once things are quiet
const settleTimers = new Map();
function settleSoon(windowId) {
  clearTimeout(settleTimers.get(windowId));
  settleTimers.set(windowId, setTimeout(() => { settleTimers.delete(windowId); queue(() => starting ? undefined : settle(windowId)); }, 250));
}
let ownHiding = 0; // hides and shows Tabstead itself is doing
api.tabs.onUpdated.addListener((id, info, tab) => {
  if (ownHiding || tab.incognito || ours.has(id)) return;
  settleSoon(tab.windowId);
}, { properties: ["hidden"] });

async function secondLook(tabId) {
  const want = written.get(tabId);
  const tab = await quiet(api.tabs.get(tabId));
  if (!tab || tab.incognito || tab.pinned || want === undefined) return;
  if ((await quiet(api.sessions.getTabValue(tabId, WS))) !== want) {
    await setWs(tabId, want);
    await settle(tab.windowId);
  } else if (tab.hidden && want === (await activeWs(tab.windowId))) {
    await settle(tab.windowId);
  }
}

// A tab dragged to another window joins that window's workspace, so it stays in view where it was dropped
api.tabs.onAttached.addListener((tabId, info) => queue(async () => {
  const tab = await quiet(api.tabs.get(tabId));
  if (!tab || tab.incognito) return;
  if (!tab.pinned) await setWs(tabId, await activeWs(info.newWindowId));
  await settle(info.newWindowId);
}));

// Picking a hidden tab (Firefox's list of all tabs, "Switch to tab" in the address bar) switches to its workspace
api.tabs.onActivated.addListener(({ tabId, windowId }) => setTimeout(() => queue(async () => {
  if (starting || ours.has(tabId)) return;
  if (Date.now() - (createdAt.get(tabId) ?? 0) < 1500) return; // a new tab: handled above
  const tab = await quiet(api.tabs.get(tabId));
  if (!tab || !tab.active || tab.pinned || tab.incognito) return;
  const tag = await quiet(api.sessions.getTabValue(tabId, WS));
  const list = await workspaces();
  if (tag && tag !== (await activeWs(windowId)) && list.some((w) => w.id === tag)) await switchTo(windowId, tag);
}), 80));

api.tabs.onRemoved.addListener((tabId) => { createdAt.delete(tabId); ours.delete(tabId); written.delete(tabId); saveSoon(); });
api.tabs.onUpdated.addListener(() => saveSoon(), { properties: ["url", "title", "pinned"] });
api.tabs.onMoved.addListener(() => saveSoon());
api.tabGroups?.onUpdated?.addListener(() => saveSoon());
api.tabGroups?.onCreated?.addListener(() => saveSoon());
api.tabGroups?.onRemoved?.addListener(() => saveSoon());

api.windows.onCreated.addListener((win) => {
  markWindow(win.id, Date.now());
  queue(async () => {
    if (starting || win.type !== "normal" || win.incognito) return;
    await settle(win.id);
  });
});

api.windows.onFocusChanged.addListener((windowId) => {
  if (windowId === api.windows.WINDOW_ID_NONE) return;
  queue(async () => {
    const w = await quiet(api.windows.get(windowId));
    if (!w || w.incognito || w.type !== "normal") return;
    const id = await quiet(api.sessions.getWindowValue(windowId, ACTIVE));
    if (id) await api.storage.session.set({ lastWs: id });
  });
});

// A window closing takes its hidden tabs with it (Firefox closes a window when its last visible tab closes, too).
// Firefox keeps the closed window whole, so the sidebar offers to bring it back.
api.windows.onRemoved.addListener((windowId) => queue(async () => {
  const { live } = await api.storage.local.get("live");
  const lost = (live?.tabs ?? []).filter((t) => t.windowId === windowId && t.hidden).length;
  if (!lost) return;
  if (!(await normalWindows()).length) return; // Firefox is quitting: the restart brings everything back
  await api.storage.local.set({ notice: { kind: "window", count: lost, at: Date.now() } });
}));

// ---------- The live copy and backups ----------

let saveTimer = null;
function saveSoon() {
  // Never dropped: a tab closed as the event that wakes Tabstead must leave the copy too
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => queue(() => starting ? saveSoon() : saveLive()), 1000);
}

/** Everything Tabstead looks after, as a backup. */
async function snapshot() {
  const list = await workspaces();
  const wins = await normalWindows();
  const ids = new Set(wins.map((w) => w.id));
  const tabs = (await readTabs()).filter((t) => ids.has(t.windowId));
  const groups = new Map();
  if (api.tabGroups) for (const g of (await quiet(api.tabGroups.query({}))) ?? []) groups.set(g.id, g);
  const ws = list.map((w) => ({ id: w.id, name: w.name, color: w.color, tabs: [] }));
  const byId = new Map(ws.map((w) => [w.id, w]));
  const pinned = [];
  const flat = [];
  for (const t of tabs) {
    flat.push({ windowId: t.windowId, hidden: t.hidden, ws: t.ws });
    if (t.pinned) { pinned.push({ url: t.url, title: t.title }); continue; }
    const w = byId.get(t.ws);
    if (!w) continue;
    const g = groups.get(t.groupId);
    const group = g ? { key: String(g.id), title: g.title ?? "", color: g.color, collapsed: !!g.collapsed }
      : t.grp ? { key: "away " + t.grp.key, title: t.grp.title, color: t.grp.color, collapsed: !!t.grp.collapsed } : null;
    w.tabs.push({ url: t.url, title: t.title, group });
  }
  return { app: "tabstead", version: 1, at: Date.now(), workspaces: ws, pinned, tabs: flat };
}

const countTabs = (b) => b.workspaces.reduce((n, w) => n + w.tabs.length, 0);

async function saveLive() {
  const live = await snapshot();
  // Never let an empty moment (a window closing, Firefox quitting) wipe the copy of real tabs
  if (!countTabs(live)) return;
  if (!started) trail("saved " + countTabs(live) + " before start-up finished");
  await api.storage.local.set({ live });
}

const sameTabs = (a, b) => JSON.stringify(a.workspaces.map((w) => [w.name, w.tabs.map((t) => t.url)])) === JSON.stringify(b.workspaces.map((w) => [w.name, w.tabs.map((t) => t.url)]));

/** A restore point in the list kept in the sidebar (the last 20); an automatic one only when something changed. */
async function addBackup(kind) {
  const snap = await snapshot();
  if (!countTabs(snap)) return null;
  delete snap.tabs;
  const { backups = [] } = await api.storage.local.get("backups");
  if (kind === "auto" && backups[0] && sameTabs(backups[0].data, snap)) return null;
  const entry = { at: snap.at, kind, workspaces: snap.workspaces.length, tabs: countTabs(snap), data: snap };
  await api.storage.local.set({ backups: [entry, ...backups].slice(0, KEEP_BACKUPS) });
  return entry;
}

api.alarms.onAlarm.addListener((a) => { if (a.name === "backup") queue(() => addBackup("auto")); });
api.alarms.get("backup").then((a) => { if (!a) api.alarms.create("backup", { periodInMinutes: 30 }); });

/** Brings back what a backup holds, into this window, without doubling anything. Tabs open unloaded, a few at a time. */
async function restore(backup, windowId) {
  const list = await workspaces();
  const all = (await readTabs()).filter((t) => !t.incognito);
  const plan = planRestore(backup, { workspaces: list, tabs: all.map((t) => ({ url: t.url, ws: t.ws, pinned: t.pinned })) });
  const keys = new Map(list.map((w) => [w.id, w.id]));
  const added = [];
  for (const w of plan.newWorkspaces) {
    const taken = [...list, ...added].map((x) => x.name);
    const ws = { id: "w" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6), name: uniqueName(w.name, taken), color: w.color ?? COLORS[(list.length + added.length) % COLORS.length] };
    added.push(ws);
    keys.set(w.key, ws.id);
  }
  if (added.length) await api.storage.local.set({ workspaces: [...list, ...added] });
  const current = await activeWs(windowId);
  const groups = new Map(); // a saved group -> its new tabs
  let made = 0;
  for (let i = 0; i < plan.add.length; i += BATCH) {
    const toHide = [];
    for (const a of plan.add.slice(i, i + BATCH)) {
      const ws = keys.get(a.wsKey);
      const t = await quiet(api.tabs.create({ windowId, url: a.url, title: a.title || undefined, discarded: true, active: false }));
      if (!t) continue;
      ours.add(t.id); made++;
      await setWs(t.id, ws);
      if (ws !== current) toHide.push(t.id);
      if (a.group && ws !== current) {
        // A put-away workspace's tabs remember their group; it is made when the workspace is shown
        await quiet(api.sessions.setTabValue(t.id, GRP, { key: ws + " " + a.group.key, gid: null, title: a.group.title, color: a.group.color, collapsed: !!a.group.collapsed }));
      } else if (a.group) {
        const k = ws + " " + a.group.key;
        if (!groups.has(k)) groups.set(k, { g: a.group, ids: [] });
        groups.get(k).ids.push(t.id);
      }
    }
    await each((ids) => api.tabs.hide(ids), toHide);
    await sleep(150); // a breather between batches, so a big restore never freezes Firefox
  }
  if (api.tabs.group) for (const { g, ids } of groups.values()) {
    const gid = await quiet(api.tabs.group({ tabIds: ids, createProperties: { windowId } }));
    if (gid != null) await quiet(api.tabGroups.update(gid, { title: g.title, color: COLORS.includes(g.color) ? g.color : "grey", collapsed: g.collapsed }));
  }
  for (const p of plan.pinned) {
    const t = await quiet(api.tabs.create({ windowId, url: p.url, pinned: true, active: false }));
    if (t) { ours.add(t.id); made++; }
  }
  await settle(windowId);
  saveSoon();
  return { added: made, workspaces: added.length, skipped: plan.skipped, unsupported: plan.unsupported };
}

// ---------- Start-up: repair every window, and bring back workspaces Firefox didn't restore ----------

let browserStart = false;
let startInfo = null;
// Remembered for the whole Firefox session: if Firefox puts this background to sleep before the start-up repair
// finishes, the next wake runs it again (a restore never opens a tab twice)
api.runtime.onStartup.addListener(() => { browserStart = true; trail("onStartup"); });
// Firefox does not always send onStartup (seen in testing after a hard kill), so a start is also known by this:
// nothing in storage.session (it lasts until Firefox quits) and no install or update just now. A restore never opens a
// tab twice, so running it when Firefox did restore everything adds nothing.
let installed = false;
api.runtime.onInstalled.addListener(() => { installed = true; trail("installed or updated"); });

// Firefox puts this background to sleep when nothing happens for a while and starts it again for the next event. A wake
// is not a start: the event that woke it (a reopened tab, a hidden tab picked) is handled at once, with no repair wait.
// storage.session lasts until Firefox quits, so it tells the two apart.
const woke = queue(async () => {
  if (!(await quiet(api.storage.session.get("awake")))?.awake) return false;
  starting = false;
  started = true;
  return true;
});

async function start() {
  if (await woke) return trail("woke");
  await sleep(1500); // let Firefox finish restoring tabs and their values
  trail(`start: onStartup ${browserStart}, installed ${installed}`);
  const wins = await normalWindows();
  for (const w of wins) await markWindow(w.id, 0);
  if (!installed && wins.length) {
    // Firefox may not have reopened everything: with "Open previous windows and tabs" off it reopens only pinned tabs,
    // and a crash can lose the last moments. Tabstead's live copy fills in whatever is missing; a tab already open is
    // never opened again, so when Firefox restored everything nothing is added.
    // Wait until Firefox has stopped adding restored tabs (a big session takes a moment), up to 6 seconds
    let last = -1;
    for (let i = 0; i < 20; i++) {
      const now = (await api.tabs.query({})).length;
      if (now === last) break;
      last = now;
      await sleep(400);
    }
    const { live } = await api.storage.local.get("live");
    startInfo = { liveTabs: live ? countTabs(live) : null, windows: wins.length };
    trail(`live copy ${live ? countTabs(live) : "none"}, tabs open ${last}`);
    if (live && countTabs(live)) {
      starting = false;
      const r = await queue(() => restore(normalizeBackup(live), wins[0].id)).catch((e) => { trail("restore failed: " + e); return null; });
      trail("restored " + r?.added);
      startInfo.added = r?.added;
      if (r?.added) await api.storage.local.set({ notice: { kind: "startup", count: r.added, at: Date.now() } });
    }
  }
  starting = false;
  await queue(settleAll);
  saveSoon();
  await api.storage.session.set({ awake: true });
  started = true;
}
start();

// ---------- Right-click a tab: Move to workspace ----------

async function buildMenu() {
  if (!api.menus) return;
  await api.menus.removeAll();
  const list = await workspaces();
  api.menus.create({ id: "move", title: "Move to workspace", contexts: ["tab"] });
  for (const w of list) api.menus.create({ id: "move:" + w.id, parentId: "move", title: w.name, contexts: ["tab"] });
  api.menus.create({ id: "move-sep", parentId: "move", type: "separator", contexts: ["tab"] });
  api.menus.create({ id: "move:new", parentId: "move", title: "New workspace", contexts: ["tab"] });
}
api.runtime.onInstalled.addListener(buildMenu);
api.runtime.onStartup.addListener(buildMenu);
api.storage.onChanged.addListener((c, area) => { if (area === "local" && c.workspaces) buildMenu(); });
api.menus?.onShown?.addListener(async (info, tab) => {
  // Greys out the workspace the tab is already in
  if (!tab || !info.contexts.includes("tab")) return;
  const tag = await quiet(api.sessions.getTabValue(tab.id, WS));
  for (const w of await workspaces()) await quiet(api.menus.update("move:" + w.id, { enabled: w.id !== tag }));
  api.menus.refresh();
});
async function menuClick(info, tab) {
  if (!tab || !String(info.menuItemId).startsWith("move:")) return;
  // The tab, or every selected tab if it is one of them
  const picked = tab.highlighted ? (await api.tabs.query({ windowId: tab.windowId, highlighted: true })).map((t) => t.id) : [tab.id];
  let id = String(info.menuItemId).slice(5);
  if (id === "new") id = (await addWorkspace("")).id;
  await moveTabs(tab.windowId, picked, id);
}
api.menus?.onClicked?.addListener((info, tab) => queue(() => menuClick(info, tab)));

// ---------- Keyboard: next and previous workspace ----------

async function step(windowId, by) {
  const list = await workspaces();
  const cur = await activeWs(windowId);
  const at = list.findIndex((w) => w.id === cur);
  await switchTo(windowId, list[(at + by + list.length) % list.length].id);
}

api.commands.onCommand.addListener((name) => {
  if (name !== "next-workspace" && name !== "previous-workspace") return;
  queue(async () => {
    const win = await quiet(api.windows.getLastFocused({ windowTypes: ["normal"] }));
    if (!win || win.incognito) return;
    await step(win.id, name === "next-workspace" ? 1 : -1);
  });
});

// ---------- The sidebar ----------

async function overview(windowId) {
  const list = await workspaces();
  const current = await activeWs(windowId);
  const counts = {};
  for (const t of await readTabs()) if (t.ws && !t.pinned && !t.incognito) counts[t.ws] = (counts[t.ws] ?? 0) + 1;
  const { notice = null } = await api.storage.local.get("notice");
  return { workspaces: list.map((w) => ({ ...w, tabs: counts[w.id] ?? 0 })), current, notice };
}

async function addWorkspace(name) {
  const list = await workspaces();
  const ws = { id: "w" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6), name: uniqueName(name, list.map((w) => w.name)), color: COLORS[list.length % COLORS.length] };
  await api.storage.local.set({ workspaces: [...list, ws] });
  return ws;
}

// Moves tabs (with their whole tab group if they're in one) to another workspace
async function moveTabs(windowId, tabIds, id) {
  if (!(await workspaces()).some((w) => w.id === id)) return;
  const ids = new Set(tabIds);
  const all = await api.tabs.query({ windowId });
  const groups = new Set(all.filter((t) => ids.has(t.id) && t.groupId != null && t.groupId !== -1).map((t) => t.groupId));
  for (const t of all) if (groups.has(t.groupId)) ids.add(t.id);
  for (const tid of ids) {
    const t = all.find((x) => x.id === tid);
    if (t && !t.pinned) await setWs(tid, id);
  }
  await settle(windowId);
}

const actions = {
  overview: ({ windowId }) => overview(windowId),
  create: async ({ windowId, name }) => {
    const ws = await addWorkspace(name);
    await switchTo(windowId, ws.id);
    return overview(windowId);
  },
  switch: async ({ windowId, id }) => {
    if ((await workspaces()).some((w) => w.id === id)) await switchTo(windowId, id);
    return overview(windowId);
  },
  step: async ({ windowId, by }) => { await step(windowId, by); return overview(windowId); },
  rename: async ({ windowId, id, name }) => {
    const list = await workspaces();
    const others = list.filter((w) => w.id !== id).map((w) => w.name);
    await api.storage.local.set({ workspaces: list.map((w) => (w.id === id ? { ...w, name: uniqueName(name, others) } : w)) });
    return overview(windowId);
  },
  recolor: async ({ windowId, id, color }) => {
    const list = await workspaces();
    if (COLORS.includes(color)) await api.storage.local.set({ workspaces: list.map((w) => (w.id === id ? { ...w, color } : w)) });
    return overview(windowId);
  },
  // Up or down the list
  reorder: async ({ windowId, id, to }) => {
    const list = await workspaces();
    const from = list.findIndex((w) => w.id === id);
    if (from >= 0 && to >= 0 && to < list.length) {
      const [w] = list.splice(from, 1);
      list.splice(to, 0, w);
      await api.storage.local.set({ workspaces: list });
    }
    return overview(windowId);
  },
  // Deleting a workspace never closes its tabs: they move to the workspace shown in this window
  remove: async ({ windowId, id }) => {
    const list = await workspaces();
    if (list.length < 2 || !list.some((w) => w.id === id)) return overview(windowId);
    let current = await activeWs(windowId);
    if (current === id) {
      current = list.find((w) => w.id !== id).id;
      await api.sessions.setWindowValue(windowId, ACTIVE, current);
    }
    for (const t of await api.tabs.query({})) if ((await quiet(api.sessions.getTabValue(t.id, WS))) === id) await setWs(t.id, current);
    for (const w of await normalWindows()) if ((await quiet(api.sessions.getWindowValue(w.id, ACTIVE))) === id) await api.sessions.setWindowValue(w.id, ACTIVE, current);
    await api.storage.local.set({ workspaces: list.filter((w) => w.id !== id) });
    await settleAll();
    return overview(windowId);
  },
  move: async ({ windowId, tabIds, id }) => { await moveTabs(windowId, tabIds, id); return overview(windowId); },
  // A workspace in a window of its own: its tabs (and whole tab groups) move to a new window showing it
  openInWindow: async ({ windowId, id }) => {
    if (!(await workspaces()).some((w) => w.id === id)) return overview(windowId);
    if (!(await readTabs(windowId)).some((t) => t.ws === id && !t.pinned)) return overview(windowId);
    const win = await api.windows.create({});
    await markWindow(win.id, 0);
    await api.sessions.setWindowValue(win.id, ACTIVE, id);
    const fresh = (await api.tabs.query({ windowId: win.id }))[0];
    if (fresh) await setWs(fresh.id, id);
    // The window being left must still show something: switch it away first if it showed this workspace
    if ((await activeWs(windowId)) === id) {
      const other = (await workspaces()).find((w) => w.id !== id);
      if (other) await switchTo(windowId, other.id);
    }
    // Read after the switch: a put-away workspace's tabs are out of their groups (they remember them, and the groups
    // are made again in the new window)
    const mine = (await readTabs(windowId)).filter((t) => t.ws === id && !t.pinned);
    const groups = new Set(mine.filter((t) => t.groupId !== -1).map((t) => t.groupId));
    for (const g of groups) await quiet(api.tabGroups.move(g, { windowId: win.id, index: -1 }));
    const loose = mine.filter((t) => t.groupId === -1).map((t) => t.id);
    if (loose.length) await quiet(api.tabs.move(loose, { windowId: win.id, index: -1 }));
    await settle(win.id);
    // The new tab Firefox opened with the window goes, unless it is all there is
    if (fresh && mine.length) await quiet(api.tabs.remove(fresh.id));
    await settle(windowId);
    return overview(windowId);
  },
  // The rescue button: every tab Tabstead hid, shown again in this window's current workspace
  rescue: async ({ windowId }) => {
    const current = await activeWs(windowId);
    const hidden = (await api.tabs.query({ hidden: true })).filter((t) => !t.incognito);
    for (const t of hidden) await setWs(t.id, current);
    await each((ids) => api.tabs.show(ids), hidden.map((t) => t.id));
    await settleAll();
    return overview(windowId);
  },
  // Every tab in every workspace whose title or address has all the words
  search: async ({ query }) => {
    const words = String(query ?? "").toLowerCase().split(" ").filter(Boolean);
    if (!words.length) return [];
    const names = new Map((await workspaces()).map((w) => [w.id, w]));
    return (await readTabs())
      .filter((t) => !t.incognito && words.every((w) => ((t.title ?? "") + " " + (t.url ?? "")).toLowerCase().includes(w)))
      .slice(0, 50)
      .map((t) => ({ id: t.id, title: t.title, url: t.url, windowId: t.windowId, wsName: t.pinned ? "Pinned" : names.get(t.ws)?.name ?? "", color: t.pinned ? "grey" : names.get(t.ws)?.color ?? "grey" }));
  },
  // Goes to a tab: its window, its workspace, the tab itself
  focusTab: async ({ windowId, tabId }) => {
    const tab = await quiet(api.tabs.get(tabId));
    if (!tab) return overview(windowId);
    const tag = await quiet(api.sessions.getTabValue(tabId, WS));
    if (tag && !tab.pinned && tag !== (await activeWs(tab.windowId))) await switchTo(tab.windowId, tag);
    await quiet(api.tabs.update(tabId, { active: true }));
    await quiet(api.windows.update(tab.windowId, { focused: true }));
    return overview(windowId);
  },
  backups: async () => {
    const { backups = [] } = await api.storage.local.get("backups");
    return backups.map(({ at, kind, workspaces: w, tabs }) => ({ at, kind, workspaces: w, tabs }));
  },
  backupNow: async () => { await addBackup("manual"); return actions.backups(); },
  exportBackup: async () => { const s = await snapshot(); delete s.tabs; return s; },
  restoreBackup: async ({ windowId, at }) => {
    const { backups = [] } = await api.storage.local.get("backups");
    const b = backups.find((x) => x.at === at);
    if (!b) return { error: "That backup is no longer kept." };
    return restore(normalizeBackup(b.data), windowId);
  },
  importBackup: async ({ windowId, text }) => {
    let data;
    try { data = JSON.parse(text); } catch { return { error: "This file is not a backup." }; }
    try { return await restore(normalizeBackup(data), windowId); } catch (e) { return { error: e.message }; }
  },
  // The closed-window note: bring the window back whole (Firefox keeps it), or dismiss the note
  bringBack: async ({ windowId }) => {
    const closed = await api.sessions.getRecentlyClosed({ maxResults: 25 });
    const w = closed.find((c) => c.window);
    await api.storage.local.remove("notice");
    if (w) await quiet(api.sessions.restore(w.window.sessionId));
    return overview(windowId);
  },
  dismiss: async ({ windowId }) => { await api.storage.local.remove("notice"); return overview(windowId); },
};

const READ_ONLY = new Set(["overview", "search", "backups", "exportBackup"]);

api.runtime.onMessage.addListener((msg, sender) => {
  // Only Tabstead's own pages may ask (a test build adds its own "__test" bridge)
  if (msg?.action === "__test" || sender.id !== api.runtime.id) return undefined;
  if (sender.url && !sender.url.startsWith(api.runtime.getURL(""))) return undefined;
  const fn = actions[msg?.action];
  if (!fn) return undefined;
  // Questions that only read go straight through; changes wait their turn
  return READ_ONLY.has(msg.action) ? fn(msg) : queue(() => fn(msg));
});

// For the tests only (a test build exposes these to a local test page)
globalThis.__tabstead = { settle, settleAll, switchTo, readTabs, activeWs, workspaces, actions, snapshot, restore, saveLive, addBackup, queue, menuClick, running: () => running, started: () => started, startInfo: () => ({ browserStart, ...startInfo }) };
