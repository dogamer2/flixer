import express from "express";
import crypto from "crypto";

const app = express();
const targetHost = "plsdontscrapemelove.flixer.su";
const mainSiteHost = "flixer.su";
const HOST = "0.0.0.0";
const PORT = Number.parseInt(process.env.PORT || "3001", 10);
const DEFAULT_MINIMAL_USER_AGENT = "Mozilla/5.0";
const VIDSRC_MEDIA_REFERER = "https://vidsrc.cc/";
const VIDSRC_MEDIA_ORIGIN = "https://vidsrc.cc";
const ACCESS_COOKIE_BASE = "flixer_access";
const ACCESS_SESSION_KIND = "fxs1";
const DEFAULT_CODE_TTL_SECONDS = 60 * 60 * 24;
const DEFAULT_SESSION_TTL_SECONDS = 60 * 60 * 24 * 30;
const DEFAULT_DEV_SECRET = "local-dev-only-access-secret-change-me-now";
const CODE_ISSUER = "discord-gate";
const ACCESS_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const ACCESS_CODE_GROUP_COUNT = 4;
const ACCESS_CODE_GROUP_SIZE = 4;
const ACCESS_CODE_INSERT_ATTEMPTS = 6;
const localAccessCodeStore = new Map();
const DISCORD_API_BASE = "https://discord.com/api/v10";
const DISCORD_GATEWAY_URL = "wss://gateway.discord.gg/?v=10&encoding=json";
const DEFAULT_STATUS_URL = "https://flixercc.pages.dev/api/status";
const DEFAULT_STATUS_CHANNEL_ID = "1485492554374975538";
const STATUS_MESSAGE_ID = "1485547180570837003";
const REACTION_ROLE_CHANNEL_ID = "1485575611081687090";
const STATUS_ROLE_ID = "1485575817718403072";
const ANNOUNCEMENT_ROLE_ID = "1485576547829022840";
const ROLE_MENU_REACTIONS = ["1️⃣", "2️⃣"];
const STATUS_SYNC_INTERVAL_MS = 60 * 1000;
const ROLE_MENU_MARKER = "[role-menu-v2]";
const DISCORD_ALLOWED_USER_ID = "1384867079357861918";
const GATEWAY_INTENTS = 1 | 1024;
const discordRuntimeState = {
  gatewayStarted: false,
  heartbeatHandle: null,
  heartbeatIntervalMs: 0,
  lastSequence: null,
  roleMenuMessageId: "",
  sessionId: "",
  statusInFlight: null,
  lastKnownStatus: null,
  statusIntervalHandle: null,
  ws: null,
};

app.set("trust proxy", true);
app.use(express.raw({ type: "*/*", limit: "25mb" }));

app.use((req, res, next) => {
  applyCorsHeaders(req, res);
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader(
    "Access-Control-Allow-Headers",
    req.headers["access-control-request-headers"] || "Content-Type, X-Forwarded-Cookie, X-Forwarded-User-Agent"
  );
  if (req.method === "OPTIONS") return res.sendStatus(204);
  next();
});

function applyCorsHeaders(req, res) {
  const origin = typeof req.headers.origin === "string" ? req.headers.origin : "";

  if (origin && isAllowedDevOrigin(origin)) {
    res.setHeader("Access-Control-Allow-Credentials", "true");
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Vary", "Origin, Access-Control-Request-Headers");
    return;
  }

  res.setHeader("Access-Control-Allow-Origin", "*");
}

function isAllowedDevOrigin(origin) {
  try {
    const parsed = new URL(origin);
    return (
      parsed.protocol === "http:" ||
      parsed.protocol === "https:"
    ) && isLocalHostname(parsed.hostname);
  } catch {
    return false;
  }
}

