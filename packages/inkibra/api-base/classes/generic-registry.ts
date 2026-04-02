/**
 * Type helper to ensure no extra properties are present in SubType that are not in Type.
 * @template Type - The base type.
 * @template SubType - The subtype, which extends the base type.
 */
type NoExtraProperties<Type, SubType extends Type = Type> = SubType & {
  [Key in Exclude<keyof SubType, keyof Type>]: never;
};

/**
 * A generic registry class for managing a collection of items.
 * @template RegistryType - The type of items in the registry.
 *
 * @example
 * ```typescript
 * const exampleRegistry = GenericRegistry.init({
 *   'foo': { name: 'foo' },
 *   'bar': { name: 'bar' },
 *   'baz': { name: 'baz' }
 * });
 *
 * const convertedRegistryFailure = exampleRegistry.matchWithAll((entries) => ({
 *   'foo': ({ name: entries.foo.name }),
 *   'bar': ({ name: entries.bar.name })
 * }));
 *
 * const convertedRegistrySuccess = exampleRegistry.matchWithAll((entries) => ({
 *   'foo': ({ name: entries.foo.name }),
 *   'bar': ({ name: entries.bar.name }),
 *   'baz': ({ name: entries.baz.name })
 * }));
 * ```
 */
export class GenericRegistry<RegistryType extends object> {
  /**
   * Constructs a new `GenericRegistry` instance.
   * @param registry - The initial registry.
   */
  private constructor(protected registry: NoExtraProperties<RegistryType>) {}

  /**
   * Initializes a new `GenericRegistry` instance with the given registry.
   * @template InitType - The type of items in the initial registry.
   * @param registry - The initial registry.
   * @returns A new `GenericRegistry` instance.
   */
  public static init<InitType extends { [K in keyof InitType]: { name: K } }>(
    registry: NoExtraProperties<InitType>,
  ): GenericRegistry<InitType> {
    return new GenericRegistry(registry);
  }

  /**
   * Registers a new service in the registry.
   * @template Key - The key type.
   * @template Service - The service type.
   * @param key - The key of the service.
   * @param service - The service to register.
   * @returns The updated registry.
   * @deprecated Use `init()` instead.
   */
  public register<
    Key extends string | number | symbol,
    Service extends { name: Key },
  >(
    key: Key,
    service: Service,
  ): GenericRegistry<Record<Key, Service> & RegistryType> {
    // biome-ignore lint/suspicious/noExplicitAny: This operation needs to cast to any to allow the type to be set dynamically.
    (this.registry as any)[key] = service;
    return this as unknown as GenericRegistry<
      Record<Key, Service> & RegistryType
    >;
  }

  /**
   * @deprecated Use `init()` instead.
   */
  public unregister<Key extends keyof RegistryType>(
    key: Key,
  ): GenericRegistry<Omit<RegistryType, Key>> {
    const { [key]: _, ...rest } = this.registry;
    return new GenericRegistry(rest);
  }

  /**
   * Retrieves a service from the registry by its key.
   * @template Key - The key type.
   * @param key - The key of the service.
   * @returns The service associated with the key.
   * @throws {Error} If the key is not in the registry.
   */
  public get<Key extends keyof RegistryType>(key: Key): RegistryType[Key] {
    if (!(key in this.registry)) {
      throw new RangeError(`Key ${key.toString()} not in registry.`);
    }
    return this.registry[key];
  }

  /**
   * Retrieves all services in the registry.
   * @returns The entire registry.
   */
  public getAll(): RegistryType {
    return this.registry;
  }

  /**
   * Merges another registry into this one.
   * @template MergeType - The type of items in the other registry.
   * @param otherRegistry - The other registry to merge.
   * @returns A new `GenericRegistry` instance with the merged registries.
   */
  public merge<MergeType extends object>(
    otherRegistry: GenericRegistry<MergeType>,
  ): GenericRegistry<RegistryType & MergeType> {
    const newRegistry = { ...this.registry, ...otherRegistry.getAll() };
    return new GenericRegistry<RegistryType & MergeType>(newRegistry);
  }

  /**
   * Creates a new `Matcher` instance.
   * @returns A new `Matcher` instance.
   * @example
   * ```typescript
   * const exampleRegistry = GenericRegistry
   *  .init({})
   * .register('foo', { name: 'foo' })
   * .register('bar', { name: 'bar' })
   * .register('baz', { name: 'baz' });
   *
   * const convertedRegistrySuccess = exampleRegistry.match()
   *  .with('foo', (entry) => ({ name: entry.name }))
   * .with('bar', (entry) => ({ name: entry.name }))
   * .with('baz', (entry) => ({ name: entry.name }))
   * .exhaustive();
   * ```
   * @deprecated
   */
  public match() {
    return new Matcher(this, new GenericRegistry({}));
  }

