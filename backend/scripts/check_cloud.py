"""Read-only Qdrant Cloud connection check; never prints the API key."""

from __future__ import annotations

from dotenv import load_dotenv
import os
from urllib.parse import urlparse

from qdrant_client import QdrantClient


def main():
    load_dotenv()
    url = os.getenv("QDRANT_URL", "")
    key = os.getenv("QDRANT_API_KEY", "")
    parsed = urlparse(url)
    if parsed.scheme != "https" or not parsed.hostname or not key:
        raise SystemExit("Set HTTPS QDRANT_URL and QDRANT_API_KEY in .env on the central node")
    client = QdrantClient(url=url, api_key=key, timeout=10)
    try:
        collections = client.get_collections().collections
        print(f"Connected to Qdrant Cloud; {len(collections)} collection(s) visible")
    finally:
        client.close()


if __name__ == "__main__":
    main()
