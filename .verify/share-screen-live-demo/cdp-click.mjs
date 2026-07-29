// Navigate, then click buttons by visible text, capturing text+screenshot at each step.
const URL_TO_OPEN = "http://127.0.0.1:8787/drive?demoShareScreen=1";

const ver = await (await fetch("http://127.0.0.1:9222/json/version")).json();
const browserWs = ver.webSocketDebuggerUrl;
function connect(wsUrl){return new Promise((res,rej)=>{const ws=new WebSocket(wsUrl);ws.onopen=()=>res(ws);ws.onerror=rej;});}
let idc=0;const pending=new Map();
function send(ws,method,params={},sessionId){const id=++idc;const msg={id,method,params};if(sessionId)msg.sessionId=sessionId;ws.send(JSON.stringify(msg));return new Promise((resolve,reject)=>pending.set(id,{resolve,reject}));}
const bws=await connect(browserWs);
bws.onmessage=(ev)=>{const d=JSON.parse(ev.data);if(d.id&&pending.has(d.id)){const{resolve,reject}=pending.get(d.id);pending.delete(d.id);if(d.error)reject(new Error(JSON.stringify(d.error)));else resolve(d.result);}};
const {targetId}=await send(bws,"Target.createTarget",{url:"about:blank"});
const {sessionId}=await send(bws,"Target.attachToTarget",{targetId,flatten:true});
await send(bws,"Page.enable",{},sessionId);
await send(bws,"Runtime.enable",{},sessionId);
await send(bws,"Page.navigate",{url:URL_TO_OPEN},sessionId);
await new Promise(r=>setTimeout(r,3500));

const fs=await import("node:fs");
async function evalJS(expr){const r=await send(bws,"Runtime.evaluate",{expression:expr,returnByValue:true},sessionId);return r.result?.value;}
async function clickByText(text){
  return await evalJS(`(()=>{const btns=[...document.querySelectorAll('button')];const b=btns.find(x=>x.innerText.trim().toLowerCase().includes(${JSON.stringify(text.toLowerCase())}));if(b){b.click();return 'clicked:'+b.innerText.trim();}return 'not found:'+${JSON.stringify(text)};})()`);
}
async function shot(path){const s=await send(bws,"Page.captureScreenshot",{format:"png",captureBeyondViewport:true},sessionId);fs.writeFileSync(path,Buffer.from(s.data,"base64"));}
async function beatLine(){return await evalJS(`(()=>{const m=document.body.innerText.match(/Beat \\d+\\/\\d+[^\\n]*/);return m?m[0]:'no-beat';})()`);}

// Pause loop for deterministic stepping
console.log("pause:", await clickByText("Pause loop"));
await new Promise(r=>setTimeout(r,300));
console.log("restart:", await clickByText("Restart script"));
await new Promise(r=>setTimeout(r,300));
// Step to test beat (index 3): click Next beat 3 times
for(let i=0;i<3;i++){await clickByText("Next beat");await new Promise(r=>setTimeout(r,250));}
console.log("after 3 next:", await beatLine());
await shot("/tmp/demo-test-beat.png");
console.log("TESTBEAT_TEXT_START");
console.log(await evalJS("document.body.innerText"));
console.log("TESTBEAT_TEXT_END");

// Now force human takes spotlight
console.log("human:", await clickByText("Human takes spotlight"));
await new Promise(r=>setTimeout(r,500));
await shot("/tmp/demo-human-pin.png");
console.log("HUMAN_TEXT_START");
console.log(await evalJS("document.body.innerText"));
console.log("HUMAN_TEXT_END");
console.log("humanPinPresent:", await evalJS("/Human review note/i.test(document.body.innerText)"));
console.log("agentDeckPaused:", await evalJS("/Agent deck paused/i.test(document.body.innerText)"));

await send(bws,"Target.closeTarget",{targetId});
bws.close();
process.exit(0);
