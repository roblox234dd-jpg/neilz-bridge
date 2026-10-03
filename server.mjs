// Roblox Views: Windows input only in Roblox Player; focus checks, no OS shortcuts.
// Enable Roblox Views and hide the menu before input. Enable Screenshots separately to see the game.
// Neilz Bridge MCP server — Node.js 22 or newer.
// Install dependency beside this file: npm install @modelcontextprotocol/sdk@1.32.0
// Codex: codex mcp add neilz-bridge -- node /absolute/path/to/server.mjs
// Run neilz bridge.luau in your authorized Roblox environment.
// Default ports: 8080–9000. Maximum: 20 AI clients per shared bridge.
// Enable permissions in the GUI. Right Shift hides/shows the menu.
// Environment: ROBLOX_BRIDGE_PORT, ROBLOX_BRIDGE_PORT_END, ROBLOX_BRIDGE_TIMEOUT_MS.
// Screenshot support is Windows-only. All bridge helpers are embedded below.

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import http from 'node:http';
import { randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
class SessionRegistry {
 constructor(ownerId,{maximum=20,leaseMs=15000,now=Date.now}={}) {
  this.ownerId=ownerId;this.maximum=maximum;this.leaseMs=leaseMs;this.now=now;
  this.entries=new Map([[ownerId,Infinity]]);
 }
 prune(){for(const [id,expires] of this.entries)if(expires<=this.now())this.entries.delete(id);}
 register(id){this.prune();if(!this.entries.has(id)&&this.entries.size>=this.maximum)return false;this.entries.set(id,id===this.ownerId?Infinity:this.now()+this.leaseMs);return true;}
 renew(id){this.prune();if(!this.entries.has(id))return false;return this.register(id);}
 release(id){if(id!==this.ownerId)this.entries.delete(id);}
 get count(){this.prune();return this.entries.size;}
}

const captureScript=String.raw`param([switch]$ValidateOnly)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class RobloxCaptureWindow {
 [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
 [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left,Top,Right,Bottom; }
 [StructLayout(LayoutKind.Sequential)] public struct POINT { public int X,Y; }
 [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
 [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint p);
 [DllImport("user32.dll")] public static extern bool GetClientRect(IntPtr h, out RECT r);
 [DllImport("user32.dll")] public static extern bool ClientToScreen(IntPtr h, ref POINT p);
 [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr h);
}
'@
if ($ValidateOnly) {
 $width=320; $height=240; $ratio=1.0
 $sample = New-Object System.Drawing.Bitmap([int][Math]::Max(1,[Math]::Round($width*$ratio)),[int][Math]::Max(1,[Math]::Round($height*$ratio)))
 $sampleStream = New-Object System.IO.MemoryStream
 try { $sample.Save($sampleStream,[System.Drawing.Imaging.ImageFormat]::Png); if ($sampleStream.Length -lt 8) { throw 'PNG encoding failed' } }
 finally { $sample.Dispose(); $sampleStream.Dispose() }
 Write-Output 'Capture API and PNG encoding validated without capturing the screen'; exit 0
}
$null = [RobloxCaptureWindow]::SetProcessDPIAware()
$window = [RobloxCaptureWindow]::GetForegroundWindow()
[uint32]$robloxProcessId = 0
$null = [RobloxCaptureWindow]::GetWindowThreadProcessId($window, [ref]$robloxProcessId)
$process = Get-Process -Id $robloxProcessId
if ($process.ProcessName -notin @('RobloxPlayerBeta','RobloxStudioBeta')) { throw 'Bring the Roblox window to the foreground before requesting a screenshot.' }
if ([RobloxCaptureWindow]::IsIconic($window)) { throw 'Roblox is minimized.' }
$rect = New-Object RobloxCaptureWindow+RECT
$origin = New-Object RobloxCaptureWindow+POINT
if (-not [RobloxCaptureWindow]::GetClientRect($window,[ref]$rect) -or -not [RobloxCaptureWindow]::ClientToScreen($window,[ref]$origin)) { throw 'Unable to locate Roblox client area.' }
$width = $rect.Right - $rect.Left
$height = $rect.Bottom - $rect.Top
if ($width -lt 1 -or $height -lt 1 -or $width -gt 8192 -or $height -gt 8192) { throw 'Invalid Roblox window dimensions.' }
$bitmap = $null; $graphics = $null; $scaled = $null; $scaleGraphics = $null; $stream = $null
try {
 $bitmap = New-Object System.Drawing.Bitmap($width,$height)
 $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
 if ([RobloxCaptureWindow]::GetForegroundWindow() -ne $window) { throw 'Foreground window changed; screenshot cancelled.' }
 $graphics.CopyFromScreen($origin.X,$origin.Y,0,0,$bitmap.Size)
 if ([RobloxCaptureWindow]::GetForegroundWindow() -ne $window) { throw 'Foreground window changed; screenshot discarded.' }
 $ratio = [Math]::Min(1.0,1440.0/[Math]::Max($width,$height))
 $scaled = New-Object System.Drawing.Bitmap([int][Math]::Max(1,[Math]::Round($width*$ratio)),[int][Math]::Max(1,[Math]::Round($height*$ratio)))
 $scaleGraphics = [System.Drawing.Graphics]::FromImage($scaled)
 $scaleGraphics.DrawImage($bitmap,0,0,$scaled.Width,$scaled.Height)
 $stream = New-Object System.IO.MemoryStream
 $scaled.Save($stream,[System.Drawing.Imaging.ImageFormat]::Png)
 $bytes = $stream.ToArray()
 if ($bytes.Length -gt 4MB) { throw 'Screenshot exceeds 4 MiB.' }
 Write-Output ([Convert]::ToBase64String($bytes))
} finally {
 foreach ($resource in @($graphics,$scaleGraphics,$bitmap,$scaled,$stream)) { if ($null -ne $resource) { $resource.Dispose() } }
}
`;
const execFileAsync=promisify(execFile);
async function captureRoblox() {
 if(process.platform!=='win32') throw new Error('Screenshots require Windows');
 const {stdout}=await execFileAsync('powershell.exe',['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-Command',captureScript],{windowsHide:true,timeout:10000,maxBuffer:8*1024*1024});
 const data=stdout.trim();
 if(!/^[A-Za-z0-9+/]+={0,2}$/.test(data) || Buffer.from(data,'base64').subarray(0,8).toString('hex')!=='89504e470d0a1a0a') throw new Error('Invalid screenshot output');
 return {type:'image',mimeType:'image/png',data};
}

const inputScript=String.raw`param([switch]$ValidateOnly)
$ErrorActionPreference='Stop'
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class NeilzInput {
 [StructLayout(LayoutKind.Sequential)] public struct RECT {public int Left,Top,Right,Bottom;}
 [StructLayout(LayoutKind.Sequential)] public struct POINT {public int X,Y;}
 [StructLayout(LayoutKind.Sequential)] public struct MOUSE {public int x,y;public uint data,flags,time;public UIntPtr extra;}
 [StructLayout(LayoutKind.Sequential)] public struct KEY {public ushort vk,scan;public uint flags,time;public UIntPtr extra;}
 [StructLayout(LayoutKind.Explicit)] public struct UNION {[FieldOffset(0)]public MOUSE mouse;[FieldOffset(0)]public KEY key;}
 [StructLayout(LayoutKind.Sequential)] public struct INPUT {public uint type;public UNION value;}
 [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
 [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
 [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
 [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr h);
 [DllImport("user32.dll")] public static extern bool ShowWindowAsync(IntPtr h,int n);
 [DllImport("user32.dll")] public static extern bool GetClientRect(IntPtr h,out RECT r);
 [DllImport("user32.dll")] public static extern bool ClientToScreen(IntPtr h,ref POINT p);
 [DllImport("user32.dll")] public static extern IntPtr WindowFromPoint(POINT p);
 [DllImport("user32.dll")] public static extern IntPtr GetAncestor(IntPtr h,uint flags);
 [DllImport("user32.dll")] public static extern int GetSystemMetrics(int n);
 [DllImport("user32.dll")] public static extern short GetAsyncKeyState(int key);
 [DllImport("user32.dll",SetLastError=true)] public static extern uint SendInput(uint n,INPUT[] inputs,int size);
 public static int Size(){return Marshal.SizeOf(typeof(INPUT));}
 public static INPUT Mouse(int x,int y,uint flags){var i=new INPUT();i.type=0;i.value.mouse.x=x;i.value.mouse.y=y;i.value.mouse.flags=flags;return i;}
 public static INPUT Key(ushort vk,bool up){var i=new INPUT();i.type=1;i.value.key.vk=vk;i.value.key.flags=(up?2u:0u)|((vk>=37&&vk<=40)?1u:0u);return i;}
}
'@
if($ValidateOnly){if([NeilzInput]::Size() -ne 40 -and [NeilzInput]::Size() -ne 28){throw 'Invalid INPUT layout'};Write-Output 'Input bindings validated; no focus or input performed';exit 0}
$command=$env:NEILZ_INPUT_REQUEST | ConvertFrom-Json
if($command.phase -notin @('prepare','perform')){throw 'Invalid phase'}
$candidates=@(Get-Process -Name RobloxPlayerBeta -ErrorAction SilentlyContinue | Where-Object {$_.MainWindowHandle -ne 0})
if($candidates.Count -ne 1){throw 'Exactly one Roblox Player window must be open; close other Roblox instances.'}
$target=$candidates[0]
$window=$target.MainWindowHandle
if($command.processId -and $target.Id -ne $command.processId){throw 'Roblox process changed; action cancelled'}
$null=[NeilzInput]::SetProcessDPIAware()
if($command.phase -eq 'prepare'){
 if([NeilzInput]::IsIconic($window)){$null=[NeilzInput]::ShowWindowAsync($window,9)}
 if([NeilzInput]::GetForegroundWindow() -ne $window){$null=[NeilzInput]::SetForegroundWindow($window)}
 for($attempt=0;$attempt -lt 10 -and [NeilzInput]::GetForegroundWindow() -ne $window;$attempt++){Start-Sleep -Milliseconds 30}
 if([NeilzInput]::GetForegroundWindow() -ne $window){throw 'Windows did not allow focusing Roblox. Activate Roblox manually and retry.'}
 @{processId=$target.Id;windowTitle=$target.MainWindowTitle} | ConvertTo-Json -Compress
 exit 0
}
$mutex=New-Object System.Threading.Mutex($false,'Local\NeilzBridgeRobloxInput')
$locked=$false
try{
 try{$locked=$mutex.WaitOne(0)}catch [System.Threading.AbandonedMutexException]{$locked=$true}
 if(-not $locked){throw 'Another Roblox input action is running; retry shortly'}
 if([NeilzInput]::GetForegroundWindow() -ne $window -or [NeilzInput]::IsIconic($window)){throw 'Roblox lost focus; action cancelled'}
 foreach($modifier in @(16,17,18,91,92,1,2,4)){if(([NeilzInput]::GetAsyncKeyState($modifier) -band 0x8000) -ne 0){throw 'Release physical modifier keys and mouse buttons before AI input'}}
 $batch=New-Object 'System.Collections.Generic.List[NeilzInput+INPUT]'
 if($command.operation -eq 'key'){
  $allowed=@(32,37,38,39,40)+@(48..57)+@(65..90)
  if([int]$command.vk -notin $allowed){throw 'Unsupported key'}
  if(([NeilzInput]::GetAsyncKeyState([int]$command.vk) -band 0x8000) -ne 0){throw 'Requested key is already physically held'}
  $batch.Add([NeilzInput]::Key([ushort]$command.vk,$false));$batch.Add([NeilzInput]::Key([ushort]$command.vk,$true))
 }elseif($command.operation -in @('move','click')){
  if($null -eq $command.x -or $null -eq $command.y -or $command.x -lt 0 -or $command.x -gt 1 -or $command.y -lt 0 -or $command.y -gt 1){throw 'Coordinates must be between 0 and 1'}
  $rect=New-Object NeilzInput+RECT;$origin=New-Object NeilzInput+POINT
  if(-not [NeilzInput]::GetClientRect($window,[ref]$rect) -or -not [NeilzInput]::ClientToScreen($window,[ref]$origin)){throw 'Cannot locate Roblox client area'}
  $width=$rect.Right-$rect.Left;$height=$rect.Bottom-$rect.Top
  if($width -le 1 -or $height -le 1){throw 'Invalid client dimensions'}
  $point=New-Object NeilzInput+POINT
  $point.X=$origin.X+[int][Math]::Round([double]$command.x*($width-1));$point.Y=$origin.Y+[int][Math]::Round([double]$command.y*($height-1))
  if([NeilzInput]::GetAncestor([NeilzInput]::WindowFromPoint($point),2) -ne $window){throw 'Target point is covered by another window or outside Roblox'}
  $left=[NeilzInput]::GetSystemMetrics(76);$top=[NeilzInput]::GetSystemMetrics(77);$screenWidth=[NeilzInput]::GetSystemMetrics(78);$screenHeight=[NeilzInput]::GetSystemMetrics(79)
  if($point.X -lt $left -or $point.Y -lt $top -or $point.X -ge $left+$screenWidth -or $point.Y -ge $top+$screenHeight){throw 'Target point is outside visible desktop'}
  $x=[int][Math]::Round(($point.X-$left)*65535.0/($screenWidth-1));$y=[int][Math]::Round(($point.Y-$top)*65535.0/($screenHeight-1))
  $batch.Add([NeilzInput]::Mouse($x,$y,0xC001))
  if($command.operation -eq 'click'){
   if($command.button -eq 'left'){$down=2;$up=4}elseif($command.button -eq 'right'){$down=8;$up=16}else{throw 'Unsupported mouse button'}
   $batch.Add([NeilzInput]::Mouse(0,0,[uint32]$down));$batch.Add([NeilzInput]::Mouse(0,0,[uint32]$up))
  }
 }else{throw 'Unsupported operation'}
 if([NeilzInput]::GetForegroundWindow() -ne $window){throw 'Roblox lost focus immediately before input; cancelled'}
 $sent=[NeilzInput]::SendInput([uint32]$batch.Count,$batch.ToArray(),[NeilzInput]::Size())
 if($sent -ne $batch.Count){throw 'Windows input was blocked or partially delivered. Release any held input manually before retrying.'}
 @{submitted=$true;operation=$command.operation;processId=$target.Id;events=$sent;windowTitle=$target.MainWindowTitle} | ConvertTo-Json -Compress
}finally{if($locked){$mutex.ReleaseMutex()};$mutex.Dispose()}
`;
const inputKeys={Space:32,Left:37,Up:38,Right:39,Down:40};
for(let code=65;code<=90;code++)inputKeys[String.fromCharCode(code)]=code;
for(let code=48;code<=57;code++)inputKeys[String.fromCharCode(code)]=code;
function validateRobloxInput(args) {
 if(!['move','click','key'].includes(args.operation))throw new Error('operation must be move, click or key');
 const clean={operation:args.operation};
 if(args.operation==='key'){if(!Object.hasOwn(inputKeys,args.key))throw new Error('Allowed keys: A-Z, 0-9, Space and arrow keys');clean.vk=inputKeys[args.key];}
 else {for(const name of ['x','y']){if(typeof args[name]!=='number'||!Number.isFinite(args[name])||args[name]<0||args[name]>1)throw new Error('x and y must be normalized coordinates from 0 to 1');clean[name]=args[name];}if(args.operation==='click'){clean.button=args.button??'left';if(!['left','right'].includes(clean.button))throw new Error('button must be left or right');}}
 return clean;
}
let windowsInputBusy=false;
async function runRobloxInput(args) {
 const clean=validateRobloxInput(args);
 if(process.platform!=='win32')throw new Error('Roblox Views requires Windows');
 if(windowsInputBusy)throw new Error('An input action is already running; retry shortly');
 windowsInputBusy=true;
 try {
  const authorize=async()=>{const approval=await send('authorize_roblox_input',{});if(approval?.authorized!==true)throw new Error(approval?.error||'Roblox Views permission denied');};
  const native=async(command)=>{
   const {stdout}=await execFileAsync('powershell.exe',['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-Command',inputScript],{windowsHide:true,timeout:10000,maxBuffer:1024*1024,env:{...process.env,NEILZ_INPUT_REQUEST:JSON.stringify(command)}});
   return JSON.parse(stdout.trim());
  };
  await authorize();
  const target=await native({phase:'prepare'});
  await authorize();
  return await native({...clean,phase:'perform',processId:target.processId});
 } finally {windowsInputBusy=false;}
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
function status() { return {name:'roblox-memory-mcp',displayName:'Neilz Bridge',sharedProtocol:3,version:'1.6.0',mode:sharedUrl?'shared':'owner',bridgeListening:bridge.listening,bridgeError,retryScheduled:retryTimer !== null,url:sharedUrl||'http://127.0.0.1:'+activePort,portRange:{start:port,end:endPort},connections:{active:sessions.count,maximum:20},lastHttpRequest,clientPolling:lastPoll !== null && Date.now()-lastPoll < 10000,lastPoll:lastPoll === null ? null : new Date(lastPoll).toISOString(),lastResponse:lastResponse === null ? null : new Date(lastResponse).toISOString(),pendingRequests:pending.size}; }
async function sessionRequest(url,operation) {
 const response=await fetch(url+'/mcp_session',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({operation,clientId}),signal:AbortSignal.timeout(1500)});
 return {ok:response.ok,...await response.json()};
}
async function getStatus() {
 if(!sharedUrl) return status();
 try {
  const remote=await fetch(sharedUrl+'/health',{signal:AbortSignal.timeout(1500)}).then(r=>r.json());
  if(remote.name!=='roblox-memory-mcp'||remote.sharedProtocol!==3) throw new Error('Shared bridge changed');
  return {...remote,mode:'shared',localVersion:'1.6.0'};
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
   if(!payload || !['get_explorer_tree','read_script','get_console_logs','authorize_screenshot','authorize_roblox_input','run_script'].includes(payload.action)) return reply(res,400,{error:'Unknown action'});
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
  if(!stopping&&health.name==='roblox-memory-mcp'&&health.sharedProtocol===3&&health.bridgeListening===true) {
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
const server=new Server({name:'Neilz Bridge',version:'1.6.0'},{capabilities:{tools:{}}});
const pathSchema={type:'string',description:'Dot-separated Studio path, e.g. Workspace or ServerScriptService.Main'};
server.setRequestHandler(ListToolsRequestSchema,async()=>({tools:[
 {name:'get_roblox_bridge_status',description:'Reports bridge startup errors and recent polling without consuming tasks.',inputSchema:{type:'object',properties:{}}},
 {name:'get_roblox_explorer',description:'Reads an instance tree from the connected Roblox Studio client.',inputSchema:{type:'object',properties:{path:pathSchema}}},
 {name:'read_roblox_script',description:'Reads source allowed by the connected client. The permission menu allows LocalScripts only.',inputSchema:{type:'object',properties:{path:pathSchema},required:['path']}},
 {name:'get_roblox_console',description:'Reads recent client console messages captured while Console logs permission is enabled.',inputSchema:{type:'object',properties:{limit:{type:'integer',minimum:1,maximum:100,description:'Maximum messages to return; defaults to 50'}}}},
 {name:'get_roblox_screenshot',description:'Captures the visible client area of the foreground Roblox window on Windows. Requires Screenshots permission and a hidden Bridge menu. Returns a PNG image.',inputSchema:{type:'object',properties:{}}},
 {name:'run_roblox_script',description:'Schedules Lua code in the connected Roblox client. Requires Run scripts permission and loadstring. Result confirms scheduling, not completion. Enable Console logs to read completion/errors. Disabling permission prevents queued starts but cannot stop already running code.',inputSchema:{type:'object',properties:{source:{type:'string',minLength:1,maxLength:100000,description:'Lua source code to execute'}},required:['source']},annotations:{readOnlyHint:false,destructiveHint:true}},
 {name:'roblox_view_input',description:'Windows input scoped to a single Roblox Player window. Requires Roblox Views permission and a hidden Bridge menu. Activates Roblox, verifies focus, then moves/clicks the Windows cursor or taps a gameplay key. x/y are normalized 0..1 coordinates in the Roblox client area. Only A-Z, 0-9, Space and arrow keys; no key holds or OS shortcuts. Refuses multiple Roblox windows, lost focus and covered click targets. Submitted input does not confirm the game handled it.',inputSchema:{type:'object',properties:{operation:{type:'string',enum:['move','click','key']},x:{type:'number',minimum:0,maximum:1},y:{type:'number',minimum:0,maximum:1},button:{type:'string',enum:['left','right']},key:{type:'string',enum:Object.keys(inputKeys)}},required:['operation']},annotations:{readOnlyHint:false,destructiveHint:true}}
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
   else if(name==='roblox_view_input') data=await runRobloxInput(args);
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
