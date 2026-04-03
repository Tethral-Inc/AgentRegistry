import pino from 'pino';

export type LoggerOptions = {
  name?: string;
  level?: string;
};

export function createLogger(options: LoggerOptions = {}): pino.Logger {
  return pino({
    name: options.name || 'acr',
    level: options.level || process.env.LOG_LEVEL || 'info',
    timestamp: pino.stdTimeFunctions.isoTime,
    formatters: {
      level(label) {
        return { level: label };
      },
    },
  });
}

export const logger = createLogger();
