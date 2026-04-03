# ACR (Agent Composition Records) — Final Build Specification
## Codename: GraphLight | Version 1.1

**Tethral, Inc. | April 2026**

**This is the single source of truth. Read it entirely before executing any step.**

---

## TABLE OF CONTENTS

0. Core Premise
1. Prerequisites & Environment Setup
2. Repository Structure
3. Sprint 0: Foundation
4. Sprint 1: Graph Core (includes friction endpoint)
5. Sprint 1.5: ClawHub Seed
6. Sprint 2: OpenClaw Skill (includes friction in SKILL.md)
7. Sprint 3: MCP Server + SDKs
8. Sprint 4: Friction Engine — Population Layer
9. Sprint 5: Intelligence + Dashboard
10. Drift Prevention
11. Testing Strategy

---

## 0. CORE PREMISE

The interaction record is the product. Not the credential. Not the registry.

An interaction receipt is a timestamped fact: Agent A interacted with System B at time T, when A had composition H. The growing, queryable graph of these facts is the asset. Everything else serves the graph.

Friction analysis ships in v0. Every receipt carries timing data. The friction endpoint computes what's costing the agent the most from that agent's own receipts alone — no population baselines needed, no external data, useful from the first receipt. This is the hook that makes operators want to keep contributing data. The composition disclosure required for meaningful friction analysis is the mechanism that feeds the graph.

**Design rules:**
- JWT credentials, not W3C Verifiable Credentials. Same claims, lighter infrastructure.
- Registered or not. No trust tiers beyond that in v0.
- No receipt signing by agents in v0. Agents can't generate Ed25519 keypairs reliably. Authentication is by registered agent_id.
- No lineage pointers. History is reconstructable from composition_snapshots by agent_id.
- No target redaction. If you don't want to reveal a target, don't submit that receipt.
- Build only what the current sprint needs. Don't provision infrastructure for future sprints.
- Friction is per-agent in v0. Population baselines and comparative analysis come in Sprint 4.

---

## 1. PREREQUISITES & ENVIRONMENT SETUP

### 1.1 Required Accounts

```
Service              Purpose                          
──────────────────────────────────────────────────────
GitHub               Repository, CI/CD                
CockroachDB Cloud    Primary database (Serverless)    
Cloudflare           Workers, KV, R2, DNS             
Vercel               API hosting, dashboard           
AWS                  Lambda, EventBridge, Secrets Mgr  
npm                  Package publishing               
```

### 1.2 Required CLI Tools

```bash
node --version        # >= 20.0.0
pnpm --version        # >= 9.0.0 (install: npm install -g pnpm)
terraform --version   # >= 1.7
wrangler --version    # (install: npm install -g wrangler)
vercel --version      # (install: npm install -g vercel)
aws --version         # configured with credentials
```

### 1.3 GitHub Secrets

Collect before Sprint 0. Store in GitHub Actions Settings > Secrets:

```
COCKROACH_CONNECTION_STRING_STAGING
COCKROACH_CONNECTION_STRING_PRODUCTION
CLOUDFLARE_API_TOKEN
CLOUDFLARE_ACCOUNT_ID
VERCEL_TOKEN
VERCEL_ORG_ID
VERCEL_PROJECT_ID
AWS_ACCESS_KEY_ID
AWS_SECRET_ACCESS_KEY
TETHRAL_SIGNING_KEY_SEED        # generate: openssl rand -hex 32
SLACK_WEBHOOK_URL
```

### 1.4 Manual Setup (do first)

1. Create CockroachDB Serverless cluster in Cloud console (us-east-1). Copy connection string.
2. In Cloudflare, ensure `tethral.ai` zone exists. Create CNAME: `acr` -> will be set by Workers.
3. Create Vercel project (Next.js). Copy project ID and org ID.
4. Create S3 bucket `tethral-terraform-state` in AWS us-east-1 for Terraform backend.
5. Create Slack incoming webhook for alerts.

---

## 2. REPOSITORY STRUCTURE

```bash
mkdir -p acr && cd acr && git init

mkdir -p .github/workflows
mkdir -p terraform/environments/{staging,production}
mkdir -p terraform/modules/{cloudflare,aws}
mkdir -p packages/resolver-api/src/{routes,cache}
mkdir -p packages/ingestion-api/app/api/v1/{receipts,register,composition,"skill-version/[name]"}
mkdir -p packages/ingestion-api/app/lookup
mkdir -p packages/intelligence/{anomaly,maintenance,health}
mkdir -p packages/mcp-server/src/tools
mkdir -p packages/ts-sdk/src
mkdir -p packages/python-sdk/tethral_acr
mkdir -p packages/openclaw-skill
mkdir -p shared/{types,crypto,schemas,canonical-names,threat-intel}
mkdir -p migrations
mkdir -p tests/{integration,e2e}
```

### 2.1 Root Configuration

**`pnpm-workspace.yaml`:**
```yaml
packages:
  - "packages/*"
  - "shared"
  - "tests"
```

**`package.json`:**
```json
{
  "name": "acr",
  "private": true,
  "workspaces": ["packages/*", "shared"],
  "scripts": {
    "build": "pnpm -r build",
    "test": "pnpm -r test",
    "test:integration": "pnpm --filter tests run test:integration",
    "lint": "pnpm -r lint",
    "typecheck": "pnpm -r typecheck",
    "migrate:up": "migrate -database $COCKROACH_CONNECTION_STRING -path migrations up",
    "migrate:down": "migrate -database $COCKROACH_CONNECTION_STRING -path migrations down 1"
  },
  "devDependencies": {
    "typescript": "^5.4",
    "@types/node": "^20",
    "vitest": "^1.6"
  },
  "engines": {
    "node": ">=20.0.0",
    "pnpm": ">=9.0.0"
  }
}
```

**`tsconfig.base.json`:**
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "esModuleInterop": true,
    "strict": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true,
    "declaration": true,
    "sourceMap": true,
    "outDir": "dist",
    "rootDir": "src"
  }
}
```

**`.env.example`:**
```bash
COCKROACH_CONNECTION_STRING=postgresql://user:pass@host:26257/acr?sslmode=verify-full
CLOUDFLARE_API_TOKEN=
CLOUDFLARE_ACCOUNT_ID=
AWS_REGION=us-east-1
TETHRAL_SIGNING_KEY_SEED=
SLACK_WEBHOOK_URL=
ACR_API_URL=https://acr.tethral.ai
```

**`.gitignore`:**
```
node_modules/
dist/
.env
.env.*
!.env.example
*.tfstate
*.tfstate.backup
.terraform/
.vercel
.wrangler
__pycache__/
*.egg-info/
coverage/
```

---

## 3. SPRINT 0: FOUNDATION

**Goal:** Infrastructure live, CI/CD working, shared modules built, health checks running. After this, no infrastructure needs manual setup.

**What gets provisioned this sprint ONLY:**
- CockroachDB schema (via migration)
- Cloudflare: 5 KV namespaces, 1 R2 bucket, DNS
- AWS: 2 Lambdas (health_check, partition_creator), Secrets Manager, EventBridge
- Vercel: project linked
- GitHub Actions: CI + staging deploy workflows

### 3.1 Shared Types

**`shared/package.json`:**
```json
{
  "name": "@acr/shared",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "main": "dist/index.js",
  "types": "dist/index.d.ts",
  "scripts": {
    "build": "tsc",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "jose": "^5.6.0",
    "pg": "^8.12.0"
  },
  "devDependencies": {
    "@types/pg": "^8.11.0"
  }
}
```

**`shared/types/receipt.ts`:**
```typescript
export interface InteractionReceipt {
  receipt_id: string;
  emitter: {
    agent_id: string;
    composition_hash?: string;
    provider_class: string;
  };
  target: {
    system_id: string;
    system_type: TargetSystemType;
  };
  interaction: {
    category: InteractionCategory;
    duration_ms: number;
    status: InteractionStatus;
    request_timestamp_ms: number;
    response_timestamp_ms?: number;
  };
  anomaly: {
    flagged: boolean;
    category?: AnomalyCategory;
    detail?: string;
  };
}

