"""In-memory LRU cache with TTL for high-performance caching.
Falls back gracefully if Redis is not available."""

import time
import json
import hashlib
from collections import OrderedDict
from threading import Lock
from functools import wraps
from typing import Any
from app.config import get_settings

settings = get_settings()

_redis_client = None
_redis_available = False


def _get_redis():
    global _redis_client, _redis_available
    if _redis_client is not None:
        return _redis_client if _redis_available else None
    try:
        import redis
        _redis_client = redis.from_url(settings.REDIS_URL, decode_responses=True, socket_timeout=1)
        _redis_client.ping()
        _redis_available = True
        return _redis_client
    except Exception:
        _redis_available = False
        _redis_client = True  # sentinel to avoid retrying
        return None


class LRUCache:
    """Thread-safe LRU cache with TTL."""

    def __init__(self, maxsize: int = 1024):
        self._cache: OrderedDict[str, tuple[Any, float]] = OrderedDict()
        self._maxsize = maxsize
        self._lock = Lock()

    def get(self, key: str) -> Any | None:
        with self._lock:
            if key not in self._cache:
                return None
            value, expire_at = self._cache[key]
            if expire_at and time.time() > expire_at:
                del self._cache[key]
                return None
            self._cache.move_to_end(key)
            return value

    def set(self, key: str, value: Any, ttl: int | None = None):
        with self._lock:
            expire_at = (time.time() + ttl) if ttl else None
            if key in self._cache:
                self._cache.move_to_end(key)
            self._cache[key] = (value, expire_at)
            while len(self._cache) > self._maxsize:
                self._cache.popitem(last=False)

    def delete(self, key: str):
        with self._lock:
            self._cache.pop(key, None)

    def clear(self):
        with self._lock:
            self._cache.clear()


_local_cache = LRUCache(maxsize=2048)


def cache_get(key: str) -> Any | None:
    r = _get_redis()
    if r:
        try:
            val = r.get(key)
            return json.loads(val) if val else None
        except Exception:
            pass
    return _local_cache.get(key)


def cache_set(key: str, value: Any, ttl: int | None = None):
    ttl = ttl or settings.CACHE_TTL
    r = _get_redis()
    if r:
        try:
            r.setex(key, ttl, json.dumps(value, default=str))
            return
        except Exception:
            pass
    _local_cache.set(key, value, ttl)


def cache_delete(key: str):
    r = _get_redis()
    if r:
        try:
            r.delete(key)
        except Exception:
            pass
    _local_cache.delete(key)


def cache_clear_prefix(prefix: str):
    r = _get_redis()
    if r:
        try:
            keys = r.keys(f"{prefix}*")
            if keys:
                r.delete(*keys)
        except Exception:
            pass
    _local_cache.clear()


def make_cache_key(*args) -> str:
    raw = ":".join(str(a) for a in args)
    return hashlib.md5(raw.encode()).hexdigest()


def cached(prefix: str, ttl: int | None = None):
    """Decorator for caching function results."""
    def decorator(func):
        @wraps(func)
        def wrapper(*args, **kwargs):
            key = f"{prefix}:{make_cache_key(*args, *kwargs.values())}"
            result = cache_get(key)
            if result is not None:
                return result
            result = func(*args, **kwargs)
            cache_set(key, result, ttl)
            return result
        return wrapper
    return decorator
