const el = (id) => document.getElementById(id);

const chatEl = el("chat");
// NOTE: #welcome can be removed/recreated; query it when needed.
const messagesEl = el("messages");
const composerEl = el("composer");
const textEl = el("text");
const fileEl = el("file");
const fileHintEl = el("fileHint");
const sendBtnEl = el("sendBtn");

const authGateEl = el("authGate");
const authFormEl = el("authForm");
const authUserEl = el("authUser");
const authPassEl = el("authPass");
const authHintEl = el("authHint");
const authRegisterBtnEl = el("authRegisterBtn");
const authLoginBtnEl = el("authLoginBtn");
const authTitleEl = el("authTitle");
const authSubtitleEl = el("authSubtitle");
const authCloseBtnEl = el("authCloseBtn");
const loginBtnEl = el("loginBtn");
const signupBtnEl = el("signupBtn");
const logoutBtnEl = el("logoutBtn");
const sessionsEl = el("sessions");
const sessionsListEl = el("sessionsList");
const newChatBtnEl = el("newChatBtn");
const mainEl = document.querySelector(".main");

const confirmEl = el("confirm");
const confirmTitleEl = el("confirmTitle");
const confirmBodyEl = el("confirmBody");
const confirmCancelBtnEl = el("confirmCancelBtn");
const confirmOkBtnEl = el("confirmOkBtn");

let chatOpened = false;
let autoScrollEnabled = true;

// Guest (not logged in) conversation memory. This is used to build messages[] for the model.
const GUEST_MAX_MESSAGES = 60;
/** @type {{ role: string, content: string }[]} */
let guestMessages = [];

function trimGuestMessages(msgs) {
  if (!Array.isArray(msgs) || msgs.length <= GUEST_MAX_MESSAGES) return Array.isArray(msgs) ? msgs : [];
  return msgs.slice(msgs.length - GUEST_MAX_MESSAGES);
}

function guestAppend(role, content) {
  if (!role || typeof content !== "string") return;
  guestMessages = trimGuestMessages([...guestMessages, { role, content }]);
}

function resetGuestChat() {
  guestMessages = [];
}

function clearMessagesUi() {
  if (!messagesEl) return;
  messagesEl.innerHTML = "";
}

function resetChatToLanding() {
  chatOpened = false;
  if (chatEl) {
    chatEl.classList.remove("chat--opened");
    chatEl.classList.add("chat--landing");
  }
  // Recreate welcome if it was removed after first open.
  const existingWelcome = document.getElementById("welcome");
  if (!existingWelcome && chatEl) {
    const w = document.createElement("div");
    w.className = "welcome";
    w.id = "welcome";
    w.textContent = "Welcome to Inventec AI Studio!";
    const msgs = document.getElementById("messages");
    if (msgs && msgs.parentElement) {
      msgs.parentElement.insertBefore(w, msgs);
    } else {
      chatEl.insertBefore(w, chatEl.firstChild);
    }
  } else if (existingWelcome) {
    existingWelcome.classList.remove("welcome--hide");
  }
}

function getOrCreateChatId() {
  try {
    const k = "gemma4-demo.chat_id";
    const existing = localStorage.getItem(k);
    if (existing && typeof existing === "string" && existing.trim()) return existing.trim();
    const id = crypto?.randomUUID ? crypto.randomUUID() : String(Date.now());
    localStorage.setItem(k, id);
    return id;
  } catch {
    return crypto?.randomUUID ? crypto.randomUUID() : String(Date.now());
  }
}

function clearChatId() {
  try {
    localStorage.removeItem("gemma4-demo.chat_id");
  } catch {
    // ignore
  }
}

async function apiGetJson(url) {
  const r = await fetch(url);
  const data = await r.json().catch(() => null);
  if (!r.ok) {
    const err = data?.error || `HTTP ${r.status}`;
    const details = data && typeof data === "object" && typeof data.details === "string" && data.details ? ` — ${data.details}` : "";
    throw new Error(`${err}${details}`);
  }
  return data;
}

async function apiPostJson(url, body) {
  const r = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body || {})
  });
  const data = await r.json().catch(() => null);
  if (!r.ok) {
    const err = data?.error || `HTTP ${r.status}`;
    const details = data && typeof data === "object" && typeof data.details === "string" && data.details ? ` — ${data.details}` : "";
    throw new Error(`${err}${details}`);
  }
  return data;
}

