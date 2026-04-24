-- Add attachment metadata to chat_message (for image/video/audio history)
-- Safe to run multiple times.

alter table chat_message
  add column if not exists attachment_kind text,
  add column if not exists attachment_url text,
  add column if not exists attachment_label text,
  add column if not exists attachment_mime text;

