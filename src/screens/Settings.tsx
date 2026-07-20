import { useEffect, useState } from 'react'
import { Download, ListPlus, LogOut, Upload } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { downloadCsvs, downloadJson } from '../lib/export'
import { getStats } from '../lib/library'
import type { MonthStat } from '../lib/types'
import { formatHours } from '../lib/format'
import { Button, Screen } from '../components/ui'

interface Props {
  email: string | null
  onImport: () => void
  onCatchUp: () => void
  toast: (message: string, tone?: 'ok' | 'error') => void
}

export default function Settings({ email, onImport, onCatchUp, toast }: Props) {
  const [stats, setStats] = useState<MonthStat[] | null>(null)
  const [busy, setBusy] = useState<'json' | 'csv' | null>(null)

  useEffect(() => {
    getStats()
      .then(setStats)
      .catch(() => setStats([]))
  }, [])

  async function exportAs(kind: 'json' | 'csv') {
    setBusy(kind)
    try {
      if (kind === 'json') await downloadJson()
      else await downloadCsvs()
      toast('Export downloaded')
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Export failed', 'error')
    } finally {
      setBusy(null)
    }
  }

  const totals = (stats ?? []).reduce(
    (acc, row) => ({ episodes: acc.episodes + row.episodes, minutes: acc.minutes + row.minutes }),
    { episodes: 0, minutes: 0 },
  )
  const recent = (stats ?? []).slice(0, 12).reverse()
  const peak = Math.max(1, ...recent.map((r) => r.episodes))

  return (
    <Screen title="Settings">
      <section className="pt-4">
        <h2 className="pb-2 text-xs font-semibold tracking-wide text-white/40 uppercase">
          Your watching
        </h2>
        <div className="rounded-xl border border-hairline bg-surface p-4">
          <div className="flex gap-6">
            <div>
              <p className="text-2xl font-semibold">{totals.episodes.toLocaleString()}</p>
              <p className="text-xs text-white/45">episodes</p>
            </div>
            <div>
              <p className="text-2xl font-semibold">{formatHours(totals.minutes)}</p>
              <p className="text-xs text-white/45">watched</p>
            </div>
          </div>

          {recent.length > 0 ? (
            <div className="mt-4 flex h-16 items-end gap-1">
              {recent.map((row) => (
                <div
                  key={row.month}
                  title={`${row.month.slice(0, 7)}: ${row.episodes} episodes`}
                  className="flex-1 rounded-t bg-brand/70"
                  style={{ height: `${Math.max(4, (row.episodes / peak) * 100)}%` }}
                />
              ))}
            </div>
          ) : null}
          <p className="pt-2 text-[11px] text-white/30">
            {recent.length > 0 ? 'Episodes per month, last 12 months' : 'No check-ins yet'}
          </p>
        </div>
      </section>

      <section className="pt-8">
        <h2 className="pb-2 text-xs font-semibold tracking-wide text-white/40 uppercase">Data</h2>
        <div className="flex flex-col gap-2">
          <Button variant="subtle" onClick={onCatchUp}>
            <ListPlus className="h-4 w-4" />
            Set up shows from a list
          </Button>
          <Button variant="subtle" onClick={onImport}>
            <Upload className="h-4 w-4" />
            Import a file
          </Button>
          <Button variant="subtle" busy={busy === 'json'} onClick={() => void exportAs('json')}>
            <Download className="h-4 w-4" />
            Export everything as JSON
          </Button>
          <Button variant="subtle" busy={busy === 'csv'} onClick={() => void exportAs('csv')}>
            <Download className="h-4 w-4" />
            Export everything as CSV
          </Button>
        </div>
        <p className="pt-2 text-xs text-white/35">
          Exports contain every row you own — shows, check-ins, movies and ratings.
        </p>
      </section>

      <section className="pt-8">
        <h2 className="pb-2 text-xs font-semibold tracking-wide text-white/40 uppercase">Account</h2>
        <div className="rounded-xl border border-hairline bg-surface p-4">
          <p className="text-sm">{email ?? 'Signed in'}</p>
          <Button
            variant="ghost"
            className="mt-2 !px-0"
            onClick={() => void supabase.auth.signOut()}
          >
            <LogOut className="h-4 w-4" />
            Sign out
          </Button>
        </div>
      </section>

      <section className="pt-8 pb-4">
        <p className="text-xs leading-relaxed text-white/35">
          This product uses the TMDB API but is not endorsed or certified by TMDB.
        </p>
        <a
          href="https://www.themoviedb.org/"
          target="_blank"
          rel="noreferrer noopener"
          className="mt-2 inline-block text-xs text-brand-soft"
        >
          themoviedb.org
        </a>
      </section>
    </Screen>
  )
}