export type TargetSystemType =
  | 'mcp_server' | 'api' | 'agent' | 'skill' | 'platform' | 'unknown';

export type InteractionCategory =
  | 'tool_call' | 'delegation' | 'data_exchange' | 'skill_install'
  | 'commerce' | 'research' | 'code' | 'communication';

export type InteractionStatus =
  | 'success' | 'failure' | 'timeout' | 'partial';

export type AnomalyCategory =
  | 'unexpected_behavior' | 'data_exfiltration' | 'prompt_injection'
  | 'malformed_output' | 'excessive_latency' | 'unauthorized_access' | 'other';
```

**`shared/types/agent.ts`:**
```typescript
export interface Agent {
  agent_id: string;
  public_key: string;
  provider_class: string;
  current_composition_hash?: string;
  operational_domain?: string;
  registration_method: string;
  status: 'active' | 'expired';
  registered: boolean;  // true = registered with key, false = pseudonymous
  created_at: string;
  updated_at: string;
  last_active_at: string;
}

export interface RegistrationRequest {
  public_key: string;
  provider_class: string;
  composition?: {
    mcps?: string[];
    tools?: string[];
    skills?: string[];
    skill_hashes?: string[];
  };
  operational_domain?: string;
  system_prompt_hash?: string;
}

export interface RegistrationResponse {
  agent_id: string;
  credential: string;
  composition_hash: string;
  environment_briefing: EnvironmentBriefing;
}

export interface EnvironmentBriefing {
  connected_systems: SystemStatus[];
  active_threats: ThreatNotice[];
}

export interface SystemStatus {
  name: string;
  type: string;
  health_status: string;
  anomaly_count: number;
  agent_population: number;
}

export interface ThreatNotice {
  threat_level: string;
  component_hash: string;
  description: string;
  first_reported: string;
}
```

**`shared/types/skill.ts`:**
```typescript
export type ThreatLevel = 'none' | 'low' | 'medium' | 'high' | 'critical';

export interface SkillHash {
  skill_hash: string;
  skill_name?: string;
  skill_source?: string;
  first_seen_at: string;
  agent_count: number;
  interaction_count: number;
  anomaly_signal_count: number;
  anomaly_signal_rate: number;
  threat_level: ThreatLevel;
  last_updated: string;
}

export interface SkillCheckResponse {
  found: boolean;
  skill_hash: string;
  skill_name?: string;
  skill_source?: string;
  agent_count?: number;
  interaction_count?: number;
  anomaly_rate?: number;
  threat_level?: ThreatLevel;
  first_seen?: string;
  last_seen?: string;
}
```

**`shared/types/friction.ts`:**
```typescript
export interface FrictionSummary {
  total_interactions: number;
  total_wait_time_ms: number;
  friction_percentage: number;
  total_failures: number;
  failure_rate: number;
}

export interface TargetFriction {
  target_system_id: string;
  target_system_type: string;
  interaction_count: number;
  total_duration_ms: number;
  proportion_of_total: number;
  failure_count: number;
  median_duration_ms: number;
}

/**
 * V0 friction report: per-agent, from that agent's own receipts only.
 * No population baselines. No paid tier gating.
 * Population comparison fields added in Sprint 4.
 */
export interface FrictionReport {
  agent_id: string;
  scope: 'session' | 'day' | 'week';
  period_start: string;
  period_end: string;
  summary: FrictionSummary;
  top_targets: TargetFriction[]; // sorted by total_duration_ms desc, max 10
}

/**
 * Sprint 4 additions (not built in v0):
 */
export interface ComponentFriction extends TargetFriction {
  vs_baseline: number;   // multiplier vs population median
  volatility: number;    // stddev / mean
  p95_duration_ms: number;
}
```

**`shared/types/errors.ts`:**
```typescript
/**
 * Standard error response format.
 * Every API endpoint returns this shape on error.
 */
export interface APIError {
  error: {
    code: ErrorCode;
    message: string;
  };
}

export type ErrorCode =
  | 'INVALID_INPUT'
  | 'MISSING_FIELD'
  | 'INVALID_FORMAT'
  | 'NOT_FOUND'
  | 'RATE_LIMITED'
  | 'UNAUTHORIZED'
  | 'INTERNAL_ERROR'
  | 'AGENT_NOT_FOUND'
  | 'SKILL_NOT_FOUND';

export function makeError(code: ErrorCode, message: string): APIError {
  return { error: { code, message } };
}
```

**`shared/types/index.ts`:**
```typescript
export * from './receipt.js';
export * from './agent.js';
export * from './skill.js';
export * from './friction.js';
export * from './errors.js';
```

### 3.2 Shared Crypto

**`shared/crypto/hash.ts`:**
```typescript
import { createHash } from 'node:crypto';

export function sha256(data: string | Buffer): string {
  return createHash('sha256').update(data).digest('hex');
}

export function hashSkillFile(content: string): string {
  const normalized = content.replace(/\r\n/g, '\n').trim();
  return sha256(normalized);
}

export function computeCompositionHash(componentHashes: string[]): string {
  const sorted = [...componentHashes].sort();
  return sha256(sorted.join(':'));
}

export function generateAgentId(publicKey: string, timestamp: number): string {
  const hash = sha256(`${publicKey}:${timestamp}`);
  return `acr_${hash.substring(0, 12)}`;
}

export function generateReceiptId(
  emitterAgentId: string,
  targetSystemId: string,
  timestampMs: number
): string {
  const hash = sha256(`${emitterAgentId}:${targetSystemId}:${timestampMs}`);
  return `rcpt_${hash.substring(0, 12)}`;
}
```

**`shared/crypto/jwt.ts`:**
```typescript
import * as jose from 'jose';

let cachedKeyPair: { privateKey: jose.KeyLike; publicKey: jose.KeyLike } | null = null;

export async function getSigningKeyPair(seed?: string): Promise<{
  privateKey: jose.KeyLike;
  publicKey: jose.KeyLike;
}> {
  if (cachedKeyPair) return cachedKeyPair;

  // Generate Ed25519 keypair
  // In production, derive deterministically from seed via HKDF
  // For v0, generate fresh and persist via Secrets Manager
  const pair = await jose.generateKeyPair('EdDSA', { crv: 'Ed25519' });
  cachedKeyPair = pair;
  return pair;
}

export async function issueCredential(
  privateKey: jose.KeyLike,
  claims: {
    agent_id: string;
    public_key: string;
    provider_class: string;
    composition_hash: string;
  }
): Promise<string> {
  return new jose.SignJWT({
    sub: claims.agent_id,
    agent_id: claims.agent_id,
    public_key: claims.public_key,
    provider_class: claims.provider_class,
    composition_hash: claims.composition_hash,
  })
    .setProtectedHeader({ alg: 'EdDSA', typ: 'JWT' })
    .setIssuer('https://acr.tethral.ai')
    .setIssuedAt()
    .setExpirationTime('90d')
    .sign(privateKey);
}

export async function verifyCredential(
  token: string,
  publicKey: jose.KeyLike
): Promise<jose.JWTPayload> {
  const { payload } = await jose.jwtVerify(token, publicKey, {
    issuer: 'https://acr.tethral.ai',
  });
  return payload;
}

export async function getPublicKeyJwk(publicKey: jose.KeyLike): Promise<jose.JWK> {
  return jose.exportJWK(publicKey);
}
```

### 3.3 Shared Database Client

**`shared/crypto/db.ts`:**
```typescript
import { Pool, PoolConfig } from 'pg';

