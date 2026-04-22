from .client import ACRClient, ACRError
from .pop import (
    AgentKeypair,
    generate_agent_keypair,
    sign_registration_request,
    verify_registration_signature,
)

__all__ = [
    "ACRClient",
    "ACRError",
    "AgentKeypair",
    "generate_agent_keypair",
    "sign_registration_request",
    "verify_registration_signature",
]
__version__ = "0.4.0"
