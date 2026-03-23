import {
  buildResponse,
  forwardToUpstream,
  getApiHostUrl,
  getMainSiteUrl,
  getTargetApiUrl,
  jsonResponse,
  normalizeSubtitleBody,
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
