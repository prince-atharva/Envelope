#!/bin/sh
# Runs once, when the Postgres volume is first created.
#
# Two roles (docs/05, "Database privileges for the audit table"):
#   digitalsign      owns the schema and runs migrations (POSTGRES_USER)
#   digitalsign_app  what the API and worker connect as; migrations grant it
#                    CRUD on every table except UPDATE/DELETE on "AuditTrail"
#
# Also creates digitalsign_test, used only by the automated test suites.
set -eu

psql -v ON_ERROR_STOP=1 \
  --username "$POSTGRES_USER" \
  --dbname "$POSTGRES_DB" \
  -v app_password="$APP_DB_PASSWORD" <<'EOSQL'
CREATE ROLE digitalsign_app LOGIN PASSWORD :'app_password';
CREATE DATABASE digitalsign_test OWNER digitalsign;
EOSQL

echo "digitalsign: created role digitalsign_app and database digitalsign_test"
