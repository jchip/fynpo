## node.js tools

- No `npm`, `npx`
- `fyn` -> `npm`: `fyn install`, `fyn add [--dev] package`
- `xrun --serial a b c` -> `npm run`
- `xrun a b c`: concurrent `npm run`
- `nvx` -> `npx`

## Debug & Testing

- Store temp/debug files in `.temp`
- Store temporary code as files in `.temp` and not running them inline with node

## Playwright MCP — Quick Reference

**Tools (`mcp__playwright_`):**
`navigate`, `screenshot`, `console`, `click`, `fill`, `execute`, `snapshot`, `reload`

**Save to File:**

- `navigate` accepts `snapshotFile` parameter to save page snapshot, default to `navigate-{timestamp}.yaml`, set to `false` to use inline output.
- `console_messages` accepts `filename` parameter to save console logs, default to `console-{timestamp}.txt`, set to `false` to use inline output.
- `network_requests` accepts `filename` parameter to save network requests
- `evaluate` accepts `filename` parameter to save evaluation result

**Best Practices:**

- **ALWAYS** use `snapshotFile` parameter when navigating to save snapshots to `.temp/` directory
- Example: `navigate(url, snapshotFile: ".temp/snapshot.yaml")`
- This prevents large snapshots from cluttering conversation context

**Workflow:**
Navigate → console → screenshot → save logs (Write) → search (Grep)

**Common Tasks:**

- Debug: navigate → console → save
- Test: navigate → screenshot → click → screenshot → console
- Reload: `reload` (clear cache optional)
