/**
 * Auto-detect execution environment for ACR observability.
 * Captures device class, platform, architecture at startup.
 * Env var overrides: ACR_DEVICE_CLASS, ACR_PLATFORM, ACR_ARCH.
 */
import { totalmem, release } from 'node:os';

export interface EnvironmentContext {
  device_class: 'desktop' | 'server' | 'sbc' | 'mobile' | 'unknown';
  platform: string;
  arch: string;
  client_type?: string;
  transport_type: 'stdio' | 'streamable-http';
}

function inferDeviceClass(): EnvironmentContext['device_class'] {
  const override = process.env.ACR_DEVICE_CLASS;
  if (override) return override as EnvironmentContext['device_class'];

  const memGB = totalmem() / (1024 ** 3);
  if (memGB < 2) return 'sbc';
  if (memGB < 4) return 'mobile';
  return 'desktop';
}

export function detectEnvironment(
  transportType: 'stdio' | 'streamable-http',
): EnvironmentContext {
  return {
    device_class: inferDeviceClass(),
    platform: process.env.ACR_PLATFORM ?? process.platform,
    arch: process.env.ACR_ARCH ?? process.arch,
    transport_type: transportType,
  };
}

/** OS release string, useful for debugging but not stored by default. */
export function getOsRelease(): string {
  return release();
}
