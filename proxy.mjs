import express from "express";
import { gotScraping } from "got-scraping";
import crypto from "crypto";

const app = express();
const targetHost = "plsdontscrapemelove.flixer.su";
const mainSiteHost = "flixer.su";
const HOST = "0.0.0.0";
const PORT = 3001;

app.use(express.raw({ type: "*/*", limit: "25mb" }));

app.use((req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "*");
  if (req.method === "OPTIONS") return res.sendStatus(204);
  next();
});

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
    accept: req.headers.accept || "*/*",
    "accept-language": req.headers["accept-language"] || "en-US,en;q=0.9",
    "user-agent": req.headers["x-forwarded-user-agent"] || req.headers["user-agent"] || "Mozilla/5.0"
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

async function fetchMediaAttempt(upstreamUrl, headers) {
  const response = await fetch(upstreamUrl.toString(), {
    method: "GET",
    headers,
    redirect: "follow"
  });

  return {
    statusCode: response.status,
    headers: Object.fromEntries(response.headers.entries()),
    body: Buffer.from(await response.arrayBuffer())
  };
}

async function fetchMedia(upstreamUrl, req) {
  const isWorkersDev = upstreamUrl.hostname.endsWith(".workers.dev");
  const attempts = isWorkersDev ? [true, false] : [true];
  let lastResponse = null;
  let lastError = null;

  for (const includeSiteHeaders of attempts) {
    try {
      const response = await fetchMediaAttempt(upstreamUrl, buildMediaRequestHeaders(req, includeSiteHeaders));
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

  return gotScraping({
    url: upstreamUrl.toString(),
    method: "GET",
    http2: true,
    useHeaderGenerator: true,
    headerGeneratorOptions: {
      browsers: [{ name: "chrome", minVersion: 124 }],
      devices: ["desktop"],
      operatingSystems: ["windows"]
    },
    headers: {
      referer: "https://flixer.su/",
      origin: "https://flixer.su",
      accept: "text/vtt,text/plain,application/x-subrip,application/octet-stream;q=0.9,*/*;q=0.8"
    },
    responseType: "text",
    throwHttpErrors: false
  });
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
  const base = `${req.protocol}://${req.get("host")}`;
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
    const response = await gotScraping({
      url: targetUrl,
      method: req.method,
      http2: true,
      useHeaderGenerator: true,
      headerGeneratorOptions: {
        browsers: [{ name: "chrome", minVersion: 124 }],
        devices: ["desktop"],
        operatingSystems: ["windows"]
      },
      headers: {
        ...browserHeaders,
        referer: "https://flixer.su/",
        origin: "https://flixer.su",
        "sec-fetch-site": "same-site"
      },
      body: req.method === "GET" || req.method === "HEAD" ? undefined : req.body,
      responseType: "buffer",
      throwHttpErrors: false
    });

    if (response.statusCode >= 400) {
      console.log(`❌ [${response.statusCode}] - Body: ${response.body.toString().slice(0, 100)}...`);
    } else {
      console.log(`✅ [${response.statusCode}]`);
    }

    if (req.path === "/assets/client/tmdb-image-enhancer.js" && response.statusCode === 200) {
      let body = response.body.toString("utf8");
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

    forwardResponseHeaders(res, response.headers);
    res.status(response.statusCode).send(response.body);
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
});
