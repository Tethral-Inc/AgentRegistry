/**
 * Composition scanner — reads Claude Code configuration files and
 * builds a composition object suitable for POST to the ACR API.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join, relative, basename } from 'node:path';
import { homedir } from 'node:os';
import { hashSkillFile } from './hash.js';

export interface Component {
  id: string;
  name?: string;
  version?: string;
  sub_components?: Array<{ id: string; name?: string; type?: string }>;
}

export interface Composition {
  skill_hashes: string[];
  skills: string[];
  mcps: string[];
  skill_components: Component[];
  mcp_components: Component[];
}

function readJsonSafe(path: string): Record<string, unknown> | null {
  try {
    return JSON.parse(readFileSync(path, 'utf-8')) as Record<string, unknown>;
  } catch {
    return null;
  }
}

const MAX_WALK_DEPTH = 5;

/**
 * Recursively find all .md files under a directory.
 * Uses withFileTypes to avoid per-entry statSync calls.
 * Depth-limited to guard against symlink cycles.
 */
function findMarkdownFiles(dir: string): string[] {
  const results: string[] = [];
  const walk = (d: string, depth: number): void => {
    if (depth > MAX_WALK_DEPTH) return;
    let entries: import('node:fs').Dirent[];
    try { entries = readdirSync(d, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      const full = join(d, entry.name);
      if (entry.isDirectory()) walk(full, depth + 1);
      else if (entry.name.endsWith('.md')) results.push(full);
    }
  };
  walk(dir, 0);
  return results;
}

/**
 * Parse mcpServers from a Claude Code settings.json into MCP components.
 */
function parseMcpServers(settings: Record<string, unknown>): Component[] {
  const servers = settings.mcpServers as Record<string, unknown> | undefined;
  if (!servers || typeof servers !== 'object') return [];

  const components: Component[] = [];
  for (const [name, config] of Object.entries(servers)) {
    if (!config || typeof config !== 'object') continue;
    const cfg = config as Record<string, unknown>;

    // Build a version string from command + first meaningful arg
    let version: string | undefined;
    const command = cfg.command as string | undefined;
    const args = cfg.args as string[] | undefined;
    if (command) {
      const pkg = args?.find((a: string) => !a.startsWith('-') && a !== '-y') ?? '';
      version = pkg ? `${command} ${pkg}` : command;
    }

    components.push({ id: name, name, version });
  }
  return components;
}

/**
 * Scan skill files from a directory, returning hashes and components.
 */
function scanSkillDir(
  dir: string,
  baseDir: string,
): { hashes: string[]; names: string[]; components: Component[] } {
  const files = findMarkdownFiles(dir);
  const hashes: string[] = [];
  const names: string[] = [];
  const components: Component[] = [];

  for (const file of files) {
    try {
      const content = readFileSync(file, 'utf-8');
      const hash = hashSkillFile(content);
      const rel = relative(baseDir, file);
      const name = basename(file, '.md');

      hashes.push(hash);
      names.push(name);
      components.push({ id: rel, name });
    } catch { /* skip unreadable files */ }
  }

  return { hashes, names, components };
}

/**
 * Scan all Claude Code configuration sources and build a Composition.
 */
export function scanComposition(projectDir: string): Composition {
  const home = homedir();
  const globalClaudeDir = join(home, '.claude');
  const projectClaudeDir = join(projectDir, '.claude');

  // MCPs from settings.json (global + project, deduped by name)
  const mcpMap = new Map<string, Component>();

  const globalSettings = readJsonSafe(join(globalClaudeDir, 'settings.json'));
  if (globalSettings) {
    for (const c of parseMcpServers(globalSettings)) mcpMap.set(c.id, c);
  }

  const projectSettings = readJsonSafe(join(projectClaudeDir, 'settings.json'));
  if (projectSettings) {
    for (const c of parseMcpServers(projectSettings)) mcpMap.set(c.id, c);
  }

  // Also check .mcp.json at project root (alternative MCP config location)
  const mcpJson = readJsonSafe(join(projectDir, '.mcp.json'));
  if (mcpJson) {
    for (const c of parseMcpServers(mcpJson)) mcpMap.set(c.id, c);
  }

  // Skills from skills/ dirs (global + project)
  const allHashes: string[] = [];
  const allNames: string[] = [];
  const allSkillComponents: Component[] = [];

  const globalSkills = scanSkillDir(join(globalClaudeDir, 'skills'), globalClaudeDir);
  allHashes.push(...globalSkills.hashes);
  allNames.push(...globalSkills.names);
  allSkillComponents.push(...globalSkills.components);

  const projectSkills = scanSkillDir(join(projectClaudeDir, 'skills'), projectClaudeDir);
  allHashes.push(...projectSkills.hashes);
  allNames.push(...projectSkills.names);
  allSkillComponents.push(...projectSkills.components);

  const mcpComponents = [...mcpMap.values()];

  return {
    skill_hashes: allHashes,
    skills: allNames,
    mcps: mcpComponents.map((c) => c.id),
    skill_components: allSkillComponents,
    mcp_components: mcpComponents,
  };
}
