import React from 'react';
import { getSupabaseClient } from '@/lib/supabase';

export function SupabaseLogin() {
  const [email, setEmail] = React.useState('');
  const [password, setPassword] = React.useState('');
  const [showPassword, setShowPassword] = React.useState(false);
  const [status, setStatus] = React.useState<
    | { type: 'error' | 'success'; message: string }
    | null
  >(null);
  const [submitting, setSubmitting] = React.useState(false);

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setStatus(null);
    setSubmitting(true);

    try {
      const supabase = getSupabaseClient();
      const { error } = await supabase.auth.signInWithPassword({
        email,
        password,
      });
      if (error) {
        setStatus({ type: 'error', message: error.message });
      } else {
        setStatus({ type: 'success', message: 'Signed in successfully.' });
      }
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'An unexpected error occurred.';
      setStatus({ type: 'error', message });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form
      onSubmit={handleSubmit}
      className="scheme-light relative w-full max-w-md space-y-6 overflow-hidden rounded-3xl border border-default/60 bg-surface-chip/80 p-8 text-left shadow-2xl backdrop-blur-xl"
    >
      <div className="pointer-events-none absolute -top-40 right-10 h-56 w-56 rounded-full bg-sky-200/40 blur-3xl" />
      <div className="pointer-events-none absolute -bottom-48 left-6 h-56 w-56 rounded-full bg-blue-500/30 blur-3xl" />

      <div className="relative space-y-2">
        <span className="type-caption font-semibold uppercase tracking-[0.3em] text-muted">
          Welcome back
        </span>
        <h2 className="type-title-l font-semibold tracking-tight text-heading">
          Access your trading workspace
        </h2>
        <p className="type-subhead text-muted">
          Enter your credentials to continue to the command center.
        </p>
      </div>

      <div className="relative space-y-1">
        <label htmlFor="email" className="type-caption font-medium text-subtle">
          Email address
        </label>
        <input
          id="email"
          type="email"
          autoComplete="email"
          required
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          className="w-full rounded-xl border border-default/80 bg-surface-card px-3 py-3 type-subhead font-medium text-heading shadow-sm transition focus:border-transparent focus:outline-none focus:ring-2 focus:ring-sky-400/70"
          placeholder="name@company.com"
        />
      </div>

      <div className="relative space-y-1">
        <label htmlFor="password" className="type-caption font-medium text-subtle">
          Password
        </label>
        <div className="relative">
          <input
            id="password"
            type={showPassword ? 'text' : 'password'}
            autoComplete="current-password"
            required
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            className="w-full rounded-xl border border-default/80 bg-surface-card px-3 py-3 pr-12 type-subhead font-medium text-heading shadow-sm transition focus:border-transparent focus:outline-none focus:ring-2 focus:ring-sky-400/70"
            placeholder="Enter your password"
          />
          <button
            type="button"
            onClick={() => setShowPassword((previous) => !previous)}
            className="absolute inset-y-0 right-2 flex items-center rounded-lg px-3 type-caption font-semibold text-muted transition hover:text-heading focus:outline-none focus:ring-2 focus:ring-sky-400/70"
            aria-label={showPassword ? 'Hide password' : 'Show password'}
          >
            {showPassword ? 'Hide' : 'Show'}
          </button>
        </div>
      </div>

      <button
        type="submit"
        disabled={submitting}
        className="group relative flex w-full items-center justify-center gap-2 overflow-hidden rounded-xl bg-surface-primary-btn px-4 py-3 type-subhead font-semibold text-on-primary-btn shadow-lg transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-surface-primary-btn disabled:cursor-not-allowed disabled:bg-faint"
      >
        <span className="absolute inset-0 -z-10 bg-gradient-to-r from-surface-primary-btn via-sky-600 to-surface-primary-btn opacity-0 transition-opacity duration-300 group-hover:opacity-100" />
        {submitting ? 'Signing you in…' : 'Continue'}
      </button>

      {status ? (
        <p
          className={`rounded-xl px-3 py-2 type-caption font-medium ${
            status.type === 'error'
              ? 'bg-rose-50 text-rose-600'
              : 'bg-emerald-50 text-emerald-600'
          }`}
          role="status"
          aria-live="polite"
        >
          {status.message}
        </p>
      ) : null}

      <div className="relative type-caption text-muted">
        <p>Session details stay encrypted on your device for seamless access.</p>
      </div>
    </form>
  );
}
