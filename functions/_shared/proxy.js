const TARGET_HOST = "plsdontscrapemelove.flixer.su";
const MAIN_SITE_HOST = "flixer.su";
const API_HOST = "api.flixer.su";
const DEFAULT_REFERER = "https://flixer.su/";
const DEFAULT_ORIGIN = "https://flixer.su";
const DEFAULT_ACCEPT_LANGUAGE = "en-US,en;q=0.9";
const DEFAULT_API_ACCEPT = "application/json, text/plain, */*";
const DEFAULT_MEDIA_ACCEPT =
  "application/vnd.apple.mpegurl,application/x-mpegURL,application/json;q=0.9,text/plain;q=0.8,*/*;q=0.7";
const DEFAULT_BROWSER_USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.0.0 Safari/537.36";
const DEFAULT_SEC_CH_UA = '"Chromium";v="134", "Google Chrome";v="134", "Not:A-Brand";v="24"';
const DEFAULT_SEC_CH_UA_MOBILE = "?0";
const DEFAULT_SEC_CH_UA_PLATFORM = '"Windows"';

const BLOCKED_RESPONSE_HEADERS = new Set([
  "content-encoding",
  "transfer-encoding",
  "access-control-allow-origin",
  "content-length"
]);

function arrayBufferToBase64(buffer) {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  let binary = "";
  for (let index = 0; index < bytes.length; index += 1) {
    binary += String.fromCharCode(bytes[index]);
  }
  return btoa(binary);
}

