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
  timestampMs: number,
): string {
  const hash = sha256(`${emitterAgentId}:${targetSystemId}:${timestampMs}`);
  return `rcpt_${hash.substring(0, 12)}`;
}
