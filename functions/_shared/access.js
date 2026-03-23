const ACCESS_COOKIE_BASE = "flixer_access";
const ACCESS_SESSION_KIND = "fxs1";
const DEFAULT_ALLOWED_DISCORD_USER_ID = "1384867079357861918";
const DEFAULT_CODE_TTL_SECONDS = 60 * 60 * 24;
const DEFAULT_SESSION_TTL_SECONDS = 60 * 60 * 24 * 30;
const DEFAULT_DEV_SECRET = "local-dev-only-access-secret-change-me-now";
const CODE_ISSUER = "discord-gate";
const ACCESS_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const ACCESS_CODE_GROUP_COUNT = 4;
const ACCESS_CODE_GROUP_SIZE = 4;
const ACCESS_CODE_INSERT_ATTEMPTS = 6;
const LOCAL_ACCESS_CODE_STORE_KEY = "__FLIXER_LOCAL_ACCESS_CODES__";
const DISCORD_INVITE_URL = "https://discord.gg/v87gDSVK5x";

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();
const localAccessCodeStore = getLocalAccessCodeStore();

export function getDeniedDiscordMessage() {
  return "mc server is down";
}

export function getAllowedDiscordUserId(env) {
  return String(env?.DISCORD_ALLOWED_USER_ID || DEFAULT_ALLOWED_DISCORD_USER_ID).trim();
}

export function getCodeTtlSeconds(env) {
  return clampPositiveInteger(env?.ACCESS_CODE_TTL_SECONDS, DEFAULT_CODE_TTL_SECONDS);
}

export function getSessionTtlSeconds(env) {
  return clampPositiveInteger(env?.ACCESS_SESSION_TTL_SECONDS, DEFAULT_SESSION_TTL_SECONDS);
}

export function formatDurationLabel(totalSeconds) {
  const seconds = Math.max(0, Math.floor(Number(totalSeconds) || 0));

  if (seconds >= 60 * 60 && seconds % (60 * 60) === 0) {
    const hours = seconds / (60 * 60);
    return hours === 1 ? "1 hour" : `${hours} hours`;
  }

  const minutes = Math.max(1, Math.ceil(seconds / 60));
  return minutes === 1 ? "1 minute" : `${minutes} minutes`;
}

export function shouldBypassAccessGate(request) {
  const pathname = new URL(request.url).pathname;
  return (
    pathname.startsWith("/api/access/") ||
    pathname === "/api/discord/interactions" ||
    pathname === "/api/discord/interactions/"
  );
}

export function isHtmlNavigationRequest(request) {
  if (request.method !== "GET") {
    return false;
  }

  const accept = String(request.headers.get("accept") || "");
  const secFetchDest = String(request.headers.get("sec-fetch-dest") || "");

  return accept.includes("text/html") || secFetchDest === "document" || secFetchDest === "iframe";
}

export function jsonResponse(payload, status = 200, headers = {}) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      "cache-control": "no-store",
      "content-type": "application/json; charset=utf-8",
      ...headers,
    },
  });
}

export function textResponse(body, status = 200, headers = {}) {
  return new Response(body, {
    status,
    headers: {
      "cache-control": "no-store",
      "content-type": "text/plain; charset=utf-8",
      ...headers,
    },
  });
}

export function htmlResponse(body, status = 200, headers = {}) {
  return new Response(body, {
    status,
    headers: {
      "cache-control": "no-store",
      "content-type": "text/html; charset=utf-8",
      "content-security-policy":
        "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; connect-src 'self'; img-src 'self' data:; form-action 'self'; base-uri 'none'; frame-ancestors 'none';",
      "referrer-policy": "no-referrer",
      "x-content-type-options": "nosniff",
      "x-frame-options": "DENY",
      ...headers,
    },
  });
}

export function getDiscordPublicKey(env) {
  const publicKey = String(env?.DISCORD_PUBLIC_KEY || "").trim();

  if (!/^[a-fA-F0-9]{64}$/.test(publicKey)) {
    throw new Error("Missing or invalid DISCORD_PUBLIC_KEY");
  }

  return publicKey.toLowerCase();
}

