"""Local preview server that disables caching, so edits show on reload.

Run: python tools/serve.py   (then open http://localhost:5500)
"""
import functools
import http.server
from pathlib import Path


class NoCacheHandler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()


root = Path(__file__).resolve().parent.parent
handler = functools.partial(NoCacheHandler, directory=str(root))
http.server.ThreadingHTTPServer(("", 5500), handler).serve_forever()
