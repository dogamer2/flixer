import {
  appendClearAccessCookieHeaders,
  htmlResponse,
  isHtmlNavigationRequest,
  jsonResponse,
  renderAccessGatePage,
  shouldBypassAccessGate,
  validateAccessSession,
} from "./_shared/access.js";
import { maybeSyncDiscordStatus } from "./_shared/discord-status.js";

export async function onRequest(context) {
  const { request, env, next } = context;
  const syncPromise = maybeSyncDiscordStatus(env, request);

  if (syncPromise && typeof context.waitUntil === "function") {
    context.waitUntil(syncPromise);
  }

  if (shouldBypassAccessGate(request)) {
    return next();
  }

  let sessionState;

  try {
    sessionState = await validateAccessSession(env, request);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Access gate misconfigured";

    if (isHtmlNavigationRequest(request)) {
      return htmlResponse(
        renderAccessGatePage(request, {
          description: `${message}. Set ACCESS_GATE_SECRET before using the site gate.`,
          title: "Gate Setup Required",
        }),
        503,
      );
    }

    return jsonResponse(
      {
        error: message,
      },
      503,
    );
  }

  if (sessionState.authorized) {
    return next();
  }

  const headers = new Headers();

  if (sessionState.shouldClear) {
    appendClearAccessCookieHeaders(headers, request);
  }

  if (isHtmlNavigationRequest(request)) {
    const response = htmlResponse(renderAccessGatePage(request), 401);

    for (const [name, value] of headers.entries()) {
      response.headers.append(name, value);
    }

    return response;
  }

  headers.set("cache-control", "no-store");
  headers.set("content-type", "application/json; charset=utf-8");

  return new Response(
    JSON.stringify({
      error: "Access code required",
    }),
    {
      status: 401,
      headers,
    },
  );
}
