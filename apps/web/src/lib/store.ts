import { create } from "zustand";
import { persist } from "zustand/middleware";

interface AppState {
  selectedOrganizationId: string | null;
  setSelectedOrganizationId: (id: string | null) => void;
}

export const useAppStore = create<AppState>()(
  persist(
    (set) => ({
      selectedOrganizationId: null,
      setSelectedOrganizationId: (id) => set({ selectedOrganizationId: id }),
    }),
    {
      name: "app-storage",
    },
  ),
);
