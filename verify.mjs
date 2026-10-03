import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import http from 'node:http';
import { randomUUID } from 'node:crypto';
import { SessionRegistry } from './sessions.mjs';
let testNow=0;const registry=new SessionRegistry('owner',{now:()=>testNow,leaseMs:100});
for(let i=0;i<19;i++)assert(registry.register('client'+i));
assert.equal(registry.count,20);assert.equal(registry.register('overflow'),false);
registry.release('client0');assert(registry.register('replacement'));testNow=101;
assert.equal(registry.count,1);assert.equal(registry.renew('client1'),false);assert(registry.register('new'));
const port = 18080;
const base = 'http://127.0.0.1:'+port;
async function start(chosenPort=port){const client=new Client({name:'verify',version:'1.0.0'});await client.connect(new StdioClientTransport({command:process.execPath,args:[fileURLToPath(new URL('./server.mjs',import.meta.url))],env:{...process.env,ROBLOX_BRIDGE_PORT:String(chosenPort),ROBLOX_BRIDGE_PORT_END:String(chosenPort+10),ROBLOX_BRIDGE_TIMEOUT_MS:'1000'},stderr:'pipe'}));return client;}
async function poll(){for(let n=0;n<100;n++){const res=await fetch(base+'/mcp_poll');if(res.status===200)return res.json();assert.equal(res.status,204);await new Promise(r=>setTimeout(r,10));}throw new Error('No queued task');}
async function post(job,data){return fetch(base+'/mcp_response',{method:'POST',body:JSON.stringify({req_id:job.req_id,data})});}
const client=await start();let second;
try {
 assert.equal((await client.listTools()).tools.length,6);
 const health=await fetch(base+'/health');assert.equal(health.status,200);assert.equal((await health.json()).clientPolling,false);
 const blocked=await fetch(base+'/health',{headers:{Origin:'https://example.com'}});assert.equal(blocked.status,403);
 const native=await fetch(base+'/health',{headers:{Origin:'https://example.com','X-Roblox-MCP':'1'}});assert.equal(native.status,200);
 const bad=await fetch(base+'/mcp_response',{method:'POST',body:'{'});assert.equal(bad.status,400);
 const first=client.callTool({name:'get_roblox_explorer',arguments:{path:'Workspace'}});
 const other=client.callTool({name:'read_roblox_script',arguments:{path:'ServerScriptService.Main'}});
 await new Promise(r=>setTimeout(r,50));
 // Health probes must not consume tasks.
 await fetch(base+'/health');await fetch(base+'/');
 const jobs=[await poll(),await poll()];assert.notEqual(jobs[0].req_id,jobs[1].req_id);
 for(const job of jobs){const data=job.action==='read_script'?{source:''}:false;assert.equal((await post(job,data)).status,200);}
 assert.equal((await first).content[0].text,'false');assert.equal((await other).content[0].text,'');
 const failure=client.callTool({name:'read_roblox_script',arguments:{path:'Missing'}});const failedJob=await poll();await post(failedJob,{error:'Instance not found'});assert.equal((await failure).isError,true);
 const waiting=await client.callTool({name:'get_roblox_explorer',arguments:{path:'Workspace'}});assert.match(waiting.content[0].text,/No client fetched/);assert.equal((await fetch(base+'/mcp_poll')).status,204);
 const delivered=client.callTool({name:'get_roblox_explorer',arguments:{}});const expired=await poll();assert.match((await delivered).content[0].text,/fetched the task but/);assert.equal((await post(expired,{})).status,404);
 const consoleCall=client.callTool({name:'get_roblox_console',arguments:{limit:10}});const consoleJob=await poll();assert.equal(consoleJob.action,'get_console_logs');assert.equal(consoleJob.limit,10);await post(consoleJob,{entries:[{message:'test',messageType:'Info',timestamp:123}]});assert.equal(JSON.parse((await consoleCall).content[0].text).entries[0].message,'test');
 const screenshotCall=client.callTool({name:'get_roblox_screenshot',arguments:{}});const screenshotJob=await poll();assert.equal(screenshotJob.action,'authorize_screenshot');await post(screenshotJob,{error:'Screenshots permission denied'});assert.equal((await screenshotCall).isError,true);
 const executeCall=client.callTool({name:'run_roblox_script',arguments:{source:'print("test")'}});const executeJob=await poll();assert.equal(executeJob.action,'run_script');assert.equal(executeJob.source,'print("test")');await post(executeJob,{scheduled:true,runId:executeJob.req_id});assert.equal(JSON.parse((await executeCall).content[0].text).scheduled,true);
 const deniedRun=client.callTool({name:'run_roblox_script',arguments:{source:'print("denied")'}});const deniedJob=await poll();await post(deniedJob,{error:'Run scripts permission denied'});assert.equal((await deniedRun).isError,true);
 assert.equal((await client.callTool({name:'run_roblox_script',arguments:{source:''}})).isError,true);assert.equal((await fetch(base+'/mcp_poll')).status,204);
 second=await start();assert.equal((await second.listTools()).tools.length,6);await new Promise(r=>setTimeout(r,150));const state=JSON.parse((await second.callTool({name:'get_roblox_bridge_status',arguments:{}})).content[0].text);assert.equal(state.bridgeListening,true);assert.equal(state.mode,'shared');assert.equal(state.bridgeError,null);
 assert.equal(state.connections.active,2);assert.equal(state.connections.maximum,20);
 const requestSession=(operation,clientId)=>fetch(base+'/mcp_session',{method:'POST',body:JSON.stringify({operation,clientId})});
 const temporaryIds=Array.from({length:18},()=>randomUUID());for(const id of temporaryIds)assert.equal((await requestSession('register',id)).status,200);
 const excess=randomUUID();assert.equal((await requestSession('register',excess)).status,429);
 let refused;try{refused=await start();await new Promise(r=>setTimeout(r,150));const refusedState=JSON.parse((await refused.callTool({name:'get_roblox_bridge_status',arguments:{}})).content[0].text);assert.equal(refusedState.bridgeListening,false);assert.match(refusedState.bridgeError,/20 simultaneous/);}finally{if(refused)await refused.close();}
 for(const id of temporaryIds)assert.equal((await requestSession('release',id)).status,200);
 assert.equal((await requestSession('register',excess)).status,200);await requestSession('release',excess);
 assert.equal((await fetch(base+'/mcp_dispatch',{method:'POST',body:JSON.stringify({action:'get_explorer_tree',payload:{}})})).status,403);
 const sharedCall=second.callTool({name:'get_roblox_explorer',arguments:{path:'SharedChat'}});
 const ownerCall=client.callTool({name:'read_roblox_script',arguments:{path:'OwnerChat'}});
 const mixed=[await poll(),await poll()];assert.notEqual(mixed[0].req_id,mixed[1].req_id);
 for(const job of mixed) await post(job,job.path==='SharedChat'?{from:'shared'}:{source:'owner'});
 assert.equal(JSON.parse((await sharedCall).content[0].text).from,'shared');assert.equal((await ownerCall).content[0].text,'owner');
 await client.close();
 let recovered=false;
 for(let n=0;n<40;n++){await new Promise(r=>setTimeout(r,100));const recoveredState=JSON.parse((await second.callTool({name:'get_roblox_bridge_status',arguments:{}})).content[0].text);if(recoveredState.bridgeListening && recoveredState.mode==='owner'){assert.equal(recoveredState.bridgeError,null);recovered=true;break;}}
 assert.equal(recovered,true,'Bridge must recover after the port is freed');
 const unrelated=http.createServer((req,res)=>{res.writeHead(200,{'Content-Type':'application/json'});res.end('{"other":true}');});await new Promise(r=>unrelated.listen(18120,'127.0.0.1',r));let fallback;
 try {fallback=await start(18120);await new Promise(r=>setTimeout(r,150));const fallbackState=JSON.parse((await fallback.callTool({name:'get_roblox_bridge_status',arguments:{}})).content[0].text);assert.equal(fallbackState.url,'http://127.0.0.1:18121');assert.equal(fallbackState.bridgeListening,true);assert.equal(fallbackState.mode,'owner');} finally {if(fallback)await fallback.close();await new Promise(r=>unrelated.close(r));}
 console.log('PASS: registration, passive health, parallel requests, permission errors, timeout cleanup, two chats sharing one bridge, owner exit recovery, fallback ports, 20-client cap, refused 21st client, disconnect slot release and lease expiry. Simulated Roblox client.');
} finally {if(second)await second.close();await client.close();}
