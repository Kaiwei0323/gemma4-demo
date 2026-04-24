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
psql -U postgres -h 127.0.0.1 -d gemma4_demo -f sql/003_chat_history.sql
psql -U postgres -h 127.0.0.1 -d gemma4_demo -f sql/004_chat_message_attachments.sql
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

## Run

```bash
npm run dev
```

Open `http://localhost:3000`.

## Docker

### Build + run (Docker)

```bash
docker build -t inventec-ai-studio .
docker run --rm -p 3000:3000 ^
  -e HOST=0.0.0.0 ^
  -e PORT=3000 ^
  -e API_BASE_URL=http://99.64.152.85:5000 ^
  inventec-ai-studio
```

Open `http://localhost:3000`.

### Run (Docker Compose)

```bash
docker compose up --build
```

### Persistence in Docker

- **Uploads** (saved to `uploads/` and served from `/uploads/...`) persist because Compose mounts `./uploads:/app/uploads`.
- **Postgres data** persists because Compose uses a named volume `pgdata`.

If you want to connect with `psql` from your host:

```bash
psql -U postgres -h 127.0.0.1 -p 5432 -d gemma4_database
```

Then run the schema files inside the repo (from your host):

```bash
psql -U postgres -h 127.0.0.1 -p 5432 -d gemma4_database -f sql/001_auth.sql
psql -U postgres -h 127.0.0.1 -p 5432 -d gemma4_database -f sql/003_chat_history.sql
psql -U postgres -h 127.0.0.1 -p 5432 -d gemma4_database -f sql/004_chat_message_attachments.sql
```

## What it sends upstream

- **Chat**: multipart with either:
  - `text` + `max_new_tokens`, or
  - `messages` (JSON string) + `max_new_tokens`
- **Image**: multipart `text`, `max_new_tokens`, and file as `image_file`
- **Audio**: multipart `text`, `max_new_tokens`, and file as `audio_url`
- **Video**: multipart `text`, `max_new_tokens`, and file as `video_url`

