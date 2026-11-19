"""
Safe download of routine files from department websites.

Guards against SSRF: HTTPS only, host must be on the allow-list, every
resolved address must be public, redirects are re-checked, size and time limited.
"""
from __future__ import annotations

import ipaddress
import os
import socket
from urllib.parse import urljoin, urlparse

import httpx

MAX_BYTES = 10 * 1024 * 1024
DEFAULT_ALLOWED = "daffodilvarsity.edu.bd,diu.edu.bd"


class FetchError(ValueError):
    pass


def allowed_hosts() -> list[str]:
    return [h.strip().lower() for h in os.environ.get("ALLOWED_FETCH_HOSTS", DEFAULT_ALLOWED).split(",") if h.strip()]


def check_url(url: str, resolve=socket.getaddrinfo) -> str:
    p = urlparse(url)
    if p.scheme != "https":
        raise FetchError("Only https:// links are allowed")
    host = (p.hostname or "").lower()
    if not host or not any(host == a or host.endswith("." + a) for a in allowed_hosts()):
        raise FetchError(f"Host {host!r} is not on the allowed list")
    try:
        infos = resolve(host, p.port or 443)
    except OSError as e:
        raise FetchError(f"Cannot resolve {host}") from e
    for info in infos:
        ip = ipaddress.ip_address(info[4][0])
        if ip.is_private or ip.is_loopback or ip.is_link_local or ip.is_reserved or ip.is_multicast or ip.is_unspecified:
            raise FetchError("Link points to a private address")
    return url


def fetch(url: str) -> tuple[str, bytes]:
    """Returns (file name with extension, bytes)."""
    current = check_url(url)
    with httpx.Client(timeout=20.0, follow_redirects=False, headers={"user-agent": "DIU-Transport-RoutineSync/1.0"}) as client:
        for _ in range(4):
            with client.stream("GET", current) as resp:
                if resp.status_code in (301, 302, 303, 307, 308):
                    current = check_url(urljoin(current, resp.headers.get("location", "")))
                    continue
                if resp.status_code != 200:
                    raise FetchError(f"Download failed with HTTP {resp.status_code}")
                chunks, size = [], 0
                for chunk in resp.iter_bytes():
                    size += len(chunk)
                    if size > MAX_BYTES:
                        raise FetchError("File is larger than 10 MB")
                    chunks.append(chunk)
                ctype = resp.headers.get("content-type", "").lower()
                path = urlparse(current).path.lower()
                ext = next((e for e in (".pdf", ".xlsx", ".csv", ".html", ".htm") if path.endswith(e)), None)
                if not ext:
                    ext = ".pdf" if "pdf" in ctype else ".xlsx" if "spreadsheet" in ctype else ".csv" if "csv" in ctype else ".html"
                return f"routine{ext}", b"".join(chunks)
    raise FetchError("Too many redirects")