async function apiDeleteJson(url) {
  const r = await fetch(url, { method: "DELETE" });
  const data = await r.json().catch(() => null);
  if (!r.ok) {
    const err = data?.error || `HTTP ${r.status}`;
    const details = data && typeof data === "object" && typeof data.details === "string" && data.details ? ` — ${data.details}` : "";
    throw new Error(`${err}${details}`);
  }
  return data;
}

let confirmResolve = null;
function showConfirm({ title, body, okText, cancelText } = {}) {
  if (!confirmEl) return Promise.resolve(false);
  if (confirmTitleEl) confirmTitleEl.textContent = title || "Confirm";
  if (confirmBodyEl) confirmBodyEl.textContent = body || "Are you sure?";
  if (confirmOkBtnEl) confirmOkBtnEl.textContent = okText || "OK";
  if (confirmCancelBtnEl) confirmCancelBtnEl.textContent = cancelText || "Cancel";

  confirmEl.classList.add("confirm--show");
  confirmEl.setAttribute("aria-hidden", "false");

  return new Promise((resolve) => {
    confirmResolve = resolve;
    setTimeout(() => confirmCancelBtnEl?.focus?.(), 0);
  });
}

function hideConfirm(result) {
  if (!confirmEl) return;
  confirmEl.classList.remove("confirm--show");
  confirmEl.setAttribute("aria-hidden", "true");
  const r = confirmResolve;
  confirmResolve = null;
  if (typeof r === "function") r(!!result);
}

if (confirmCancelBtnEl) confirmCancelBtnEl.addEventListener("click", () => hideConfirm(false));
if (confirmOkBtnEl) confirmOkBtnEl.addEventListener("click", () => hideConfirm(true));
if (confirmEl) {
  confirmEl.addEventListener("click", (e) => {
    if (e.target === confirmEl) hideConfirm(false);
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && confirmEl.classList.contains("confirm--show")) hideConfirm(false);
  });
}

function setSessionsVisible(show) {
  if (!sessionsEl) return;
  sessionsEl.classList.toggle("sessions--show", !!show);
  if (mainEl) mainEl.classList.toggle("main--with-sessions", !!show);
  try {
    document.body.classList.toggle("layout--with-sessions", !!show);
  } catch {
    // ignore
  }
}

function fmtTime(ts) {
  try {
    return new Date(ts).toLocaleString();
  } catch {
    return String(ts || "");
  }
}

function setActiveSessionUi(chatId) {
  if (!sessionsListEl) return;
  const items = sessionsListEl.querySelectorAll(".session");
  items.forEach((el2) => {
    el2.classList.toggle("session--active", el2.getAttribute("data-chat-id") === chatId);
  });
}

async function refreshSessionsList(activeChatId) {
  if (!sessionsListEl) return;
  sessionsListEl.innerHTML = "";
  const data = await apiGetJson("/api/history/chats");
  const chats = Array.isArray(data?.chats) ? data.chats : [];
  for (const c of chats) {
    const id = String(c?.id || "");
    const created_at = c?.created_at;
    const title = typeof c?.title === "string" && c.title.trim() ? c.title.trim() : "New chat";
    const row = document.createElement("div");
    row.className = "session";
    row.setAttribute("role", "listitem");
    row.setAttribute("data-chat-id", id);
    row.innerHTML = `<div class="session__top"><div class="session__time">${fmtTime(created_at)}</div><button class="session__menuBtn" type="button" title="Menu" aria-label="Menu">⋯</button></div><div class="session__title">${escapeHtml(title)}</div><div class="session__menu" hidden><button class="session__menuItem" type="button">Delete</button></div>`;
    row.addEventListener("click", async () => {
      await loadChatSession(id);
    });
    const menuBtn = row.querySelector(".session__menuBtn");
    const menu = row.querySelector(".session__menu");
    const delBtn = row.querySelector(".session__menuItem");
    if (menuBtn && menu) {
      menuBtn.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        const nextHidden = !menu.hasAttribute("hidden") ? true : false;
        // Close other menus
        sessionsListEl.querySelectorAll(".session__menu").forEach((m) => m.setAttribute("hidden", ""));
        if (nextHidden) menu.setAttribute("hidden", "");
        else menu.removeAttribute("hidden");
      });
    }
    if (delBtn) {
      delBtn.addEventListener("click", async (e) => {
        e.preventDefault();
        e.stopPropagation();
        const ok = await showConfirm({
          title: "Delete chat?",
          body: "Delete this chat session? This cannot be undone.",
          okText: "Delete",
          cancelText: "Cancel"
        });
        if (!ok) return;
        try {
          await apiDeleteJson(`/api/history/chats/${encodeURIComponent(id)}`);
          // If deleting active chat, clear it so ensureLoggedIn() will create a new one.
          const currentId = (() => {
            try {
              return localStorage.getItem("gemma4-demo.chat_id");
            } catch {
              return null;
            }
          })();
          if (currentId && currentId === id) {
            clearChatId();
            clearMessagesUi();
          }
          await ensureLoggedIn({ forceNewChat: !localStorage.getItem("gemma4-demo.chat_id") });
        } catch (err) {
          setAuthHint(String(err?.message || err));
        }
      });
    }
    sessionsListEl.appendChild(row);
  }
  if (activeChatId) setActiveSessionUi(activeChatId);
}

