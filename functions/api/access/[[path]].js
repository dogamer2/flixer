import {
  appendClearAccessCookieHeaders,
  appendSessionCookieHeader,
  jsonResponse,
  redeemAccessCode,
  textResponse,
  validateAccessSession,
} from "../../_shared/access.js";

export async function onRequest(context) {
  const { request, params, env } = context;
  const path = `/${params.path || ""}`;

  if (request.method === "OPTIONS") {
    return textResponse("", 204, {
      "access-control-allow-headers": "content-type",
      "access-control-allow-methods": "GET, POST, OPTIONS",
      "access-control-allow-origin": new URL(request.url).origin,
    });
  }

  if (path === "/redeem" && request.method === "POST") {
    let body;

    try {
      body = await request.json();
    } catch (_error) {
      return jsonResponse({ error: "Invalid JSON body" }, 400);
    }

    const code = String(body?.code || "").trim();

    if (!code) {
      return jsonResponse({ error: "Access code is required" }, 400);
    }

    let redeemedSession;

    try {
      redeemedSession = await redeemAccessCode(env, request, code);
    } catch (error) {
      return jsonResponse(
        { error: error instanceof Error ? error.message : "Failed to verify access code" },
        503,
      );
    }

    if (!redeemedSession) {
      return jsonResponse({ error: "Invalid or expired access code" }, 401);
    }

    const headers = new Headers({
      "cache-control": "no-store",
      "content-type": "application/json; charset=utf-8",
    });
    const maxAgeSeconds = Math.max(0, redeemedSession.expiresAt - Math.floor(Date.now() / 1000));

    appendSessionCookieHeader(headers, request, redeemedSession.sessionToken, maxAgeSeconds);

    return new Response(
      JSON.stringify({
        expiresAt: redeemedSession.expiresAt,
        ok: true,
      }),
      {
        status: 200,
        headers,
      },
    );
  }

  if (path === "/status" && request.method === "GET") {
    try {
      const sessionState = await validateAccessSession(env, request);
      if (!sessionState.authorized && sessionState.shouldClear) {
        const headers = new Headers({
          "cache-control": "no-store",
          "content-type": "application/json; charset=utf-8",
        });

        appendClearAccessCookieHeaders(headers, request);

        return new Response(
          JSON.stringify({ authorized: false }),
          {
            status: 200,
            headers,
          },
        );
      }

      return jsonResponse({ authorized: !!sessionState.authorized }, 200);
    } catch (error) {
      return jsonResponse(
        { error: error instanceof Error ? error.message : "Access gate misconfigured" },
        503,
      );
    }
  }

  if (path === "/logout" && request.method === "POST") {
    const headers = new Headers({
      "cache-control": "no-store",
      "content-type": "application/json; charset=utf-8",
    });

    appendClearAccessCookieHeaders(headers, request);

    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers,
    });
  }

  return jsonResponse({ error: "Not found" }, 404);
}
