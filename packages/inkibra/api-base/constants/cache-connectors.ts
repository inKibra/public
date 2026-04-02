import type { ObservableCache } from '@inkibra/observable-cache';
import { createContext } from 'react';

// TODO: this provides a good formula for how we could be managing the cache
// right now each of the children need to subscribe to the cache to get its updates
// however what if we subscribe here and then pass down a new cache getter to the children
// we do the cache getter because we want to make sure the children are not able to modify the cache
// we could also explore a deep freeze of the cache object or a deep readonly type or immutable.js

// this will unlock server side rendering because we can access the hydrated cache synchronously

// We can basically the observableCache.latestAsObject getter not return a promise anymore
// and instead we'll just have it be the latest cache object when that cache snapshot
// was created. This will allow us to hydrate the cache on the server and then pass it down

export const CacheContext = createContext<() => ObservableCache>(() => {
  throw new ReferenceError('CacheContext Not Started');
});
