/**
 * Hashing utilities — inlined from shared/crypto/hash.ts.
 * Duplicated to keep the published package zero-dependency.
 * Must produce identical output to the shared versions.
 */
import { createHash } from 'node:crypto';

export function sha256(data: string): string {
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
