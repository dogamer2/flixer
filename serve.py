from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path


ROOT = Path(__file__).resolve().parent
HOST = "0.0.0.0"
PORT = 3000


class SPARequestHandler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT), **kwargs)

    def end_headers(self):
        self.send_header("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0")
        self.send_header("Pragma", "no-cache")
        self.send_header("Expires", "0")
        super().end_headers()

    def do_GET(self):
        if self.path.startswith("/api/"):
            return super().do_GET()

        path_only = self.path.split("?", 1)[0].split("#", 1)[0]
        candidate = ROOT / path_only.lstrip("/")

        if path_only in ("/", "") or candidate.exists():
            return super().do_GET()

        self.path = "/index.html"
        return super().do_GET()


if __name__ == "__main__":
    server = ThreadingHTTPServer((HOST, PORT), SPARequestHandler)
    print(f"Serving SPA at http://{HOST}:{PORT}")
    server.serve_forever()