async function loadChatSession(chatId) {
  if (!chatId) return;
  // Ensure chat panel is in the opened state (otherwise landing UI can hide the history).
  openChatIfNeeded();
  clearMessagesUi();
  const data = await apiGetJson(`/api/history/chats/${encodeURIComponent(chatId)}`);
  const msgs = Array.isArray(data?.messages) ? data.messages : [];
  for (const m of msgs) {
    const role = m.role === "assistant" ? "assistant" : "user";
    const attachment =
      m.attachment_kind && m.attachment_url
        ? { kind: m.attachment_kind, label: m.attachment_label || m.attachment_kind, url: m.attachment_url }
        : null;
    addMessage({ role, content: String(m.content || ""), meta: role, attachment });
  }
  try {
    localStorage.setItem("gemma4-demo.chat_id", chatId);
  } catch {
    // ignore
  }
  setActiveSessionUi(chatId);
  maybeAutoScroll();
}

function showAuthGate(show) {
  if (!authGateEl) return;
  if (show) {
    authGateEl.classList.add("authgate--show");
    authGateEl.setAttribute("aria-hidden", "false");
    setTimeout(() => authUserEl?.focus?.(), 0);
  } else {
    authGateEl.classList.remove("authgate--show");
    authGateEl.setAttribute("aria-hidden", "true");
  }
}

function setAuthMode(mode) {
  const m = mode === "signup" ? "signup" : "login";
  if (authTitleEl) authTitleEl.textContent = m === "signup" ? "Sign up for free" : "Log in";
  if (authSubtitleEl) authSubtitleEl.textContent = m === "signup" ? "Create an account to save chats." : "Welcome back.";

  if (authLoginBtnEl) authLoginBtnEl.style.display = m === "login" ? "" : "none";
  if (authRegisterBtnEl) authRegisterBtnEl.style.display = m === "signup" ? "" : "none";

  if (authPassEl) authPassEl.setAttribute("autocomplete", m === "signup" ? "new-password" : "current-password");
}

// Close login modal only via the X button (not by clicking the backdrop).
if (authCloseBtnEl) {
  authCloseBtnEl.addEventListener("click", () => {
    showAuthGate(false);
    setAuthHint("");
  });
}

function setAuthHint(msg) {
  if (!authHintEl) return;
  authHintEl.textContent = msg ? String(msg) : "";
}

async function authJson(url, body) {
  const r = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body || {})
  });
  const data = await r.json().catch(() => null);
  if (!r.ok) {
    const err = data?.error || `HTTP ${r.status}`;
    const details =
      data && typeof data === "object" && typeof data.details === "string" && data.details.trim() ? data.details.trim() : "";
    throw new Error(details ? `${err} — ${details}` : err);
  }
  return data;
}

