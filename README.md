# Gemma Demo Chatbox (Node.js)

Web UI + Node.js proxy server for your endpoints:

- `POST /chat`
- `POST /image`
- `POST /audio`
- `POST /video`

## Setup

```bash
npm install
copy .env.example .env
```

Edit `.env` if needed:

- `API_BASE_URL=http://99.64.152.85:5000`

## Local Postgres login (username/password)

### 1) Install + start Postgres locally

- **Windows**: install PostgreSQL (includes `psql`) and make sure the service is running.

### 2) Create a database + table

Create a database (example name: `gemma4_demo`) and run the schema:

```bash
psql -U postgres -h 127.0.0.1 -c "create database gemma4_demo;"
psql -U postgres -h 127.0.0.1 -d gemma4_demo -f sql/001_auth.sql
psql -U postgres -h 127.0.0.1 -d gemma4_demo -f sql/002_chat_history.sql
psql -U postgres -h 127.0.0.1 -d gemma4_demo -f sql/003_chat_history.sql
psql -U postgres -h 127.0.0.1 -d gemma4_demo -f sql/004_chat_message_attachments.sql
psql -U postgres -h 127.0.0.1 -d gemma4_demo -f sql/005_chat_thread_title.sql
```

### 3) Configure `.env`

Set:

- `DATABASE_URL=postgres://postgres:YOUR_PASSWORD@127.0.0.1:5432/gemma4_demo`
- `SESSION_SECRET=some-long-random-string`

### 4) Run

```bash
npm run dev
```

Open the site; you’ll see a login/register popup first.

### Auth API (for reference)

- `POST /api/auth/register` body: `{ "username": "...", "password": "..." }`
- `POST /api/auth/login` body: `{ "username": "...", "password": "..." }`
- `POST /api/auth/logout`
- `GET /api/auth/me`

## Docker

### Configure `.env` (recommended)

Create `.env` from the example and set at least:

- `HOST`: your **host IP** (used for port publishing default + displayed URL)
- `PORT`: the **host port** you want to open in browser (example: `3003`)
- `API_BASE_URL`: your upstream API (example: `http://99.64.152.85:5000`)
- `SESSION_SECRET`: a long random string

Example:

```bash
cp .env.example .env
```

### Build + run (Docker, no database)

```bash
docker build -t inventec-ai-studio .
docker run --rm -p 3000:3000 \
  -e HOST=0.0.0.0 \
  -e PORT=3000 \
  -e API_BASE_URL=http://99.64.152.85:5000 \
  inventec-ai-studio
```

Open `http://localhost:3000`.

### Run (Docker Compose, with Postgres)

```bash
docker compose up --build
```

### Database schema (Docker Compose)

On every **`inventec-ai-studio` container start**, `docker-entrypoint.sh` waits until Postgres accepts connections, then applies these files in order (they are written to be **idempotent**):

`sql/001_auth.sql` → `002_chat_history.sql` → `003_chat_history.sql` → `004_chat_message_attachments.sql` → `005_chat_thread_title.sql`

To skip that step (for example if you manage schema yourself), set `SKIP_DB_MIGRATE=1` on the app service.

**Manual apply** (optional, same order as the container):

```bash
docker compose exec -T db psql -U "${POSTGRES_USER:-postgres}" -d "${POSTGRES_DB:-gemma4_database}" < sql/001_auth.sql
docker compose exec -T db psql -U "${POSTGRES_USER:-postgres}" -d "${POSTGRES_DB:-gemma4_database}" < sql/002_chat_history.sql
docker compose exec -T db psql -U "${POSTGRES_USER:-postgres}" -d "${POSTGRES_DB:-gemma4_database}" < sql/003_chat_history.sql
docker compose exec -T db psql -U "${POSTGRES_USER:-postgres}" -d "${POSTGRES_DB:-gemma4_database}" < sql/004_chat_message_attachments.sql
docker compose exec -T db psql -U "${POSTGRES_USER:-postgres}" -d "${POSTGRES_DB:-gemma4_database}" < sql/005_chat_thread_title.sql
```

### Persistence in Docker

- **Uploads** (saved to `uploads/` and served from `/uploads/...`) persist because Compose mounts `./uploads:/app/uploads`.
- **Postgres data** persists because Compose uses a named volume `pgdata`.

**Postgres password errors** (`password authentication failed for user "postgres"`): the app’s `DATABASE_URL` is built from `POSTGRES_USER` / `POSTGRES_PASSWORD` in your project `.env`. The `db` container only applies `POSTGRES_PASSWORD` on **first database init**. If you change the password later, the old password stays in `pgdata` until you either set `POSTGRES_PASSWORD` back to the original value or **reset the volume** (this deletes all DB data):

```bash
docker compose down -v
docker compose up -d --build
```

If you want to connect with `psql` from your host:

```bash
psql -U postgres -h 127.0.0.1 -p 5432 -d gemma4_database
```

Then run the schema files inside the repo (from your host):

```bash
psql -U postgres -h 127.0.0.1 -p 5432 -d gemma4_database -f sql/001_auth.sql
psql -U postgres -h 127.0.0.1 -p 5432 -d gemma4_database -f sql/002_chat_history.sql
psql -U postgres -h 127.0.0.1 -p 5432 -d gemma4_database -f sql/003_chat_history.sql
psql -U postgres -h 127.0.0.1 -p 5432 -d gemma4_database -f sql/004_chat_message_attachments.sql
psql -U postgres -h 127.0.0.1 -p 5432 -d gemma4_database -f sql/005_chat_thread_title.sql
```

## What it sends upstream

- **Chat**: multipart with either:
  - `text` + `max_new_tokens`, or
  - `messages` (JSON string) + `max_new_tokens`
- **Image**: multipart `text`, `max_new_tokens`, and file as `image_file`
- **Audio**: multipart `text`, `max_new_tokens`, and file as `audio_url`
- **Video**: multipart `text`, `max_new_tokens`, and file as `video_url`

