import { Request, Response, NextFunction } from 'express';
import * as crypto from 'crypto';

declare global {
  namespace Express {
    interface Request {
      id?: string;
    }
  }
}

const REQUEST_ID_REGEX = /^[A-Za-z0-9._-]{1,128}$/;

/**
 * ERR-01a / Housekeeping: Middleware ensuring every incoming request has an x-request-id.
 * Validates client-supplied x-request-id against ^[A-Za-z0-9._-]{1,128}$;
 * generates a new UUID if missing, invalid format, or exceeding 128 characters.
 * Attaches the id to req.id for downstream handlers and sets x-request-id on response.
 */
export function requestIdHandler(req: Request, res: Response, next: NextFunction): void {
  const incoming = req.headers['x-request-id'];
  const trimmed = typeof incoming === 'string' ? incoming.trim() : undefined;
  const id = trimmed && REQUEST_ID_REGEX.test(trimmed) ? trimmed : crypto.randomUUID();

  req.id = id;
  if (typeof res.setHeader === 'function') {
    res.setHeader('x-request-id', id);
  }
  next();
}

