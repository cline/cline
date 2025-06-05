#!/bin/bash

if ! docker info &> /dev/null; then
  echo "❌ Docker is not running. Please start Docker Desktop and try again."
  exit 1
fi

if ! nc -z localhost 5432 2>/dev/null; then
  echo "❌ PostgreSQL is not running on port 5432"
  echo "💡 Start it with: pnpm --filter @roo-code/evals db:start"
  exit 1
fi

if ! nc -z localhost 6379 2>/dev/null; then
  echo "❌ Redis is not running on port 6379"
  echo "💡 Start it with: pnpm --filter @roo-code/evals redis:start"
  exit 1
fi

echo "✅ All required services are running"
