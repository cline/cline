#!/bin/bash

set -e
set -u

if [ -n "$POSTGRES_DATABASES" ]; then
  for db in $(echo $POSTGRES_DATABASES | tr ',' ' '); do
    echo "Creating $db..."
    psql -U postgres -v ON_ERROR_STOP=1 -c "CREATE DATABASE $db;"
  done
fi
