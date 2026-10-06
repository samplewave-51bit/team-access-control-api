#!/usr/bin/env sh
set -e

echo "Ensuring tac_test database exists..."
PGPASSWORD=tac psql -h "${PGHOST:-localhost}" -U "${PGUSER:-tac}" -d tac -tc "SELECT 1 FROM pg_database WHERE datname = 'tac_test'" | grep -q 1 || \
  PGPASSWORD=tac psql -h "${PGHOST:-localhost}" -U "${PGUSER:-tac}" -d tac -c "CREATE DATABASE tac_test;"

echo "Ensuring MinIO bucket tac-files exists..."
if command -v mc >/dev/null 2>&1; then
  mc alias set local "${S3_ENDPOINT:-http://localhost:9000}" "${S3_ACCESS_KEY:-minioadmin}" "${S3_SECRET_KEY:-minioadmin}"
  mc mb --ignore-existing local/tac-files
fi

echo "Init script completed successfully."
