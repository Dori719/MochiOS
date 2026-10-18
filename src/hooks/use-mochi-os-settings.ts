import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  MOCHI_OS_SETTINGS_KEY,
  DEFAULT_MOCHI_OS_SETTINGS,
  normalizeMochiOsSettings,
  type AppSettingsResponse,
  type MochiOsSettings,
} from "@marinara-engine/shared";
import { api } from "../lib/api-client";

export const mochiOsKeys = {
  settings: ["app-settings", MOCHI_OS_SETTINGS_KEY] as const,
};

function readLocalFallback(): MochiOsSettings {
  if (typeof window === "undefined") return DEFAULT_MOCHI_OS_SETTINGS;
  try {
    const raw = window.localStorage.getItem(MOCHI_OS_SETTINGS_KEY);
    if (!raw) return DEFAULT_MOCHI_OS_SETTINGS;
    return normalizeMochiOsSettings(raw);
  } catch {
    return DEFAULT_MOCHI_OS_SETTINGS;
  }
}

export function useMochiOsSettings() {
  return useQuery({
    queryKey: mochiOsKeys.settings,
    queryFn: async () => {
      try {
        const result = await api.get<AppSettingsResponse>(`/app-settings/${MOCHI_OS_SETTINGS_KEY}`);
        if (typeof result?.value === "string" && result.value.trim().length > 0) {
          const parsed = normalizeMochiOsSettings(result.value);
          if (typeof window !== "undefined") {
            try {
              window.localStorage.setItem(MOCHI_OS_SETTINGS_KEY, JSON.stringify(parsed));
            } catch {
              // ignore
            }
          }
          return parsed;
        }
      } catch {
        // Fall back to local storage if server route is unavailable
      }
      return readLocalFallback();
    },
    staleTime: 5 * 60_000,
    initialData: readLocalFallback,
  });
}

export function useUpdateMochiOsSettings() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (settings: MochiOsSettings) => {
      const normalized = normalizeMochiOsSettings(settings);
      if (typeof window !== "undefined") {
        try {
          window.localStorage.setItem(MOCHI_OS_SETTINGS_KEY, JSON.stringify(normalized));
        } catch {
          // ignore
        }
      }
      try {
        await api.put(`/app-settings/${MOCHI_OS_SETTINGS_KEY}`, {
          value: JSON.stringify(normalized),
        });
      } catch {
        // local persistence still succeeded
      }
      return normalized;
    },
    onMutate: async (newSettings) => {
      await queryClient.cancelQueries({ queryKey: mochiOsKeys.settings });
      const previous = queryClient.getQueryData<MochiOsSettings>(mochiOsKeys.settings);
      queryClient.setQueryData<MochiOsSettings>(mochiOsKeys.settings, normalizeMochiOsSettings(newSettings));
      return { previous };
    },
    onError: (_err, _newSettings, context) => {
      if (context?.previous) {
        queryClient.setQueryData(mochiOsKeys.settings, context.previous);
      }
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: mochiOsKeys.settings });
    },
  });
}
