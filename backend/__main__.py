"""Start a loopback-only development service.

The access token stays the same across restarts: it is read from CANDEX_API_KEY, else from
CANDEX_API_KEY_FILE, else from ~/candex-data/.candex-token (created once, readable only by you).
Set CANDEX_EPHEMERAL_TOKEN=1 for a new random token each start instead.
"""
import os
import secrets
import socket

import uvicorn


def token_from_file(path):
    """A token that survives restarts: read it from a private file, creating it once if missing."""
    path = os.path.expanduser(path)
    os.makedirs(os.path.dirname(path) or ".", mode=0o700, exist_ok=True)
    if not os.path.exists(path):
        fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        with os.fdopen(fd, "w") as fh:
            fh.write(secrets.token_urlsafe(32) + "\n")
        print(f"Created a persistent backend token in {path} (readable only by you).", flush=True)
    if os.stat(path).st_mode & 0o077:
        raise SystemExit(f"{path} must be readable only by you: run chmod 600 {path}")
    with open(path) as fh:
        return fh.read().strip()


DEFAULT_TOKEN_FILE = "~/candex-data/.candex-token"
HOST, PORT = "127.0.0.1", 8000


def port_in_use(host=HOST, port=PORT):
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.settimeout(0.5)
        return s.connect_ex((host, port)) == 0


def main():
    # A second start would print a token for a server that never runs: stop before that.
    if port_in_use():
        raise SystemExit(f"A Candex backend is already running on http://{HOST}:{PORT}. Use the token in "
                         f"{os.getenv('CANDEX_API_KEY_FILE') or DEFAULT_TOKEN_FILE} (see it with: cat {os.getenv('CANDEX_API_KEY_FILE') or DEFAULT_TOKEN_FILE}). "
                         "To restart, stop the running backend first (Ctrl+C in its terminal).")
    # Hosted (Render): the disk is wiped on every restart, so a token file would change unseen.
    # There, set CANDEX_API_KEY in the service's environment; without it a temporary token is printed to the log.
    hosted = bool(os.getenv("RENDER"))
    if hosted and not os.getenv("CANDEX_API_KEY"):
        print("WARNING: CANDEX_API_KEY is not set, so the token changes on every restart (Render restarts idle free services). "
              "Set CANDEX_API_KEY (24+ characters) in Render → your service → Environment.", flush=True)
    if not hosted and not os.getenv("CANDEX_API_KEY") and not os.getenv("CANDEX_EPHEMERAL_TOKEN"):
        os.environ.setdefault("CANDEX_API_KEY_FILE", DEFAULT_TOKEN_FILE)
    if os.getenv("CANDEX_API_KEY_FILE") and not os.getenv("CANDEX_API_KEY"):
        os.environ["CANDEX_API_KEY"] = token_from_file(os.environ["CANDEX_API_KEY_FILE"])
    token = os.getenv("CANDEX_API_KEY", "")
    if token and (len(token) < 24 or not token.isascii() or any(c.isspace() for c in token)):
        raise SystemExit("CANDEX_API_KEY must contain at least 24 non-whitespace ASCII characters.")
    if not token:
        token = secrets.token_urlsafe(32)
        os.environ["CANDEX_API_KEY"] = token
        print("\nCandex local research service — http://127.0.0.1:8000/#care/dicom", flush=True)
        print("Copy this temporary token into the Doctor DICOM token field:", flush=True)
        print(token, flush=True)
        print("The token changes each restart. It is not saved to a file.\n", flush=True)
    else:
        src = f"the token in {os.environ['CANDEX_API_KEY_FILE']}" if os.getenv("CANDEX_API_KEY_FILE") else "your configured CANDEX_API_KEY"
        print(f"Candex local research service — http://127.0.0.1:8000/#care/dicom\nUse {src} in the Doctor DICOM and Clinical agent token fields. It stays the same across restarts.", flush=True)
    from .agent import gemini_key, CHAT_MODEL, VISION_MODEL
    print(f"Clinical agent: live AI {'on (' + CHAT_MODEL + ', CT: ' + VISION_MODEL + ')' if gemini_key() else 'off — set GEMINI_API_KEY or CANDEX_GEMINI_KEY_FILE'}.", flush=True)
    print("Only this computer can connect. Keep this terminal open; press Ctrl+C to stop.", flush=True)
    uvicorn.run("backend.app:app", host=HOST, port=PORT, access_log=False)


if __name__ == "__main__":
    main()
