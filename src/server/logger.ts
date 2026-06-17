import pino from 'pino';

export const logger = pino({
  level: process.env.LOG_LEVEL || 'warn',
  transport: {
    target: 'pino-pretty',
    options: {
      colorize: true,
      translateTime: 'SYS:standard',
    },
  },
});