export function getAccessSecret(env, requestOrUrl) {
  const configured = String(env?.ACCESS_GATE_SECRET || "").trim();

  if (configured.length >= 32) {
    return configured;
  }

  if (isLocalRequest(requestOrUrl)) {
    return DEFAULT_DEV_SECRET;
  }

  throw new Error("Missing ACCESS_GATE_SECRET");
}

export async function createAccessCode(env, request, generatorId) {
  const issuedAt = unixTimestamp();
  const expiresAt = issuedAt + getCodeTtlSeconds(env);

  for (let attempt = 0; attempt < ACCESS_CODE_INSERT_ATTEMPTS; attempt += 1) {
    const code = generateAccessCode();
    const normalizedCode = normalizeAccessCode(code);
    const codeHash = await hashAccessCodeForStorage(env, request, normalizedCode);
    const stored = await storeAccessCodeRecord(env, request, {
      codeHash,
      codeId: randomToken(18),
      expiresAt,
      generatorId: String(generatorId || ""),
      issuedAt,
    });

    if (stored) {
      return code;
    }
  }

  throw new Error("Failed to generate unique access code");
}

export async function redeemAccessCode(env, request, rawCode) {
  const normalizedCode = normalizeAccessCode(rawCode);

  if (!normalizedCode) {
    return null;
  }

  const consumedSource = await consumeAccessCodeRecord(env, request, normalizedCode);

  if (!consumedSource) {
    return null;
  }

  const sessionPayload = {
    exp: unixTimestamp() + getSessionTtlSeconds(env),
    iat: unixTimestamp(),
    iss: CODE_ISSUER,
    jti: randomToken(18),
    src: consumedSource,
    uah: await hashUserAgent(request.headers.get("user-agent")),
  };

  const sessionToken = await createSignedToken(env, request, ACCESS_SESSION_KIND, sessionPayload);

  return {
    expiresAt: sessionPayload.exp,
    sessionToken,
  };
}

export async function validateAccessSession(env, request) {
  getAccessSecret(env, request);

  const cookieHeader = request.headers.get("cookie");
  const cookies = parseCookies(cookieHeader);
  const cookieName = getPresentAccessCookieName(request, cookies);
  const cookieValue = cookieName ? cookies[cookieName] : "";

  if (!cookieValue) {
    return {
      authorized: false,
      shouldClear: false,
    };
  }

  const payload = await verifySignedToken(env, request, cookieValue, ACCESS_SESSION_KIND);

  if (!payload) {
    return {
      authorized: false,
      shouldClear: true,
    };
  }

  const expectedUserAgentHash = await hashUserAgent(request.headers.get("user-agent"));

  if (!payload.uah || payload.uah !== expectedUserAgentHash) {
    return {
      authorized: false,
      shouldClear: true,
    };
  }

  return {
    authorized: true,
    payload,
    shouldClear: false,
  };
}

export function appendClearAccessCookieHeaders(headers, request) {
  for (const cookieName of getAccessCookieNameCandidates(request)) {
    headers.append("set-cookie", buildCookieHeader(cookieName, "", 0, request));
  }
}

export function appendSessionCookieHeader(headers, request, token, maxAgeSeconds) {
  headers.append(
    "set-cookie",
    buildCookieHeader(getPrimaryAccessCookieName(request), token, maxAgeSeconds, request),
  );
}

export async function verifyDiscordInteraction(request, env, rawBody) {
  const signature = String(request.headers.get("x-signature-ed25519") || "").trim();
  const timestamp = String(request.headers.get("x-signature-timestamp") || "").trim();

  if (!/^[a-fA-F0-9]{128}$/.test(signature) || !timestamp) {
    return false;
  }

  const publicKey = getDiscordPublicKey(env);
  const publicKeyBytes = hexToBytes(publicKey);
  const signatureBytes = hexToBytes(signature);
  const timestampBytes = textEncoder.encode(timestamp);
  const bodyBytes = new Uint8Array(rawBody);
  const message = new Uint8Array(timestampBytes.length + bodyBytes.length);

  message.set(timestampBytes, 0);
  message.set(bodyBytes, timestampBytes.length);

  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    publicKeyBytes,
    { name: "Ed25519" },
    false,
    ["verify"],
  );

  return crypto.subtle.verify({ name: "Ed25519" }, cryptoKey, signatureBytes, message);
}

