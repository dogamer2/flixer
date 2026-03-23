import { jsonResponse, textResponse } from "../_shared/access.js";

const LOCAL_PROGRESS_STORE_KEY = "__FLIXER_PROGRESS_STORE__";
const PROGRESS_TABLE_NAME = "user_progress";

export async function onRequest(context) {
  const { env, request } = context;
  const method = request.method.toUpperCase();

  if (method === "OPTIONS") {
    return textResponse("", 204, corsHeaders());
  }

  if (method !== "GET" && method !== "POST") {
    return textResponse("Method not allowed", 405, corsHeaders());
  }

  try {
    const progressKey = await getProgressKey(request);

    if (method === "GET") {
      const payload = await readProgressPayload(env, request, progressKey);
      return jsonResponse(payload, 200, corsHeaders());
    }

    const payload = await request.json().catch(() => ({}));
    const normalizedPayload = isPlainObject(payload) ? payload : {};

    await writeProgressPayload(env, request, progressKey, normalizedPayload);

    return jsonResponse({ ok: true }, 200, corsHeaders());
  } catch (error) {
    return jsonResponse(
      {
        error: error instanceof Error ? error.message : "Progress request failed",
      },
      500,
      corsHeaders(),
    );
  }
}

function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "*",
    "cache-control": "no-store",
  };
}

function isPlainObject(value) {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function getProgressDatabase(env, request) {
  const database = env?.ACCESS_CODES_DB;

  if (database && typeof database.prepare === "function") {
    return database;
  }

  if (isLocalRequest(request)) {
    return null;
  }

  throw new Error("Missing ACCESS_CODES_DB");
}

async function ensureProgressTable(database) {
  if (!database) {
    return;
  }

  await database
    .prepare(
      `CREATE TABLE IF NOT EXISTS ${PROGRESS_TABLE_NAME} (
        progress_key TEXT PRIMARY KEY,
        payload TEXT NOT NULL,
        updated_at INTEGER NOT NULL
      )`,
    )
    .run();
}

async function readProgressPayload(env, request, progressKey) {
  const database = getProgressDatabase(env, request);

  if (!database) {
    const store = getLocalProgressStore();
    return store.get(progressKey) || {};
  }

  await ensureProgressTable(database);

  const result = await database
    .prepare(`SELECT payload FROM ${PROGRESS_TABLE_NAME} WHERE progress_key = ?1`)
    .bind(progressKey)
    .first();

  if (!result?.payload) {
    return {};
  }

  try {
    const parsed = JSON.parse(String(result.payload));
    return isPlainObject(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

async function writeProgressPayload(env, request, progressKey, payload) {
  const database = getProgressDatabase(env, request);

  if (!database) {
    const store = getLocalProgressStore();
    store.set(progressKey, payload);
    return;
  }

  await ensureProgressTable(database);

  await database
    .prepare(
      `INSERT INTO ${PROGRESS_TABLE_NAME} (progress_key, payload, updated_at)
       VALUES (?1, ?2, ?3)
       ON CONFLICT(progress_key) DO UPDATE SET
         payload = excluded.payload,
         updated_at = excluded.updated_at`,
    )
    .bind(progressKey, JSON.stringify(payload), unixTimestamp())
    .run();
}

function getLocalProgressStore() {
  const existingStore = globalThis[LOCAL_PROGRESS_STORE_KEY];

  if (existingStore instanceof Map) {
    return existingStore;
  }

  const store = new Map();
  globalThis[LOCAL_PROGRESS_STORE_KEY] = store;
  return store;
}

async function getProgressKey(request) {
  const authHeader = String(request.headers.get("authorization") || "").trim();
  const cookieHeader = String(request.headers.get("cookie") || "").trim();
  const userAgent = String(request.headers.get("user-agent") || "").trim();

  if (authHeader) {
    return `auth:${await hashValue(authHeader)}`;
  }

  if (cookieHeader) {
    return `cookie:${await hashValue(cookieHeader)}`;
  }

  if (userAgent) {
    return `ua:${await hashValue(userAgent)}`;
  }

  return "anonymous";
}

async function hashValue(value) {
  const encoded = new TextEncoder().encode(String(value || ""));
  const digest = await crypto.subtle.digest("SHA-256", encoded);
  return bytesToHex(new Uint8Array(digest));
}

function bytesToHex(bytes) {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function unixTimestamp() {
  return Math.floor(Date.now() / 1000);
}

function isLocalRequest(request) {
  const hostname = new URL(request.url).hostname;
  return (
    hostname === "localhost" ||
    hostname === "127.0.0.1" ||
    hostname.endsWith(".local") ||
    hostname === ""
  );
}
