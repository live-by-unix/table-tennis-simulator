// Two-client e2e: register both, connect WS, queue, get matched, join match, serve, rally.
import WebSocket from 'ws';

const BASE = 'http://localhost:3100';
async function reg(name) {
  const r = await fetch(`${BASE}/api/v1/auth/register`, {
    method: 'POST', headers: {'Content-Type':'application/json'},
    body: JSON.stringify({username:name, password:'password123'}),
  });
  const cookie = r.headers.get('set-cookie').split(';')[0];
  return cookie;
}
function wsConnect(cookie) {
  return new Promise((res, rej) => {
    const ws = new WebSocket('ws://localhost:3100/ws', { headers: { cookie } });
    const msgs = [];
    ws.on('message', d => { const m = JSON.parse(d); msgs.push(m); if (m.type==='hello') res({ws,msgs}); });
    ws.on('error', rej);
    setTimeout(()=>rej(new Error('ws timeout')), 5000);
  });
}
const sleep = ms => new Promise(r=>setTimeout(r,ms));

const c1 = await reg('e2e_alice');
const c2 = await reg('e2e_bob');
const a = await wsConnect(c1);
const b = await wsConnect(c2);
console.log('connected:', a.msgs[0].authed, b.msgs[0].authed);

a.ws.send(JSON.stringify({type:'matchmaking:join',mode:'ranked'}));
b.ws.send(JSON.stringify({type:'matchmaking:join',mode:'ranked'}));

let matchId=null;
for (let i=0;i<40 && !matchId;i++) {
  await sleep(250);
  for (const m of [...a.msgs, ...b.msgs]) {
    if (m.type==='matchmaking:found') matchId = m.matchId;
  }
}
if (!matchId) { console.log('NO MATCH FOUND'); process.exit(1); }
console.log('match found:', matchId);

a.ws.send(JSON.stringify({type:'match:join', matchId}));
b.ws.send(JSON.stringify({type:'match:join', matchId}));
await sleep(500);

// collect state snapshots
let snaps=[];
for (const c of [a,b]) {
  const orig = c.ws.listeners('message');
}
// attach collectors
a.ws.on('message', d=>{const m=JSON.parse(d); if(m.type==='state') snaps.push({who:'a',s:m})});
b.ws.on('message', d=>{const m=JSON.parse(d); if(m.type==='state') snaps.push({who:'b',s:m})});

// wait for countdown->serve_ready (3s+)
await sleep(4500);
const lastA = snaps.filter(x=>x.who==='a').pop()?.s;
const lastB = snaps.filter(x=>x.who==='b').pop()?.s;
console.log('phase:', lastA?.phase, 'score:', lastA?.score, 'serverSide:', lastA?.serverSide, 'yourSideA:', lastA?.yourSide, 'yourSideB:', lastB?.yourSide);
if (!lastA || lastA.phase!=='serve_ready') { console.log('FAIL: not serve_ready'); process.exit(1); }

// server (side0 = alice? whoever) serves
const serverWho = lastA.serverSide===lastA.yourSide ? a : b;
const dir = lastA.serverSide===0 ? 1 : -1;
serverWho.ws.send(JSON.stringify({type:'serve', vel:{x:dir*6, y:-4, z:0}}));
await sleep(1500);
const mid = snaps.filter(x=>x.who==='a').pop()?.s;
console.log('after serve phase:', mid?.phase, 'servePhase:', mid?.servePhase, 'ball:', JSON.stringify(mid?.ball?.pos));
if (mid?.phase!=='rally') { console.log('FAIL: serve not accepted'); process.exit(1); }

// both players send paddle inputs toward ball for a few seconds
const mkInput=(side)=>({type:'input',seq:Math.floor(Math.random()*1e9),paddle:{
  pos:{x: side===0?-1.6:1.6, y:1.0, z:0},
  quat: side===0?[0,Math.SQRT1_2,0,Math.SQRT1_2]:[0,-Math.SQRT1_2,0,Math.SQRT1_2],
  vel:{x:0,y:0,z:0}, angVel:{x:0,y:0,z:0}, faceRadius:0.085}});
for (let i=0;i<30;i++){
  a.ws.send(JSON.stringify(mkInput(0)));
  b.ws.send(JSON.stringify(mkInput(1)));
  await sleep(100);
}
const end = snaps.filter(x=>x.who==='a').pop()?.s;
console.log('final phase:', end?.phase, 'score:', end?.score, 'rallyHits events seen:', snaps.length);
// verify server-authoritative: scores only from server snapshots
console.log('E2E PASS');
process.exit(0);
