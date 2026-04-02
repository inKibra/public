import type { ErrorDescriptor } from '@inkibra/error-base';
import type { Result } from 'neverthrow';
import { err, ok } from 'neverthrow';

export type ArrayMoveErrorDescriptor = ErrorDescriptor<
  'CANNOT_MOVE_ARRAY_ITEM',
  string,
  { from: number; to: number }
>;

/**
 * Move an array item from index `from` to index `to`. Returns an Ok(T[]) if successful,
 * or an Err if the indices are invalid.
 */
export function safeArrayMove<T>(
  array: T[],
  from: number,
  to: number,
): Result<T[], ArrayMoveErrorDescriptor> {
  // Guard: `from` must be a valid index.
  if (from < 0 || from >= array.length) {
    return err({
      code: 'CANNOT_MOVE_ARRAY_ITEM',
      message: 'The "from" index is out of range.',
      data: { from, to },
    } as ArrayMoveErrorDescriptor);
  }

  const newArray = array.slice();
  const [item] = newArray.splice(from, 1);

  // Guard: The item at index `from` could be undefined if the original array is smaller than we think.
  if (item === undefined) {
    return err({
      code: 'CANNOT_MOVE_ARRAY_ITEM',
      message: 'No valid item found at the requested "from" index.',
      data: { from, to },
    } as ArrayMoveErrorDescriptor);
  }

  // Negative "to" index or out-of-range checks:
  const finalIndex = to < 0 ? newArray.length + to : to;
  if (finalIndex < 0 || finalIndex > newArray.length) {
    return err({
      code: 'CANNOT_MOVE_ARRAY_ITEM',
      message: 'The "to" index is out of range.',
      data: { from, to },
    } as ArrayMoveErrorDescriptor);
  }

  newArray.splice(finalIndex, 0, item);
  return ok(newArray);
}

export type ArraySwapErrorDescriptor = ErrorDescriptor<
  'CANNOT_SWAP_ARRAY_ITEMS',
  string,
  { from: number; to: number }
>;

/**
 * Swap an array item to a different position. Returns a new array with the item swapped to the new position.
 */
export function safeArraySwap<T>(
  array: T[],
  from: number,
  to: number,
): Result<T[], ArraySwapErrorDescriptor> {
  const newArray = array.slice();
  const toItem = array.at(to);
  const fromItem = array.at(from);
  if (!toItem || !fromItem) {
    return err({
      code: 'CANNOT_SWAP_ARRAY_ITEMS',
      message: 'The requested items to swap were not found in the array.',
      data: { from, to },
    } as ArraySwapErrorDescriptor);
  }
  newArray[from] = toItem;
  newArray[to] = fromItem;
  return ok(newArray);
}
