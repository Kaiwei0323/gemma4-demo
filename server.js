const path = require("path");
const express = require("express");
const multer = require("multer");
const axios = require("axios");
const FormData = require("form-data");
const session = require("express-session");
const bcrypt = require("bcryptjs");
const { Pool } = require("pg");
const pgSession = require("connect-pg-simple")(session);
const { v4: uuidv4 } = require("uuid");
const fs = require("fs");
require("dotenv").config();

const app = express();

const PORT = process.env.PORT ? Number(process.env.PORT) : 3000;
const HOST = process.env.HOST || "127.0.0.1";
const API_BASE_URL = (process.env.API_BASE_URL || "http://99.64.152.85:5000").replace(/\/$/, "");
const PUBLIC_URL_RAW = typeof process.env.PUBLIC_URL === "string" ? process.env.PUBLIC_URL.trim() : "";
const PUBLIC_URL = PUBLIC_URL_RAW.replace(/\/$/, "");
const DATABASE_URL = process.env.DATABASE_URL || "";
const SESSION_SECRET = process.env.SESSION_SECRET || "";

const UPLOAD_DIR = path.join(__dirname, "uploads");
try {
  if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });
} catch {
  // ignore
}

// Store uploads in memory; we forward them immediately.
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 200 * 1024 * 1024 // 200MB
  }
});

app.use(express.static(path.join(__dirname, "public")));
app.use("/uploads", express.static(UPLOAD_DIR));

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

// ---- Auth (local Postgres + sessions) ----
const db = DATABASE_URL ? new Pool({ connectionString: DATABASE_URL }) : null;

if (!db) {
  // eslint-disable-next-line no-console
  console.warn("DATABASE_URL not set; auth endpoints will return 503.");
}
if (!SESSION_SECRET) {
  // eslint-disable-next-line no-console
  console.warn("SESSION_SECRET not set; auth is not safe until you set it.");
}

app.use(
  session({
    name: "sid",
    secret: SESSION_SECRET || "dev-unsafe-secret-change-me",
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      sameSite: "lax",
      secure: false, // local dev (set true behind https)
      maxAge: 7 * 24 * 60 * 60 * 1000
    },
    store: db
      ? new pgSession({
          pool: db,
          tableName: "user_session",
          createTableIfMissing: true
        })
      : undefined
  })
);

function requireDb(req, res) {
  if (!db) {
    res.status(503).json({ error: "Auth database not configured. Set DATABASE_URL and restart server." });
    return false;
  }
  if (!SESSION_SECRET) {
    res.status(503).json({ error: "SESSION_SECRET not configured. Set it and restart server." });
    return false;
  }
  return true;
}

function requireAuth(req, res, next) {
  const uid = req.session?.userId;
  if (!uid) return res.status(401).json({ error: "Not logged in" });
  next();
}

function normalizeEmailUsername(username) {
  return String(username || "").trim().toLowerCase();
}

function isValidEmail(s) {
  // Practical email validation: no spaces, one "@", and at least one dot in domain.
  // (Full RFC email validation is intentionally not used.)
  if (typeof s !== "string") return false;
  if (s.length < 6 || s.length > 254) return false;
  if (/\s/.test(s)) return false;
  const at = s.indexOf("@");
  if (at <= 0 || at !== s.lastIndexOf("@")) return false;
  const local = s.slice(0, at);
  const domain = s.slice(at + 1);
  if (!local || !domain) return false;
  if (domain.startsWith(".") || domain.endsWith(".")) return false;
  if (!domain.includes(".")) return false;
  if (!/^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+$/.test(local)) return false;
  if (!/^[A-Za-z0-9.-]+$/.test(domain)) return false;
  return true;
}

function pickChatId(req) {
  const v = req.body?.chat_id;
  return typeof v === "string" && v.trim() ? v.trim() : null;
}

async function ensureChatThread({ chatId, userId }) {
  if (!db) return;
  if (!chatId || !userId) return;
  await db.query("insert into chat_thread (id, user_id) values ($1, $2) on conflict (id) do nothing", [chatId, userId]);
}

function deriveChatTitleFromText(text) {
  const t = String(text || "").trim().replace(/\s+/g, " ");
  if (!t) return null;
  // Remove obvious attachment markers we add for DB->upstream.
  const cleaned = t.replace(/\[Attachment:[^\]]+\]\s*/g, "").trim();
  const base = cleaned || t;
  return base.length > 60 ? `${base.slice(0, 60)}…` : base;
}

