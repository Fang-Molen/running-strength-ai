import { useEffect, type ReactNode } from "react";
import { useCurrentUserState } from "./use-current-user";
import { authEnabled } from "./client";
import { bindR5Session } from "../coach/r5/scope";

/**
 * App-wide client provider mounted once near the root (in `src/routes/__root.tsx`):
 *
 *   <AuthProvider><Outlet /></AuthProvider>
 *
 * Better Auth's React client (`@/lib/auth/client`) needs NO context provider —
 * its `useSession()` works standalone — so this is a passthrough today. It's
 * kept as the single, stable mount point for any future client-side providers
 * (e.g. a toast or theme provider) without churning the root shell.
 */
export function AuthProvider({ children }: { children: ReactNode }) {
  const { user, isPending } = useCurrentUserState();
  const id=user?.id??null;
  useEffect(()=>{ if(authEnabled)bindR5Session(!isPending?id:null); },[id,isPending]);
  return <>{children}</>;
}
