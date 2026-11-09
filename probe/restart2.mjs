// A real restart: the probe is installed in the profile for good, Firefox runs on its own (no remote control),
// is stopped (hard, like a crash or power cut, by default) and started again, and the add-on reports each time.
import http from "node:http";
import { spawn, execSync } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
const FF = "E:/postbarrel/tools/firefox-dev/core/firefox.exe";
const profile = "E:/postbarrel/tmp/tabstead-real-profile";
const graceful = process.argv.includes("--graceful");
rmSync(profile, { recursive: true, force: true }); mkdirSync(profile + "/extensions", { recursive: true });
writeFileSync(profile + "/user.js", [
  ['xpinstall.signatures.required', false], ['extensions.autoDisableScopes', 0], ['extensions.enabledScopes', 15],
  ['browser.startup.page', 3], ['browser.sessionstore.resume_from_crash', true], ['browser.sessionstore.max_resumed_crashes', 5],
  ['browser.sessionstore.interval', 1000], ['browser.shell.checkDefaultBrowser', false], ['browser.aboutwelcome.enabled', false],
  ['startup.homepage_welcome_url', ''], ['startup.homepage_override_url', ''], ['browser.startup.homepage_override.mstone', 'ignore'],
  ['datareporting.policy.dataSubmissionEnabled', false], ['toolkit.telemetry.reportingpolicy.firstRun', false],
].map(([k, v]) => `user_pref("${k}", ${JSON.stringify(v)});`).join("\n"));
execSync(`C:/Windows/System32/tar.exe --format zip -c -f "${profile}/extensions/tabstead-restart-probe@lagudafuadtosin.xpi" manifest.json bg.js`, { cwd: resolve("ext2") });

const got = [];
let waiter = null;
http.createServer((q, r) => {
  if (q.method === "POST") { let b = ""; q.on("data", (c) => (b += c)); q.on("end", () => { got.push(JSON.parse(b)); waiter?.(); r.end(graceful ? "close" : "ok"); }); }
  else { r.setHeader("content-type", "text/html"); r.end("<!doctype html><title>" + q.url + "</title>page " + q.url); }
}).listen(8789, "127.0.0.1");
const nextReport = (ms) => new Promise((res, rej) => { const t = setTimeout(() => rej(new Error("no report")), ms); waiter = () => { clearTimeout(t); res(got.at(-1)); }; });
const start = () => spawn(FF, ["-profile", profile, "-no-remote", "-headless"], { stdio: "ignore" });
const stop = (p) => new Promise((res) => { p.once("exit", res); if (!graceful) p.kill("SIGKILL"); setTimeout(() => { if (graceful) console.log("  (Firefox did not quit by itself in 30 s, forced)"); try { execSync(`taskkill /F /PID ${p.pid} /T`, { stdio: "ignore" }); } catch {} res(); }, 30000); });

let ff = start();
console.log(JSON.stringify(await nextReport(60000)));
await new Promise((r) => setTimeout(r, 3000));
await stop(ff);
for (let i = 1; i <= 2; i++) {
  ff = start();
  try { console.log(JSON.stringify(await nextReport(60000))); } catch (e) { console.log("restart " + i + ": " + e.message); }
  await new Promise((r) => setTimeout(r, 3000));
  await stop(ff);
}
process.exit(0);
