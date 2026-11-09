// Tabstead's rules, with no browser in them, so they can be tested on their own.
//
// The one rule everything rests on: Tabstead never closes a tab to switch workspaces. It only hides and shows tabs.
// Which tabs are visible is always worked out from each tab's workspace tag (kept by Firefox's own session store) and the
// window's active workspace. So after a crash, a bug or a Firefox update, reconcile() puts the right tabs back on view.

/** A tab as Tabstead sees it: { id, windowId, active, pinned, hidden, ws } (ws = its workspace id, or null if untagged). */

/**
 * What to do so a window shows exactly its active workspace: every tab tagged with it, plus pinned tabs (Firefox can't
 * hide pinned tabs, so they belong to every workspace). Untagged tabs join the active workspace. Nothing is ever closed.
 * Returns { tag: [ids], show: [ids], hide: [ids], activate: id|null, needNewTab: bool }.
 */
export function reconcile(tabs, windowId, activeWs) {
  const mine = tabs.filter((t) => t.windowId === windowId);
  const tag = mine.filter((t) => !t.ws && !t.pinned).map((t) => t.id);
  const wsOf = (t) => (t.ws ?? (t.pinned ? null : activeWs));
  const shouldShow = (t) => t.pinned || wsOf(t) === activeWs;

  const show = mine.filter((t) => t.hidden && shouldShow(t)).map((t) => t.id);
  const visibleAfter = mine.filter((t) => shouldShow(t));
  const hideList = mine.filter((t) => !t.hidden && !shouldShow(t));

  // Firefox can't hide the active tab: if the active tab is leaving, another tab of the workspace becomes active first
  let activate = null;
  let needNewTab = false;
  const active = mine.find((t) => t.active);
  if (active && !shouldShow(active)) {
    const next = visibleAfter.filter((t) => !t.pinned)[0] ?? visibleAfter[0];
    if (next) activate = next.id;
    else needNewTab = true;
  }
  return { tag, show, hide: hideList.map((t) => t.id), activate, needNewTab };
}

/** The plan to switch a window to another workspace: the same as reconciling it with the new active workspace. */
export function switchPlan(tabs, windowId, toWs) {
  return reconcile(tabs, windowId, toWs);
}

/** Applies a plan to a list of tabs, the way the browser would. Used by the tests. */
export function applyPlan(tabs, plan, windowId, activeWs, newTabId) {
  let out = tabs.map((t) => ({ ...t }));
  if (plan.needNewTab) {
    out.forEach((t) => { if (t.windowId === windowId) t.active = false; });
    out.push({ id: newTabId, windowId, active: true, pinned: false, hidden: false, ws: activeWs });
  }
  for (const t of out) {
    if (plan.tag.includes(t.id)) t.ws = activeWs;
    if (plan.show.includes(t.id)) t.hidden = false;
  }
  if (plan.activate != null) out.forEach((t) => { if (t.windowId === windowId) t.active = t.id === plan.activate; });
  for (const t of out) if (plan.hide.includes(t.id)) {
    if (t.active) throw new Error(`tried to hide the active tab ${t.id}`);
    t.hidden = true;
  }
  return out;
}

/** True when a window shows exactly what it should: its active workspace's tabs and pinned tabs, with one active tab shown. */
export function isConsistent(tabs, windowId, activeWs) {
  const mine = tabs.filter((t) => t.windowId === windowId);
  if (!mine.length) return true;
  const active = mine.filter((t) => t.active);
  if (active.length !== 1 || active[0].hidden) return false;
  return mine.every((t) => t.hidden === !(t.pinned || t.ws === activeWs));
}

/** Workspace names: trimmed, never empty, and unique (a second "Work" becomes "Work 2"). */
export function uniqueName(name, taken) {
  const base = String(name ?? "").trim() || "Workspace";
  if (!taken.includes(base)) return base;
  for (let n = 2; ; n++) if (!taken.includes(`${base} ${n}`)) return `${base} ${n}`;
}

// ---------- Backups, restore and import ----------
//
// One shape for everything Tabstead brings back (its own backups, the live copy kept for a restart without session
// restore, a closed window, and Simple Tab Groups backups):
//   { workspaces: [{ id?, name, color?, tabs: [{ url, title, pinned?, group?: { key, title, color, collapsed } }] }],
//     pinned: [{ url, title }] }

const QUIET = new Set(["about:blank", "about:newtab", "about:home", "about:privatebrowsing"]);

/** The address to open for a saved tab, or null when there is nothing to open or Firefox won't let an add-on open it. */
export function creatableUrl(url) {
  if (typeof url !== "string" || !url || QUIET.has(url)) return null;
  let u;
  try { u = new URL(url); } catch { return null; }
  if (u.protocol === "http:" || u.protocol === "https:" || u.protocol === "ftp:") return url;
  // Reader view and add-on placeholder pages carry the real address in ?url=
  if (u.protocol === "about:" || u.protocol === "moz-extension:") {
    const inner = u.searchParams.get("url");
    return inner && inner !== url ? creatableUrl(inner) : null;
  }
  return null;
}