async function ensureLoggedIn({ forceNewChat = false } = {}) {
  try {
    const r = await fetch("/api/auth/me");
    const data = await r.json().catch(() => null);
    if (data?.user) {
      showAuthGate(false);
      if (loginBtnEl) loginBtnEl.style.display = "none";
      if (signupBtnEl) signupBtnEl.style.display = "none";
      if (logoutBtnEl) logoutBtnEl.style.display = "";
      setSessionsVisible(true);

      // After login, always start with a fresh DB chat session when requested.
      let activeId = null;
      try {
        activeId = localStorage.getItem("gemma4-demo.chat_id");
      } catch {
        activeId = null;
      }
      if (forceNewChat) {
        activeId = null;
        try {
          localStorage.removeItem("gemma4-demo.chat_id");
        } catch {
          // ignore
        }
      }
      if (!activeId) {
        if (sendBtnEl) sendBtnEl.disabled = true;
        const created = await apiPostJson("/api/history/chats", {});
        activeId = created?.chat?.id || null;
        if (activeId) {
          try {
            localStorage.setItem("gemma4-demo.chat_id", activeId);
          } catch {
            // ignore
          }
        }
        if (sendBtnEl) sendBtnEl.disabled = false;
      }
      await refreshSessionsList(activeId);
      if (activeId) setActiveSessionUi(activeId);
      return true;
    }
  } catch {
    // ignore
  }
  showAuthGate(false);
  if (loginBtnEl) loginBtnEl.style.display = "";
  if (signupBtnEl) signupBtnEl.style.display = "";
  if (logoutBtnEl) logoutBtnEl.style.display = "none";
  setSessionsVisible(false);
  if (sessionsListEl) sessionsListEl.innerHTML = "";
  return false;
}

function normalizeEmail(s) {
  return String(s || "").trim().toLowerCase();
}

function isNearBottom(container, thresholdPx = 80) {
  if (!container) return true;
  const distance = container.scrollHeight - container.scrollTop - container.clientHeight;
  return distance <= thresholdPx;
}

function maybeAutoScroll() {
  if (!messagesEl) return;
  if (!autoScrollEnabled) return;
  messagesEl.scrollTop = messagesEl.scrollHeight;
}

// If the user scrolls up, stop snapping to bottom during streaming.
if (messagesEl) {
  messagesEl.addEventListener("scroll", () => {
    autoScrollEnabled = isNearBottom(messagesEl);
  });

  messagesEl.addEventListener("click", (e) => {
    const btn = e.target.closest(".md-code-copy");
    if (!btn || !messagesEl.contains(btn)) return;
    e.preventDefault();
    const wrap = btn.closest(".md-code-wrap");
    const codeEl = wrap?.querySelector("pre.md-pre code");
    if (!codeEl) return;
    const text = codeEl.textContent ?? "";
    const done = () => {
      btn.classList.add("md-code-copy--done");
      btn.setAttribute("aria-label", "Copied");
      const prev = btn.getAttribute("data-prev-title");
      if (prev == null) btn.setAttribute("data-prev-title", btn.title || "");
      btn.title = "Copied";
      window.clearTimeout(btn._copyResetT);
      btn._copyResetT = window.setTimeout(() => {
        btn.classList.remove("md-code-copy--done");
        btn.setAttribute("aria-label", "Copy code");
        const t = btn.getAttribute("data-prev-title");
        if (t != null) btn.title = t;
      }, 1600);
    };
    if (navigator.clipboard && typeof navigator.clipboard.writeText === "function") {
      navigator.clipboard.writeText(text).then(done).catch(() => {
        try {
          const ta = document.createElement("textarea");
          ta.value = text;
          ta.style.position = "fixed";
          ta.style.left = "-9999px";
          document.body.appendChild(ta);
          ta.select();
          document.execCommand("copy");
          document.body.removeChild(ta);
          done();
        } catch {
          /* ignore */
        }
      });
    } else {
      try {
        const ta = document.createElement("textarea");
        ta.value = text;
        ta.style.position = "fixed";
        ta.style.left = "-9999px";
        document.body.appendChild(ta);
        ta.select();
        document.execCommand("copy");
        document.body.removeChild(ta);
        done();
      } catch {
        /* ignore */
      }
    }
  });
}

// Close session menus when clicking elsewhere
document.addEventListener("click", (e) => {
  if (!sessionsListEl) return;
  const t = e.target;
  if (t && typeof t.closest === "function") {
    if (t.closest(".session__menu") || t.closest(".session__menuBtn")) return;
  }
  sessionsListEl.querySelectorAll(".session__menu").forEach((m) => m.setAttribute("hidden", ""));
});

// Chat context is stored server-side in Postgres keyed by chat_id.

