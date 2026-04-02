import type { Logger } from '@inkibra/logger';
import { createContext } from 'react';

export const LoggerContext = createContext<() => Logger>(() => {
  throw new ReferenceError('LoggerContext Not Started');
});
