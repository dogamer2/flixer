import {
  buildResponse,
  fetchMedia,
  getWorkerHeaders,
  isHlsManifestCandidate,
  isLikelyHlsManifest,
  rewriteManifestBody,
  textResponse
} from "./_shared/proxy.js";

export async function onRequest(context) {
  const { request } = context;

  if (request.method === "OPTIONS") {
    return textResponse("", 204);
  }

  const requestUrl = new URL(request.url);
  const rawTargetUrl = requestUrl.searchParams.get("url") || "";

  if (!rawTargetUrl) {
    return textResponse("Missing media url", 400);
  }

  let upstreamUrl;
  try {
    upstreamUrl = new URL(rawTargetUrl);
  } catch {
    return textResponse("Invalid media url", 400);
  }

  try {
    const response = await fetchMedia(upstreamUrl, request);
    const bodyBuffer = await response.arrayBuffer();
    const previewText = new TextDecoder().decode(bodyBuffer.slice(0, Math.min(bodyBuffer.byteLength, 2048)));

    if (!response.ok) {
      return buildResponse(response, bodyBuffer, getWorkerHeaders());
    }

    if (isLikelyHlsManifest(upstreamUrl, response.headers, previewText)) {
      const fullText = new TextDecoder().decode(bodyBuffer);
      const rewrittenBody = rewriteManifestBody(fullText, upstreamUrl, request);
      return buildResponse(response, rewrittenBody, {
        "Content-Type": "application/vnd.apple.mpegurl; charset=utf-8",
        ...getWorkerHeaders()
      });
    }

    if (isHlsManifestCandidate(upstreamUrl, response.headers)) {
      return textResponse("Invalid HLS manifest", 502, getWorkerHeaders());
    }

    return buildResponse(response, bodyBuffer, getWorkerHeaders());
  } catch (error) {
    return textResponse(JSON.stringify({ error: error.message }), 500, {
      "Content-Type": "application/json; charset=utf-8"
    });
  }
}
