"""serve.py: local preview server for the Kārumnieki build.

Serves the client folder, so the site is at /site/ and the tools (font test) at /tools/. No caching, correct
types for webp, woff2, svg and mjs. Binds all interfaces so a phone on the same Wi-Fi can open it.
Usage: python serve.py [port]   (default 8477)
       python serve.py 8478 out/dist-test   serve a build (tools/build.py) at /site/; anything not in it, such as
                                            /tools/ for the font test, still comes from the repo
"""
import http.server
import mimetypes
import os
import socketserver
import sys

mimetypes.add_type("image/webp", ".webp")
mimetypes.add_type("font/woff2", ".woff2")
mimetypes.add_type("image/svg+xml", ".svg")
mimetypes.add_type("text/javascript", ".mjs")
mimetypes.add_type("text/javascript", ".js")
mimetypes.add_type("text/css", ".css")
ROOT = os.path.normpath(os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))
PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8477
BUILD = os.path.normpath(os.path.join(ROOT, sys.argv[2])) if len(sys.argv) > 2 else None


class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *a, **k):
        super().__init__(*a, directory=ROOT, **k)

    def translate_path(self, path):
        repo = super().translate_path(path)
        if BUILD:
            built = os.path.join(BUILD, os.path.relpath(repo, ROOT))
            if os.path.exists(built):
                return built
        return repo

    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def log_message(self, *a):
        pass


socketserver.ThreadingTCPServer.allow_reuse_address = True
with socketserver.ThreadingTCPServer(("", PORT), Handler) as srv:
    print("serving", BUILD or ROOT, "on port", PORT, flush=True)
    srv.serve_forever()