function isLocalHostname(hostname) {
  if (!hostname) {
    return false;
  }

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

function forwardResponseHeaders(res, headers) {
  Object.keys(headers || {}).forEach((key) => {
    if (
      !key.startsWith(":") &&
      !["content-encoding", "transfer-encoding", "access-control-allow-origin"].includes(key.toLowerCase())
    ) {
      try {
        res.setHeader(key, headers[key]);
      } catch {}
    }
  });
}

function buildMediaRequestHeaders(req, includeSiteHeaders = true) {
  const headers = {
    accept: "*/*",
    "accept-language": "en-US,en;q=0.9",
    "accept-encoding": "identity",
    "user-agent": req.headers["x-forwarded-user-agent"] || req.headers["user-agent"] || "Mozilla/5.0",
    "sec-fetch-mode": "cors",
    "sec-fetch-dest": "empty"
  };

  if (req.headers.range) {
    headers.range = req.headers.range;
  }

  if (includeSiteHeaders) {
    headers.referer = "https://flixer.su/";
    headers.origin = "https://flixer.su";
    headers["sec-fetch-site"] = "cross-site";
  }

  return headers;
}

function buildVidsrcMediaRequestHeaders(req) {
  const headers = {
    accept: "*/*",
    "user-agent": DEFAULT_MINIMAL_USER_AGENT,
    referer: VIDSRC_MEDIA_REFERER,
    origin: VIDSRC_MEDIA_ORIGIN
  };

  if (req.headers.range) {
    headers.range = req.headers.range;
  }

  return headers;
}

function getDiscordBotToken() {
  return String(process.env.DISCORD_BOT_TOKEN || process.env.DISCORD_TOKEN || "").trim();
}

function getStatusChannelId() {
  return String(process.env.DISCORD_STATUS_CHANNEL_ID || DEFAULT_STATUS_CHANNEL_ID).trim();
}

function getStatusSiteLabel() {
  return String(process.env.DISCORD_STATUS_SITE_LABEL || "Flixer").trim() || "Flixer";
}

function getStatusUrl() {
  return String(process.env.DISCORD_STATUS_URL || DEFAULT_STATUS_URL).trim() || DEFAULT_STATUS_URL;
}

async function discordApiRequest(path, init = {}) {
  const token = getDiscordBotToken();

  if (!token) {
    throw new Error("Missing DISCORD_BOT_TOKEN");
  }

  const response = await fetch(`${DISCORD_API_BASE}${path}`, {
    ...init,
    headers: {
      authorization: `Bot ${token}`,
      "content-type": "application/json",
      ...(init.headers || {}),
    },
  });

  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(`Discord API request failed (${response.status}): ${errorBody}`);
  }

  if (response.status === 204) {
    return null;
  }

  return response.json();
}

function buildRoleMenuMessage() {
  return [
    ROLE_MENU_MARKER,
    "**Stay in the loop**",
    "React below to choose which updates you want from Flixer.",
    "",
    `1️⃣ <@&${STATUS_ROLE_ID}> for online and offline status alerts`,
    `2️⃣ <@&${ANNOUNCEMENT_ROLE_ID}> for feature launches, fixes, and announcements`,
    "",
    "Remove your reaction any time to opt out.",
  ].join("\n");
}

function buildStatusMessage(siteLabel, isActive) {
  const stateLabel = isActive ? "Online" : "Offline";
  const icon = isActive ? "🟢" : "🔴";
  const checkedAt = Math.floor(Date.now() / 1000);

  return [
    `**${siteLabel} Status**`,
    `${icon} **${stateLabel}**`,
    `Last checked: <t:${checkedAt}:R>`,
  ].join("\n");
}

async function findRoleMenuMessage() {
  const channelId = REACTION_ROLE_CHANNEL_ID;
  const messages = await discordApiRequest(`/channels/${channelId}/messages?limit=50`, {
    method: "GET",
  });

  const existing = Array.isArray(messages)
    ? messages.find(
        (message) =>
          message &&
          message.author &&
          message.author.bot &&
          typeof message.content === "string" &&
          message.content.includes(ROLE_MENU_MARKER),
      )
    : null;

  discordRuntimeState.roleMenuMessageId = String(existing?.id || "");
  return existing || null;
}

async function ensureRoleMenuMessage() {
  const channelId = REACTION_ROLE_CHANNEL_ID;
  const existing = await findRoleMenuMessage();

  const content = buildRoleMenuMessage();
  const message = existing
    ? await discordApiRequest(`/channels/${channelId}/messages/${existing.id}`, {
        body: JSON.stringify({ content }),
        method: "PATCH",
      })
    : await discordApiRequest(`/channels/${channelId}/messages`, {
        body: JSON.stringify({ content }),
        method: "POST",
      });

  discordRuntimeState.roleMenuMessageId = String(message?.id || "");

  for (const emoji of ROLE_MENU_REACTIONS) {
    await fetch(
      `${DISCORD_API_BASE}/channels/${channelId}/messages/${discordRuntimeState.roleMenuMessageId}/reactions/${encodeURIComponent(emoji)}/@me`,
      {
        headers: {
          authorization: `Bot ${getDiscordBotToken()}`,
        },
        method: "PUT",
      },
    );
  }
}

async function probeSiteStatusUrl() {
  const timeout = AbortSignal.timeout(10_000);

  try {
    const response = await fetch(getStatusUrl(), {
      headers: {
        accept: "application/json",
        "cache-control": "no-cache",
      },
      method: "GET",
      signal: timeout,
    });
    const payload = await response.json().catch(() => ({}));
    return response.ok && payload && payload.status === "active";
  } catch {
    return false;
  }
}

