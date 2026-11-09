// Probe: closing the active tab in one workspace, with other workspaces' hidden tabs next to it. Which workspace shows after?
import puppeteer from "puppeteer-core";
import http from "node:http";
import { resolve } from "node:path";
const server = http.createServer((q, r) => { r.setHeader("content-type", "text/html"); r.end(`<!doctype html><title>${q.url}</title>${q.url}`); });
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const base = `http://127.0.0.1:${server.address().port}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await puppeteer.launch({ browser: "firefox", executablePath: "C:/Program Files/Mozilla Firefox/firefox.exe", headless: true });
await browser.installExtension(resolve("dist/firefox-test"));
await sleep(2500);
const first = (await browser.pages())[0];
const page = await browser.newPage(); await page.goto(base + "/bridge"); await sleep(500);
await first.close();
let seq = 0;
const t = (c) => page.evaluate((c, id) => new Promise((res) => { const on = (e) => { if (e.data?.tabsteadResult !== undefined && e.data.id === id) { removeEventListener("message", on); res(e.data.tabsteadResult); } }; addEventListener("message", on); postMessage({ tabsteadTest: c, id }, "*"); }), c, ++seq);
const idle = async (ms = 800) => { await sleep(ms); await t({ do: "idle" }); };
let o = await t({ do: "overview" });
const work = o.workspaces[0].id;
const a = await t({ do: "open", url: base + "/a" });
const b = await t({ do: "open", url: base + "/b" });
o = await t({ do: "create", name: "Trip" });
const trip = o.current;
await t({ do: "open", url: base + "/c", active: true });
await t({ do: "open", url: base + "/d" });
await t({ do: "switch", id: work });
await idle();
for (const [name, target] of [["last Work tab, hidden Trip tabs after it", b], ["the bridge-like first tab", a]]) {
  await t({ do: "activate", tabId: target });
  await idle(400);
  await t({ do: "close", ids: [target] });
  await idle(1500);
  o = await t({ do: "overview" });
  const s = await t({ do: "state" });
  console.log(`${name}: now showing ${o.current === work ? "Work" : o.current === trip ? "TRIP" : o.current}; visible: ${s.filter((x) => !x.hidden).map((x) => x.url.replace(base, "")).join(", ")}`);
}
await browser.close(); server.close(); process.exit(0);