async function maybeSetChatTitle({ chatId, userId, titleCandidate }) {
  if (!db) return;
  if (!chatId || !userId) return;
  const title = deriveChatTitleFromText(titleCandidate);
  if (!title) return;
  await db.query(
    "update chat_thread set title = coalesce(title, $1), last_message_at = now() where id = $2 and user_id = $3",
    [title, chatId, userId]
  );
}

async function insertChatMessage({ chatId, role, content }) {
  if (!db) return;
  if (!chatId) return;
  if (!content) return;
  const attachment_kind = arguments?.[0]?.attachment_kind || null;
  const attachment_url = arguments?.[0]?.attachment_url || null;
  const attachment_label = arguments?.[0]?.attachment_label || null;
  const attachment_mime = arguments?.[0]?.attachment_mime || null;
  await db.query(
    "insert into chat_message (id, chat_id, role, content, attachment_kind, attachment_url, attachment_label, attachment_mime) values ($1, $2, $3, $4, $5, $6, $7, $8)",
    [uuidv4(), chatId, role, content, attachment_kind, attachment_url, attachment_label, attachment_mime]
  );
}

async function getChatHistoryMessages({ chatId, userId, limit = 100 }) {
  if (!db) return [];
  const l = Number.isFinite(Number(limit)) ? Math.max(1, Math.min(200, Number(limit))) : 100;
  const ok = await db.query("select 1 from chat_thread where id = $1 and user_id = $2", [chatId, userId]);
  if (!ok.rows?.length) return null; // not found / not owned
  const r = await db.query(
    "select role, content, attachment_kind, attachment_url, attachment_label from chat_message where chat_id = $1 order by created_at asc limit $2",
    [chatId, l]
  );
  return r.rows || [];
}

function systemPromptMessage() {
  return {
    role: "system",
    content: [
      "You are a helpful assistant.",
      "Be concise and accurate. Use Markdown when it improves clarity.",
      "Do not output raw HTML tags in your messages."
    ].join("\n")
  };
}

function messageToUpstream(m) {
  const role = m?.role === "assistant" || m?.role === "system" ? m.role : "user";
  let content = typeof m?.content === "string" ? m.content : "";
  const ak = m?.attachment_kind;
  const au = m?.attachment_url;
  const al = m?.attachment_label;
  if (ak) {
    const ref = au ? au : al ? al : "";
    content = content ? `${content}\n\n[Attachment: ${ak}] ${ref}` : `[Attachment: ${ak}] ${ref}`.trim();
  }
  return { role, content };
}

app.get("/api/auth/me", async (req, res) => {
  if (!requireDb(req, res)) return;
  const uid = req.session?.userId;
  if (!uid) return res.json({ ok: true, user: null });
  try {
    const r = await db.query("select id, username, created_at from users where id = $1", [uid]);
    const user = r.rows?.[0] || null;
    return res.json({ ok: true, user });
  } catch (e) {
    return res.status(500).json({ error: "Failed to load session user", details: String(e?.message || e) });
  }
});

// List chats for current user
app.get("/api/history/chats", async (req, res) => {
  if (!requireDb(req, res)) return;
  if (!req.session?.userId) return res.status(401).json({ error: "Login required" });
  try {
    const r = await db.query(
      "select id, title, created_at, last_message_at from chat_thread where user_id = $1 order by coalesce(last_message_at, created_at) desc limit 50",
      [req.session.userId]
    );
    res.json({ ok: true, chats: r.rows || [] });
  } catch (e) {
    res.status(500).json({ error: "Failed to list chats", details: String(e?.message || e) });
  }
});

// Create a new chat thread for current user
app.post("/api/history/chats", async (req, res) => {
  if (!requireDb(req, res)) return;
  if (!req.session?.userId) return res.status(401).json({ error: "Login required" });
  const id = uuidv4();
  try {
    await db.query("insert into chat_thread (id, user_id, last_message_at) values ($1, $2, now())", [id, req.session.userId]);
    res.json({ ok: true, chat: { id } });
  } catch (e) {
    res.status(500).json({ error: "Failed to create chat", details: String(e?.message || e) });
  }
});

