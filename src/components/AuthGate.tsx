import React, { useEffect, useState } from "react";
import { Activity, KeyRound, Loader2 } from "lucide-react";
import { fetchAuthStatus, exchangeApiKey, hasApiToken, UNAUTHORIZED_EVENT } from "../lib/api";

type GateState = "loading" | "login" | "ready";

/**
 * Blocks the app behind an API-key login screen when the server has JWT auth
 * enabled. When auth is disabled (no JWT_SECRET), renders children directly.
 * Any 401 from the API (expired/invalid token) sends the user back here.
 */
export function AuthGate({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<GateState>("loading");

  useEffect(() => {
    fetchAuthStatus()
      .then(({ auth_enabled }) => setState(auth_enabled && !hasApiToken() ? "login" : "ready"))
      // If the status endpoint itself is unreachable, let the app render its own errors
      .catch(() => setState("ready"));

    const onUnauthorized = () => setState("login");
    window.addEventListener(UNAUTHORIZED_EVENT, onUnauthorized);
    return () => window.removeEventListener(UNAUTHORIZED_EVENT, onUnauthorized);
  }, []);

  if (state === "loading") {
    return (
      <div className="flex h-screen w-full items-center justify-center bg-[#FAFAFA] text-slate-400">
        <Loader2 className="h-6 w-6 animate-spin" />
      </div>
    );
  }
  if (state === "login") return <LoginScreen onSuccess={() => setState("ready")} />;
  return <>{children}</>;
}

function LoginScreen({ onSuccess }: { onSuccess: () => void }) {
  const [apiKey, setApiKey]     = useState("");
  const [error, setError]       = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!apiKey.trim()) return;
    setSubmitting(true);
    setError(null);
    try {
      const token = await exchangeApiKey(apiKey.trim());
      if (token) onSuccess();
      else setError("Server did not issue a token — is auth enabled?");
    } catch {
      setError("Invalid API key");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="flex h-screen w-full items-center justify-center bg-[#FAFAFA] font-sans">
      <div className="w-full max-w-sm rounded-xl border border-slate-200 bg-white p-8 shadow-sm">
        <div className="mb-6 flex items-center gap-2">
          <Activity className="h-6 w-6 text-indigo-600" />
          <h1 className="text-lg font-semibold tracking-tight text-slate-900">AgentCore</h1>
        </div>

        <p className="mb-4 text-sm text-slate-600">
          This instance requires authentication. Paste a team API key to sign in —
          it will be exchanged for a session token.
        </p>

        <form onSubmit={handleSubmit} className="flex flex-col gap-3">
          <div className="relative">
            <KeyRound className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
            <input
              type="password"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder="agentcore_..."
              autoFocus
              className="w-full rounded-md border border-slate-300 py-2 pl-9 pr-3 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
            />
          </div>

          {error && <p className="text-sm text-red-600">{error}</p>}

          <button
            type="submit"
            disabled={submitting || !apiKey.trim()}
            className="rounded-md bg-indigo-600 py-2 text-sm font-medium text-white transition-colors hover:bg-indigo-700 disabled:opacity-50"
          >
            {submitting ? "Signing in…" : "Sign in"}
          </button>
        </form>

        <p className="mt-4 text-xs text-slate-400">
          No key yet? Create a team: <code className="text-slate-500">POST /api/teams</code>
        </p>
      </div>
    </div>
  );
}
