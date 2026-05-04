import {
  buildResponse,
  fetchMedia,
  forwardToUpstream,
  getApiHostUrl,
  getMainSiteUrl,
  getTargetApiUrl,
  isLikelyHlsManifest,
  jsonResponse,
  normalizeSubtitleBody,
  rewriteManifestBody,
  signTmdbRequest,
  textResponse
} from "../_shared/proxy.js";

const BUNDLED_WYZIE_KEY = "wyzie-c906fb1acd0204957b95582dfdaa498f";
const FALLBACK_WYZIE_KEY = "wyzie-8bf64096ae2e364e6612d386430b592f";
const SUBDL_ORIGIN = "https://subdl.com";
const SUBDL_DOWNLOAD_ORIGIN = "https://dl.subdl.com";

function createJsonArrayResponse(payload) {
  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: new Headers({
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "*",
      "Cache-Control": "no-store",
      "Content-Type": "application/json; charset=utf-8"
    })
  });
}

function buildSubtitleProxyHeaders(request) {
  return {
    accept: "text/html,application/json,text/plain,*/*",
    "accept-language": request.headers.get("accept-language") || "en-US,en;q=0.9",
    "user-agent":
      request.headers.get("user-agent") ||
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.0.0 Safari/537.36"
  };
}

async function fetchWithTimeout(url, init = {}, timeoutMs = 8000) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(new Error("The operation was aborted due to timeout")), timeoutMs);

  try {
    return await fetch(url, {
      ...init,
      signal: controller.signal
    });
  } finally {
    clearTimeout(timeoutId);
  }
}

function extractNextDataJson(html) {
  const match = String(html || "").match(
    /<script id="__NEXT_DATA__" type="application\/json">([\s\S]*?)<\/script>/i
  );

  if (!match) {
    throw new Error("Unable to parse Subdl page data");
  }

  return JSON.parse(match[1]);
}

function normalizeComparableTitle(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/&amp;/g, "&")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function detectTmdbType(searchParams) {
  const explicit = String(searchParams.get("mediaType") || searchParams.get("type") || "").trim().toLowerCase();
  if (explicit === "movie" || explicit === "tv") {
    return explicit;
  }

  if (searchParams.get("season") || searchParams.get("episode")) {
    return "tv";
  }

  return "movie";
}

async function fetchTmdbMetadata(id, mediaType, request) {
  const typeOrder = mediaType === "tv" ? ["tv", "movie"] : ["movie", "tv"];

  for (const type of typeOrder) {
    const upstreamUrl = getApiHostUrl(`/tmdb/${type}/${encodeURIComponent(id)}`, "");

    try {
      const response = await fetchWithTimeout(
        upstreamUrl.toString(),
        {
          method: "GET",
          headers: buildSubtitleProxyHeaders(request),
          redirect: "follow"
        },
        8000
      );

      if (!response.ok) {
        continue;
      }

      const payload = await response.json();
      const title = payload?.title || payload?.name || payload?.original_title || payload?.original_name || "";
      const releaseDate = payload?.release_date || payload?.first_air_date || "";
      const year = Number.parseInt(String(releaseDate).slice(0, 4), 10);

      if (title) {
        return {
          mediaType: type,
          title,
          year: Number.isFinite(year) ? year : null
        };
      }
    } catch (_error) {
      continue;
    }
  }

  return null;
}

function pickBestSubdlMatch(list, metadata) {
  const desiredTitle = normalizeComparableTitle(metadata?.title);
  const desiredYear = Number(metadata?.year) || null;
  const desiredType = metadata?.mediaType || "movie";

  const candidates = Array.isArray(list) ? list : [];
  const ranked = candidates
    .filter((entry) => entry && entry.sd_id && entry.slug)
    .map((entry) => {
      const normalizedName = normalizeComparableTitle(entry.name || entry.original_name);
      let score = 0;

      if (entry.type === desiredType) {
        score += 5;
      }

      if (desiredYear && Number(entry.year) === desiredYear) {
        score += 4;
      }

      if (normalizedName === desiredTitle) {
        score += 6;
      } else if (desiredTitle && normalizedName.includes(desiredTitle)) {
        score += 2;
      }

      score += Math.min(Number(entry.subtitles_count) || 0, 3);

      return { entry, score };
    })
    .sort((left, right) => right.score - left.score);

  return ranked[0]?.entry || null;
}