const COLOR_NAMES = ["blue", "red", "green", "yellow", "purple", "orange", "cyan", "pink", "grey"];

/** Reads a backup file's JSON: Tabstead's own, or Simple Tab Groups (any version with groups and tabs). Throws if neither. */
export function normalizeBackup(data) {
  if (!data || typeof data !== "object") throw new Error("This file is not a backup.");
  if (data.app === "tabstead") {
    return {
      workspaces: (data.workspaces ?? []).map((w, i) => ({
        id: typeof w.id === "string" ? w.id : undefined,
        name: String(w.name ?? "").trim() || `Workspace ${i + 1}`,
        color: COLOR_NAMES.includes(w.color) ? w.color : COLOR_NAMES[i % COLOR_NAMES.length],
        tabs: (w.tabs ?? []).filter((t) => t && typeof t.url === "string").map((t) => ({
          url: t.url, title: String(t.title ?? ""), pinned: false,
          group: t.group && typeof t.group === "object" ? { key: String(t.group.key ?? t.group.title ?? ""), title: String(t.group.title ?? ""), color: COLOR_NAMES.includes(t.group.color) ? t.group.color : "grey", collapsed: !!t.group.collapsed } : null,
        })),
      })),
      pinned: (data.pinned ?? []).filter((t) => t && typeof t.url === "string").map((t) => ({ url: t.url, title: String(t.title ?? "") })),
    };
  }
  if (Array.isArray(data.groups)) {
    // Simple Tab Groups: each group becomes a workspace; its pinned tabs stay pinned
    return {
      workspaces: data.groups.filter((g) => g && typeof g === "object").map((g, i) => ({
        name: (String(g.title ?? "").trim() || `Group ${i + 1}`) + (g.isArchive ? " (archived)" : ""),
        color: COLOR_NAMES[i % COLOR_NAMES.length],
        tabs: (Array.isArray(g.tabs) ? g.tabs : []).filter((t) => t && typeof t.url === "string").map((t) => ({ url: t.url, title: String(t.title ?? ""), pinned: false, group: null })),
      })),
      pinned: (Array.isArray(data.pinnedTabs) ? data.pinnedTabs : []).filter((t) => t && typeof t.url === "string").map((t) => ({ url: t.url, title: String(t.title ?? "") })),
    };
  }
  throw new Error("This file is not a Tabstead or Simple Tab Groups backup.");
}

/**
 * What a restore adds. Never doubles a tab: a saved tab is skipped when the same address is already open in the same
 * workspace (counted, so two saved copies of one page against one open copy add one); an open tab with no workspace yet
 * matches the page in any workspace. Workspaces are matched by id,
 * then by name; the rest are new.
 * existing: { workspaces: [{ id, name }], tabs: [{ url, ws, pinned }] }
 * Returns { newWorkspaces: [{ key, name, color }], add: [{ wsKey, url, title, group }], pinned: [{ url, title }], skipped: n, unsupported: n }
 */
export function planRestore(backup, existing) {
  const byId = new Map(existing.workspaces.map((w) => [w.id, w]));
  const byName = new Map(existing.workspaces.map((w) => [w.name.toLowerCase(), w]));
  const open = new Map();
  const bump = (k) => open.set(k, (open.get(k) ?? 0) + 1);
  // A tab with no workspace yet (Firefox still restoring, or a start page) matches the page in any workspace: never a double
  for (const t of existing.tabs) bump((t.pinned ? "pinned" : t.ws ?? "*") + " " + t.url);
  const take1 = (k) => { const n = open.get(k) ?? 0; if (n > 0) { open.set(k, n - 1); return true; } return false; };
  const take = (k) => take1(k) || (!k.startsWith("pinned ") && take1("* " + k.slice(k.indexOf(" ") + 1)));

  const newWorkspaces = [], add = [], pinned = [];
  let skipped = 0, unsupported = 0;
  const made = new Map();
  for (const w of backup.workspaces) {
    let key = (w.id ? byId.get(w.id)?.id : undefined) ?? byName.get(w.name.toLowerCase())?.id ?? made.get(w.name.toLowerCase());
    if (!key) {
      key = "new:" + newWorkspaces.length;
      newWorkspaces.push({ key, name: w.name, color: w.color });
      made.set(w.name.toLowerCase(), key);
    }
    for (const t of w.tabs) {
      const url = creatableUrl(t.url);
      if (!url) { if (t.url && !QUIET.has(t.url)) unsupported++; continue; }
      if (take(key + " " + url)) { skipped++; continue; }
      add.push({ wsKey: key, url, title: t.title, group: t.group ?? null });
    }
  }
  for (const t of backup.pinned ?? []) {
    const url = creatableUrl(t.url);
    if (!url) continue;
    if (take("pinned " + url)) { skipped++; continue; }
    pinned.push({ url, title: t.title });
  }
  // A new workspace with nothing to add is not made
  const used = new Set(add.map((a) => a.wsKey));
  return { newWorkspaces: newWorkspaces.filter((w) => used.has(w.key)), add, pinned, skipped, unsupported };
}