// Get messages for a chat
app.get("/api/history/chats/:id", async (req, res) => {
  if (!requireDb(req, res)) return;
  if (!req.session?.userId) return res.status(401).json({ error: "Login required" });
  const chatId = String(req.params.id || "").trim();
  if (!chatId) return res.status(400).json({ error: "Missing chat id" });
  try {
    const ok = await db.query("select 1 from chat_thread where id = $1 and user_id = $2", [chatId, req.session.userId]);
    if (!ok.rows?.length) return res.status(404).json({ error: "Chat not found" });
    const r = await db.query(
      "select id, role, content, attachment_kind, attachment_url, attachment_label, attachment_mime, created_at from chat_message where chat_id = $1 order by created_at asc",
      [chatId]
    );
    res.json({ ok: true, chat_id: chatId, messages: r.rows || [] });
  } catch (e) {
    res.status(500).json({ error: "Failed to load chat", details: String(e?.message || e) });
  }
});

// Delete a chat thread (messages are deleted by ON DELETE CASCADE)
app.delete("/api/history/chats/:id", async (req, res) => {
  if (!requireDb(req, res)) return;
  if (!req.session?.userId) return res.status(401).json({ error: "Login required" });
  const chatId = String(req.params.id || "").trim();
  if (!chatId) return res.status(400).json({ error: "Missing chat id" });
  try {
    const r = await db.query("delete from chat_thread where id = $1 and user_id = $2", [chatId, req.session.userId]);
    if (!r.rowCount) return res.status(404).json({ error: "Chat not found" });
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: "Failed to delete chat", details: String(e?.message || e) });
  }
});

app.post("/api/auth/register", async (req, res) => {
  if (!requireDb(req, res)) return;
  const usernameRaw = typeof req.body?.username === "string" ? req.body.username : "";
  const username = normalizeEmailUsername(usernameRaw);
  const password = typeof req.body?.password === "string" ? req.body.password : "";

  if (!isValidEmail(username)) return res.status(400).json({ error: "Username must be a valid email address." });
  if (!password || password.length < 8) return res.status(400).json({ error: "Password must be at least 8 chars." });

  try {
    const password_hash = await bcrypt.hash(password, 12);
    const id = uuidv4();
    const r = await db.query(
      "insert into users (id, username, password_hash) values ($1, $2, $3) returning id, username, created_at",
      [id, username, password_hash]
    );
    req.session.userId = r.rows[0].id;
    res.json({ ok: true, user: r.rows[0] });
  } catch (e) {
    const msg = String(e?.message || e);
    if (msg.toLowerCase().includes("unique") || msg.toLowerCase().includes("duplicate")) {
      return res.status(409).json({ error: "Username already exists." });
    }
    return res.status(500).json({ error: "Failed to register", details: msg });
  }
});

app.post("/api/auth/login", async (req, res) => {
  if (!requireDb(req, res)) return;
  const usernameRaw = typeof req.body?.username === "string" ? req.body.username : "";
  const username = normalizeEmailUsername(usernameRaw);
  const password = typeof req.body?.password === "string" ? req.body.password : "";
  if (!username || !password) return res.status(400).json({ error: "Missing username/password." });
  if (!isValidEmail(username)) return res.status(400).json({ error: "Username must be a valid email address." });

  try {
    const r = await db.query("select id, username, password_hash, created_at from users where username = $1", [
      username
    ]);
    const u = r.rows?.[0];
    if (!u) return res.status(401).json({ error: "Invalid username or password." });
    const ok = await bcrypt.compare(password, u.password_hash);
    if (!ok) return res.status(401).json({ error: "Invalid username or password." });
    req.session.userId = u.id;
    return res.json({ ok: true, user: { id: u.id, username: u.username, created_at: u.created_at } });
  } catch (e) {
    return res.status(500).json({ error: "Failed to login", details: String(e?.message || e) });
  }
});

app.post("/api/auth/logout", (req, res) => {
  if (!requireDb(req, res)) return;
  req.session?.destroy?.(() => {
    res.clearCookie("sid");
    res.json({ ok: true });
  });
});

