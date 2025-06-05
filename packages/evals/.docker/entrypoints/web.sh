#!/bin/bash

set -e

echo "🚀 Starting evals web service..."

wait_for_db() {
    echo "⏳ Waiting for database..."

    # postgresql://user:password@host:port/database
    DB_HOST=$(echo $DATABASE_URL | sed -n 's/.*@\([^:]*\):.*/\1/p')
    DB_PORT=$(echo $DATABASE_URL | sed -n 's/.*:\([0-9]*\)\/.*/\1/p')
    DB_USER=$(echo $DATABASE_URL | sed -n 's/.*\/\/\([^:]*\):.*/\1/p')
    DB_NAME=$(echo $DATABASE_URL | sed -n 's/.*\/\([^?]*\).*/\1/p')

    DB_HOST=${DB_HOST:-db}
    DB_PORT=${DB_PORT:-5432}
    DB_USER=${DB_USER:-postgres}
    DB_NAME=${DB_NAME:-evals_development}

    until pg_isready -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" > /dev/null 2>&1; do
        echo "⏳ Database not ready yet, waiting 2 seconds..."
        sleep 2
    done
    
    echo "✅ Database is ready"
}

run_migrations() {
    echo "🔄 Running database migrations..."

    if pnpm --filter @roo-code/evals db:migrate; then
        echo "✅ Database migrations completed successfully!"
    else
        echo "❌ Database migration failed!"
        exit 1
    fi
}

main() {
    wait_for_db
    run_migrations

    echo "🌐 Starting web service..."
    pnpm --filter @roo-code/web-evals start
}

main "$@"
