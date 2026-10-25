import { Injectable, NestMiddleware } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';
import * as crypto from 'crypto';

declare global {
  namespace Express {
    interface Request {
      id?: string;
    }
  }
}

/**
 * ERR-01a: Middleware ensuring every incoming request has an x-request-id.
 * Attaches the id to req.id for downstream handlers and sets x-request-id on response.
 */
@Injectable()
export class RequestIdMiddleware implements NestMiddleware {
  use(req: Request, res: Response, next: NextFunction): void {
    const incoming = req.headers['x-request-id'];
    const id =
      typeof incoming === 'string' && incoming.trim()
        ? incoming.trim()
        : crypto.randomUUID();

    req.id = id;
    if (typeof res.setHeader === 'function') {
      res.setHeader('x-request-id', id);
    }
    next();
  }
}

export function requestIdHandler(req: Request, res: Response, next: NextFunction): void {
  const incoming = req.headers['x-request-id'];
  const id =
    typeof incoming === 'string' && incoming.trim()
      ? incoming.trim()
      : crypto.randomUUID();

  req.id = id;
  if (typeof res.setHeader === 'function') {
    res.setHeader('x-request-id', id);
  }
  next();
}