async function syncDiscordStatusMessage() {
  if (discordRuntimeState.statusInFlight) {
    return discordRuntimeState.statusInFlight;
  }

  discordRuntimeState.statusInFlight = (async () => {
    const isActive = await probeSiteStatusUrl();
    const previousStatus = discordRuntimeState.lastKnownStatus;
    const changed = typeof previousStatus === "boolean" && previousStatus !== isActive;
    const content = [
      changed ? `<@&${STATUS_ROLE_ID}>` : null,
      buildStatusMessage(getStatusSiteLabel(), isActive),
    ]
      .filter(Boolean)
      .join("\n");

    await discordApiRequest(`/channels/${getStatusChannelId()}/messages/${STATUS_MESSAGE_ID}`, {
      body: JSON.stringify({
        allowed_mentions: changed ? { parse: [], roles: [STATUS_ROLE_ID] } : { parse: [] },
        content,
      }),
      method: "PATCH",
    });

    discordRuntimeState.lastKnownStatus = isActive;
  })()
    .catch((error) => {
      console.error(error instanceof Error ? error.message : error);
    })
    .finally(() => {
      discordRuntimeState.statusInFlight = null;
    });

  return discordRuntimeState.statusInFlight;
}

async function setMemberRole(guildId, userId, roleId, shouldAdd) {
  const response = await fetch(
    `${DISCORD_API_BASE}/guilds/${guildId}/members/${userId}/roles/${roleId}`,
    {
      headers: {
        authorization: `Bot ${getDiscordBotToken()}`,
      },
      method: shouldAdd ? "PUT" : "DELETE",
    },
  );

  if (!response.ok) {
    const errorBody = await response.text().catch(() => "");
    throw new Error(
      `Failed to ${shouldAdd ? "add" : "remove"} role ${roleId} for user ${userId} (${response.status}): ${errorBody}`,
    );
  }
}

function getRoleIdForEmoji(emojiName) {
  if (emojiName === "1️⃣") {
    return STATUS_ROLE_ID;
  }

  if (emojiName === "2️⃣") {
    return ANNOUNCEMENT_ROLE_ID;
  }

  return "";
}

async function handleReactionRoleEvent(eventType, payload) {
  const messageId = String(payload?.message_id || "");
  const guildId = String(payload?.guild_id || "");
  const userId = String(payload?.user_id || payload?.member?.user?.id || "");
  const emojiName = String(payload?.emoji?.name || "");
  const roleId = getRoleIdForEmoji(emojiName);

  if (!guildId || !userId || !roleId) {
    return;
  }

  if (!discordRuntimeState.roleMenuMessageId) {
    await findRoleMenuMessage().catch(() => null);
  }

  if (!discordRuntimeState.roleMenuMessageId) {
    return;
  }

  if (messageId !== discordRuntimeState.roleMenuMessageId) {
    return;
  }

  const shouldAdd = eventType === "MESSAGE_REACTION_ADD";
  try {
    await setMemberRole(guildId, userId, roleId, shouldAdd);
    console.log(
      `[discord-role-sync] ${shouldAdd ? "added" : "removed"} role ${roleId} for user ${userId} from ${emojiName}`,
    );
  } catch (error) {
    console.error(
      `[discord-role-sync] ${error instanceof Error ? error.message : "Unknown role sync failure"}`,
    );
  }
}

function sendGatewayHeartbeat() {
  if (discordRuntimeState.ws && discordRuntimeState.ws.readyState === WebSocket.OPEN) {
    discordRuntimeState.ws.send(
      JSON.stringify({
        d: discordRuntimeState.lastSequence,
        op: 1,
      }),
    );
  }
}

function clearGatewayHeartbeat() {
  if (discordRuntimeState.heartbeatHandle) {
    clearInterval(discordRuntimeState.heartbeatHandle);
    discordRuntimeState.heartbeatHandle = null;
  }
}

function connectDiscordGateway() {
  const token = getDiscordBotToken();

  if (!token) {
    return;
  }

  const ws = new WebSocket(DISCORD_GATEWAY_URL);
  discordRuntimeState.ws = ws;

  ws.addEventListener("open", () => {
    console.log("🤖 Discord gateway connected");
  });

  ws.addEventListener("message", async (event) => {
    let payload;

    try {
      payload = JSON.parse(String(event.data || ""));
    } catch {
      return;
    }

    if (typeof payload?.s === "number") {
      discordRuntimeState.lastSequence = payload.s;
    }

    if (payload?.op === 10) {
      discordRuntimeState.heartbeatIntervalMs = Number(payload.d?.heartbeat_interval || 45_000);
      clearGatewayHeartbeat();
      discordRuntimeState.heartbeatHandle = setInterval(
        sendGatewayHeartbeat,
        discordRuntimeState.heartbeatIntervalMs,
      );
      sendGatewayHeartbeat();
      ws.send(
        JSON.stringify({
          d: {
            intents: GATEWAY_INTENTS,
            properties: {
              browser: "flixer-bot",
              device: "flixer-bot",
              os: process.platform,
            },
            token,
          },
          op: 2,
        }),
      );
      return;
    }

    if (payload?.op === 7) {
      ws.close();
      return;
    }

    if (payload?.t === "READY") {
      discordRuntimeState.sessionId = String(payload.d?.session_id || "");
      await findRoleMenuMessage().catch(() => null);
      await syncDiscordStatusMessage();
      return;
    }

    if (payload?.t === "MESSAGE_REACTION_ADD" || payload?.t === "MESSAGE_REACTION_REMOVE") {
      await handleReactionRoleEvent(payload.t, payload.d);
    }
  });

  const reconnect = () => {
    clearGatewayHeartbeat();
    setTimeout(connectDiscordGateway, 5_000);
  };

  ws.addEventListener("close", reconnect);
  ws.addEventListener("error", reconnect);
}

