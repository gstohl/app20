import { createContext, useContext, type ReactNode } from "react";

export type LocalnetToolsRenderer = (() => ReactNode) | null;

export const LocalnetToolsContext = createContext<LocalnetToolsRenderer>(null);

export function useLocalnetTools(): LocalnetToolsRenderer {
  return useContext(LocalnetToolsContext);
}
