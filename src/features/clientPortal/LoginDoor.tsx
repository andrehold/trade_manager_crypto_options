import { Zap, Lock } from 'lucide-react'
import { SupabaseLogin } from '@/features/auth/SupabaseLogin'
import type { Door } from './routing'

export function LoginDoor({ role }: { role: Door }) {
  const admin = role === 'admin'
  return (
    <div className="grid min-h-screen place-items-center px-5 py-8 bg-bg-canvas">
      <div className="w-full max-w-[400px] rounded-2xl border border-border-default bg-bg-surface-1 p-7 shadow-xl">
        <div className="mb-5 flex items-center gap-3">
          <span className={`grid h-9 w-9 place-items-center rounded-xl ${admin ? 'bg-status-warning' : 'bg-accent-500'}`}>
            <Zap className="h-5 w-5 text-white" />
          </span>
          <div>
            <div className="type-subhead font-bold text-text-primary">Obsidian Desk{admin ? ' · Admin' : ''}</div>
            <div className="type-caption text-text-tertiary">{admin ? 'Administrator sign-in' : 'Client sign-in'}</div>
          </div>
        </div>
        <div className="mb-5 flex items-center gap-2 rounded-lg border border-border-default bg-bg-surface-2 px-3 py-2">
          <Lock className={`h-3.5 w-3.5 ${admin ? 'text-status-warning' : 'text-status-success'}`} />
          <span className="type-caption font-mono text-text-tertiary">
            {admin ? 'admin.obsidiandesk.com' : 'app.obsidiandesk.com/login'}
          </span>
        </div>
        <SupabaseLogin role="client" />
        {!admin && (
          <p className="mt-4 rounded-lg border border-border-default bg-bg-surface-2 px-3 py-2.5 type-caption text-text-secondary">
            You control the software as a tool: you self-assess appropriateness, set every parameter, hold the exchange keys, and can deactivate at any time. It provides <strong className="text-text-primary">no advice</strong> or recommendation.
          </p>
        )}
      </div>
    </div>
  )
}
