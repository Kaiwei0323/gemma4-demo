-- Chat history tables (per user)

create table if not exists chat_thread (
  id uuid primary key,
  user_id uuid not null references users(id) on delete cascade,
  created_at timestamptz not null default now()
);

create table if not exists chat_message (
  id uuid primary key,
  chat_id uuid not null references chat_thread(id) on delete cascade,
  role text not null check (role in ('user','assistant','system')),
  content text not null,
  created_at timestamptz not null default now()
);

create index if not exists chat_thread_user_id_created_at_idx on chat_thread (user_id, created_at desc);
create index if not exists chat_message_chat_id_created_at_idx on chat_message (chat_id, created_at asc);

