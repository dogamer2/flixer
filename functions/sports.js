export async function onRequestGet(context) {
  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Flixer Sports</title>
  <style>
    :root {
      color-scheme: dark;
    }
    * {
      box-sizing: border-box;
    }
    body {
      margin: 0;
      min-height: 100vh;
      background: #050505;
      color: #f4f4f5;
      font-family: Inter, system-ui, sans-serif;
    }
    .topbar {
      height: 64px;
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 0 16px;
      border-bottom: 1px solid rgba(255,255,255,0.12);
      background: rgba(10,10,10,0.96);
    }
    .title {
      font-size: 15px;
      font-weight: 600;
    }
    .back {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      padding: 10px 14px;
      border-radius: 999px;
      color: #fff;
      text-decoration: none;
      border: 1px solid rgba(255,255,255,0.12);
      background: rgba(255,255,255,0.04);
    }
    iframe {
      display: block;
      width: 100%;
      height: calc(100vh - 64px);
      border: 0;
      background: #000;
    }
  </style>
</head>
<body>
  <div class="topbar">
    <div class="title">Live Sports</div>
    <a class="back" href="/">Back To Flixer</a>
  </div>
  <iframe src="/mut.st/index.html" referrerpolicy="no-referrer"></iframe>
</body>
</html>`;

  return new Response(html, {
    status: 200,
    headers: {
      "Cache-Control": "no-store",
      "Content-Type": "text/html; charset=utf-8"
    }
  });
}