let pool: Pool | null = null;

export function getPool(): Pool {
  if (pool) return pool;

  const connectionString = process.env.COCKROACH_CONNECTION_STRING;
  if (!connectionString) {
    throw new Error('COCKROACH_CONNECTION_STRING environment variable is required');
  }

  const config: PoolConfig = {
    connectionString,
    max: 10,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 5000,
    ssl: { rejectUnauthorized: true },
  };

  pool = new Pool(config);

  pool.on('error', (err) => {
    console.error('Unexpected database pool error:', err);
  });

  return pool;
}

export async function query<T>(
  text: string,
  params?: unknown[]
): Promise<T[]> {
  const client = await getPool().connect();
  try {
    const result = await client.query(text, params);
    return result.rows as T[];
  } finally {
    client.release();
  }
}

export async function queryOne<T>(
  text: string,
  params?: unknown[]
): Promise<T | null> {
  const rows = await query<T>(text, params);
  return rows[0] || null;
}

export async function execute(
  text: string,
  params?: unknown[]
): Promise<number> {
  const client = await getPool().connect();
  try {
    const result = await client.query(text, params);
    return result.rowCount ?? 0;
  } finally {
    client.release();
  }
}
```

### 3.4 Shared Validation

**`shared/schemas/validate.ts`:**
```typescript
import type { APIError, ErrorCode } from '../types/errors.js';

/**
 * Validate target system_id format.
 * Must match: {type}:{canonical-name}
 * Types: mcp, api, agent, skill, platform
 */
const TARGET_PATTERN = /^(mcp|api|agent|skill|platform):[a-zA-Z0-9._:-]+$/;

const VALID_CATEGORIES = [
  'tool_call', 'delegation', 'data_exchange', 'skill_install',
  'commerce', 'research', 'code', 'communication'
];

const VALID_STATUSES = ['success', 'failure', 'timeout', 'partial'];

const VALID_SYSTEM_TYPES = ['mcp_server', 'api', 'agent', 'skill', 'platform', 'unknown'];

const VALID_PROVIDERS = [
  'anthropic', 'openai', 'google', 'openclaw', 'langchain',
  'crewai', 'autogen', 'custom', 'unknown'
];

const VALID_ANOMALY_CATEGORIES = [
  'unexpected_behavior', 'data_exfiltration', 'prompt_injection',
  'malformed_output', 'excessive_latency', 'unauthorized_access', 'other'
];

export interface ValidationResult {
  valid: boolean;
  errors: string[];
}

export function validateReceipt(data: unknown): ValidationResult {
  const errors: string[] = [];
  if (!data || typeof data !== 'object') {
    return { valid: false, errors: ['Receipt must be an object'] };
  }

  const d = data as Record<string, unknown>;

  // Emitter
  if (!d.emitter || typeof d.emitter !== 'object') {
    errors.push('emitter is required and must be an object');
  } else {
    const e = d.emitter as Record<string, unknown>;
    if (!e.agent_id || typeof e.agent_id !== 'string') {
      errors.push('emitter.agent_id is required');
    } else if (!/^(acr_|pseudo_)[a-f0-9]{12,32}$/.test(e.agent_id)) {
      errors.push('emitter.agent_id must match pattern acr_xxxx or pseudo_xxxx');
    }
    if (!e.provider_class || !VALID_PROVIDERS.includes(e.provider_class as string)) {
      errors.push(`emitter.provider_class must be one of: ${VALID_PROVIDERS.join(', ')}`);
    }
  }

  // Target
  if (!d.target || typeof d.target !== 'object') {
    errors.push('target is required and must be an object');
  } else {
    const t = d.target as Record<string, unknown>;
    if (!t.system_id || typeof t.system_id !== 'string') {
      errors.push('target.system_id is required');
    } else if (!TARGET_PATTERN.test(t.system_id)) {
      errors.push('target.system_id must match format {type}:{name} (e.g., mcp:github, api:stripe.com)');
    }
    if (!t.system_type || !VALID_SYSTEM_TYPES.includes(t.system_type as string)) {
      errors.push(`target.system_type must be one of: ${VALID_SYSTEM_TYPES.join(', ')}`);
    }
  }

  // Interaction
  if (!d.interaction || typeof d.interaction !== 'object') {
    errors.push('interaction is required and must be an object');
  } else {
    const i = d.interaction as Record<string, unknown>;
    if (!i.category || !VALID_CATEGORIES.includes(i.category as string)) {
      errors.push(`interaction.category must be one of: ${VALID_CATEGORIES.join(', ')}`);
    }
    if (!i.status || !VALID_STATUSES.includes(i.status as string)) {
      errors.push(`interaction.status must be one of: ${VALID_STATUSES.join(', ')}`);
    }
    if (typeof i.request_timestamp_ms !== 'number') {
      errors.push('interaction.request_timestamp_ms is required and must be a number');
    } else {
      const now = Date.now();
      const twentyFourHoursAgo = now - 86400000;
      if (i.request_timestamp_ms < twentyFourHoursAgo || i.request_timestamp_ms > now + 60000) {
        errors.push('interaction.request_timestamp_ms must be within the last 24 hours');
      }
    }
    if (i.duration_ms !== undefined && (typeof i.duration_ms !== 'number' || i.duration_ms < 0)) {
      errors.push('interaction.duration_ms must be a non-negative number');
    }
  }

  // Anomaly (optional but structured if present)
  if (d.anomaly && typeof d.anomaly === 'object') {
    const a = d.anomaly as Record<string, unknown>;
    if (a.category && !VALID_ANOMALY_CATEGORIES.includes(a.category as string)) {
      errors.push(`anomaly.category must be one of: ${VALID_ANOMALY_CATEGORIES.join(', ')}`);
    }
    if (a.detail && typeof a.detail === 'string' && a.detail.length > 500) {
      errors.push('anomaly.detail must be 500 characters or less');
    }
  }

  return { valid: errors.length === 0, errors };
}

export function validateRegistration(data: unknown): ValidationResult {
  const errors: string[] = [];
  if (!data || typeof data !== 'object') {
    return { valid: false, errors: ['Registration must be an object'] };
  }

  const d = data as Record<string, unknown>;

  if (!d.public_key || typeof d.public_key !== 'string' || d.public_key.length < 32) {
    errors.push('public_key is required and must be at least 32 characters');
  }

  if (!d.provider_class || !VALID_PROVIDERS.includes(d.provider_class as string)) {
    errors.push(`provider_class must be one of: ${VALID_PROVIDERS.join(', ')}`);
  }

  if (d.operational_domain && typeof d.operational_domain === 'string' && d.operational_domain.length > 200) {
    errors.push('operational_domain must be 200 characters or less');
  }

  return { valid: errors.length === 0, errors };
}
```

### 3.5 Canonical Name Normalization

**`shared/canonical-names/seed.json`:**
```json
{
  "mcp:github": ["mcp:github-server", "mcp:github-mcp", "mcp:gh"],
  "mcp:slack": ["mcp:slack-server", "mcp:slack-mcp"],
  "mcp:filesystem": ["mcp:fs", "mcp:file-system", "mcp:filesystem-server"],
  "mcp:postgres": ["mcp:postgresql", "mcp:pg", "mcp:postgres-server"],
  "mcp:sqlite": ["mcp:sqlite3", "mcp:sqlite-server"],
  "mcp:brave-search": ["mcp:brave", "mcp:brave-search-server"],
  "mcp:puppeteer": ["mcp:puppeteer-server", "mcp:browser"],
  "mcp:memory": ["mcp:memory-server"],
  "api:openai.com": ["api:api.openai.com"],
  "api:anthropic.com": ["api:api.anthropic.com"],
  "api:stripe.com": ["api:api.stripe.com"],
  "platform:clawhub": ["platform:clawhub.ai", "platform:claw-hub"]
}
```

**`shared/canonical-names/normalize.ts`:**
```typescript
import seedData from './seed.json' assert { type: 'json' };

