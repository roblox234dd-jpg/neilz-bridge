import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import http from 'node:http';
import { randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { SessionRegistry } from './sessions.mjs';
const execFileAsync=promisify(execFile);
async function captureRoblox() {
 if(process.platform!=='win32') throw new Error('Screenshots require Windows');
 const {stdout}=await execFileAsync('powershell.exe',['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',fileURLToPath(new URL('./capture-roblox.ps1',import.meta.url))],{windowsHide:true,timeout:10000,maxBuffer:8*1024*1024});
 const data=stdout.trim();
 if(!/^[A-Za-z0-9+/]+={0,2}$/.test(data) || Buffer.from(data,'base64').subarray(0,8).toString('hex')!=='89504e470d0a1a0a') throw new Error('Invalid screenshot output');
 return {type:'image',mimeType:'image/png',data};
}
const port = Number(process.env.ROBLOX_BRIDGE_PORT || 8080);
const endPort=Number(process.env.ROBLOX_BRIDGE_PORT_END || 9000);
const clientId=randomUUID(), sessions=new SessionRegistry(clientId);
let activePort=port, sharedUrl=null;
const timeout = Number(process.env.ROBLOX_BRIDGE_TIMEOUT_MS || 15000);
if (!Number.isInteger(port) || port < 1 || port > 65535 || !Number.isFinite(timeout) || timeout <= 0) throw new Error('Invalid port or timeout');
if(!Number.isInteger(endPort)||endPort<port||endPort>65535)throw new Error('Invalid end port');
const pending = new Map(), queue = [];
let lastPoll = null, lastResponse = null, bridgeError = null, retryTimer = null, stopping = false;
let lastHttpRequest = null;
function status() { return {name:'roblox-memory-mcp',displayName:'Neilz Bridge',sharedProtocol:2,version:'1.5.0',mode:sharedUrl?'shared':'owner',bridgeListening:bridge.listening,bridgeError,retryScheduled:retryTimer !== null,url:sharedUrl||'http://127.0.0.1:'+activePort,portRange:{start:port,end:endPort},connections:{active:sessions.count,maximum:20},lastHttpRequest,clientPolling:lastPoll !== null && Date.now()-lastPoll < 10000,lastPoll:lastPoll === null ? null : new Date(lastPoll).toISOString(),lastResponse:lastResponse === null ? null : new Date(lastResponse).toISOString(),pendingRequests:pending.size}; }
async function sessionRequest(url,operation) {
 const response=await fetch(url+'/mcp_session',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({operation,clientId}),signal:AbortSignal.timeout(1500)});
 return {ok:response.ok,...await response.json()};
}
async function getStatus() {
 if(!sharedUrl) return status();
 try {
  const remote=await fetch(sharedUrl+'/health',{signal:AbortSignal.timeout(1500)}).then(r=>r.json());
  if(remote.name!=='roblox-memory-mcp'||remote.sharedProtocol!==2) throw new Error('Shared bridge changed');
  return {...remote,mode:'shared',localVersion:'1.5.0'};
 } catch(err) { return {...status(),bridgeListening:false,bridgeError:'Shared bridge unavailable: '+err.message}; }
}
function reply(res, code, data) { res.writeHead(code, {'Content-Type':'application/json','Cache-Control':'no-store'}); res.end(code === 204 ? undefined : JSON.stringify(data)); }
const bridge = http.createServer((req,res) => {
 lastHttpRequest = { at: new Date().toISOString(), method: req.method, path: new URL(req.url,'http://127.0.0.1').pathname };
 // Native clients may send Origin. A custom header identifies bridge requests;
 // browser cross-origin requests cannot send it without a CORS preflight grant.
 if (req.headers.origin && req.headers['x-roblox-mcp'] !== '1') return reply(res,403,{error:'Origin header requires X-Roblox-MCP: 1. Update the bridge client.'});
 const path = new URL(req.url,'http://127.0.0.1').pathname;
 if (req.method === 'GET' && (path === '/' || path === '/health')) return reply(res,200,status());
 if (req.method === 'GET' && path === '/mcp_poll') {
  lastPoll = Date.now(); const job = queue.shift();
  if(job) pending.get(job.req_id).delivered = true;
  return reply(res,job ? 200 : 204,job);
 }
 if(req.method !== 'POST' || !['/mcp_response','/mcp_dispatch','/mcp_session'].includes(path)) return reply(res,404,{error:'Not found'});
 const chunks = []; let size=0,tooLarge=false;
 req.on('data',chunk => { size+=chunk.length; if(size>4*1024*1024) { if(!tooLarge) reply(res,413,{error:'Response exceeds 4 MiB'}); tooLarge=true; return; } chunks.push(chunk); });
 req.on('error',err=>console.error('[Bridge] Request error:',err.message));
 req.on('end',()=>{
  if(tooLarge) return;
  let payload; try { payload=JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { return reply(res,400,{error:'Invalid JSON'}); }
  if(path==='/mcp_session') {
   if(typeof payload?.clientId!=='string'||!/^[0-9a-f-]{36}$/.test(payload.clientId))return reply(res,400,{error:'Invalid client id'});
   const id=payload.clientId;
   if(payload.operation==='register')return sessions.register(id)?reply(res,200,{ok:true,active:sessions.count,maximum:20}):reply(res,429,{error:'Neilz Bridge supports at most 20 simultaneous AI clients',active:sessions.count,maximum:20});
   if(payload.operation==='renew')return sessions.renew(id)?reply(res,200,{ok:true}):reply(res,403,{error:'Session expired; reconnect'});
   if(payload.operation==='release'){sessions.release(id);return reply(res,200,{ok:true});}
   return reply(res,400,{error:'Invalid session operation'});
  }
  if(path==='/mcp_dispatch') {
   if(!sessions.renew(payload?.clientId))return reply(res,403,{error:'Registered AI session required'});
   if(!payload || !['get_explorer_tree','read_script','get_console_logs','authorize_screenshot','run_script'].includes(payload.action)) return reply(res,400,{error:'Unknown action'});
   const args=payload.payload??{};
   if(typeof args!=='object'||args===null||Array.isArray(args)) return reply(res,400,{error:'Invalid payload'});
   // Allow only known fields: a relay cannot overwrite the queue id or action.
   const clean={};
   if(args.path!==undefined) { if(typeof args.path!=='string') return reply(res,400,{error:'Invalid path'});clean.path=args.path; }
   if(args.limit!==undefined) { if(!Number.isInteger(args.limit)||args.limit<1||args.limit>100) return reply(res,400,{error:'Invalid limit'});clean.limit=args.limit; }
   if(payload.action==='run_script') { if(typeof args.source!=='string'||Buffer.byteLength(args.source)<1||Buffer.byteLength(args.source)>100000) return reply(res,400,{error:'Invalid source'});clean.source=args.source; }
   sendLocal(payload.action,clean).then(data=>reply(res,200,{data})).catch(err=>reply(res,504,{error:err.message}));
   return;
  }
  if(!payload || typeof payload.req_id !== 'string' || !Object.hasOwn(payload,'data')) return reply(res,400,{error:'req_id and data are required'});
  const entry=pending.get(payload.req_id);
  if(!entry || !entry.delivered) return reply(res,404,{error:'Unknown, undelivered or expired request'});
  clearTimeout(entry.timer); pending.delete(payload.req_id); lastResponse=Date.now(); entry.resolve(payload.data); reply(res,200,{ok:true});
 });
});
function scheduleRetry() {
 if(stopping||retryTimer!==null) return;
 retryTimer=setTimeout(async()=>{
  retryTimer=null;if(stopping) return;
  if(sharedUrl) {
   try { const renewed=await sessionRequest(sharedUrl,'renew');if(renewed.ok){scheduleRetry();return;} } catch {}
   sharedUrl=null;
  }
  if(!stopping&&!bridge.listening) bridge.listen(activePort,'127.0.0.1');
 },2000);retryTimer.unref();
}
bridge.on('error',async err=>{
 if(err.code!=='EADDRINUSE') {bridgeError=err.message;console.error('[Bridge]',bridgeError);return;}
 const candidate='http://127.0.0.1:'+activePort;
 try {
  const health=await fetch(candidate+'/health',{signal:AbortSignal.timeout(1000)}).then(r=>r.json());
  if(!stopping&&health.name==='roblox-memory-mcp'&&health.sharedProtocol===2&&health.bridgeListening===true) {
   const registration=await sessionRequest(candidate,'register');
   if(!registration.ok){bridgeError=registration.error||'Connection limit reached';scheduleRetry();return;}
   sharedUrl=candidate;bridgeError=null;console.error('[Bridge] Sharing existing bridge at '+candidate);scheduleRetry();return;
  }
 } catch {}
 if(stopping) return;
 if(activePort<endPort) {activePort++;bridge.listen(activePort,'127.0.0.1');return;}
 bridgeError='All candidate ports are occupied; retrying from '+port;
 activePort=port;console.error('[Bridge]',bridgeError);scheduleRetry();
});
bridge.on('listening',()=>{sharedUrl=null;bridgeError=null; console.error('[Bridge] Listening on 127.0.0.1:'+activePort);});
bridge.listen(port,'127.0.0.1');
async function send(action,payload) {
 if(sharedUrl) {
  const response=await fetch(sharedUrl+'/mcp_dispatch',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action,payload,clientId}),signal:AbortSignal.timeout(timeout+2000)});
  const result=await response.json();
  if(!response.ok) throw new Error(result.error||'Shared bridge request failed');
  return result.data;
 }
 return sendLocal(action,payload);
}
function sendLocal(action,payload) {
 if(!bridge.listening) return Promise.reject(new Error(bridgeError || 'HTTP bridge is still starting; retry shortly'));
 return new Promise((resolve,reject)=>{
  const req_id=randomUUID(), entry={resolve,reject,delivered:false};
  entry.timer=setTimeout(()=>{
   pending.delete(req_id); const index=queue.findIndex(job=>job.req_id===req_id); if(index!==-1) queue.splice(index,1);
   reject(new Error(entry.delivered ? 'Studio fetched the task but did not return a result. Check Studio Output.' : 'No client fetched this task. Run studio-client.luau as a Studio plugin or in the edit-mode Command Bar and check its HTTP errors.'));
  },timeout);
  pending.set(req_id,entry); queue.push({req_id,action,...payload});
 });
}
const server=new Server({name:'Neilz Bridge',version:'1.5.0'},{capabilities:{tools:{}}});
const pathSchema={type:'string',description:'Dot-separated Studio path, e.g. Workspace or ServerScriptService.Main'};
server.setRequestHandler(ListToolsRequestSchema,async()=>({tools:[
 {name:'get_roblox_bridge_status',description:'Reports bridge startup errors and recent polling without consuming tasks.',inputSchema:{type:'object',properties:{}}},
 {name:'get_roblox_explorer',description:'Reads an instance tree from the connected Roblox Studio client.',inputSchema:{type:'object',properties:{path:pathSchema}}},
 {name:'read_roblox_script',description:'Reads source allowed by the connected client. The permission menu allows LocalScripts only.',inputSchema:{type:'object',properties:{path:pathSchema},required:['path']}},
 {name:'get_roblox_console',description:'Reads recent client console messages captured while Console logs permission is enabled.',inputSchema:{type:'object',properties:{limit:{type:'integer',minimum:1,maximum:100,description:'Maximum messages to return; defaults to 50'}}}},
 {name:'get_roblox_screenshot',description:'Captures the visible client area of the foreground Roblox window on Windows. Requires Screenshots permission and a hidden Bridge menu. Returns a PNG image.',inputSchema:{type:'object',properties:{}}},
 {name:'run_roblox_script',description:'Schedules Lua code in the connected Roblox client. Requires Run scripts permission and loadstring. Result confirms scheduling, not completion. Enable Console logs to read completion/errors. Disabling permission prevents queued starts but cannot stop already running code.',inputSchema:{type:'object',properties:{source:{type:'string',minLength:1,maxLength:100000,description:'Lua source code to execute'}},required:['source']},annotations:{readOnlyHint:false,destructiveHint:true}}
]}));
server.setRequestHandler(CallToolRequestSchema,async({params:{name,arguments:args={}}})=>{
 try {
  let data;
  if(name==='get_roblox_bridge_status') data=await getStatus();
  else {
   if(args.path!==undefined && typeof args.path!=='string') throw new Error('path must be a string');
   if(name==='get_roblox_explorer') data=await send('get_explorer_tree',{path:args.path??'Workspace'});
   else if(name==='read_roblox_script') { if(!args.path) throw new Error('path is required'); data=await send('read_script',{path:args.path}); }
   else if(name==='get_roblox_console') { const limit=args.limit??50; if(!Number.isInteger(limit)||limit<1||limit>100) throw new Error('limit must be an integer from 1 to 100'); data=await send('get_console_logs',{limit}); }
   else if(name==='run_roblox_script') { if(typeof args.source!=='string'||Buffer.byteLength(args.source)<1||Buffer.byteLength(args.source)>100000) throw new Error('source must contain 1 to 100000 UTF-8 bytes'); data=await send('run_script',{source:args.source}); }
   else if(name==='get_roblox_screenshot') {
    const authorize=async()=>{const approval=await send('authorize_screenshot',{});if(approval?.authorized!==true) throw new Error(approval?.error||'Screenshots permission denied');};
    await authorize();
    const captured=await captureRoblox();
    // Check again after capture so revoked permission never releases the image.
    await authorize();
    return {content:[captured]};
   }
   else throw new Error('Unknown tool: '+name);
   if(data && typeof data.error==='string') throw new Error(data.error);
  }
  return {content:[{type:'text',text:name==='read_roblox_script' && typeof data?.source==='string' ? data.source : JSON.stringify(data??null,null,2)}]};
 } catch(err) { return {isError:true,content:[{type:'text',text:'Error: '+err.message}]}; }
});
await server.connect(new StdioServerTransport());
async function shutdown(){if(stopping)return;stopping=true;clearTimeout(retryTimer);for(const entry of pending.values()){clearTimeout(entry.timer);entry.reject(new Error('Bridge shutting down'));}if(sharedUrl){try{await sessionRequest(sharedUrl,'release');}catch{}}bridge.close();process.exit(0);}
process.stdin.on('end',shutdown);process.on('SIGTERM',shutdown);process.on('SIGINT',shutdown);