function appendCorsHeaders(headers) {
  headers.set("Access-Control-Allow-Origin", "*");
  headers.set("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  headers.set("Access-Control-Allow-Headers", "*");
  return headers;
}

function copyResponseHeaders(targetHeaders, sourceHeaders) {
  for (const [key, value] of sourceHeaders.entries()) {
    if (BLOCKED_RESPONSE_HEADERS.has(key.toLowerCase())) {
      continue;
    }
    try {
      targetHeaders.set(key, value);
    } catch {}
  }
  return targetHeaders;
}

function buildResponse(response, body, extraHeaders = {}) {
  const headers = appendCorsHeaders(new Headers());
  copyResponseHeaders(headers, response.headers);

  for (const [key, value] of Object.entries(extraHeaders)) {
    if (value !== undefined && value !== null) {
      headers.set(key, value);
    }
  }

  return new Response(body, {
    status: response.status,
    statusText: response.statusText,
    headers
  });
}

function jsonResponse(payload, status = 200) {
  const headers = appendCorsHeaders(new Headers({ "Content-Type": "application/json; charset=utf-8" }));
  return new Response(JSON.stringify(payload), { status, headers });
}

function textResponse(message, status = 200, headers = {}) {
  const finalHeaders = appendCorsHeaders(new Headers(headers));
  return new Response(message, { status, headers: finalHeaders });
}

function buildProxyHeaders(request, overrides = {}) {
  const headers = new Headers();

  for (const [key, value] of request.headers.entries()) {
    const lowerKey = key.toLowerCase();
    if (["host", "connection", "content-length", "origin", "referer"].includes(lowerKey)) {
      continue;
    }
    headers.set(key, value);
  }

  for (const [key, value] of Object.entries(overrides)) {
    if (value === null) {
      headers.delete(key);
    } else if (value !== undefined) {
      headers.set(key, value);
    }
  }

  if (!headers.has("accept")) {
    headers.set("accept", DEFAULT_API_ACCEPT);
  }

  if (!headers.has("accept-language")) {
    headers.set("accept-language", DEFAULT_ACCEPT_LANGUAGE);
  }

  if (!headers.has("user-agent")) {
    headers.set("user-agent", DEFAULT_BROWSER_USER_AGENT);
  }

  if (!headers.has("sec-ch-ua")) {
    headers.set("sec-ch-ua", DEFAULT_SEC_CH_UA);
  }

  if (!headers.has("sec-ch-ua-mobile")) {
    headers.set("sec-ch-ua-mobile", DEFAULT_SEC_CH_UA_MOBILE);
  }

  if (!headers.has("sec-ch-ua-platform")) {
    headers.set("sec-ch-ua-platform", DEFAULT_SEC_CH_UA_PLATFORM);
  }

  return headers;
}

async function forwardToUpstream(
  request,
  upstreamUrl,
  { hostType = "target", headers: headerOverrides = {}, body } = {}
) {
  const headers = buildProxyHeaders(request, {
    referer: DEFAULT_REFERER,
    origin: DEFAULT_ORIGIN,
    "sec-fetch-site": hostType === "main" ? "same-origin" : "same-site",
    ...headerOverrides
  });

  const init = {
    method: request.method,
    headers,
    redirect: "follow"
  };

  if (!["GET", "HEAD"].includes(request.method.toUpperCase())) {
    init.body = body !== undefined ? body : await request.arrayBuffer();
  }

  return fetch(upstreamUrl.toString(), init);
}

function getEmbeddedMediaOrigin(upstreamUrl) {
  const firstSegment = upstreamUrl.pathname.split("/").filter(Boolean)[0] || "";

  if (!/^[a-z0-9.-]+\.[a-z]{2,}$/i.test(firstSegment)) {
    return null;
  }

  return `https://${firstSegment}`;
}

function buildMediaRequestHeaders(request, options = {}) {
  const {
    accept = DEFAULT_MEDIA_ACCEPT,
    includeSiteHeaders = true,
    origin,
    referer,
    secFetchDest = "empty",
    secFetchMode = "cors",
    secFetchSite = "cross-site",
    upgradeInsecureRequests,
    includeClientHints = true
  } = options;
  const headers = new Headers({
    accept: request.headers.get("accept") || accept,
    "accept-language": request.headers.get("accept-language") || DEFAULT_ACCEPT_LANGUAGE,
    "cache-control": "no-cache",
    pragma: "no-cache",
    "sec-fetch-dest": secFetchDest,
    "sec-fetch-mode": secFetchMode,
    "user-agent":
      request.headers.get("x-forwarded-user-agent") ||
      request.headers.get("user-agent") ||
      DEFAULT_BROWSER_USER_AGENT
  });

  if (includeClientHints) {
    headers.set("sec-ch-ua", DEFAULT_SEC_CH_UA);
    headers.set("sec-ch-ua-mobile", DEFAULT_SEC_CH_UA_MOBILE);
    headers.set("sec-ch-ua-platform", DEFAULT_SEC_CH_UA_PLATFORM);
  }

  const range = request.headers.get("range");
  if (range) {
    headers.set("range", range);
  }

  if (includeSiteHeaders) {
    headers.set("referer", referer || DEFAULT_REFERER);
    headers.set("origin", origin || DEFAULT_ORIGIN);
  }

  headers.set("sec-fetch-site", secFetchSite);

  if (upgradeInsecureRequests !== undefined) {
    headers.set("upgrade-insecure-requests", String(upgradeInsecureRequests));
  }

  return headers;
}

async function fetchMediaAttempt(upstreamUrl, headers) {
  return fetch(upstreamUrl.toString(), {
    method: "GET",
    headers,
    redirect: "follow"
  });
}

async function fetchMedia(upstreamUrl, request) {
  const isWorkersDev = upstreamUrl.hostname.endsWith(".workers.dev");
  const embeddedOrigin = getEmbeddedMediaOrigin(upstreamUrl);
  const attempts = isWorkersDev
    ? [
        {
          includeSiteHeaders: true
        },
        ...(embeddedOrigin
          ? [
              {
                includeSiteHeaders: true,
                origin: embeddedOrigin,
                referer: `${embeddedOrigin}/`
              },
              {
                includeSiteHeaders: true,
                origin: null,
                referer: `${embeddedOrigin}/`
              },
              {
                includeSiteHeaders: true,
                origin: null,
                referer: upstreamUrl.toString()
              },
              {
                accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
                includeSiteHeaders: true,
                origin: embeddedOrigin,
                referer: `${embeddedOrigin}/`,
                secFetchDest: "document",
                secFetchMode: "navigate",
                secFetchSite: "none",
                upgradeInsecureRequests: 1
              },
              {
                accept: "*/*",
                includeSiteHeaders: true,
                origin: null,
                referer: `${embeddedOrigin}/`,
                secFetchDest: "empty",
                secFetchMode: "no-cors",
                secFetchSite: "same-site",
                includeClientHints: false
              }
            ]
          : []),
        {
          accept: "*/*",
          includeSiteHeaders: false,
          includeClientHints: false
        },
        {
          includeSiteHeaders: false
        }
      ]
    : [
        {
          includeSiteHeaders: true
        }
      ];
  let lastResponse = null;
  let lastError = null;

  for (const attempt of attempts) {
    try {
      const response = await fetchMediaAttempt(upstreamUrl, buildMediaRequestHeaders(request, attempt));
      if (response.status < 400) {
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

function normalizeSubtitleBody(body) {
  const text = String(body || "").replace(/^\uFEFF/, "").replace(/\r+/g, "").trimStart();
  if (/^WEBVTT/i.test(text)) {
    return text;
  }
  return `WEBVTT\n\n${text}`;
}

async function signTmdbRequest(key, timestamp, nonce, path) {
  const encoder = new TextEncoder();
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    encoder.encode(String(key)),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );

  const signatureBuffer = await crypto.subtle.sign(
    "HMAC",
    cryptoKey,
    encoder.encode(`${key}:${timestamp}:${nonce}:${path}`)
  );

  return arrayBufferToBase64(signatureBuffer);
}

function isHlsManifestCandidate(url, headers) {
  const contentType = String(headers.get("content-type") || "").toLowerCase();
  return url.pathname.endsWith(".m3u8") || contentType.includes("mpegurl") || contentType.includes("application/x-mpegurl");
}

function isLikelyHlsManifest(url, headers, bodyText = "") {
  const snippet = String(bodyText || "").slice(0, 2048).trimStart();

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

function buildMediaProxyUrl(request, absoluteUrl) {
  const proxyUrl = new URL("/__media_proxy__", request.url);
  proxyUrl.searchParams.set("url", absoluteUrl);
  return proxyUrl.toString();
}

function rewriteManifestLine(line, sourceUrl, request) {
  if (!line || !line.trim()) {
    return line;
  }

  if (!line.startsWith("#")) {
    return buildMediaProxyUrl(request, new URL(line, sourceUrl).toString());
  }

  return line.replace(/URI="([^"]+)"/g, (_match, uriValue) => {
    const absolute = new URL(uriValue, sourceUrl).toString();
    return `URI="${buildMediaProxyUrl(request, absolute)}"`;
  });
}

function rewriteManifestBody(body, sourceUrl, request) {
  return body
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((line) => rewriteManifestLine(line, sourceUrl, request))
    .join("\n");
}

function patchTmdbImageEnhancer(body) {
  const signFnStart = body.indexOf("async function generateRequestSignature");
  const signFnEnd = body.indexOf("export async function buildSecureHeaders", signFnStart);

  if (signFnStart === -1 || signFnEnd === -1) {
    return body;
  }

  const replacement =
    'async function generateRequestSignature(e,r,n,t){const s=(typeof window!="undefined"&&(window.TMDB_API_BASE_URL||window.TMDB_CLIENT_BASE_URL)||"")+"\\/api\\/tmdb-sign",o=new URL(s);o.searchParams.set("key",e),o.searchParams.set("timestamp",String(r)),o.searchParams.set("nonce",String(n)),o.searchParams.set("path",String(t));const a=await fetch(o.toString(),{headers:{"Cache-Control":"no-cache"}});if(!a.ok)throw new Error(`Failed to sign request: HTTP ${a.status}`);const i=await a.json();if(!i||typeof i.signature!="string"||!i.signature)throw new Error("Invalid signing response");return i.signature}\n';

  return body.slice(0, signFnStart) + replacement + body.slice(signFnEnd);
}

function getUpstreamAssetUrl(pathname) {
  return new URL(`https://${TARGET_HOST}${pathname}`);
}

function getTargetApiUrl(pathname, search) {
  return new URL(`https://${TARGET_HOST}${pathname}${search}`);
}

function getMainSiteUrl(pathname, search) {
  return new URL(`https://${MAIN_SITE_HOST}${pathname}${search}`);
}

function getApiHostUrl(pathname, search) {
  return new URL(`https://${API_HOST}${pathname}${search}`);
}

function getWorkerHeaders() {
  return {
    "Cache-Control": "no-store"
  };
}

export {
  API_HOST,
  TARGET_HOST,
  MAIN_SITE_HOST,
  appendCorsHeaders,
  buildMediaProxyUrl,
  buildProxyHeaders,
  buildResponse,
  copyResponseHeaders,
  fetchMedia,
  forwardToUpstream,
  getApiHostUrl,
  getMainSiteUrl,
  getTargetApiUrl,
  getUpstreamAssetUrl,
  getWorkerHeaders,
  isLikelyHlsManifest,
  isHlsManifestCandidate,
  jsonResponse,
  normalizeSubtitleBody,
  patchTmdbImageEnhancer,
  rewriteManifestBody,
  signTmdbRequest,
  textResponse
};
