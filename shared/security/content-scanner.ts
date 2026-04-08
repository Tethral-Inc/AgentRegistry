/**
 * Content Security Scanner for SKILL.md files.
 *
 * Runs regex-based pattern matching against skill content to detect
 * prompt injection, data exfiltration, code execution, and other threats
 * BEFORE the skill enters the catalog.
 *
 * Pure synchronous function — no I/O, no async, no external dependencies.
 * Target: < 100ms for 50KB content.
 */

export type ScanSeverity = 'critical' | 'high' | 'medium' | 'low';

export interface ScanFinding {
  pattern_name: string;
  severity: ScanSeverity;
  category: string;
  matched_text: string;
  line_number: number;
  confidence: 'definite' | 'likely' | 'possible';
}

export interface ScanResult {
  scan_score: number;
  threat_patterns: string[];
  findings: ScanFinding[];
  max_severity: ScanSeverity | 'none';
  scan_duration_ms: number;
  scanner_version: string;
}

const SCANNER_VERSION = '1.0.0';

// Score deductions per severity
const SEVERITY_DEDUCTIONS: Record<ScanSeverity, number> = {
  critical: 25,
  high: 15,
  medium: 8,
  low: 3,
};

const SEVERITY_ORDER: Record<string, number> = {
  critical: 4, high: 3, medium: 2, low: 1, none: 0,
};

// ─────────────────────────────────────────────────────────────────────────────
// Pattern Registry
// ─────────────────────────────────────────────────────────────────────────────

interface PatternDef {
  name: string;
  severity: ScanSeverity;
  category: string;
  regex: RegExp;
  confidence: 'definite' | 'likely' | 'possible';
  /** If true, skip matches found inside YAML frontmatter requires: block */
  skipInRequires?: boolean;
}

