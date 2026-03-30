<!-- changedown.com/v1: tracked -->
# Install

## VS Code / Cursor

Search **ChangeDown** in the Extensions panel, or:

```
ext install changedown
```

## MCP Server

Paste into `claude_desktop_config.json`, `.cursor/mcp.json`, or equivalent:[^cn-1]

```json
{
  "mcpServers": {
    "changedown": {
      "command": "npx",
      "args": ["@changedown/mcp-server"]
    }
  }
}
```

Six tools become available: `propose_change`, `amend_change`, `supersede_change`, `review_changes`, `list_changes`, `read_tracked_file`.

## Core Library

```bash
npm install @changedown/core
```

{~~Parser, operations engine, and view rendering. Use it in your own tools.~>Parser, operations engine, and view rendering. Build your own integrations.~~}[^cn-3]


[^cn-1]: @ai:claude-opus-4.6 | 2026-03-13 | sub | accepted
    @ai:claude-opus-4.6 2026-03-13T06:08:37Z: Lead with the action verb. "Add to" is ambiguous — paste is what they'll actually do.
    approved: @human:hackerbara 2026-03-13T06:09:41Z "right — tell them exactly where to paste it"

[^cn-3]: @human:hackerbara | 2026-03-13 | sub | proposed
    @human:hackerbara 2026-03-13T06:09:10Z: say what they get, not what they should do with it