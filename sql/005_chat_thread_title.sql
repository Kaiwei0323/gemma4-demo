-- Add title + last_message_at for chat sessions
-- Safe to run multiple times.

alter table chat_thread
  add column if not exists title text,
  add column if not exists last_message_at timestamptz;

create index if not exists chat_thread_user_last_message_idx on chat_thread (user_id, last_message_at desc nulls last);

