export async function onRequestGet(context) {
  const requestUrl = new URL(context.request.url);
  const targetUrl = new URL("/sports/index.html", requestUrl.origin);
  const response = await fetch(targetUrl.toString(), {
    headers: {
      accept: "text/html,application/xhtml+xml"
    }
  });

  let html = await response.text();
  html = html.replace(
    /<head>/i,
    `<head>\n  <base href="/sports/">\n  <style>.flixer-back-link{display:inline-flex;align-items:center;justify-content:center;padding:10px 14px;border-radius:999px;color:#fff;text-decoration:none;border:1px solid rgba(255,255,255,0.12);background:rgba(255,255,255,0.04);font-family:Inter,system-ui,sans-serif}.flixer-back-wrap{max-width:1280px;margin:12px auto 0;padding:0 16px}</style>`
  );

  if (!html.includes("Back To Flixer")) {
    html = html.replace(
      /<\/header>/i,
      `</header>\n<div class="flixer-back-wrap"><a class="flixer-back-link" href="/">Back To Flixer</a></div>`
    );
  }

  return new Response(html, {
    status: response.status,
    headers: {
      "Cache-Control": "no-store",
      "Content-Type": "text/html; charset=utf-8"
    }
  });
}
