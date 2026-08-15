import { useEffect, useMemo, useRef, useState } from 'react'
import { Check, Download, ListPlus, LogOut, Upload } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { downloadCsvs, downloadJson } from '../lib/export'
import { getMovies, getShows, getStats, saveUserSettings } from '../lib/library'
import { providerLogoUrl } from '../lib/images'
import { knownProviders, WATCH_REGIONS, type WatchSettings } from '../lib/providers'
import { createSettingsReconciler } from '../lib/settingsSave'
import { publishWatchSettings, useWatchProviders, useWatchSettings } from '../lib/useWatchProviders'
import type { MonthStat } from '../lib/types'
import { formatHours } from '../lib/format'
import { Button, Screen } from '../components/ui'
import { JustWatchCredit } from '../components/WatchProviders'

interface Props {
  email: string | null
  onImport: () => void
  onCatchUp: () => void
  toast: (message: string, tone?: 'ok' | 'error') => void
}

export default function Settings({ email, onImport, onCatchUp, toast }: Props) {
  const [stats, setStats] = useState<MonthStat[] | null>(null)
  const [busy, setBusy] = useState<'json' | 'csv' | null>(null)
  const [showIds, setShowIds] = useState<number[]>([])
  const [movieIds, setMovieIds] = useState<number[]>([])

  useEffect(() => {
    getStats()
      .then(setStats)
      .catch(() => setStats([]))
  }, [])

  // The subscription picker offers the services that actually appear in this
  // library rather than TMDB's several hundred worldwide providers.
  useEffect(() => {
    getShows()
      .then((rows) => setShowIds(rows.map((r) => r.id)))
      .catch(() => setShowIds([]))
    getMovies()
      .then((rows) => setMovieIds(rows.map((r) => r.id)))
      .catch(() => setMovieIds([]))
  }, [])

  const settings = useWatchSettings()
  // Read-only: this screen summarises what the badge-bearing screens have
  // already looked up. Warming here would mean opening Settings to export a
  // CSV kicked off a TMDB refresh of the entire library.
  const showWatch = useWatchProviders('tv', showIds, { warm: false })
  const movieWatch = useWatchProviders('movie', movieIds, { warm: false })

  const providerOptions = useMemo(
    () => knownProviders([...showWatch.entries.values(), ...movieWatch.entries.values()]),
    [showWatch.entries, movieWatch.entries],
  )

  // Ordering the writes and picking the right value to roll back to is subtle
  // enough that the inline version was wrong three times during review, so it
  // lives in settingsSave.ts where it has tests. This screen just drives it.
  const reconciler = useRef(
    createSettingsReconciler(saveUserSettings, publishWatchSettings),
  ).current

  useEffect(() => {
    if (settings) reconciler.seed(settings)
  }, [settings, reconciler])

  /** Applied optimistically and published so every mounted screen re-badges
   *  immediately; a failed write rolls back to the last confirmed value. */
  async function updateSettings(next: WatchSettings) {
    const error = await reconciler.save(next)
    if (error) toast(error.message, 'error')
  }

  function toggleProvider(id: number) {
    if (!settings) return
    const has = settings.subscribed_providers.includes(id)
    void updateSettings({
      ...settings,
      subscribed_providers: has
        ? settings.subscribed_providers.filter((p) => p !== id)
        : [...settings.subscribed_providers, id],
    })
  }

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
        <h2 className="pb-2 text-xs font-semibold tracking-wide text-white/40 uppercase">
          Where to watch
        </h2>
        <div className="rounded-xl border border-hairline bg-surface p-4">
          <label htmlFor="watch-region" className="block text-sm font-medium">
            Region
          </label>
          <p className="pt-1 text-xs text-white/45">
            Streaming rights differ by country, so this decides which services are shown.
          </p>
          <select
            id="watch-region"
            value={settings?.watch_region ?? 'US'}
            disabled={!settings}
            onChange={(e) =>
              settings ? void updateSettings({ ...settings, watch_region: e.target.value }) : null
            }
            className="mt-2 min-h-11 w-full rounded-xl border border-hairline bg-surface-2 px-3 text-sm disabled:opacity-50"
          >
            {WATCH_REGIONS.map((r) => (
              <option key={r.code} value={r.code}>
                {r.name}
              </option>
            ))}
          </select>

          <p className="pt-5 text-sm font-medium">Services you subscribe to</p>
          <p className="pt-1 text-xs text-white/45">
            Tap the ones you pay for. They get highlighted on posters and sorted first, so a show
            you can already stream never looks like one you have to rent.
          </p>

          {providerOptions.length === 0 ? (
            <p className="pt-3 text-xs text-white/35">
              {showIds.length + movieIds.length === 0
                ? 'Add some shows first — this list is built from what your library is available on.'
                : showWatch.loading || movieWatch.loading
                  ? 'Working out which services your library is on…'
                  : 'Open Up Next or Library once and this fills in with the services your shows are on.'}
            </p>
          ) : (
            <div className="flex flex-wrap gap-2 pt-3">
              {providerOptions.map((provider) => {
                const on = settings?.subscribed_providers.includes(provider.id) ?? false
                const logo = providerLogoUrl(provider.logo_path)
                return (
                  <button
                    key={provider.id}
                    onClick={() => toggleProvider(provider.id)}
                    disabled={!settings}
                    aria-pressed={on}
                    className={`inline-flex min-h-11 items-center gap-2 rounded-xl border px-2.5 text-xs font-medium transition-colors disabled:opacity-50 ${
                      on
                        ? 'border-brand bg-brand/15 text-white'
                        : 'border-hairline bg-surface-2 text-white/60'
                    }`}
                  >
                    {logo ? (
                      <img src={logo} alt="" loading="lazy" className="h-5 w-5 rounded object-cover" />
                    ) : null}
                    <span className="max-w-32 truncate">{provider.name}</span>
                    {on ? <Check className="h-3.5 w-3.5 shrink-0 text-brand-soft" /> : null}
                  </button>
                )
              })}
            </div>
          )}

          <div className="pt-4">
            <JustWatchCredit />
          </div>
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
