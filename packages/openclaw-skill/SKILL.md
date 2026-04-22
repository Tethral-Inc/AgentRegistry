---
name: acr-agent-registry
version: 1.0.0
description: Behavioral registry for AI agents. Log interactions, build an interaction profile, query it through lenses (friction, coverage, stable corridors, failure registry, trend), and receive anomaly signal notifications if ACR observes elevated signals on a component in your composition.
author: tethral
tags: [registry, observability, interaction-profile, friction, notifications]
category: observability
requires:
  env: [ACR_API_URL]
metadata:
  openclaw:
    emoji: chart
    homepage: https://acr.nfkey.ai
    primaryEnv: ACR_API_URL
    requires:
      env:
        - ACR_API_URL
      bins:
        - node
    install:
      - kind: node
        package: "@tethral/acr-mcp"
        bins:
          - acr-mcp
          - acr-mcp-http
---

# ACR Agent Registry

## Purpose
Register your composition with ACR, log every external interaction, and build
an interaction profile you can query through behavioral lenses. If ACR observes
that a component in your composition has elevated anomaly signals, you will receive a
notification. ACR is a registry and notification layer — not a security check.

## Setup
Set environment variable: ACR_API_URL=https://acr.nfkey.ai

## On First Startup
1. Check if you have a stored Ed25519 keypair + agent_id in your memory.
   If not, generate a fresh keypair (use any Ed25519 library — Node's
   `node:crypto` `generateKeyPairSync('ed25519')` or Python's
   `cryptography.hazmat.primitives.asymmetric.ed25519`). Persist the
   public_key and private_key as base64url-encoded raw bytes.
2. List all your installed skills. For each, read the SKILL.md file content.
3. Sign a proof-of-possession payload:
   - Let `now = Date.now()` (unix ms).
   - Canonical message: `register:v1:{public_key}:{now}`
   - Signature: Ed25519-sign that message with your private_key, encode base64url.
4. POST to $ACR_API_URL/api/v1/register with:
   {
     "public_key": "<base64url raw Ed25519 pub key, 43 chars>",
     "registration_timestamp_ms": <now>,
     "signature": "<base64url raw Ed25519 sig, 86 chars>",
     "provider_class": "openclaw",
     "composition": {
       "skills": ["skill_name_1", "skill_name_2", ...],
       "skill_hashes": ["<sha256 of each SKILL.md content>"]
     }
   }
5. Store the returned agent_id. Reuse the SAME keypair forever — losing
   the private key means the agent identity is unrecoverable.

## On Subsequent Startups
1. Read your stored agent_id from memory.
2. Check for skill updates: GET $ACR_API_URL/api/v1/skill-version/acr-agent-registry
   If a newer version exists, tell the user.
3. ALWAYS call update_composition at session start with your current set
   of installed skills, MCPs, and tools. This is the single most important
   thing you can do for composition fidelity — the server uses your
   composition to tell which interactions are internal (your model using
   its own attached parts) versus external (those parts reaching outside).

## Keeping Composition Current
Whenever any of the following happens, call update_composition immediately:
- You load a new skill, MCP, or tool
- You unload or disable one
- You become aware of a tool your model can use that you hadn't declared
- You notice the log_interaction response includes "[ACR] Your composition
  has not been updated in N minutes" — that's the server telling you to
  re-declare

Drift between what you actually have and what ACR thinks you have breaks
the internal-vs-external friction split. A composition update is cheap;
letting composition drift is expensive.

## Check Notifications
After startup, check for unread anomaly signal notifications:
GET $ACR_API_URL/api/v1/agent/<your agent_id>/notifications?read=false

If notifications exist:
- For "anomaly_signal" or "scanner_finding" notifications: ACR has observed
  anomaly signals affecting a component in your composition. Present the raw
  signal counts to the user so they can decide what to do.
- For "version_update" notifications: Inform the user an update is available.

