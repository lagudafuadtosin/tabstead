// Probe: does Firefox suspend the background in the middle of a long piece of work, with or without API calls?
import puppeteer from "puppeteer-core";
import http from "node:http";
import { resolve } from "node:path";
const FF = process.env.FIREFOX ?? "C:/Program Files/Mozilla Firefox/firefox.exe";
const server = http.createServer((q, r) => { r.setHeader("content-type", "text/html"); r.end("x"); });
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const base = `http://127.0.0.1:${server.address().port}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await puppeteer.launch({ browser: "firefox", executablePath: FF, headless: true, extraPrefsFirefox: { "extensions.background.idle.timeout": 2000 } });
await browser.installExtension(resolve("dist/firefox-test"));
await sleep(2500);
const page = await browser.newPage(); await page.goto(base + "/bridge"); await sleep(500);
let seq = 0;
const t = (c) => page.evaluate((c, id) => new Promise((res) => { const on = (e) => { if (e.data?.tabsteadResult !== undefined && e.data.id === id) { removeEventListener("message", on); res(e.data.tabsteadResult); } }; addEventListener("message", on); postMessage({ tabsteadTest: c, id }, "*"); }), c, ++seq);
for (const [api, pure] of [[false, true], [false, false]]) {
  await t({ do: "storageSet", value: {} });
  const b = await t({ do: "spin", n: 16, api, pure });
  await sleep(10000);
  const s = await t({ do: "spinState" });
  console.log(`pure timers ${pure}: spun ${s.spin} of 16 in 10 s, same background ${s.boot === b}`);
  await sleep(4000);
}
await browser.close(); server.close();
