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

const ADJECTIVES = [
  'amber', 'azure', 'bold', 'bright', 'calm', 'clear', 'cool', 'coral',
  'crisp', 'dark', 'deep', 'dusk', 'fair', 'fast', 'fine', 'fleet',
  'frost', 'glad', 'gold', 'green', 'grey', 'haze', 'iron', 'jade',
  'keen', 'lark', 'lean', 'lime', 'live', 'mild', 'mint', 'neon',
  'nova', 'pale', 'pine', 'pure', 'rare', 'rose', 'ruby', 'rust',
  'sage', 'silk', 'slim', 'soft', 'star', 'teal', 'true', 'warm',
  'west', 'wild',
];

const ANIMALS = [
  'bear', 'crow', 'deer', 'dove', 'duck', 'eagle', 'elk', 'falcon',
  'finch', 'fox', 'frog', 'goat', 'hawk', 'heron', 'horse', 'ibis',
  'jay', 'kite', 'lark', 'lion', 'lynx', 'mink', 'moth', 'newt',
  'orca', 'otter', 'owl', 'panda', 'pike', 'puma', 'quail', 'raven',
  'robin', 'seal', 'shrike', 'snake', 'squid', 'stork', 'swan', 'tiger',
  'toad', 'trout', 'viper', 'vole', 'wasp', 'whale', 'wolf', 'wren',
  'yak', 'zebra',
];

export function generateAgentName(providerClass: string, publicKey: string): string {
  const hash = sha256(`name:${publicKey}`);
  const adjIdx = parseInt(hash.substring(0, 8), 16) % ADJECTIVES.length;
  const animalIdx = parseInt(hash.substring(8, 16), 16) % ANIMALS.length;
  return `${providerClass}-${ADJECTIVES[adjIdx]}-${ANIMALS[animalIdx]}`;
}

export function generateReceiptId(
  emitterAgentId: string,
  targetSystemId: string,
  timestampMs: number,
): string {
  const hash = sha256(`${emitterAgentId}:${targetSystemId}:${timestampMs}`);
  return `rcpt_${hash.substring(0, 12)}`;
}
