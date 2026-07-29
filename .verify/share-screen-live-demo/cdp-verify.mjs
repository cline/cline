// Minimal CDP driver: navigate demo route, wait, extract text, screenshot.
const URL_TO_OPEN = process.argv[2] || "http://127.0.0.1:8787/drive?demoShareScreen=1";
const OUT = process.argv[3] || "/tmp/demo-live.png";
const WAIT_MS = Number(process.argv[4] || 6000);

const ver = await (await fetch("http://127.0.0.1:9222/json/version")).json();
const browserWs = ver.webSocketDebuggerUrl;

function connect(wsUrl) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl);
    ws.onopen = () => resolve(ws);
    ws.onerror = (e) => reject(e);
  });
}

let idc = 0;
const pending = new Map();
function send(ws, method, params = {}, sessionId) {
  const id = ++idc;
  const msg = { id, method, params };
  if (sessionId) msg.sessionId = sessionId;
  ws.send(JSON.stringify(msg));
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
  });
}

const bws = await connect(browserWs);
bws.onmessage = (ev) => {
  const data = JSON.parse(ev.data);
  if (data.id && pending.has(data.id)) {
    const { resolve, reject } = pending.get(data.id);
    pending.delete(data.id);
    if (data.error) reject(new Error(JSON.stringify(data.error)));
    else resolve(data.result);
  }
};

const { targetId } = await send(bws, "Target.createTarget", { url: "about:blank" });
const { sessionId } = await send(bws, "Target.attachToTarget", { targetId, flatten: true });

await send(bws, "Page.enable", {}, sessionId);
await send(bws, "Runtime.enable", {}, sessionId);
await send(bws, "Page.navigate", { url: URL_TO_OPEN }, sessionId);

await new Promise((r) => setTimeout(r, WAIT_MS));

const textRes = await send(bws, "Runtime.evaluate", {
  expression: "document.body.innerText",
  returnByValue: true,
}, sessionId);
console.log("=====PAGE TEXT START=====");
console.log(textRes.result.value);
console.log("=====PAGE TEXT END=====");

// Also grab specific markers via querySelector counts
const markerRes = await send(bws, "Runtime.evaluate", {
  expression: `JSON.stringify({
    title: document.title,
    hasSpotlight: /in the spotlight/i.test(document.body.innerText),
    hasNarration: /Narration/i.test(document.body.innerText),
    editBadges: (document.body.innerText.match(/\\bedit\\b/gi)||[]).length,
    commandBadges: (document.body.innerText.match(/\\bcommand\\b/gi)||[]).length,
    testBadges: (document.body.innerText.match(/\\btest\\b/gi)||[]).length,
  })`,
  returnByValue: true,
}, sessionId);
console.log("=====MARKERS=====");
console.log(markerRes.result.value);

const shot = await send(bws, "Page.captureScreenshot", { format: "png", captureBeyondViewport: true }, sessionId);
const fs = await import("node:fs");
fs.writeFileSync(OUT, Buffer.from(shot.data, "base64"));
console.log("SCREENSHOT_WRITTEN:" + OUT);

await send(bws, "Target.closeTarget", { targetId });
bws.close();
process.exit(0);
