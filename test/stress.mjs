// The main claim, drilled in a real Firefox: thousands of things a person does, with Firefox killed hard and started
// again every so often (sometimes with session restore on, sometimes off, so Tabstead's own copy has to bring things
// back). After every step: every tab that should exist exists exactly once, in the workspace it should be in, and the
// window shows exactly one workspace.
// Firefox Developer Edition with Tabstead installed for good. STEPS (default 300) and RESTARTS (default 6) set the size.
import http from "node:http";
import { spawn, execSync } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const FF = process.env.FIREFOX_DEV ?? "E:/postbarrel/tools/firefox-dev/core/firefox.exe";
const profile = "E:/postbarrel/tmp/tabstead-stress-profile";
const STEPS = Number(process.env.STEPS ?? 300);
const RESTARTS = Number(process.env.RESTARTS ?? 6);
let seed = Number(process.env.SEED ?? 20261108);
const rnd = (k) => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed % k; };
const pick = (a) => a[rnd(a.length)];

rmSync(profile, { recursive: true, force: true }); mkdirSync(profile + "/extensions", { recursive: true });
const prefs = (restore) => [
  ["xpinstall.signatures.required", false], ["extensions.autoDisableScopes", 0], ["extensions.enabledScopes", 15],
  ["browser.startup.page", restore ? 3 : 1], ["browser.startup.homepage", "about:blank"],
  ["browser.sessionstore.resume_from_crash", restore], ["browser.sessionstore.max_resumed_crashes", restore ? 1000 : 0],
  ["browser.sessionstore.interval", 1000], ["browser.sessionstore.max_tabs_undo", 25], ["browser.shell.checkDefaultBrowser", false],
  ["browser.aboutwelcome.enabled", false], ["startup.homepage_welcome_url", ""], ["startup.homepage_override_url", ""],
  ["browser.startup.homepage_override.mstone", "ignore"], ["datareporting.policy.dataSubmissionEnabled", false],
  ["toolkit.telemetry.reportingpolicy.firstRun", false], ["browser.tabs.warnOnClose", false],
  ["extensions.background.idle.timeout", Number(process.env.IDLE ?? 30000)], // IDLE=800 puts Tabstead to sleep between steps
].map(([k, v]) => `user_pref("${k}", ${JSON.stringify(v)});`).join("\n");
execSync(`C:/Windows/System32/tar.exe --format zip -c -f "${profile}/extensions/tabstead@lagudafuadtosin.xpi" *`, { cwd: resolve("dist/firefox-test"), shell: "cmd.exe" });

// ---------- A runner page in Firefox takes commands from here ----------
let gen = 0;
const RUNNER = (g) => `<!doctype html><title>runner ${g}</title><script>
let seq = 0;
const t = (c) => new Promise((res) => { const id = ++seq; const on = (e) => { if (e.data && e.data.tabsteadResult !== undefined && e.data.id === id) { removeEventListener("message", on); res(e.data.tabsteadResult); } }; addEventListener("message", on); postMessage({ tabsteadTest: c, id }, "*"); });
(async () => {
  await new Promise((r) => setTimeout(r, 5000));
  for (;;) {
    const c = await (await fetch("/next?gen=${g}")).json();
    if (c.stop) return;
    if (c.wait) continue;
    let r;
    try { r = await t(c); } catch (e) { r = { error: String(e) }; }
    await fetch("/result?gen=${g}", { method: "POST", body: JSON.stringify({ r: r === undefined ? null : r }) });
  }
})();
</script>`;
let pending = null, waitingPoll = null, resolveResult = null;
const server = http.createServer((q, r) => {
  const u = new URL(q.url, "http://x");
  const g = Number(u.searchParams.get("gen"));
  if (u.pathname === "/run") { r.setHeader("content-type", "text/html"); return r.end(g === gen ? RUNNER(g) : "<!doctype html><title>old runner</title>old"); }
  if (u.pathname === "/next") {
    if (g !== gen) return r.end(JSON.stringify({ stop: true }));
    if (pending) { const c = pending; pending = null; return r.end(JSON.stringify(c)); }
    waitingPoll = r; setTimeout(() => { if (waitingPoll === r) { waitingPoll = null; r.end(JSON.stringify({ wait: true })); } }, 10000);
    return;
  }
  if (u.pathname === "/result") { let b = ""; q.on("data", (c) => (b += c)); q.on("end", () => { r.end("ok"); if (g === gen) resolveResult?.(JSON.parse(b).r); }); return; }
  r.setHeader("content-type", "text/html"); r.end(`<!doctype html><title>${u.pathname}</title>${u.pathname}`);
});
await new Promise((r) => server.listen(8792, "127.0.0.1", r));
const base = "http://127.0.0.1:8792";
const t = (c, ms = 120000) => new Promise((res, rej) => {
  const tm = setTimeout(() => rej(new Error("no answer to " + JSON.stringify(c))), ms);
  resolveResult = (v) => { clearTimeout(tm); res(v); };
  if (waitingPoll) { const w = waitingPoll; waitingPoll = null; w.end(JSON.stringify(c)); } else pending = c;
});
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const idle = async () => { await t({ do: "idle" }); await sleep(250); await t({ do: "idle" }); };

