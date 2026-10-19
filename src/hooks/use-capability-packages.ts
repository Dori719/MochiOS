/**
 * Capability packages, as far as Mochi OS needs them.
 *
 * A capability package is an engine plugin that adds commands and UI to a chat.
 * SillyTavern has its own extension model, and nothing installs engine packages
 * here, so the installed list is empty — which is the honest answer, and it
 * disables capability-gated slash commands rather than pretending they exist.
 *
 * The engine module this replaces is 23 KB of package installation, ruleset
 * catalogues and client-bundle importing; Mochi OS reads one hook from it.
 */
import { useQuery } from '@tanstack/react-query';
import type { InstalledCapabilityPackage } from '../shared';
import { api } from '../lib/api-client';

export const capabilityPackageKeys = {
  installed: ['capability-packages', 'installed'] as const,
};

/** Every capability package active in this environment. */
export function useInstalledCapabilityPackages() {
  return useQuery<InstalledCapabilityPackage[]>({
    queryKey: capabilityPackageKeys.installed,
    queryFn: () => api.get<InstalledCapabilityPackage[]>('/capability-packages/installed'),
    staleTime: 5 * 60_000,
  });
}
