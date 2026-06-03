#!/usr/bin/env bash
set -euo pipefail

# ============================================================================
# Integration Regression Suite — runs ALL tests from a clean checkout.
#
# Usage:
#   ./scripts/test-all.sh           # run all suites
#   ./scripts/test-all.sh --fast    # skip Playwright E2E (no build/start)
#
# Suites (in order):
#   1. cargo test          — Rust sidecar unit/integration tests
#   2. bun test plugin     — plugin unit tests
#   3. bun test dashboard  — dashboard unit tests (client + store)
#   4. bun test integration — plugin integration tests (integration.test.ts)
#   5. playwright test     — E2E browser tests (skipped with --fast)
# ============================================================================

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

BUN_BIN="${HOME}/.bun/bin/bun"
SKIP_E2E=false

for arg in "$@"; do
  case "$arg" in
    --fast) SKIP_E2E=true ;;
  esac
done

# ── Colors ──────────────────────────────────────────────────────────────────
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'

log_info()  { echo -e "${GREEN}[PASS]${NC} $1"; }
log_fail()  { echo -e "${RED}[FAIL]${NC} $1"; }
log_run()   { echo -e "${CYAN}[RUN]${NC}  $1"; }
log_skip()  { echo -e "${YELLOW}[SKIP]${NC} $1"; }
log_phase() { echo -e "\n${CYAN}━━━ $1 ━━━${NC}"; }

# ── Result tracking ────────────────────────────────────────────────────────
TOTAL=0
PASSED=0
FAILED=0
SKIPPED=0
declare -a RESULTS=()

record_result() {
  local name="$1" status="$2"
  TOTAL=$((TOTAL + 1))
  case "$status" in
    pass) PASSED=$((PASSED + 1)); log_info "$name"; RESULTS+=("PASS  $name") ;;
    fail) FAILED=$((FAILED + 1)); log_fail "$name"; RESULTS+=("FAIL  $name") ;;
    skip) SKIPPED=$((SKIPPED + 1)); log_skip "$name"; RESULTS+=("SKIP  $name") ;;
  esac
}

# ── Cleanup helper for Playwright ──────────────────────────────────────────
SIDECAR_PID=""
cleanup() {
  if [ -n "$SIDECAR_PID" ]; then
    kill "$SIDECAR_PID" 2>/dev/null || true
    wait "$SIDECAR_PID" 2>/dev/null || true
  fi
}
trap cleanup EXIT

# ============================================================================
# Suite 1: Rust Sidecar Tests
# ============================================================================
log_phase "Suite 1: cargo test (sidecar)"
log_run "cargo test --manifest-path sidecar/Cargo.toml"

if cargo test --manifest-path "$PROJECT_ROOT/sidecar/Cargo.toml" 2>&1; then
  record_result "cargo test (sidecar)" pass
else
  record_result "cargo test (sidecar)" fail
fi

# ============================================================================
# Suite 2: Plugin Unit Tests
# ============================================================================
log_phase "Suite 2: bun test plugin"
log_run "$BUN_BIN test plugin"

if "$BUN_BIN" test plugin 2>&1; then
  record_result "bun test plugin" pass
else
  record_result "bun test plugin" fail
fi

# ============================================================================
# Suite 3: Dashboard Unit Tests
# ============================================================================
log_phase "Suite 3: bun test dashboard"
log_run "$BUN_BIN test dashboard/src/api/client.test.ts dashboard/src/stores/stats.test.ts"

if "$BUN_BIN" test dashboard/src/api/client.test.ts dashboard/src/stores/stats.test.ts 2>&1; then
  record_result "bun test dashboard" pass
else
  record_result "bun test dashboard" fail
fi

# ============================================================================
# Suite 4: Plugin Integration Tests
# ============================================================================
log_phase "Suite 4: bun test integration"
log_run "$BUN_BIN test plugin/test/integration.test.ts"

if "$BUN_BIN" test plugin/test/integration.test.ts 2>&1; then
  record_result "bun test integration" pass
else
  record_result "bun test integration" fail
fi

# ============================================================================
# Suite 5: Playwright E2E Tests
# ============================================================================
log_phase "Suite 5: Playwright E2E"

if [ "$SKIP_E2E" = true ]; then
  log_skip "Playwright E2E (--fast flag)"
  record_result "playwright e2e" skip
else
  # Build sidecar + dashboard for E2E
  log_run "Building sidecar for E2E..."
  if cargo build --manifest-path "$PROJECT_ROOT/sidecar/Cargo.toml" 2>&1; then
    log_run "Building dashboard for E2E..."
    "$BUN_BIN" --cwd "$PROJECT_ROOT/dashboard" run build 2>&1
    rm -rf "$PROJECT_ROOT/sidecar/static"
    cp -r "$PROJECT_ROOT/dashboard/dist" "$PROJECT_ROOT/sidecar/static"

    # Start sidecar in background
    "$PROJECT_ROOT/sidecar/target/debug/sidecar-api" &
    SIDECAR_PID=$!

    # Wait for sidecar health
    READY=false
    for i in $(seq 1 30); do
      if curl -s "http://127.0.0.1:8080/health" > /dev/null 2>&1; then
        READY=true
        break
      fi
      sleep 1
    done

    if [ "$READY" = true ]; then
      log_run "bunx playwright test"
      if "$BUN_BIN"x playwright test 2>&1; then
        record_result "playwright e2e" pass
      else
        record_result "playwright e2e" fail
      fi

      # Stop sidecar
      kill "$SIDECAR_PID" 2>/dev/null || true
      wait "$SIDECAR_PID" 2>/dev/null || true
      SIDECAR_PID=""
    else
      log_fail "Sidecar failed to start within 30s"
      record_result "playwright e2e" fail
      kill "$SIDECAR_PID" 2>/dev/null || true
      wait "$SIDECAR_PID" 2>/dev/null || true
      SIDECAR_PID=""
    fi
  else
    log_fail "Sidecar build failed"
    record_result "playwright e2e" fail
  fi
fi

# ============================================================================
# Summary
# ============================================================================
echo ""
echo -e "${CYAN}══════════════════════════════════════════════${NC}"
echo -e "${CYAN}  Integration Regression Suite — Results${NC}"
echo -e "${CYAN}══════════════════════════════════════════════${NC}"
for r in "${RESULTS[@]}"; do
  case "$r" in
    PASS*) echo -e "  ${GREEN}$r${NC}" ;;
    FAIL*) echo -e "  ${RED}$r${NC}" ;;
    SKIP*) echo -e "  ${YELLOW}$r${NC}" ;;
  esac
done
echo -e "${CYAN}──────────────────────────────────────────────${NC}"
echo -e "  Total: $TOTAL  |  Passed: ${GREEN}$PASSED${NC}  |  Failed: ${RED}$FAILED${NC}  |  Skipped: ${YELLOW}$SKIPPED${NC}"
echo -e "${CYAN}══════════════════════════════════════════════${NC}"

if [ "$FAILED" -gt 0 ]; then
  echo -e "\n${RED}ABORT: $FAILED suite(s) failed.${NC}"
  exit 1
fi

echo -e "\n${GREEN}All suites passed.${NC}"
exit 0
