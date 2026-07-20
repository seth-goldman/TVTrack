import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Loader2, X } from 'lucide-react'
import { posterUrl } from '../lib/tmdb'

export function Spinner({ className = '' }: { className?: string }) {
  return <Loader2 className={`animate-spin ${className}`} aria-hidden />
}

export function Screen({
  title,
  action,
  children,
}: {
  title: string
  action?: ReactNode
  children: ReactNode
}) {
  return (
    <div className="min-h-full pb-28">
      <header className="sticky top-0 z-20 flex items-center justify-between gap-3 border-b border-hairline bg-ink-900/85 px-4 pt-[env(safe-area-inset-top)] backdrop-blur">
        <h1 className="py-4 text-xl font-semibold tracking-tight">{title}</h1>
        {action}
      </header>
      <div className="px-4">{children}</div>
    </div>
  )
}

export function EmptyState({
  icon,
  title,
  body,
  action,
}: {
  icon?: ReactNode
  title: string
  body: string
  action?: ReactNode
}) {
  return (
    <div className="flex flex-col items-center gap-3 px-6 py-16 text-center">
      {icon ? <div className="text-brand-soft/70">{icon}</div> : null}
      <p className="text-base font-medium">{title}</p>
      <p className="max-w-xs text-sm text-white/50">{body}</p>
      {action ? <div className="pt-2">{action}</div> : null}
    </div>
  )
}

export function Poster({
  path,
  alt,
  className = '',
  size = 'w342',
}: {
  path: string | null | undefined
  alt: string
  className?: string
  size?: 'w154' | 'w185' | 'w342' | 'w500'
}) {
  const url = posterUrl(path, size)
  return (
    <div className={`overflow-hidden rounded-lg bg-surface-2 ${className}`}>
      {url ? (
        <img src={url} alt={alt} loading="lazy" className="h-full w-full object-cover" />
      ) : (
        <div className="flex h-full w-full items-center justify-center p-2 text-center text-[10px] leading-tight text-white/35">
          {alt}
        </div>
      )}
    </div>
  )
}

export function Button({
  children,
  onClick,
  variant = 'primary',
  disabled,
  busy,
  className = '',
  type = 'button',
}: {
  children: ReactNode
  onClick?: () => void
  variant?: 'primary' | 'ghost' | 'danger' | 'subtle'
  disabled?: boolean
  busy?: boolean
  className?: string
  type?: 'button' | 'submit'
}) {
  const styles: Record<string, string> = {
    primary: 'bg-brand text-white hover:bg-brand-soft',
    subtle: 'bg-surface-2 text-white/90 hover:bg-hairline',
    ghost: 'bg-transparent text-white/70 hover:bg-surface-2',
    danger: 'bg-bad/15 text-bad hover:bg-bad/25',
  }
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled || busy}
      className={`inline-flex min-h-11 items-center justify-center gap-2 rounded-xl px-4 text-sm font-medium transition-colors disabled:opacity-50 ${styles[variant]} ${className}`}
    >
      {busy ? <Spinner className="h-4 w-4" /> : null}
      {children}
    </button>
  )
}

export function Sheet({
  open,
  onClose,
  title,
  children,
}: {
  open: boolean
  onClose: () => void
  title: string
  children: ReactNode
}) {
  const panelRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return

    const opener = document.activeElement as HTMLElement | null
    const focusables = () =>
      [
        ...(panelRef.current?.querySelectorAll<HTMLElement>(
          'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
        ) ?? []),
      ].filter((el) => !el.hasAttribute('disabled'))

    // Move focus in, and keep Tab inside: a modal the keyboard can walk out of
    // behind the backdrop is worse than no modal at all.
    focusables()[0]?.focus()

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose()
        return
      }
      if (e.key !== 'Tab') return

      const items = focusables()
      if (items.length === 0) return
      const first = items[0]
      const last = items[items.length - 1]

      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault()
        last.focus()
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault()
        first.focus()
      }
    }

    document.addEventListener('keydown', onKey)
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = ''
      opener?.focus?.()
    }
  }, [open, onClose])

  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center">
      <div
        className="absolute inset-0 bg-black/60"
        onClick={onClose}
        role="presentation"
        aria-hidden
      />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="relative max-h-[85vh] w-full overflow-y-auto rounded-t-2xl border border-hairline bg-surface p-4 pb-[calc(env(safe-area-inset-bottom)+1rem)] sm:max-w-md sm:rounded-2xl"
      >
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-base font-semibold">{title}</h2>
          <button
            onClick={onClose}
            aria-label="Close"
            className="flex min-h-11 min-w-11 items-center justify-center rounded-lg text-white/60 hover:bg-surface-2"
          >
            <X className="h-5 w-5" />
          </button>
        </div>
        {children}
      </div>
    </div>
  )
}

// ------------------------------------------------------------- toasts ---

export interface Toast {
  id: number
  message: string
  tone: 'ok' | 'error'
  undo?: () => void | Promise<void>
}

export function useToasts() {
  const [toasts, setToasts] = useState<Toast[]>([])
  const nextId = useRef(1)

  function push(message: string, tone: 'ok' | 'error' = 'ok', undo?: Toast['undo']) {
    const id = nextId.current++
    setToasts((t) => [...t, { id, message, tone, undo }])
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), undo ? 6000 : 3000)
  }

  function dismiss(id: number) {
    setToasts((t) => t.filter((x) => x.id !== id))
  }

  return { toasts, push, dismiss }
}

export function ToastStack({
  toasts,
  onDismiss,
}: {
  toasts: Toast[]
  onDismiss: (id: number) => void
}) {
  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-24 z-40 flex flex-col items-center gap-2 px-4">
      {toasts.map((t) => (
        <div
          key={t.id}
          role="status"
          className={`pointer-events-auto flex w-full max-w-sm items-center justify-between gap-3 rounded-xl border px-4 py-3 text-sm shadow-lg ${
            t.tone === 'error'
              ? 'border-bad/40 bg-bad/15 text-bad'
              : 'border-hairline bg-surface-2 text-white/90'
          }`}
        >
          <span className="min-w-0 flex-1 truncate">{t.message}</span>
          {t.undo ? (
            <button
              className="min-h-11 shrink-0 px-2 font-semibold text-brand-soft"
              onClick={() => {
                // Dismiss only once the undo actually lands, so a failure
                // leaves the button on screen to retry. The undo callback owns
                // reporting its own error.
                void Promise.resolve(t.undo?.()).then(() => onDismiss(t.id))
              }}
            >
              Undo
            </button>
          ) : null}
        </div>
      ))}
    </div>
  )
}