// Build reverse lookup: variant -> canonical
const reverseMap = new Map<string, string>();

for (const [canonical, variants] of Object.entries(seedData)) {
  reverseMap.set(canonical, canonical);
  for (const variant of variants) {
    reverseMap.set(variant, canonical);
  }
}

/**
 * Normalize a target system_id to its canonical form.
 * If no mapping exists, returns the input unchanged.
 * Also lowercases the entire string for consistency.
 */
export function normalizeSystemId(systemId: string): string {
  const lower = systemId.toLowerCase();
  return reverseMap.get(lower) || lower;
}
```

### 3.6 Threat Intelligence Seed

**`shared/threat-intel/clawhavoc-hashes.json`:**
```json
{
  "_comment": "Known malicious indicators from ClawHavoc and related campaigns. Actual SKILL.md hashes must be collected by crawling ClawHub and cross-referencing published reports before Sprint 1.5 launches.",
  "_sources": [
    "Koi Security: 335 skills, single campaign",
    "Snyk: 1,467 malicious skills total",
    "Bitdefender: ~900 malicious packages",
    "Antiy CERT: Trojan/OpenClaw.PolySkill"
  ],
  "known_malicious_authors": ["hightower6eu", "moonshine-100rze"],
  "known_c2_ips": ["91.92.242.30"],
  "known_malicious_skill_names": [
    "solana-wallet-tracker",
    "youtube-summarize-pro",
    "clawhub-oihpl",
    "auto-updater-sxdg2",
    "openclaw-agent"
  ],
  "hashes": {}
}
```

### 3.7 Database Migration

**`migrations/000001_initial_schema.up.sql`:**
```sql
CREATE TABLE IF NOT EXISTS agents (
    agent_id            STRING PRIMARY KEY,
    public_key          STRING NOT NULL,
    provider_class      STRING NOT NULL DEFAULT 'unknown',
    current_composition_hash STRING,
    operational_domain  STRING,
    registration_method STRING NOT NULL,
    status              STRING NOT NULL DEFAULT 'active',
    registered          BOOLEAN NOT NULL DEFAULT true,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_active_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    credential_jwt      STRING,
    INDEX idx_agents_status (status),
    INDEX idx_agents_provider (provider_class)
);

CREATE TABLE IF NOT EXISTS composition_snapshots (
    snapshot_id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    agent_id            STRING NOT NULL,
    composition_hash    STRING NOT NULL,
    component_hashes    STRING[] NOT NULL,
    reported_components JSONB NOT NULL DEFAULT '{}',
    snapshot_method     STRING NOT NULL,
    recorded_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
    INDEX idx_snapshots_agent_time (agent_id, recorded_at DESC),
    INDEX idx_snapshots_hash (composition_hash)
);

CREATE TABLE IF NOT EXISTS interaction_receipts (
    receipt_id              STRING NOT NULL,
    emitter_agent_id        STRING NOT NULL,
    emitter_composition_hash STRING,
    emitter_provider_class  STRING,
    target_system_id        STRING NOT NULL,
    target_system_type      STRING NOT NULL,
    interaction_category    STRING NOT NULL,
    request_timestamp_ms    BIGINT NOT NULL,
    response_timestamp_ms   BIGINT,
    duration_ms             INT,
    status                  STRING NOT NULL,
    anomaly_flagged         BOOLEAN NOT NULL DEFAULT false,
    anomaly_category        STRING,
    anomaly_detail          STRING,
    created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (receipt_id, created_at),
    INDEX idx_receipts_emitter (emitter_agent_id, created_at DESC),
    INDEX idx_receipts_target (target_system_id, created_at DESC),
    INDEX idx_receipts_anomaly (created_at DESC) WHERE anomaly_flagged = true,
    INDEX idx_receipts_timing (target_system_id, duration_ms),
    INDEX idx_receipts_category (interaction_category, created_at DESC)
);

CREATE TABLE IF NOT EXISTS skill_hashes (
    skill_hash          STRING PRIMARY KEY,
    skill_name          STRING,
    skill_source        STRING,
    first_seen_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    agent_count         INT NOT NULL DEFAULT 0,
    interaction_count   INT NOT NULL DEFAULT 0,
    anomaly_signal_count INT NOT NULL DEFAULT 0,
    anomaly_signal_rate FLOAT NOT NULL DEFAULT 0.0,
    threat_level        STRING NOT NULL DEFAULT 'none',
    known_bad_source    STRING,
    last_updated        TIMESTAMPTZ NOT NULL DEFAULT now(),
    INDEX idx_skills_threat (threat_level) WHERE threat_level != 'none'
);

