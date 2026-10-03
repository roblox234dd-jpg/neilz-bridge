-- Run as a LOCAL STUDIO PLUGIN or in the EDIT-mode Command Bar.
local HttpService = game:GetService("HttpService")
local ScriptEditorService = game:GetService("ScriptEditorService")
local RunService = game:GetService("RunService")
local SERVER_URL = "http://127.0.0.1:8080"
if not RunService:IsStudio() then error("[MCP Bridge] Roblox Studio is required") end
local previous = _G.RobloxMCPBridge
if type(previous) == "table" and previous.stop then previous.stop() end
_G.RobloxMCPBridgeRunning = false -- Stop the old client.
local state = { running = true, connected = false, lastError = nil }
_G.RobloxMCPBridge = state
function state.stop() state.running = false end
local function active() return state.running and _G.RobloxMCPBridge == state end
local function request(method, path, data)
 local options = { Url = SERVER_URL .. path, Method = method, Headers = { ["Cache-Control"] = "no-cache" } }
 if data then options.Headers["Content-Type"] = "application/json"; options.Body = HttpService:JSONEncode(data) end
 return HttpService:RequestAsync(options)
end
local function find(path)
 if path == nil or path == "" or path == "game" then return game end
 if type(path) ~= "string" then error("path must be a string") end
 local current = game
 for i, part in ipairs(string.split(path, ".")) do
  if not (i == 1 and part == "game") then
   current = current:FindFirstChild(part)
   if not current then error("Instance not found: " .. path) end
  end
 end
 return current
end
local function tree(inst, depth, budget)
 budget.count += 1
 local node = { Name = inst.Name, ClassName = inst.ClassName, FullName = inst:GetFullName(), Children = {}, Properties = { Archivable = inst.Archivable } }
 if inst:IsA("BasePart") then
  node.Properties.Position = tostring(inst.Position); node.Properties.Size = tostring(inst.Size)
  node.Properties.Anchored = inst.Anchored; node.Properties.CanCollide = inst.CanCollide
 elseif inst:IsA("ValueBase") then node.Properties.Value = tostring(inst.Value) end
 local children = inst:GetChildren(); node.ChildCount = #children
 if depth < 3 then
  for _, child in ipairs(children) do
   if budget.count >= 1000 then node.Truncated = true; break end
   table.insert(node.Children, tree(child, depth + 1, budget))
  end
 elseif #children > 0 then node.Truncated = true end
 return node
end
local function execute(job)
 local target = find(job.path)
 if job.action == "get_explorer_tree" then return tree(target, 1, { count = 0 }) end
 if job.action == "read_script" then
  if not target:IsA("LuaSourceContainer") then error("Target is not a script") end
  local ok, source = pcall(function() return ScriptEditorService:GetEditorSource(target) end)
  if not ok then ok, source = pcall(function() return target.Source end) end
  if not ok then error("Cannot read source. Use a Studio plugin or edit-mode Command Bar: " .. tostring(source)) end
  return { source = source }
 end
 error("Unknown action: " .. tostring(job.action))
end
local function process(job)
 if type(job) ~= "table" or type(job.req_id) ~= "string" then error("Invalid task JSON") end
 local ok, data = pcall(execute, job)
 if not ok then data = { error = tostring(data) } end
 local lastError
 for attempt = 1, 3 do
  if not active() then return end
  local sent, response = pcall(request, "POST", "/mcp_response", { req_id = job.req_id, data = data })
  if sent and response.Success then print("[MCP Bridge] Completed " .. tostring(job.action)); return end
  if sent and response.StatusCode == 404 then warn("[MCP Bridge] Request expired or already completed"); return end
  lastError = sent and ("HTTP " .. response.StatusCode .. ": " .. response.Body) or tostring(response)
  task.wait(0.5 * attempt)
 end
 error("Response POST failed: " .. tostring(lastError))
end
if plugin then plugin.Unloading:Connect(state.stop) end
 task.spawn(function()
 local failures = 0
 while active() do
  local ok, err = pcall(function()
   local response = request("GET", "/mcp_poll")
   if not active() then return end
   if response.StatusCode ~= 200 and response.StatusCode ~= 204 then error("Poll HTTP " .. response.StatusCode .. ": " .. response.Body) end
   if not state.connected then print("[MCP Bridge] Connected to " .. SERVER_URL) end
   state.connected = true; state.lastError = nil
   if response.StatusCode == 200 then process(HttpService:JSONDecode(response.Body)) end
  end)
  if ok then failures = 0 else
   failures += 1; state.connected = false; state.lastError = tostring(err)
   if failures == 1 or failures % 10 == 0 then warn("[MCP Bridge] " .. tostring(err) .. " | Check Codex bridge, Studio plugin HTTP permissions, and port 8080.") end
  end
  task.wait(ok and 0.5 or math.min(failures, 5))
 end
 state.connected = false
end)
print("[MCP Bridge] Starting; wait for 'Connected' to confirm HTTP connectivity.")
-- Stop manually: _G.RobloxMCPBridge.stop()
