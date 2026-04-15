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

## What it sends upstream

- **Chat**: multipart with either:
  - `text` + `max_new_tokens`, or
  - `messages` (JSON string) + `max_new_tokens`
- **Image**: multipart `text`, `max_new_tokens`, and file as `image_file`
- **Audio**: multipart `text`, `max_new_tokens`, and file as `audio_url`
- **Video**: multipart `text`, `max_new_tokens`, and file as `video_url`

