/**
 * Advanced tool surface toggle.
 *
 * The server registers the core seven tools by default and the full
 * surface when ACR_ADVANCED=1 (see server.ts). Tools that mention or
 * recommend other tools must check this so they never point the model
 * at a tool that isn't registered in the current mode.
 */
export function advancedEnabled(): boolean {
  return process.env.ACR_ADVANCED === '1';
}
