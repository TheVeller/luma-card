# MCP maintenance

## Findings
- `list_events` reads `event_sources` in one query, so it silently stops at 1,000 rows: users with large libraries get incomplete or wrong results (sorting/limit applied after truncation).
- Status filter and sort run in memory over all sources instead of in the database.
- File names don't match tools (`list-events.ts` is `list_calendars`, `list-canonical-events.ts` is `list_events`).
- Errors returned as raw database messages instead of clean tool errors.
- No way to get one event's full detail or search by text; no pagination.
- SDK pinned at 0.24; server name `event-aggregator-mcp` vs required slug for the project display name.

## Changes
1. Rename tool files to match tool names (`list-calendars.ts`, `list-events.ts`).
2. Rewrite `list_events` to page through sources (or query `canonical_events` joined via sources with range paging), push status/date filters and ordering to the database, add `q` (name search), `from`/`to`, and `cursor` (offset) with `nextCursor` in the result.
3. New read-only tool `get_event`: one canonical event by id with description, sources (provider, URL, calendar), tags and enrichment — RLS as the user.
4. `list_calendars`: add event counts (from `get_event_library_stats`-style data where available) and keep `mine` filter.
5. Use `ToolError` for caller-facing failures; generic message for unexpected DB errors.
6. Update instructions text; bump server version to 0.4.0; upgrade `@lovable.dev/mcp-js` to latest if compatible.
7. Re-extract manifest, test 401 without token, update `docs/api.md` MCP section.

## Technical notes
- OAuth setup, consent page and RLS forwarding stay as-is (verified correct).
- No database or data changes.
- Republish needed afterwards.
