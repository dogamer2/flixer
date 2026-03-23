import {
  forwardToUpstream,
  getTargetApiUrl,
  jsonResponse,
  textResponse,
} from "../_shared/proxy.js";

const SITE_HOSTNAME = "flixercc.pages.dev";
const STATUS_CHECK_USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.0.0 Safari/537.36";

export async function onRequest(context) {
  const { request } = context;

  if (request.method === "OPTIONS") {
    return textResponse("", 204);
  }

  if (!["GET", "HEAD"].includes(request.method.toUpperCase())) {
    return textResponse("Method not allowed", 405);
  }

  const upstreamUrl = getTargetApiUrl("/api/time", "");
  const checkedAt = new Date().toISOString();

  try {
    const upstreamResponse = await forwardToUpstream(request, upstreamUrl, {
      hostType: "target",
      headers: {
        accept: "application/json, text/plain, */*",
        "accept-language": "en-US,en;q=0.9",
        "cache-control": "no-cache",
        pragma: "no-cache",
        "sec-ch-ua": '"Chromium";v="134", "Google Chrome";v="134", "Not:A-Brand";v="24"',
        "sec-ch-ua-mobile": "?0",
        "sec-ch-ua-platform": '"Windows"',
        "user-agent": STATUS_CHECK_USER_AGENT,
      },
    });

    const isActive = upstreamResponse.ok;

    return jsonResponse(
      {
        checkedAt,
        site: SITE_HOSTNAME,
        status: isActive ? "active" : "offline",
        upstream: {
          status: upstreamResponse.status,
          url: upstreamUrl.toString(),
        },
      },
      isActive ? 200 : 503,
    );
  } catch (error) {
    return jsonResponse(
      {
        checkedAt,
        error: error instanceof Error ? error.message : "Unknown status check failure",
        site: SITE_HOSTNAME,
        status: "offline",
        upstream: {
          url: upstreamUrl.toString(),
        },
      },
      503,
    );
  }
}
