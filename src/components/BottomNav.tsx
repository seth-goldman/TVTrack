import { CalendarDays, Library, Play, Search, Settings } from 'lucide-react'

const TABS = [
  { path: '/', label: 'Up Next', Icon: Play },
  { path: '/upcoming', label: 'Upcoming', Icon: CalendarDays },
  { path: '/search', label: 'Add', Icon: Search },
  { path: '/library', label: 'Library', Icon: Library },
  { path: '/settings', label: 'Settings', Icon: Settings },
]

export default function BottomNav({
  path,
  onNavigate,
}: {
  path: string
  onNavigate: (to: string) => void
}) {
  return (
    <nav
      aria-label="Primary"
      className="fixed inset-x-0 bottom-0 z-30 border-t border-hairline bg-ink-900/95 pb-[env(safe-area-inset-bottom)] backdrop-blur"
    >
      <ul className="flex">
        {TABS.map(({ path: to, label, Icon }) => {
          const active = to === '/' ? path === '/' : path.startsWith(to)
          return (
            <li key={to} className="flex-1">
              <button
                onClick={() => onNavigate(to)}
                aria-current={active ? 'page' : undefined}
                className={`flex min-h-14 w-full flex-col items-center justify-center gap-0.5 text-[10px] font-medium ${
                  active ? 'text-brand-soft' : 'text-white/45'
                }`}
              >
                <Icon className="h-5 w-5" />
                {label}
              </button>
            </li>
          )
        })}
      </ul>
    </nav>
  )
}
