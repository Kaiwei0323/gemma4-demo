-- Auth schema for local Postgres
-- Run this against your database (see README steps).

create extension if not exists "pgcrypto";

create table if not exists users (
  id uuid primary key default gen_random_uuid(),
  username text not null unique,
  password_hash text not null,
  created_at timestamptz not null default now()
);

-- Optional: case-insensitive uniqueness (uncomment if you want it)
-- create unique index if not exists users_username_lower_ux on users (lower(username));

