import type { Logger } from '@inkibra/logger';
import type express from 'express';

export function initHttpLogger(logger: Logger, timeout = 30000) {
  return (
    req: express.Request,
    res: express.Response,
    next: express.NextFunction,
  ) => {
    let sent = false;
    let timeoutId: Timer | undefined;
    const isEventStreamRequest =
      typeof req.headers.accept === 'string' &&
      req.headers.accept.includes('text/event-stream');
    function log() {
      if (
        req.path !== '/ping' &&
        req.headers['user-agent'] !== 'GoogleHC/1.0'
      ) {
        logger.info('Denzel HTTP Request Handled:', {
          ip: req.ip,
          ips: req.ips,
          req,
          res,
          resHeaders: res.getHeaders(),
        });
      }
      sent = true;
      if (timeoutId) {
        clearTimeout(timeoutId);
        timeoutId = undefined;
      }
    }
    if (!isEventStreamRequest) {
      timeoutId = setTimeout(() => {
        if (!sent) {
          res.removeListener('finish', log);
          logger.info('Denzel HTTP Request Timed Out:', {
            ip: req.ip,
            ips: req.ips,
            req,
          });
        }
      }, timeout);
    }
    res.once('finish', log);
    return next();
  };
}
