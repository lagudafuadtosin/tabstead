// Firefox puts an add-on's background to sleep when nothing has happened for a while (30 s normally, 2 s here), and
// wakes it for the next event. Everything Tabstead does must work on the first event after it wakes.
import puppeteer from "puppeteer-core";
import http from "node:http";
import { resolve } from "node:path";

const FF = process.env.FIREFOX ?? "C:/Program Files/Mozilla Firefox/firefox.exe";
const server = http.createServer((q, r) => { r.setHeader("content-type", "text/html"); r.end(`<!doctype html><title>page ${q.url}</title>${q.url}`); });
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const base = `http://127.0.0.1:${server.address().port}`;
let failed = 0, n = 0;
const check = (name, ok, detail = "") => { n++; if (!ok) failed++; console.log(`${ok ? "✔" : "✘ FAIL"} ${name}${ok ? "" : "  " + detail}`); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await puppeteer.launch({ browser: "firefox", executablePath: FF, headless: !process.env.SHOW, protocolTimeout: 600000,
  extraPrefsFirefox: { "extensions.background.idle.timeout": 2000, "browser.sessionstore.max_tabs_undo": 25 } });
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
const t = (cmd, ms = 60000) => Promise.race([ask(cmd), sleep(ms).then(() => { throw new Error("no answer to " + JSON.stringify(cmd)); })]);
const state = () => t({ do: "state" });
const idle = async (ms = 400) => { await sleep(ms); await t({ do: "idle" }); };
const byUrl = (s, u) => s.find((x) => x.url?.endsWith(u));

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
// Wait until the background has gone to sleep (the next question wakes a fresh one)
let boot = await t({ do: "boot" });
async function asleep() {
  await sleep(4500);
}
async function wasAsleep(name) {
  const now = await t({ do: "boot" });
  check(name + ": the background had gone to sleep", now !== boot);
  boot = now;
}

let o = await t({ do: "overview" });
const main = o.workspaces[0].id;
await t({ do: "open", url: base + "/a" });
o = await t({ do: "create", name: "Work" });
const work = o.current;
const w1 = await t({ do: "open", url: base + "/w1", active: true });
const w2 = await t({ do: "open", url: base + "/w2" });
await idle();
await t({ do: "close", ids: [w2] });
await t({ do: "switch", id: main });
await idle(1500);

// 1. Ctrl+Shift+T as the first thing after a sleep: the tab comes back where you are, in view
await asleep();
await t({ do: "undoClose" });
await idle(1500);
await wasAsleep("reopen");
let s = await state();
check("reopened after a sleep: comes back into the workspace you're in, in view", byUrl(s, "/w2")?.ws === main && !byUrl(s, "/w2")?.hidden, JSON.stringify(byUrl(s, "/w2")));
await ok("after reopening");

// 2. Picking a hidden tab as the first thing after a sleep switches to its workspace
await asleep();
await t({ do: "activate", tabId: w1 });
await idle(1500);
await wasAsleep("pick hidden");
o = await t({ do: "overview" });
s = await state();
check("picked a hidden tab after a sleep: switched to its workspace", o.current === work && byUrl(s, "/w1")?.active && !byUrl(s, "/w1")?.hidden, JSON.stringify({ cur: o.current, w1: byUrl(s, "/w1") }));
await ok("after picking a hidden tab");

// 3. A new tab opened while asleep (not through Tabstead) joins the workspace you're in
await asleep();
const p = await browser.newPage();
await p.goto(base + "/fresh");
await idle(1500);
await wasAsleep("new tab");
s = await state();
o = await t({ do: "overview" });
check("new tab after a sleep: in the workspace you're in", byUrl(s, "/fresh")?.ws === o.current && !byUrl(s, "/fresh")?.hidden, JSON.stringify(byUrl(s, "/fresh")));
await ok("after a new tab");

// 4. Duplicate as the first thing after a sleep
await asleep();
const d = await t({ do: "dup", tabId: w1 });
await idle(2000);
await wasAsleep("duplicate");
s = await state();
const dt = s.find((x) => x.id === d);
check("duplicate after a sleep: same workspace, in view", dt?.ws === work && !dt?.hidden, JSON.stringify(dt));
await ok("after duplicating");

// 5. A switch from the sidebar as the first thing after a sleep
await asleep();
o = await t({ do: "switch", id: main });
await idle(600);
await wasAsleep("switch");
check("switch after a sleep", o.current === main);
await ok("after switching");

// 6. Moving a tab to another window as the first thing after a sleep
const W2 = await t({ do: "newWindow", urls: [base + "/other"] });
await idle(1500);
s = await state();
const a = byUrl(s, "/a");
await asleep();
await t({ do: "toWindow", tabId: a.id, windowId: W2 });
await idle(1500);
await wasAsleep("drag to window");
s = await state();
check("tab moved to another window after a sleep: in view there", !byUrl(s, "/a")?.hidden && byUrl(s, "/a")?.windowId === W2, JSON.stringify(byUrl(s, "/a")));
await ok("after moving a tab to another window");

// 7. The live copy keeps up with changes made around sleeps
await asleep();
const live = (await t({ do: "storageGet", key: "live" })).live;
const liveUrls = live.workspaces.flatMap((w) => w.tabs.map((x) => x.url));
check("live copy has the tabs opened around sleeps", ["/w1", "/w2", "/fresh", "/a"].every((u) => liveUrls.some((x) => x.endsWith(u))), JSON.stringify(liveUrls));

// 8. The right-click menu still works after a sleep
await asleep();
s = await state();
await t({ do: "menuClick", tabId: byUrl(s, "/fresh").id, item: "move:" + work });
await idle(800);
s = await state();
check("Move to workspace after a sleep", byUrl(s, "/fresh")?.ws === work, JSON.stringify(byUrl(s, "/fresh")));
await ok("after Move to workspace");

// 9. A tab closed as the first thing after a sleep leaves the live copy (or it would come back at the next start)
await asleep();
s = await state();
await t({ do: "close", ids: [byUrl(s, "/other").id] });
await sleep(2500);
let liveNow = (await t({ do: "storageGet", key: "live" })).live;
check("tab closed after a sleep leaves the live copy", !liveNow.workspaces.some((w) => w.tabs.some((x) => x.url.endsWith("/other"))), JSON.stringify(liveNow.workspaces.map((w) => w.tabs.map((x) => x.url))));

// 10. Tabstead updated (or reloaded) while hidden tabs exist: nothing lost, every window still shows its workspace
s = await state();
const before = s.length;
await browser.installExtension(resolve("dist/firefox-test"));
await sleep(3000);
await page.reload();
await sleep(800);
await idle(1500);
s = await state();
check("after an update: no tab lost or added", s.length === before, `${before} -> ${s.length}`);
check("after an update: hidden workspaces still hidden", s.some((x) => x.hidden), JSON.stringify(s.map((x) => [x.url, x.hidden, x.ws])));
o = await t({ do: "overview" });
check("after an update: workspaces kept", o.workspaces.length === 2, JSON.stringify(o.workspaces));
await ok("after an update");

console.log(failed ? `${failed} of ${n} FAILED` : `all ${n} passed`);
await browser.close();
server.close();
process.exit(failed ? 1 : 0);