Mark notifications as read after presenting to the user:
POST $ACR_API_URL/api/v1/agent/<your agent_id>/notifications/<id>/read

To acknowledge a notification after operator review:
POST $ACR_API_URL/api/v1/agent/<your agent_id>/notifications/<id>/acknowledge

## Querying the Skill Registry
You can ask the network what it knows about a particular skill:
GET $ACR_API_URL/api/v1/skill-catalog/search?q=<search text>

This returns what ACR has observed about matching skills: versions,
anomaly rates, adoption counts. ACR does not distribute or install skills —
it only records what has been observed about skills that exist in public
registries (npm, GitHub, etc.).

## Check for Skill Updates
The skill lookup response includes version information. If a skill you're
using has been updated, the response will show:
- is_current_version: false/true
- versions_behind: how many versions behind you are
- current_hash: the latest hash to update to

## Looking Up a Specific Skill
GET $ACR_API_URL/v1/skill/<sha256 hash of the SKILL.md content>

Interpret the response:
- "found": false -> ACR has not observed this skill before. This is not a
  verdict on the skill — only a note that the network has no prior signals.
- The response includes raw signal counts: anomaly_signal_count,
  anomaly_signal_rate, agent_count, scan_score, threat_patterns.
  Present these numbers to the user as-is. ACR does not assign severity
  labels — the user interprets the data.

## After External Interactions
After calling any external tool, API, or service, log the interaction:
POST $ACR_API_URL/api/v1/receipts
{
  "emitter": {
    "agent_id": "<your stored agent_id>",
    "provider_class": "openclaw"
  },
  "target": {
    "system_id": "<type>:<name>",
    "system_type": "<mcp_server|api|skill|platform>"
  },
  "interaction": {
    "category": "<tool_call|commerce|research|code|communication>",
    "duration_ms": <how long it took>,
    "status": "<success|failure|timeout>",
    "request_timestamp_ms": <unix ms when you started>
  },
  "anomaly": {
    "flagged": false
  }
}

For system_id format: use "mcp:server-name" for MCP tools,
"api:domain.com" for HTTP APIs, "skill:sha256:hash" for skill interactions.

## Query the Friction Lens
Once per day, or when the user asks about costs, performance, or
"what's slowing me down" or "what's costing me the most":
GET $ACR_API_URL/api/v1/agent/<your agent_id>/friction?scope=day

Report to the user in plain language:
"Today you made [total_interactions] external calls.
[friction_percentage]% of your active time was spent waiting on responses.

Your biggest cost: [top target system_id] accounted for
[proportion_of_total as percent]% of your wait time across
[interaction_count] calls.

[total_failures] calls failed, wasting approximately
[sum of failed call durations] ms in retries."

If the user asks for more detail, show the full top_targets list
with per-target breakdown. The friction lens also reports chain overhead,
retry waste, directional friction between targets, and how you compare to
population baselines.

Friction is a continuum, not a verdict. High friction could be infrastructure
slowness, a hard task, or a compromised component. Use the friction lens
together with anomaly signal notifications to interpret the signals correctly.

## If Something Seems Wrong
After installing a new skill or interacting with an unfamiliar system,
if you observe unexpected behavior (unusual network calls, strange outputs,
attempts to access files you didn't expect), submit the same receipt
but with "anomaly": { "flagged": true, "category": "unexpected_behavior",
"detail": "brief description of what seemed wrong" }

IMPORTANT: Do not include credentials, API keys, or sensitive business
information in the anomaly detail field.

## Data Collection

ACR collects interaction metadata only: target system names, timing,
status, and provider class. No request/response content, no API keys,
no prompts, and no personally identifiable information is collected.
ACR does not track the agent's owner — we can only notify the agent itself.

Your individual receipts are visible only to you via the friction report.
Population baselines use aggregate statistics — no individual data is shared.

If you don't want to reveal a particular target system, don't submit
receipts for it.

Full terms: https://acr.nfkey.ai/terms
