import type { Logger } from '@inkibra/logger';
import compression from 'compression';
import cookieParser from 'cookie-parser';
import cors from 'cors';
import express, {
  type Application,
  json,
  type Request,
  type RequestHandler,
  type Response,
  raw,
} from 'express';
import { readFileSync } from 'fs';
import type http from 'http';
import multer from 'multer';

import {
  Context,
  type ContextDataBase,
  type ContextErrorBase,
  type ContextHandler,
} from './lib/context';
import type {
  DomainAssetHandler,
  FrontendContextFactory,
  FrontendDefinition,
} from './lib/create-frontend';
import { Frontend } from './lib/frontend';
import { initHttpLogger } from './lib/http-logger';
import { mapToMulterFields } from './lib/parse-files';
import { SessionEventProcessor } from './lib/session-event-processor';
import { TokenHandler } from './lib/token-handler';

export {
  Frontend,
  mapToMulterFields,
  TokenHandler,
  type Response as GenericResponse,
  SessionEventProcessor,
};
export { createContext } from './lib/create-context';
export {
  createFrontend,
  type DomainAssetHandler,
  type FrontendContextFactory,
  type FrontendDefinition,
} from './lib/create-frontend';
export { FaviconLinks } from './lib/favicon-links';
export { SocialMetaTags } from './lib/social-meta-tags';

export const fileParser = multer({ storage: multer.memoryStorage() });
export const bodyParser = {
  json,
  raw,
};

export class InkibraDenzel<TBaseContextData extends ContextDataBase> {
  public readonly router: Application;
  public readonly logger: Logger;
  public readonly cloudProjectName: string;
  public readonly port: number;
  private server?: http.Server;
  private isShuttingDown = false;
  private shutdownPromise?: Promise<void>;
  private developmentDomain?: string;

  // Path registry for conflict detection
  #registeredPaths = new Map<string, string>(); // path -> owner name
  #mountedFrontends: Array<FrontendDefinition<any>> = [];

  public constructor(
    logger: Logger,
    cloudProjectName: string,
    port: number,
    developmentDomain?: string,
  ) {
    this.logger = logger.child({ component: 'InkibraDenzel' });
    this.cloudProjectName = cloudProjectName;
    this.port = port;
    this.router = express().disable('x-powered-by').set('query', 'simple');
    this.developmentDomain = developmentDomain;
  }

  #beforeShutdownFunctions: (() => Promise<void>)[] = [];
  public beforeShutdown(fn: () => Promise<void>) {
    this.#beforeShutdownFunctions.push(fn);
  }

  public start(onShutdown?: () => Promise<void> | void) {
    return new Promise<void>((resolve) => {
      this.logger.info('Starting Denzel Server.', { port: this.port });
      this.server = this.router.listen(this.port);
      this.server.once('listening', () => {
        this.logger.info('Denzel Server Started', { port: this.port });
        return resolve();
      });

      this.beforeShutdown(async () => {
        if (onShutdown) {
          await onShutdown();
        }
      });

      process.once('SIGINT', () => this.shutdown());
      process.once('SIGTERM', () => this.shutdown());
      process.once('SIGPIPE', () => this.shutdown());
    });
  }

