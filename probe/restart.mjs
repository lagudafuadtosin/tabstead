import puppeteer from "puppeteer-core";
import http from "node:http";
import { resolve } from "node:path";
import { rmSync, mkdirSync } from "node:fs";
const server = http.createServer((q, r) => { r.setHeader("content-type", "text/html"); r.end("<!doctype html><title>" + q.url + "</title>" + q.url); }).listen(0);
const port = server.address().port, url = `http://localhost:${port}/bridge`;
const profile = "E:/postbarrel/tmp/tabstead-profile";
rmSync(profile, { recursive: true, force: true }); mkdirSync(profile, { recursive: true });
// Firefox restores the last session on start, and keeps add-ons installed in the profile
const prefs = { "browser.startup.page": 3, "browser.sessionstore.resume_from_crash": true, "xpinstall.signatures.required": false };
const ask = async (browser, msg) => { const p = await browser.newPage(); await p.goto(url); await new Promise((r) => setTimeout(r, 600)); const v = await p.evaluate((m) => new Promise((res) => { addEventListener("message", (e) => e.data?.probeResult !== undefined && res(e.data.probeResult)); postMessage(m, "*"); }), msg); await p.close(); return v; };

let b = await puppeteer.launch({ browser: "firefox", executablePath: "C:/Program Files/Mozilla Firefox/firefox.exe", headless: true, userDataDir: profile, extraPrefsFirefox: prefs });
await b.installExtension(resolve("ext"));
await new Promise((r) => setTimeout(r, 1500));
console.log("setup:", await ask(b, { probe: "setup", port }));
console.log("before restart:", JSON.stringify(await ask(b, { probe: "check" })));
await new Promise((r) => setTimeout(r, 3000)); // let the session store write
await b.close();

b = await puppeteer.launch({ browser: "firefox", executablePath: "C:/Program Files/Mozilla Firefox/firefox.exe", headless: true, userDataDir: profile, extraPrefsFirefox: prefs });
await new Promise((r) => setTimeout(r, 4000));
console.log("pages restored by Firefox:", (await b.pages()).map((p) => p.url()).filter((u) => /\/(a|b|c)$/.test(u)).map((u) => u.slice(-2)));
await b.installExtension(resolve("ext"));
await new Promise((r) => setTimeout(r, 2000));
try { console.log("after restart:", JSON.stringify(await ask(b, { probe: "check" }))); } catch (e) { console.log("after restart: no answer (add-on not loaded after restart?)", e.message); }
await b.close(); server.close();
