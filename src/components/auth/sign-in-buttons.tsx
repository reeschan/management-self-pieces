"use client";

import { useState } from "react";

import { authClient } from "@/lib/auth/client";

type Provider = "google" | "github";

const providers: readonly { id: Provider; label: string }[] = [
  { id: "google", label: "Google でログイン" },
  { id: "github", label: "GitHub でログイン" },
];

export function SignInButtons() {
  const [pending, setPending] = useState<Provider | null>(null);

  async function signIn(provider: Provider) {
    setPending(provider);
    try {
      await authClient.signIn.social({
        provider,
        callbackURL: "/",
        errorCallbackURL: "/login?error=denied",
      });
    } finally {
      setPending(null);
    }
  }

  return (
    <div className="flex flex-col gap-3">
      {providers.map(({ id, label }) => (
        <button
          key={id}
          type="button"
          onClick={() => void signIn(id)}
          disabled={pending !== null}
          className="rounded-md border border-zinc-300 bg-white px-4 py-2 text-sm font-medium text-zinc-900 hover:bg-zinc-50 disabled:opacity-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100 dark:hover:bg-zinc-800"
        >
          {label}
        </button>
      ))}
    </div>
  );
}