function startDiscordAutomation() {
  if (discordRuntimeState.gatewayStarted || !getDiscordBotToken()) {
    return;
  }

  discordRuntimeState.gatewayStarted = true;
  connectDiscordGateway();
  syncDiscordStatusMessage();
  discordRuntimeState.statusIntervalHandle = setInterval(syncDiscordStatusMessage, STATUS_SYNC_INTERVAL_MS);
}

async function fetchMediaAttempt(upstreamUrl, headers) {
  const response = await fetch(upstreamUrl, {
    method: "GET",
    headers,
    redirect: "follow"
  });

  const body = Buffer.from(await response.arrayBuffer());

  return {
    statusCode: response.status,
    headers: Object.fromEntries(response.headers.entries()),
    body
  };
}

async function fetchMedia(upstreamUrl, req) {
  const isWorkersDev = upstreamUrl.hostname.endsWith(".workers.dev");
  const attempts = isWorkersDev ? ["vidsrc", true, false] : [true];
  let lastResponse = null;
  let lastError = null;

  for (const includeSiteHeaders of attempts) {
    try {
      const headers =
        includeSiteHeaders === "vidsrc"
          ? buildVidsrcMediaRequestHeaders(req)
          : buildMediaRequestHeaders(req, includeSiteHeaders);
      const response = await fetchMediaAttempt(upstreamUrl, headers);
      if (response.statusCode < 400) {
        return response;
      }
      lastResponse = response;
    } catch (error) {
      lastError = error;
    }
  }

  if (lastResponse) {
    return lastResponse;
  }

  if (lastError) {
    throw lastError;
  }

  throw new Error("Unable to fetch media");
}

async function fetchSubtitle(url) {
  const upstreamUrl = new URL("https://flixer.su/api/subtitle");
  upstreamUrl.searchParams.set("url", url);

  const response = await fetch(upstreamUrl, {
    method: "GET",
    headers: {
      referer: "https://flixer.su/",
      origin: "https://flixer.su",
      accept: "text/vtt,text/plain,application/x-subrip,application/octet-stream;q=0.9,*/*;q=0.8"
    },
    redirect: "follow"
  });

  return {
    statusCode: response.status,
    headers: Object.fromEntries(response.headers.entries()),
    body: await response.text()
  };
}

function normalizeSubtitleBody(body) {
  const text = String(body || "").replace(/^\uFEFF/, "").replace(/\r+/g, "").trimStart();
  if (/^WEBVTT/i.test(text)) {
    return text;
  }
  return `WEBVTT\n\n${text}`;
}

function signTmdbRequest(key, timestamp, nonce, path) {
  return crypto.createHmac("sha256", Buffer.from(String(key), "utf8")).update(`${key}:${timestamp}:${nonce}:${path}`).digest("base64");
}

function getAccessSecret(req) {
  const configured = String(process.env.ACCESS_GATE_SECRET || "").trim();

  if (configured.length >= 32) {
    return configured;
  }

  if (isLocalHostname(req.hostname || "")) {
    return DEFAULT_DEV_SECRET;
  }

  throw new Error("Missing ACCESS_GATE_SECRET");
}

function getSessionTtlSeconds() {
  return clampPositiveInteger(process.env.ACCESS_SESSION_TTL_SECONDS, DEFAULT_SESSION_TTL_SECONDS);
}

function getCodeTtlSeconds() {
  return clampPositiveInteger(process.env.ACCESS_CODE_TTL_SECONDS, DEFAULT_CODE_TTL_SECONDS);
}