CREATE TABLE IF NOT EXISTS friction_baselines (
    target_class        STRING PRIMARY KEY,
    baseline_median_ms  INT NOT NULL,
    baseline_p95_ms     INT NOT NULL,
    baseline_p99_ms     INT NOT NULL,
    sample_count        BIGINT NOT NULL DEFAULT 0,
    volatility_score    FLOAT NOT NULL DEFAULT 0.0,
    failure_rate        FLOAT NOT NULL DEFAULT 0.0,
    last_computed       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS system_health (
    system_id           STRING PRIMARY KEY,
    system_type         STRING NOT NULL,
    total_interactions  BIGINT NOT NULL DEFAULT 0,
    distinct_agent_count INT NOT NULL DEFAULT 0,
    anomaly_signal_count INT NOT NULL DEFAULT 0,
    anomaly_rate        FLOAT NOT NULL DEFAULT 0.0,
    median_duration_ms  INT,
    p95_duration_ms     INT,
    failure_rate        FLOAT NOT NULL DEFAULT 0.0,
    first_seen_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_seen_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    health_status       STRING NOT NULL DEFAULT 'unknown'
);

CREATE TABLE IF NOT EXISTS canonical_name_mappings (
    variant_name        STRING PRIMARY KEY,
    canonical_name      STRING NOT NULL,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS daily_summaries (
    summary_date        DATE NOT NULL,
    entity_type         STRING NOT NULL,
    entity_id           STRING NOT NULL,
    total_interactions  BIGINT NOT NULL DEFAULT 0,
    anomaly_count       INT NOT NULL DEFAULT 0,
    median_duration_ms  INT,
    p95_duration_ms     INT,
    failure_count       INT NOT NULL DEFAULT 0,
    distinct_counterparts INT NOT NULL DEFAULT 0,
    PRIMARY KEY (summary_date, entity_type, entity_id)
);

CREATE TABLE IF NOT EXISTS skill_versions (
    skill_name          STRING PRIMARY KEY,
    current_version     STRING NOT NULL,
    download_url        STRING NOT NULL,
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS api_keys (
    key_hash            STRING PRIMARY KEY,
    operator_id         STRING NOT NULL,
    name                STRING NOT NULL,
    tier                STRING NOT NULL DEFAULT 'free',
    rate_limit_per_hour INT NOT NULL DEFAULT 100,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_used_at        TIMESTAMPTZ,
    revoked             BOOLEAN NOT NULL DEFAULT false,
    INDEX idx_apikeys_operator (operator_id)
);
```

**`migrations/000001_initial_schema.down.sql`:**
```sql
DROP TABLE IF EXISTS api_keys;
DROP TABLE IF EXISTS skill_versions;
DROP TABLE IF EXISTS daily_summaries;
DROP TABLE IF EXISTS canonical_name_mappings;
DROP TABLE IF EXISTS system_health;
DROP TABLE IF EXISTS friction_baselines;
DROP TABLE IF EXISTS skill_hashes;
DROP TABLE IF EXISTS interaction_receipts;
DROP TABLE IF EXISTS composition_snapshots;
DROP TABLE IF EXISTS agents;
```

### 3.8 Terraform

**`terraform/environments/staging/main.tf`:**
```hcl
terraform {
  required_version = ">= 1.7"
  backend "s3" {
    bucket = "tethral-terraform-state"
    key    = "acr/staging/terraform.tfstate"
    region = "us-east-1"
  }
}

variable "cockroach_connection_string" { type = string; sensitive = true }
variable "cloudflare_account_id" { type = string }
variable "cloudflare_api_token" { type = string; sensitive = true }
variable "slack_webhook_url" { type = string; sensitive = true }

module "cloudflare" {
  source     = "../../modules/cloudflare"
  account_id = var.cloudflare_account_id
  api_token  = var.cloudflare_api_token
}

module "aws" {
  source                      = "../../modules/aws"
  cockroach_connection_string = var.cockroach_connection_string
  slack_webhook_url           = var.slack_webhook_url
}
```

**`terraform/modules/cloudflare/main.tf`:**
```hcl
variable "account_id" { type = string }
variable "api_token" { type = string; sensitive = true }

terraform {
  required_providers {
    cloudflare = { source = "cloudflare/cloudflare"; version = "~> 4.0" }
  }
}

provider "cloudflare" { api_token = var.api_token }

resource "cloudflare_workers_kv_namespace" "skill_cache" {
  account_id = var.account_id
  title      = "acr-skill-cache"
}
resource "cloudflare_workers_kv_namespace" "threat_state" {
  account_id = var.account_id
  title      = "acr-threat-state"
}
resource "cloudflare_workers_kv_namespace" "system_health_cache" {
  account_id = var.account_id
  title      = "acr-system-health-cache"
}
resource "cloudflare_workers_kv_namespace" "rate_limits" {
  account_id = var.account_id
  title      = "acr-rate-limits"
}
resource "cloudflare_workers_kv_namespace" "skill_version" {
  account_id = var.account_id
  title      = "acr-skill-version"
}

resource "cloudflare_r2_bucket" "receipt_archives" {
  account_id = var.account_id
  name       = "acr-receipt-archives"
}

output "kv_ids" {
  value = {
    skill_cache   = cloudflare_workers_kv_namespace.skill_cache.id
    threat_state  = cloudflare_workers_kv_namespace.threat_state.id
    system_health = cloudflare_workers_kv_namespace.system_health_cache.id
    rate_limits   = cloudflare_workers_kv_namespace.rate_limits.id
    skill_version = cloudflare_workers_kv_namespace.skill_version.id
  }
}
```

**`terraform/modules/aws/main.tf`:**
```hcl
variable "cockroach_connection_string" { type = string; sensitive = true }
variable "slack_webhook_url" { type = string; sensitive = true }
variable "region" { type = string; default = "us-east-1" }

provider "aws" { region = var.region }

resource "aws_secretsmanager_secret" "signing_seed" {
  name = "acr/signing-key-seed"
}

resource "aws_iam_role" "lambda" {
  name = "acr-lambda"
  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{ Action = "sts:AssumeRole"; Effect = "Allow";
      Principal = { Service = "lambda.amazonaws.com" } }]
  })
}

resource "aws_iam_role_policy_attachment" "lambda_basic" {
  role       = aws_iam_role.lambda.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole"
}

resource "aws_iam_role_policy" "lambda_secrets" {
  name = "acr-secrets"
  role = aws_iam_role.lambda.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{ Action = ["secretsmanager:GetSecretValue"]; Effect = "Allow";
      Resource = aws_secretsmanager_secret.signing_seed.arn }]
  })
}

resource "aws_sqs_queue" "dlq" {
  name                      = "acr-lambda-dlq"
  message_retention_seconds = 1209600
}

resource "aws_sns_topic" "alerts" { name = "acr-alerts" }

# Sprint 0 Lambdas only: health_check and partition_creator
# Additional Lambdas added in their respective sprints

resource "aws_lambda_function" "health_check" {
  function_name = "acr-health-check"
  role          = aws_iam_role.lambda.arn
  handler       = "index.handler"
  runtime       = "nodejs20.x"
  timeout       = 10
  memory_size   = 128
  filename      = "${path.module}/placeholder.zip"
  dead_letter_config { target_arn = aws_sqs_queue.dlq.arn }
  environment {
    variables = {
      COCKROACH_CONNECTION_STRING = var.cockroach_connection_string
      SLACK_WEBHOOK_URL           = var.slack_webhook_url
      ACR_API_URL                 = "https://acr.tethral.ai"
    }
  }
  lifecycle { ignore_changes = [filename] }
}

resource "aws_cloudwatch_event_rule" "health_check" {
  name                = "acr-health-check"
  schedule_expression = "rate(5 minutes)"
}
resource "aws_cloudwatch_event_target" "health_check" {
  rule = aws_cloudwatch_event_rule.health_check.name
  arn  = aws_lambda_function.health_check.arn
}
resource "aws_lambda_permission" "health_check" {
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.health_check.function_name
  principal     = "events.amazonaws.com"
  source_arn    = aws_cloudwatch_event_rule.health_check.arn
}

resource "aws_lambda_function" "partition_creator" {
  function_name = "acr-partition-creator"
  role          = aws_iam_role.lambda.arn
  handler       = "index.handler"
  runtime       = "nodejs20.x"
  timeout       = 60
  memory_size   = 128
  filename      = "${path.module}/placeholder.zip"
  dead_letter_config { target_arn = aws_sqs_queue.dlq.arn }
  environment {
    variables = { COCKROACH_CONNECTION_STRING = var.cockroach_connection_string }
  }
  lifecycle { ignore_changes = [filename] }
}

resource "aws_cloudwatch_event_rule" "partition_creator" {
  name                = "acr-partition-creator"
  schedule_expression = "cron(0 0 25 * ? *)"
}
resource "aws_cloudwatch_event_target" "partition_creator" {
  rule = aws_cloudwatch_event_rule.partition_creator.name
  arn  = aws_lambda_function.partition_creator.arn
}
resource "aws_lambda_permission" "partition_creator" {
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.partition_creator.function_name
  principal     = "events.amazonaws.com"
  source_arn    = aws_cloudwatch_event_rule.partition_creator.arn
}

# Placeholder zip for Lambda creation (replaced by CI/CD)
# Create with: echo "exports.handler = async () => ({ statusCode: 200 });" > index.js && zip placeholder.zip index.js
```

### 3.9 CI/CD Workflows

**`.github/workflows/ci.yml`:**
```yaml
name: CI
on:
  pull_request:
    branches: [main]
jobs:
  check:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
        with: { version: 9 }
      - uses: actions/setup-node@v4
        with: { node-version: 20, cache: pnpm }
      - run: pnpm install --frozen-lockfile
      - run: pnpm typecheck
      - run: pnpm test
  terraform-plan:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: hashicorp/setup-terraform@v3
      - working-directory: terraform/environments/staging
        env:
          TF_VAR_cockroach_connection_string: ${{ secrets.COCKROACH_CONNECTION_STRING_STAGING }}
          TF_VAR_cloudflare_account_id: ${{ secrets.CLOUDFLARE_ACCOUNT_ID }}
          TF_VAR_cloudflare_api_token: ${{ secrets.CLOUDFLARE_API_TOKEN }}
          TF_VAR_slack_webhook_url: ${{ secrets.SLACK_WEBHOOK_URL }}
          AWS_ACCESS_KEY_ID: ${{ secrets.AWS_ACCESS_KEY_ID }}
          AWS_SECRET_ACCESS_KEY: ${{ secrets.AWS_SECRET_ACCESS_KEY }}
        run: terraform init && terraform plan -no-color
```

**`.github/workflows/deploy.yml`:**
```yaml
name: Deploy
on:
  push:
    branches: [main]