function flattenSubdlSubtitleEntries(subtitleSimpleParsed) {
  const results = [];

  if (!subtitleSimpleParsed || typeof subtitleSimpleParsed !== "object") {
    return results;
  }

  for (const [languageName, qualityBuckets] of Object.entries(subtitleSimpleParsed)) {
    if (!qualityBuckets || typeof qualityBuckets !== "object") {
      continue;
    }

    for (const [qualityName, bucket] of Object.entries(qualityBuckets)) {
      const subs = Array.isArray(bucket?.subs) ? bucket.subs : [];
      for (const subtitle of subs) {
        if (!subtitle?.link) {
          continue;
        }

        results.push({
          id: `subdl-${subtitle.id || subtitle.link}`,
          language: languageName,
          display: languageName,
          version: qualityName,
          release:
            subtitle.title ||
            (Array.isArray(subtitle.releases) ? subtitle.releases[0] : "") ||
            qualityName,
          isHearingImpaired: Boolean(subtitle.hi),
          url: `${SUBDL_DOWNLOAD_ORIGIN}/subtitle/${subtitle.link}`,
          source: "subdl"
        });
      }
    }
  }

  return results;
}

async function fetchSubdlCandidates(searchParams, request) {
  const tmdbId = String(searchParams.get("id") || searchParams.get("tmdbId") || searchParams.get("tmdb_id") || "").trim();
  if (!tmdbId) {
    return [];
  }

  const metadata = await fetchTmdbMetadata(tmdbId, detectTmdbType(searchParams), request);
  if (!metadata?.title) {
    return [];
  }

  const searchUrl = `${SUBDL_ORIGIN}/search/${encodeURIComponent(metadata.title)}`;
  const searchResponse = await fetchWithTimeout(
    searchUrl,
    {
      method: "GET",
      headers: buildSubtitleProxyHeaders(request),
      redirect: "follow"
    },
    10000
  );

  if (!searchResponse.ok) {
    return [];
  }

  const searchData = extractNextDataJson(await searchResponse.text());
  const searchList = searchData?.props?.pageProps?.list;
  const bestMatch = pickBestSubdlMatch(searchList, metadata);
  if (!bestMatch) {
    return [];
  }

  const detailUrl = `${SUBDL_ORIGIN}/subtitle/${bestMatch.sd_id}/${bestMatch.slug}`;
  const detailResponse = await fetchWithTimeout(
    detailUrl,
    {
      method: "GET",
      headers: buildSubtitleProxyHeaders(request),
      redirect: "follow"
    },
    10000
  );

  if (!detailResponse.ok) {
    return [];
  }

  const detailData = extractNextDataJson(await detailResponse.text());
  return flattenSubdlSubtitleEntries(detailData?.props?.pageProps?.subtitleSimpleParsed);
}

function readUInt16(bytes, offset) {
  return bytes[offset] | (bytes[offset + 1] << 8);
}

function readUInt32(bytes, offset) {
  return (
    bytes[offset] |
    (bytes[offset + 1] << 8) |
    (bytes[offset + 2] << 16) |
    (bytes[offset + 3] << 24)
  ) >>> 0;
}

function findZipEndOfCentralDirectory(bytes) {
  for (let offset = bytes.length - 22; offset >= Math.max(0, bytes.length - 65557); offset -= 1) {
    if (readUInt32(bytes, offset) === 0x06054b50) {
      return offset;
    }
  }

  throw new Error("Invalid zip archive");
}

function parseZipEntries(bytes) {
  const eocdOffset = findZipEndOfCentralDirectory(bytes);
  const entryCount = readUInt16(bytes, eocdOffset + 10);
  const centralDirectoryOffset = readUInt32(bytes, eocdOffset + 16);
  const decoder = new TextDecoder();
  const entries = [];
  let offset = centralDirectoryOffset;

  for (let index = 0; index < entryCount; index += 1) {
    if (readUInt32(bytes, offset) !== 0x02014b50) {
      throw new Error("Invalid zip central directory");
    }

    const compressionMethod = readUInt16(bytes, offset + 10);
    const compressedSize = readUInt32(bytes, offset + 20);
    const fileNameLength = readUInt16(bytes, offset + 28);
    const extraLength = readUInt16(bytes, offset + 30);
    const commentLength = readUInt16(bytes, offset + 32);
    const localHeaderOffset = readUInt32(bytes, offset + 42);
    const nameStart = offset + 46;
    const nameEnd = nameStart + fileNameLength;
    const name = decoder.decode(bytes.slice(nameStart, nameEnd));

    entries.push({
      name,
      compressedSize,
      compressionMethod,
      localHeaderOffset
    });

    offset = nameEnd + extraLength + commentLength;
  }

  return entries;
}

