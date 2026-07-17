"""Tests for the _allowed_origins() CORS helper in app/main.py."""

from __future__ import annotations

import pytest

from app.main import _allowed_origins, _LOCALHOST_DEFAULTS


class TestAllowedOrigins:
    def test_no_env_returns_localhost_defaults(self) -> None:
        """With no env value the result is exactly the localhost defaults."""
        result = _allowed_origins(None)
        assert result == _LOCALHOST_DEFAULTS

    def test_empty_string_returns_localhost_defaults(self) -> None:
        result = _allowed_origins("")
        assert result == _LOCALHOST_DEFAULTS

    def test_env_with_two_origins_includes_all_plus_localhost(self) -> None:
        """Env-provided origins are merged with localhost defaults."""
        env = "https://willbuild.nmarkel.workers.dev,https://example.com"
        result = _allowed_origins(env)
        assert "http://localhost:5173" in result
        assert "http://localhost:5174" in result
        assert "https://willbuild.nmarkel.workers.dev" in result
        assert "https://example.com" in result
        assert len(result) == 4

    def test_no_duplicates_when_env_repeats_localhost(self) -> None:
        """If env repeats a localhost default, result stays de-duplicated."""
        env = "http://localhost:5173,https://prod.example.com"
        result = _allowed_origins(env)
        assert result.count("http://localhost:5173") == 1
        assert "https://prod.example.com" in result

    def test_whitespace_stripped_from_env(self) -> None:
        """Whitespace around commas is stripped; empty entries are ignored."""
        env = "  https://a.example.com , , https://b.example.com  "
        result = _allowed_origins(env)
        assert "https://a.example.com" in result
        assert "https://b.example.com" in result
        # Only the two extra origins + 2 localhost defaults
        assert len(result) == 4

    def test_order_localhost_first(self) -> None:
        """Localhost defaults always appear before env-provided origins."""
        env = "https://willbuild.nmarkel.workers.dev"
        result = _allowed_origins(env)
        assert result[0] == "http://localhost:5173"
        assert result[1] == "http://localhost:5174"