let ff = null;
const kill = (p) => new Promise((res) => { if (!p) return res(); p.once("exit", res); try { execSync(`taskkill /F /PID ${p.pid} /T`, { stdio: "ignore" }); } catch {} setTimeout(res, 5000); });
async function launch(restore) {
  writeFileSync(profile + "/user.js", prefs(restore));
  gen++;
  pending = null; waitingPoll = null;
  ff = spawn(FF, ["-profile", profile, "-no-remote", "-headless", `${base}/run?gen=${gen}`], { stdio: "ignore" });
  await t({ do: "idle" }, 120000);
  await t({ do: "pinMe" });
  // Old runner pages that Firefox restored are not part of the test
  const old = (await t({ do: "state" })).filter((x) => (x.url || "").includes("/run?gen=") && !(x.url || "").endsWith("gen=" + gen)).map((x) => x.id);
  if (old.length) await t({ do: "close", ids: old });
  await idle();
}

// ---------- What should be true ----------
const expect = new Map(); // url -> workspace id
const isOurs = (x) => (x.url || "").includes("/s/");
let failed = 0, steps = 0, lastLog = "";
let lastState = [];
const fail = (why) => { failed++; console.log(`✘ FAIL at step ${steps} (${lastLog}): ${why}`); if (failed <= 2) console.log("   tabs now: " + lastState.map((x) => `${x.id}:${(x.url || "").replace(base, "")}:${x.ws ?? "-"}${x.hidden ? ":hidden" : ""}${x.pinned ? ":pinned" : ""}`).join("  ")); };

async function verify() {
  const s = await t({ do: "state" });
  lastState = s;
  const o = await t({ do: "overview" });
  const seen = new Map();
  for (const x of s.filter(isOurs)) seen.set(x.url, (seen.get(x.url) ?? 0) + 1);
  for (const [u, n] of seen) if (n > 1) return fail(`${u} is open ${n} times`), s;
  for (const [u, ws] of expect) {
    const x = s.find((y) => y.url === u);
    if (!x) return fail(`${u} is lost`), s;
    if (x.ws !== ws) return fail(`${u} is in ${x.ws}, should be in ${ws}`), s;
  }
  for (const u of seen.keys()) if (!expect.has(u)) return fail(`${u} is open but should not be`), s;
  const act = s.filter((x) => x.active);
  if (act.length !== 1 || act[0].hidden) return fail("active tab " + JSON.stringify(act)), s;
  for (const x of s) if (!x.pinned && x.ws && x.hidden !== (x.ws !== o.current)) return fail(`${x.url} hidden=${x.hidden} in ${x.ws}, window shows ${o.current}`), s;
  if (!o.workspaces.some((w) => w.id === o.current)) return fail("current workspace doesn't exist"), s;
  return s;
}

// ---------- Run ----------
await launch(true);
let o = await t({ do: "overview" });
let n = 0;
const open = async () => { const url = `${base}/s/${n++}`; await t({ do: "open", url, active: rnd(2) === 0 }); expect.set(url, (await t({ do: "overview" })).current); return url; };
for (let i = 0; i < 4; i++) await open();
await idle();
let s = await verify();
const restartEvery = Math.max(1, Math.floor(STEPS / (RESTARTS + 1)));
let restarts = 0;
const closed = [];
const counts = {};

