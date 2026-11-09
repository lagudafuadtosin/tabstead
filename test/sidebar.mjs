// The sidebar in a real Firefox, driven with real clicks and typing: the first-open guide, new, switch, rename, delete.
import puppeteer from "puppeteer-core";
import http from "node:http";
import { resolve } from "node:path";
import { readFileSync } from "node:fs";

const FF = process.env.FIREFOX ?? "C:/Program Files/Mozilla Firefox/firefox.exe";
// The real sidebar files, served on a local page with a small stand-in for browser.* that goes through the test bridge
// to the real background (BiDi can't reach moz-extension pages). Every click and key is a real one.
const SHIM = `<script>
let seq = 0;
const call = (c) => new Promise((res) => { const id = ++seq; const on = (e) => { if (e.data && e.data.tabsteadResult !== undefined && e.data.id === id) { removeEventListener("message", on); res(e.data.tabsteadResult); } }; addEventListener("message", on); postMessage({ tabsteadTest: c, id }, "*"); });
const ev = { addListener() {} };
globalThis.saved = [];
globalThis.tabsteadSave = (name, text) => saved.push({ name, text });
globalThis.browser = {
  runtime: { sendMessage: ({ action, windowId, ...rest }) => call({ do: action, ...rest }) },
  windows: { getCurrent: async () => ({ id: 0 }) },
  storage: { local: { get: (key) => call({ do: "storageGet", key }), set: (value) => call({ do: "storageSet", value }) } },
  tabs: { onCreated: ev, onRemoved: ev, onAttached: ev, onDetached: ev, onActivated: ev },
};
</script>`;
const dist = resolve("dist/firefox-test");
const server = http.createServer((q, r) => {
  const f = { "/sidebar": "sidebar.html", "/sidebar.js": "sidebar.js", "/sidebar.css": "sidebar.css" }[q.url];
  if (f) {
    r.setHeader("content-type", f.endsWith(".js") ? "text/javascript" : f.endsWith(".css") ? "text/css" : "text/html");
    let body = readFileSync(dist + "/" + f, "utf8");
    if (f === "sidebar.html") body = body.replace('<script type="module"', SHIM + '<script type="module"');
    return r.end(body);
  }
  r.setHeader("content-type", "text/html"); r.end(`<!doctype html><title>${q.url}</title>${q.url}`);
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const base = `http://127.0.0.1:${server.address().port}`;
let failed = 0, n = 0;
const check = (name, ok, detail = "") => { n++; if (!ok) failed++; console.log(`${ok ? "✔" : "✘ FAIL"} ${name}${ok ? "" : "  " + detail}`); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await puppeteer.launch({ browser: "firefox", executablePath: FF, headless: !process.env.SHOW });
await browser.installExtension(resolve("dist/firefox-test"));
await sleep(2500);
const page = await browser.newPage();
await page.goto(base + "/bridge");
await sleep(500);
const t = (cmd) => page.evaluate((c) => new Promise((res) => {
  const on = (e) => { if (e.data?.tabsteadResult !== undefined) { removeEventListener("message", on); res(e.data.tabsteadResult); } };
  addEventListener("message", on); postMessage({ tabsteadTest: c }, "*");
}), cmd);
await t({ do: "open", url: base + "/a" });

// The sidebar page, in a pinned tab so it stays on view in every workspace
const sb = await browser.newPage();
await sb.goto(base + "/sidebar");
await sb.evaluate(() => call({ do: "pinMe" }));
await sb.waitForSelector("#list li", { timeout: 10000 });
const names = () => sb.$$eval("#list > li", (ls) => ls.map((l) => (l.querySelector(".name")?.textContent ?? "") + (l.classList.contains("current") ? "*" : "")));
const clickText = async (sel, text) => { for (const b of await sb.$$(sel)) if ((await b.evaluate((e) => e.textContent)) === text) return b.click(); throw new Error("no button " + text); };
const vis = (sel) => sb.$eval(sel, (e) => !e.hidden && e.offsetParent !== null);

// First open: the guide shows, with "Don't show this again" already ticked
check("first open: the guide shows", await vis("#guide"));
check("first open: 'Don't show this again' is ticked", await sb.$eval("#guide-hide", (e) => e.checked));
await sb.click("#guide-close"); await sleep(300);
check("Got it closes the guide", !(await vis("#guide")));
await sb.reload(); await sb.waitForSelector("#list li"); await sleep(300);
check("the guide stays away after reopening", !(await vis("#guide")));
await sb.click("#help"); await sleep(200);
check("the ? button brings the guide back", await vis("#guide"));
await sb.click("#guide-close"); await sleep(200);

// New workspace, typed in place
check("starts with Main shown", JSON.stringify(await names()) === JSON.stringify(["Main*"]), JSON.stringify(await names()));
await sb.click("#add"); await sleep(200);
check("+ New opens a name box", await vis("#new"));
await sb.type("#new-name", "Work"); await sb.keyboard.press("Enter"); await sleep(800);
check("Enter makes Work and switches to it", JSON.stringify(await names()) === JSON.stringify(["Main", "Work*"]), JSON.stringify(await names()));
let s = await t({ do: "state" });
check("Main's tab is hidden, not closed", s.some((x) => x.url?.endsWith("/a") && x.hidden));
await sb.click("#add"); await sleep(200); await sb.type("#new-name", "Junk"); await sb.click("#new-cancel"); await sleep(400);
check("Cancel makes nothing", (await names()).length === 2, JSON.stringify(await names()));

// Switch with a click
await sb.click("#list > li:nth-child(1)"); await sleep(800);
check("clicking Main switches back", JSON.stringify(await names()) === JSON.stringify(["Main*", "Work"]), JSON.stringify(await names()));
s = await t({ do: "state" });
check("Main's tab is shown again", s.some((x) => x.url?.endsWith("/a") && !x.hidden));

// Rename with a double-click, Escape cancels, Enter saves
await sb.click("#list > li:nth-child(2) .name", { count: 2 }); await sleep(300);
check("double-click opens a rename box", !!(await sb.$("#list input.rename")));
await sb.keyboard.press("Escape"); await sleep(300);
check("Escape keeps the name (the double-click also switched to it, as a click does)", JSON.stringify(await names()) === JSON.stringify(["Main", "Work*"]), JSON.stringify(await names()));
await sb.click("#list > li:nth-child(2) .name", { count: 2 }); await sleep(300);
await sb.keyboard.down("Control"); await sb.keyboard.press("a"); await sb.keyboard.up("Control");
await sb.type("#list input.rename", "Office"); await sb.keyboard.press("Enter"); await sleep(600);
check("Enter saves the new name", JSON.stringify(await names()) === JSON.stringify(["Main", "Office*"]), JSON.stringify(await names()));
await sb.click("#list > li:nth-child(1)"); await sleep(800);

// Delete asks in place; Cancel keeps it; Delete moves its tabs and closes none
const before = (await t({ do: "state" })).length;
await sb.click("#list > li:nth-child(2) .more"); await sleep(300); await clickText("#list li.ask button", "Delete"); await sleep(300);
const ask = await sb.$eval("#list li.ask", (e) => e.textContent).catch(() => "");
check("delete asks in place and says nothing is closed", /Nothing is closed/.test(ask) && /Main/.test(ask), ask);
await clickText("#list li.ask button", "Cancel"); await sleep(300);
check("Cancel keeps the workspace", (await names()).length === 2);
await sb.click("#list > li:nth-child(2) .more"); await sleep(300); await clickText("#list li.ask button", "Delete"); await sleep(300);
await sb.click("#list li.ask button.danger"); await sleep(800);
check("Delete removes it", JSON.stringify(await names()) === JSON.stringify(["Main*"]), JSON.stringify(await names()));
check("no tab was closed by the delete", (await t({ do: "state" })).length === before);
await sb.click("#list > li .more"); await sleep(300);
check("the only workspace's menu has no Delete", !(await sb.$$eval("#list li.ask button", (bs) => bs.some((b) => b.textContent === "Delete" && !b.hidden))));
await clickText("#list li.ask button", "Cancel"); await sleep(300);

// Colour: clicking the dot changes it, and doesn't switch
const colorOf = () => sb.$eval("#list > li:nth-child(1) .dot", (e) => e.style.background);
const c0 = await colorOf();
await sb.click("#list > li:nth-child(1) .dot"); await sleep(500);
check("clicking the dot changes the colour", (await colorOf()) !== c0);

// Keyboard: Enter on a focused workspace switches, F2 renames
await sb.click("#add"); await sb.type("#new-name", "Keys"); await sb.keyboard.press("Enter"); await sleep(800);
await sb.focus("#list > li:nth-child(1)"); await sb.keyboard.press("Enter"); await sleep(800);
check("Enter on a workspace switches to it", JSON.stringify(await names()) === JSON.stringify(["Main*", "Keys"]), JSON.stringify(await names()));
await sb.focus("#list > li:nth-child(2)"); await sb.keyboard.press("F2"); await sleep(300);
check("F2 opens rename", !!(await sb.$("#list input.rename")));
await sb.keyboard.press("Escape"); await sleep(300);
await sb.focus("#list > li:nth-child(2)"); await sb.keyboard.down("Alt"); await sb.keyboard.press("ArrowUp"); await sb.keyboard.up("Alt"); await sleep(600);
check("Alt+Up moves a workspace up the list", JSON.stringify(await names()) === JSON.stringify(["Keys", "Main*"]), JSON.stringify(await names()));

// Search: a tab hidden in Keys is found by its title; Enter goes there
await sb.click("#list > li:nth-child(1)"); await sleep(600);
await t({ do: "open", url: base + "/findme-zebra", active: true }); await sleep(500);
await sb.click("#list > li:nth-child(2)"); await sleep(800);
await sb.type("#search", "zebra"); await sleep(700);
const found = await sb.$$eval("#results li.result", (ls) => ls.map((l) => l.textContent));
check("search lists the hidden tab with its workspace", found.length === 1 && /Keys/.test(found[0]), JSON.stringify(found));
check("while searching the workspace list is out of the way", !(await vis("#list")));
await sb.keyboard.press("Enter"); await sleep(1000);
check("Enter goes to it: Keys is shown", JSON.stringify(await names()) === JSON.stringify(["Keys*", "Main"]), JSON.stringify(await names()));
check("the search box empties after going", (await sb.$eval("#search", (e) => e.value)) === "" && (await vis("#list")));
await sb.type("#search", "nothing-has-this"); await sleep(2500); // the test page is a background tab here, where Firefox slows timers
check("no match says so", /No tab has those words/.test(await sb.$eval("#results", (e) => e.textContent)), JSON.stringify([await sb.$eval("#search", (e) => e.value), await sb.$eval("#results", (e) => e.textContent + " hidden=" + e.hidden)]));
await sb.keyboard.press("Escape"); await sleep(300);
check("Escape clears the search", (await vis("#list")));

// Backups panel: back up, save a file with the date and time, restore puts back a closed tab
await sb.click("#backups-toggle"); await sleep(400);
check("Backups opens", await vis("#backups"));
check("an empty list says when restore points are made", /every 30 minutes/.test(await sb.$eval("#backup-list", (e) => e.textContent)));
await sb.click("#backup-now"); await sleep(800);
check("Back up now adds a restore point", (await sb.$$("#backup-list li.backup")).length === 1);
await sb.click("#backup-save"); await sleep(600);
const file = await sb.evaluate(() => saved[0]);
check("Save to a file: the name has the date and time", /^tabstead-backup-\d{4}-\d\d-\d\d-\d{4}\.json$/.test(file?.name ?? ""), file?.name);
check("Save to a file: it is a Tabstead backup", JSON.parse(file.text).app === "tabstead");
const zebra = (await t({ do: "state" })).find((x) => x.url?.endsWith("/findme-zebra"));
await t({ do: "close", ids: [zebra.id] }); await sleep(500);
await sb.click("#backup-list li.backup button"); await sleep(1500);
check("Restore says what it did", /Added 1 tab/.test(await sb.$eval("#backup-msg", (e) => e.textContent)), await sb.$eval("#backup-msg", (e) => e.textContent));
check("the closed tab is back", (await t({ do: "state" })).some((x) => x.url?.endsWith("/findme-zebra")));
await sb.click("#backup-list li.backup button"); await sleep(1500);
check("Restore again: nothing was missing", /Nothing was missing/.test(await sb.$eval("#backup-msg", (e) => e.textContent)), await sb.$eval("#backup-msg", (e) => e.textContent));

// Import a Simple Tab Groups file through the file picker
const { writeFileSync: wf } = await import("node:fs");
const stgPath = resolve("E:/postbarrel/tmp/stg-backup-test.json");
wf(stgPath, JSON.stringify({ version: "5.3.1", groups: [{ id: 1, title: "Imported", tabs: [{ url: base + "/imp1", title: "I1" }, { url: "file:///c:/secret.txt", title: "F" }] }] }));
const input = await sb.$("#backup-file");
await input.uploadFile(stgPath); await sleep(2000);
check("importing an STG file says what it did", /Added 1 tab, 1 new workspace, 1 Firefox won't let an add-on open/.test(await sb.$eval("#backup-msg", (e) => e.textContent)), await sb.$eval("#backup-msg", (e) => e.textContent));
await sleep(500);
check("the imported workspace is in the list", (await names()).includes("Imported"), JSON.stringify(await names()));

// The notes: tabs brought back at start-up, and a closed window
await t({ do: "storageSet", value: { notice: { kind: "window", count: 3, at: Date.now() } } });
await sb.evaluate(() => document.querySelector("#search").dispatchEvent(new Event("input")));
await sb.reload(); await sb.waitForSelector("#list li"); await sleep(500);
check("a closed window's note shows with Bring it back", /3 hidden tabs/.test(await sb.$eval("#notice", (e) => e.textContent)) && (await vis("#notice")));
await sb.click("#notice button:not(.primary)"); await sleep(500);
check("OK dismisses the note", !(await vis("#notice")));

console.log(failed ? `\n${failed} of ${n} failed` : `\nall ${n} passed`);
await browser.close(); server.close();
process.exit(failed ? 1 : 0);
