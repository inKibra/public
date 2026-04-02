import type { SessionEvent } from '@inkibra/api-base';
import type { Logger } from '@inkibra/logger';

type EventHandler<TEvent extends SessionEvent<string, unknown>, TContext> = (
  event: TEvent,
  context: TContext,
) => void;

type SpecificEventHandler<
  TEvents extends SessionEvent<string, unknown>,
  TContextData,
> = {
  [K in TEvents as K['type']]: EventHandler<K, TContextData> | undefined;
};

export class SessionEventProcessor<
  TContextData,
  TEvents extends SessionEvent<string, unknown>,
> {
  #logger: Logger;
  #handler: EventHandler<TEvents, TContextData>;
  #handlers: SpecificEventHandler<TEvents, TContextData>;

  constructor(
    logger: Logger,
    handler: EventHandler<TEvents, TContextData>,
    handlers: SpecificEventHandler<TEvents, TContextData>,
  ) {
    this.#logger = logger.child({ component: 'EventProcessor' });
    this.#handler = handler;
    this.#handlers = handlers;
  }
  private logEvent(
    event: TEvents | SessionEvent.PageViewEvent,
    context: TContextData,
  ) {
    this.#logger.info('Session Event', { event, context });
  }
  public processEvent(
    event: TEvents | SessionEvent.PageViewEvent,
    context: TContextData,
  ) {
    this.logEvent(event, context);

    const handler =
      this.#handlers[
        event.type as keyof SpecificEventHandler<TEvents, TContextData>
      ];
    if (event.type !== 'PAGE_VIEW') {
      this.#handler(event as TEvents, context);
    }
    if (typeof handler === 'function') {
      return handler(event, context);
    }
    this.#logger.trace('No handler for event', { event, context });
  }
}