export function renderAccessGatePage(request, options = {}) {
  const title = options.title || "Access Required";
  const description =
    options.description || "Enter your access code to unlock the site.";
  const escapedTitle = escapeHtml(title);
  const escapedDescription = escapeHtml(description);
  const escapedPath = escapeHtml(new URL(request.url).pathname);

  return [
    "<!doctype html>",
    '<html lang="en">',
    "<head>",
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    `<title>${escapedTitle}</title>`,
    "<style>",
    ":root{color-scheme:dark;--bg:#050505;--panel:#111111;--muted:#9f9f9f;--border:rgba(255,255,255,.08);--accent:#e50914;--accent-2:#ff5058;--success:#18c964;}",
    "*{box-sizing:border-box}",
    "body{margin:0;min-height:100vh;font-family:ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:radial-gradient(circle at top,#2a070a 0%,#090909 40%,#030303 100%);color:#fff;display:flex;align-items:center;justify-content:center;padding:24px}",
    ".shell{width:min(100%,460px);background:rgba(10,10,10,.92);border:1px solid var(--border);border-radius:24px;box-shadow:0 40px 120px rgba(0,0,0,.45), inset 0 1px 0 rgba(255,255,255,.03);padding:32px 28px}",
    ".logo-wrap{display:flex;justify-content:center;margin-bottom:18px}",
    ".logo{width:min(180px,55vw);height:auto;display:block;filter:drop-shadow(0 12px 30px rgba(229,9,20,.18))}",
    ".brand{font-size:14px;letter-spacing:.34em;text-transform:uppercase;color:rgba(255,255,255,.74);margin-bottom:14px;text-align:center}",
    "h1{margin:0;font-size:34px;line-height:1.05;font-weight:800}",
    "p{margin:14px 0 0;color:var(--muted);font-size:15px;line-height:1.6}",
    "form{margin-top:28px}",
    "label{display:block;font-size:12px;letter-spacing:.16em;text-transform:uppercase;color:rgba(255,255,255,.58);margin-bottom:10px}",
    "input{width:100%;padding:15px 16px;border-radius:14px;border:1px solid var(--border);background:#080808;color:#fff;font-size:16px;outline:none;transition:border-color .2s ease,box-shadow .2s ease}",
    "input:focus{border-color:rgba(229,9,20,.8);box-shadow:0 0 0 4px rgba(229,9,20,.16)}",
    "button{width:100%;margin-top:14px;padding:15px 16px;border:0;border-radius:14px;background:linear-gradient(135deg,var(--accent),var(--accent-2));color:#fff;font-size:15px;font-weight:700;cursor:pointer;transition:transform .16s ease,filter .16s ease}",
    "button:hover{filter:brightness(1.05)}button:active{transform:translateY(1px)}button:disabled{opacity:.65;cursor:wait}",
    ".secondary-link{display:flex;align-items:center;justify-content:center;width:100%;margin-top:12px;padding:14px 16px;border:1px solid rgba(255,255,255,.1);border-radius:14px;background:rgba(255,255,255,.04);color:#fff;font-size:15px;font-weight:700;text-decoration:none;transition:background .2s ease,border-color .2s ease}",
    ".secondary-link:hover{background:rgba(255,255,255,.08);border-color:rgba(255,255,255,.16)}",
    ".status{min-height:24px;margin-top:16px;font-size:14px}",
    ".status.error{color:#ff9b9b}.status.success{color:var(--success)}",
    ".foot{margin-top:24px;font-size:12px;color:rgba(255,255,255,.34)}",
    "</style>",
    "</head>",
    "<body>",
    '<main class="shell">',
    '<div class="logo-wrap"><img class="logo" src="/assets/images/logo.png" alt="Flixer"></div>',
    '<div class="brand">FLIXER</div>',
    `<h1>${escapedTitle}</h1>`,
    `<p>${escapedDescription}</p>`,
    '<form id="access-form" novalidate>',
    '<label for="access-code">Access code</label>',
    '<input id="access-code" name="code" type="text" inputmode="text" autocomplete="one-time-code" autocapitalize="off" spellcheck="false" placeholder="Paste your code">',
    '<button id="submit-button" type="submit">Unlock Site</button>',
    `<a class="secondary-link" href="${DISCORD_INVITE_URL}" target="_blank" rel="noreferrer noopener">Join Our Discord</a>`,
    '<div id="status" class="status" role="status" aria-live="polite"></div>',
    "</form>",
    `<div class="foot">Requested path: ${escapedPath}</div>`,
    "<script>",
    "(function(){",
    "const form=document.getElementById('access-form');",
    "const input=document.getElementById('access-code');",
    "const button=document.getElementById('submit-button');",
    "const status=document.getElementById('status');",
    "function setStatus(message,type){status.textContent=message||'';status.className='status'+(type?' '+type:'');}",
    "form.addEventListener('submit',async function(event){",
    "event.preventDefault();",
    "const code=(input.value||'').trim();",
    "if(!code){setStatus('Enter a valid access code.','error');input.focus();return;}",
    "button.disabled=true;setStatus('Verifying code...');",
    "try{",
    "const response=await fetch('/api/access/redeem',{method:'POST',headers:{'content-type':'application/json','accept':'application/json'},body:JSON.stringify({code:code})});",
    "const payload=await response.json().catch(function(){return {};});",
    "if(!response.ok){throw new Error(payload.error||'The access code was rejected.');}",
    "setStatus('Access granted. Reloading...','success');",
    "window.location.reload();",
    "}catch(error){",
    "setStatus(error && error.message ? error.message : 'The access code was rejected.','error');",
    "}finally{button.disabled=false;}",
    "});",
    "input.focus();",
    "})();",
    "</script>",
    "</body>",
    "</html>",
  ].join("");
}

