#!/usr/bin/env bash
# Runs the test suite. Uses embedded-postgres for API tests (no docker needed).
set -euo pipefail
cd "$(dirname "$0")"
[ -d node_modules ] || npm install
npm test
