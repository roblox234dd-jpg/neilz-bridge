-- Roblox AI Bridge: provider selection and enforced client-side permissions.
local CoreGui = game:GetService("CoreGui")
local HttpService = game:GetService("HttpService")
local Players = game:GetService("Players")
local TweenService = game:GetService("TweenService")
local UserInputService = game:GetService("UserInputService")
local LogService = game:GetService("LogService")
local old = CoreGui:FindFirstChild("AIMCP_Executor_Bridge")
if old then old:Destroy() end
local ScreenGui = Instance.new("ScreenGui")
ScreenGui.Name = "AIMCP_Executor_Bridge"
ScreenGui.ResetOnSpawn = false
ScreenGui.ZIndexBehavior = Enum.ZIndexBehavior.Sibling
ScreenGui.Parent = CoreGui
local Permissions = { explorer = true, properties = true, localScripts = false, console = false, screenshots = false, runScripts = false }
local consoleEntries={}
local SelectedProvider = nil
local IsConnected = false
local CompletedRequests = 0
local colors = { bg = Color3.fromRGB(16, 19, 28), card = Color3.fromRGB(26, 31, 44), border = Color3.fromRGB(45, 53, 72), accent = Color3.fromRGB(126, 112, 255), text = Color3.fromRGB(239, 242, 255), muted = Color3.fromRGB(142, 154, 180) }
local function make(class, parent, props)
 local object = Instance.new(class)
 for key, value in pairs(props) do object[key] = value end
 object.Parent = parent
 return object
end
local function round(object, radius) make("UICorner", object, { CornerRadius = UDim.new(0, radius) }) end
local function stroke(object) make("UIStroke", object, { Color = colors.border, Thickness = 1, Transparency = 0.2 }) end
local function label(parent, text, x, y, width, height, size, color)
 return make("TextLabel", parent, { Text = text, Position = UDim2.fromOffset(x,y), Size = UDim2.fromOffset(width,height), BackgroundTransparency = 1, Font = Enum.Font.Gotham, TextSize = size, TextColor3 = color or colors.text, TextXAlignment = Enum.TextXAlignment.Left })
