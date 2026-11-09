// Tabstead's harder cases in a real Firefox: tabs you bring back, hidden tabs you pick, duplicates, new windows, tabs
// dragged between windows, the last visible tab closing its window, search, backups, restore without doubles, a Simple
// Tab Groups import, a 500-tab restore, and fast clicking. After each one every window must show exactly its workspace.
import puppeteer from "puppeteer-core";
import http from "node:http";
import { resolve } from "node:path";

const FF = process.env.FIREFOX ?? "C:/Program Files/Mozilla Firefox/firefox.exe";
let bigHits = 0;
const server = http.createServer((q, r) => { if (q.url.includes("/big/")) bigHits++; r.setHeader("content-type", "text/html"); r.end(`<!doctype html><title>page ${q.url}</title>${q.url}`); });
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const base = `http://127.0.0.1:${server.address().port}`;
let failed = 0, n = 0;
const check = (name, ok, detail = "") => { n++; if (!ok) failed++; console.log(`${ok ? "✔" : "✘ FAIL"} ${name}${ok ? "" : "  " + detail}`); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await puppeteer.launch({ browser: "firefox", executablePath: FF, headless: !process.env.SHOW, protocolTimeout: 600000,
  extraPrefsFirefox: { "browser.sessionstore.max_tabs_undo": 25, "browser.sessionstore.max_windows_undo": 5 } });
await browser.installExtension(resolve("dist/firefox-test"));
await sleep(2500);
const page = await browser.newPage();
await page.goto(base + "/bridge");
await sleep(500);
let seq = 0;
const ask = (cmd) => page.evaluate((c, id) => new Promise((res) => {
  const on = (e) => { if (e.data?.tabsteadResult !== undefined && e.data.id === id) { removeEventListener("message", on); res(e.data.tabsteadResult); } };
  addEventListener("message", on); postMessage({ tabsteadTest: c, id }, "*");
}), cmd, ++seq);
const t = (cmd, ms = 60000) => Promise.race([ask(cmd), sleep(ms).then(async () => { throw new Error("no answer to " + JSON.stringify(cmd) + " / queue is running: " + (await ask({ do: "running" }))); })]);
const state = () => t({ do: "state" });
const idle = async (ms = 400) => { await sleep(ms); await t({ do: "idle" }); };
const byUrl = (s, u) => s.find((x) => x.url?.endsWith(u));
const allByUrl = (s, u) => s.filter((x) => x.url?.endsWith(u));

// Every window shows exactly its workspace, with one visible active tab
async function consistent() {
  const s = await state();
  const bad = [];
  for (const w of await t({ do: "windows" })) {
    const ws = await t({ do: "winWs", windowId: w });
    const mine = s.filter((x) => x.windowId === w);
    for (const x of mine) if (!x.pinned && x.hidden !== (x.ws !== ws)) bad.push(`${x.url} hidden=${x.hidden} ws=${x.ws} window shows ${ws}`);
    const act = mine.filter((x) => x.active);
    if (act.length !== 1 || act[0].hidden) bad.push(`window ${w}: active ${act.length}`);
  }
  // No group name left in the tab bar for a put-away workspace: every group has a tab in view
  for (const g of await t({ do: "groups" })) if (!s.some((x) => x.groupId === g.id && !x.hidden)) bad.push(`group "${g.title}" shows with all its tabs put away`);
  return bad.join("; ");
}
const ok = async (name) => { const c = await consistent(); check(name + ": every window shows exactly its workspace", c === "", c); };

const W = (await t({ do: "windows" }))[0];
let o = await t({ do: "overview" });
const main = o.workspaces[0].id;
const a = await t({ do: "open", url: base + "/a" });
await t({ do: "open", url: base + "/b" });
o = await t({ do: "create", name: "Work" });
const work = o.current;
const w1 = await t({ do: "open", url: base + "/w1", active: true });
const w2 = await t({ do: "open", url: base + "/w2" });
await idle();

// 1. Reopen a closed tab while in another workspace: it comes back where you are, in view
await t({ do: "close", ids: [w2] });
await t({ do: "switch", id: main });
await t({ do: "undoClose" });
await idle(900);
let s = await state();
check("reopened tab comes back into the workspace you're in", byUrl(s, "/w2")?.ws === main && !byUrl(s, "/w2")?.hidden, JSON.stringify(byUrl(s, "/w2")));
await ok("after reopening a closed tab");

// 2. Picking a hidden tab (Firefox's all-tabs list) switches to its workspace instead of fighting it
await t({ do: "activate", tabId: w1 });
await idle(600);
o = await t({ do: "overview" });
s = await state();
check("picking a hidden tab switches to its workspace", o.current === work && byUrl(s, "/w1").active && !byUrl(s, "/w1").hidden, JSON.stringify({ cur: o.current === work, w1: byUrl(s, "/w1") }));
await ok("after picking a hidden tab");

// 3. Duplicating a tab keeps the copy in the same workspace
await t({ do: "dup", tabId: w1 });
await idle(1200);
s = await state();
check("a duplicated tab stays in the same workspace", allByUrl(s, "/w1").length === 2 && allByUrl(s, "/w1").every((x) => x.ws === work), JSON.stringify(allByUrl(s, "/w1")));
await ok("after duplicating");

// 4. A new window starts in the workspace you were in; its tabs join it
const W2 = await t({ do: "newWindow", urls: [base + "/n1"] });
await idle(1200);
s = await state();
check("a new window starts in the workspace you were in", (await t({ do: "winWs", windowId: W2 })) === work, await t({ do: "winWs", windowId: W2 }));
check("its tab joins that workspace", byUrl(s, "/n1")?.ws === work);
await ok("after a new window");

// 5. A tab dragged to the other window joins that window's workspace and stays in view
await t({ do: "inWindow", act: "switch", windowId: W2, id: main });
await idle();
await t({ do: "toWindow", tabId: w1, windowId: W2 });
await idle(800);
s = await state();
check("a tab dragged to another window joins its workspace, in view", byUrl(s, "/w1") && s.find((x) => x.id === w1).ws === main && !s.find((x) => x.id === w1).hidden && s.find((x) => x.id === w1).windowId === W2, JSON.stringify(s.find((x) => x.id === w1)));
await ok("after dragging a tab between windows");

// 6. Right-click "Move to workspace": the tab goes, with its whole group
const g1 = await t({ do: "open", url: base + "/g1" }), g2 = await t({ do: "open", url: base + "/g2" });
await t({ do: "switch", id: main });
await idle();
const gid = await t({ do: "group", tabIds: [g1, g2], title: "Pair" });
await t({ do: "menuClick", tabId: g1, item: "move:" + work });
await idle();
s = await state();
{ const x1 = s.find((x) => x.id === g1), x2 = s.find((x) => x.id === g2);
check("Move to workspace moves the tab and its group", x1.ws === work && x2.ws === work && x1.hidden && x2.hidden && x1.grp?.title === "Pair" && x1.grp?.key === x2.grp?.key, JSON.stringify([x1, x2])); void gid; }
await t({ do: "menuClick", tabId: a, item: "move:new" });
await idle();
o = await t({ do: "overview" });
check("Move to a new workspace makes one", o.workspaces.length === 3 && (await state()).find((x) => x.id === a).ws === o.workspaces[2].id, JSON.stringify(o.workspaces.map((w) => w.name)));
await ok("after Move to workspace");

// 7. Search finds a hidden tab in another workspace; picking it goes there
const found = await t({ do: "search", query: "page g2" });
check("search finds a tab hidden in another workspace", found.length === 1 && found[0].wsName === "Work", JSON.stringify(found));
await t({ do: "focusTab", tabId: g2 });
await idle();
s = await state();
o = await t({ do: "overview" });
check("picking a search result switches there and shows the tab", o.current === work && s.find((x) => x.id === g2).active && !s.find((x) => x.id === g2).hidden, JSON.stringify({ cur: o.current, work, g2: s.find((x) => x.id === g2) }));
check("search with no words finds nothing", (await t({ do: "search", query: "  " })).length === 0);
await ok("after search");

// 8. Keyboard next and previous go round the list
const order = o.workspaces.map((w) => w.id);
let cur = o.current;
const seen = [];
for (let i = 0; i < order.length; i++) { o = await t({ do: "step", by: 1 }); seen.push(o.current); }
check("next workspace goes round the whole list", seen.at(-1) === cur && new Set(seen).size === order.length, JSON.stringify(seen));
o = await t({ do: "step", by: -1 });
check("previous goes back", o.current === order[(order.indexOf(cur) - 1 + order.length) % order.length]);
await t({ do: "switch", id: main });
await ok("after keyboard switching");

// 9. Backups: make one, lose tabs, restore: they come back in their workspaces and groups, hidden; twice adds nothing
await t({ do: "settle" });
let list = await t({ do: "backupNow" });
check("a backup is made and listed", list.length === 1 && list[0].tabs >= 6, JSON.stringify(list));
const before = await state();
const lost = before.filter((x) => /\/(g1|g2|w2)$/.test(x.url)).map((x) => x.id);
await t({ do: "close", ids: lost });
await idle();
let r = await t({ do: "restoreBackup", at: list[0].at });
await idle(800);
s = await state();
check("restore brings back the 3 closed tabs", r.added === 3 && ["/g1", "/g2", "/w2"].every((u) => allByUrl(s, u).length === 1), JSON.stringify(r));
check("restored tabs are in their own workspaces", byUrl(s, "/g1").ws === work && byUrl(s, "/w2").ws === main, JSON.stringify([byUrl(s, "/g1").ws, byUrl(s, "/w2").ws]));
check("restored group is a group again (remembered while its workspace is put away)", byUrl(s, "/g1").grp?.title === "Pair" && byUrl(s, "/g1").grp?.key === byUrl(s, "/g2").grp?.key, JSON.stringify([byUrl(s, "/g1"), byUrl(s, "/g2")]));
check("restored tabs of another workspace are hidden", byUrl(s, "/g1").hidden && byUrl(s, "/g2").hidden);
r = await t({ do: "restoreBackup", at: list[0].at });
check("restoring again adds nothing (no doubles)", r.added === 0 && (await state()).length === s.length, JSON.stringify(r));
await ok("after restore");
const exported = await t({ do: "exportBackup" });
check("the backup file is Tabstead's format with every workspace", exported.app === "tabstead" && exported.workspaces.length === 3 && !exported.tabs, Object.keys(exported).join());

// 10. A Simple Tab Groups backup file imports in one go
const stg = { version: "5.3.1", groups: [
  { id: 1, title: "Reading", tabs: [{ url: base + "/r1", title: "R1" }, { url: base + "/r2", title: "R2" }, { url: "about:newtab" }] },
  { id: 2, title: "Work", tabs: [{ url: base + "/w1", title: "W1" }, { url: base + "/sw", title: "SW" }] } ],
  pinnedTabs: [{ url: base + "/pin", title: "Pin" }] };
r = await t({ do: "importBackup", text: JSON.stringify(stg) });
await idle(800);
s = await state();
o = await t({ do: "overview" });
const reading = o.workspaces.find((w) => w.name === "Reading");
check("STG import: groups become workspaces (Work reused)", reading && o.workspaces.filter((w) => w.name === "Work").length === 1, JSON.stringify(o.workspaces.map((w) => w.name)));
check("STG import: tabs arrive in them, unloaded and hidden", ["/r1", "/r2"].every((u) => byUrl(s, u)?.ws === reading.id && byUrl(s, u)?.hidden), JSON.stringify(byUrl(s, "/r1")));
check("STG import: a page already open in that workspace isn't doubled", allByUrl(s, "/w1").length === 2 && byUrl(s, "/sw")?.ws === work, JSON.stringify(allByUrl(s, "/w1").length));
check("STG import: pinned tab added", byUrl(s, "/pin")?.pinned === true);
check("STG import: the count is right", r.added === 4, JSON.stringify(r));
r = await t({ do: "importBackup", text: "{ not json" });
check("a broken file says so", r.error === "This file is not a backup.", JSON.stringify(r));
r = await t({ do: "importBackup", text: JSON.stringify({ some: "thing" }) });
check("a file that isn't a backup says so", /not a Tabstead or Simple Tab Groups backup/.test(r.error ?? ""), JSON.stringify(r));
await ok("after import");

// 11. Closing the last visible tab closes the window (Firefox does that); Tabstead offers to bring it back whole
const W3 = await t({ do: "newWindow", urls: [base + "/x1"] });
await idle(1000);
await t({ do: "inWindow", act: "switch", windowId: W3, id: main });
const x2 = await t({ do: "open", url: base + "/x2" });
await t({ do: "toWindow", tabId: x2, windowId: W3 });
await idle(600);
await t({ do: "inWindow", act: "create", windowId: W3, name: "Solo" });
await idle(1600); // the live copy is written a second after changes
s = await state();
const solo = s.find((x) => x.windowId === W3 && !x.hidden);
const wsBefore = Object.fromEntries(["/x1", "/x2"].map((u) => [u, byUrl(s, u).ws]));
await t({ do: "close", ids: [solo.id] });
await idle(1200);
check("closing the last visible tab closed that window (Firefox's rule)", !(await t({ do: "windows" })).includes(W3));
o = await t({ do: "overview" });
check("the sidebar notes the closed window's hidden tabs", o.notice?.kind === "window" && o.notice.count >= 2, JSON.stringify(o.notice));
o = await t({ do: "bringBack" });
await idle(1500);
s = await state();
check("bring back: the window's hidden tabs return, each in its own workspace, still hidden", ["/x1", "/x2"].every((u) => byUrl(s, u)?.ws === wsBefore[u] && byUrl(s, u)?.hidden === true), JSON.stringify([byUrl(s, "/x1"), byUrl(s, "/x2"), wsBefore]));
check("bring back: the note goes", !(await t({ do: "overview" })).notice);
await ok("after bringing a window back");

// 12. Fast clicking: 12 switches fired at once end on the last one, consistent
const ids = (await t({ do: "overview" })).workspaces.map((w) => w.id);
await Promise.all(Array.from({ length: 12 }, (_, i) => t({ do: "switch", id: ids[i % ids.length] })));
await idle(600);
o = await t({ do: "overview" });
check("12 switches at once end on the last one", o.current === ids[11 % ids.length]);
await ok("after fast clicking");

// 13. Closing tabs while switching: no error, nothing wrong
const many = [];
for (let i = 0; i < 8; i++) many.push(await t({ do: "open", url: base + "/c" + i }));
const sw = t({ do: "switch", id: ids[1] });
await t({ do: "close", ids: many.slice(0, 4) });
await sw;
await idle(600);
await ok("after closing tabs during a switch");

// 14. A 500-tab restore: unloaded, in batches, Firefox still answers, nothing doubled
const big = { app: "tabstead", version: 1, workspaces: Array.from({ length: 5 }, (_, k) => ({ name: "Big " + k, tabs: Array.from({ length: 100 }, (_, i) => ({ url: `${base}/big/${k}/${i}`, title: `Big ${k}.${i}` })) })), pinned: [] };
const t0 = Date.now();
r = await t({ do: "importBackup", text: JSON.stringify(big) });
const secs = (Date.now() - t0) / 1000;
s = await state();
check(`500 tabs restored (${secs.toFixed(1)} s)`, r.added === 500 && s.filter((x) => x.url?.includes("/big/")).length === 500, JSON.stringify(r));
check(`500 restored tabs: none loaded its page (pages fetched: ${bigHits})`, bigHits === 0);
const t1 = Date.now();
o = await t({ do: "switch", id: (await t({ do: "overview" })).workspaces.find((w) => w.name === "Big 3").id });
const sw1 = Date.now() - t1;
s = await state();
check(`switching to a 100-tab workspace with 500+ tabs open (${sw1} ms)`, s.filter((x) => x.url?.includes("/big/3/")).every((x) => !x.hidden) && sw1 < 1500);
r = await t({ do: "importBackup", text: JSON.stringify(big) });
check("the 500-tab file again adds nothing", r.added === 0, JSON.stringify(r));
check(`only the workspace you switched to loads, and only its active tab (pages fetched: ${bigHits})`, bigHits <= 1);
await ok("after the 500-tab restore");

// 15. Open a workspace in a new window: its tabs and whole groups go there, shown; the old window shows another workspace
{
  o = await t({ do: "create", name: "Travel" });
  const travel = o.current;
  const p1 = await t({ do: "open", url: base + "/trip1", active: true }), p2 = await t({ do: "open", url: base + "/trip2" }), p3 = await t({ do: "open", url: base + "/trip3" });
  const tg = await t({ do: "group", tabIds: [p2, p3], title: "Hotels" });
  await idle();
  const winsBefore = await t({ do: "windows" });
  const countBefore = (await state()).length;
  o = await t({ do: "openInWindow", id: travel });
  await idle(1200);
  s = await state();
  const newWin = (await t({ do: "windows" })).find((w) => !winsBefore.includes(w));
  check("open in new window: a new window shows the workspace", newWin && (await t({ do: "winWs", windowId: newWin })) === travel);
  check("open in new window: all its tabs moved there, in view", [p1, p2, p3].every((id) => { const x = s.find((y) => y.id === id); return x && x.windowId === newWin && !x.hidden && x.ws === travel; }), JSON.stringify(s.filter((x) => [p1, p2, p3].includes(x.id))));
  const g = (await t({ do: "groups" })).find((x) => x.title === "Hotels");
  check("open in new window: the group went whole, with its name", g && g.windowId === newWin && s.find((x) => x.id === p2).groupId === g.id && s.find((x) => x.id === p3).groupId === g.id, JSON.stringify(g));
  check("open in new window: the old window shows another workspace", o.current !== travel);
  check("open in new window: no tab closed, Firefox's extra new tab removed", (await state()).length === countBefore, `${countBefore} -> ${(await state()).length}`);
  await ok("after opening a workspace in a new window");
  void tg;
}

console.log(failed ? `\n${failed} of ${n} failed` : `\nall ${n} passed`);
await browser.close(); server.close();
process.exit(failed ? 1 : 0);
