"""Start a loopback-only development service with an ephemeral access token."""
import os
import secrets

import uvicorn


def main():
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
        print("Candex local research service — http://127.0.0.1:8000/#care/dicom\nUse your configured CANDEX_API_KEY in the Doctor DICOM token field.", flush=True)
    print("Only this computer can connect. Keep this terminal open; press Ctrl+C to stop.", flush=True)
    uvicorn.run("backend.app:app", host="127.0.0.1", port=8000, access_log=False)


if __name__ == "__main__":
    main()
