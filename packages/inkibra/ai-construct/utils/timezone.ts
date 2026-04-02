import { type OverlayFs, parseContextFile } from '@inkibra/ai-flow';
import { VFS_PATHS } from '../vfs/layout';

export async function resolveUserTimeZone(
  vfs: OverlayFs,
): Promise<string | undefined> {
  try {
    const content = await vfs.read(VFS_PATHS.core.user);
    const parsed = parseContextFile(content);
    const tz = parsed.meta.timezone as string | undefined;
    return tz ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
  } catch {
    return Intl.DateTimeFormat().resolvedOptions().timeZone;
  }
}
