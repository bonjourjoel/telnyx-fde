# Deploy and test MCP

Run from the project root in PowerShell.

## Deploy

```powershell
npm.cmd run deploy
```

Wait for deployment and the script's checks to complete successfully.

## Test the public MCP

Modern protocol:

```powershell
node --import tsx scripts/check-mcp.ts --url https://telnyx-fde-0768c5c4-b.telnyxcompute.com/mcp
```

2025 protocol:

```powershell
node --import tsx scripts/check-mcp.ts --legacy --url https://telnyx-fde-0768c5c4-b.telnyxcompute.com/mcp
```

Both commands must finish with `"outcome":"ok"`, `"tool_count":3`, and
`"topic_count":12`. They read all topics and check invalid inputs automatically.
