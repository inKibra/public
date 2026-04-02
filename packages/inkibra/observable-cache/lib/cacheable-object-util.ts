import type { ErrorDescriptor } from '@inkibra/error-base';
import { err, ok, type Result } from 'neverthrow';
import { TypeID, typeidUnboxed } from 'typeid-js';
import type { tags } from 'typia/lib';

// TODO: make __brand permanent when typia supports it, you maybe able to do this with a CustomValidator in typia...
// TODO: support https://github.com/samchon/typia/issues/911#issuecomment-2296620828
// TODO: consider adopting  https://github.com/samchon/typia/issues/911#issuecomment-2515870176
// TODO: rename BrandedId and combine with regex
// TODO: separate the concept of a Brand (the valid brand name), from a BrandedId and a BrandedSlug
export type Brand<B extends string> = B extends LowercaseAlpha<B>
  ? string & { readonly __brand?: B }
  : never;

export type BrandedSlug<B extends string> = string & {
  readonly __brand?: B;
};

type LowercaseChar =
  | 'a'
  | 'b'
  | 'c'
  | 'd'
  | 'e'
  | 'f'
  | 'g'
  | 'h'
  | 'i'
  | 'j'
  | 'k'
  | 'l'
  | 'm'
  | 'n'
  | 'o'
  | 'p'
  | 'q'
  | 'r'
  | 's'
  | 't'
  | 'u'
  | 'v'
  | 'w'
  | 'x'
  | 'y'
  | 'z';

type LowercaseAlpha<S extends string> = S extends `${infer C}${infer Rest}`
  ? C extends LowercaseChar
    ? `${C}${LowercaseAlpha<Rest>}`
    : never
  : S;

export type AssertLowercase<B extends string> = LowercaseAlpha<B> extends never
  ? ['brand must be a–z only']
  : [];

export type BrandRegex<B extends string> = tags.Pattern<`^${B}_[a-z0-9]{26}$`>;
export namespace Brand {
  export type BRAND_TYPE_MISMATCH<B extends string> = ErrorDescriptor<
    'BRAND_TYPE_MISMATCH',
    'The branded type did not match the expected value',
    {
      expectedType: B;
      foundType: string;
    }
  >;

  // TODO: rename to createId
  export function createId2<const B extends string>(
    type: B,
    ..._assert: AssertLowercase<B>
  ): Brand<B> {
    return typeidUnboxed(type) as string as Brand<B>;
  }
  export function createWithSuffix<B extends string>(
    suffix: string,
    type: B,
    ..._assert: AssertLowercase<B>
  ): Brand<B> {
    return typeidUnboxed(type, suffix) as string as Brand<B>;
  }
  export function idMatchesType<B extends string>(
    brandedId: string,
    expectedType: B,
    ..._assert: AssertLowercase<B>
  ): brandedId is Brand<B> {
    try {
      return TypeID.fromString(brandedId).getType() === expectedType;
    } catch {
      return false;
    }
  }
  export function getSuffix<B extends string>(
    brandedId: Brand<B>,
    expectedType: B,
    ..._assert: AssertLowercase<B>
  ): Result<string, BRAND_TYPE_MISMATCH<B>> {
    const typeId = TypeID.fromString(brandedId);
    const foundType = typeId.getType();
    if (expectedType !== foundType) {
      return err({
        code: 'BRAND_TYPE_MISMATCH',
        message: 'The branded type did not match the expected value',
        data: {
          expectedType,
          foundType,
        },
      });
    }
    return ok(typeId.getSuffix());
  }

  /**
   * Changes the prefix (type) of a branded ID while preserving the suffix.
   * Validates that the current prefix matches the expected value.
   *
   * @param brandedId - The current branded ID
   * @param currentPrefix - The expected current prefix/type
   * @param newPrefix - The desired new prefix/type
   * @returns A Result containing the new branded ID with the new prefix, or an error if validation fails
   */
  export function changePrefix<
    CurrentPrefix extends string,
    NewPrefix extends string,
  >(
    brandedId: Brand<CurrentPrefix>,
    currentPrefix: CurrentPrefix & LowercaseAlpha<CurrentPrefix>,
    newPrefix: NewPrefix,
    ..._assertNewPrefix: AssertLowercase<NewPrefix>
  ): Result<Brand<NewPrefix>, BRAND_TYPE_MISMATCH<CurrentPrefix>> {
    const suffixResult = getSuffix(
      brandedId,
      currentPrefix,
      ...([] as AssertLowercase<CurrentPrefix>),
    );
    if (suffixResult.isErr()) {
      return err(suffixResult.error);
    }
    return ok(
      createWithSuffix(suffixResult.value, newPrefix, ..._assertNewPrefix),
    );
  }
}
export type UNHANDLED_VALIDATION_FAILURE = ErrorDescriptor<
  'UNHANDLED_VALIDATION_FAILURE',
  'Unhandled validation failure',
  {}
>;
export abstract class CacheableObjectUtil<
  Type extends string,
  Id extends Brand<Type>,
  TData extends { id: Id; type: Type },
  CreateData,
  CreateFailures,
  ModificationData,
  DataValidationFailures,
  Options = {},
> {
  readonly options: Options;
  abstract readonly type: Type;
  constructor(options: Options) {
    this.options = options;
  }
  public createId2() {
    return typeidUnboxed(this.type) as string as Id;
  }

  // we should include a validate that checks the version
  public abstract is(data: unknown): data is TData;
  public validate(
    data: TData,
  ): Result<true, DataValidationFailures | UNHANDLED_VALIDATION_FAILURE> {
    const validates = this.is(data);

    if (!validates) {
      const validationErrors = this.getValidationErrors(data);
      if (validationErrors) {
        return err(validationErrors);
      }
      return err({
        code: 'UNHANDLED_VALIDATION_FAILURE',
        message: 'Unhandled validation failure',
        data,
      });
    }
    return ok(true);
  }
  protected abstract getValidationErrors(
    data: TData,
  ): DataValidationFailures | false;
  protected abstract fromCreateData(
    data: CreateData,
  ): Result<Readonly<TData>, CreateFailures>;
  public create(
    data: CreateData,
  ): Result<
    Readonly<TData>,
    CreateFailures | DataValidationFailures | UNHANDLED_VALIDATION_FAILURE
  > {
    const created = this.fromCreateData(data);
    if (created.isErr()) {
      return created;
    }
    const validationResult = this.validate(created.value);
    if (validationResult.isErr()) {
      return err(validationResult.error);
    }
    return ok(created.value);
  }
  protected modify(
    data: Readonly<TData>,
    modificationData: ModificationData, // Make sure modification data doesn't include id or type
  ): Result<
    Readonly<TData>,
    DataValidationFailures | UNHANDLED_VALIDATION_FAILURE
  > {
    const modified = {
      ...data,
      ...modificationData,
      modified: new Date().toISOString(),
    };
    const validationResult = this.validate(modified);
    if (validationResult.isErr()) {
      return err(validationResult.error);
    }
    return ok(modified);
  }
}
