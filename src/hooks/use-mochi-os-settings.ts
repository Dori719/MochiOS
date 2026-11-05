import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { MOCHI_OS_SETTINGS_KEY, type MochiOsSettings } from "@mochi-os/shared";
import { activeChatId } from "../st/adapter";
import { readMochiSettings, writeMochiSettings } from "../st/mochi-settings";

export const mochiOsKeys = {
  settings: ["app-settings", MOCHI_OS_SETTINGS_KEY] as const,
};

export function useMochiOsSettings() {
  const chatId = activeChatId();
  return useQuery({
    queryKey: [...mochiOsKeys.settings, chatId],
    queryFn: readMochiSettings,
    staleTime: 5 * 60_000,
    initialData: readMochiSettings,
  });
}

export function useUpdateMochiOsSettings() {
  const queryClient = useQueryClient();
  const chatId = activeChatId();
  return useMutation({
    mutationFn: async (settings: MochiOsSettings) => writeMochiSettings(settings, chatId),
    onSuccess: (settings) => {
      queryClient.setQueryData([...mochiOsKeys.settings, chatId], settings);
      document.dispatchEvent(new CustomEvent('mochios:settings', { detail: { key: MOCHI_OS_SETTINGS_KEY } }));
    },
  });
}