function clampPositiveInteger(value, fallback) {
  const parsed = Number.parseInt(String(value || ""), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function unixTimestamp() {
  return Math.floor(Date.now() / 1000);
}

function base64UrlEncode(value) {
  return Buffer.from(value)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function base64UrlDecode(value) {
  const normalized = String(value || "").replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized + "=".repeat((4 - (normalized.length % 4 || 4)) % 4);
  return Buffer.from(padded, "base64");
}

function randomToken(byteLength) {
  return base64UrlEncode(crypto.randomBytes(byteLength));
}

function generateAccessCode() {
  const totalLength = ACCESS_CODE_GROUP_COUNT * ACCESS_CODE_GROUP_SIZE;
  const bytes = crypto.randomBytes(totalLength);
  const characters = Array.from(bytes, (byte) => ACCESS_CODE_ALPHABET[byte % ACCESS_CODE_ALPHABET.length]);
  const groups = [];

  for (let index = 0; index < ACCESS_CODE_GROUP_COUNT; index += 1) {
    const start = index * ACCESS_CODE_GROUP_SIZE;
    groups.push(characters.slice(start, start + ACCESS_CODE_GROUP_SIZE).join(""));
  }

  return groups.join("-");
}

function signAccessValue(secret, value) {
  return base64UrlEncode(crypto.createHmac("sha256", secret).update(String(value), "utf8").digest());
}

function timingSafeMatch(left, right) {
  const leftBuffer = Buffer.from(String(left || ""), "utf8");
  const rightBuffer = Buffer.from(String(right || ""), "utf8");

  if (leftBuffer.length !== rightBuffer.length) {
    return false;
  }

  return crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

function hashUserAgent(userAgent) {
  return base64UrlEncode(
    crypto.createHash("sha256").update(String(userAgent || ""), "utf8").digest()
  ).slice(0, 24);
}

function normalizeAccessCode(value) {
  return String(value || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
}

function hashAccessCodeForStorage(req, normalizedCode) {
  return signAccessValue(getAccessSecret(req), `access-code:${normalizedCode}`);
}

function cleanupLocalAccessCodeStore() {
  const now = unixTimestamp();

  for (const [codeHash, record] of localAccessCodeStore.entries()) {
    if (!record || !Number.isFinite(record.expiresAt) || record.expiresAt <= now) {
      localAccessCodeStore.delete(codeHash);
    }
  }
}

function createLocalAccessCode(req) {
  cleanupLocalAccessCodeStore();
  const expiresAt = unixTimestamp() + getCodeTtlSeconds();

  for (let attempt = 0; attempt < ACCESS_CODE_INSERT_ATTEMPTS; attempt += 1) {
    const code = generateAccessCode();
    const normalizedCode = normalizeAccessCode(code);
    const codeHash = hashAccessCodeForStorage(req, normalizedCode);

    if (localAccessCodeStore.has(codeHash)) {
      continue;
    }

    localAccessCodeStore.set(codeHash, {
      codeId: randomToken(18),
      expiresAt
    });

    return {
      code,
      expiresAt
    };
  }

  throw new Error("Failed to generate unique access code");
}

function getPrimaryAccessCookieName(req) {
  return isSecureRequest(req) ? `__Host-${ACCESS_COOKIE_BASE}` : ACCESS_COOKIE_BASE;
}

function getAccessCookieNameCandidates(req) {
  return Array.from(
    new Set([`__Host-${ACCESS_COOKIE_BASE}`, ACCESS_COOKIE_BASE, getPrimaryAccessCookieName(req)])
  );
}

function isSecureRequest(req) {
  return req.protocol === "https" || req.headers["x-forwarded-proto"] === "https";
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
    } catch {
      cookies[name] = rawValue;
    }
  }

  return cookies;
}

function getRequestCookies(req) {
  return {
    ...parseCookies(req.headers["x-forwarded-cookie"]),
    ...parseCookies(req.headers.cookie)
  };
}

function buildAccessCookieHeader(req, cookieName, value, maxAgeSeconds) {
  const segments = [
    `${cookieName}=${encodeURIComponent(String(value || ""))}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Strict",
    `Max-Age=${Math.max(0, Math.floor(maxAgeSeconds || 0))}`,
    "Priority=High"
  ];

  if (isSecureRequest(req)) {
    segments.push("Secure");
  }

  return segments.join("; ");
}

function appendClearAccessCookies(res, req) {
  for (const cookieName of getAccessCookieNameCandidates(req)) {
    res.append("Set-Cookie", buildAccessCookieHeader(req, cookieName, "", 0));
  }
}

function appendAccessSessionCookie(res, req, token, maxAgeSeconds) {
  res.append(
    "Set-Cookie",
    buildAccessCookieHeader(req, getPrimaryAccessCookieName(req), token, maxAgeSeconds)
  );
}

function createSignedAccessToken(secret, kind, payload) {
  const serializedPayload = base64UrlEncode(Buffer.from(JSON.stringify(payload), "utf8"));
  const signature = signAccessValue(secret, `${kind}.${serializedPayload}`);
  return `${kind}.${serializedPayload}.${signature}`;
}

function verifySignedAccessToken(secret, token, expectedKind) {
  const parts = String(token || "").split(".");

  if (parts.length !== 3) {
    return null;
  }

  const [kind, serializedPayload, providedSignature] = parts;

  if (kind !== expectedKind || !serializedPayload || !providedSignature) {
    return null;
  }

  const expectedSignature = signAccessValue(secret, `${kind}.${serializedPayload}`);

  if (!timingSafeMatch(providedSignature, expectedSignature)) {
    return null;
  }

  try {
    const payload = JSON.parse(base64UrlDecode(serializedPayload).toString("utf8"));
    if (!payload || typeof payload !== "object") {
      return null;
    }

    if (!Number.isFinite(payload.exp) || payload.exp <= unixTimestamp()) {
      return null;
    }

    return payload;
  } catch {
    return null;
  }
}

function validateAccessSession(req) {
  const secret = getAccessSecret(req);
  const cookies = getRequestCookies(req);
  const cookieName = getAccessCookieNameCandidates(req).find((name) => !!cookies[name]);
  const token = cookieName ? cookies[cookieName] : "";

  if (!token) {
    return {
      authorized: false,
      shouldClear: false
    };
  }

  const payload = verifySignedAccessToken(secret, token, ACCESS_SESSION_KIND);
  if (!payload) {
    return {
      authorized: false,
      shouldClear: true
    };
  }

  const expectedUserAgentHash = hashUserAgent(
    req.headers["x-forwarded-user-agent"] || req.headers["user-agent"]
  );

  if (!payload.uah || payload.uah !== expectedUserAgentHash) {
    return {
      authorized: false,
      shouldClear: true
    };
  }

  return {
    authorized: true,
    payload,
    shouldClear: false
  };
}

function redeemAccessCode(req, rawCode) {
  cleanupLocalAccessCodeStore();
  const secret = getAccessSecret(req);
  const codeHash = hashAccessCodeForStorage(req, normalizeAccessCode(rawCode));
  const storedCode = localAccessCodeStore.get(codeHash);

  if (!storedCode || storedCode.expiresAt <= unixTimestamp()) {
    localAccessCodeStore.delete(codeHash);
    return null;
  }

  localAccessCodeStore.delete(codeHash);

  const sessionPayload = {
    exp: unixTimestamp() + getSessionTtlSeconds(),
    iat: unixTimestamp(),
    iss: CODE_ISSUER,
    jti: randomToken(18),
    src: storedCode.codeId || codeHash,
    uah: hashUserAgent(req.headers["x-forwarded-user-agent"] || req.headers["user-agent"])
  };

  return {
    expiresAt: sessionPayload.exp,
    sessionToken: createSignedAccessToken(secret, ACCESS_SESSION_KIND, sessionPayload)
  };
}

function isHlsManifestCandidate(url, headers) {
  const contentType = String(headers?.["content-type"] || "").toLowerCase();
  return url.pathname.endsWith(".m3u8") || contentType.includes("mpegurl") || contentType.includes("application/x-mpegurl");
}

function isLikelyHlsManifest(url, headers, body) {
  const snippet = body ? body.toString("utf8", 0, Math.min(body.length, 2048)).trimStart() : "";

  if (!snippet) {
    return false;
  }

  if (/^(<!doctype html|<html\b|<head\b|<body\b|<script\b)/i.test(snippet)) {
    return false;
  }

  if (!snippet.includes("#EXTM3U")) {
    return false;
  }

  return isHlsManifestCandidate(url, headers);
}

function buildMediaProxyUrl(req, absoluteUrl) {
  const forwardedProto = String(req.headers["x-forwarded-proto"] || "").split(",")[0].trim();
  const protocol = forwardedProto || req.protocol || "https";
  const base = `${protocol}://${req.get("host")}`;
  const proxyUrl = new URL("/__media_proxy__", base);
  proxyUrl.searchParams.set("url", absoluteUrl);
  return proxyUrl.toString();
}

function rewriteManifestLine(line, sourceUrl, req) {
  if (!line || !line.trim()) {
    return line;
  }

  if (!line.startsWith("#")) {
    return buildMediaProxyUrl(req, new URL(line, sourceUrl).toString());
  }

  return line.replace(/URI="([^"]+)"/g, (_match, uriValue) => {
    const absolute = new URL(uriValue, sourceUrl).toString();
    return `URI="${buildMediaProxyUrl(req, absolute)}"`;
  });
}

function rewriteManifestBody(body, sourceUrl, req) {
  return body
    .toString("utf8")
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((line) => rewriteManifestLine(line, sourceUrl, req))
    .join("\n");
}

function parseJsonBody(body) {
  if (!body || body.length === 0) {
    return {};
  }

  if (Buffer.isBuffer(body)) {
    return JSON.parse(body.toString("utf8"));
  }

  if (typeof body === "string") {
    return JSON.parse(body);
  }

  return JSON.parse(String(body));
}

app.get("/api/access/dev-generate", (req, res) => {
  if (!isLocalHostname(req.hostname || "")) {
    return res.status(403).json({ error: "Forbidden" });
  }

  res.setHeader("Cache-Control", "no-store");

  try {
    return res.status(200).json(createLocalAccessCode(req));
  } catch (error) {
    return res.status(500).json({
      error: error instanceof Error ? error.message : "Failed to generate local access code"
    });
  }
});

app.get("/api/access/status", (req, res) => {
  res.setHeader("Cache-Control", "no-store");

  try {
    const sessionState = validateAccessSession(req);

    if (!sessionState.authorized && sessionState.shouldClear) {
      appendClearAccessCookies(res, req);
    }

    return res.status(200).json({ authorized: !!sessionState.authorized });
  } catch (error) {
    return res.status(503).json({
      error: error instanceof Error ? error.message : "Access gate misconfigured"
    });
  }
});

app.post("/api/access/redeem", (req, res) => {
  res.setHeader("Cache-Control", "no-store");

  let body;
  try {
    body = parseJsonBody(req.body);
  } catch {
    return res.status(400).json({ error: "Invalid JSON body" });
  }

  const code = String(body?.code || "").trim();
  if (!code) {
    return res.status(400).json({ error: "Access code is required" });
  }

  try {
    const redeemedSession = redeemAccessCode(req, code);

    if (!redeemedSession) {
      return res.status(401).json({ error: "Invalid or expired access code" });
    }

    const maxAgeSeconds = Math.max(0, redeemedSession.expiresAt - unixTimestamp());
    appendAccessSessionCookie(res, req, redeemedSession.sessionToken, maxAgeSeconds);

    return res.status(200).json({
      expiresAt: redeemedSession.expiresAt,
      ok: true
    });
  } catch (error) {
    return res.status(503).json({
      error: error instanceof Error ? error.message : "Failed to verify access code"
    });
  }
});

app.post("/api/access/logout", (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  appendClearAccessCookies(res, req);
  return res.status(200).json({ ok: true });
});

app.all(/.*/, async (req, res) => {
  if (req.path === "/__media_proxy__") {
    const rawTargetUrl = typeof req.query.url === "string" ? req.query.url : "";

    if (!rawTargetUrl) {
      return res.status(400).send("Missing media url");
    }

    let upstreamUrl;
    try {
      upstreamUrl = new URL(rawTargetUrl);
    } catch {
      return res.status(400).send("Invalid media url");
    }

    console.log(`\n🎬 [MEDIA] ${req.method} ${upstreamUrl.toString()}`);

    try {
      const response = await fetchMedia(upstreamUrl, req);

    if (response.statusCode >= 400) {
  console.log(`❌ [MEDIA ${response.statusCode}] - Body: ${response.body.toString().slice(0, 100)}...`);

  if (response.statusCode === 403) {
    res.setHeader("x-media-blocked", "true");
    res.setHeader("Cache-Control", "no-store");
    return res.status(403).send(response.body);
  }

  if (response.statusCode === 404) {
    res.setHeader("x-media-missing", "true");
    res.setHeader("Cache-Control", "no-store");
    return res.status(404).send(response.body);
  }
} else {
  console.log(`✅ [MEDIA ${response.statusCode}]`);
}

      if (isLikelyHlsManifest(upstreamUrl, response.headers, response.body)) {
        const manifestBody = rewriteManifestBody(response.body, upstreamUrl, req);
        res.setHeader("Content-Type", "application/vnd.apple.mpegurl; charset=utf-8");
        res.setHeader("Cache-Control", "no-store");
        return res.status(response.statusCode).send(manifestBody);
      }

      if (isHlsManifestCandidate(upstreamUrl, response.headers)) {
        console.log("❌ [MEDIA] Invalid HLS manifest payload received");
        res.setHeader("Cache-Control", "no-store");
        return res.status(502).send("Invalid HLS manifest");
      }

      forwardResponseHeaders(res, response.headers);
      res.setHeader("Cache-Control", "no-store");
      return res.status(response.statusCode).send(response.body);
    } catch (error) {
      console.error(`🚨 Media Proxy Error: ${error.message}`);
      return res.status(500).send({ error: error.message });
    }
  }

  if (req.path === "/api/tmdb-sign") {
    const key = typeof req.query.key === "string" ? req.query.key : "";
    const timestamp = typeof req.query.timestamp === "string" ? req.query.timestamp : "";
    const nonce = typeof req.query.nonce === "string" ? req.query.nonce : "";
    const path = typeof req.query.path === "string" ? req.query.path : "";

    if (!key || !timestamp || !nonce || !path) {
      return res.status(400).json({ error: "Missing signing parameters" });
    }

    try {
      return res.json({ signature: signTmdbRequest(key, timestamp, nonce, path) });
    } catch (error) {
      console.error(`🚨 TMDB Sign Error: ${error.message}`);
      return res.status(500).json({ error: error.message });
    }
  }

  if (req.path === "/api/subtitle") {
    const subtitleUrl = typeof req.query.url === "string" ? req.query.url : "";

    if (!subtitleUrl) {
      return res.status(400).send("Missing subtitle url");
    }

    console.log(`\n📝 [SUBTITLE] ${subtitleUrl}`);
    console.log("↪ Using live flixer.su /api/subtitle endpoint");

    try {
      const response = await fetchSubtitle(subtitleUrl);

      if (response.statusCode >= 400) {
        console.log(`❌ [SUBTITLE ${response.statusCode}]`);
        return res.status(response.statusCode).send(response.body);
      }

      console.log("✅ [SUBTITLE 200]");
      res.setHeader("Content-Type", "text/vtt; charset=utf-8");
      return res.status(200).send(normalizeSubtitleBody(response.body));
    } catch (error) {
      console.error(`🚨 Subtitle Proxy Error: ${error.message}`);
      return res.status(500).send({ error: error.message });
    }
  }

  const upstreamHost =
    req.path.startsWith("/workbox-")
      ? mainSiteHost
      : targetHost;
  const targetUrl = `https://${upstreamHost}${req.url}`;
  const browserHeaders = { ...req.headers };

  delete browserHeaders.host;
  delete browserHeaders.connection;
  delete browserHeaders.origin;
  delete browserHeaders.referer;
  delete browserHeaders["content-length"];

  console.log(`\n📡 [PROXYING] ${req.method} ${req.url}`);
  console.log(`🎯 Upstream: ${upstreamHost}`);

  try {
    const response = await fetch(targetUrl, {
      body: req.method === "GET" || req.method === "HEAD" ? undefined : req.body,
      headers: {
        ...browserHeaders,
        referer: "https://flixer.su/",
        origin: "https://flixer.su",
        "sec-fetch-site": "same-site"
      },
      method: req.method,
      redirect: "follow"
    });
    const responseBody = Buffer.from(await response.arrayBuffer());

    if (response.status >= 400) {
      console.log(`❌ [${response.status}] - Body: ${responseBody.toString().slice(0, 100)}...`);
    } else {
      console.log(`✅ [${response.status}]`);
    }

    if (req.path === "/assets/client/tmdb-image-enhancer.js" && response.status === 200) {
      let body = responseBody.toString("utf8");
      const signFnStart = body.indexOf("async function generateRequestSignature");
      const signFnEnd = body.indexOf("export async function buildSecureHeaders", signFnStart);

      if (signFnStart !== -1 && signFnEnd !== -1) {
        const replacement =
          'async function generateRequestSignature(e,r,n,t){const s=(typeof window!="undefined"&&(window.TMDB_API_BASE_URL||window.TMDB_CLIENT_BASE_URL)||"")+"\\/api\\/tmdb-sign",o=new URL(s);o.searchParams.set("key",e),o.searchParams.set("timestamp",String(r)),o.searchParams.set("nonce",String(n)),o.searchParams.set("path",String(t));const a=await fetch(o.toString(),{headers:{"Cache-Control":"no-cache"}});if(!a.ok)throw new Error(`Failed to sign request: HTTP ${a.status}`);const i=await a.json();if(!i||typeof i.signature!="string"||!i.signature)throw new Error("Invalid signing response");return i.signature}\n';
        body = body.slice(0, signFnStart) + replacement + body.slice(signFnEnd);
      } else {
        console.warn("TMDB enhancer patch markers not found; serving unmodified file");
      }

      res.setHeader("Content-Type", "application/javascript; charset=utf-8");
      res.setHeader("Content-Length", Buffer.byteLength(body, "utf8"));
      return res.status(200).send(body);
    }

    forwardResponseHeaders(res, Object.fromEntries(response.headers.entries()));
    res.status(response.status).send(responseBody);
  } catch (error) {
    console.error(`🚨 Proxy Error: ${error.message}`);
    if (!res.headersSent) res.status(500).send({ error: error.message });
  }
});

app.listen(PORT, HOST, () => {
  console.log(`🚀 Proxy v4.2 Active on http://${HOST}:${PORT}`);
  console.log(`🎯 Targeting: ${targetHost}`);
  console.log("📝 Subtitle route enabled at /api/subtitle");
  console.log("🎬 Media route enabled at /__media_proxy__\n");
  startDiscordAutomation();
});
