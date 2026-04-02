import * as Immutable from 'immutable';
import { BehaviorSubject, forkJoin, merge, type Observable } from 'rxjs';
import { map, shareReplay, take } from 'rxjs/operators';

export { Subscription } from 'rxjs';
export * from './lib/array-utils';
export * from './lib/cacheable-object-util';
export * from './lib/cursor';
export * from './lib/filter';

export interface ObjectCache<T extends CacheableObject> {
  [key: string]: T;
}

export type CacheableObject = {
  id: string;
  type: string;
  deleted?: string;
};

function accumulator<T extends CacheableObject = CacheableObject>(
  current: Immutable.Map<string, T>,
  next: T | T[],
) {
  if (Array.isArray(next)) {
    let merged = current;
    const collectedObj = next.reduce(
      (prev, curr) => {
        // Skip objects that have a deleted property that is not undefined
        if (curr.deleted !== undefined) {
          // Remove from cache if it exists
          merged = merged.remove(curr.id);
          return prev;
        }
        prev[curr.id] = curr;
        merged = merged.remove(curr.id);
        return prev;
      },
      {} as { [key: string]: T },
    );
    merged = merged.mergeDeep(collectedObj);
    return merged;
  }

  // Handle single object case
  if (next.deleted !== undefined) {
    // Remove from cache if it exists
    return current.remove(next.id);
  }

  const obj = {
    [next.id]: next,
  };
  const merged = current.remove(next.id).mergeDeep(obj);
  return merged;
}

export class ObservableCache<T extends CacheableObject = CacheableObject> {
  #observablesToZip: Observable<CacheableObject | CacheableObject[]>[] = [];
  #cacheSubject: BehaviorSubject<Immutable.Map<string, CacheableObject>> =
    new BehaviorSubject(Immutable.Map<string, CacheableObject>());
  #observable: Observable<Immutable.Map<string, CacheableObject>>;
  #input: BehaviorSubject<CacheableObject | CacheableObject[]>;
  constructor(debounceTimeInMS = 0) {
    this.#input = new BehaviorSubject<CacheableObject | CacheableObject[]>({
      id: 'ObservableCache',
      type: 'ObservableCache',
    });
    this.#observable = this.#cacheSubject.asObservable();
    this.clear(debounceTimeInMS);
  }
  // TODO: allow clear to work (https://blog.angular-university.io/rxjs-error-handling/ The Catch and Replace Strategy)
  private clear(_: number) {
    this.#input = new BehaviorSubject<CacheableObject | CacheableObject[]>({
      id: 'ObservableCache',
      type: 'ObservableCache',
    });

    this.#observable = this.#cacheSubject.asObservable();

    let state = Immutable.Map<string, CacheableObject>();
    this.#input.subscribe((newData) => {
      state = accumulator(state, newData);
      this.#cacheSubject.next(state);
    });
    // NOTE: This primes the cache so future take(1)s work
  }
  /** Adds observables to the cache */
  public add(observables: Observable<CacheableObject | CacheableObject[]>[]) {
    this.#observablesToZip = this.#observablesToZip.concat(observables);
  }
  public fire() {
    forkJoin(this.#observablesToZip).subscribe(
      (data) => {
        data.forEach((entry) => this.input.next(entry));
      },
      undefined,
      () => {
        this.input.complete();
      },
    );
  }
  public connect() {
    merge(this.#observablesToZip).subscribe((data) => {
      void data.forEach((entry) => this.input.next(entry));
    });
  }
  public get input(): BehaviorSubject<CacheableObject | CacheableObject[]> {
    return this.#input;
  }
  public get rawObservable() {
    return this.#observable.pipe(shareReplay(1));
  }
  get objectObservable(): Observable<ObjectCache<T>> {
    return this.rawObservable.pipe(map((obj) => obj.toJS() as ObjectCache<T>));
  }
  get latest() {
    return this.#cacheSubject.value.toJS() as ObjectCache<T>;
  }
  get latestAsObject(): Promise<ObjectCache<T>> {
    const objectCache = this.objectObservable.pipe(take(1)).toPromise();
    return objectCache;
  }
  get arrayObservable(): Observable<T[]> {
    return this.objectObservable.pipe(
      map((itemObj) => {
        return Object.values(itemObj);
      }),
    );
  }
  get latestAsArray(): Promise<T[]> {
    const objectCache = this.arrayObservable.pipe(take(1)).toPromise();
    return objectCache;
  }
}
