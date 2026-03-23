import React from 'react';
import { getSupabaseClient } from '@/lib/supabase';
import { Input } from '@/components/ui/Input';
import { Button } from '@/components/ui/Button';
import { Surface } from '@/components/ui/Surface';
import { Eye, EyeOff, LogIn, Zap } from 'lucide-react';

const DEV_EMAIL = import.meta.env.VITE_DEV_EMAIL as string | undefined;
const DEV_PASSWORD = import.meta.env.VITE_DEV_PASSWORD as string | undefined;
const hasDevCreds = !!(DEV_EMAIL && DEV_PASSWORD);

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

  const togglePassword = (
    <button
      type="button"
      onClick={() => setShowPassword((p) => !p)}
      className="text-text-tertiary hover:text-text-primary transition-colors"
      aria-label={showPassword ? 'Hide password' : 'Show password'}
    >
      {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
    </button>
  );

  return (
    <Surface variant="elevated" className="w-full max-w-md p-8 space-y-6 text-left">
      <form onSubmit={handleSubmit} className="space-y-5">
        <div className="space-y-1.5">
          <label htmlFor="login-email" className="text-caption font-medium text-text-secondary">
            Email address
          </label>
          <Input
            id="login-email"
            type="email"
            autoComplete="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="name@company.com"
          />
        </div>

        <div className="space-y-1.5">
          <label htmlFor="login-password" className="text-caption font-medium text-text-secondary">
            Password
          </label>
          <Input
            id="login-password"
            type={showPassword ? 'text' : 'password'}
            autoComplete="current-password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Enter your password"
            rightIcon={togglePassword}
          />
        </div>

        <Button
          type="submit"
          variant="primary"
          size="lg"
          loading={submitting}
          leftIcon={!submitting ? <LogIn className="h-4 w-4" /> : undefined}
          className="w-full"
        >
          {submitting ? 'Signing in...' : 'Continue'}
        </Button>

        {hasDevCreds && (
          <button
            type="button"
            disabled={submitting}
            onClick={() => {
              setEmail(DEV_EMAIL!);
              setPassword(DEV_PASSWORD!);
            }}
            className="flex items-center gap-1.5 self-center rounded-full bg-amber-500/15 border border-amber-500/25 px-3 py-1 text-caption font-medium text-amber-400 transition-colors hover:bg-amber-500/25 disabled:opacity-45"
          >
            <Zap className="h-3 w-3" />
            Dev fill
          </button>
        )}
      </form>

      {status && (
        <div
          className={`rounded-xl px-3 py-2.5 text-caption font-medium ${
            status.type === 'error'
              ? 'bg-status-danger-bg text-status-danger-text border border-status-danger-border'
              : 'bg-status-success-bg text-status-success-text border border-status-success-border'
          }`}
          role="status"
          aria-live="polite"
        >
          {status.message}
        </div>
      )}

      <p className="text-caption text-text-tertiary">
        Session details stay encrypted on your device.
      </p>
    </Surface>
  );
}
