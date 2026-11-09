// The sidebar: the workspaces of this window. Click one to switch, double-click to rename, click the dot to change the
// colour, the "..." button deletes. Search finds a tab in any workspace. Backups keeps restore points and files.
// Everything is inline: Firefox sidebars don't show prompt() or confirm() boxes reliably.
const api = globalThis.browser;
const $ = (s) => document.querySelector(s);
const COLORS = { blue: "#0a84ff", red: "#ff4f5e", green: "#2ac3a2", yellow: "#ffd567", purple: "#b833e1", orange: "#ff9f43", cyan: "#00ddff", pink: "#ff6bba", grey: "#8f8f9d" };
const ORDER = Object.keys(COLORS);
let windowId;
let last = null;
let editing = null;  // id of the workspace being renamed
let deleting = null; // id of the workspace waiting for a delete answer
let menuFor = null;  // id of the workspace whose ... menu is open

const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
const ask = (action, extra = {}) => api.runtime.sendMessage({ action, windowId, ...extra });
const send = (action, extra = {}) => ask(action, extra).then(draw);
const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;

// Tab events come in bursts (a restore opens hundreds): the list is redrawn once things settle
let refreshTimer = null;
const refresh = () => {
  clearTimeout(refreshTimer);
  refreshTimer = setTimeout(() => { if (!editing && !deleting && !menuFor) send("overview"); if ($("#search").value.trim()) search(); }, 300);
};

function drawNotice(n) {
  const box = $("#notice");
  if (!n) { box.hidden = true; return; }
  box.replaceChildren();
  const ok = el("button", "", "OK");
  ok.addEventListener("click", () => send("dismiss"));
  if (n.kind === "window") {
    const back = el("button", "primary", "Bring it back");
    back.addEventListener("click", () => send("bringBack"));
    box.append(el("span", "", `A window closed with ${plural(n.count, "hidden tab")} from other workspaces. Firefox kept it whole.`), back, ok);
  } else {
    box.append(el("span", "", `Tabstead brought back ${plural(n.count, "tab")} that Firefox didn't reopen.`), ok);
  }
  box.hidden = false;
}

