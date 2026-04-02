/**
 * Query DSL - Filter and pagination parsing/serialization
 *
 * Filter syntax (URL-friendly):
 * - eq:value          → equals
 * - notEq:value       → not equals
 * - gt:value          → greater than
 * - lt:value          → less than
 * - gte:value         → greater than or equal
 * - lte:value         → less than or equal
 * - between:min:max   → between range
 * - in:a,b,c          → in list
 * - notIn:a,b,c       → not in list
 * - anyIn:a,b,c       → array contains any
 * - everyIn:a,b,c     → array contains all
 * - likeAnd:a,b       → contains all terms
 * - likeOr:a,b        → contains any term
 */

// ============================================================================
// Types
// ============================================================================

export type FilterOperator =
  | 'eq'
  | 'notEq'
  | 'gt'
  | 'lt'
  | 'gte'
  | 'lte'
  | 'between'
  | 'in'
  | 'notIn'
  | 'anyIn'
  | 'everyIn'
  | 'likeAnd'
  | 'likeOr';

export type FilterExpression =
  | { op: 'eq'; value: string | number | boolean }
  | { op: 'notEq'; value: string | number | boolean }
  | { op: 'gt'; value: string | number }
  | { op: 'lt'; value: string | number }
  | { op: 'gte'; value: string | number }
  | { op: 'lte'; value: string | number }
  | { op: 'between'; min: string | number; max: string | number }
  | { op: 'in'; values: (string | number)[] }
  | { op: 'notIn'; values: (string | number)[] }
  | { op: 'anyIn'; values: (string | number)[] }
  | { op: 'everyIn'; values: (string | number)[] }
  | { op: 'likeAnd'; terms: string[] }
  | { op: 'likeOr'; terms: string[] };

export type SortDirection = 'asc' | 'desc';

export type QueryParams = {
  /** Filter expressions by field name */
  filter?: Record<string, FilterExpression>;

  /** Sort direction */
  sort?: SortDirection;

  /** Field to sort by */
  sortKey?: string;

  /** Cursor: get items after this value */
  after?: string;

  /** Cursor: get items before this value */
  before?: string;

  /** Maximum items to return */
  limit?: number;
};

export type SerializedQueryParams = {
  filter?: Record<string, string>;
  sort?: SortDirection;
  sortKey?: string;
  after?: string;
  before?: string;
  limit?: number;
};

// ============================================================================
// Parsing
// ============================================================================

/**
 * Parse a filter string into a FilterExpression
 * @example parseFilter('eq:active') → { op: 'eq', value: 'active' }
 * @example parseFilter('in:a,b,c') → { op: 'in', values: ['a', 'b', 'c'] }
 */
export function parseFilter(filterStr: string): FilterExpression {
  const colonIndex = filterStr.indexOf(':');
  if (colonIndex === -1) {
    // Default to eq if no operator
    return { op: 'eq', value: filterStr };
  }

  const op = filterStr.slice(0, colonIndex) as FilterOperator;
  const rest = filterStr.slice(colonIndex + 1);

  switch (op) {
    case 'eq':
    case 'notEq':
      return { op, value: parseValue(rest) };

    case 'gt':
    case 'lt':
    case 'gte':
    case 'lte':
      return { op, value: parseValue(rest) as string | number };

    case 'between': {
      const parts = rest.split(':');
      if (
        parts.length !== 2 ||
        parts[0] === undefined ||
        parts[1] === undefined
      ) {
        throw new Error(`Invalid between filter: ${filterStr}`);
      }
      return {
        op,
        min: parseValue(parts[0]) as string | number,
        max: parseValue(parts[1]) as string | number,
      };
    }

    case 'in':
    case 'notIn':
    case 'anyIn':
    case 'everyIn':
      return {
        op,
        values: rest.split(',').map(parseValue) as (string | number)[],
      };

    case 'likeAnd':
    case 'likeOr':
      return { op, terms: rest.split(',') };

    default:
      throw new Error(`Unknown filter operator: ${op}`);
  }
}

/**
 * Parse a value string into its proper type
 */
function parseValue(str: string): string | number | boolean {
  // Boolean
  if (str === 'true') return true;
  if (str === 'false') return false;

  // Number
  const num = Number(str);
  if (!isNaN(num) && str.trim() !== '') return num;

  // String
  return str;
}

/**
 * Parse serialized query params into QueryParams
 */
export function parseQueryParams(params: SerializedQueryParams): QueryParams {
  const result: QueryParams = {};

  if (params.filter) {
    result.filter = {};
    for (const [key, value] of Object.entries(params.filter)) {
      result.filter[key] = parseFilter(value);
    }
  }

  if (params.sort) result.sort = params.sort;
  if (params.sortKey) result.sortKey = params.sortKey;
  if (params.after) result.after = params.after;
  if (params.before) result.before = params.before;
  if (params.limit !== undefined) result.limit = params.limit;

  return result;
}

// ============================================================================
// Serialization
// ============================================================================

