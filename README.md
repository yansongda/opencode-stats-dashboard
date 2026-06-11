# opencode-stats-engine

OpenCode Event-Sourced Stats Engine is an OpenCode plugin that collects OpenCode events, stores them in SQLite, projects aggregate statistics, and serves a local HTTP dashboard with Server-Sent Events updates.

## Requirements

- [Bun](https://bun.sh/) runtime. This package uses Bun-specific APIs including `bun:sqlite` and `Bun.serve()`.
- OpenCode plugin runtime compatible with `@opencode-ai/plugin`.

## Installation

After the package is published:

```bash
bun add opencode-stats-engine
```

Configure your OpenCode setup to load the `opencode-stats-engine` plugin according to the OpenCode plugin configuration mechanism used by your environment.

## What it provides

- Event conversion for OpenCode session, message, and tool execution events.
- Append-only event persistence in SQLite.
- Projection handlers for sessions, messages, and tool calls.
- Local HTTP dashboard API and SPA dashboard.
- SSE stream for live dashboard updates.

The default dashboard server listens on `http://127.0.0.1:11133` unless `STATS_PORT` is set.

## Environment variables

| Variable | Default | Description |
| --- | --- | --- |
| `STATS_PORT` | `11133` | HTTP server port for the dashboard and API. |
| `STATS_DB_DIR` | `~/.local/share/opencode-stats-engine/` | Directory for the SQLite database and log file. |
| `STATS_DB_PATH` | `$STATS_DB_DIR/stats.db` | SQLite database path. |

## Dashboard

The npm package includes the prebuilt dashboard from `dashboard/dist/`. The plugin serves:

- REST API routes under `/api/v1/dashboard/*`
- SSE stream for live updates
- Dashboard static assets under `/assets/*`
- SPA fallback through `dashboard/dist/index.html`

Timezone-aware dashboard API endpoints accept an optional `tz` query parameter, such as `Asia/Shanghai` or `America/New_York`. Stored timestamps and projected `*_ms` fields remain UTC epoch milliseconds.

## Development

This repository uses Bun, TypeScript, Biome, Hono, and Vue 3 for the dashboard.

```bash
bun install
bun run biome:check
bun run typecheck
bun test
bun run build:dashboard
bun run build
```

## Publishing checklist

Before publishing to npm, run:

```bash
bun run biome:check
bun run typecheck
bun test
bun run build:dashboard
bun run build
npm pack --dry-run
```

Check the dry-run output before publishing. The package should include `dist/`, `dashboard/dist/`, `README.md`, `LICENSE`, and `package.json`, and should not include source tests, dashboard source files, or local dependency directories.

To publish publicly:

```bash
npm publish --access public
```

Do not publish until the dry-run package contents are correct.

## License

MIT
