# Neilz Bridge

Neilz Bridge 1.5.0 connects MCP-compatible AI applications to a Roblox client through a local HTTP bridge. It uses MCP over STDIO and listens only on 127.0.0.1.

## Features

- English GUI with application selection and independent permissions.
- Explorer hierarchy and supported properties.
- LocalScript source reading where the client environment allows it.
- Recent client console messages, recorded only while permission is enabled.
- PNG screenshots of the foreground Roblox window on Windows.
- Optional Lua execution through the client's available loadstring function.
- Port selection from **8080 through 9000**.
- Up to **20 simultaneous AI clients per shared HTTP bridge**, including the owning MCP process. A 21st client is refused instead of creating another bridge to bypass the limit. The Roblox GUI itself does not consume an AI-client slot.

The port range contains 921 possible addresses; it is separate from the 20-client limit. Independent HTTP bridges have independent limits and require their own connected Roblox client. Application names in the GUI are labels: configure MCP in the external application separately.

## Install

Install Node.js 22 or newer, then download or clone this repository and run:

```sh
npm ci
npm test
```

Configure an MCP client to start `node` with the absolute path to `server.mjs`:

```json
{
  "mcpServers": {
    "neilz-bridge": {
      "command": "node",
      "args": ["/absolute/path/to/neilz-bridge/server.mjs"],
      "env": {
        "ROBLOX_BRIDGE_PORT": "8080",
        "ROBLOX_BRIDGE_PORT_END": "9000"
      }
    }
  }
}
```

For Codex CLI, replace the example path with the actual path:

```sh
codex mcp add neilz-bridge --env ROBLOX_BRIDGE_PORT=8080 --env ROBLOX_BRIDGE_PORT_END=9000 -- node /absolute/path/to/neilz-bridge/server.mjs
```

Restart the MCP application after upgrading. Existing server processes keep their old code until restarted.

Run `executor-gui-client.luau` in your authorized Roblox client environment. It needs an HTTP request API (`request`, `http_request`, or `syn.request`) and access to CoreGui. Choose an AI app, enter the actual port shown by `get_roblox_bridge_status`, and click Connect. The new GUI requires shared protocol 2 (server 1.5.0).

**Right Shift** shows or hides the menu. Connecting hides it automatically and restores the previous mouse settings. The header has minimize and close buttons. Next port cycles from 8080 through 9000; the port can also be entered directly.

## Permissions

| Permission | Default | Effect |
| --- | --- | --- |
| Explorer | On | Read object names, classes and hierarchy |
| Properties | On | Include supported properties in Explorer results |
| LocalScripts | Off | Read LocalScript source; availability depends on the environment |
| Console logs | Off | Record up to 100 recent client messages while enabled; clear them when disabled |
| Screenshots | Off | Capture visible pixels inside the foreground Roblox window on Windows |
| Run scripts | Off | Compile and schedule Lua code in the client |

Permissions apply to **all AI clients sharing this bridge**. Previously delivered data cannot be recalled. Disabling Run scripts prevents queued starts but cannot stop code that is already running. Only enable it for clients you trust.

Screenshots require a hidden Bridge menu and a foreground RobloxPlayerBeta or RobloxStudioBeta window on the same Windows computer. Images are reduced to at most 1440 pixels on the longer side, limited to 4 MiB, and returned as MCP image content without saving to disk. Visible notifications or overlays can appear in the capture. Permission is checked before capture and again before sending the image.

Run scripts accepts 1–100000 UTF-8 bytes. A scheduling response is not confirmation of successful completion. Enable Console logs to read `[AI Bridge Run]` completion and error messages. There is no feature for recovering source code of previously executed console scripts.

## MCP tools

| Tool | Arguments |
| --- | --- |
| get_roblox_bridge_status | None |
| get_roblox_explorer | Optional `path`, default Workspace |
| read_roblox_script | Required `path` |
| get_roblox_console | Optional `limit`, 1–100 |
| get_roblox_screenshot | None |
| run_roblox_script | Required `source` |

Instance paths are dot-separated; object names containing dots are ambiguous. Explorer results are limited to three levels and 1000 objects. Source reading tries ScriptEditorService, Source, and optionally an available decompile function. Source access and execution are not ordinary unrestricted LocalScript capabilities.

## Multiple clients and ports

The first MCP process owns an HTTP port. Later processes reuse a compatible owner and register leased sessions. Idle sessions are renewed every two seconds and expire after 15 seconds without renewal. Graceful shutdown releases the slot immediately. If the owner stops, another process can take over the same port; in-flight jobs may fail and execution requests are not automatically replayed.

An incompatible or unrelated service on a port causes the server to try the next port through ROBLOX_BRIDGE_PORT_END. If all ports are occupied, scanning retries. A full compatible bridge refuses new AI clients rather than silently creating another bridge. Status reports mode, actual URL, port range, current connections, maximum connections, polling and recent responses.

Environment variables:

- ROBLOX_BRIDGE_PORT: first candidate, default 8080.
- ROBLOX_BRIDGE_PORT_END: last candidate, default 9000.
- ROBLOX_BRIDGE_TIMEOUT_MS: task response timeout, default 15000.

## Troubleshooting

- **No client fetched this task:** check that Roblox is running the GUI, the port matches the status URL, and Explorer permission is enabled. Check client console HTTP errors.
- **Instance not found:** the bridge responded, but the requested object does not exist in the current game or path.
- **20 simultaneous AI clients:** close an unused MCP client; an ungracefully disconnected session releases after its lease expires.
- **Permission denied:** enable the corresponding toggle in the GUI.
- **Update and restart:** replace the server and GUI files, restart the MCP application, and unload the old GUI before running the new one.

Use `/health` for diagnostics. Do not manually browse `/mcp_poll`; it consumes queued tasks.

## Studio alternative

`studio-client.luau` and `RobloxMCPBridge.rbxmx` are a legacy read-only Studio alternative for Explorer and project source. The six-permission menu, screenshots, console capture and Lua execution described above belong to `executor-gui-client.luau`; they are not implemented by the legacy plugin. Do not run the plugin and GUI against the same bridge simultaneously.

## Verification

`npm test` uses simulated Roblox HTTP responses to check MCP tools, permissions/errors, queue ordering, timeouts, shared clients, owner recovery, fallback ports, the 20-client limit and session expiry. It does not execute code inside a real Roblox game or take screenshots. The GUI has also been compiled with the official Luau compiler; Windows capture bindings and PNG encoding were checked independently.