function draw(o) {
  if (!o || !o.workspaces) return;
  last = o;
  drawNotice(o.notice);
  const currentName = o.workspaces.find((w) => w.id === o.current)?.name ?? "";
  $("#list").replaceChildren(...o.workspaces.map((w) => {
    const li = el("li", w.id === o.current ? "current" : "");
    const dot = el("button", "dot");
    dot.style.background = COLORS[w.color] ?? COLORS.grey;
    dot.title = "Change colour"; dot.setAttribute("aria-label", "Change the colour of " + w.name);
    dot.addEventListener("click", (e) => { e.stopPropagation(); send("recolor", { id: w.id, color: ORDER[(ORDER.indexOf(w.color) + 1) % ORDER.length] }); });
    dot.addEventListener("dblclick", (e) => e.stopPropagation());
    if (w.id === deleting) {
      li.className += " ask";
      const target = w.id === o.current ? o.workspaces.find((x) => x.id !== w.id)?.name : currentName;
      const yes = el("button", "danger", "Delete"), no = el("button", "", "Cancel");
      yes.addEventListener("click", (e) => { e.stopPropagation(); deleting = null; send("remove", { id: w.id }); });
      no.addEventListener("click", (e) => { e.stopPropagation(); deleting = null; draw(last); });
      li.append(dot, el("span", "name wrap", `Delete "${w.name}"? Its ${plural(w.tabs, "tab")} move to "${target}". Nothing is closed.`), yes, no);
      return li;
    }
    if (w.id === menuFor) {
      li.className += " ask";
      const win = el("button", "", "Open in new window"), del = el("button", "", "Delete"), no = el("button", "", "Cancel");
      win.addEventListener("click", (e) => { e.stopPropagation(); menuFor = null; send("openInWindow", { id: w.id }); });
      del.addEventListener("click", (e) => { e.stopPropagation(); menuFor = null; deleting = w.id; draw(last); });
      no.addEventListener("click", (e) => { e.stopPropagation(); menuFor = null; draw(last); });
      del.hidden = o.workspaces.length < 2;
      li.append(dot, el("span", "name wrap", w.name), win, del, no);
      return li;
    }
    if (w.id === editing) {
      const input = el("input", "rename"); input.value = w.name; input.maxLength = 60; input.setAttribute("aria-label", "Rename " + w.name);
      const done = (save) => {
        if (editing !== w.id) return;
        editing = null;
        if (save && input.value.trim() && input.value.trim() !== w.name) send("rename", { id: w.id, name: input.value }); else draw(last);
      };
      input.addEventListener("keydown", (e) => { if (e.key === "Enter") done(true); if (e.key === "Escape") done(false); });
      input.addEventListener("blur", () => done(true));
      li.append(dot, input);
      queueMicrotask(() => { input.focus(); input.select(); });
      return li;
    }
    li.tabIndex = 0;
    li.title = w.id === o.current ? w.name + " (shown now)" : "Switch to " + w.name;
    const more = el("button", "more", "⋯"); more.title = "More for " + w.name; more.setAttribute("aria-label", "More for " + w.name);
    more.addEventListener("click", (e) => { e.stopPropagation(); menuFor = w.id; draw(last); });
    more.addEventListener("dblclick", (e) => e.stopPropagation());
    li.addEventListener("click", () => { if (w.id !== o.current) send("switch", { id: w.id }); });
    li.addEventListener("dblclick", () => { editing = w.id; draw(last); });
    // Keyboard: Enter switches, F2 renames, Alt+Up and Alt+Down move it in the list
    li.addEventListener("keydown", (e) => {
      const at = o.workspaces.indexOf(w);
      if (e.key === "Enter") send("switch", { id: w.id });
      else if (e.key === "F2") { editing = w.id; draw(last); }
      else if (e.altKey && (e.key === "ArrowUp" || e.key === "ArrowDown")) {
        e.preventDefault();
        const to = at + (e.key === "ArrowUp" ? -1 : 1);
        send("reorder", { id: w.id, to }).then(() => $("#list").children[Math.max(0, Math.min(to, o.workspaces.length - 1))]?.focus());
      } else if (e.key === "ArrowUp" || e.key === "ArrowDown") {
        e.preventDefault();
        $("#list").children[at + (e.key === "ArrowUp" ? -1 : 1)]?.focus();
      }
    });
    li.append(dot, el("span", "name", w.name), el("span", "count", String(w.tabs)), more);
    return li;
  }));
}

// ---------- New workspace, typed in place ----------
const openNew = () => { $("#new").hidden = false; $("#new-name").value = ""; $("#new-name").focus(); };
const closeNew = () => { $("#new").hidden = true; };
$("#add").addEventListener("click", () => ($("#new").hidden ? openNew() : closeNew()));
$("#new-cancel").addEventListener("click", closeNew);
$("#new-name").addEventListener("keydown", (e) => { if (e.key === "Escape") closeNew(); });
$("#new").addEventListener("submit", (e) => { e.preventDefault(); const name = $("#new-name").value; closeNew(); send("create", { name }); });
$("#rescue").addEventListener("click", () => send("rescue"));

// ---------- Search every workspace ----------
async function search() {
  const q = $("#search").value.trim();
  const box = $("#results");
  if (!q) { box.hidden = true; $("#list").hidden = false; return; }
  const found = await ask("search", { query: q });
  if ($("#search").value.trim() !== q) return; // typed on
  box.replaceChildren(...(found.length ? found.map((t) => {
    const li = el("li", "result");
    li.tabIndex = 0;
    const dot = el("span", "dot"); dot.style.background = COLORS[t.color] ?? COLORS.grey;
    const text = el("span", "name");
    text.append(el("span", "title", t.title || t.url), el("span", "where", t.wsName));
    li.title = t.url;
    const go = () => { $("#search").value = ""; search(); send("focusTab", { tabId: t.id }); };
    li.addEventListener("click", go);
    li.addEventListener("keydown", (e) => { if (e.key === "Enter") go(); });
    li.append(dot, text);
    return li;
  }) : [el("li", "empty", "No tab has those words.")]));
  box.hidden = false;
  $("#list").hidden = true;
}
let searchTimer = null;
$("#search").addEventListener("input", () => { clearTimeout(searchTimer); searchTimer = setTimeout(search, 150); });
$("#search").addEventListener("keydown", (e) => {
  if (e.key === "Escape") { $("#search").value = ""; search(); }
  if (e.key === "Enter") $("#results li.result")?.click();
  if (e.key === "ArrowDown") { e.preventDefault(); $("#results li.result")?.focus(); }
});

