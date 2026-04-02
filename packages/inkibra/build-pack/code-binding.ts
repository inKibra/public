type AnyCodeBindingFunction = (...args: any[]) => any;

/**
 * Generic compile-time marker for function-style code bindings.
 *
 * Consumers can provide wrapper APIs with framework-specific typing while
 * reusing this generic marker name and semantics.
 */
export function defineCodeBinding<TFn extends AnyCodeBindingFunction>(
  _fn: TFn,
): TFn {
  throw new Error(
    'defineCodeBinding() is a compile-time marker. Enable the corresponding build-pack transform plugin.',
  );
}