while (steps < STEPS && failed < 5) {
  steps++;
  if (process.env.IDLE && !rnd(3)) { await sleep(Number(process.env.IDLE) + 1500); counts.slept = (counts.slept ?? 0) + 1; } // the next action wakes it
  o = await t({ do: "overview" });
  const mine = s.filter(isOurs);
  const vis = mine.filter((x) => !x.hidden);
  const hid = mine.filter((x) => x.hidden);
  const a = rnd(100);
  let kind;
  if (a < 22) { kind = "open"; await open(); }
  else if (a < 32 && mine.length > 3) { kind = "close"; const x = pick(rnd(3) ? vis.length ? vis : mine : mine); await t({ do: "close", ids: [x.id] }); expect.delete(x.url); closed.push(x.url); }
  else if (a < 37 && closed.length) { kind = "reopen"; await t({ do: "undoClose" }); const u = closed.pop(); expect.set(u, o.current); }
  else if (a < 52) { kind = "switch"; const w = pick(o.workspaces); await t({ do: "switch", id: w.id }); }
  else if (a < 57 && o.workspaces.length < 6) { kind = "create"; await t({ do: "create", name: "S" + steps }); }
  else if (a < 62 && hid.length) { kind = "pick hidden"; const x = pick(hid); await t({ do: "activate", tabId: x.id }); }
  else if (a < 72 && mine.length) {
    kind = "move";
    const x = pick(mine), w = pick(o.workspaces);
    await t({ do: "menuClick", tabId: x.id, item: "move:" + w.id });
    for (const y of mine) if (y.id === x.id || (x.groupId !== -1 && y.groupId === x.groupId)) expect.set(y.url, w.id);
  }
  else if (a < 78 && vis.filter((x) => x.groupId === -1).length >= 2) {
    kind = "group"; const free = vis.filter((x) => x.groupId === -1); await t({ do: "group", tabIds: [free[0].id, free[1].id], title: "G" + steps });
  }
  else if (a < 81 && o.workspaces.length > 2) {
    kind = "delete workspace";
    const w = pick(o.workspaces);
    const to = w.id === o.current ? o.workspaces.find((x) => x.id !== w.id).id : o.current;
    await t({ do: "remove", id: w.id });
    for (const [u, ws] of expect) if (ws === w.id) expect.set(u, to);
  }
  else if (a < 84) { kind = "backup and restore"; const list = await t({ do: "backupNow" }); if (list[0]) { const r = await t({ do: "restoreBackup", at: list[0].at }); if (r.added) fail("restoring a fresh backup added " + r.added); } }
  else if (a < 88 && mine.length) { kind = "search and go"; const x = pick(mine); await t({ do: "focusTab", tabId: x.id }); }
  else if (a < 92) { kind = "keyboard"; await t({ do: "step", by: rnd(2) ? 1 : -1 }); }
  else if (a < 95) { kind = "rescue"; await t({ do: "rescue" }); for (const u of expect.keys()) expect.set(u, (await t({ do: "overview" })).current); }
  else { kind = "rename"; const w = pick(o.workspaces); await t({ do: "rename", id: w.id, name: "R" + steps }); }
  counts[kind] = (counts[kind] ?? 0) + 1;
  // Only these change the workspace you are in; anything else (closing a tab above all) must leave you where you were
  if (!["switch", "create", "pick hidden", "search and go", "keyboard", "delete workspace", "rescue"].includes(kind)) {
    await idle();
    const now = (await t({ do: "overview" })).current;
    if (now !== o.current) fail(`${kind} moved the window to another workspace`);
  }
  lastLog = kind;
  await idle();
  s = await verify();

  if (steps % restartEvery === 0 && restarts < RESTARTS) {
    restarts++;
    const withRestore = restarts % 2 === 0;
    lastLog = `restart ${restarts} (session restore ${withRestore ? "on" : "off"})`;
    await sleep(2500); // the live copy is written a second after changes; Firefox writes its session every second
    await kill(ff);
    await launch(withRestore);
    closed.length = 0; // Firefox's list of closed tabs belongs to the last session
    await sleep(1500);
    await idle();
    console.log("  start-up:", JSON.stringify(await t({ do: "startInfo" })));
    s = await verify();
    console.log(`  ${lastLog}: ${failed ? "problems above" : "all " + expect.size + " tabs where they belong"}`);
  }
  if (steps % 50 === 0) console.log(`  step ${steps}: ${expect.size} tabs, ${o.workspaces.length} workspaces, ${failed} problems`);
}

console.log("  actions:", JSON.stringify(counts));
console.log(failed ? `\n✘ ${failed} problems in ${steps} steps and ${restarts} restarts` : `\nall ${steps} steps and ${restarts} restarts passed: no tab lost, moved wrongly or doubled`);
await kill(ff);
server.close();
process.exit(failed ? 1 : 0);
