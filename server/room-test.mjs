import WebSocket from 'ws';
import { readFileSync } from 'fs';
// get cookie from /tmp/rc.txt
const cookie = readFileSync('/tmp/rc.txt','utf8').split('\n').filter(l=>l.includes('tts_session')).map(l=>l.trim().split(/\s+/).pop()).join('');
const c = cookie.split('\t').pop();
const ws = new WebSocket('ws://localhost:3000/ws', { headers: { cookie: `tts_session=${c}`} });
ws.on('message', d => { const m=JSON.parse(d); console.log('RECV', m.type, JSON.stringify(m).slice(0,200)); if(m.type==='hello'){ ws.send(JSON.stringify({type:'room:create'})); } });
ws.on('error', e=>console.log('ERR',e.message));
setTimeout(()=>process.exit(0), 4000);
