const path = require("path");
const express = require("express");
const multer = require("multer");
const axios = require("axios");
const FormData = require("form-data");
require("dotenv").config();

const app = express();

const PORT = process.env.PORT ? Number(process.env.PORT) : 3000;
const HOST = process.env.HOST || "127.0.0.1";
const API_BASE_URL = (process.env.API_BASE_URL || "http://99.64.152.85:5000").replace(/\/$/, "");
const PUBLIC_URL_RAW = typeof process.env.PUBLIC_URL === "string" ? process.env.PUBLIC_URL.trim() : "";
const PUBLIC_URL = PUBLIC_URL_RAW.replace(/\/$/, "");

// Store uploads in memory; we forward them immediately.
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 200 * 1024 * 1024 // 200MB
  }
});

app.use(express.static(path.join(__dirname, "public")));

function pickText(req) {
  // UI always sends "text". Keep this flexible.
  const t = req.body?.text;
  return typeof t === "string" ? t : "";
}

function pickMaxNewTokens(req) {
  const v = req.body?.max_new_tokens;
  const n = typeof v === "string" ? Number(v) : typeof v === "number" ? v : NaN;
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 1024;
}

async function forwardMultipart({ endpointPath, fields, fileFieldName, file }) {
  const form = new FormData();
  for (const [k, v] of Object.entries(fields)) {
    if (v === undefined || v === null) continue;
    form.append(k, typeof v === "string" ? v : JSON.stringify(v));
  }

  if (file && fileFieldName) {
    form.append(fileFieldName, file.buffer, {
      filename: file.originalname || "upload",
      contentType: file.mimetype || "application/octet-stream"
    });
  }

  const url = `${API_BASE_URL}${endpointPath}`;
  const resp = await axios.post(url, form, {
    headers: form.getHeaders(),
    maxBodyLength: Infinity,
    maxContentLength: Infinity,
    // If the upstream streams, keep it simple and read full response.
    validateStatus: () => true
  });

  return resp;
}

async function forwardMultipartStream({ endpointPath, fields, fileFieldName, file }) {
  const form = new FormData();
  for (const [k, v] of Object.entries(fields)) {
    if (v === undefined || v === null) continue;
    form.append(k, typeof v === "string" ? v : JSON.stringify(v));
  }

  if (file && fileFieldName) {
    form.append(fileFieldName, file.buffer, {
      filename: file.originalname || "upload",
      contentType: file.mimetype || "application/octet-stream"
    });
  }

  const url = `${API_BASE_URL}${endpointPath}`;
  const resp = await axios.post(url, form, {
    headers: form.getHeaders(),
    maxBodyLength: Infinity,
    maxContentLength: Infinity,
    responseType: "stream",
    validateStatus: () => true
  });

  return resp;
}

// Accept urlencoded + json for non-file chat
app.use(express.urlencoded({ extended: true }));
app.use(express.json({ limit: "2mb" }));

app.post("/api/chat/stream", async (req, res) => {
  // Proxy SSE stream from upstream /chat/stream to browser.
  // Browser connects to same-origin to avoid CORS issues.
  try {
    const max_new_tokens = pickMaxNewTokens(req);
    const messagesRaw = req.body?.messages;
    const text = pickText(req);

    // Upstream expects JSON body: { messages: [...], max_new_tokens }
    // Keep compatibility with the UI: allow sending either "messages" or "text".
    let messages = null;
    if (Array.isArray(messagesRaw)) {
      messages = messagesRaw;
    } else if (typeof messagesRaw === "string" && messagesRaw.trim()) {
      try {
        const parsed = JSON.parse(messagesRaw);
        if (Array.isArray(parsed)) messages = parsed;
      } catch {
        // ignore; fallback to text
      }
    }
    if (!messages) {
      messages = [{ role: "user", content: text || "" }];
    }

    const url = `${API_BASE_URL}/chat/stream`;
    const upstream = await axios.post(
      url,
      { messages, max_new_tokens },
      {
        responseType: "stream",
        headers: { "Content-Type": "application/json" },
        validateStatus: () => true
      }
    );

    // Pass-through status and SSE headers
    res.status(upstream.status);
    res.setHeader("Content-Type", upstream.headers["content-type"] || "text/event-stream; charset=utf-8");
    res.setHeader("Cache-Control", "no-cache, no-transform");
    res.setHeader("Connection", "keep-alive");
    // Helpful for nginx-like proxies; harmless otherwise
    res.setHeader("X-Accel-Buffering", "no");

    // If upstream returned an error JSON/text instead of SSE, forward it.
    // Otherwise pipe the stream.
    const ct = String(upstream.headers["content-type"] || "").toLowerCase();
    if (!ct.includes("text/event-stream")) {
      upstream.data.pipe(res);
      return;
    }

    // Stop upstream if client disconnects.
    req.on("close", () => {
      if (upstream?.data?.destroy) upstream.data.destroy();
    });

    upstream.data.pipe(res);
  } catch (err) {
    res.status(500).json({ error: "Failed to call /chat/stream", details: String(err?.message || err) });
  }
});

