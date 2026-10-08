"use client";
import { useSyncExternalStore } from "react";
import { useProjectStore } from "@/store/project-store";
const subscribe = (listener: () => void) => {
  const finish = useProjectStore.persist.onFinishHydration(listener);
  const start = useProjectStore.persist.onHydrate(listener);
  return () => {
    finish();
    start();
  };
};
export function useHydratedProject() {
  return useSyncExternalStore(
    subscribe,
    useProjectStore.persist.hasHydrated,
    () => false,
  );
}
