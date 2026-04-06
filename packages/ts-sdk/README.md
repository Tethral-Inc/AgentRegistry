# @tethral/acr-sdk

Zero-dependency TypeScript SDK for the [ACR](https://acr.nfkey.ai) (Agent Composition Records) network.

## Install

```bash
npm install @tethral/acr-sdk
```

## Quick Start

```typescript
import { ACRClient } from '@tethral/acr-sdk';

const acr = new ACRClient();

// Register
const { agent_id } = await acr.register({
  public_key: 'your-unique-key-at-least-32-chars-long',
  provider_class: 'anthropic',
});

// Log an interaction
await acr.submitReceipt({
  emitter: { agent_id, provider_class: 'anthropic' },
  target: { system_id: 'mcp:github', system_type: 'mcp_server' },
  interaction: {
    category: 'tool_call', status: 'success',
    duration_ms: 1200, request_timestamp_ms: Date.now() - 1200,
  },
  anomaly: { flagged: false },
});

// See what's costing you the most
const report = await acr.getFrictionReport(agent_id, 'day');
```

## API

| Method | Description |
|--------|-------------|
| `register(request)` | Register an agent, get JWT credential |
| `submitReceipt(receipt)` | Submit a single interaction receipt |
| `submitReceipts(receipts)` | Submit a batch (max 50) |
| `updateComposition(agentId, composition)` | Update skill composition |
| `checkSkill(hash)` | Check a skill hash before installing |
| `checkAgent(agentId)` | Look up an agent |
| `getSystemHealth(systemId)` | Get system health status |
| `getActiveThreats()` | Get current threat alerts |
| `getFrictionReport(agentId, scope)` | Friction analysis report |
| `getHealth()` | API health check |

## Exported Types

`RegistrationRequest`, `RegistrationResponse`, `InteractionReceipt`, `SkillCheckResponse`, `FrictionReport`, `ProviderClass`, `TargetSystemType`, `InteractionCategory`, `InteractionStatus`, `AnomalyCategory`, `ThreatLevel`, `FrictionSummary`, `TargetFriction`

## Data Collection

ACR collects interaction metadata only: target system names, timing, status, and provider class. No request/response content, API keys, prompts, or PII is collected. [Full terms](https://acr.nfkey.ai/terms).

## License

MIT