async function inflateRaw(bytes) {
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

function pickBestSubtitleEntry(entries) {
  const subtitleEntries = entries.filter((entry) => /\.(srt|vtt)$/i.test(entry.name || ""));
  subtitleEntries.sort((left, right) => {
    const leftScore = /\.srt$/i.test(left.name) ? 2 : 1;
    const rightScore = /\.srt$/i.test(right.name) ? 2 : 1;
    if (rightScore !== leftScore) {
      return rightScore - leftScore;
    }
    return left.name.length - right.name.length;
  });
  return subtitleEntries[0] || null;
}

async function extractSubtitleFromZipArchive(arrayBuffer) {
  const bytes = new Uint8Array(arrayBuffer);
  const entries = parseZipEntries(bytes);
  const targetEntry = pickBestSubtitleEntry(entries);

  if (!targetEntry) {
    throw new Error("No supported subtitle file found in archive");
  }

  const localOffset = targetEntry.localHeaderOffset;
  if (readUInt32(bytes, localOffset) !== 0x04034b50) {
    throw new Error("Invalid zip local file header");
  }

  const fileNameLength = readUInt16(bytes, localOffset + 26);
  const extraLength = readUInt16(bytes, localOffset + 28);
  const dataStart = localOffset + 30 + fileNameLength + extraLength;
  const dataEnd = dataStart + targetEntry.compressedSize;
  const compressed = bytes.slice(dataStart, dataEnd);

  let extracted;
  if (targetEntry.compressionMethod === 0) {
    extracted = compressed;
  } else if (targetEntry.compressionMethod === 8) {
    extracted = await inflateRaw(compressed);
  } else {
    throw new Error(`Unsupported zip compression method: ${targetEntry.compressionMethod}`);
  }

  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(extracted);
  } catch {
    return new TextDecoder().decode(extracted);
  }
}

function buildSubtitleSearchCandidates(searchParams) {
  const cleanedEntries = [];

  for (const [key, rawValue] of searchParams.entries()) {
    const value = String(rawValue || "").trim();
    if (!value || value === "undefined" || value === "null") {
      continue;
    }
    cleanedEntries.push([key, value]);
  }

  const base = new URLSearchParams(cleanedEntries);
  const candidates = [];
  const seen = new Set();

  const pushCandidate = (params) => {
    const key = params.toString();
    if (!key || seen.has(key)) {
      return;
    }
    seen.add(key);
    candidates.push(params);
  };

  pushCandidate(new URLSearchParams(base));

  const strippedFormat = new URLSearchParams(base);
  strippedFormat.delete("format");
  strippedFormat.delete("type");
  pushCandidate(strippedFormat);

  const id = strippedFormat.get("id") || base.get("id") || "";
  if (id) {
    const aliases = [
      ["id", id],
      ["tmdbId", id],
      ["tmdb_id", id]
    ];

    for (const [aliasKey, aliasValue] of aliases) {
      const params = new URLSearchParams(strippedFormat);
      params.delete("id");
      params.delete("tmdbId");
      params.delete("tmdb_id");
      params.set(aliasKey, aliasValue);
      pushCandidate(params);
    }
  }

  return candidates;
}

function resolveWyzieApiKey(searchParams, env) {
  const requestKey = String(searchParams.get("key") || "").trim();
  const configuredKey = String(
    env?.WYZIE_API_KEY || env?.WYZIE_SUBS_API_KEY || FALLBACK_WYZIE_KEY
  ).trim();

  if (requestKey && requestKey !== BUNDLED_WYZIE_KEY) {
    return requestKey;
  }

  return configuredKey;
}

