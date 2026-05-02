"""
Minimal RESP (REdis Serialization Protocol) client over TCP sockets.

Supports LPOP/RPOP for consuming usage event payloads from a Redis-compatible
queue.  Uses only stdlib modules — no external dependencies.

Typical usage::

    client = RESPClient("redis://localhost:6379/0")
    raw = client.lpop("cliproxy:usage_events")
"""

import socket
import logging
from typing import List, Optional
from urllib.parse import urlparse

logger = logging.getLogger(__name__)

_SIMPLE_STRING = b"+"
_ERROR = b"-"
_INTEGER = b":"
_BULK_STRING = b"$"
_ARRAY = b"*"


class RESPError(Exception):
    """Raised when the Redis server returns a RESP error."""


class RESPClient:
    """Lightweight Redis client that speaks RESP over a plain TCP socket."""

    def __init__(self, addr: str, socket_timeout: float = 5.0):
        parsed = urlparse(addr)
        self._host = parsed.hostname or "localhost"
        self._port = parsed.port or 6379
        self._db = int(parsed.path.lstrip("/") or "0")
        self._password = parsed.password
        self._timeout = socket_timeout
        self._sock: Optional[socket.socket] = None
        self._buf = b""

    def connect(self) -> None:
        if self._sock is not None:
            return
        sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        sock.settimeout(self._timeout)
        sock.connect((self._host, self._port))
        self._sock = sock
        self._buf = b""
        if self._password:
            self._send_command(b"AUTH", self._password.encode())
            self._read_response()
        if self._db:
            self._send_command(b"SELECT", str(self._db).encode())
            self._read_response()

    def close(self) -> None:
        if self._sock is not None:
            try:
                self._sock.close()
            except OSError:
                pass
            self._sock = None
            self._buf = b""

    def lpop(self, key: str) -> Optional[bytes]:
        self.connect()
        self._send_command(b"LPOP", key.encode())
        return self._read_response()

    def rpop(self, key: str) -> Optional[bytes]:
        self.connect()
        self._send_command(b"RPOP", key.encode())
        return self._read_response()

    def lpop_batch(self, key: str, count: int) -> List[bytes]:
        """Pop up to *count* items from the head of *key* (Redis 6.2+)."""
        self.connect()
        self._send_command(b"LPOP", key.encode(), str(count).encode())
        result = self._read_response()
        if result is None:
            return []
        if isinstance(result, list):
            return [item for item in result if item is not None]
        return [result]

    def llen(self, key: str) -> int:
        self.connect()
        self._send_command(b"LLEN", key.encode())
        result = self._read_response()
        return int(result) if result is not None else 0

    def ping(self) -> bool:
        try:
            self.connect()
            self._send_command(b"PING")
            resp = self._read_response()
            return resp in (b"PONG", b"pong")
        except Exception:
            return False

    def _send_command(self, *args: bytes) -> None:
        parts = [b"*" + str(len(args)).encode() + b"\r\n"]
        for arg in args:
            parts.append(b"$" + str(len(arg)).encode() + b"\r\n")
            parts.append(arg + b"\r\n")
        assert self._sock is not None
        self._sock.sendall(b"".join(parts))

    def _recv(self, n: int) -> bytes:
        assert self._sock is not None
        while len(self._buf) < n:
            chunk = self._sock.recv(max(n - len(self._buf), 4096))
            if not chunk:
                raise ConnectionError("Redis connection closed")
            self._buf += chunk
        result = self._buf[:n]
        self._buf = self._buf[n:]
        return result

    def _readline(self) -> bytes:
        assert self._sock is not None
        while b"\r\n" not in self._buf:
            chunk = self._sock.recv(4096)
            if not chunk:
                raise ConnectionError("Redis connection closed")
            self._buf += chunk
        idx = self._buf.index(b"\r\n")
        line = self._buf[:idx]
        self._buf = self._buf[idx + 2:]
        return line

    def _read_response(self):
        line = self._readline()
        prefix = line[:1]
        data = line[1:]

        if prefix == _SIMPLE_STRING:
            return data
        if prefix == _ERROR:
            raise RESPError(data.decode("utf-8", errors="replace"))
        if prefix == _INTEGER:
            return int(data)
        if prefix == _BULK_STRING:
            length = int(data)
            if length == -1:
                return None
            payload = self._recv(length)
            self._recv(2)  # trailing CRLF
            return payload
        if prefix == _ARRAY:
            count = int(data)
            if count == -1:
                return None
            return [self._read_response() for _ in range(count)]
        return line

    def __enter__(self):
        self.connect()
        return self

    def __exit__(self, *exc):
        self.close()
