const el = (id) => document.getElementById(id);

const chatEl = el("chat");
const welcomeEl = el("welcome");
const messagesEl = el("messages");
const composerEl = el("composer");
const textEl = el("text");
const fileEl = el("file");
const fileHintEl = el("fileHint");
const sendBtnEl = el("sendBtn");

let chatOpened = false;

/** @type {{ role: string, content: string }[]} */
let chatHistory = [];

/** Max messages (user + assistant) kept for the next request; avoids huge payloads. */
const MAX_CHAT_HISTORY_MESSAGES = 100;

function openChatIfNeeded() {
  if (chatOpened) return;
  chatOpened = true;
  if (chatEl) chatEl.classList.add("chat--opened");
  if (welcomeEl) {
    welcomeEl.classList.add("welcome--hide");
    setTimeout(() => {
      welcomeEl.remove();
    }, 230);
  }
  // After the transition, remove landing class so normal layout applies.
  setTimeout(() => {
    if (chatEl) chatEl.classList.remove("chat--landing");
  }, 420);
}

function nowTime() {
  return new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function escapeHtml(s) {
  return String(s)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function renderInlineMarkdown(escapedText) {
  // `code`
  let out = escapedText.replace(/`([^`]+?)`/g, "<code>$1</code>");
  // **bold**
  out = out.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
  // *italic* (avoid matching list markers; list parsing runs before this)
  out = out.replace(/\*([^*\n]+?)\*/g, "<em>$1</em>");
  return out;
}

function renderBasicMarkdown(s) {
  // Minimal rendering: **bold**, newlines, and simple bullet lists.
  // (No links/html; everything is escaped first.)
  const escaped = escapeHtml(s);

  const lines = escaped.split(/\r?\n/);
  let html = "";
  let inList = false;

  const flushListClose = () => {
    if (inList) {
      html += "</ul>";
      inList = false;
    }
  };

  for (const line of lines) {
    const m = line.match(/^\s*([*-])\s+(.*)$/);
    if (m) {
      if (!inList) {
        html += "<ul>";
        inList = true;
      }
      html += `<li>${renderInlineMarkdown(m[2])}</li>`;
    } else {
      flushListClose();
      html += `${renderInlineMarkdown(line)}<br/>`;
    }
  }
  flushListClose();

  // Trim a final <br/> if present
  html = html.replace(/(<br\/>)+$/, "");
  return html;
}

function trimChatHistory(messages) {
  if (!Array.isArray(messages) || messages.length <= MAX_CHAT_HISTORY_MESSAGES) return messages;
  return messages.slice(messages.length - MAX_CHAT_HISTORY_MESSAGES);
}

function formatAssistantResponse(payload, fallbackText) {
  if (payload && typeof payload === "object") {
    const parsedContent =
      payload?.parsed && typeof payload.parsed === "object" && typeof payload.parsed.content === "string"
        ? payload.parsed.content
        : null;
    if (parsedContent) return { pretty: parsedContent, raw: JSON.stringify(payload, null, 2) };
    return { pretty: JSON.stringify(payload, null, 2), raw: JSON.stringify(payload, null, 2) };
  }
  return { pretty: String(fallbackText || ""), raw: String(fallbackText || "") };
}

function formatTps(payload) {
  const v = payload?.tokens_per_second;
  const n = typeof v === "number" ? v : typeof v === "string" ? Number(v) : NaN;
  if (!Number.isFinite(n) || n <= 0) return null;
  return `${n.toFixed(2)} tok/s`;
}

function formatTimeToFirstToken(payload) {
  const v = payload?.time_to_first_token_seconds;
  const n = typeof v === "number" ? v : typeof v === "string" ? Number(v) : NaN;
  if (!Number.isFinite(n) || n < 0) return null;
  return `${n.toFixed(4)}s to first token`;
}

function formatResponseMetrics(payload) {
  if (!payload) return "";
  const parts = [formatTimeToFirstToken(payload), formatTps(payload)].filter(Boolean);
  return parts.length ? ` • ${parts.join(" • ")}` : "";
}

function addMessage({ role, content, meta, attachment, isPending = false }) {
  const wrapper = document.createElement("div");
  wrapper.className = `msg ${role === "user" ? "msg--user" : "msg--assistant"}`;

  const m = document.createElement("div");
  m.className = "msg__meta";
  const left = document.createElement("div");
  left.textContent = role === "user" ? "you" : "assistant";
  const right = document.createElement("div");
  right.textContent = meta || nowTime();
  m.appendChild(left);
  m.appendChild(right);

  const body = document.createElement("div");
  if (role === "assistant") {
    body.className = "msg__body";
    if (isPending) {
      body.innerHTML = `
        <span class="pending" aria-label="Waiting">
          <span class="pending__cursor" aria-hidden="true"></span>
        </span>
      `;
    } else {
      body.innerHTML = renderBasicMarkdown(String(content || ""));
    }
  } else {
    body.className = "msg__body";
    body.textContent = content;
  }

  wrapper.appendChild(m);

  if (attachment && attachment.kind) {
    const a = document.createElement("div");
    a.className = "msg__attachment";
    const label = document.createElement("div");
    label.className = "msg__attachmentLabel";
    label.textContent = attachment.label || "Attachment";
    a.appendChild(label);

    if (attachment.kind === "image") {
      const img = document.createElement("img");
      img.className = "msg__image";
      img.alt = attachment.label || "image";
      img.src = attachment.url;
      a.appendChild(img);
    } else if (attachment.kind === "audio") {
      const audio = document.createElement("audio");
      audio.className = "msg__media";
      audio.controls = true;
      audio.src = attachment.url;
      a.appendChild(audio);
    } else if (attachment.kind === "video") {
      const video = document.createElement("video");
      video.className = "msg__media";
      video.controls = true;
      video.src = attachment.url;
      a.appendChild(video);
    }
    wrapper.appendChild(a);
  }

  wrapper.appendChild(body);
  messagesEl.appendChild(wrapper);
  messagesEl.scrollTop = messagesEl.scrollHeight;
  return { wrapper, body };
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function typeWordsInto(el, fullText) {
  // Type as plain text for smoothness; then replace with formatted HTML at the end.
  const words = String(fullText || "").split(/\s+/).filter(Boolean);
  el.textContent = "";
  for (let i = 0; i < words.length; i++) {
    el.textContent += (i === 0 ? "" : " ") + words[i];
    // speed curve: fast, but not instant
    // small pauses for punctuation-like endings
    const w = words[i];
    const extra = /[.!?]$/.test(w) ? 70 : /[,;:]$/.test(w) ? 35 : 0;
    await sleep(18 + extra);
    messagesEl.scrollTop = messagesEl.scrollHeight;
  }
  el.innerHTML = renderBasicMarkdown(String(fullText || ""));
}

function classifyFile(file) {
  const mt = (file?.type || "").toLowerCase();
  if (mt.startsWith("image/")) return "image";
  if (mt.startsWith("audio/")) return "audio";
  if (mt.startsWith("video/")) return "video";
  return "file";
}

function tryParseMessages(text) {
  const trimmed = (text || "").trim();
  if (!trimmed.startsWith("[")) return null;
  try {
    const parsed = JSON.parse(trimmed);
    if (Array.isArray(parsed)) return parsed;
    return null;
  } catch {
    return null;
  }
}

function parseSseChunk(state, chunkText, onEvent) {
  // SSE frames are separated by blank line (\n\n). Each frame has lines like:
  // event: token
  // data: {"text":"..."}
  state.buffer += chunkText;

  let idx;
  while ((idx = state.buffer.indexOf("\n\n")) !== -1) {
    const rawFrame = state.buffer.slice(0, idx);
    state.buffer = state.buffer.slice(idx + 2);

    const lines = rawFrame.split(/\r?\n/);
    let eventName = "message";
    const dataLines = [];
    for (const line of lines) {
      if (line.startsWith("event:")) {
        eventName = line.slice("event:".length).trim() || "message";
      } else if (line.startsWith("data:")) {
        dataLines.push(line.slice("data:".length).trimStart());
      }
    }
    const dataStr = dataLines.join("\n");
    onEvent({ event: eventName, data: dataStr });
  }
}

async function send() {
  const text = (textEl.value || "").trim();
  const max_new_tokens = 512;
  const file = fileEl.files && fileEl.files[0] ? fileEl.files[0] : null;

  if (!text && !file) {
    addMessage({ role: "assistant", content: "Please enter text or attach a file." });
    return;
  }

  openChatIfNeeded();
  const autoMode = file ? classifyFile(file) : "chat";

  let attachment = null;
  if (file) {
    attachment = {
      kind: autoMode === "image" || autoMode === "audio" || autoMode === "video" ? autoMode : "file",
      label: `${file.name} (${Math.round(file.size / 1024)} KB)`,
      url: URL.createObjectURL(file)
    };
  }

  addMessage({
    role: "user",
    content:
      file
        ? text || "Describe this."
        : text,
    meta: autoMode,
    attachment
  });

  // Clear input right after sending (keep attachment until user removes it).
  textEl.value = "";
  // Also clear attachment chip + file input after sending.
  fileEl.value = "";
  setFileChip(null);

  sendBtnEl.disabled = true;

  const pending = addMessage({ role: "assistant", content: "", meta: `${autoMode} • …`, isPending: true });

  try {
    // Stream for chat and for uploads (image/video/audio).
    if (!file) {
      const parsedMessages = tryParseMessages(text);
      const messages = parsedMessages || [{ role: "user", content: text || "" }];

      const r = await fetch("/api/chat/stream", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages, max_new_tokens })
      });

      const metaRight = pending.wrapper?.querySelector(".msg__meta > div:last-child");
      if (metaRight) metaRight.textContent = `${autoMode} • ${r.status} • streaming`;

      if (!r.ok) {
        const errText = await r.text();
        throw new Error(errText || `HTTP ${r.status}`);
      }

      const reader = r.body?.getReader?.();
      if (!reader) throw new Error("Streaming not supported by this browser.");

      const decoder = new TextDecoder("utf-8");
      const sseState = { buffer: "" };

      let assistantText = "";
      let donePayload = null;
      let modelPath = null;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const chunkText = decoder.decode(value, { stream: true });

        parseSseChunk(sseState, chunkText, ({ event, data }) => {
          if (!data) return;
          let payload = null;
          try {
            payload = JSON.parse(data);
          } catch {
            payload = null;
          }

          if (event === "meta") {
            modelPath = payload?.model_path || modelPath;
            return;
          }

          if (event === "token") {
            const t = payload?.text;
            if (typeof t === "string") {
              assistantText += t;
              if (pending?.body) pending.body.textContent = assistantText;
              messagesEl.scrollTop = messagesEl.scrollHeight;
            }
            return;
          }

          if (event === "done") {
            donePayload = payload;
          }
        });
      }

      const finalPretty =
        donePayload?.parsed && typeof donePayload.parsed?.content === "string" ? donePayload.parsed.content : assistantText;
      const metrics = formatResponseMetrics(donePayload);

      if (pending?.body) {
        pending.body.innerHTML = renderBasicMarkdown(String(finalPretty || ""));
      }
      if (metaRight) {
        metaRight.textContent = `${autoMode} • ${r.status}${metrics}`;
      }
    } else {
      const form = new FormData();
      form.append("max_new_tokens", String(max_new_tokens));
      form.append("text", text || "Describe this.");

      form.append("file", file);

      const r = await fetch("/api/submit/stream", { method: "POST", body: form });

      const metaRight = pending.wrapper?.querySelector(".msg__meta > div:last-child");
      if (metaRight) metaRight.textContent = `${autoMode} • ${r.status} • streaming`;

      if (!r.ok) {
        const errText = await r.text();
        throw new Error(errText || `HTTP ${r.status}`);
      }

      const reader = r.body?.getReader?.();
      if (!reader) throw new Error("Streaming not supported by this browser.");

      const decoder = new TextDecoder("utf-8");
      const sseState = { buffer: "" };

      let assistantText = "";
      let donePayload = null;
      let modelPath = null;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const chunkText = decoder.decode(value, { stream: true });

        parseSseChunk(sseState, chunkText, ({ event, data }) => {
          if (!data) return;
          let payload = null;
          try {
            payload = JSON.parse(data);
          } catch {
            payload = null;
          }

          if (event === "meta") {
            modelPath = payload?.model_path || modelPath;
            return;
          }

          if (event === "token") {
            const t = payload?.text;
            if (typeof t === "string") {
              assistantText += t;
              if (pending?.body) pending.body.textContent = assistantText;
              messagesEl.scrollTop = messagesEl.scrollHeight;
            }
            return;
          }

          if (event === "done") {
            donePayload = payload;
          }
        });
      }

      const finalPretty =
        donePayload?.parsed && typeof donePayload.parsed?.content === "string" ? donePayload.parsed.content : assistantText;
      const metrics = formatResponseMetrics(donePayload);

      if (pending?.body) pending.body.innerHTML = renderBasicMarkdown(String(finalPretty || ""));
      if (metaRight) {
        metaRight.textContent = `${autoMode} • ${r.status}${metrics}`;
      }
    }
  } catch (e) {
    if (pending?.body) {
      pending.body.textContent = `Error: ${String(e?.message || e)}`;
    } else {
      addMessage({ role: "assistant", content: `Error: ${String(e?.message || e)}` });
    }
  } finally {
    sendBtnEl.disabled = false;
  }
}

composerEl.addEventListener("submit", (e) => {
  e.preventDefault();
  send();
});

// Enter to send (Shift+Enter for newline)
textEl.addEventListener("keydown", (e) => {
  if (e.key !== "Enter") return;
  if (e.shiftKey) return;
  e.preventDefault();
  send();
});

function autosizeTextarea() {
  // Keep single-line centered; grow up to CSS max-height as needed.
  textEl.style.height = "0px";
  textEl.style.height = `${textEl.scrollHeight}px`;
}

textEl.addEventListener("input", autosizeTextarea);
autosizeTextarea();

function setFileChip(file) {
  if (!fileHintEl) return;
  if (!file) {
    fileHintEl.innerHTML = "";
    return;
  }
  fileHintEl.innerHTML = `
    <span class="filechip">
      <span class="filechip__name">Attached: ${escapeHtml(file.name)}</span>
      <button class="filechip__x" type="button" id="removeFileBtn" aria-label="Remove attachment" title="Remove">
        ×
      </button>
    </span>
  `;
  const btn = document.getElementById("removeFileBtn");
  if (btn) {
    btn.addEventListener("click", () => {
      fileEl.value = "";
      setFileChip(null);
    });
  }
}

fileEl.addEventListener("change", () => {
  const f = fileEl.files && fileEl.files[0] ? fileEl.files[0] : null;
  setFileChip(f);
});

