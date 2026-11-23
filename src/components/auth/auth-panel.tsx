"use client";

import { useState, type FormEvent } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { ArrowRight, LoaderCircle } from "lucide-react";

interface AuthPanelProps {
  client: SupabaseClient;
  initialError?: string | null;
}

export function AuthPanel({ client, initialError = null }: AuthPanelProps) {
  const [mode, setMode] = useState<"sign-in" | "sign-up">("sign-in");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(initialError);
  const [message, setMessage] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setMessage(null);

    if (password.length < 6) {
      setError("Use at least 6 characters for your password.");
      return;
    }

    setIsSubmitting(true);

    try {
      if (mode === "sign-up") {
        const { data, error: signUpError } = await client.auth.signUp({
          email: email.trim(),
          password,
        });

        if (signUpError) {
          throw signUpError;
        }

        if (!data.session) {
          setMessage("Check your email to confirm the account, then sign in.");
          setMode("sign-in");
        }
      } else {
        const { error: signInError } = await client.auth.signInWithPassword({
          email: email.trim(),
          password,
        });

        if (signInError) {
          throw signInError;
        }
      }
    } catch (caughtError) {
      setError(
        caughtError instanceof Error ? caughtError.message : "Authentication failed.",
      );
    } finally {
      setIsSubmitting(false);
    }
  }

  function switchMode(nextMode: "sign-in" | "sign-up") {
    setMode(nextMode);
    setError(null);
    setMessage(null);
  }

  return (
    <main className="auth-frame">
      <section className="auth-sheet" aria-labelledby="auth-title">
        <div className="brand-lockup auth-brand">
          <span className="brand-mark" aria-hidden="true">
            <span />
            <span />
          </span>
          <span>Tether Notes</span>
        </div>
        <div className="auth-copy">
          <h1 id="auth-title">{mode === "sign-in" ? "Sign in" : "Create an account"}</h1>
          <p>
            {mode === "sign-in"
              ? "Open the notes tethered to your account."
              : "Keep local-first notes in sync across your devices."}
          </p>
        </div>
        <div className="auth-tabs" role="tablist" aria-label="Authentication mode">
          <button
            type="button"
            role="tab"
            aria-selected={mode === "sign-in"}
            className={mode === "sign-in" ? "is-active" : undefined}
            onClick={() => switchMode("sign-in")}
          >
            Sign in
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={mode === "sign-up"}
            className={mode === "sign-up" ? "is-active" : undefined}
            onClick={() => switchMode("sign-up")}
          >
            Sign up
          </button>
        </div>
        <form className="auth-form" onSubmit={handleSubmit}>
          <label htmlFor="email">Email</label>
          <input
            id="email"
            type="email"
            autoComplete="email"
            required
            value={email}
            onChange={(event) => setEmail(event.target.value)}
          />
          <label htmlFor="password">Password</label>
          <input
            id="password"
            type="password"
            autoComplete={mode === "sign-in" ? "current-password" : "new-password"}
            minLength={6}
            required
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />
          {error ? <p className="form-message form-error" role="alert">{error}</p> : null}
          {message ? <p className="form-message form-success" role="status">{message}</p> : null}
          <button className="primary-button auth-submit" type="submit" disabled={isSubmitting}>
            {isSubmitting ? (
              <LoaderCircle className="spin" aria-hidden="true" />
            ) : (
              <ArrowRight aria-hidden="true" />
            )}
            {mode === "sign-in" ? "Sign in" : "Create account"}
          </button>
        </form>
      </section>
    </main>
  );
}
