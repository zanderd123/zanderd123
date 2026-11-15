#!/usr/bin/env bash
# Runs the Supabase migration against a throwaway local Postgres database and checks
# every access rule. Needs a local PostgreSQL server; run as a user that can create databases.
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
db=quotient_social_test
dropdb --if-exists "$db" 2>/dev/null || true
createdb "$db"
psql -q -v ON_ERROR_STOP=1 -d "$db" -f "$here/prelude.sql"
PGOPTIONS="-c client_min_messages=warning" psql -q -v ON_ERROR_STOP=1 -d "$db" -f "$here/../../supabase/migrations/20261115000000_quotient_social.sql"
psql -q -v ON_ERROR_STOP=1 -d "$db" -f "$here/tests.sql" 2>&1 | grep -E "ok:|FAIL|ERROR" | sed 's/^.*NOTICE: */  /'
dropdb "$db"
