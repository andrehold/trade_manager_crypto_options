import React from 'react';
import { getSupabaseClient } from '@/lib/supabase';

export function SupabaseLogin() {
  const [email, setEmail] = React.useState('');
  const [password, setPassword] = React.useState('');
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
    <form onSubmit={handleSubmit} className="w-full max-w-sm space-y-4 text-left">
      <div className="space-y-1">
        <label htmlFor="supabase-email" className="text-xs font-medium text-slate-600">
          Email
        </label>
        <input
          id="supabase-email"
          type="email"
          autoComplete="email"
          required
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          className="w-full rounded-md border border-slate-200 px-3 py-2 text-sm shadow-sm focus:border-slate-400 focus:outline-none focus:ring-2 focus:ring-slate-200"
          placeholder="you@example.com"
        />
      </div>

      <div className="space-y-1">
        <label htmlFor="supabase-password" className="text-xs font-medium text-slate-600">
          Password
        </label>
        <input
          id="supabase-password"
          type="password"
          autoComplete="current-password"
          required
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          className="w-full rounded-md border border-slate-200 px-3 py-2 text-sm shadow-sm focus:border-slate-400 focus:outline-none focus:ring-2 focus:ring-slate-200"
          placeholder="••••••••"
        />
      </div>

      <button
        type="submit"
        disabled={submitting}
        className="w-full rounded-md bg-slate-900 px-3 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-slate-700 disabled:cursor-not-allowed disabled:bg-slate-400"
      >
        {submitting ? 'Signing in…' : 'Sign in'}
      </button>

      {status ? (
        <p
          className={
            status.type === 'error'
              ? 'text-xs text-rose-600'
              : 'text-xs text-emerald-600'
          }
        >
          {status.message}
        </p>
      ) : null}

      <p className="text-xs text-slate-500">
        Use the email and password configured for your Supabase project. Session
        tokens are stored locally so you only need to sign in once per browser.
      </p>
    </form>
  );
}