app.post("/api/chat", upload.none(), async (req, res) => {
  try {
    const text = pickText(req);
    const max_new_tokens = pickMaxNewTokens(req);

    // Support both styles:
    // - form field "text"
    // - form field "messages" (JSON string or object)
    const messagesRaw = req.body?.messages;
    const fields = { max_new_tokens };
    if (messagesRaw) {
      fields.messages = messagesRaw;
    } else {
      fields.text = text;
    }

    const upstream = await forwardMultipart({
      endpointPath: "/chat",
      fields
    });

    res.status(upstream.status).type(upstream.headers["content-type"] || "application/json").send(upstream.data);
  } catch (err) {
    res.status(500).json({ error: "Failed to call /chat", details: String(err?.message || err) });
  }
});

app.post("/api/submit/stream", upload.single("file"), async (req, res) => {
  // Stream proxy for chat/image/video/audio depending on attachment.
  try {
    const text = pickText(req);
    const max_new_tokens = pickMaxNewTokens(req);
    const kind = req.file ? classifyUpload(req.file) : null;

    if (!kind) {
      // No file: stream chat
      const messagesRaw = req.body?.messages;
      const fields = { max_new_tokens };
      if (messagesRaw) fields.messages = messagesRaw;
      else fields.text = text;

      // We already have a JSON-based chat stream endpoint; prefer it when possible.
      // But keep multipart compatibility by translating to a JSON chat stream.
      let messages = null;
      if (fields.messages) {
        const mr = fields.messages;
        if (Array.isArray(mr)) messages = mr;
        else if (typeof mr === "string" && mr.trim()) {
          try {
            const parsed = JSON.parse(mr);
            if (Array.isArray(parsed)) messages = parsed;
          } catch {
            // ignore
          }
        }
      }
      if (!messages) messages = [{ role: "user", content: String(fields.text || "") }];

      const upstream = await axios.post(
        `${API_BASE_URL}/chat/stream`,
        { messages, max_new_tokens },
        { responseType: "stream", headers: { "Content-Type": "application/json" }, validateStatus: () => true }
      );

      res.status(upstream.status);
      res.setHeader("Content-Type", upstream.headers["content-type"] || "text/event-stream; charset=utf-8");
      res.setHeader("Cache-Control", "no-cache, no-transform");
      res.setHeader("Connection", "keep-alive");
      res.setHeader("X-Accel-Buffering", "no");

      req.on("close", () => {
        if (upstream?.data?.destroy) upstream.data.destroy();
      });

      upstream.data.pipe(res);
      return;
    }

    const endpointPath = kind === "image" ? "/image/stream" : kind === "audio" ? "/audio/stream" : "/video/stream";
    const fileFieldName = kind === "image" ? "image_file" : kind === "audio" ? "audio_url" : "video_url";

    const upstream = await forwardMultipartStream({
      endpointPath,
      fields: { text: text || "Describe this.", max_new_tokens },
      fileFieldName,
      file: req.file
    });

    res.status(upstream.status);
    res.setHeader("Content-Type", upstream.headers["content-type"] || "text/event-stream; charset=utf-8");
    res.setHeader("Cache-Control", "no-cache, no-transform");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("X-Accel-Buffering", "no");

    req.on("close", () => {
      if (upstream?.data?.destroy) upstream.data.destroy();
    });

    upstream.data.pipe(res);
  } catch (err) {
    res.status(500).json({ error: "Failed to stream submit", details: String(err?.message || err) });
  }
});

