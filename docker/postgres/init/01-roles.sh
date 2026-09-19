#!/bin/sh
# Runs once, when the Postgres volume is first created.
#
# Two roles (docs/05, "Database privileges for the audit table"):
#   digitalsign      owns the schema and runs migrations (POSTGRES_USER)
#   digitalsign_app  what the API and worker connect as; migrations grant it
#                    CRUD on every table except UPDATE/DELETE on "AuditTrail"
#
# Also creates three more databases:
#   digitalsign_test    used only by the API e2e suite
#   digitalsign_browser_test  used only by the browser tests' own stack, so its
#                       scheduled jobs never touch the API suite's data
#   digitalsign_shadow  Prisma's shadow database, used by `migrate dev` and by the
#                       CI migration drift check. Prisma resets it, so it must
#                       never hold anything else.
set -eu

psql -v ON_ERROR_STOP=1 \
  --username "$POSTGRES_USER" \
  --dbname "$POSTGRES_DB" \
  -v app_password="$APP_DB_PASSWORD" <<'EOSQL'
CREATE ROLE digitalsign_app LOGIN PASSWORD :'app_password';
CREATE DATABASE digitalsign_test OWNER digitalsign;
CREATE DATABASE digitalsign_browser_test OWNER digitalsign;
CREATE DATABASE digitalsign_shadow OWNER digitalsign;
EOSQL

echo "digitalsign: created role digitalsign_app and databases digitalsign_test, digitalsign_browser_test, digitalsign_shadow"
