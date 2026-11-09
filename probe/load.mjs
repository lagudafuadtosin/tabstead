// Loads the background in Node with a stand-in browser, to catch errors at load time
const ev = () => ({ addListener() {}, removeListener() {} });
const fn = async () => undefined;
const handler = { get(t, k) { if (k === "then") return undefined; if (k.startsWith?.("on")) return ev(); if (k === "getURL") return (x) => "moz-extension://x/" + x; if (k === "id") return "x"; return new Proxy(fn, handler); }, apply() { return Promise.resolve(undefined); } };
globalThis.browser = new Proxy(fn, handler);
process.on("unhandledRejection", (e) => console.log("REJECTION", e));
try { await import("../" + (process.argv[2] ?? "dist/firefox-test") + "/background.js"); console.log("loaded"); } catch (e) { console.log("LOAD ERROR", e); }
setTimeout(() => process.exit(0), 3000);