app.post("/api/image", upload.single("file"), async (req, res) => {
  try {
    const text = pickText(req);
    const max_new_tokens = pickMaxNewTokens(req);

    const upstream = await forwardMultipart({
      endpointPath: "/image",
      fields: { text, max_new_tokens },
      fileFieldName: "image_file",
      file: req.file
    });

    res.status(upstream.status).type(upstream.headers["content-type"] || "application/json").send(upstream.data);
  } catch (err) {
    res.status(500).json({ error: "Failed to call /image", details: String(err?.message || err) });
  }
});

app.post("/api/video", upload.single("file"), async (req, res) => {
  try {
    const text = pickText(req);
    const max_new_tokens = pickMaxNewTokens(req);

    // Upstream sample uses form field name "video_url" even for local file.
    const upstream = await forwardMultipart({
      endpointPath: "/video",
      fields: { text, max_new_tokens },
      fileFieldName: "video_url",
      file: req.file
    });

    res.status(upstream.status).type(upstream.headers["content-type"] || "application/json").send(upstream.data);
  } catch (err) {
    res.status(500).json({ error: "Failed to call /video", details: String(err?.message || err) });
  }
});

app.post("/api/audio", upload.single("file"), async (req, res) => {
  try {
    const text = pickText(req);
    const max_new_tokens = pickMaxNewTokens(req);

    // Upstream sample uses form field name "audio_url" even for local file.
    const upstream = await forwardMultipart({
      endpointPath: "/audio",
      fields: { text, max_new_tokens },
      fileFieldName: "audio_url",
      file: req.file
    });

    res.status(upstream.status).type(upstream.headers["content-type"] || "application/json").send(upstream.data);
  } catch (err) {
    res.status(500).json({ error: "Failed to call /audio", details: String(err?.message || err) });
  }
});

function classifyUpload(file) {
  const mt = (file?.mimetype || "").toLowerCase();
  if (mt.startsWith("image/")) return "image";
  if (mt.startsWith("audio/")) return "audio";
  if (mt.startsWith("video/")) return "video";
  return null;
}

app.post("/api/submit", upload.single("file"), async (req, res) => {
  try {
    const text = pickText(req);
    const max_new_tokens = pickMaxNewTokens(req);
    const kind = req.file ? classifyUpload(req.file) : null;

    if (!kind) {
      const messagesRaw = req.body?.messages;
      const fields = { max_new_tokens };
      if (messagesRaw) fields.messages = messagesRaw;
      else fields.text = text;

      const upstream = await forwardMultipart({
        endpointPath: "/chat",
        fields
      });
      res.status(upstream.status).type(upstream.headers["content-type"] || "application/json").send(upstream.data);
      return;
    }

    const endpointPath = kind === "image" ? "/image" : kind === "audio" ? "/audio" : "/video";
    const fileFieldName = kind === "image" ? "image_file" : kind === "audio" ? "audio_url" : "video_url";

    const upstream = await forwardMultipart({
      endpointPath,
      fields: { text, max_new_tokens },
      fileFieldName,
      file: req.file
    });

    res.status(upstream.status).type(upstream.headers["content-type"] || "application/json").send(upstream.data);
  } catch (err) {
    res.status(500).json({ error: "Failed to submit", details: String(err?.message || err) });
  }
});

app.get("/api/health", (req, res) => {
  res.json({ ok: true, apiBase: API_BASE_URL });
});

app.listen(PORT, HOST, () => {
  const fallback =
    HOST === "0.0.0.0" || HOST === "::" ? `http://127.0.0.1:${PORT}` : `http://${HOST}:${PORT}`;
  const shown = PUBLIC_URL || fallback;
  // eslint-disable-next-line no-console
  console.log(`Chatbox running on ${shown} (API_BASE_URL=${API_BASE_URL})`);
});

