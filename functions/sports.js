export async function onRequestGet(context) {
  const requestUrl = new URL(context.request.url);
  const targetUrl = new URL("/sports/index.html", requestUrl.origin);

  const response = await fetch(targetUrl.toString(), {
    headers: {
      accept: "text/html,application/xhtml+xml"
    }
  });

  const html = await response.text();

  return new Response(html, {
    status: response.status,
    headers: {
      "Cache-Control": "no-store",
      "Content-Type": "text/html; charset=utf-8"
    }
  });
}
