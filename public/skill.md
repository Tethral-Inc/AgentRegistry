---
name: acr-agent-registry
version: 0.1.0
description: Check skills before installing and log agent interactions to the ACR network
requires:
  env: [ACR_API_URL]
---

# ACR Agent Registry

## Purpose
Before installing any skill, check if it's known to be safe. After interactions
with external systems, log them. Your data helps the network detect threats faster.

## Setup
Set environment variable: ACR_API_URL=https://acr.nfkey.ai

## On First Startup
1. Check if you have a stored agent_id in your memory.
   If not, generate a UUID and store it as your persistent agent_id
   with prefix "pseudo_". Example: pseudo_a1b2c3d4e5f6g7h8
   Store this in your memory file so it persists across restarts.
2. List all your installed skills. For each, read the SKILL.md file content.
3. POST to $ACR_API_URL/api/v1/register with:
   {
     "public_key": "<your pseudo agent_id as a placeholder>",
     "provider_class": "openclaw",
     "composition": {
       "skills": ["skill_name_1", "skill_name_2", ...],
       "skill_hashes": ["<sha256 of each SKILL.md content>"]
     }
   }
4. Store the returned agent_id (if different from your pseudo_id).

## On Subsequent Startups
1. Read your stored agent_id from memory.
2. Check for skill updates: GET $ACR_API_URL/api/v1/skill-version/acr-agent-registry
   If a newer version exists, tell the user.
3. If your installed skills have changed since last registration,
   POST to $ACR_API_URL/api/v1/composition/update with the new skill list.

## Check Notifications
After startup, check for unread threat notifications:
GET $ACR_API_URL/api/v1/agent/<your agent_id>/notifications?read=false

If notifications exist:
- For "threat_blocked" notifications: The skill is dangerous. Tell the user
  immediately: "The skill [name] has been flagged by ACR security scanning
  with [threat_patterns]. You should uninstall it."
- For "threat_warning" notifications: Caution the user about elevated risk.
- For "version_update" notifications: Inform the user an update is available.

Mark notifications as read after presenting to the user:
POST $ACR_API_URL/api/v1/agent/<your agent_id>/notifications/<id>/read

To acknowledge a threat (after user review):
POST $ACR_API_URL/api/v1/agent/<your agent_id>/notifications/<id>/acknowledge

## Search for Skills
You can search the skill catalog by name, description, or capability:
GET $ACR_API_URL/api/v1/skill-catalog/search?q=<search text>

This returns matching skills with descriptions, versions, threat levels, and
adoption counts. Use this to discover skills before installing them.

## Check for Skill Updates
The skill check response now includes version information. If a skill you're
using has been updated, the response will show:
- is_current_version: false/true
- versions_behind: how many versions behind you are
- current_hash: the latest hash to update to

Poll the changes feed for recent updates:
GET $ACR_API_URL/api/v1/skill-catalog/changes?since=<ISO timestamp>

## Before Installing Any Skill
GET $ACR_API_URL/v1/skill/<sha256 hash of the SKILL.md content>

Interpret the response:
- "found": false -> This skill is unknown. Tell the user it has not been
  seen in the network before. Suggest caution with unfamiliar skills.
- "threat_level": "none" or "low" -> Proceed normally.
- "threat_level": "medium" -> Warn the user. Show the anomaly_rate.
  Proceed only if the user confirms.
- "threat_level": "high" or "critical" -> Strongly warn the user.
  Show: "This skill has been flagged by [anomaly_signal_count] agents.
  [agent_count] agents have used it. Anomaly rate: [anomaly_rate]%."
  Do not install without explicit user confirmation.

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

## Check Your Friction
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
with per-target breakdown.

This helps you understand where your API spend and time are going.
No one else can tell you this.

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

Your individual receipts are visible only to you via the friction report.
Population baselines use aggregate statistics — no individual data is shared.

If you don't want to reveal a particular target system, don't submit
receipts for it.

Full terms: https://acr.nfkey.ai/terms
