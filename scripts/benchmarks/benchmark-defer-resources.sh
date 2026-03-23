#!/bin/bash

echo "=== Resource Discovery Deferral Benchmark ==="
echo ""

measure_startup() {
  local defer_val=$1
  local runs=3
  local total=0
  
  for i in $(seq 1 $runs); do
    start=$(date +%s%3N)
    timeout 3 env DEFER_RESOURCE_DISCOVERY=$defer_val node dist/cli.js --version > /dev/null 2>&1
    end=$(date +%s%3N)
    elapsed=$((end - start))
    total=$((total + elapsed))
  done
  
  avg=$((total / runs))
  echo "$avg"
}

echo "Measuring with DEFER_RESOURCE_DISCOVERY=false (default):"
time_eager=$(measure_startup "false")
echo "  Average: ${time_eager}ms (3 runs)"
echo ""

echo "Measuring with DEFER_RESOURCE_DISCOVERY=true (deferred):"
time_deferred=$(measure_startup "true")
echo "  Average: ${time_deferred}ms (3 runs)"
echo ""

savings=$((time_eager - time_deferred))
percent=$(( (savings * 100) / time_eager ))

echo "=== Results ==="
echo "Time saved: ${savings}ms"
echo "Improvement: ${percent}%"
echo ""
echo "Note: With deferred=true, resources load lazily on first tool call."
echo "This saves startup time but delays resource availability."