jobs:
  infrastructure:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: hashicorp/setup-terraform@v3
      - working-directory: terraform/environments/staging
        env:
          TF_VAR_cockroach_connection_string: ${{ secrets.COCKROACH_CONNECTION_STRING_STAGING }}
          TF_VAR_cloudflare_account_id: ${{ secrets.CLOUDFLARE_ACCOUNT_ID }}
          TF_VAR_cloudflare_api_token: ${{ secrets.CLOUDFLARE_API_TOKEN }}
          TF_VAR_slack_webhook_url: ${{ secrets.SLACK_WEBHOOK_URL }}
          AWS_ACCESS_KEY_ID: ${{ secrets.AWS_ACCESS_KEY_ID }}
          AWS_SECRET_ACCESS_KEY: ${{ secrets.AWS_SECRET_ACCESS_KEY }}
        run: terraform init && terraform apply -auto-approve
  migrations:
    needs: infrastructure
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - name: Install migrate
        run: |
          curl -L https://github.com/golang-migrate/migrate/releases/download/v4.17.0/migrate.linux-amd64.tar.gz | tar xz
          sudo mv migrate /usr/local/bin/
      - run: migrate -database "${{ secrets.COCKROACH_CONNECTION_STRING_STAGING }}" -path migrations up
  services:
    needs: migrations
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
        with: { version: 9 }
      - uses: actions/setup-node@v4
        with: { node-version: 20, cache: pnpm }
      - run: pnpm install --frozen-lockfile
      - run: pnpm build
      # Deploy resolver API to Cloudflare Workers
      - working-directory: packages/resolver-api
        env:
          CLOUDFLARE_API_TOKEN: ${{ secrets.CLOUDFLARE_API_TOKEN }}
        run: npx wrangler deploy || echo "Resolver API not yet built, skipping"
      # Deploy ingestion API to Vercel
      - uses: amondnet/vercel-action@v25
        with:
          vercel-token: ${{ secrets.VERCEL_TOKEN }}
          vercel-org-id: ${{ secrets.VERCEL_ORG_ID }}
          vercel-project-id: ${{ secrets.VERCEL_PROJECT_ID }}
          working-directory: packages/ingestion-api
        continue-on-error: true  # May not exist in Sprint 0
```

**`.github/workflows/nightly.yml`:**
```yaml
name: Nightly
on:
  schedule:
    - cron: '0 6 * * *'
jobs:
  drift-check:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: hashicorp/setup-terraform@v3
      - working-directory: terraform/environments/staging
        env:
          TF_VAR_cockroach_connection_string: ${{ secrets.COCKROACH_CONNECTION_STRING_STAGING }}
          TF_VAR_cloudflare_account_id: ${{ secrets.CLOUDFLARE_ACCOUNT_ID }}
          TF_VAR_cloudflare_api_token: ${{ secrets.CLOUDFLARE_API_TOKEN }}
          TF_VAR_slack_webhook_url: ${{ secrets.SLACK_WEBHOOK_URL }}
          AWS_ACCESS_KEY_ID: ${{ secrets.AWS_ACCESS_KEY_ID }}
          AWS_SECRET_ACCESS_KEY: ${{ secrets.AWS_SECRET_ACCESS_KEY }}
        run: |
          terraform init
          terraform plan -detailed-exitcode -no-color 2>&1 || {
            if [ $? -eq 2 ]; then
              curl -X POST ${{ secrets.SLACK_WEBHOOK_URL }} \
                -H 'Content-type: application/json' \
                -d '{"text":"🚨 ACR infrastructure drift detected. Check GitHub Actions."}'
            fi
          }
  dependency-audit:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
        with: { version: 9 }
      - run: pnpm install --frozen-lockfile
      - run: pnpm audit --audit-level=high || curl -X POST ${{ secrets.SLACK_WEBHOOK_URL }} -H 'Content-type:application/json' -d '{"text":"⚠️ ACR dependency audit found vulnerabilities."}'
```

**`.github/renovate.json`:**
```json
{
  "$schema": "https://docs.renovatebot.com/renovate-schema.json",
  "extends": ["config:recommended"],
  "packageRules": [
    { "matchUpdateTypes": ["patch"], "automerge": true },
    { "matchUpdateTypes": ["major"], "automerge": false }
  ],
  "schedule": ["every weekend"]
}
```

### 3.10 Sprint 0 Verification

Run after completing Sprint 0:

```bash
# 1. Terraform applied
cd terraform/environments/staging && terraform plan
# Output: "No changes. Your infrastructure matches the configuration."

# 2. Database schema created
# Connect to CockroachDB and run:
# SELECT table_name FROM information_schema.tables WHERE table_schema = 'public';
# Should show 9 tables

# 3. Cloudflare KV namespaces exist
wrangler kv:namespace list
# Should show 5 namespaces starting with "acr-"

# 4. AWS Lambdas exist
aws lambda list-functions --query 'Functions[?starts_with(FunctionName,`acr-`)].FunctionName'
# Should show: acr-health-check, acr-partition-creator

# 5. Shared module builds
cd shared && pnpm build && pnpm typecheck
# No errors

# 6. CI workflow runs on PR
# Create a test branch, push, verify GitHub Actions triggers
```

---

## 4. SPRINT 1: GRAPH CORE

**Goal:** Working API that accepts receipts, registers agents, answers queries. Integration tests passing.

**Build in this sprint:**
- `packages/ingestion-api` (Vercel Next.js API routes)
- `packages/resolver-api` (Cloudflare Worker)
- 2 additional Lambda functions: `skill_threat_update`, `system_health_aggregate`
- Integration tests

### 4.1 Ingestion API

**`packages/ingestion-api/package.json`:**
```json
{
  "name": "ingestion-api",
  "private": true,
  "scripts": {
    "dev": "next dev",
    "build": "next build",
    "start": "next start",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "next": "^14",
    "react": "^18",
    "react-dom": "^18",
    "@acr/shared": "workspace:*"
  }
}
```

**Required endpoints:**

```
POST /api/v1/register
  - Validates input against registration schema
  - Generates agent_id from public_key + timestamp
  - Computes composition_hash from skill_hashes (if provided)
  - Issues JWT credential
  - Stores agent in database
  - Stores composition snapshot
  - Returns: { agent_id, credential, composition_hash, environment_briefing }

POST /api/v1/receipts
  - Accepts single receipt or { receipts: [...] } batch (max 50)
  - Validates each receipt against receipt schema
  - Normalizes target.system_id via canonical name mapping
  - Computes receipt_id deterministically
  - Computes duration_ms from timestamps if not provided
  - Stores in interaction_receipts table
  - Updates agent.last_active_at
  - Returns: { accepted: number, receipt_ids: [...] }

POST /api/v1/composition/update
  - Requires agent_id in body
  - Validates agent exists
  - Stores new composition snapshot
  - Updates agent.current_composition_hash
  - Returns: { composition_hash, snapshot_id }

