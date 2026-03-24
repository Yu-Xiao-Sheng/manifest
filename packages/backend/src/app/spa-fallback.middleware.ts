import { Injectable, NestMiddleware } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';
import * as fs from 'fs';
import * as path from 'path';
import { resolveFrontendDir } from '../common/utils/frontend-path';

/**
 * SPA Fallback Middleware
 *
 * Intercepts requests for non-API routes and returns index.html.
 * This enables client-side routing (refreshing /agents/local-agent works).
 *
 * Must be configured in AppModule to apply to all routes.
 */
@Injectable()
export class SpaFallbackMiddleware implements NestMiddleware {
  private readonly indexPath: string | null;

  constructor() {
    const frontendDir = resolveFrontendDir();
    this.indexPath = frontendDir ? path.join(frontendDir, 'index.html') : null;
  }

  use(req: Request, res: Response, next: NextFunction) {
    // Skip API routes
    if (req.path.startsWith('/api') || req.path.startsWith('/otlp') || req.path.startsWith('/v1')) {
      return next();
    }

    const frontendDir = resolveFrontendDir();
    if (frontendDir) {
      // Check if the requested file exists in the frontend directory
      const requestedFilePath = path.join(frontendDir, req.path);
      if (fs.existsSync(requestedFilePath) && fs.statSync(requestedFilePath).isFile()) {
        // File exists, let static middleware handle it
        return next();
      }
    }

    // Skip static assets (files with extensions) if they don't exist
    if (path.extname(req.path) !== '') {
      return next();
    }

    // If index.html doesn't exist, let it 404 normally
    if (!this.indexPath || !fs.existsSync(this.indexPath)) {
      return next();
    }

    // For all other routes, serve index.html (SPA routing)
    res.sendFile(this.indexPath);
  }
}
