# E2E Tests

End-to-end tests for the OpenCode Stats Dashboard plugin workflow.

## Overview

These tests verify the complete plugin lifecycle:
1. Sidecar starts and listens on localhost
2. Synthetic events are sent via curl
3. Dashboard displays the ingested data
4. No events are lost in the pipeline

## Running

```bash
# Run the full E2E test script
scripts/e2e.sh

# Or run individual test suites
~/.bun/bin/bun test plugin integration
npx playwright test dashboard-sessions-table
```

## Requirements

- Bun: `~/.bun/bin/bun` (for plugin integration tests)
- Rust/Cargo: For building the sidecar
- Node.js: For Playwright tests
- Playwright browsers: `npx playwright install` (for dashboard UI tests)

## Test Scenarios

### Scenario 1: Full Delete Workflow
- Send `session-created`, `usage-updated`, `session-deleted` events
- Verify `/api/sessions` contains the deleted session
- Verify dashboard is accessible

### Scenario 2: Loopback Only
- Verify sidecar binds to `127.0.0.1` only
- No external network access

### Scenario 3: No Event Loss
- Send multiple events
- Verify all events are persisted
- Verify dashboard shows correct totals
