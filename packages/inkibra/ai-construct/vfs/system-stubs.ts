import type { ResolvedCapabilityDoc } from '../../ai-sandbox-computer/capability-doc-core';
import {
  materializeCapabilityDocs,
  resolveCapabilityDocsFromModules,
  resolveSystemCapabilityDocs,
} from '../../ai-sandbox-computer/capability-doc-core';
import type { ComputerConfig } from '../../ai-sandbox-computer/create-computer';

function materializeCapabilityKind(kind: 'package' | 'command') {
  return (docs: ReadonlyArray<ResolvedCapabilityDoc>) =>
    materializeCapabilityDocs(docs.filter((doc) => doc.kind === kind));
}

export function getSystemPackageStubs(): Record<string, string> {
  return materializeCapabilityKind('package')(resolveSystemCapabilityDocs());
}

export function getSystemCommandStubs(): Record<string, string> {
  return materializeCapabilityKind('command')(resolveSystemCapabilityDocs());
}

export function getDeveloperCapabilityStubs(
  modules: NonNullable<ComputerConfig['modules']> = [],
): Record<string, string> {
  return materializeCapabilityDocs(
    resolveCapabilityDocsFromModules('developer', modules),
  );
}