end
local Frame = make("Frame", ScreenGui, { Size = UDim2.fromOffset(420,620), Position = UDim2.new(0.5,-210,0.5,-310), BackgroundColor3 = colors.bg, BorderSizePixel = 0, Active = false })
round(Frame,18); stroke(Frame)
make("Frame", Frame, { Position = UDim2.fromOffset(24,27), Size = UDim2.fromOffset(5,30), BackgroundColor3 = colors.accent, BorderSizePixel = 0 })
label(Frame,"Neilz Bridge",42,22,285,28,22)
label(Frame,"Connect your assistant to Roblox",42,54,325,18,12,colors.muted)
local close = make("TextButton",Frame,{Text="X",Position=UDim2.fromOffset(366,24),Size=UDim2.fromOffset(30,30),BackgroundColor3=colors.card,TextColor3=colors.muted,Font=Enum.Font.GothamBold,TextSize=13,BorderSizePixel=0})
round(close,8); close.MouseButton1Click:Connect(function() ScreenGui:Destroy() end)
label(Frame,"01  CHOOSE YOUR AI APP",24,94,372,18,10,colors.muted)
local ProviderBtn = make("TextButton",Frame,{Text="Choose an MCP application",Position=UDim2.fromOffset(24,120),Size=UDim2.fromOffset(372,44),BackgroundColor3=colors.card,TextColor3=colors.text,Font=Enum.Font.GothamMedium,TextSize=13,BorderSizePixel=0,TextXAlignment=Enum.TextXAlignment.Left})
make("UIPadding",ProviderBtn,{PaddingLeft=UDim.new(0,14),PaddingRight=UDim.new(0,32)})
local providerArrow=label(Frame,"v",367,133,18,18,12,colors.muted)
round(ProviderBtn,10);stroke(ProviderBtn)
local Apps = {
 {name="Codex",localMCP=true},
 {name="Claude Desktop",localMCP=true},
 {name="Claude Code",localMCP=true},
 {name="Cursor",localMCP=true},
 {name="GitHub Copilot (VS Code)",localMCP=true},
 {name="Gemini CLI",localMCP=true},
 {name="Antigravity",localMCP=true},
 {name="Devin Desktop / Cascade",localMCP=true},
 {name="Cline",localMCP=true},
 {name="ChatGPT (remote MCP)",localMCP=false},
 {name="Other",localMCP=true}
}
local dropdown = make("ScrollingFrame",Frame,{Position=UDim2.fromOffset(24,170),Size=UDim2.fromOffset(372,216),CanvasSize=UDim2.fromOffset(0,16+#Apps*39),ScrollBarThickness=4,ScrollBarImageColor3=colors.accent,ScrollingDirection=Enum.ScrollingDirection.Y,BackgroundColor3=colors.card,BorderSizePixel=0,Visible=false,ZIndex=30})
round(dropdown,10);stroke(dropdown)
local PortInput
local ConnectBtn = make("TextButton",Frame,{Text="Choose a provider to connect",Position=UDim2.fromOffset(24,239),Size=UDim2.fromOffset(372,44),BackgroundColor3=Color3.fromRGB(54,56,76),TextColor3=colors.muted,Font=Enum.Font.GothamBold,TextSize=13,BorderSizePixel=0,AutoButtonColor=false})
round(ConnectBtn,10)
local savedMouseBehavior, savedMouseIcon
local menuOwnsMouse=false
local Badge=label(ScreenGui,"AI Bridge | Right Shift: menu",18,82,310,22,11,colors.muted)
Badge.Active=false
local function restoreMouse()
 ConnectBtn.Modal=false
 if menuOwnsMouse then
  UserInputService.MouseBehavior=savedMouseBehavior
  UserInputService.MouseIconEnabled=savedMouseIcon
  menuOwnsMouse=false
 end
end
local function setMenuVisible(visible)
 if not visible then
  PortInput:ReleaseFocus()
  dropdown.Visible=false
  restoreMouse()
  Frame.Visible=false
 elseif not menuOwnsMouse then
  savedMouseBehavior=UserInputService.MouseBehavior
  savedMouseIcon=UserInputService.MouseIconEnabled
  menuOwnsMouse=true
  Frame.Visible=true
  ConnectBtn.Modal=true
  UserInputService.MouseIconEnabled=true
  UserInputService.MouseBehavior=Enum.MouseBehavior.Default
 end
end
local AppHint
for index, app in ipairs(Apps) do
 local option = make("TextButton",dropdown,{Text=app.name,Position=UDim2.fromOffset(8,8+(index-1)*39),Size=UDim2.fromOffset(348,36),BackgroundTransparency=1,TextColor3=colors.text,Font=Enum.Font.GothamMedium,TextSize=13,TextXAlignment=Enum.TextXAlignment.Left,ZIndex=31})
 make("UIPadding",option,{PaddingLeft=UDim.new(0,12)})
 option.MouseButton1Click:Connect(function()
  if IsConnected then return end
  SelectedProvider=app.name;ProviderBtn.Text=app.name;dropdown.Visible=false
  AppHint.Text=app.localMCP and "Set up this bridge in the selected app." or "Remote MCP setup required for ChatGPT."
  ConnectBtn.Text="Connect";ConnectBtn.BackgroundColor3=colors.accent;ConnectBtn.TextColor3=colors.text
 end)
end
ProviderBtn.MouseButton1Click:Connect(function() if not IsConnected then dropdown.Visible=not dropdown.Visible end end)
AppHint=label(Frame,"Configure MCP in your app before connecting.",24,169,372,18,11,colors.muted)
label(Frame,"LOCAL PORT",24,200,110,22,10,colors.muted)
PortInput = make("TextBox",Frame,{Text="8080",PlaceholderText="8080",ClearTextOnFocus=false,Position=UDim2.fromOffset(287,193),Size=UDim2.fromOffset(109,32),BackgroundColor3=colors.card,TextColor3=colors.text,Font=Enum.Font.Gotham,TextSize=12,BorderSizePixel=0})
round(PortInput,8);stroke(PortInput)
local NextPort=make("TextButton",Frame,{Text="Next port >",Position=UDim2.fromOffset(162,193),Size=UDim2.fromOffset(113,32),BackgroundColor3=colors.card,TextColor3=colors.muted,Font=Enum.Font.Gotham,TextSize=11,BorderSizePixel=0})
round(NextPort,8)
NextPort.MouseButton1Click:Connect(function()
 if IsConnected then return end
 local current=tonumber(PortInput.Text) or 8079
 PortInput.Text=tostring((current>=9000 or current<8080) and 8080 or current+1)
end)
local minimize=make("TextButton",Frame,{Text="-",Position=UDim2.fromOffset(330,24),Size=UDim2.fromOffset(30,30),BackgroundColor3=colors.card,TextColor3=colors.muted,Font=Enum.Font.GothamBold,TextSize=16,BorderSizePixel=0})
round(minimize,8)
minimize.MouseButton1Click:Connect(function() setMenuVisible(false) end)
local menuConnection=UserInputService.InputBegan:Connect(function(input)
 if input.KeyCode==Enum.KeyCode.RightShift and not UserInputService:GetFocusedTextBox() then setMenuVisible(not Frame.Visible) end
end)
setMenuVisible(true)
local StatusLabel=label(Frame,"Status: Disconnected",24,290,372,28,12,colors.muted)
label(Frame,"02  ASSISTANT PERMISSIONS",24,332,372,18,10,colors.muted)
local permissionList=make("ScrollingFrame",Frame,{Position=UDim2.fromOffset(24,358),Size=UDim2.fromOffset(372,218),CanvasSize=UDim2.fromOffset(0,336),BackgroundTransparency=1,BorderSizePixel=0,ScrollBarThickness=4,ScrollBarImageColor3=colors.accent,ScrollingDirection=Enum.ScrollingDirection.Y})
local function permissionRow(key,title,description,y)
 local row=make("Frame",permissionList,{Position=UDim2.fromOffset(0,y),Size=UDim2.fromOffset(364,48),BackgroundColor3=colors.card,BorderSizePixel=0})
 round(row,10)
 label(row,title,14,7,270,18,12)
 label(row,description,14,26,275,14,10,colors.muted)
 local toggle=make("TextButton",row,{Text="",Position=UDim2.fromOffset(314,13),Size=UDim2.fromOffset(44,24),BorderSizePixel=0,AutoButtonColor=false})
 round(toggle,12)
 local knob=make("Frame",toggle,{Size=UDim2.fromOffset(18,18),BackgroundColor3=colors.text,BorderSizePixel=0})
 round(knob,9)
 local function update(animated)
  local tint=Permissions[key] and colors.accent or Color3.fromRGB(64,73,94)
  local position=UDim2.fromOffset(Permissions[key] and 23 or 3,3)
  if animated then
   TweenService:Create(toggle,TweenInfo.new(0.15),{BackgroundColor3=tint}):Play()
   TweenService:Create(knob,TweenInfo.new(0.15),{Position=position}):Play()
  else toggle.BackgroundColor3=tint;knob.Position=position end
 end
 update(false)
 toggle.MouseButton1Click:Connect(function()
  Permissions[key]=not Permissions[key];update(true)
  if key=="console" and not Permissions.console then
   -- Clear captured messages immediately when console permission is revoked.
   table.clear(consoleEntries)
  end
 end)
end
permissionRow("explorer","Explorer","View instance names and hierarchy",0)
permissionRow("properties","Properties","Include supported instance properties",56)
permissionRow("localScripts","LocalScripts","Read LocalScript source only",112)
permissionRow("console","Console logs","Read this client's recent console messages",168)
permissionRow("screenshots","Screenshots","Capture the foreground Roblox window",224)
permissionRow("runScripts","Run scripts","Allow the assistant to run Lua code",280)
local RequestsLabel=label(Frame,"0 requests completed",24,586,220,18,10,colors.muted)
label(Frame,"Scroll for more",274,586,122,18,10,colors.muted)
local ConnectionsLabel=label(Frame,"Ports 8080-9000 | AI clients: -- / 20",24,609,372,16,10,colors.muted)
Frame.Size=UDim2.fromOffset(420,644)
-- Drag the header. Buttons and permission controls do not start a drag.
local dragging=false
local dragStart,frameStart
Frame.InputBegan:Connect(function(input)
 if (input.UserInputType==Enum.UserInputType.MouseButton1 or input.UserInputType==Enum.UserInputType.Touch) and input.Position.Y-Frame.AbsolutePosition.Y<85 then
  dragging=true;dragStart=input.Position;frameStart=Frame.Position
 end
end)
local moveConnection=UserInputService.InputChanged:Connect(function(input)
 if dragging and (input.UserInputType==Enum.UserInputType.MouseMovement or input.UserInputType==Enum.UserInputType.Touch) then
  local delta=input.Position-dragStart
  Frame.Position=UDim2.new(frameStart.X.Scale,frameStart.X.Offset+delta.X,frameStart.Y.Scale,frameStart.Y.Offset+delta.Y)
 end
end)
local endConnection=UserInputService.InputEnded:Connect(function(input)
 if input.UserInputType==Enum.UserInputType.MouseButton1 or input.UserInputType==Enum.UserInputType.Touch then dragging=false end
end)
local function addConsole(message,kind,stamp)
 if not Permissions.console then return end
 table.insert(consoleEntries,{message=string.sub(tostring(message),1,4000),messageType=tostring(kind),timestamp=stamp})
 if #consoleEntries>100 then table.remove(consoleEntries,1) end
end
-- Record only while Console logs is enabled; do not collect history on startup.
local logConnection=LogService.MessageOut:Connect(function(message,kind)
 addConsole(message,kind,os.time())
end)
ScreenGui.Destroying:Connect(function()
 restoreMouse();menuConnection:Disconnect()
 moveConnection:Disconnect();endConnection:Disconnect();logConnection:Disconnect()
end)
-- Explorer uses JSON-safe fields and never decompiles scripts during traversal.
local generation = 0
local function setStatus(message, good)
    if not ScreenGui.Parent then return end
    StatusLabel.Text = "Status: " .. message
    Badge.Text="AI Bridge | "..message.." | Right Shift"
    StatusLabel.TextColor3 = good and Color3.fromRGB(100, 255, 100) or Color3.fromRGB(255, 170, 100)
end
local function getHttpFunction()
    if type(request) == "function" then return request end
    if type(http_request) == "function" then return http_request end
    if type(syn) == "table" and type(syn.request) == "function" then return syn.request end
    error("HTTP request API is unavailable in this environment")
end
local function findInstance(path)
    if path == nil or path == "" or path == "game" then return game end
    if type(path) ~= "string" then error("path must be a string") end
    local target = game
    for index, part in ipairs(string.split(path, ".")) do
        if not (index == 1 and part == "game") then
            -- LocalPlayer is a property, not necessarily a child named LocalPlayer.
            if target == Players and part == "LocalPlayer" then target = Players.LocalPlayer
            else target = target:FindFirstChild(part) end
            if not target then error("Instance not found: " .. path) end
        end
    end
    return target
end
local function serialize(inst, depth, budget)
    budget.count += 1
    local data = {
        Name = inst.Name, ClassName = inst.ClassName, FullName = inst:GetFullName(),
        Children = {}
    }
    if Permissions.properties then
    data.Properties = { Parent = tostring(inst.Parent), Archivable = inst.Archivable }
    if inst:IsA("BasePart") then
        data.Properties.Position = tostring(inst.Position)
        data.Properties.Size = tostring(inst.Size)
        data.Properties.Anchored = inst.Anchored
        data.Properties.CanCollide = inst.CanCollide
    elseif inst:IsA("ValueBase") then data.Properties.Value = tostring(inst.Value) end
    end
    local children = inst:GetChildren()
    data.ChildCount = #children
    if depth < 3 then
        for _, child in ipairs(children) do
            if budget.count >= 1000 then data.Truncated = true; break end
            table.insert(data.Children, serialize(child, depth + 1, budget))
        end
    elseif #children > 0 then data.Truncated = true end
    return data
end
local function execute(command)
    if command.action == "authorize_screenshot" then
        if not Permissions.screenshots then error("Permission denied: Screenshots access is disabled") end
        if Frame.Visible then error("Hide the Bridge menu with Right Shift before taking a screenshot") end
        return {authorized=true}
    elseif command.action == "run_script" then
        if not Permissions.runScripts then error("Permission denied: Run scripts access is disabled") end
        if type(command.source)~="string" or #command.source==0 or #command.source>100000 then error("source must contain 1 to 100000 bytes") end
        if type(loadstring)~="function" then error("loadstring is unavailable in this environment") end
        local code,compileError=loadstring(command.source,"AI Bridge "..command.req_id)
        if not code then error("Compilation failed: "..tostring(compileError)) end
        task.defer(function()
            if not Permissions.runScripts or not ScreenGui.Parent then return end
            local success,failure=pcall(code)
            if success then print("[AI Bridge Run] Finished: "..command.req_id)
            else warn("[AI Bridge Run] Failed: "..command.req_id.." | "..string.sub(tostring(failure),1,4000)) end
        end)
        return {scheduled=true,runId=command.req_id,message="Execution scheduled; completion or errors appear in the client console. Revocation prevents queued starts but does not stop code already running."}
    elseif command.action == "get_console_logs" then
        if not Permissions.console then error("Permission denied: Console logs access is disabled") end
        local limit=tonumber(command.limit) or 50
        limit=math.clamp(math.floor(limit),1,100)
        local entries={}
        for index=math.max(1,#consoleEntries-limit+1),#consoleEntries do
            table.insert(entries,consoleEntries[index])
        end
        return { entries=entries, scope="Client console; captured while permission is enabled" }
    elseif command.action == "get_explorer_tree" then
        if not Permissions.explorer then error("Permission denied: Explorer access is disabled") end
        return serialize(findInstance(command.path), 1, { count = 0 })
    elseif command.action == "read_script" then
        if not Permissions.localScripts then error("Permission denied: LocalScript access is disabled") end
        local target = findInstance(command.path)
        if not target:IsA("LocalScript") then error("Only LocalScript source is permitted by this menu") end
        -- Source works in supported Studio contexts; executor decompilation is optional.
        local ok, source = pcall(function()
            return game:GetService("ScriptEditorService"):GetEditorSource(target)
        end)
        if not ok then ok, source = pcall(function() return target.Source end) end
        if not ok and type(decompile) == "function" then ok, source = pcall(decompile, target) end
        if not ok or type(source) ~= "string" then error("Source unavailable: " .. tostring(source)) end
        if not Permissions.localScripts then error("Permission denied: LocalScript access was revoked") end
        return { source = source }
    end
    error("Unknown action: " .. tostring(command.action))
end
local function enforceResponse(command,result)
    if command.action=="authorize_screenshot" and not Permissions.screenshots then
        return {error="Permission denied: Screenshots access was revoked"}
    elseif command.action=="get_explorer_tree" then
        if not Permissions.explorer then return {error="Permission denied: Explorer access was revoked"} end
        if not Permissions.properties then
            local function strip(node)
                if type(node)~="table" then return end
                node.Properties=nil
                for _,child in ipairs(node.Children or {}) do strip(child) end
            end
            strip(result)
        end
    elseif command.action=="read_script" and not Permissions.localScripts then
        return {error="Permission denied: LocalScript access was revoked"}
    elseif command.action=="get_console_logs" and not Permissions.console then
        return {error="Permission denied: Console logs access was revoked"}
    end
    return result
end
local function process(command, httpCall, baseUrl, isActive)
    if type(command) ~= "table" or type(command.req_id) ~= "string" then error("Invalid task: req_id is missing") end
    local ok, result = pcall(execute, command)
    if not ok then result = { error = tostring(result) } end
    local lastError
    for attempt = 1, 3 do
        if not isActive() then return end
        result=enforceResponse(command,result)
        local encoded,body=pcall(function() return HttpService:JSONEncode({req_id=command.req_id,data=result}) end)
        if not encoded or #body>4*1024*1024 then
            body=HttpService:JSONEncode({req_id=command.req_id,data={error=encoded and "Result exceeds bridge response limit" or ("JSON encoding failed: "..tostring(body))}})
        end
        local sent, response = pcall(httpCall, { Url = baseUrl .. "/mcp_response", Method = "POST", Headers = { ["Content-Type"] = "application/json" }, Body = body })
        if sent and type(response) == "table" and response.StatusCode == 200 then
            CompletedRequests+=1
            RequestsLabel.Text=tostring(CompletedRequests).." requests completed"
            print("[MCP GUI] Reply sent: " .. command.req_id)
            return
        end
        if sent and type(response) == "table" and response.StatusCode == 404 then error("Task expired or already completed: " .. command.req_id) end
        lastError = sent and type(response) == "table" and ("HTTP " .. tostring(response.StatusCode) .. ": " .. tostring(response.Body)) or tostring(response)
        task.wait(0.5 * attempt)
    end
    error("Response POST failed: " .. tostring(lastError))
end
local function StartBridgeLoop()
    if not SelectedProvider then setStatus("Choose an AI provider first", false); return end
    local port = tonumber(PortInput.Text)
    if not port or port % 1 ~= 0 or port < 8080 or port > 9000 then setStatus("Choose a port from 8080 to 9000", false); return end
    local ok, rawHttpCall = pcall(getHttpFunction)
    if not ok then setStatus("HTTP API unavailable", false); warn("[MCP GUI] " .. tostring(rawHttpCall)); return end
    local function httpCall(options)
        options.Headers = options.Headers or {}
        options.Headers["X-Roblox-MCP"] = "1"
        return rawHttpCall(options)
    end
    generation += 1
    local myGeneration = generation
    local baseUrl = "http://127.0.0.1:" .. tostring(port)
    local function isActive() return IsConnected and generation == myGeneration and ScreenGui.Parent ~= nil end
    IsConnected = true
    dropdown.Visible=false
    ConnectBtn.Text = "Disconnect"
    ConnectBtn.BackgroundColor3 = Color3.fromRGB(200, 50, 50)
    PortInput.TextEditable = false
    setStatus("Checking bridge...", false)
    task.spawn(function()
        -- GET /health checks the server without taking a queued task.
        local verified, failure = pcall(function()
            local response = httpCall({ Url = baseUrl .. "/health", Method = "GET" })
            if type(response) ~= "table" then error("Health check returned no HTTP response") end
            if response.StatusCode ~= 200 then
                local details = {}
                for key, value in pairs(response) do
                    table.insert(details, tostring(key) .. "=" .. tostring(value))
                end
                error("Health check failed: HTTP " .. tostring(response.StatusCode) .. " | Response: " .. table.concat(details, "; ") .. " | URL: " .. baseUrl .. "/health")
            end
            local health = HttpService:JSONDecode(response.Body)
            if type(health) ~= "table" or health.bridgeListening ~= true or type(health.version) ~= "string" then error("This port is not serving the expected MCP bridge") end
            if health.sharedProtocol~=2 then error("Update and restart the MCP server to Neilz Bridge 1.5.0") end
            ConnectionsLabel.Text="Ports 8080-9000 | AI clients: "..tostring(health.connections and health.connections.active or "--").." / 20"
        end)
        if not isActive() then return end
        if not verified then
            IsConnected = false
            PortInput.TextEditable = true
            ConnectBtn.Text = "Connect"
            ConnectBtn.BackgroundColor3=colors.accent
            setStatus("Connection failed; see console", false)
            warn("[MCP GUI] " .. tostring(failure))
            return
        end
        setMenuVisible(false)
        local failures,lastHealth = 0,0
        while isActive() do
            local success, err = pcall(function()
                local response = httpCall({ Url = baseUrl .. "/mcp_poll", Method = "GET" })
                if not isActive() then return end
                if type(response) ~= "table" then error("Invalid HTTP response") end
                if response.StatusCode ~= 200 and response.StatusCode ~= 204 then error("Poll HTTP " .. tostring(response.StatusCode) .. ": " .. tostring(response.Body)) end
                if tick()-lastHealth>=5 then
                    lastHealth=tick()
                    local check=httpCall({Url=baseUrl.."/health",Method="GET"})
                    if type(check)=="table" and check.StatusCode==200 then
                        local health=HttpService:JSONDecode(check.Body)
                        ConnectionsLabel.Text="Ports 8080-9000 | AI clients: "..tostring(health.connections and health.connections.active or "--").." / 20"
                    end
                end
                setStatus("Connected to local bridge", true)
                if response.StatusCode == 200 then
                    setStatus("Processing task...", true)
                    process(HttpService:JSONDecode(response.Body), httpCall, baseUrl, isActive)
                    if isActive() then setStatus("Reply sent", true) end
                end
            end)
            if not isActive() then break end
            if success then failures = 0 else
                failures += 1
                setStatus("Error; see console", false)
                if failures == 1 or failures % 10 == 0 then warn("[MCP GUI] " .. tostring(err)) end
            end
            task.wait(success and 0.5 or math.min(failures, 5))
        end
    end)
end
ConnectBtn.MouseButton1Click:Connect(function()
    if IsConnected then
        IsConnected = false; generation += 1
        PortInput.TextEditable = true
        ConnectBtn.Text = "Connect"
        ConnectBtn.BackgroundColor3 = colors.accent
        setStatus("Disconnected", false)
    else StartBridgeLoop() end
end)
ScreenGui.Destroying:Connect(function() IsConnected = false; generation += 1 end)
print("[MCP GUI] Provider selector is only a label. The actual AI client is configured outside Roblox.")
