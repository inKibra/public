import type { RequestHandler, Response } from 'express';
import type { Context, ContextDataBase, ContextErrorBase } from './context';
import { fromAnyError } from './error-utils';
import { guardAsyncMiddleware, type TRequest } from './safe-express';

export type FrontendImplementation<ContextData extends ContextDataBase> = (
  location: string,
  ctx: ContextData,
  res: Response,
  req: TRequest,
) => void;

export class Frontend<ContextData extends ContextDataBase> {
  public readonly paths: string[];
  private readonly implementation: FrontendImplementation<ContextData>;
  private readonly middlewares: RequestHandler[];

  private readonly contextProvider: () => Context<
    ContextData,
    ContextErrorBase
  >;

  public constructor(
    paths: string[],
    middlewares: RequestHandler[],
    implementation: FrontendImplementation<ContextData>,
    contextProvider: () => Context<ContextData, ContextErrorBase>,
  ) {
    this.paths = paths;
    this.middlewares = middlewares;
    this.implementation = implementation;
    this.contextProvider = contextProvider;
    process.nextTick(() => {
      this.handleFrontend();
    });
  }
  private handleFrontend() {
    this.contextProvider().logger.trace('Attaching frontend to context.', this);
    this.contextProvider().router.get(
      this.paths,
      ...this.contextProvider()
        .middlewares.concat(this.middlewares)
        .map((middleware) =>
          guardAsyncMiddleware(this.contextProvider().logger, middleware),
        ),
      async (req, res) => {
        try {
          const ctx = await this.contextProvider().handler(
            this.contextProvider().logger,
            req,
            res,
          );
          if (ctx.isErr()) {
            const standardError = fromAnyError(ctx.error);
            res.statusCode = standardError.status;
            res.type('json');
            this.contextProvider().logger.error(
              `Error handling frontend context: ${standardError.message}`,
              standardError,
            );
            return res.send(standardError.clientView);
          }
          res.type('html');
          return this.implementation(req.url, ctx.value, res, req);
        } catch (error) {
          const standardError = fromAnyError(error);
          res.statusCode = standardError.status;
          res.type('json');
          this.contextProvider().logger.error(
            `Error handling frontend: ${standardError.message}`,
            standardError,
          );
          return res.send(standardError.clientView);
        }
      },
    );
  }
}
