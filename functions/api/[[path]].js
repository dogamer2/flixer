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

export async function onRequest(context) {
  const { request, params } = context;
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

    const upstreamUrl = getMainSiteUrl("/api/subtitle", `?url=${encodeURIComponent(subtitleUrl)}`);

    try {
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

      for (const params of candidates) {
        const upstreamUrl = new URL("https://sub.wyzie.io/search");
        upstreamUrl.search = params.toString();

        const response = await fetch(upstreamUrl.toString(), {
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
        });

        if (response.status < 400) {
          return buildResponse(response, await response.arrayBuffer(), {
            "Content-Type": response.headers.get("content-type") || "application/json; charset=utf-8",
            "Cache-Control": "no-store"
          });
        }
      }

      return new Response("[]", {
        status: 200,
        headers: new Headers({
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
          "Access-Control-Allow-Headers": "*",
          "Cache-Control": "no-store",
          "Content-Type": "application/json; charset=utf-8"
        })
      });
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
