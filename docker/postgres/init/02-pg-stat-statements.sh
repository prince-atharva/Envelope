#!/bin/sh
# Runs once, when the Postgres volume is first created (after 01-roles.sh has
# created the databases). shared_preload_libraries=pg_stat_statements (set on
# the postgres service's command in docker-compose.yml) loads the library
# server-wide; CREATE EXTENSION is still needed per database to expose it.
#
# Only in the databases queries are actually run against: the main one and
# the e2e test one. Not digitalsign_shadow (Prisma resets it) or
# digitalsign_browser_test (its own stack, not this one).
set -eu

for db in "$POSTGRES_DB" digitalsign_test; do
  psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$db" \
    -c 'CREATE EXTENSION IF NOT EXISTS pg_stat_statements'
done

echo "digitalsign: created extension pg_stat_statements in $POSTGRES_DB and digitalsign_test"