export async function onRequest(context) {
  const { request, params, env } = context;
  const requestMethod = request.method.toUpperCase();
  const normalizedPath = Array.isArray(params.path)
    ? params.path.join("/")
    : String(params.path || "");

  if (requestMethod === "OPTIONS") {
    return textResponse("", 204);
  }

  const path = `/${normalizedPath}`;
  const requestUrl = new URL(request.url);

  if (path === "/tmdb-sign") {
    const key = requestUrl.searchParams.get("key") || "";
    const timestamp = requestUrl.searchParams.get("timestamp") || "";
    const nonce = requestUrl.searchParams.get("nonce") || "";
    const signaturePath = requestUrl.searchParams.get("path") || "";

    if (!key || !timestamp || !nonce || !signaturePath) {
      return jsonResponse({ error: "Missing signing parameters" }, 400);
    }

    try {
      const signature = await signTmdbRequest(key, timestamp, nonce, signaturePath);
      return jsonResponse({ signature });
    } catch (error) {
      return jsonResponse({ error: error.message }, 500);
    }
  }

  if (path === "/subtitle") {
    const subtitleUrl = requestUrl.searchParams.get("url") || "";

    if (!subtitleUrl) {
      return textResponse("Missing subtitle url", 400);
    }

    try {
      const parsedSubtitleUrl = new URL(subtitleUrl);
      const isSubdlDownload =
        parsedSubtitleUrl.hostname === "dl.subdl.com" ||
        parsedSubtitleUrl.hostname.endsWith(".subdl.com");

      if (isSubdlDownload) {
        const archiveUrl = parsedSubtitleUrl.pathname.endsWith(".zip")
          ? parsedSubtitleUrl.toString()
          : `${parsedSubtitleUrl.toString().replace(/\/+$/, "")}.zip`;
        const response = await fetchWithTimeout(
          archiveUrl,
          {
            method: "GET",
            headers: {
              ...buildSubtitleProxyHeaders(request),
              accept: "application/octet-stream,application/zip;q=0.9,*/*;q=0.8",
              referer: `${SUBDL_ORIGIN}/`,
              origin: SUBDL_ORIGIN
            },
            redirect: "follow"
          },
          12000
        );

        if (!response.ok) {
          return buildResponse(response, await response.arrayBuffer(), {
            "Cache-Control": "no-store"
          });
        }

        const normalizedBody = normalizeSubtitleBody(
          await extractSubtitleFromZipArchive(await response.arrayBuffer())
        );

        return new Response(normalizedBody, {
          status: 200,
          headers: new Headers({
            "Access-Control-Allow-Origin": "*",
            "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
            "Access-Control-Allow-Headers": "*",
            "Content-Type": "text/vtt; charset=utf-8"
          })
        });
      }

      const upstreamUrl = getMainSiteUrl("/api/subtitle", `?url=${encodeURIComponent(subtitleUrl)}`);
      const response = await fetch(upstreamUrl.toString(), {
        method: "GET",
        headers: {
          referer: "https://flixer.su/",
          origin: "https://flixer.su",
          accept: "text/vtt,text/plain,application/x-subrip,application/octet-stream;q=0.9,*/*;q=0.8"
        },
        redirect: "follow"
      });

      if (!response.ok) {
        return buildResponse(response, await response.arrayBuffer());
      }

      const normalizedBody = normalizeSubtitleBody(await response.text());
      return new Response(normalizedBody, {
        status: 200,
        headers: new Headers({
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
          "Access-Control-Allow-Headers": "*",
          "Content-Type": "text/vtt; charset=utf-8"
        })
      });
    } catch (error) {
      return jsonResponse({ error: error.message }, 500);
    }
  }

  if (path === "/subsearch") {
    try {
      const candidates = buildSubtitleSearchCandidates(requestUrl.searchParams);
      const resolvedKey = resolveWyzieApiKey(requestUrl.searchParams, env);

      for (const params of candidates) {
        try {
          const upstreamUrl = new URL("https://sub.wyzie.io/search");
          const candidateParams = new URLSearchParams(params);

          if (resolvedKey) {
            candidateParams.set("key", resolvedKey);
          } else {
            candidateParams.delete("key");
          }

          upstreamUrl.search = candidateParams.toString();

          const response = await fetchWithTimeout(
            upstreamUrl.toString(),
            {
              method: "GET",
              headers: {
                accept: "application/json, text/plain, */*",
                referer: "https://flixer.su/",
                origin: "https://flixer.su",
                "user-agent":
                  request.headers.get("user-agent") ||
                  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.0.0 Safari/537.36"
              },
              redirect: "follow"
            },
            8000
          );

          if (!response.ok) {
            continue;
          }

          const payload = await response.json().catch(() => null);
          if (Array.isArray(payload) && payload.length > 0) {
            return createJsonArrayResponse(payload);
          }
        } catch (_error) {
          continue;
        }
      }

      const subdlPayload = await fetchSubdlCandidates(requestUrl.searchParams, request).catch(() => []);
      return createJsonArrayResponse(subdlPayload);
    } catch (error) {
      return jsonResponse({ error: error.message }, 500);
    }
  }

  if (path === "/media") {
    const mediaUrl = requestUrl.searchParams.get("url") || "";
    const relayMode = requestUrl.searchParams.get("relay") || "";

    if (!mediaUrl) {
      return textResponse("Missing media url", 400);
    }

    let upstreamUrl;
    try {
      upstreamUrl = new URL(mediaUrl);
    } catch (_error) {
      return textResponse("Invalid media url", 400);
    }

    try {
      let response;
      if (relayMode === "render") {
        const relayUrl = new URL("https://flixer-jw67.onrender.com/__media_proxy__");
        relayUrl.searchParams.set("url", upstreamUrl.toString());
        response = await fetch(relayUrl.toString(), {
          method: "GET",
          headers: {
            accept:
              request.headers.get("accept") ||
              "application/vnd.apple.mpegurl,application/x-mpegURL,application/json;q=0.9,text/plain;q=0.8,*/*;q=0.7",
            "accept-language": request.headers.get("accept-language") || "en-US,en;q=0.9",
            "user-agent":
              request.headers.get("x-forwarded-user-agent") ||
              request.headers.get("user-agent") ||
              "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.0.0 Safari/537.36"
          },
          redirect: "follow"
        });
      } else {
        response = await fetchMedia(upstreamUrl, request);

        if (response.status === 403) {
          const relayUrl = new URL("https://flixer-jw67.onrender.com/__media_proxy__");
          relayUrl.searchParams.set("url", upstreamUrl.toString());
          response = await fetch(relayUrl.toString(), {
            method: "GET",
            headers: {
              accept:
                request.headers.get("accept") ||
                "application/vnd.apple.mpegurl,application/x-mpegURL,application/json;q=0.9,text/plain;q=0.8,*/*;q=0.7",
              "accept-language": request.headers.get("accept-language") || "en-US,en;q=0.9",
              "user-agent":
                request.headers.get("x-forwarded-user-agent") ||
                request.headers.get("user-agent") ||
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.0.0 Safari/537.36"
            },
            redirect: "follow"
          });
        }
      }

      if (response.status === 429) {
        return buildResponse(response, await response.arrayBuffer(), {
          "Cache-Control": "no-store",
          "x-media-rate-limited": "true"
        });
      }

      const bodyBuffer = await response.arrayBuffer();

      if (response.status >= 400) {
        return buildResponse(response, bodyBuffer, {
          "Cache-Control": "no-store"
        });
      }

      const bodyText = new TextDecoder().decode(bodyBuffer);
      if (isLikelyHlsManifest(upstreamUrl, response.headers, bodyText)) {
        const manifestBody = rewriteManifestBody(bodyText, upstreamUrl, request);
        return new Response(manifestBody, {
          status: 200,
          headers: new Headers({
            "Access-Control-Allow-Origin": "*",
            "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
            "Access-Control-Allow-Headers": "*",
            "Cache-Control": "no-store",
            "Content-Type":
              response.headers.get("content-type") || "application/vnd.apple.mpegurl"
          })
        });
      }

      return buildResponse(response, bodyBuffer, {
        "Cache-Control": "public, max-age=300, immutable"
      });
    } catch (error) {
      return jsonResponse({ error: error.message }, 500);
    }
  }

  try {
    const requestBody = ["GET", "HEAD"].includes(requestMethod)
      ? undefined
      : await request.arrayBuffer();
    const upstreamAttempts = path.startsWith("/auth/")
      ? [
          {
            hostType: "main",
            url: getApiHostUrl(`/api${path}`, requestUrl.search)
          },
          {
            hostType: "target",
            url: getTargetApiUrl(`/api${path}`, requestUrl.search)
          }
        ]
      : [
          {
            hostType: "target",
            url: getTargetApiUrl(`/api${path}`, requestUrl.search)
          },
          ...((path.startsWith("/tmdb/") || path.startsWith("/content/"))
            ? [
                {
                  hostType: "main",
                  url: getApiHostUrl(`/api${path}`, requestUrl.search)
                },
                {
                  hostType: "main",
                  url: getMainSiteUrl(`/api${path}`, requestUrl.search)
                }
              ]
            : [])
        ];

    let response = null;

    for (let index = 0; index < upstreamAttempts.length; index += 1) {
      const upstreamAttempt = upstreamAttempts[index];
      response = await forwardToUpstream(request, upstreamAttempt.url, {
        hostType: upstreamAttempt.hostType,
        body: requestBody
      });

      if (response.status !== 404) {
        break;
      }
    }

    return buildResponse(response, await response.arrayBuffer());
  } catch (error) {
    return jsonResponse({ error: error.message }, 500);
  }
}