const PATTERNS: PatternDef[] = [
  // ── CRITICAL: Prompt Injection ──
  {
    name: 'prompt_injection_ignore',
    severity: 'critical',
    category: 'prompt_injection',
    regex: /\b(ignore|disregard|forget)\b.{0,30}\b(instructions?|rules?|prompt|system)\b/gi,
    confidence: 'definite',
  },
  {
    name: 'prompt_injection_override',
    severity: 'critical',
    category: 'prompt_injection',
    regex: /\b(override|bypass|disable)\b.{0,30}\b(system prompt|safety|restrictions?|guardrails?)\b/gi,
    confidence: 'definite',
  },
  {
    name: 'prompt_injection_roleplay',
    severity: 'critical',
    category: 'prompt_injection',
    regex: /\byou are now\b/gi,
    confidence: 'likely',
  },
  {
    name: 'prompt_injection_template',
    severity: 'critical',
    category: 'prompt_injection',
    regex: /\{\{[^}]*\}\}/g,
    confidence: 'possible',
  },
  {
    name: 'prompt_injection_system_tag',
    severity: 'critical',
    category: 'prompt_injection',
    regex: /<instructions>|<system>|\[SYSTEM\]|\[INST\]/gi,
    confidence: 'definite',
  },

  // ── CRITICAL: Data Exfiltration ──
  {
    name: 'data_exfil_webhook',
    severity: 'critical',
    category: 'data_exfiltration',
    regex: /https?:\/\/[^\s]+\.(webhook\.site|requestbin\.com|pipedream\.net|hookbin\.com|burpcollaborator\.net)/gi,
    confidence: 'definite',
  },
  {
    name: 'data_exfil_ip_url',
    severity: 'critical',
    category: 'data_exfiltration',
    regex: /https?:\/\/\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}[\/:\s]/g,
    confidence: 'likely',
  },
  {
    name: 'data_exfil_credential',
    severity: 'critical',
    category: 'data_exfiltration',
    regex: /\b(send|post|exfiltrate|upload|transmit)\b.{0,40}\b(token|key|password|secret|credential|api.?key)\b/gi,
    confidence: 'likely',
  },

  // ── CRITICAL: Known C2 ──
  {
    name: 'known_c2_ip',
    severity: 'critical',
    category: 'network_threat',
    regex: /91\.92\.242\.30/g,
    confidence: 'definite',
  },

  // ── HIGH: Code Execution ──
  {
    name: 'code_exec_eval',
    severity: 'high',
    category: 'code_execution',
    regex: /\beval\s*\(/g,
    confidence: 'likely',
  },
  {
    name: 'code_exec_spawn',
    severity: 'high',
    category: 'code_execution',
    regex: /\b(spawn|execSync|execFile|child_process)\b/g,
    confidence: 'likely',
  },
  {
    name: 'code_exec_system',
    severity: 'high',
    category: 'code_execution',
    regex: /\b(os\.system|subprocess\.run|subprocess\.call|Popen)\s*\(/g,
    confidence: 'likely',
  },

  // ── HIGH: Environment/Filesystem ──
  {
    name: 'env_access',
    severity: 'high',
    category: 'env_access',
    regex: /process\.env\.[A-Z_]{3,}/g,
    confidence: 'possible',
    skipInRequires: true,
  },
  {
    name: 'filesystem_traversal',
    severity: 'high',
    category: 'filesystem',
    regex: /\.\.\/\.\.\//g,
    confidence: 'likely',
  },
  {
    name: 'filesystem_destructive',
    severity: 'high',
    category: 'filesystem',
    regex: /\b(unlink|rmdir|rm\s+-rf|fs\.rm)\b/g,
    confidence: 'possible',
  },

  // ── MEDIUM: Obfuscation ──
  {
    name: 'obfuscation_base64',
    severity: 'medium',
    category: 'obfuscation',
    regex: /[A-Za-z0-9+\/]{100,}={0,2}/g,
    confidence: 'possible',
  },
  {
    name: 'obfuscation_hex',
    severity: 'medium',
    category: 'obfuscation',
    regex: /(?:0x[0-9a-f]{2}[\s,]*){10,}/gi,
    confidence: 'possible',
  },
  {
    name: 'excessive_permissions',
    severity: 'medium',
    category: 'permissions',
    regex: /\b(sudo|root|admin)\b.{0,30}\b(access|permission|privilege)\b/gi,
    confidence: 'possible',
  },
];

// Popular package names for dependency confusion detection
const POPULAR_PACKAGES = new Set([
  'lodash', 'express', 'react', 'axios', 'moment', 'chalk', 'commander',
  'inquirer', 'webpack', 'babel', 'eslint', 'prettier', 'typescript',
  'next', 'nuxt', 'vue', 'angular', 'svelte', 'fastify', 'hono',
  'prisma', 'sequelize', 'mongoose', 'redis', 'pg', 'mysql',
  'openai', 'anthropic', 'langchain', 'transformers',
]);

// ─────────────────────────────────────────────────────────────────────────────
// Scanner Implementation
// ─────────────────────────────────────────────────────────────────────────────

function getLineNumber(content: string, index: number): number {
  let line = 1;
  for (let i = 0; i < index && i < content.length; i++) {
    if (content[i] === '\n') line++;
  }
  return line;
}

/** Detect the frontmatter block range to skip false positives for env access */
function getFrontmatterRange(content: string): { start: number; end: number } | null {
  const fmMatch = content.match(/^---\s*\n([\s\S]*?)\n---/);
  if (!fmMatch) return null;
  return { start: fmMatch.index!, end: fmMatch.index! + fmMatch[0].length };
}

function levenshtein(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  const dp: number[][] = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0));
  for (let i = 0; i <= m; i++) dp[i]![0] = i;
  for (let j = 0; j <= n; j++) dp[0]![j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i]![j] = a[i - 1] === b[j - 1]
        ? dp[i - 1]![j - 1]!
        : 1 + Math.min(dp[i - 1]![j]!, dp[i]![j - 1]!, dp[i - 1]![j - 1]!);
    }
  }
  return dp[m]![n]!;
}

/**
 * Scan SKILL.md content for security threats.
 *
 * Returns structured results with findings, score, and severity.
 * Pure synchronous function — safe to call in hot paths.
 */
