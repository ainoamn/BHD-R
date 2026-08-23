import pino from 'pino';

const REDACTED_PATHS = [
  'password',
  '*.password',
  '*.secret',
  '*.token',
  '*.authorization',
  '*.cookie',
  'job.data.recipient',
  'job.data.html',
  'job.data.text',
  'err.config.headers.Authorization',
];

export const logger = pino({
  level: process.env.LOG_LEVEL ?? 'info',
  base: { service: 'bhd-r-worker' },
  redact: { paths: REDACTED_PATHS, censor: '[REDACTED]' },
  serializers: {
    err(error: Error) {
      return { type: error.name, message: error.message, stack: error.stack };
    },
  },
});
