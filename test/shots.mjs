// Sets up a Firefox Developer Edition with Tabstead and sample workspaces for store screenshots, then leaves it open.
// No remote control, so the address bar looks normal. The setup page drives Tabstead through the test bridge and
// closes itself.
import http from "node:http";
import { spawn, execSync } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const FF = process.env.FIREFOX_DEV ?? "E:/postbarrel/tools/firefox-dev/core/firefox.exe";
const profile = "E:/postbarrel/tmp/tabstead-shots";
rmSync(profile, { recursive: true, force: true }); mkdirSync(profile + "/extensions", { recursive: true });
writeFileSync(profile + "/user.js", [
  ["xpinstall.signatures.required", false], ["extensions.autoDisableScopes", 0], ["extensions.enabledScopes", 15],
  ["browser.aboutwelcome.enabled", false], ["browser.shell.checkDefaultBrowser", false], ["startup.homepage_welcome_url", ""],
  ["browser.startup.homepage_override.mstone", "ignore"], ["datareporting.policy.dataSubmissionEnabled", false],
  ["toolkit.telemetry.reportingpolicy.firstRun", false], ["browser.toolbars.bookmarks.visibility", "never"],
  ["termsofuse.acceptedVersion", 999], ["termsofuse.acceptedDate", "1762646400000"], ["browser.preonboarding.enabled", false],
].map(([k, v]) => `user_pref("${k}", ${JSON.stringify(v)});`).join("\n"));
execSync(`C:/Windows/System32/tar.exe --format zip -c -f "${profile}/extensions/tabstead@lagudafuadtosin.xpi" *`, { cwd: resolve("dist/firefox-test"), shell: "cmd.exe" });

const SETUP = `<!doctype html><title>Setting up</title>Setting up...<script>
let seq = 0;
const t = (c) => new Promise((res) => { const id = ++seq; const on = (e) => { if (e.data && e.data.tabsteadResult !== undefined && e.data.id === id) { removeEventListener("message", on); res(e.data.tabsteadResult); } }; addEventListener("message", on); postMessage({ tabsteadTest: c, id }, "*"); });
(async () => {
  await new Promise((r) => setTimeout(r, 4000));
  await t({ do: "idle" });
  await t({ do: "storageSet", value: { guideHidden: true } });
  let o = await t({ do: "overview" });
  const work = o.workspaces[0].id;
  await t({ do: "rename", id: work, name: "Work" });
  await t({ do: "open", url: "https://en.wikipedia.org/wiki/Spreadsheet", active: true });
  const d1 = await t({ do: "open", url: "https://docs.python.org/3/tutorial/index.html" });
  const d2 = await t({ do: "open", url: "https://docs.python.org/3/library/index.html" });
  await t({ do: "group", tabIds: [d1, d2], title: "Docs" });
  await t({ do: "open", url: "https://news.ycombinator.com/" });
  o = await t({ do: "create", name: "Reading" });
  await t({ do: "recolor", id: o.current, color: "green" });
  await t({ do: "open", url: "https://en.wikipedia.org/wiki/Firefox", active: true });
  const r1 = await t({ do: "open", url: "https://en.wikipedia.org/wiki/Tab_(interface)" });
  const r2 = await t({ do: "open", url: "https://en.wikipedia.org/wiki/Web_browser" });
  await t({ do: "group", tabIds: [r1, r2], title: "Later" });
  await t({ do: "open", url: "https://www.gutenberg.org/ebooks/1342" });
  o = await t({ do: "create", name: "Trip" });
  await t({ do: "recolor", id: o.current, color: "orange" });
  await t({ do: "open", url: "https://en.wikipedia.org/wiki/Edinburgh", active: true });
  await t({ do: "open", url: "https://en.wikipedia.org/wiki/Stirling" });
  await t({ do: "switch", id: work });
  await t({ do: "backupNow" });
  const me = (await t({ do: "state" })).filter((x) => x.url.startsWith(location.origin) || x.url === "about:blank" || x.url === "about:newtab" || x.url === "about:home");
  await fetch("/done", { method: "POST" });
  await t({ do: "close", ids: me.map((x) => x.id) });
})();
</script>`;
let done;
const finished = new Promise((r) => (done = r));
const server = http.createServer((q, r) => {
  if (q.url === "/done") { r.end("ok"); return done(); }
  r.setHeader("content-type", "text/html"); r.end(SETUP);
});
await new Promise((r) => server.listen(8793, "127.0.0.1", r));
spawn(FF, ["-profile", profile, "-no-remote", "http://127.0.0.1:8793/setup"], { stdio: "ignore", detached: true }).unref();
await Promise.race([finished, new Promise((r) => setTimeout(r, 90000))]);
await new Promise((r) => setTimeout(r, 2000));
server.close();
console.log("ready");
process.exit(0);
