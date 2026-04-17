# ACR Demo Recording Script

Use this to record the terminal GIF for the README.

## Setup
- Claude Code with ACR MCP configured
- At least 10 interactions logged (run a normal session first)
- Use a terminal with a dark theme and clear font

## Sequence (record with asciinema or ttyrec)

1. `get_my_agent`
   — Shows identity, health card with real friction flag, grouped tool menu

2. `summarize_my_agent`
   — Shows profile receipt count, friction summary (week), coverage gaps

3. `get_friction_report` (scope: week)
   — Full friction report: top targets with % and absolute seconds,
     wasted time on failures, always-visible section headers

4. `getting_started`
   — Step-by-step checklist showing current state

## Tips
- Pause 1–2s between calls for readability
- Crop to ~100 cols × 40 rows
- Export as GIF at 1.5× speed
- Embed in packages/mcp-server/README.md above the tools table