GET /api/v1/agent/:agent_id/friction?scope=session|day|week
  - Queries interaction_receipts for this agent_id within the time scope
  - Groups by target_system_id
  - Computes per target:
    * interaction_count
    * total_duration_ms (sum of duration_ms)
    * proportion_of_total (this target's duration / total duration across all targets)
    * failure_count (count WHERE status != 'success')
    * median_duration_ms (approx via sorting)
  - Computes summary:
    * total_interactions: count of all receipts in window
    * total_wait_time_ms: sum of all duration_ms
    * friction_percentage: total_wait_time / (scope_end - scope_start) * 100
    * total_failures: count of non-success
    * failure_rate: total_failures / total_interactions
  - Returns:
    {
      summary: { total_interactions, total_wait_time_ms, friction_percentage,
                 total_failures, failure_rate },
      top_targets: [
        { target_system_id, target_system_type, interaction_count,
          total_duration_ms, proportion_of_total, failure_count,
          median_duration_ms }
      ]  // sorted by total_duration_ms descending, top 10
    }
  - No authentication required in v0 (agent_id is not secret)
  - If no receipts found for agent: returns summary with all zeros
  - This is the "what's burning your tokens" hook. Computable from
    day one with a single agent's data. No population baselines needed.

GET /api/v1/health
  - Pings database (SELECT 1)
  - Returns: { status: "ok", database: "connected", timestamp: "..." }
```

**Middleware (`packages/ingestion-api/middleware.ts`):**
- Rate limiting: check request count per IP in a simple in-memory map (Vercel doesn't have KV, use Map with TTL cleanup). 100 requests/minute per IP.
- CORS: allow all origins (public API)
- Request size limit: 1MB
- Standard error format on all error responses

### 4.2 Resolver API

**`packages/resolver-api/wrangler.toml`:**
```toml
name = "acr-resolver"
main = "src/worker.ts"
compatibility_date = "2024-04-01"

[vars]
COCKROACH_CONNECTION_STRING = ""  # Set via wrangler secret

[[kv_namespaces]]
binding = "SKILL_CACHE"
id = ""  # From Terraform output

[[kv_namespaces]]
binding = "THREAT_STATE"
id = ""  # From Terraform output

[[kv_namespaces]]
binding = "SYSTEM_HEALTH"
id = ""  # From Terraform output

[[kv_namespaces]]
binding = "RATE_LIMITS"
id = ""  # From Terraform output

[routes]
pattern = "acr.tethral.ai/v1/*"
```

**Required endpoints:**

```
GET /v1/health
  - Returns: { status: "ok" }

GET /v1/skill/:hash
  - Check KV cache first (TTL 5 min)
  - If miss, query skill_hashes table
  - If not found: { found: false, skill_hash: ":hash" }
  - If found: { found: true, skill_hash, skill_name, skill_source,
      agent_count, interaction_count, anomaly_rate, threat_level,
      first_seen, last_seen }
  - Cache result in KV

GET /v1/agent/:agent_id
  - Query agents table
  - Returns: { found, agent_id, status, provider_class, registered,
      registration_date, last_active, composition_hash }

GET /v1/system/:system_id/health
  - Check KV cache first
  - Query system_health table
  - Returns: { found, system_id, system_type, total_interactions,
      distinct_agents, anomaly_rate, median_duration_ms,
      health_status }

GET /v1/threats/active
  - Check KV cache (TTL 1 min)
  - Query skill_hashes WHERE threat_level IN ('high', 'critical')
  - Returns: [{ threat_level, skill_hash, skill_name,
      anomaly_signal_count, first_seen }]
```

**Stale-while-revalidate pattern:**
- On KV cache hit: return cached data immediately
- On KV cache miss: query database, return result, async write to cache
- On database timeout (> 3 seconds): if stale KV data exists, return it with header `X-ACR-Stale: true`
- If no data anywhere: return 404

**CORS headers on every response:**
```
Access-Control-Allow-Origin: *
Access-Control-Allow-Methods: GET, OPTIONS
Access-Control-Allow-Headers: Content-Type
```

**Rate limiting:**
- Per IP: 100 requests/minute
- Check counter in RATE_LIMITS KV namespace
- Return 429 with `Retry-After` header if exceeded

### 4.3 Lambda Functions (Sprint 1 additions)

Add to `terraform/modules/aws/main.tf`:

**`acr-skill-threat-update`** (every 30 minutes):
```
1. Query interaction_receipts from last 24 hours WHERE anomaly_flagged = true
2. Extract all target skill hashes from anomaly-flagged receipts
   (WHERE target_system_type = 'skill')
3. Also extract emitter composition_hashes and look up their component_hashes
   in composition_snapshots to find which skills were in the agent at the time
4. Group anomaly signals by skill_hash
5. For each skill_hash, count distinct emitter_agent_ids
6. Apply threat thresholds:
   >= 3 distinct reporters AND >= 10% anomaly rate -> 'low'
   >= 10 distinct reporters AND >= 25% anomaly rate -> 'medium'
   >= 25 distinct reporters AND >= 40% anomaly rate -> 'high'
   >= 50 distinct reporters AND >= 60% anomaly rate -> 'critical'
7. UPSERT into skill_hashes
8. Write updated threat levels to Cloudflare KV THREAT_STATE
9. If any skill crossed to 'high' or 'critical': POST to Slack webhook
```

**`acr-system-health-aggregate`** (every 15 minutes):
```
1. Query interaction_receipts from last 24 hours
2. GROUP BY target_system_id
3. Compute per system: count, distinct agents, anomaly rate,
   median duration (approx via percentile_cont), failure rate
4. Determine health_status:
   failure_rate < 5% AND anomaly_rate < 5% -> 'healthy'
   failure_rate < 15% OR anomaly_rate < 15% -> 'degraded'
   failure_rate >= 15% OR anomaly_rate >= 15% -> 'unhealthy'
   anomaly_rate >= 30% -> 'flagged'
5. UPSERT into system_health
6. Write hot entries to Cloudflare KV SYSTEM_HEALTH
```

### 4.4 Sprint 1 Verification

```bash
# Register an agent
curl -X POST https://acr.tethral.ai/api/v1/register \
  -H 'Content-Type: application/json' \
  -d '{"public_key":"test_key_hex_string_at_least_32_chars","provider_class":"openclaw"}'
# Should return: { agent_id, credential, ... }

# Submit a receipt
curl -X POST https://acr.tethral.ai/api/v1/receipts \
  -H 'Content-Type: application/json' \
  -d '{"emitter":{"agent_id":"acr_xxxxxxxxxxxx","provider_class":"openclaw"},"target":{"system_id":"mcp:github","system_type":"mcp_server"},"interaction":{"category":"tool_call","status":"success","request_timestamp_ms":1711978987442,"duration_ms":1200},"anomaly":{"flagged":false}}'
# Should return: { accepted: 1, receipt_ids: [...] }

# Query the resolver
curl https://acr.tethral.ai/v1/agent/acr_xxxxxxxxxxxx
# Should return agent record

# Check friction (after submitting at least one receipt)
curl https://acr.tethral.ai/api/v1/agent/acr_xxxxxxxxxxxx/friction?scope=day
# Should return: { summary: { total_interactions: 1, total_wait_time_ms: 1200,
#   friction_percentage: ..., total_failures: 0, failure_rate: 0 },
#   top_targets: [{ target_system_id: "mcp:github", ... }] }

# Health checks
curl https://acr.tethral.ai/api/v1/health
curl https://acr.tethral.ai/v1/health
# Both should return { status: "ok" }
```

---

## 5. SPRINT 1.5: CLAWHUB SEED

**Goal:** Skill hash database pre-populated with ClawHub skills and known-bad indicators. Must complete before Sprint 2 launches the OpenClaw skill.

### 5.1 ClawHub Investigation

Before writing the crawl code, determine how to access ClawHub data:

1. Check if ClawHub has a public API: `GET https://clawhub.ai/api/skills` or similar
2. Check the ClawHub GitHub repo for a registry manifest or skills index
3. If no API: check if skills are listed in a searchable web page that can be scraped
4. If scraping is required: use a lightweight scraper, respect robots.txt, rate limit to 1 request/second

The crawl Lambda must work with whatever access method is available. Document the method used.

### 5.2 Crawl Implementation

**`packages/intelligence/maintenance/clawhub-crawl.ts`:**

```
1. Fetch list of available skills from ClawHub (method determined above)
2. For each skill:
   a. Download SKILL.md content
   b. Compute SHA-256 hash (using hashSkillFile from shared/crypto)
   c. Check against known_malicious_skill_names from threat-intel seed
   d. UPSERT into skill_hashes table:
      - skill_hash = computed hash
      - skill_name = skill name from registry
      - skill_source = 'clawhub'
      - threat_level = 'critical' if matches known-bad, else 'none'
      - known_bad_source = report name if matches
3. Log: total skills crawled, new hashes added, known-bad matches
4. Store crawl snapshot in R2 for audit trail
```

Add Lambda to Terraform in Sprint 1.5:
- `acr-clawhub-crawl`, scheduled daily at 01:00 UTC, timeout 300s, memory 512MB

### 5.3 Verification

```bash
# After crawl runs:
curl https://acr.tethral.ai/v1/skill/sha256:any_known_hash_here
# Should return: { found: true, skill_source: "clawhub", ... }

# Check known-bad:
curl https://acr.tethral.ai/v1/threats/active
# Should return array of skills with threat_level 'high' or 'critical'
```

---

## 6. SPRINT 2: OPENCLAW SKILL

**Goal:** OpenClaw agents can install the ACR skill from ClawHub, check skills before installing, and contribute interaction receipts to the graph.

### 6.1 SKILL.md

**`packages/openclaw-skill/SKILL.md`:**
```markdown
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
Set environment variable: ACR_API_URL=https://acr.tethral.ai

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

## Before Installing Any Skill
GET $ACR_API_URL/v1/skill/<sha256 hash of the SKILL.md content>

Interpret the response:
- "found": false → This skill is unknown. Tell the user it has not been
  seen in the network before. Suggest caution with unfamiliar skills.
- "threat_level": "none" or "low" → Proceed normally.
- "threat_level": "medium" → Warn the user. Show the anomaly_rate.
  Proceed only if the user confirms.
- "threat_level": "high" or "critical" → Strongly warn the user.
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
```

### 6.2 Public Skill Lookup Page

**`packages/ingestion-api/app/lookup/page.tsx`:**

A single-page UI at `https://acr.tethral.ai/lookup` where anyone can:
- Paste a skill hash or upload a SKILL.md file (which gets hashed client-side)
- See the result: threat level, agent count, anomaly rate
- This must exist when Sprint 2 launches

Simple implementation: a form with a text input, a submit button, and a results area. Calls `GET /v1/skill/{hash}` via fetch. No authentication needed. Mobile-friendly.

### 6.3 Skill Version Endpoint

**`packages/ingestion-api/app/api/v1/skill-version/[name]/route.ts`:**

```
GET /api/v1/skill-version/:name
  - Look up skill_versions table
  - Returns: { name, current_version, download_url }
  - If not found: 404
```

When the OpenClaw skill is published, insert a row:
```sql
INSERT INTO skill_versions (skill_name, current_version, download_url)
VALUES ('acr-agent-registry', '0.1.0', 'https://clawhub.ai/skills/acr-agent-registry');
```

Update this row whenever a new version of the skill is published.

### 6.4 Verification

```bash
# Simulate an OpenClaw agent checking a skill before install
HASH=$(echo -n "fake skill content" | sha256sum | cut -d' ' -f1)
curl https://acr.tethral.ai/v1/skill/$HASH
# Should return: { found: false } for unknown skill

# Check a known-bad hash (from seeded data)
curl https://acr.tethral.ai/v1/skill/<known_bad_hash>
# Should return: { found: true, threat_level: "critical", ... }

# Check skill version
curl https://acr.tethral.ai/api/v1/skill-version/acr-agent-registry
# Should return: { name: "acr-agent-registry", current_version: "0.1.0", ... }

# Load the lookup page
open https://acr.tethral.ai/lookup
# Should render a search interface
```

---

## 7-9. SPRINTS 3-5: SUMMARY

These sprints build on the foundation. Each adds infrastructure only as needed.

### Sprint 3: MCP Server + SDKs (Weeks 5-7)

- `packages/mcp-server`: TypeScript MCP server published as `@tethral/acr-mcp`
- Tools: register_agent, log_interaction, check_entity, check_environment, get_friction_report
- get_friction_report calls the same /api/v1/agent/:id/friction endpoint built in Sprint 1
- Agent self-report as primary registration path
- MCP sampling as secondary
- Host metadata capture as opportunistic bonus
- `packages/ts-sdk`: lightweight REST wrapper for non-MCP agents
- `packages/python-sdk`: same for Python agents
- Add Lambda: `acr-agent-expiration` (daily, expire 90-day inactive agents)
- Add Lambda: `acr-data-archival` (daily, archive old receipts to R2)

### Sprint 4: Friction Engine — Population Layer (Weeks 7-9)

Basic per-agent friction already works from Sprint 1. Sprint 4 adds the comparative layer:

- Add Lambda: `acr-friction-baseline-compute` (daily, compute population baselines from all agents' receipt data)
- Upgrade friction endpoint: add `vs_baseline` field to each target (this agent's median vs population median for same target)
- Add `population_comparison` to response: percentile rank, "you're faster than X% of agents calling this system"
- Gate component-level breakdown behind paid API key (free tier keeps summary + top 3 targets only)
- TriST provider-class baselines layer on as premium differentiation when probe data is imported

### Sprint 5: Intelligence + Dashboard (Weeks 9-12)

- Harden anomaly correlation in existing Lambdas
- Build dashboard pages: operator portal, internal metrics
- Implement threat feed as a polling endpoint (not SSE)
- Add API key management for paid tier access

---

## 10. DRIFT PREVENTION

### 10.1 Infrastructure
- Nightly Terraform plan detects drift, alerts via Slack
- All changes go through Terraform in repo. No console changes.
- AWS resources tagged: `managed_by=terraform`, `project=acr`

### 10.2 Schema
- All changes via numbered migration files in `migrations/`
- CI runs migrations automatically on deploy
- Never run DDL directly. Never edit an applied migration.

### 10.3 Dependencies
- `pnpm-lock.yaml` committed, CI uses `--frozen-lockfile`
- Renovate creates weekly update PRs
- Nightly `pnpm audit` with Slack alert on failures

### 10.4 Data
- Receipts are append-only. No UPDATE or DELETE in application code.
- Archival exports before deleting. Verified before deletion.
- All timestamps UTC. No timezone conversion anywhere.
- All IDs deterministic. Collision is cryptographically improbable.

### 10.5 Operational Invariants

These must always be true. Violation is a bug.

1. Every receipt has a valid agent_id matching `acr_` or `pseudo_` pattern
2. Every target.system_id matches `{type}:{name}` format
3. Every registered agent has one credential JWT
4. Every composition_hash equals `computeCompositionHash(component_hashes)`
5. Every Lambda has a dead letter queue
6. Every API error returns `{ error: { code, message } }` format
7. Terraform state matches infrastructure (checked nightly)
8. Database schema version matches latest migration

---

## 11. TESTING

### Unit tests (run in CI on every PR):
- Hash functions are deterministic
- Validation catches invalid inputs and passes valid ones
- Canonical name normalization works for all seed entries
- JWT issuance and verification round-trip

### Integration tests (run after staging deploy):
- Register agent, verify JWT returned
- Submit receipt, query resolver, verify data appears
- Submit anomaly-flagged receipt, verify threat computation picks it up
- Request friction report after submitting receipts, verify summary and top_targets are populated
- Submit receipts to multiple targets, verify friction report sorts by total_duration_ms descending
- Invalid receipt rejected with structured error
- Rate limiting returns 429 after threshold
- Health endpoints return 200

### Nightly (against production):
- Full lifecycle: register, submit, query
- Skill lookup returns correct data for known hashes
- Drift check on infrastructure

---

*Every file path, command, schema, endpoint, and invariant needed to build and operate this system is in this document. Execute in sprint order. Verify at each checkpoint. The system maintains itself after construction.*
