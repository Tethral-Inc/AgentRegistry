"""Client-side proof-of-possession helpers for /register.

Mirrors the client-facing surface of the server's ``shared/crypto/pop.ts``.
The canonical specification lives there — keep the two in lockstep.

Public-key and signature wire format:
    - public_key: base64url-encoded raw 32-byte Ed25519 public key (43 chars)
    - signature:  base64url-encoded raw 64-byte Ed25519 signature  (86 chars)

Signed payload: ``register:v1:{public_key}:{timestamp_ms}``.
"""

from __future__ import annotations

import base64
import re
import time
from dataclasses import dataclass
from typing import Any

from cryptography.hazmat.primitives.asymmetric.ed25519 import (
    Ed25519PrivateKey,
    Ed25519PublicKey,
)
from cryptography.hazmat.primitives.serialization import (
    Encoding,
    NoEncryption,
    PrivateFormat,
    PublicFormat,
)

# Must match server POP_VERSION.
POP_VERSION = "v1"
POP_PUBLIC_KEY_REGEX = re.compile(r"^[A-Za-z0-9_\-]{43}$")


@dataclass(frozen=True)
class AgentKeypair:
    """base64url-encoded Ed25519 keypair (raw 32-byte values)."""

    public_key: str
    private_key: str


def _b64url_encode(raw: bytes) -> str:
    return base64.urlsafe_b64encode(raw).rstrip(b"=").decode("ascii")


def _b64url_decode(s: str) -> bytes:
    # Re-pad to a multiple of 4 before base64 decoding.
    padding = (-len(s)) % 4
    return base64.urlsafe_b64decode(s + "=" * padding)


def generate_agent_keypair() -> AgentKeypair:
    """Generate a fresh Ed25519 keypair as base64url raw-byte strings."""
    priv = Ed25519PrivateKey.generate()
    priv_raw = priv.private_bytes(
        encoding=Encoding.Raw,
        format=PrivateFormat.Raw,
        encryption_algorithm=NoEncryption(),
    )
    pub_raw = priv.public_key().public_bytes(
        encoding=Encoding.Raw,
        format=PublicFormat.Raw,
    )
    return AgentKeypair(
        public_key=_b64url_encode(pub_raw),
        private_key=_b64url_encode(priv_raw),
    )


def canonical_registration_message(public_key: str, timestamp_ms: int) -> str:
    return f"register:{POP_VERSION}:{public_key}:{timestamp_ms}"


def sign_registration_request(
    unsigned: dict[str, Any],
    keypair: AgentKeypair,
    now_ms: int | None = None,
) -> dict[str, Any]:
    """Return a new dict with public_key, registration_timestamp_ms, signature set.

    The keypair's public_key wins over any value in ``unsigned`` — the
    signature only validates against the key that actually signed it,
    so keeping them in sync here avoids a confusing 401 at call time.
    """
    if not POP_PUBLIC_KEY_REGEX.match(keypair.public_key):
        raise ValueError(
            "public_key must be base64url-encoded raw Ed25519 key (43 chars)",
        )
    if now_ms is None:
        now_ms = int(time.time() * 1000)

    priv = Ed25519PrivateKey.from_private_bytes(_b64url_decode(keypair.private_key))
    message = canonical_registration_message(keypair.public_key, now_ms).encode("utf-8")
    sig = priv.sign(message)

    signed = dict(unsigned)
    signed["public_key"] = keypair.public_key
    signed["registration_timestamp_ms"] = now_ms
    signed["signature"] = _b64url_encode(sig)
    return signed


def verify_registration_signature(
    public_key: str,
    timestamp_ms: int,
    signature: str,
) -> bool:
    """Verify a signature against the public key. Used mostly by tests."""
    try:
        if not POP_PUBLIC_KEY_REGEX.match(public_key):
            return False
        pub = Ed25519PublicKey.from_public_bytes(_b64url_decode(public_key))
        message = canonical_registration_message(public_key, timestamp_ms).encode("utf-8")
        pub.verify(_b64url_decode(signature), message)
        return True
    except Exception:
        return False
