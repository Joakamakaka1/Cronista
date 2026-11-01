#!/usr/bin/env bash
# Restores a plain text dump into a throwaway local Postgres and compares its row counts with those
# read from production around the dump (see docs/delivery.md).
#
# Usage: restore-check.sh <dump folder> <counts before> <counts after>
#
# The folder holds roles.sql, schema.sql and data.sql. Each counts file holds `name<TAB>count` lines
# from table-counts.sql. This log is public, so nothing from the dump may reach it: psql reports only
# the SQLSTATE of an error, because its message and context can quote the rows of a failed COPY. The
# script prints names and counts, and exits non-zero when the restore fails or a count does not match.
set -euo pipefail

# `join` and `sort` must agree on the order, whatever the locale.
export LC_ALL=C

dump=$1
before=$2
after=$3
sql="$(cd "$(dirname "$0")" && pwd)/table-counts.sql"

if ! [ -s "$before" ] || ! [ -s "$after" ]; then
  echo 'The row counts of production are missing.' >&2
  exit 1
fi

work=$(mktemp -d)
# `supabase init` names the project after its folder, and the database container after the project.
project="$work/restore-check"
database=supabase_db_restore-check
mkdir -p "$project"

cleanup() {
  supabase stop --no-backup --workdir "$project" > /dev/null 2>&1 || true
  rm -rf "$work"
}
trap cleanup EXIT

psql_in_container() {
  docker exec -i "$database" psql -q -v ON_ERROR_STOP=1 -v VERBOSITY=sqlstate -v SHOW_CONTEXT=never "$@"
}

supabase init --workdir "$project" --with-vscode-settings=false --with-intellij-settings=false

# The first start of a new project can time out while Postgres initialises; the next one finds it up.
started=false
for attempt in 1 2 3; do
  if supabase db start --workdir "$project"; then
    started=true
    break
  fi
  echo "The local database is not up yet (attempt $attempt)."
done
if [ "$started" != true ]; then
  echo 'The local database did not start.' >&2
  exit 1
fi

echo 'Restoring the roles, the schema and the data.'
# The CLI's temporary login role exists only in production, and the dump grants to it. The roles need
# the platform's superuser, because the dump repeats grants only it can make.
grep -v 'cli_login_postgres' "$dump/roles.sql" \
  | psql_in_container -U supabase_admin -d postgres --single-transaction -f - > /dev/null
# One transaction for the schema and the data, with triggers off for the data.
{
  cat "$dump/schema.sql"
  echo 'SET session_replication_role = replica;'
  cat "$dump/data.sql"
} | psql_in_container -U postgres -d postgres --single-transaction -f - > /dev/null

psql_in_container -U postgres -d postgres -At -F $'\t' -f - < "$sql" > "$work/restored.tsv"

sorted() { sort -t $'\t' -k 1,1 "$1"; }

# Everything production lists must exist in the copy, with a count between those read around the
# dump: a write during the dump must not fail the run. Tables only the copy has are ignored.
join -t $'\t' -a 1 -e missing -o 0,1.2,2.2 <(sorted "$before") <(sorted "$after") \
  | join -t $'\t' -a 1 -e missing -o 0,1.2,1.3,2.2 - <(sorted "$work/restored.tsv") \
  | awk -F '\t' '
      BEGIN { printf "%-45s %10s %10s %10s\n", "", "before", "restored", "after" }
      {
        printf "%-45s %10s %10s %10s\n", $1, $2, $4, $3
        low = ($2 + 0 < $3 + 0) ? $2 + 0 : $3 + 0
        high = ($2 + 0 > $3 + 0) ? $2 + 0 : $3 + 0
        if ($3 == "missing" || $4 == "missing" || $4 + 0 < low || $4 + 0 > high) failed = 1
      }
      END { exit failed }
    ' || {
  echo 'The restored copy does not match production.' >&2
  exit 1
}
echo 'The restored copy matches production.'
