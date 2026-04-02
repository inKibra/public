import type { SessionEvent } from '../constants';

type SessionEventBusOptions = {
  generateId?: () => string;
};

export class SessionEventBus<TEvents extends SessionEvent<string, unknown>> {
  #eventSenderFunction: (event: TEvents | SessionEvent.PageViewEvent) => void;
  #generateId: () => string;

  constructor(
    eventSenderFunction: (event: TEvents | SessionEvent.PageViewEvent) => void,
    options?: SessionEventBusOptions,
  ) {
    this.#eventSenderFunction = eventSenderFunction;
    this.#generateId = options?.generateId ?? (() => crypto.randomUUID());
  }

  public generateEventId(): string {
    return this.#generateId();
  }

  public sendEvent(event: TEvents) {
    const eventWithId: TEvents = {
      ...event,
      eventId: event.eventId ?? this.generateEventId(),
    };
    this.#eventSenderFunction(eventWithId);
  }

  public sendPageView(
    data: SessionEvent.ExtractEventData<SessionEvent.PageViewEvent>,
    eventId?: string,
  ) {
    // For initial page load, use pageLoadId to dedupe with server-rendered Meta Pixel
    // For SPA navigations, generate new ID (client-originated, no server pixel to dedupe with)
    const resolvedEventId =
      eventId ?? (data.initialLoad ? data.pageLoadId : this.generateEventId());
    this.#eventSenderFunction({
      type: 'PAGE_VIEW',
      data,
      eventId: resolvedEventId,
    });
  }
}
