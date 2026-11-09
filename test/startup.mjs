// Firefox set NOT to reopen the last session (Firefox's own default for many people): every restart starts with fresh
// tabs, and Tabstead's live copy must bring every workspace back, with its groups, hidden where they belong, and never
// doubled. Then the same profile with session restore turned on: Firefox restores, Tabstead adds nothing.
// Firefox Developer Edition with Tabstead installed for good, killed hard between runs. GRACEFUL=1 quits Firefox the
// normal way instead (closing its window), which needs a visible window for a few seconds.
const GRACEFUL = !!process.env.GRACEFUL;
import http from "node:http";
import { spawn, execSync } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync, appendFileSync } from "node:fs";
import { resolve } from "node:path";

const FF = process.env.FIREFOX_DEV ?? "E:/postbarrel/tools/firefox-dev/core/firefox.exe";
const profile = "E:/postbarrel/tmp/tabstead-startup-profile";
rmSync(profile, { recursive: true, force: true }); mkdirSync(profile + "/extensions", { recursive: true });
const prefs = (restore) => [
  ["xpinstall.signatures.required", false], ["extensions.autoDisableScopes", 0], ["extensions.enabledScopes", 15],
  ["browser.startup.page", restore ? 3 : 1], ["browser.startup.homepage", "about:blank"],
  ["browser.sessionstore.resume_from_crash", restore], ["browser.sessionstore.max_resumed_crashes", restore ? 50 : 0],
  ["browser.sessionstore.interval", 1000], ["browser.shell.checkDefaultBrowser", false], ["browser.aboutwelcome.enabled", false],
  ["startup.homepage_welcome_url", ""], ["startup.homepage_override_url", ""], ["browser.startup.homepage_override.mstone", "ignore"],
  ["datareporting.policy.dataSubmissionEnabled", false], ["toolkit.telemetry.reportingpolicy.firstRun", false],
  ["browser.tabs.warnOnClose", false], ["browser.warnOnQuit", false], ["browser.warnOnQuitShortcut", false],
].map(([k, v]) => `user_pref("${k}", ${JSON.stringify(v)});`).join("\n");
writeFileSync(profile + "/user.js", prefs(false));
execSync(`C:/Windows/System32/tar.exe --format zip -c -f "${profile}/extensions/tabstead@lagudafuadtosin.xpi" *`, { cwd: resolve("dist/firefox-test"), shell: "cmd.exe" });

const PAGE = (step) => `<!doctype html><title>runner</title><script>
let seq = 0;
const t = (c) => new Promise((res) => { const id = ++seq; const on = (e) => { if (e.data && e.data.tabsteadResult !== undefined && e.data.id === id) { removeEventListener("message", on); res(e.data.tabsteadResult); } }; addEventListener("message", on); postMessage({ tabsteadTest: c, id }, "*"); });
const post = (data) => fetch("/report", { method: "POST", body: JSON.stringify(data) });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
(async () => {
  await sleep(9000); // start-up repair and recovery run first
  if (${JSON.stringify(step)} === "setup") {
    const a = await t({ do: "open", url: location.origin + "/a" }), b = await t({ do: "open", url: location.origin + "/b" });
    await t({ do: "group", tabIds: [a, b], title: "Research" });
    await t({ do: "create", name: "Work" });
    const w1 = await t({ do: "open", url: location.origin + "/w1", active: true });
    await t({ do: "open", url: location.origin + "/w2" });
    await t({ do: "create", name: "Empty" });
    await t({ do: "switch", id: (await t({ do: "overview" })).workspaces[1].id });
    await sleep(3000);
  }
  post({ overview: await t({ do: "overview" }), state: await t({ do: "state" }), groups: await t({ do: "groups" }) });
})();
</script>`;