function openChatIfNeeded() {
  if (chatOpened) return;
  chatOpened = true;
  if (chatEl) chatEl.classList.add("chat--opened");
  const welcomeEl = document.getElementById("welcome");
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

/** http(s), mailto, relative paths, data:image/* for img; blocks javascript: and dangerous data: */
function isSafeUrlForMarkdown(href, { forImage = false } = {}) {
  const h = String(href || "").trim();
  if (!h) return false;
  const low = h.slice(0, 32).toLowerCase();
  if (low.startsWith("javascript:") || low.startsWith("vbscript:")) return false;
  if (forImage) {
    if (low.startsWith("data:") && !low.startsWith("data:image/")) return false;
  } else if (low.startsWith("data:")) {
    return false;
  }
  return true;
}

/**
 * Inline `$...$` with KaTeX; skips `<code>...</code>` spans so `$` in code is literal.
 */
function renderInlineMathInHtml(html) {
  const stash = [];
  let masked = html.replace(/<code>[\s\S]*?<\/code>/gi, (m) => {
    stash.push(m);
    return `«MDCODE${stash.length - 1}»`;
  });

  masked = masked.replace(/\$([^$\n]+?)\$/g, (full, tex) => {
    const trimmed = String(tex).trim();
    if (!trimmed) return full;
    if (typeof katex !== "undefined" && typeof katex.renderToString === "function") {
      try {
        const inner = katex.renderToString(trimmed, {
          displayMode: false,
          throwOnError: false,
          strict: "warn"
        });
        return `<span class="md-math">${inner}</span>`;
      } catch {
        return `<span class="md-math md-math--plain">${escapeHtml(trimmed)}</span>`;
      }
    }
    return `<span class="md-math md-math--plain">${escapeHtml(trimmed)}</span>`;
  });

  stash.forEach((chunk, idx) => {
    masked = masked.replace(`«MDCODE${idx}»`, chunk);
  });
  return masked;
}

function renderInlineMarkdown(escapedText) {
  // `code` — first so other rules do not touch code contents
  let out = escapedText.replace(/`([^`]+?)`/g, "<code>$1</code>");
  // ~~strikethrough~~ (before bold/italic so patterns can nest sensibly)
  out = out.replace(/~~(.+?)~~/g, "<del>$1</del>");
  // **bold** and __bold__
  out = out.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
  out = out.replace(/__(.+?)__/g, "<strong>$1</strong>");
  // *italic* (before images so list-like * is not confused here — list lines never reach this whole-line path)
  out = out.replace(/\*([^*\n]+?)\*/g, "<em>$1</em>");
  // ![alt](url) and [label](url) before _italic_ so alts like ![x_y](u) or ![_alt_](u) stay intact
  out = out.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, (full, alt, href) => {
    if (!isSafeUrlForMarkdown(href, { forImage: true })) return full;
    const safeHref = escapeHtml(String(href).trim());
    return `<img class="md-img" src="${safeHref}" alt="${alt}" loading="lazy" decoding="async" />`;
  });
  out = out.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (full, label, href) => {
    if (!isSafeUrlForMarkdown(href)) return full;
    const safeHref = escapeHtml(String(href).trim());
    const ext = /^https?:\/\//i.test(String(href).trim());
    const rel = ext ? ' target="_blank" rel="noopener noreferrer"' : "";
    return `<a href="${safeHref}" class="md-link"${rel}>${label}</a>`;
  });
  // _italic_ last among emphasis (underscores common in URLs/alts)
  out = out.replace(/_([^_\n]+?)_/g, "<em>$1</em>");
  out = renderInlineMathInHtml(out);
  return out;
}

function splitTableRow(line) {
  const t = line.trim();
  if (!t.includes("|")) return null;
  const core = t.replace(/^\|/, "").replace(/\|$/, "");
  return core.split("|").map((c) => c.trim());
}

function isTableSeparatorCell(cell) {
  const t = cell.trim();
  return /^:?-{3,}:?$/.test(t);
}

/**
 * If lines[i] starts a GFM-style table (header + separator), returns { html, nextIndex }.
 */
function tryParseTable(lines, i) {
  if (i + 1 >= lines.length) return null;
  const headerCells = splitTableRow(lines[i]);
  const sepCells = splitTableRow(lines[i + 1]);
  if (!headerCells || headerCells.length < 2 || !sepCells || sepCells.length !== headerCells.length) return null;
  if (!sepCells.every(isTableSeparatorCell)) return null;

  let html =
    '<table class="md-table"><thead><tr>' +
    headerCells.map((c) => `<th>${renderInlineMarkdown(escapeHtml(c))}</th>`).join("") +
    "</tr></thead><tbody>";

  let j = i + 2;
  while (j < lines.length) {
    const rowLine = lines[j];
    if (rowLine.trim() === "") break;
    const cells = splitTableRow(rowLine);
    if (!cells || cells.length !== headerCells.length) break;
    html += "<tr>" + cells.map((c) => `<td>${renderInlineMarkdown(escapeHtml(c))}</td>`).join("") + "</tr>";
    j++;
  }

  html += "</tbody></table>";
  return { html, nextIndex: j };
}

function headingTagForDepth(depth) {
  const d = Math.min(Math.max(depth, 1), 6);
  return `h${d}`;
}

/** Standalone thematic break: ---, ***, or ___ (GFM; not a table row — no `|`). */
function isSectionDividerLine(trimmed) {
  if (trimmed.includes("|")) return false;
  return /^\s*(?:-{3,}|\*{3,}|_{3,})\s*$/.test(trimmed);
}

/** Drop leading/trailing `---` lines so dividers never render at start/end. */
function trimSectionDividerBoundaries(lines) {
  let a = 0;
  let b = lines.length;
  while (a < b) {
    const t = lines[a].trim();
    if (t === "") {
      a++;
      continue;
    }
    if (isSectionDividerLine(t)) {
      a++;
      continue;
    }
    break;
  }
  while (b > a) {
    const t = lines[b - 1].trim();
    if (t === "") {
      b--;
      continue;
    }
    if (isSectionDividerLine(t)) {
      b--;
      continue;
    }
    break;
  }
  return lines.slice(a, b);
}

/**
 * Unordered list line: optional indent (2 spaces per level), then - * + or bullet •, then content.
 * Layout (bullets, nesting) is applied here — not via system prompt.
 */
function matchListItemLine(line) {
  const m = line.match(/^(\s*)([-*+]|\u2022)\s+(.*)$/);
  if (!m) return null;
  const spaces = m[1].length;
  const depth = Math.max(1, Math.floor(spaces / 2) + 1);
  return { depth, body: m[3] };
}

function renderBasicMarkdown(s) {
  // **bold**, `code`, *italic*, links/images, ## headers, GFM tables, hr (---/***/___), fenced ``` code,
  // blockquotes (>), -/*/+ lists. Structure is parsed from raw lines; text segments are escaped then inlined.
  let lines = trimSectionDividerBoundaries(String(s).split(/\r?\n/));
  let html = "";
  let inList = false;
  let lastOutputWasDivider = false;

  const flushListClose = () => {
    if (inList) {
      html += "</ul>";
      inList = false;
    }
  };

  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    const trimmed = line.trim();

    if (trimmed === "") {
      flushListClose();
      if (lastOutputWasDivider) {
        i++;
        continue;
      }
      html += "<br/>";
      i++;
      continue;
    }

    if (isSectionDividerLine(trimmed)) {
      flushListClose();
      let k = i + 1;
      while (k < lines.length) {
        const t2 = lines[k].trim();
        if (t2 === "") {
          k++;
          continue;
        }
        if (isSectionDividerLine(t2)) {
          k++;
          continue;
        }
        break;
      }
      if (!lastOutputWasDivider) {
        html += '<hr class="md-divider" />';
        lastOutputWasDivider = true;
      }
      i = k;
      continue;
    }

    lastOutputWasDivider = false;

    // Fenced code block: ``` or ```lang
    const fenceOpen = trimmed.match(/^```([\w-]*)\s*$/);
    if (fenceOpen) {
      flushListClose();
      const lang = fenceOpen[1] || "";
      const bodyLines = [];
      let fenceClosed = false;
      i++;
      while (i < lines.length) {
        if (/^```\s*$/.test(lines[i].trim())) {
          i++;
          fenceClosed = true;
          break;
        }
        bodyLines.push(lines[i]);
        i++;
      }
      const code = bodyLines.join("\n");
      const langClass = lang ? ` language-${lang}` : "";
      const copyBtnAttrs = fenceClosed
        ? `type="button" class="md-code-copy" title="Copy code" aria-label="Copy code"`
        : `type="button" class="md-code-copy" disabled title="Wait until the code block finishes" aria-label="Copy unavailable until the code block is complete"`;
      html += `<div class="md-code-wrap"><button ${copyBtnAttrs}><svg class="md-code-copy__icon md-code-copy__icon--copy" viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M16 1H4c-1.1 0-2 .9-2 2v14h2V3h12V1zm3 4H8c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h11c1.1 0 2-.9 2-2V7c0-1.1-.9-2-2-2zm0 16H8V7h11v14z"/></svg><svg class="md-code-copy__icon md-code-copy__icon--check" viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M9 16.17L4.83 12l-1.42 1.41L9 19l12-12-1.41-1.41z"/></svg></button><pre class="md-pre"><code class="md-codeblock${langClass}">${escapeHtml(code)}</code></pre></div>`;
      continue;
    }

    const tableBlock = tryParseTable(lines, i);
    if (tableBlock) {
      flushListClose();
      html += tableBlock.html;
      i = tableBlock.nextIndex;
      continue;
    }

    const hm = line.match(/^(#{1,6})\s+(.*)$/);
    if (hm) {
      flushListClose();
      const depth = hm[1].length;
      const tag = headingTagForDepth(depth);
      html += `<${tag} class="md-heading md-heading--h${depth}">${renderInlineMarkdown(escapeHtml(hm[2]))}</${tag}>`;
      i++;
      continue;
    }

    const bqMatch = line.match(/^\s*>\s?(.*)$/);
    if (bqMatch) {
      flushListClose();
      const parts = [];
      while (i < lines.length) {
        const m = lines[i].match(/^\s*>\s?(.*)$/);
        if (!m) break;
        parts.push(m[1]);
        i++;
      }
      const inner = parts.map((p) => renderInlineMarkdown(escapeHtml(p))).join("<br/>");
      html += `<blockquote class="md-blockquote">${inner}</blockquote>`;
      continue;
    }

    const listItem = matchListItemLine(line);
    if (listItem) {
      if (!inList) {
        html += '<ul class="md-ul">';
        inList = true;
      }
      const d = listItem.depth;
      const indentEm = (d - 1) * 1.25;
      html += `<li class="md-li" style="margin-left:${indentEm}em">${renderInlineMarkdown(escapeHtml(listItem.body))}</li>`;
      i++;
      continue;
    }

    flushListClose();
    html += `${renderInlineMarkdown(escapeHtml(line))}<br/>`;
    i++;
  }
  flushListClose();

  html = html.replace(/(<br\/>)+$/, "");
  return html;
}

