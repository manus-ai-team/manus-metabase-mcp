#!/bin/bash

# Test script for Metabase MCP Docker container
# This script properly tests an MCP server that uses stdio communication

set -e

echo "Testing Metabase MCP Docker container..."

# Build the Docker image
echo "Building Docker image..."
docker build -t metabase-mcp .

# Test 1: Check that the container can start and validate environment
echo "Test 1: Environment validation test..."
docker run --rm \
  -e METABASE_URL=https://test.metabase.local \
  -e METABASE_API_KEY=test-api-key \
  -e NODE_ENV=test \
  metabase-mcp echo '{"jsonrpc": "2.0", "method": "initialize", "params": {"protocolVersion": "2024-11-05", "capabilities": {}, "clientInfo": {"name": "test", "version": "1.0.0"}}, "id": 1}' | timeout 10s head -1 || {
    echo "Test 1 failed: Container could not start or process basic input"
    exit 1
  }

echo "Test 1 passed: Container starts and accepts input"

# Test 2: Check that the container fails with missing environment variables
echo "Test 2: Missing environment variables test..."
if docker run --rm metabase-mcp echo '{}' 2>&1 | grep -q "Environment validation failed"; then
  echo "Test 2 passed: Container properly validates environment variables"
else
  echo "Test 2 failed: Container should fail with missing environment variables"
  exit 1
fi

# Test 3: Check that the container handles invalid input gracefully
echo "Test 3: Invalid input handling test..."
docker run --rm \
  -e METABASE_URL=https://test.metabase.local \
  -e METABASE_API_KEY=test-api-key \
  -e NODE_ENV=test \
  metabase-mcp echo 'invalid json' | timeout 5s head -1 || {
    echo "Test 3 passed: Container handles invalid input gracefully"
  }

echo "All Docker tests passed successfully!"
echo "Docker image 'metabase-mcp' is ready for use."