function clampPositiveInteger(value, fallback) {
  const parsed = Number.parseInt(String(value || ""), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function normalizeAccessCode(value) {
  return String(value || "")
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");
}

function unixTimestamp() {
  return Math.floor(Date.now() / 1000);
}

function isLocalRequest(requestOrUrl) {
  const url =
    requestOrUrl instanceof URL
      ? requestOrUrl
      : requestOrUrl && typeof requestOrUrl.url === "string"
        ? new URL(requestOrUrl.url)
        : new URL(String(requestOrUrl || "http://localhost"));

  const hostname = url.hostname || "";

  if (hostname === "localhost" || hostname === "127.0.0.1") {
    return true;
  }

  if (!/^\d{1,3}(?:\.\d{1,3}){3}$/.test(hostname)) {
    return false;
  }

  return (
    hostname.startsWith("10.") ||
    hostname.startsWith("192.168.") ||
    /^172\.(1[6-9]|2\d|3[0-1])\./.test(hostname)
  );
}

function getPrimaryAccessCookieName(requestOrUrl) {
  const url =
    requestOrUrl instanceof URL
      ? requestOrUrl
      : requestOrUrl && typeof requestOrUrl.url === "string"
        ? new URL(requestOrUrl.url)
        : new URL(String(requestOrUrl || "http://localhost"));

  return url.protocol === "https:" ? `__Host-${ACCESS_COOKIE_BASE}` : ACCESS_COOKIE_BASE;
}

function getAccessCookieNameCandidates(requestOrUrl) {
  return Array.from(
    new Set([`__Host-${ACCESS_COOKIE_BASE}`, ACCESS_COOKIE_BASE, getPrimaryAccessCookieName(requestOrUrl)]),
  );
}

function getPresentAccessCookieName(requestOrUrl, cookies) {
  return getAccessCookieNameCandidates(requestOrUrl).find((cookieName) => !!cookies[cookieName]) || "";
}

function parseCookies(cookieHeader) {
  const cookies = {};

  for (const part of String(cookieHeader || "").split(";")) {
    const trimmed = part.trim();

    if (!trimmed) {
      continue;
    }

    const separatorIndex = trimmed.indexOf("=");
    const name = separatorIndex === -1 ? trimmed : trimmed.slice(0, separatorIndex);
    const rawValue = separatorIndex === -1 ? "" : trimmed.slice(separatorIndex + 1);

    try {
      cookies[name] = decodeURIComponent(rawValue);
    } catch (_error) {
      cookies[name] = rawValue;
    }
  }

  return cookies;
}

function buildCookieHeader(cookieName, value, maxAgeSeconds, requestOrUrl) {
  const url =
    requestOrUrl instanceof URL
      ? requestOrUrl
      : requestOrUrl && typeof requestOrUrl.url === "string"
        ? new URL(requestOrUrl.url)
        : new URL(String(requestOrUrl || "http://localhost"));
  const segments = [
    `${cookieName}=${encodeURIComponent(value)}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Strict",
    `Max-Age=${Math.max(0, Math.floor(maxAgeSeconds || 0))}`,
    "Priority=High",
  ];

  if (url.protocol === "https:") {
    segments.push("Secure");
  }

  return segments.join("; ");
}

async function createSignedToken(env, requestOrUrl, kind, payload) {
  const serializedPayload = base64UrlEncode(textEncoder.encode(JSON.stringify(payload)));
  const signature = await signValue(getAccessSecret(env, requestOrUrl), `${kind}.${serializedPayload}`);
  return `${kind}.${serializedPayload}.${signature}`;
}

async function verifySignedToken(env, requestOrUrl, token, expectedKind) {
  const parts = String(token || "").split(".");

  if (parts.length !== 3) {
    return null;
  }

  const [kind, serializedPayload, providedSignature] = parts;

  if (kind !== expectedKind || !serializedPayload || !providedSignature) {
    return null;
  }

  const expectedSignature = await signValue(
    getAccessSecret(env, requestOrUrl),
    `${kind}.${serializedPayload}`,
  );

  if (!timingSafeEqual(providedSignature, expectedSignature)) {
    return null;
  }

  try {
    const payload = JSON.parse(textDecoder.decode(base64UrlDecode(serializedPayload)));
    if (!payload || typeof payload !== "object") {
      return null;
    }

    if (!Number.isFinite(payload.exp) || payload.exp <= unixTimestamp()) {
      return null;
    }

    return payload;
  } catch (_error) {
    return null;
  }
}

async function signValue(secret, value) {
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    textEncoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", cryptoKey, textEncoder.encode(value));
  return base64UrlEncode(new Uint8Array(signature));
}

async function hashUserAgent(userAgent) {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    textEncoder.encode(String(userAgent || "")),
  );
  return base64UrlEncode(new Uint8Array(digest)).slice(0, 24);
}

async function hashAccessCodeForStorage(env, requestOrUrl, normalizedCode) {
  return signValue(getAccessSecret(env, requestOrUrl), `access-code:${normalizedCode}`);
}

function randomToken(byteLength) {
  const bytes = new Uint8Array(byteLength);
  crypto.getRandomValues(bytes);
  return base64UrlEncode(bytes);
}

function generateAccessCode() {
  const totalLength = ACCESS_CODE_GROUP_COUNT * ACCESS_CODE_GROUP_SIZE;
  const bytes = new Uint8Array(totalLength);
  crypto.getRandomValues(bytes);
  const characters = Array.from(bytes, (byte) => ACCESS_CODE_ALPHABET[byte % ACCESS_CODE_ALPHABET.length]);
  const groups = [];

  for (let index = 0; index < ACCESS_CODE_GROUP_COUNT; index += 1) {
    const start = index * ACCESS_CODE_GROUP_SIZE;
    groups.push(characters.slice(start, start + ACCESS_CODE_GROUP_SIZE).join(""));
  }

  return groups.join("-");
}

async function storeAccessCodeRecord(env, requestOrUrl, record) {
  const database = getAccessCodeDatabase(env, requestOrUrl);

  if (!database) {
    cleanupLocalAccessCodeStore();

    if (localAccessCodeStore.has(record.codeHash)) {
      return false;
    }

    localAccessCodeStore.set(record.codeHash, {
      codeId: record.codeId,
      expiresAt: record.expiresAt,
      generatorId: record.generatorId,
      issuedAt: record.issuedAt,
    });
    return true;
  }

  try {
    await database
      .prepare(
        "INSERT INTO access_codes (code_id, code_hash, generator_id, issued_at, expires_at, consumed_at, consumed_by_hash) VALUES (?1, ?2, ?3, ?4, ?5, NULL, NULL)",
      )
      .bind(record.codeId, record.codeHash, record.generatorId, record.issuedAt, record.expiresAt)
      .run();
    return true;
  } catch (error) {
    if (isUniqueConstraintError(error)) {
      return false;
    }
    throw error;
  }
}

async function consumeAccessCodeRecord(env, request, normalizedCode) {
  const codeHash = await hashAccessCodeForStorage(env, request, normalizedCode);
  const database = getAccessCodeDatabase(env, request);

  if (!database) {
    cleanupLocalAccessCodeStore();
    const record = localAccessCodeStore.get(codeHash);

    if (!record || record.expiresAt <= unixTimestamp()) {
      localAccessCodeStore.delete(codeHash);
      return null;
    }

    localAccessCodeStore.delete(codeHash);
    return record.codeId || codeHash;
  }

  const consumedAt = unixTimestamp();
  const consumedByHash = await hashUserAgent(request.headers.get("user-agent"));
  const result = await database
    .prepare(
      "UPDATE access_codes SET consumed_at = ?1, consumed_by_hash = ?2 WHERE code_hash = ?3 AND consumed_at IS NULL AND expires_at > ?1",
    )
    .bind(consumedAt, consumedByHash, codeHash)
    .run();

  return getMutationChanges(result) > 0 ? codeHash : null;
}

function getAccessCodeDatabase(env, requestOrUrl) {
  const database = env?.ACCESS_CODES_DB;

  if (database && typeof database.prepare === "function") {
    return database;
  }

  if (isLocalRequest(requestOrUrl)) {
    return null;
  }

  throw new Error("Missing ACCESS_CODES_DB");
}

function cleanupLocalAccessCodeStore() {
  const now = unixTimestamp();

  for (const [codeHash, record] of localAccessCodeStore.entries()) {
    if (!record || !Number.isFinite(record.expiresAt) || record.expiresAt <= now) {
      localAccessCodeStore.delete(codeHash);
    }
  }
}

function getLocalAccessCodeStore() {
  const existingStore = globalThis[LOCAL_ACCESS_CODE_STORE_KEY];

  if (existingStore instanceof Map) {
    return existingStore;
  }

  const store = new Map();
  globalThis[LOCAL_ACCESS_CODE_STORE_KEY] = store;
  return store;
}

function getMutationChanges(result) {
  if (Number.isFinite(result?.meta?.changes)) {
    return result.meta.changes;
  }

  if (Number.isFinite(result?.changes)) {
    return result.changes;
  }

  return 0;
}

function isUniqueConstraintError(error) {
  const message = error instanceof Error ? error.message : String(error || "");
  return /unique|constraint|duplicate/i.test(message);
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function timingSafeEqual(left, right) {
  if (left.length !== right.length) {
    return false;
  }

  let mismatch = 0;

  for (let index = 0; index < left.length; index += 1) {
    mismatch |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }

  return mismatch === 0;
}

function hexToBytes(value) {
  const normalized = String(value || "").trim();
  const bytes = new Uint8Array(normalized.length / 2);

  for (let index = 0; index < normalized.length; index += 2) {
    bytes[index / 2] = Number.parseInt(normalized.slice(index, index + 2), 16);
  }

  return bytes;
}

function base64UrlEncode(bytes) {
  let binary = "";

  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }

  const base64 =
    typeof btoa === "function"
      ? btoa(binary)
      : Buffer.from(bytes).toString("base64");

  return base64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function base64UrlDecode(value) {
  const normalized = String(value || "").replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized + "=".repeat((4 - (normalized.length % 4 || 4)) % 4);
  const binary =
    typeof atob === "function"
      ? atob(padded)
      : Buffer.from(padded, "base64").toString("binary");
  const bytes = new Uint8Array(binary.length);

  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }

  return bytes;
}
