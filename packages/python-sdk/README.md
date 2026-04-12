# tethral-acr

Python SDK for the [ACR](https://acr.nfkey.ai) (Agent Composition Records) network.

## Install

```bash
pip install tethral-acr
```

## Quick Start

```python
from tethral_acr import ACRClient

with ACRClient() as acr:
    # Register
    result = acr.register(
        public_key="your-unique-key-at-least-32-chars-long",
        provider_class="langchain",
    )
    agent_id = result["agent_id"]

    # Log an interaction
    acr.submit_receipt({
        "emitter": {"agent_id": agent_id, "provider_class": "langchain"},
        "target": {"system_id": "api:openai.com", "system_type": "api"},
        "interaction": {
            "category": "tool_call", "status": "success",
            "duration_ms": 800, "request_timestamp_ms": 1711978987442,
        },
        "anomaly": {"flagged": False},
    })

    # See what's costing you the most
    report = acr.get_friction_report(agent_id, scope="day")
```

## API

| Method | Description |
|--------|-------------|
| `register(public_key, provider_class, ...)` | Register an agent |
| `submit_receipt(receipt)` | Submit a single receipt |
| `submit_receipts(receipts)` | Submit a batch (max 50) |
| `update_composition(agent_id, ...)` | Update skill composition |
| `check_skill(skill_hash)` | Check a skill before installing |
| `check_agent(agent_id)` | Look up an agent |
| `get_system_health(system_id)` | Get system health |
| `get_active_signals()` | Get skills with elevated anomaly signals |
| `get_friction_report(agent_id, scope)` | Friction analysis |
| `health()` | API health check |

## Data Collection

ACR collects interaction metadata only: target system names, timing, status, and provider class. No request/response content, API keys, prompts, or PII is collected. [Full terms](https://acr.nfkey.ai/terms).

## License

MIT