/** Coalesces token bursts; always renders latest buffer with {@link renderBasicMarkdown}. */
let assistantMarkdownRafId = 0;

function scheduleAssistantMarkdownRender(bodyEl, getText) {
  if (!bodyEl || typeof getText !== "function") return;
  if (assistantMarkdownRafId) cancelAnimationFrame(assistantMarkdownRafId);
  assistantMarkdownRafId = requestAnimationFrame(() => {
    assistantMarkdownRafId = 0;
    bodyEl.innerHTML = renderBasicMarkdown(String(getText() || ""));
    maybeAutoScroll();
  });
}

function cancelAssistantMarkdownRender() {
  if (assistantMarkdownRafId) {
    cancelAnimationFrame(assistantMarkdownRafId);
    assistantMarkdownRafId = 0;
  }
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
  maybeAutoScroll();
  return { wrapper, body };
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function typeWordsInto(el, fullText) {
  // Word-by-word plain text, then markdown (unused by main UI; kept for experiments).
  const words = String(fullText || "").split(/\s+/).filter(Boolean);
  let acc = "";
  for (let i = 0; i < words.length; i++) {
    acc += (i === 0 ? "" : " ") + words[i];
    el.innerHTML = renderBasicMarkdown(acc);
    const w = words[i];
    const extra = /[.!?]$/.test(w) ? 70 : /[,;:]$/.test(w) ? 35 : 0;
    await sleep(18 + extra);
    maybeAutoScroll();
  }
}

function classifyFile(file) {
  const mt = (file?.type || "").toLowerCase();
  if (mt.startsWith("image/")) return "image";
  if (mt.startsWith("audio/")) return "audio";
  if (mt.startsWith("video/")) return "video";
  return "file";
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
  const max_new_tokens = 1024;
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

  // Guest in-browser memory (text-only). When logged in, DB history is used instead.
  const isAuthed = logoutBtnEl && logoutBtnEl.style.display !== "none";
  if (!isAuthed && !file) {
    guestAppend("user", String(text || ""));
  }

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
      const chat_id = getOrCreateChatId();
      const isAuthed2 = logoutBtnEl && logoutBtnEl.style.display !== "none";
      const messages = isAuthed2 ? undefined : guestMessages;

      const r = await fetch("/api/chat/stream", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chat_id, text, max_new_tokens, messages })
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
              if (pending?.body) scheduleAssistantMarkdownRender(pending.body, () => assistantText);
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

      cancelAssistantMarkdownRender();
      if (pending?.body) {
        pending.body.innerHTML = renderBasicMarkdown(String(finalPretty || ""));
      }
      if (metaRight) {
        metaRight.textContent = `${autoMode} • ${r.status}${metrics}`;
      }

      if (!isAuthed2) {
        guestAppend("assistant", String(finalPretty || ""));
      }
    } else {
      const form = new FormData();
      form.append("max_new_tokens", String(max_new_tokens));
      form.append("text", text || "Describe this.");
      form.append("chat_id", getOrCreateChatId());

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
              if (pending?.body) scheduleAssistantMarkdownRender(pending.body, () => assistantText);
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

      cancelAssistantMarkdownRender();
      if (pending?.body) pending.body.innerHTML = renderBasicMarkdown(String(finalPretty || ""));
      if (metaRight) {
        metaRight.textContent = `${autoMode} • ${r.status}${metrics}`;
      }
    }
  } catch (e) {
    cancelAssistantMarkdownRender();
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

if (logoutBtnEl) {
  logoutBtnEl.addEventListener("click", async () => {
    logoutBtnEl.disabled = true;
    try {
      await fetch("/api/auth/logout", { method: "POST" });
    } catch {
      // ignore
    } finally {
      clearChatId();
      showAuthGate(false);
      logoutBtnEl.disabled = false;
      // Back to guest mode
      resetGuestChat();
      clearMessagesUi();
      resetChatToLanding();
      setSessionsVisible(false);
      if (sessionsListEl) sessionsListEl.innerHTML = "";
      ensureLoggedIn();
    }
  });
}

if (newChatBtnEl) {
  newChatBtnEl.addEventListener("click", async () => {
    try {
      const created = await apiPostJson("/api/history/chats", {});
      const id = created?.chat?.id;
      if (!id) return;
      try {
        localStorage.setItem("gemma4-demo.chat_id", id);
      } catch {
        // ignore
      }
      clearMessagesUi();
      await refreshSessionsList(id);
      setActiveSessionUi(id);
    } catch {
      // ignore
    }
  });
}

if (loginBtnEl) {
  loginBtnEl.addEventListener("click", () => {
    setAuthHint("");
    setAuthMode("login");
    showAuthGate(true);
  });
}

if (signupBtnEl) {
  signupBtnEl.addEventListener("click", () => {
    setAuthHint("");
    setAuthMode("signup");
    showAuthGate(true);
  });
}

if (authFormEl) {
  authFormEl.addEventListener("submit", async (e) => {
    e.preventDefault();
    setAuthHint("");
    setAuthMode("login");
    const username = normalizeEmail(authUserEl?.value || "");
    const password = authPassEl?.value || "";
    authLoginBtnEl && (authLoginBtnEl.disabled = true);
    authRegisterBtnEl && (authRegisterBtnEl.disabled = true);
    try {
      await authJson("/api/auth/login", { username, password });
      showAuthGate(false);
      setAuthHint("");
      // Reset guest chat when user logs in
      resetGuestChat();
      clearMessagesUi();
      await ensureLoggedIn({ forceNewChat: true });
    } catch (err) {
      setAuthHint(String(err?.message || err));
    } finally {
      authLoginBtnEl && (authLoginBtnEl.disabled = false);
      authRegisterBtnEl && (authRegisterBtnEl.disabled = false);
    }
  });
}

if (authRegisterBtnEl) {
  authRegisterBtnEl.addEventListener("click", async () => {
    setAuthHint("");
    setAuthMode("signup");
    const username = normalizeEmail(authUserEl?.value || "");
    const password = authPassEl?.value || "";
    authLoginBtnEl && (authLoginBtnEl.disabled = true);
    authRegisterBtnEl && (authRegisterBtnEl.disabled = true);
    try {
      await authJson("/api/auth/register", { username, password });
      showAuthGate(false);
      setAuthHint("");
      // Reset guest chat when user signs up
      resetGuestChat();
      clearMessagesUi();
      await ensureLoggedIn({ forceNewChat: true });
    } catch (err) {
      setAuthHint(String(err?.message || err));
    } finally {
      authLoginBtnEl && (authLoginBtnEl.disabled = false);
      authRegisterBtnEl && (authRegisterBtnEl.disabled = false);
    }
  });
}

// Update header auth buttons on load (guest-first)
ensureLoggedIn();

// Default modal mode
setAuthMode("login");

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

