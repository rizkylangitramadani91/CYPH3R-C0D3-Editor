#!/bin/bash

echo "🚀 CYPH3R C0D3 Terminal Speed Test"
echo "=================================="
echo ""

# Test 1: Simple output speed
echo "Test 1: Output Speed (1000 lines)"
start=$(date +%s.%N)
for i in {1..1000}; do
    echo "Line $i: The quick brown fox jumps over the lazy dog"
done
end=$(date +%s.%N)
duration=$(echo "$end - $start" | bc)
echo "✓ Completed in ${duration}s"
echo ""

# Test 2: Color output
echo "Test 2: ANSI Colors"
start=$(date +%s.%N)
for i in {1..100}; do
    echo -e "\033[31m■\033[32m■\033[33m■\033[34m■\033[35m■\033[36m■\033[37m■\033[0m Color test line $i"
done
end=$(date +%s.%N)
duration=$(echo "$end - $start" | bc)
echo "✓ Completed in ${duration}s"
echo ""

# Test 3: Large block output
echo "Test 3: Large Data Block"
start=$(date +%s.%N)
cat /dev/urandom | base64 | head -n 100
end=$(date +%s.%N)
duration=$(echo "$end - $start" | bc)
echo "✓ Completed in ${duration}s"
echo ""

echo "=================================="
echo "✅ All tests completed!"
echo ""
echo "Performance Tips:"
echo "- Web terminals add 2-10ms latency"
echo "- Best performance on localhost"
echo "- Use Chrome/Edge for optimal speed" 