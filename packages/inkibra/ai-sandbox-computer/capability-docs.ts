export type {
  CapabilityDocKind,
  CapabilityDocTier,
  ResolvedCapabilityDoc,
} from './capability-doc-core';
export {
  CAPABILITY_DOC_EXECUTION_FILES,
  CAPABILITY_DOC_PLANNING_FILES,
  materializeCapabilityDocs,
  resolveCapabilityDocsFromCommands,
  resolveCapabilityDocsFromModules,
  resolveSystemCapabilityDocs,
} from './capability-doc-core';

import { resolveCapabilityDocsFromModules } from './capability-doc-core';
import { notificationsModule } from './example/notification-module';
import { todoModule } from './example/todo-module';

const developerExampleModules = [notificationsModule, todoModule] as const;

export function resolveDeveloperExampleCapabilityDocs() {
  return resolveCapabilityDocsFromModules('developer', developerExampleModules);
}
