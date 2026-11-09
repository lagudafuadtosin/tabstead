// Tabstead through crashes, in Firefox Developer Edition with Tabstead installed for good (the way people install it).
// A test page builds workspaces and a tab group, then Firefox is killed hard, sometimes in the middle of a switch.
// After each restart: every tab is still there with its workspace and group, and the window shows exactly its workspace.
import http from "node:http";
import { spawn, execSync } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const FF = process.env.FIREFOX_DEV ?? "E:/postbarrel/tools/firefox-dev/core/firefox.exe";
const profile = "E:/postbarrel/tmp/tabstead-restart-profile";
const ROUNDS = Number(process.env.ROUNDS ?? 5);
rmSync(profile, { recursive: true, force: true }); mkdirSync(profile + "/extensions", { recursive: true });
writeFileSync(profile + "/user.js", [
  ["xpinstall.signatures.required", false], ["extensions.autoDisableScopes", 0], ["extensions.enabledScopes", 15],
  ["browser.startup.page", 3], ["browser.sessionstore.resume_from_crash", true], ["browser.sessionstore.max_resumed_crashes", 50],
  ["browser.sessionstore.interval", 1000], ["browser.shell.checkDefaultBrowser", false], ["browser.aboutwelcome.enabled", false],
  ["startup.homepage_welcome_url", ""], ["startup.homepage_override_url", ""], ["browser.startup.homepage_override.mstone", "ignore"],
  ["datareporting.policy.dataSubmissionEnabled", false], ["toolkit.telemetry.reportingpolicy.firstRun", false],
  ["extensions.webextensions.restrictedDomains", ""],
].map(([k, v]) => `user_pref("${k}", ${JSON.stringify(v)});`).join("\n"));
execSync(`C:/Windows/System32/tar.exe --format zip -c -f "${profile}/extensions/tabstead@lagudafuadtosin.xpi" *`, { cwd: resolve("dist/firefox-test"), shell: "cmd.exe" });

// The test page: runs one scenario step through the add-on and posts the result back
const PAGE = (step) => `<!doctype html><title>runner ${step}</title><script>
const t = (c) => new Promise((res) => { const on = (e) => { if (e.data && e.data.tabsteadResult !== undefined) { removeEventListener("message", on); res(e.data.tabsteadResult); } }; addEventListener("message", on); postMessage({ tabsteadTest: c }, "*"); });
const post = (what, data) => fetch("/report", { method: "POST", body: JSON.stringify({ what, data }) });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
(async () => {
  await sleep(4000);
  const step = ${JSON.stringify(step)};
  if (step === "setup") {
    const a = await t({ do: "open", url: location.origin + "/a" }), b = await t({ do: "open", url: location.origin + "/b" });
    await t({ do: "group", tabIds: [a, b], title: "Research" });
    await t({ do: "create", name: "Work" });
    await t({ do: "open", url: location.origin + "/w1", active: true });
    await t({ do: "open", url: location.origin + "/w2" });
    await sleep(2500);
    post("setup", { overview: await t({ do: "overview" }), state: await t({ do: "state" }) });
  } else if (step.startsWith("switch-and-crash")) {
    const o = await t({ do: "overview" });
    const other = o.workspaces.find((w) => w.id !== o.current);
    post("switching", { to: other.name });
    t({ do: "switch", id: other.id }); // not awaited: Firefox is killed while this runs
  } else {
    post("check", { overview: await t({ do: "overview" }), state: await t({ do: "state" }) });
  }
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
await new Promise((r) => server.listen(8790, "127.0.0.1", r));
const next = (ms) => new Promise((res, rej) => { const t = setTimeout(() => rej(new Error("no report")), ms); waiter = () => { clearTimeout(t); res(reports.at(-1)); }; });
const start = (step) => spawn(FF, ["-profile", profile, "-no-remote", "-headless", `http://127.0.0.1:8790/run/${step}`], { stdio: "ignore" });
const kill = (p) => new Promise((res) => { p.once("exit", res); try { execSync(`taskkill /F /PID ${p.pid} /T`, { stdio: "ignore" }); } catch {} setTimeout(res, 5000); });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let failed = 0, n = 0;
const check = (name, ok, detail = "") => { n++; if (!ok) failed++; console.log(`${ok ? "✔" : "✘ FAIL"} ${name}${ok ? "" : "  " + detail}`); };
const ours = (state) => state.filter((x) => /\/(a|b|w1|w2)$/.test(x.url || ""));
const consistent = (overview, state) => {
  const win = state.filter((x) => x.windowId === state[0].windowId);
  const wrong = win.filter((x) => !x.pinned && x.ws && (x.hidden !== (x.ws !== overview.current)));
  const active = win.filter((x) => x.active);
  return wrong.length === 0 && active.length === 1 && !active[0].hidden ? "" : JSON.stringify({ wrong: wrong.map((x) => x.url), active: active.length });
};

let ff = start("setup");
const setup = (await next(90000)).data;
const want = Object.fromEntries(ours(setup.state).map((x) => [x.url.split("/").pop(), { ws: x.ws, grouped: x.groupId !== -1 || !!x.grp?.title }]));
check("setup: 4 tabs over 2 workspaces with a group", Object.keys(want).length === 4 && setup.overview.workspaces.length === 2, JSON.stringify(want));
await sleep(2500);
await kill(ff);

for (let i = 1; i <= ROUNDS; i++) {
  // Kill in the middle of a switch
  ff = start("switch-and-crash-" + i);
  try { await next(90000); } catch {}
  await sleep(40 + i * 37); // a different moment each round
  await kill(ff);
  // Start again and check
  ff = start("check-" + i);
  let r;
  try { r = (await next(90000)).data; } catch (e) { check(`round ${i}: Tabstead answered after the restart`, false, e.message); await kill(ff); continue; }
  const got = Object.fromEntries(ours(r.state).map((x) => [x.url.split("/").pop(), { ws: x.ws, grouped: x.groupId !== -1 || !!x.grp?.title }]));
  check(`round ${i}: all 4 tabs back, each in its workspace, group kept`, JSON.stringify(got) === JSON.stringify(want), JSON.stringify(got));
  const c = consistent(r.overview, r.state);
  check(`round ${i}: the window shows exactly its workspace`, c === "", c);
  check(`round ${i}: still 2 workspaces`, r.overview.workspaces.length === 2);
  await sleep(1500);
  await kill(ff);
}

console.log(failed ? `\n${failed} of ${n} failed` : `\nall ${n} passed`);
server.close();
process.exit(failed ? 1 : 0);
