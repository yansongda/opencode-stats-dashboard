#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

echo "=== Building Vue dashboard ==="
bun --cwd "$PROJECT_ROOT/dashboard" run build

echo "=== Copying dashboard dist to sidecar/static ==="
rm -rf "$PROJECT_ROOT/sidecar/static"
cp -r "$PROJECT_ROOT/dashboard/dist" "$PROJECT_ROOT/sidecar/static"

echo "=== Building Rust sidecar ==="
cargo build --manifest-path "$PROJECT_ROOT/sidecar/Cargo.toml"

echo "=== Build complete ==="
