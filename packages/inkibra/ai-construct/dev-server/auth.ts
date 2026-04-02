/**
 * Dev-only pass-through auth codec and plugin.
 *
 * Every construct backend route requires an auth codec.
 * In the dev server we skip real auth — all requests pass through
 * as the anonymous 'dev' user.
 */

import { createContextCodec } from '@inkibra/router';
import type { AuthPlugin } from '../backend/backend';
import { devAuthSchema } from './routes.schemas';

type DevAuth = { id: string };

export const devAuthCodec = createContextCodec({
  name: 'auth',
  scope: 'session',
  schema: devAuthSchema,
  defaultValue: { id: 'dev' },
});

export const devAuthPlugin: AuthPlugin<
  DevAuth,
  typeof devAuthCodec,
  unknown,
  never
> = {
  codec: devAuthCodec,
  require: () => ({
    ok: true as const,
    auth: { id: 'dev' },
    subjectId: 'dev',
  }),
};

export type { DevAuth };
