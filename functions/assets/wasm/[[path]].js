import { buildResponse, getUpstreamAssetUrl, textResponse } from "../../_shared/proxy.js";

export async function onRequest(context) {
  const { request, params } = context;
  const requestUrl = new URL(request.url);

  if (request.method === "OPTIONS") {
    return textResponse("", 204);
  }

  const relativePath = params.path || "";
  if (!relativePath) {
    return textResponse("Missing asset path", 400);
  }

  const upstreamUrl = getUpstreamAssetUrl(`/assets/wasm/${relativePath}`);
  upstreamUrl.search = requestUrl.search;

  try {
    const response = await fetch(upstreamUrl.toString(), {
      method: "GET",
      headers: {
        accept: request.headers.get("accept") || "*/*",
        referer: "https://flixer.su/",
        origin: "https://flixer.su",
        "sec-fetch-site": "same-site"
      },
      redirect: "follow"
    });

    return buildResponse(response, await response.arrayBuffer(), {
      "Cache-Control": "no-store"
    });
  } catch (error) {
    return textResponse(JSON.stringify({ error: error.message }), 500, {
      "Content-Type": "application/json; charset=utf-8"
    });
  }
}
