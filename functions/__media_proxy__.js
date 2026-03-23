export async function onRequest(context) {
  if (context.request.method === "OPTIONS") {
    return new Response(null, {
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Headers": "*",
        "Access-Control-Allow-Methods": "GET,HEAD,OPTIONS"
      }
    });
  }

  const reqUrl = new URL(context.request.url);
  const target = reqUrl.searchParams.get("url");

  if (!target) {
    return new Response("Missing url", { status: 400 });
  }

  const upstream = await fetch(target, {
    method: "GET",
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/122 Safari/537.36",
      Referer: "https://vidsrc.cc/",
      Origin: "https://vidsrc.cc",
      Accept: "*/*",
      "Accept-Language": "en-US,en;q=0.9"
    },
    redirect: "follow",
    cf: {
      cacheTtl: 0,
      cacheEverything: false
    }
  });

  const headers = new Headers(upstream.headers);

  headers.set("Access-Control-Allow-Origin", "*");
  headers.set("Access-Control-Allow-Headers", "*");
  headers.set("Access-Control-Allow-Methods", "GET,HEAD,OPTIONS");

  return new Response(upstream.body, {
    status: upstream.status,
    headers
  });
}
