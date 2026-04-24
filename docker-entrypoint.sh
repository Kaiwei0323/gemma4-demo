#!/bin/sh
set -eu

if [ -n "${DATABASE_URL:-}" ] && [ "${SKIP_DB_MIGRATE:-0}" != "1" ]; then
  echo "Waiting for Postgres (DATABASE_URL is set)..."
  i=0
  while ! psql "$DATABASE_URL" -c "select 1" >/dev/null 2>&1; do
    i=$((i + 1))
    if [ "$i" -ge 90 ]; then
      echo "Postgres not reachable after 90s; exiting."
      exit 1
    fi
    sleep 1
  done

  echo "Applying SQL schema (idempotent, safe to repeat)..."
  for f in \
    /app/sql/001_auth.sql \
    /app/sql/002_chat_history.sql \
    /app/sql/003_chat_history.sql \
    /app/sql/004_chat_message_attachments.sql \
    /app/sql/005_chat_thread_title.sql
  do
    if [ -f "$f" ]; then
      psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f "$f"
    fi
  done
fi

exec node /app/server.js