// ---------- Backups ----------
const when = (at) => new Date(at).toLocaleString([], { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
const say = (text) => { $("#backup-msg").textContent = text; };
const result = (r) => {
  if (r?.error) return say(r.error);
  const parts = [r.added ? `Added ${plural(r.added, "tab")}` : "Nothing was missing"];
  if (r.workspaces) parts.push(plural(r.workspaces, "new workspace"));
  if (r.skipped) parts.push(`${r.skipped} already open`);
  if (r.unsupported) parts.push(`${r.unsupported} Firefox won't let an add-on open (like file and settings pages)`);
  say(parts.join(", ") + ".");
};
async function drawBackups() {
  const list = await ask("backups");
  $("#backup-list").replaceChildren(...(list.length ? list.map((b) => {
    const li = el("li", "backup");
    const go = el("button", "", "Restore");
    go.addEventListener("click", async () => { say("Restoring…"); result(await ask("restoreBackup", { at: b.at })); refresh(); });
    li.append(el("span", "name", `${when(b.at)}${b.kind === "manual" ? " (yours)" : ""}`), el("span", "count", `${plural(b.workspaces, "workspace")}, ${plural(b.tabs, "tab")}`), go);
    return li;
  }) : [el("li", "empty", "No restore points yet. One is made every 30 minutes when something changed.")]));
}
$("#backups-toggle").addEventListener("click", () => {
  const open = $("#backups").hidden;
  $("#backups").hidden = !open;
  $("#backups-toggle").setAttribute("aria-expanded", String(open));
  if (open) { say(""); drawBackups(); }
});
$("#backup-now").addEventListener("click", async () => { await ask("backupNow"); say("Backed up."); drawBackups(); });
// The file name has the date and time, so files never overwrite each other
globalThis.tabsteadSave = globalThis.tabsteadSave ?? ((name, text) => {
  const a = el("a");
  a.href = URL.createObjectURL(new Blob([text], { type: "application/json" }));
  a.download = name;
  document.body.append(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
});
$("#backup-save").addEventListener("click", async () => {
  const data = await ask("exportBackup");
  const d = new Date(), p = (n) => String(n).padStart(2, "0");
  const name = `tabstead-backup-${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}.json`;
  globalThis.tabsteadSave(name, JSON.stringify(data, null, 1));
  say("Saved " + name + ".");
});
$("#backup-file").addEventListener("change", async () => {
  const f = $("#backup-file").files[0];
  if (!f) return;
  say("Importing…");
  result(await ask("importBackup", { text: await f.text() }));
  $("#backup-file").value = "";
  refresh();
});

// ---------- The guide: shown on first open with "Don't show this again" already ticked; the ? button brings it back
const showGuide = (on) => { $("#guide").hidden = !on; if (on) $("#guide-hide").checked = true; };
$("#help").addEventListener("click", () => showGuide($("#guide").hidden));
$("#guide-close").addEventListener("click", async () => { await api.storage.local.set({ guideHidden: $("#guide-hide").checked }); showGuide(false); });

(async () => {
  windowId = Number(new URLSearchParams(location.search).get("window")) || (await api.windows.getCurrent()).id;
  const { guideHidden } = await api.storage.local.get("guideHidden");
  showGuide(!guideHidden);
  send("overview");
  for (const ev of ["onCreated", "onRemoved", "onAttached", "onDetached", "onActivated"]) api.tabs[ev].addListener(refresh);
  api.storage.onChanged?.addListener((c, area) => { if (area === "local" && (c.workspaces || c.notice || c.live)) refresh(); });
})();
