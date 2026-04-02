/**
 * @deprecated use FetchProvider dedicated methods instead
 */
export namespace InkibraStorageProxy {
  type StorageCallBack = (key: string, value: unknown) => void;

  /**
   * Transparently make an object proxy its values into and from storage.
   * @param domain the domain for the storage
   * @param storageObject the object that we are store into
   * @param storageEngine the storage engine itself (eg. localStorage)
   */
  export function makeStorageProxy<T extends Record<string, unknown>>(
    domain: string,
    storageObject: T,
    storageEngine: Storage,
    cb?: StorageCallBack,
  ) {
    return new Proxy(storageObject, {
      set: (_, prop, value) => {
        const key = `${domain}.${String(prop)}`;
        if (cb) {
          cb(key, value);
        }
        if (value === undefined) {
          storageEngine.removeItem(`${domain}.${String(prop)}`);
        } else {
          storageEngine.setItem(`${domain}.${String(prop)}`, value);
        }
        return true;
      },
      get: (_obj, prop) => {
        return storageEngine.getItem(`${domain}.${String(prop)}`);
      },
    });
  }
}