const reports = [];
let waiter = null;
const server = http.createServer((q, r) => {
  if (q.method === "POST") { let b = ""; q.on("data", (c) => (b += c)); q.on("end", () => { reports.push(JSON.parse(b)); waiter?.(); r.end("ok"); }); return; }
  r.setHeader("content-type", "text/html");
  const m = /^\/run\/(.+)$/.exec(q.url);
  r.end(m ? PAGE(m[1]) : `<!doctype html><title>${q.url}</title>${q.url}`);
});
await new Promise((r) => server.listen(8791, "127.0.0.1", r));
const next = (ms) => new Promise((res, rej) => { const tm = setTimeout(() => rej(new Error("no report")), ms); waiter = () => { clearTimeout(tm); res(reports.at(-1)); }; });
const start = (step) => spawn(FF, ["-profile", profile, "-no-remote", ...(GRACEFUL ? [] : ["-headless"]), `http://127.0.0.1:8791/run/${step}`], { stdio: "ignore" });
// Firefox's first process can hand over to the real browser and exit, so the browser is found by its profile
const ps = (cmd) => execSync(`powershell -NoProfile -Command "${cmd}"`, { encoding: "utf8" }).trim();
const browserPids = () => ps(`Get-CimInstance Win32_Process | Where-Object { $_.Name -eq 'firefox.exe' -and $_.CommandLine -like '*tabstead-startup-profile*' -and $_.CommandLine -notlike '*-contentproc*' } | ForEach-Object { $_.ProcessId }`).split(/\s+/).filter(Boolean);
const anyLeft = () => ps(`@(Get-CimInstance Win32_Process | Where-Object { $_.Name -eq 'firefox.exe' -and $_.CommandLine -like '*tabstead-startup-profile*' }).Count`) !== "0";
async function kill() {
  if (GRACEFUL) {
    // Closing the window, as a person does: Firefox writes its session and quits
    for (const pid of browserPids()) { try { execSync(`taskkill /PID ${pid}`, { stdio: "ignore" }); } catch {} }
    for (let i = 0; i < 40 && anyLeft(); i++) await sleep(500);
    if (!anyLeft()) { console.log("  (Firefox quit normally)"); return; }
    console.log("  (Firefox did not quit in 20 s, forced)");
  }
  for (const pid of browserPids()) { try { execSync(`taskkill /F /PID ${pid} /T`, { stdio: "ignore" }); } catch {} }
  for (let i = 0; i < 20 && anyLeft(); i++) await sleep(500);
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let failed = 0, n = 0;
const check = (name, ok, detail = "") => { n++; if (!ok) failed++; console.log(`${ok ? "✔" : "✘ FAIL"} ${name}${ok ? "" : "  " + detail}`); };
const ours = (st) => st.filter((x) => /\/(a|b|w1|w2)$/.test(x.url || ""));
const shape = (r) => {
  const names = Object.fromEntries(r.overview.workspaces.map((w) => [w.id, w.name]));
  return Object.fromEntries(ours(r.state).map((x) => [x.url.split("/").pop(), names[x.ws]]).sort());
};
const consistent = (r) => {
  const bad = [];
  for (const win of new Set(r.state.map((x) => x.windowId))) {
    const mine = r.state.filter((x) => x.windowId === win);
    const act = mine.filter((x) => x.active);
    if (act.length !== 1 || act[0].hidden) bad.push("active");
    const shown = new Set(mine.filter((x) => !x.hidden && !x.pinned && x.ws).map((x) => x.ws));
    if (shown.size > 1) bad.push("two workspaces shown: " + [...shown].join());
  }
  return bad.join("; ");
};
const grouped = (r) => { const s = ours(r.state); const a = s.find((x) => x.url.endsWith("/a")), b = s.find((x) => x.url.endsWith("/b")); if (!a || !b) return false;
  // A put-away workspace's tabs remember their group; a shown one's are in it
  if (a.grp && b.grp) return a.grp.key === b.grp.key && a.grp.title === "Research" && !r.groups.some((g) => g.title === "Research");
  return a.groupId !== -1 && a.groupId === b.groupId && r.groups.some((g) => g.id === a.groupId && g.title === "Research"); };

let ff = start("setup");
const setup = await next(120000);
const want = shape(setup);
check("setup: 4 tabs over Main and Work, a group, an empty workspace", JSON.stringify(want) === JSON.stringify({ a: "Main", b: "Main", w1: "Work", w2: "Work" }) && setup.overview.workspaces.length === 3 && grouped(setup), JSON.stringify(want));
await kill();

for (let i = 1; i <= 3; i++) {
  ff = start("check");
  let r;
  try { r = await next(120000); } catch (e) { check(`restart ${i} without session restore: Tabstead answered`, false, e.message); await kill(); continue; }
  check(`restart ${i} without session restore: every tab back in its workspace, none doubled`, JSON.stringify(shape(r)) === JSON.stringify(want) && ours(r.state).length === 4, JSON.stringify(shape(r)) + " " + ours(r.state).length);
  check(`restart ${i}: the group is back with its name`, grouped(r), JSON.stringify(r.groups));
  check(`restart ${i}: the window shows one workspace`, consistent(r) === "", consistent(r));
  check(`restart ${i}: all 3 workspaces kept`, r.overview.workspaces.length === 3);
  // The 4 tabs plus the first run's own page (a real tab then); the page this run opened is not opened twice
  check(`restart ${i}: the sidebar says what came back, the same each time (no tab piling up)`, r.overview.notice?.kind === "startup" && r.overview.notice.count === 5, JSON.stringify(r.overview.notice));
  check(`restart ${i}: the start page is open once`, r.state.filter((x) => (x.url || "").endsWith("/run/check")).length === 1, String(r.state.filter((x) => (x.url || "").endsWith("/run/check")).length));
  await sleep(2500);
  await kill();
}

// Session restore on: Firefox brings the tabs back itself; Tabstead must add nothing
appendFileSync(profile + "/user.js", "\n" + prefs(true));
ff = start("check"); await next(120000); await sleep(3000); await kill(); // first start with restore on (the last run was a kill)
for (let i = 1; i <= 2; i++) {
  ff = start("check");
  const r = await next(120000);
  check(`restart ${i} with session restore: nothing doubled`, ours(r.state).length === 4 && JSON.stringify(shape(r)) === JSON.stringify(want), JSON.stringify(shape(r)) + " " + ours(r.state).length);
  check(`restart ${i} with session restore: one workspace shown`, consistent(r) === "", consistent(r));
  await sleep(2500);
  await kill();
}

console.log(failed ? `\n${failed} of ${n} failed` : `\nall ${n} passed`);
server.close();
process.exit(failed ? 1 : 0);
