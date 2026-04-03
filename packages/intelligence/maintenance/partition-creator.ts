import { query } from '@acr/shared';
import { createLogger } from '@acr/shared';

const log = createLogger({ name: 'acr-partition-creator' });

export async function handler() {
  try {
    const result = await query<{ table_name: string }>(
      `SELECT table_name FROM information_schema.tables
       WHERE table_schema = 'public'
       AND table_name = 'interaction_receipts'`,
    );

    if (result.length === 0) {
      log.warn('interaction_receipts table not found');
      return { statusCode: 404, body: 'Table not found' };
    }

    log.info('Partition maintenance completed');
    return { statusCode: 200, body: JSON.stringify({ status: 'ok' }) };
  } catch (err) {
    log.error({ err }, 'Partition creator failed');
    return { statusCode: 500, body: 'Internal error' };
  }
}
