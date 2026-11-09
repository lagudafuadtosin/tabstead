// Tabstead in a real Firefox: create, switch, new tabs, native tab groups, moving a group, deleting, rescue.
// After every step: no tab was closed by Tabstead, and the window shows exactly its workspace.
import puppeteer from "puppeteer-core";
import http from "node:http";
import { resolve } from "node:path";

const FF = process.env.FIREFOX ?? "C:/Program Files/Mozilla Firefox/firefox.exe";
const server = http.createServer((q, r) => { r.setHeader("content-type", "text/html"); r.end(`<!doctype html><title>${q.url}</title>${q.url}`); });
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const base = `http://127.0.0.1:${server.address().port}`;
let failed = 0, n = 0;
const check = (name, ok, detail = "") => { n++; if (!ok) failed++; console.log(`${ok ? "✔" : "✘ FAIL"} ${name}${ok ? "" : "  " + detail}`); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await puppeteer.launch({ browser: "firefox", executablePath: FF, headless: !process.env.SHOW });
await browser.installExtension(resolve("dist/firefox-test"));
await sleep(2500); // start-up repair runs after 1.5 s
const page = await browser.newPage();
await page.goto(base + "/bridge");
await sleep(500);
const t = (cmd) => page.evaluate((c) => new Promise((res) => {
  const on = (e) => { if (e.data?.tabsteadResult !== undefined) { removeEventListener("message", on); res(e.data.tabsteadResult); } };
  addEventListener("message", on); postMessage({ tabsteadTest: c }, "*");
}), cmd);
const state = () => t({ do: "state" });
const visible = async () => (await state()).filter((x) => !x.hidden);
const byUrl = (s, u) => s.find((x) => x.url?.endsWith(u));

// Start: one workspace, Main; the tabs that were open are tagged into it
let o = await t({ do: "overview" });
check("starts with one workspace, Main", o.workspaces.length === 1 && o.workspaces[0].name === "Main");
const main = o.workspaces[0].id;
const a = await t({ do: "open", url: base + "/a" });
const b = await t({ do: "open", url: base + "/b" });
let s = await state();
check("new tabs join the current workspace", byUrl(s, "/a").ws === main && byUrl(s, "/b").ws === main, JSON.stringify(s));
const start = s.length;

// A native tab group in Main
const g = await t({ do: "group", tabIds: [a, b], title: "Research" });
check("a Firefox tab group made in Main", typeof g === "number");

// New workspace: Main's tabs are hidden, not closed; the new workspace gets a fresh tab
o = await t({ do: "create", name: "Work" });
const work = o.workspaces.find((w) => w.name === "Work").id;
s = await state();
check("creating Work switches to it", o.current === work);
check("Main's tabs are hidden, none closed", s.filter((x) => x.ws === main).every((x) => x.hidden) && s.length >= start, JSON.stringify(s.map((x) => [x.url, x.ws === main, x.hidden])));
check("Work shows exactly its own tabs", (await visible()).every((x) => x.ws === work || x.pinned));
const titles = async () => (await t({ do: "groups" })).map((x) => x.title);
check("while put away, the tabs remember their group", byUrl(s, "/a").grp?.title === "Research" && byUrl(s, "/a").grp?.key === byUrl(s, "/b").grp?.key, JSON.stringify([byUrl(s, "/a"), byUrl(s, "/b")]));
check("while put away, the group's name is not in the tab bar", !(await titles()).includes("Research"), JSON.stringify(await titles()));

const w1 = await t({ do: "open", url: base + "/work1", active: true });
s = await state();
check("a tab opened in Work is tagged Work", byUrl(s, "/work1").ws === work);

// Back to Main: everything returns, group intact, Work hidden
o = await t({ do: "switch", id: main });
s = await state();
check("back in Main: its tabs are shown again", !byUrl(s, "/a").hidden && !byUrl(s, "/b").hidden);
const gOf = async (u) => (await t({ do: "groups" })).find((x) => x.id === byUrl(s, u).groupId);
check("back in Main: the group is back whole, with its name", byUrl(s, "/a").groupId !== -1 && byUrl(s, "/a").groupId === byUrl(s, "/b").groupId && (await gOf("/a"))?.title === "Research" && !byUrl(s, "/a").grp, JSON.stringify([byUrl(s, "/a"), byUrl(s, "/b"), await gOf("/a")]));
check("back in Main: Work's tabs are hidden", byUrl(s, "/work1").hidden);
const counts = Object.fromEntries(o.workspaces.map((w) => [w.name, w.tabs]));
check("the sidebar's counts are right", counts.Main >= 3 && counts.Work >= 2, JSON.stringify(counts));

// Moving one tab of a group moves the whole group
await t({ do: "move", tabIds: [a], id: work });
s = await state();
check("moving a tab moves its whole group to Work", byUrl(s, "/a").ws === work && byUrl(s, "/b").ws === work && byUrl(s, "/a").hidden && byUrl(s, "/b").hidden);

// Deleting Work moves its tabs to Main and closes nothing
const before = (await state()).length;
o = await t({ do: "remove", id: work });
s = await state();
check("deleting Work leaves one workspace", o.workspaces.length === 1);
check("deleting Work closes no tab", s.length === before, `${before} -> ${s.length}`);
check("Work's tabs are now in Main and shown", ["/a", "/b", "/work1"].every((u) => byUrl(s, u).ws === main && !byUrl(s, u).hidden));
check("the group survived the move and the delete", (await gOf("/a"))?.title === "Research" && byUrl(s, "/a").groupId === byUrl(s, "/b").groupId);

// Rescue shows every hidden tab
o = await t({ do: "create", name: "Temp" });
await t({ do: "rescue" });
s = await state();
check("rescue: no tab left hidden", s.every((x) => !x.hidden), JSON.stringify(s.filter((x) => x.hidden).map((x) => x.url)));

console.log(failed ? `\n${failed} of ${n} failed` : `\nall ${n} passed`);
await browser.close(); server.close();
process.exit(failed ? 1 : 0);