app.post("/api/chat/stream", async (req, res) => {
  // Proxy SSE stream from upstream /chat/stream to browser.
  // Browser connects to same-origin to avoid CORS issues.
  try {
    const max_new_tokens = pickMaxNewTokens(req);
    const text = pickText(req);
    const chatId = pickChatId(req);
    const userId = req.session?.userId || null;

    let upstreamMessages = null;
    if (userId && chatId && requireDb(req, res)) {
      await ensureChatThread({ chatId, userId });
      const userText = String(text || "");
      await insertChatMessage({ chatId, role: "user", content: userText });
      await maybeSetChatTitle({ chatId, userId, titleCandidate: userText });

      const historyRows = await getChatHistoryMessages({ chatId, userId, limit: 120 });
      if (historyRows === null) return res.status(404).json({ error: "Chat not found" });
      upstreamMessages = [systemPromptMessage(), ...historyRows.map(messageToUpstream)];
    } else {
      // Guest mode: accept messages[] from browser memory (fallback to single-turn)
      const raw = req.body?.messages;
      const msgs = Array.isArray(raw)
        ? raw
            .filter((m) => m && typeof m === "object" && typeof m.role === "string" && typeof m.content === "string")
            .slice(-120)
        : null;
      upstreamMessages = [systemPromptMessage(), ...(msgs ? msgs.map((m) => ({ role: m.role, content: m.content })) : []), {
        role: "user",
        content: String(text || "")
      }];
    }

    const url = `${API_BASE_URL}/chat/stream`;
    const upstream = await axios.post(
      url,
      { messages: upstreamMessages, max_new_tokens },
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

    // Tee streaming while capturing tokens for history
    let assistantText = "";
    let sseBuf = "";

    upstream.data.on("data", (chunk) => {
      const str = Buffer.isBuffer(chunk) ? chunk.toString("utf8") : String(chunk);
      sseBuf += str;
      let idx;
      while ((idx = sseBuf.indexOf("\n\n")) !== -1) {
        const frame = sseBuf.slice(0, idx);
        sseBuf = sseBuf.slice(idx + 2);
        const lines = frame.split(/\r?\n/);
        let eventName = "message";
        const dataLines = [];
        for (const line of lines) {
          if (line.startsWith("event:")) eventName = line.slice("event:".length).trim() || "message";
          else if (line.startsWith("data:")) dataLines.push(line.slice("data:".length).trimStart());
        }
        if (eventName === "token") {
          try {
            const payload = JSON.parse(dataLines.join("\n"));
            const t = payload?.text;
            if (typeof t === "string") assistantText += t;
          } catch {
            // ignore
          }
        } else if (eventName === "done") {
          // If upstream includes parsed content, prefer that
          try {
            const payload = JSON.parse(dataLines.join("\n"));
            const pretty = payload?.parsed && typeof payload.parsed?.content === "string" ? payload.parsed.content : null;
            if (pretty) assistantText = String(pretty);
          } catch {
            // ignore
          }
        }
      }
      res.write(chunk);
    });

    upstream.data.on("end", async () => {
      try {
        if (userId && chatId && requireDb(req, res) && assistantText) {
          await insertChatMessage({ chatId, role: "assistant", content: assistantText });
          await db.query("update chat_thread set last_message_at = now() where id = $1 and user_id = $2", [chatId, userId]);
        }
      } catch {
        // ignore history errors
      }
      res.end();
    });

    upstream.data.on("error", () => {
      try {
        res.end();
      } catch {
        // ignore
      }
    });
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
    const chatId = typeof req.body?.chat_id === "string" && req.body.chat_id.trim() ? req.body.chat_id.trim() : null;
    const userId = req.session?.userId || null;

    if (!kind) {
      // No file: stream chat
      let upstreamMessages = null;
      if (userId && chatId && requireDb(req, res)) {
        await ensureChatThread({ chatId, userId });
        await insertChatMessage({ chatId, role: "user", content: String(text || "") });
        await maybeSetChatTitle({ chatId, userId, titleCandidate: String(text || "") });
        const historyRows = await getChatHistoryMessages({ chatId, userId, limit: 120 });
        if (historyRows === null) return res.status(404).json({ error: "Chat not found" });
        upstreamMessages = [systemPromptMessage(), ...historyRows.map(messageToUpstream)];
      } else {
        upstreamMessages = [systemPromptMessage(), { role: "user", content: String(text || "") }];
      }

      const upstream = await axios.post(
        `${API_BASE_URL}/chat/stream`,
        {
          messages: upstreamMessages,
          max_new_tokens
        },
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

      // Capture assistant reply for DB (same as /api/chat/stream)
      let assistantText = "";
      let sseBuf = "";
      upstream.data.on("data", (chunk) => {
        const str = Buffer.isBuffer(chunk) ? chunk.toString("utf8") : String(chunk);
        sseBuf += str;
        let idx;
        while ((idx = sseBuf.indexOf("\n\n")) !== -1) {
          const frame = sseBuf.slice(0, idx);
          sseBuf = sseBuf.slice(idx + 2);
          const lines = frame.split(/\r?\n/);
          let eventName = "message";
          const dataLines = [];
          for (const line of lines) {
            if (line.startsWith("event:")) eventName = line.slice("event:".length).trim() || "message";
            else if (line.startsWith("data:")) dataLines.push(line.slice("data:".length).trimStart());
          }
          if (eventName === "token") {
            try {
              const payload = JSON.parse(dataLines.join("\n"));
              const t = payload?.text;
              if (typeof t === "string") assistantText += t;
            } catch {
              // ignore
            }
          } else if (eventName === "done") {
            try {
              const payload = JSON.parse(dataLines.join("\n"));
              const pretty = payload?.parsed && typeof payload.parsed?.content === "string" ? payload.parsed.content : null;
              if (pretty) assistantText = String(pretty);
            } catch {
              // ignore
            }
          }
        }
        res.write(chunk);
      });
      upstream.data.on("end", async () => {
        try {
          if (userId && chatId && requireDb(req, res) && assistantText) {
            await insertChatMessage({ chatId, role: "assistant", content: assistantText });
            await db.query("update chat_thread set last_message_at = now() where id = $1 and user_id = $2", [chatId, userId]);
          }
        } catch {
          // ignore
        }
        res.end();
      });
      upstream.data.on("error", () => {
        try {
          res.end();
        } catch {
          // ignore
        }
      });
      return;
    }

    // File mode: guest allowed; persistence requires login + db + chat_id
    if (userId && chatId && requireDb(req, res)) {
      await ensureChatThread({ chatId, userId });
    }

    // Save uploaded file so history can show it later
    let attachmentUrl = null;
    let attachmentLabel = null;
    let attachmentMime = null;
    try {
      const original = req.file?.originalname || "upload";
      const ext = path.extname(original) || "";
      const fname = `${uuidv4()}${ext}`;
      fs.writeFileSync(path.join(UPLOAD_DIR, fname), req.file.buffer);
      attachmentUrl = `/uploads/${fname}`;
      attachmentLabel = original;
      attachmentMime = req.file?.mimetype || null;
    } catch {
      // ignore file save failures; still forward upstream
    }

    if (userId && chatId && requireDb(req, res)) {
      await insertChatMessage({
        chatId,
        role: "user",
        content: String(text || "Describe this."),
        attachment_kind: kind,
        attachment_url: attachmentUrl,
        attachment_label: attachmentLabel,
        attachment_mime: attachmentMime
      });
      await maybeSetChatTitle({ chatId, userId, titleCandidate: String(text || "Attachment") });
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

    // Capture assistant reply for DB
    let assistantText = "";
    let sseBuf = "";
    upstream.data.on("data", (chunk) => {
      const str = Buffer.isBuffer(chunk) ? chunk.toString("utf8") : String(chunk);
      sseBuf += str;
      let idx;
      while ((idx = sseBuf.indexOf("\n\n")) !== -1) {
        const frame = sseBuf.slice(0, idx);
        sseBuf = sseBuf.slice(idx + 2);
        const lines = frame.split(/\r?\n/);
        let eventName = "message";
        const dataLines = [];
        for (const line of lines) {
          if (line.startsWith("event:")) eventName = line.slice("event:".length).trim() || "message";
          else if (line.startsWith("data:")) dataLines.push(line.slice("data:".length).trimStart());
        }
        if (eventName === "token") {
          try {
            const payload = JSON.parse(dataLines.join("\n"));
            const t = payload?.text;
            if (typeof t === "string") assistantText += t;
          } catch {
            // ignore
          }
        } else if (eventName === "done") {
          try {
            const payload = JSON.parse(dataLines.join("\n"));
            const pretty = payload?.parsed && typeof payload.parsed?.content === "string" ? payload.parsed.content : null;
            if (pretty) assistantText = String(pretty);
          } catch {
            // ignore
          }
        }
      }
      res.write(chunk);
    });
    upstream.data.on("end", async () => {
      try {
        if (userId && chatId && requireDb(req, res) && assistantText) {
          await insertChatMessage({ chatId, role: "assistant", content: assistantText });
          await db.query("update chat_thread set last_message_at = now() where id = $1 and user_id = $2", [chatId, userId]);
        }
      } catch {
        // ignore
      }
      res.end();
    });
    upstream.data.on("error", () => {
      try {
        res.end();
      } catch {
        // ignore
      }
    });
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