export function scanSkillContent(content: string, skillName?: string): ScanResult {
  const start = performance.now();
  const findings: ScanFinding[] = [];
  const frontmatterRange = getFrontmatterRange(content);

  // Run all regex patterns
  for (const pattern of PATTERNS) {
    // Reset lastIndex for global regexes
    pattern.regex.lastIndex = 0;

    let match: RegExpExecArray | null;
    while ((match = pattern.regex.exec(content)) !== null) {
      // Skip matches inside frontmatter block if configured (prevents false positives
      // for env vars documented in requires: sections)
      if (pattern.skipInRequires && frontmatterRange) {
        if (match.index >= frontmatterRange.start && match.index < frontmatterRange.end) {
          continue;
        }
      }

      findings.push({
        pattern_name: pattern.name,
        severity: pattern.severity,
        category: pattern.category,
        matched_text: match[0].slice(0, 200),
        line_number: getLineNumber(content, match.index),
        confidence: pattern.confidence,
      });

      // Limit findings per pattern to avoid noise
      if (findings.filter((f) => f.pattern_name === pattern.name).length >= 5) break;
    }
  }

  // LOW: Missing metadata checks (no regex, check parsed frontmatter indirectly)
  const hasFrontmatter = content.startsWith('---');
  if (!hasFrontmatter) {
    findings.push({
      pattern_name: 'missing_frontmatter',
      severity: 'low',
      category: 'metadata',
      matched_text: 'No YAML frontmatter found',
      line_number: 1,
      confidence: 'definite',
    });
  } else {
    const fm = content.match(/^---\s*\n([\s\S]*?)\n---/);
    if (fm) {
      const fmText = fm[1]!;
      if (!fmText.includes('author:')) {
        findings.push({ pattern_name: 'missing_author', severity: 'low', category: 'metadata', matched_text: 'No author field', line_number: 1, confidence: 'definite' });
      }
      if (!fmText.includes('version:')) {
        findings.push({ pattern_name: 'missing_version', severity: 'low', category: 'metadata', matched_text: 'No version field', line_number: 1, confidence: 'definite' });
      }
      if (!fmText.includes('description:')) {
        findings.push({ pattern_name: 'missing_description', severity: 'low', category: 'metadata', matched_text: 'No description field', line_number: 1, confidence: 'definite' });
      }
    }
  }

  // LOW: Oversized content
  if (content.length > 50000) {
    findings.push({
      pattern_name: 'oversized_content',
      severity: 'low',
      category: 'metadata',
      matched_text: `Content is ${content.length} bytes (> 50KB)`,
      line_number: 1,
      confidence: 'definite',
    });
  }

  // MEDIUM: Dependency confusion
  if (skillName) {
    const nameLower = skillName.toLowerCase().replace(/[^a-z0-9]/g, '');
    for (const pkg of POPULAR_PACKAGES) {
      const dist = levenshtein(nameLower, pkg);
      if (dist > 0 && dist <= 2 && nameLower !== pkg) {
        findings.push({
          pattern_name: 'dependency_confusion',
          severity: 'medium',
          category: 'supply_chain',
          matched_text: `Name "${skillName}" is similar to popular package "${pkg}" (distance: ${dist})`,
          line_number: 0,
          confidence: 'possible',
        });
        break; // One match is enough
      }
    }
  }

  // Compute score
  let score = 100;
  for (const finding of findings) {
    score -= SEVERITY_DEDUCTIONS[finding.severity];
  }
  score = Math.max(0, score);

  // Compute max severity
  let maxSev: ScanSeverity | 'none' = 'none';
  for (const finding of findings) {
    if (SEVERITY_ORDER[finding.severity]! > SEVERITY_ORDER[maxSev]!) {
      maxSev = finding.severity;
    }
  }

  // Deduplicate threat patterns
  const threatPatterns = [...new Set(findings.map((f) => f.pattern_name))];

  const duration = performance.now() - start;

  return {
    scan_score: score,
    threat_patterns: threatPatterns,
    findings,
    max_severity: maxSev,
    scan_duration_ms: Math.round(duration * 100) / 100,
    scanner_version: SCANNER_VERSION,
  };
}
