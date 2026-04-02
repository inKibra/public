export type SessionEvent<TType extends string, TData> = {
  type: TType;
  data: TData;
  /*
   * For event deduplication
   */
  eventId?: string;
};

export namespace SessionEvent {
  export type PageViewEvent = SessionEvent<
    'PAGE_VIEW',
    {
      url: string;
      initialLoad: boolean;
      pageLoadId: string;
    }
  >;
  export type PageRequestEvent = SessionEvent<
    'PAGE_REQUEST',
    {
      path: string;
    }
  >;

  export type ExtractEventData<TEvent extends SessionEvent<string, unknown>> =
    TEvent['data'];
}
