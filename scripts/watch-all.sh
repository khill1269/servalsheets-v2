#!/bin/bash
# Unified Watch Mode for Development
# Runs typecheck, tests, and dev server in parallel watch mode

set -e

echo "🔍 Starting unified watch mode..."
echo ""
echo "This will run in parallel:"
echo "  1. TypeScript type checking (watch mode)"
echo "  2. Test suite (watch mode)"
echo "  3. Development server (watch mode)"
echo ""
echo "Press Ctrl+C to stop all watchers"
echo ""

# Kill all child processes on exit
trap 'kill 0' EXIT INT TERM

# Start typecheck in watch mode
echo "▶️  Starting TypeScript watch..."
npm run typecheck:watch &
PID_TYPECHECK=$!

# Wait a moment for typecheck to start
sleep 1

# Start test watch mode
echo "▶️  Starting test watch..."
npm run test:watch &
PID_TEST=$!

# Wait a moment for tests to start
sleep 1

# Start dev server
echo "▶️  Starting dev server..."
npm run dev &
PID_DEV=$!

echo ""
echo "✅ All watchers started!"
echo "   TypeScript: PID $PID_TYPECHECK"
echo "   Tests: PID $PID_TEST"
echo "   Dev Server: PID $PID_DEV"
echo ""

# Wait for all processes
wait
