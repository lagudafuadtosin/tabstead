// Opens a visible Firefox Developer Edition with Tabstead and three sample workspaces, to try it by hand (and for store
// screenshots). Stays open until the window is closed.
import puppeteer from "puppeteer-core";
import http from "node:http";
import { resolve } from "node:path";

const FF = process.env.FIREFOX_DEV ?? "E:/postbarrel/tools/firefox-dev/core/firefox.exe";
const server = http.createServer((q, r) => { r.setHeader("content-type", "text/html"); r.end("<!doctype html><title>setting up</title>Setting up Tabstead..."); });
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await puppeteer.launch({ browser: "firefox", executablePath: FF, headless: false, protocolTimeout: 600000,
  defaultViewport: null, extraPrefsFirefox: { "browser.aboutwelcome.enabled": false, "sidebar.revamp": true } });
await browser.installExtension(resolve("dist/firefox-test"));
await sleep(2500);
const first = (await browser.pages())[0];
const page = await browser.newPage();
await page.goto(`http://127.0.0.1:${server.address().port}/bridge`);
await sleep(500);
let seq = 0;
const t = (c) => page.evaluate((c, id) => new Promise((res) => { const on = (e) => { if (e.data?.tabsteadResult !== undefined && e.data.id === id) { removeEventListener("message", on); res(e.data.tabsteadResult); } }; addEventListener("message", on); postMessage({ tabsteadTest: c, id }, "*"); }), c, ++seq);

let o = await t({ do: "overview" });
const work = o.workspaces[0].id;
await t({ do: "rename", id: work, name: "Work" });
await t({ do: "recolor", id: work, color: "blue" });
await t({ do: "open", url: "https://github.com/", active: true });
const d1 = await t({ do: "open", url: "https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions" });
const d2 = await t({ do: "open", url: "https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/API/tabs/hide" });
await t({ do: "group", tabIds: [d1, d2], title: "Docs" });
await t({ do: "open", url: "https://news.ycombinator.com/" });

o = await t({ do: "create", name: "Reading" });
await t({ do: "recolor", id: o.current, color: "green" });
await t({ do: "open", url: "https://en.wikipedia.org/wiki/Stirling", active: true });
await t({ do: "open", url: "https://www.bbc.co.uk/news" });
const r1 = await t({ do: "open", url: "https://en.wikipedia.org/wiki/Real_Madrid_CF" });
const r2 = await t({ do: "open", url: "https://en.wikipedia.org/wiki/Anime" });
await t({ do: "group", tabIds: [r1, r2], title: "Later" });

o = await t({ do: "create", name: "Project" });
await t({ do: "recolor", id: o.current, color: "orange" });
await t({ do: "open", url: "https://addons.mozilla.org/en-GB/firefox/", active: true });
await t({ do: "open", url: "https://www.mozilla.org/en-GB/firefox/developer/" });

await t({ do: "switch", id: work });
await sleep(800);
await first.close().catch(() => {});
await page.close().catch(() => {});
console.log("ready: press Alt+Shift+W for the sidebar");
await new Promise((r) => browser.once("disconnected", r));
server.close();
process.exit(0);
