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
    const upstreamUrl = new URL("https://sub.wyzie.io/search");
    for (const [key, value] of requestUrl.searchParams.entries()) {
      if (!value || value === "undefined" || value === "null") {
        continue;
      }
      upstreamUrl.searchParams.set(key, value);
    }

    try {
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

      return buildResponse(response, await response.arrayBuffer(), {
        "Content-Type": response.headers.get("content-type") || "application/json; charset=utf-8",
        "Cache-Control": "no-store"
      });
    } catch (error) {
      return jsonResponse({ error: error.message }, 500);
    }
  }

  if (path === "/media") {
    const mediaUrl = requestUrl.searchParams.get("url") || "";

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
      const response = await fetchMedia(upstreamUrl, request);

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
          ...(path.startsWith("/tmdb/")
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