/**
 * Serialize a FilterExpression to string
 * @example serializeFilter({ op: 'eq', value: 'active' }) → 'eq:active'
 */
export function serializeFilter(expr: FilterExpression): string {
  switch (expr.op) {
    case 'eq':
    case 'notEq':
    case 'gt':
    case 'lt':
    case 'gte':
    case 'lte':
      return `${expr.op}:${expr.value}`;

    case 'between':
      return `between:${expr.min}:${expr.max}`;

    case 'in':
    case 'notIn':
    case 'anyIn':
    case 'everyIn':
      return `${expr.op}:${expr.values.join(',')}`;

    case 'likeAnd':
    case 'likeOr':
      return `${expr.op}:${expr.terms.join(',')}`;
  }
}

/**
 * Serialize QueryParams to SerializedQueryParams (for URL/API use)
 */
export function serializeQueryParams(
  params: QueryParams,
): SerializedQueryParams {
  const result: SerializedQueryParams = {};

  if (params.filter) {
    result.filter = {};
    for (const [key, expr] of Object.entries(params.filter)) {
      result.filter[key] = serializeFilter(expr);
    }
  }

  if (params.sort) result.sort = params.sort;
  if (params.sortKey) result.sortKey = params.sortKey;
  if (params.after) result.after = params.after;
  if (params.before) result.before = params.before;
  if (params.limit !== undefined) result.limit = params.limit;

  return result;
}

// ============================================================================
// URL Helpers
// ============================================================================

/**
 * Convert QueryParams to URLSearchParams
 */
export function toURLSearchParams(params: QueryParams): URLSearchParams {
  const searchParams = new URLSearchParams();
  const serialized = serializeQueryParams(params);

  if (serialized.filter) {
    for (const [key, value] of Object.entries(serialized.filter)) {
      searchParams.set(`filter.${key}`, value);
    }
  }

  if (serialized.sort) searchParams.set('sort', serialized.sort);
  if (serialized.sortKey) searchParams.set('sortKey', serialized.sortKey);
  if (serialized.after) searchParams.set('after', serialized.after);
  if (serialized.before) searchParams.set('before', serialized.before);
  if (serialized.limit !== undefined)
    searchParams.set('limit', String(serialized.limit));

  return searchParams;
}

/**
 * Parse URLSearchParams into QueryParams
 */
export function fromURLSearchParams(
  searchParams: URLSearchParams,
): QueryParams {
  const serialized: SerializedQueryParams = {};

  // Extract filters (filter.fieldName=value)
  const filter: Record<string, string> = {};
  for (const [key, value] of Array.from(searchParams.entries())) {
    if (key.startsWith('filter.')) {
      filter[key.slice(7)] = value;
    }
  }
  if (Object.keys(filter).length > 0) {
    serialized.filter = filter;
  }

  const sort = searchParams.get('sort');
  if (sort === 'asc' || sort === 'desc') serialized.sort = sort;

  const sortKey = searchParams.get('sortKey');
  if (sortKey) serialized.sortKey = sortKey;

  const after = searchParams.get('after');
  if (after) serialized.after = after;

  const before = searchParams.get('before');
  if (before) serialized.before = before;

  const limit = searchParams.get('limit');
  if (limit) serialized.limit = Number(limit);

  return parseQueryParams(serialized);
}

// ============================================================================
// Matching (for cache filtering)
// ============================================================================

/**
 * Check if a value matches a filter expression
 */
export function matchesFilter(value: unknown, expr: FilterExpression): boolean {
  switch (expr.op) {
    case 'eq':
      return value === expr.value;

    case 'notEq':
      return value !== expr.value;

    case 'gt':
      return typeof value === 'number' && value > (expr.value as number);

    case 'lt':
      return typeof value === 'number' && value < (expr.value as number);

    case 'gte':
      return typeof value === 'number' && value >= (expr.value as number);

    case 'lte':
      return typeof value === 'number' && value <= (expr.value as number);

    case 'between':
      return (
        typeof value === 'number' &&
        value >= (expr.min as number) &&
        value <= (expr.max as number)
      );

    case 'in':
      return expr.values.includes(value as string | number);

    case 'notIn':
      return !expr.values.includes(value as string | number);

    case 'anyIn':
      return Array.isArray(value) && expr.values.some((v) => value.includes(v));

    case 'everyIn':
      return (
        Array.isArray(value) && expr.values.every((v) => value.includes(v))
      );

    case 'likeAnd': {
      const str = String(value).toLowerCase();
      return expr.terms.every((term) => str.includes(term.toLowerCase()));
    }

    case 'likeOr': {
      const str = String(value).toLowerCase();
      return expr.terms.some((term) => str.includes(term.toLowerCase()));
    }
  }
}

/**
 * Check if an entity matches all filter expressions
 */
export function matchesFilters(
  entity: Record<string, unknown>,
  filter: Record<string, FilterExpression>,
): boolean {
  for (const [key, expr] of Object.entries(filter)) {
    if (!matchesFilter(entity[key], expr)) {
      return false;
    }
  }
  return true;
}