  /** Shutdown the Denzel Server */
  public async shutdown(): Promise<void> {
    // Prevent multiple shutdown calls
    if (this.isShuttingDown) {
      return this.shutdownPromise;
    }

    await Promise.all(this.#beforeShutdownFunctions.map((fn) => fn()));

    this.isShuttingDown = true;
    this.shutdownPromise = this._performShutdown();
    return this.shutdownPromise;
  }

  private async _performShutdown(): Promise<void> {
    this.logger.warn('Denzel will shutdown.', { port: this.port });

    if (!this.server) {
      this.logger.warn('No server to shutdown.');
      return;
    }

    const server = this.server;
    return new Promise<void>((resolve) => {
      // Attempt graceful shutdown
      server.close((err) => {
        if (err) {
          this.logger.error('Error during server shutdown', err);
        } else {
          this.logger.info('Server closed gracefully');
        }
        resolve();
      });
    }).finally(() => {
      this.logger.warn('Goodbye.');
    });
  }

  /**
   * Start a health check
   * @param path
   */
  public healthCheck(path: string, userAgentMatch: RegExp) {
    let healthCheckCount = 0;
    let firstHealthCheckLogged = false;

    this.router.get(path, (req, res, next) => {
      if (userAgentMatch.test(req.headers['user-agent'] as string)) {
        res.send('OK');
        if (!firstHealthCheckLogged) {
          this.logger.info('Denzel Server Reported Healthy.');
          firstHealthCheckLogged = true;
        } else {
          healthCheckCount++;
        }
      } else {
        next();
      }
    });
    const interval = setInterval(() => {
      this.logger.info(
        `Number of health checks passed last 30 seconds: ${healthCheckCount}`,
      );
      healthCheckCount = 0;
    }, 30000);

    this.beforeShutdown(() => {
      clearInterval(interval);
      return Promise.resolve();
    });

    return this;
  }

  public initHttpLogging() {
    this.router.use(
      initHttpLogger(
        this.logger.child({ component: 'http-logging', protocol: 'http' }),
      ),
    );
    return this;
  }

  public withRootRedirects(
    redirects: Array<{
      domain: string;
      basePath: string;
      statusCode?: 301 | 302;
    }>,
  ) {
    this.router.use((req, res, next) => {
      // Only handle root path requests
      if (req.path !== '/') {
        return next();
      }

      // Find matching redirect for this domain
      const redirect = redirects.find((r) => r.domain === req.hostname);
      if (!redirect) {
        return next();
      }

      // Build redirect URL preserving query params
      const redirectUrl = req.originalUrl.replace('/', redirect.basePath);
      const statusCode = redirect.statusCode ?? 302;

      this.logger.debug('Root redirect', {
        from: req.hostname + req.originalUrl,
        to: redirectUrl,
        statusCode,
      });

      res.redirect(statusCode, redirectUrl);
    });
    return this;
  }

  public initHSTS() {
    this.router.use((_, res, next) => {
      res.setHeader(
        'Strict-Transport-Security',
        'max-age=31536000; includeSubDomains; preload',
      );
      next();
    });
    return this;
  }

  public initCookieParser() {
    this.router.use(cookieParser());
    return this;
  }

  public initCompression() {
    this.router.use(
      compression({
        filter: (req, res) => {
          const acceptHeader = req.headers.accept;
          if (
            typeof acceptHeader === 'string' &&
            acceptHeader.includes('text/event-stream')
          ) {
            return false;
          }

          const responseContentType = res.getHeader('content-type');
          if (
            typeof responseContentType === 'string' &&
            responseContentType.toLowerCase().includes('text/event-stream')
          ) {
            return false;
          }

          if (typeof req.headers['x-no-compression'] === 'string') {
            return false;
          }

          return compression.filter(req, res);
        },
      }),
    );
    return this;
  }

  public initFavicon(config: { [domain: string]: string }) {
    this.router.get('/favicon.ico', (req, res, next) => {
      const host = req.hostname;
      const faviconUrl = config[host];
      if (faviconUrl) {
        res.redirect(faviconUrl);
      } else {
        next();
      }
    });
    return this;
  }
  /**
   * Initialize favicon handling based on domain mappings and assets directory.
   * This redirects well-known favicon paths to `/assets/[mappedDomain]/favicon/<file>`.
   */
  public initFaviconFromMappings(
    mappingsFilePath: string,
    options?: { assetRoot?: string; includeManifest?: boolean },
  ) {
    const assetRoot = (options?.assetRoot ?? '/assets').replace(/^\/*/, '/');
    const includeManifest = options?.includeManifest ?? true;

    // Load mappings once at startup; fallback to empty mapping if missing/invalid
    let domainMap: Record<string, string> = {};
    try {
      const raw = readFileSync(mappingsFilePath, 'utf8');
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object') {
        domainMap = parsed as Record<string, string>;
      }
    } catch {
      // ignore, fallback to empty map
    }

    const FAVICON_PATHS = new Set<string>([
      '/favicon.ico',
      '/favicon-16x16.png',
      '/favicon-32x32.png',
      '/apple-touch-icon.png',
      '/android-chrome-192x192.png',
      '/android-chrome-512x512.png',
      ...(includeManifest ? ['/site.webmanifest'] : []),
    ]);

    const getApex = (host: string): string => {
      const parts = host.split('.');
      return parts.length <= 2 ? host : parts.slice(-2).join('.');
    };

    const mapDomain = (host: string): string => {
      return domainMap[host] ?? getApex(host);
    };

    const buildAssetPath = (mappedDomain: string, pathname: string): string => {
      const file = pathname.replace(/^\//, '');
      return `${assetRoot}/${mappedDomain}/${file}`;
    };

    // Handle known favicon paths
    for (const path of FAVICON_PATHS) {
      this.router.get(path, (req, res, next) => {
        const host = req.hostname;
        const domain = mapDomain(host);
        if (!domain) return next();
        const assetPath = buildAssetPath(domain, req.path);
        res.redirect(assetPath);
      });
    }

    return this;
  }
  public withCors() {
    const corsMiddleware = cors({
      origin: true,
      credentials: true,
      allowedHeaders: [
        'Content-Type',
        'Authorization',
        'X-Inkibra-Client-ID',
        'X-Request-ID',
      ],
      exposedHeaders: ['Content-Type', 'X-Use-Authorization', 'X-Request-ID'],
    });
    this.router.options('*', corsMiddleware);
    this.router.use(corsMiddleware);
    return this;
  }

  public connectStaticAssets(pathToDirectory: string) {
    this.router.use('/dist', express.static(pathToDirectory));
    return this;
  }

  public webhook(path: string, handler: (req: Request, res: Response) => void) {
    this.router.post(path, [
      bodyParser.raw({ type: 'application/json' }),
      async (req: Request, res: Response) => {
        try {
          await handler(req, res);
        } catch (e) {
          this.logger.error('Webhook Error', e);
          if (!res.headersSent) {
            res.status(500).send('Webhook Error');
          }
        }
      },
    ]);
    return this;
  }

  /**
   * Create a routing context
   * @param middlewares The middlewares `RequestHandler[]` for this context
   * @param contextHandler The `ContextHandler` for this context that returns typed `ContextData`
   * @returns A new `Context` object
   */
  public getNewRouteContext<
    TContextData extends TBaseContextData,
    TContextErrors extends ContextErrorBase | never,
  >(
    contextName: string,
    middlewares: RequestHandler[],
    contextHandler: ContextHandler<TContextData, TContextErrors>,
  ) {
    return new Context<TContextData, TContextErrors>(
      this.logger.child({ component: 'context', contextName }),
      this.cloudProjectName,
      contextName,
      this.router,
      middlewares,
      contextHandler,
    );
  }

  /**
   * Register paths in the path registry for conflict detection
   */
  public registerPaths(paths: string[], owner: string): void {
    for (const path of paths) {
      const existing = this.#registeredPaths.get(path);
      if (existing) {
        throw new Error(
          `Path conflict: ${path} already registered by ${existing}, cannot register for ${owner}`,
        );
      }
      this.#registeredPaths.set(path, owner);
      this.logger.trace(`Registered path ${path} for ${owner}`);
    }
  }

  /**
   * Get all registered paths
   */
  public getRegisteredPaths(): ReadonlyMap<string, string> {
    return this.#registeredPaths;
  }

  /**
   * Get all mounted frontends
   */
  public getMountedFrontends(): ReadonlyArray<FrontendDefinition<any>> {
    return this.#mountedFrontends;
  }

  /**
   * Mount a frontend definition to the application
   */
  public mount<ContextData extends ContextDataBase>(
    frontendDefinition: FrontendDefinition<ContextData>,
  ): void {
    this.#mountedFrontends.push(frontendDefinition);

    const normalizedMountPath =
      frontendDefinition.mountPath === '/'
        ? '/'
        : frontendDefinition.mountPath.replace(/\/+$/, '');

    // 1. Register mount paths in path registry (base path + wildcard)
    const pathPatterns =
      normalizedMountPath === '/'
        ? ['/', '/*']
        : [normalizedMountPath, `${normalizedMountPath}/*`];

    this.registerPaths(pathPatterns, frontendDefinition.name);

    // 2. Register domain-level assets
    if (frontendDefinition.domainAssets) {
      this.#mountDomainAssets(
        frontendDefinition.domainAssets,
        frontendDefinition.allowedDomains,
        frontendDefinition.context,
      );
    }

    // 3. Create Frontend instance for render with host guard
    const hostGuard = this.#createHostGuard(frontendDefinition.allowedDomains);
    const middlewares = [hostGuard, ...(frontendDefinition.middlewares ?? [])];
    const contextProvider = () => frontendDefinition.context(this);

    new Frontend(
      pathPatterns,
      middlewares,
      frontendDefinition.render,
      contextProvider,
    );

    this.logger.info(
      `Mounted ${frontendDefinition.name} at ${frontendDefinition.mountPath}`,
    );
  }

  /**
   * Create host guard middleware
   */
  #createHostGuard(allowedDomains: string[]): RequestHandler {
    return (req, res, next) => {
      if (
        allowedDomains.includes(req.hostname) ||
        this.developmentDomain === req.hostname
      ) {
        next();
      } else {
        res.status(404).send('Not Found');
      }
    };
  }

  /**
   * Mount domain-level assets (favicon, sitemap, etc.)
   */
  #mountDomainAssets<ContextData extends ContextDataBase>(
    domainAssets: Record<string, DomainAssetHandler<ContextData>>,
    allowedDomains: string[],
    contextFactory: FrontendContextFactory<ContextData>,
  ): void {
    for (const [key, handler] of Object.entries(domainAssets)) {
      const path = `/${key}`;

      if (typeof handler === 'string') {
        // String = asset import path - redirect directly to it
        this.router.get(path, (req, res, next) => {
          if (!allowedDomains.includes(req.hostname)) {
            return next();
          }
          res.redirect(handler);
        });
      } else {
        // Function = custom renderer
        const hostGuard = this.#createHostGuard(allowedDomains);
        const contextProvider = () => contextFactory(this);

        new Frontend([path], [hostGuard], handler, contextProvider);
      }
    }
  }
}
