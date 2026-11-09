import puppeteer from "puppeteer-core";
import http from "node:http";
import { resolve } from "node:path";
const server = http.createServer((q, r) => { r.setHeader("content-type", "text/html"); r.end(`<!doctype html><title>${q.url}</title>${q.url}`); });
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const base = `http://127.0.0.1:${server.address().port}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await puppeteer.launch({ browser: "firefox", executablePath: process.env.FIREFOX ?? "C:/Program Files/Mozilla Firefox/firefox.exe", headless: true,
  extraPrefsFirefox: { "browser.sessionstore.max_tabs_undo": 25, "browser.sessionstore.max_windows_undo": 3 } });
await browser.installExtension(resolve("probe/ext3"));
await sleep(1000);
const page = await browser.newPage(); await page.goto(base + "/bridge"); await sleep(400);
const p = (c) => page.evaluate((c) => new Promise((res) => { const on = (e) => { if (e.data?.r !== undefined) { removeEventListener("message", on); res(e.data.r); } }; addEventListener("message", on); postMessage({ p: c }, "*"); }), c);
const a = await p({ do: "open", url: base + "/a" }); await p({ do: "tag", id: a, v: "A" }); await sleep(1500); await p({ do: "log" });
await p({ do: "close", ids: [a] }); await sleep(800);
console.log("undo tab:", await p({ do: "undo" }), JSON.stringify(await p({ do: "log" })));
const d = await p({ do: "open", url: base + "/d" }); await p({ do: "tag", id: d, v: "D" }); await sleep(300); await p({ do: "log" });
const dup = await p({ do: "dup", id: d }); console.log("dup:", JSON.stringify(await p({ do: "log" })));
const w = await p({ do: "newwin", urls: [base + "/w1", base + "/w2"] }); await sleep(1000);
for (const [i, t] of w.tabs.entries()) await p({ do: "tag", id: t, v: "W" + i });
await p({ do: "hide", ids: [w.tabs[1]] }); await p({ do: "wtag", id: w.id, v: "WIN" }); await sleep(1500); await p({ do: "log" });
await p({ do: "closewin", id: w.id }); await sleep(800);
console.log("undo window:", await p({ do: "undo" }), JSON.stringify(await p({ do: "log" })));
// Activating a hidden tab
const h = await p({ do: "open", url: base + "/h" }); await p({ do: "hide", ids: [h] }); await sleep(300); await p({ do: "log" });
console.log("activate hidden:", JSON.stringify(await p({ do: "activate", id: h })), JSON.stringify(await p({ do: "log" })));
await browser.close(); server.close();
