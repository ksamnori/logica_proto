// src/lib/hq/hqRoutes.tsx
"use client";

import React, { createContext, useCallback, useContext } from "react";
import { formatHqHref, isHqSubdomainHost } from "./hqRouteUtils";

const HqHostContext = createContext<boolean>(false);

export function HqHostProvider({
  isSubdomain,
  children,
}: {
  isSubdomain: boolean;
  children: React.ReactNode;
}) {
  return (
    <HqHostContext.Provider value={isSubdomain}>
      {children}
    </HqHostContext.Provider>
  );
}

export function useIsHqSubdomain(): boolean {
  return useContext(HqHostContext);
}

export function useHqHref() {
  const isSubdomainFromCtx = useContext(HqHostContext);
  return useCallback(
    (canonicalHref: string) => {
      const effectiveSub =
        isSubdomainFromCtx ||
        (typeof window !== "undefined" &&
          isHqSubdomainHost(window.location.hostname));
      return formatHqHref(canonicalHref, effectiveSub);
    },
    [isSubdomainFromCtx]
  );
}
