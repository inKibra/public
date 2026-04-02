export type Filter<T, K extends keyof T> = Partial<{
  [P in keyof T]: P extends K
    ? T[P] extends number | undefined
      ? Filter.NumberFilter
      : T[P] extends string | undefined
        ? Filter.StringFilter
        : T[P] extends boolean | undefined
          ? Filter.BooleanFilter
          : T[P] extends Array<infer U> | undefined
            ? U extends number
              ? Filter.NumberArrayFilter
              : U extends string
                ? Filter.StringArrayFilter
                : never
            : never
    : never;
}>;

export namespace Filter {
  export type Filters =
    | StringFilter
    | NumberFilter
    | BooleanFilter
    | StringArrayFilter
    | NumberArrayFilter;

  export enum Operators {
    GREATER_THAN = 'gt',
    GREATER_THAN_OR_EQUAL = 'gte',
    LESS_THAN = 'lt',
    LESS_THAN_OR_EQUAL = 'lte',
    BETWEEN = 'bt',
    EQUAL = 'eq',
    LIKE_AND = 'likeAnd',
    LIKE_OR = 'likeOr',
    NOT_EQUAL = 'notEq',
    IN = 'in',
    NOT_IN = 'notIn',
    ANY_IN = 'anyIn',
    EVERY_IN = 'everyIn',
    NOT_ANY_IN = 'notAnyIn',
    NOT_EVERY_IN = 'notEveryIn',
  }

  export type NumberFilter =
    | {
        operator:
          | Operators.EQUAL
          | Operators.NOT_EQUAL
          | Operators.GREATER_THAN
          | Operators.LESS_THAN
          | Operators.GREATER_THAN_OR_EQUAL
          | Operators.LESS_THAN_OR_EQUAL;
        value: number;
      }
    | {
        operator: Operators.IN | Operators.NOT_IN;
        values: number[];
      }
    | {
        operator: Operators.BETWEEN;
        firstValue: number;
        secondValue: number;
      };

  export type StringFilter =
    | {
        operator:
          | Operators.EQUAL
          | Operators.NOT_EQUAL
          | Operators.GREATER_THAN
          | Operators.LESS_THAN;
        value: string;
      }
    | {
        operator: Operators.IN | Operators.NOT_IN;
        values: string[];
      }
    | {
        operator: Operators.LIKE_AND | Operators.LIKE_OR;
        values: string[];
      };

  export type BooleanFilter = {
    operator: Operators.EQUAL | Operators.NOT_EQUAL;
    value: boolean;
  };

  export type StringArrayFilter = {
    operator:
      | Operators.ANY_IN
      | Operators.EVERY_IN
      | Operators.NOT_ANY_IN
      | Operators.NOT_EVERY_IN;
    values: string[];
  };

  export type NumberArrayFilter = {
    operator:
      | Operators.ANY_IN
      | Operators.EVERY_IN
      | Operators.NOT_ANY_IN
      | Operators.NOT_EVERY_IN;
    values: number[];
  };
}

/**
 * Extract sortable keys from filterable keys.
 * Only string and number types are orderable (can use >, < operators).
 * Boolean and array types are excluded as they don't support ordering.
 */
export type SortableKeys<T, K extends keyof T> = {
  [P in K]: T[P] extends string | number ? P : never;
}[K];

/**
 * Generic cursor page info for cursor-based pagination.
 *
 * @typeParam TItem - The item type (must have an `id` field)
 * @typeParam TFilterableKeys - Keys that are filterable (constrained by DAL indexes)
 * @typeParam TSortKey - The key to sort/cursor by (must be sortable - string or number)
 *
 * @example
 * ```typescript
 * // For messages sorted by 'created' date
 * type MessagePageInfo = CursorPageInfo<Message, 'ownerId' | 'created', 'created'>;
 * ```
 */
export type CursorPageInfo<
  TItem extends { id: string },
  TFilterableKeys extends keyof TItem,
  TSortKey extends SortableKeys<TItem, TFilterableKeys>,
> = {
  /** The field the cursor is based on */
  sortKey: TSortKey;
  /** Cursor boundaries for the returned page */
  cursor: {
    /** Value of sort key for the first item in the page */
    first: TItem[TSortKey];
    /** ID of the first item */
    firstId: TItem['id'];
    /** Value of sort key for the last item in the page */
    last: TItem[TSortKey];
    /** ID of the last item */
    lastId: TItem['id'];
  };
  /** True if more items exist before the first item in this page */
  hasBefore: boolean;
  /** True if more items exist after the last item in this page */
  hasAfter: boolean;
};