  /**
   * Matches the registry using the provided conversion function.
   * @template ConvertedType - The type of the converted registry.
   * @param convertFn - The conversion function.
   * @returns A new `GenericRegistry` instance with the converted items.
   */
  public matchWithAll<
    ConvertedType extends { [K in keyof RegistryType]: { name: K } },
  >(
    convertFn: (registry: RegistryType) => NoExtraProperties<ConvertedType>,
  ): GenericRegistry<ConvertedType> {
    const converted = convertFn(this.registry);
    return GenericRegistry.init<NoExtraProperties<ConvertedType>>(converted);
  }

  /**
   * Sets the registry of the current instance to the registry of the provided `GenericRegistry` instance.
   *
   * @param implementation - The `GenericRegistry` instance with the implementation to use.
   * @returns void
   */
  public implement(implementation: GenericRegistry<RegistryType>): void {
    this.registry = implementation.registry;
  }
}

/**
 * A converter function type.
 * @template InputType - The input type.
 * @template ReturnType - The return type.
 */
type Converter<
  InputType,
  Key extends string | number | symbol,
  ReturnType extends { name: Key },
> = (entry: InputType) => ReturnType;

/**
 * Type helper to ensure that all keys in MatcherType are present in ConvertedType.
 * If not, the type resolves to never.
 * @template MatcherType - The base type.
 * @template ConvertedType - The subtype, which extends the base type.
 */
type FullyConvertedMatcher<
  MatcherType extends object,
  ConvertedType extends object,
> = Exclude<keyof MatcherType, keyof ConvertedType> extends never
  ? Matcher<MatcherType, ConvertedType>
  : never;

/**
 * A class to match and convert items in a registry.
 * @template MatcherType - The type of items in the registry to match.
 * @template ConvertedType - The type of the converted items.
 *
 * @example
 * ```typescript
 * const exampleRegistry = GenericRegistry
 *   .init({})
 *   .register('foo', { name: 'foo' })
 *   .register('bar', { name: 'bar' })
 *   .register('baz', { name: 'baz' });
 *
 * const convertedRegistryFailure = exampleRegistry.match()
 *   .with('foo', (entry) => ({ name: entry.name }))
 *   .with('bar', (entry) => ({ name: entry.name }))
 *   .exhaustive();
 *
 * const convertedRegistrySuccess = exampleRegistry.match()
 *   .with('foo', (entry) => ({ name: entry.name }))
 *   .with('bar', (entry) => ({ name: entry.name }))
 *   .with('baz', (entry) => ({ name: entry.name }))
 *   .exhaustive();
 * ```
 */
class Matcher<MatcherType extends object, ConvertedType extends object> {
  /**
   * Constructs a new `Matcher` instance.
   * @param registry - The registry to match against.
   * @param matched - The matched and converted items.
   */
  public constructor(
    private registry: GenericRegistry<MatcherType>,
    private matched: GenericRegistry<ConvertedType>,
  ) {}

  /**
   * Converts a key to the new registry
   * @template Key - The key type.
   * @param key - The key to add a converter for.
   * @param converted - The converter function.
   * @returns A new Matcher instance with the added converter.
   */
  public with<
    Key extends keyof MatcherType,
    NewReturnType extends { name: Key },
  >(key: Key, converter: Converter<MatcherType[Key], Key, NewReturnType>) {
    const converted = converter(this.registry.get(key));
    const matched = this.matched.register(key, converted);
    return new Matcher(this.registry.unregister(key), matched);
  }

  /**
   * Converts all items in the registry using the added converters.
   * @param this - The `Matcher` instance.
   * @returns A new `GenericRegistry` instance with the converted items.
   * @throws {Error} If a converter is not provided for a key.
   */
  public exhaustive(this: FullyConvertedMatcher<MatcherType, ConvertedType>) {
    // Make sure all keys are converted
    const keys = Object.keys(this.registry.getAll());
    const convertedKeys = Object.keys(this.matched.getAll());
    const missingKeys = keys.filter((key) => !convertedKeys.includes(key));
    if (missingKeys.length > 0) {
      throw new TypeError(
        `Missing converters for keys: ${missingKeys.join(', ')}`,
      );
    }
    return this.matched;
  }
}
