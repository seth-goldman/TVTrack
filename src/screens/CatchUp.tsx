import { useState } from 'react'
import { ArrowLeft, Check, CircleSlash, Sparkles, TriangleAlert } from 'lucide-react'
import {
  addAndLoadEpisodes,
  applyProgress,
  resolveTitles,
} from '../lib/library'
import { describeProgress, type CatchUpEntry, type Progress, type TitleCandidate } from '../lib/catchup'
import { parseTitleList } from '../lib/catchup'
import { hasAired, seasonsOf } from '../lib/episodes'
import { episodeCode, pluralize } from '../lib/format'
import { Button, Poster, Sheet, Spinner } from '../components/ui'

// Onboarding for a library that has to be rebuilt from memory. Four steps:
// paste titles -> confirm the matches -> say where you are in each -> apply.
//
// Shows are added to the library at the start of step 3, not at the end. That
// is what makes the progress picker able to show real seasons and episodes,
// and it means abandoning halfway still leaves the shows tracked rather than
// losing the typing.
type Phase = 'paste' | 'confirm' | 'progress' | 'done'

interface Props {
  onBack: () => void
  onFinish: () => void
  toast: (message: string, tone?: 'ok' | 'error') => void
}

export default function CatchUp({ onBack, onFinish, toast }: Props) {
  const [phase, setPhase] = useState<Phase>('paste')
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [progressNote, setProgressNote] = useState('')
  const [entries, setEntries] = useState<CatchUpEntry[]>([])
  const [picking, setPicking] = useState<number | null>(null)
  const [episodePicker, setEpisodePicker] = useState<number | null>(null)

  const titles = parseTitleList(text)

  async function resolve() {
    if (titles.length === 0) return
    setBusy(true)
    try {
      const { resolved } = await resolveTitles(titles, 'tv')
      setEntries(
        resolved.map((r) => ({
          input: r.input,
          kind: r.kind,
          choice: r.candidates[0] ?? null,
          candidates: r.candidates,
          progress: { type: 'caught_up' } as Progress,
          episodes: [],
          status: 'pending',
        })),
      )
      setPhase('confirm')
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Could not look those up', 'error')
    } finally {
      setBusy(false)
    }
  }

  /** Add every confirmed show, then move to the progress step. Sequential on
   *  purpose: each add pulls a full season list from TMDB through the proxy,
   *  and firing fifty of those at once is exactly the burst the cache exists
   *  to avoid. */
  async function addAll() {
    const chosen = entries.filter((e) => e.choice !== null)
    if (chosen.length === 0) {
      toast('Nothing selected', 'error')
      return
    }

    setBusy(true)
    setPhase('progress')

    let done = 0
    for (const entry of chosen) {
      setProgressNote(`Adding ${entry.choice!.title}… ${done}/${chosen.length}`)
      setEntries((prev) =>
        prev.map((e) => (e.input === entry.input ? { ...e, status: 'adding' } : e)),
      )
      try {
        const episodes = await addAndLoadEpisodes(entry.choice!.id)
        setEntries((prev) =>
          prev.map((e) => (e.input === entry.input ? { ...e, episodes, status: 'ready' } : e)),
        )
      } catch (err) {
        setEntries((prev) =>
          prev.map((e) =>
            e.input === entry.input
              ? {
                  ...e,
                  status: 'failed',
                  error: err instanceof Error ? err.message : 'Could not add',
                }
              : e,
          ),
        )
      }
      done += 1
    }

    setProgressNote('')
    setBusy(false)
  }

  async function apply() {
    const ready = entries.filter((e) => e.choice !== null && e.status === 'ready')
    setBusy(true)

    let applied = 0
    for (const entry of ready) {
      setProgressNote(`Saving ${entry.choice!.title}… ${applied}/${ready.length}`)
      try {
        await applyProgress(entry.choice!.id, entry.episodes, entry.progress)
        applied += 1
      } catch (err) {
        toast(
          `${entry.choice!.title}: ${err instanceof Error ? err.message : 'could not save'}`,
          'error',
        )
      }
    }

    setProgressNote('')
    setBusy(false)
    setPhase('done')
    toast(`${pluralize(applied, 'show')} set up`)
  }

  function setEntry(input: string, patch: Partial<CatchUpEntry>) {
    setEntries((prev) => prev.map((e) => (e.input === input ? { ...e, ...patch } : e)))
  }

  const matched = entries.filter((e) => e.choice !== null).length
  const unmatched = entries.length - matched
  const readyEntries = entries.filter((e) => e.choice !== null && e.status === 'ready')
  const failedEntries = entries.filter((e) => e.status === 'failed')

  return (
    <div className="min-h-full pb-32">
      <header className="sticky top-0 z-20 flex items-center gap-2 border-b border-hairline bg-ink-900/85 px-2 pt-[env(safe-area-inset-top)] backdrop-blur">
        <button
          onClick={onBack}
          aria-label="Back"
          className="flex min-h-11 min-w-11 items-center justify-center rounded-lg text-white/70"
        >
          <ArrowLeft className="h-5 w-5" />
        </button>
        <h1 className="py-4 text-xl font-semibold tracking-tight">Set up my shows</h1>
      </header>

      <div className="px-4 pt-4">
        {/* ---------------------------------------------------- step 1 --- */}
        {phase === 'paste' ? (
          <>
            <p className="text-sm leading-relaxed text-white/55">
              List the shows you watch — one per line. Paste from a note, or just type them out.
              Numbering and bullets are fine.
            </p>
            <p className="pt-2 text-xs text-white/35">
              Add a year in brackets to disambiguate, like{' '}
              <span className="text-white/60">The Office (2005)</span>.
            </p>

            <textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              rows={12}
              placeholder={'Severance\nThe Bear\nSlow Horses\nAndor'}
              className="mt-4 w-full rounded-xl border border-hairline bg-surface p-3 font-mono text-sm outline-none focus:border-brand"
            />

            <div className="flex items-center justify-between pt-2">
              <span className="text-xs text-white/40">
                {titles.length > 0 ? pluralize(titles.length, 'title') : 'Nothing yet'}
              </span>
              <Button onClick={() => void resolve()} busy={busy} disabled={titles.length === 0}>
                Find these shows
              </Button>
            </div>
          </>
        ) : null}

        {/* ---------------------------------------------------- step 2 --- */}
        {phase === 'confirm' ? (
          <>
            <div className="rounded-xl border border-hairline bg-surface p-4">
              <p className="text-sm font-medium">
                {matched} of {entries.length} matched
              </p>
              <p className="pt-1 text-xs text-white/50">
                Tap any row to pick a different match or skip it.
              </p>
              <Button className="mt-3 w-full" onClick={() => void addAll()} disabled={matched === 0}>
                Add {matched} {matched === 1 ? 'show' : 'shows'}
              </Button>
            </div>

            <div className="flex flex-col gap-2 pt-4">
              {entries.map((entry, i) => (
                <button
                  key={entry.input}
                  onClick={() => setPicking(i)}
                  className="flex items-center gap-3 rounded-xl border border-hairline bg-surface p-2 text-left"
                >
                  {entry.choice ? (
                    <Poster
                      path={entry.choice.poster_path}
                      alt={entry.choice.title}
                      className="h-16 w-11 shrink-0"
                      size="w154"
                    />
                  ) : (
                    <div className="flex h-16 w-11 shrink-0 items-center justify-center rounded-lg bg-surface-2">
                      <TriangleAlert className="h-4 w-4 text-bad" />
                    </div>
                  )}
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">
                      {entry.choice?.title ?? entry.input}
                      {entry.choice?.year ? (
                        <span className="text-white/35"> ({entry.choice.year})</span>
                      ) : null}
                    </p>
                    <p className="truncate text-xs text-white/45">
                      {entry.choice
                        ? entry.choice.title.toLowerCase() === entry.input.toLowerCase()
                          ? 'Exact match'
                          : `You typed “${entry.input}”`
                        : 'No match — tap to search'}
                    </p>
                  </div>
                  <span className="shrink-0 text-xs text-white/30">Change</span>
                </button>
              ))}
            </div>

            {unmatched > 0 ? (
              <p className="pt-3 text-xs text-white/35">
                {unmatched} {unmatched === 1 ? 'title' : 'titles'} did not match and will be skipped.
              </p>
            ) : null}
          </>
        ) : null}

        {/* ---------------------------------------------------- step 3 --- */}
        {phase === 'progress' ? (
          <>
            {busy ? (
              <div className="mb-4 flex items-center gap-3 rounded-xl border border-hairline bg-surface p-4">
                <Spinner className="h-5 w-5 text-brand-soft" />
                <p className="text-sm">{progressNote || 'Working…'}</p>
              </div>
            ) : (
              <div className="rounded-xl border border-hairline bg-surface p-4">
                <p className="text-sm font-medium">Where are you in each show?</p>
                <p className="pt-1 text-xs text-white/50">
                  Everything starts on “Caught up”. Change only the ones you are behind on.
                </p>
                <Button className="mt-3 w-full" onClick={() => void apply()}>
                  Save {pluralize(readyEntries.length, 'show')}
                </Button>
              </div>
            )}

            <div className="flex flex-col gap-2 pt-4">
              {readyEntries.map((entry, i) => (
                <div
                  key={entry.input}
                  className="rounded-xl border border-hairline bg-surface p-2"
                >
                  <div className="flex items-center gap-3">
                    <Poster
                      path={entry.choice!.poster_path}
                      alt={entry.choice!.title}
                      className="h-16 w-11 shrink-0"
                      size="w154"
                    />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">{entry.choice!.title}</p>
                      <p className="truncate text-xs text-white/45">
                        {describeProgress(entry.progress)}
                      </p>
                    </div>
                  </div>

                  <div className="flex gap-1 pt-2">
                    <ProgressChip
                      active={entry.progress.type === 'caught_up'}
                      onClick={() => setEntry(entry.input, { progress: { type: 'caught_up' } })}
                    >
                      Caught up
                    </ProgressChip>
                    <ProgressChip
                      active={entry.progress.type === 'not_started'}
                      onClick={() => setEntry(entry.input, { progress: { type: 'not_started' } })}
                    >
                      Not started
                    </ProgressChip>
                    <ProgressChip
                      active={entry.progress.type === 'through'}
                      onClick={() => setEpisodePicker(i)}
                    >
                      Pick episode
                    </ProgressChip>
                  </div>
                </div>
              ))}
            </div>

            {failedEntries.length > 0 ? (
              <div className="mt-4 rounded-xl border border-bad/30 bg-bad/10 p-3 text-xs text-bad">
                <p className="font-medium">Could not add:</p>
                <ul className="pt-1">
                  {failedEntries.map((e) => (
                    <li key={e.input}>· {e.choice?.title ?? e.input}</li>
                  ))}
                </ul>
              </div>
            ) : null}
          </>
        ) : null}

        {/* ---------------------------------------------------- step 4 --- */}
        {phase === 'done' ? (
          <div className="rounded-xl border border-good/30 bg-good/10 p-4">
            <p className="flex items-center gap-2 text-sm font-medium text-good">
              <Sparkles className="h-4 w-4" /> Library set up
            </p>
            <p className="pt-1 text-xs text-white/60">
              Up Next now has the next episode for everything you were behind on.
            </p>
            <Button className="mt-3 w-full" onClick={onFinish}>
              Go to Up Next
            </Button>
          </div>
        ) : null}
      </div>

      <MatchPicker
        entry={picking === null ? null : entries[picking]}
        onClose={() => setPicking(null)}
        onPick={(candidate) => {
          if (picking !== null) setEntry(entries[picking].input, { choice: candidate })
          setPicking(null)
        }}
      />

      <EpisodePicker
        entry={episodePicker === null ? null : readyEntries[episodePicker]}
        onClose={() => setEpisodePicker(null)}
        onPick={(season, episode) => {
          if (episodePicker !== null) {
            setEntry(readyEntries[episodePicker].input, {
              progress: { type: 'through', season, episode },
            })
          }
          setEpisodePicker(null)
        }}
      />
    </div>
  )
}

function ProgressChip({
  active,
  onClick,
  children,
}: {
  active: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      onClick={onClick}
      aria-pressed={active}
      className={`min-h-11 flex-1 rounded-lg px-2 text-xs font-medium ${
        active ? 'bg-brand text-white' : 'bg-surface-2 text-white/55'
      }`}
    >
      {children}
    </button>
  )
}

/** The candidates TMDB returned for a typed line, plus a skip. */
function MatchPicker({
  entry,
  onClose,
  onPick,
}: {
  entry: CatchUpEntry | null
  onClose: () => void
  onPick: (candidate: TitleCandidate | null) => void
}) {
  if (!entry) return null

  return (
    <Sheet open onClose={onClose} title={`“${entry.input}”`}>
      {entry.candidates.length === 0 ? (
        <p className="pb-3 text-sm text-white/50">
          Nothing on TMDB matched this. Try a different spelling on the previous screen, or add it
          later from the Add tab.
        </p>
      ) : null}

      <div className="flex flex-col gap-2">
        {entry.candidates.map((candidate) => (
          <button
            key={candidate.id}
            onClick={() => onPick(candidate)}
            className={`flex items-center gap-3 rounded-xl border p-2 text-left ${
              candidate.id === entry.choice?.id ? 'border-good bg-good/10' : 'border-hairline'
            }`}
          >
            <Poster
              path={candidate.poster_path}
              alt={candidate.title}
              className="h-16 w-11 shrink-0"
              size="w154"
            />
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm">{candidate.title}</p>
              <p className="text-xs text-white/40">{candidate.year ?? '—'}</p>
            </div>
          </button>
        ))}
      </div>

      <Button variant="ghost" className="mt-3 w-full" onClick={() => onPick(null)}>
        <CircleSlash className="h-4 w-4" />
        Skip this one
      </Button>
    </Sheet>
  )
}

/** Season and episode grid for "I'm partway through". Only aired episodes are
 *  offered — you cannot be behind on something that has not aired. */
function EpisodePicker({
  entry,
  onClose,
  onPick,
}: {
  entry: CatchUpEntry | null
  onClose: () => void
  onPick: (season: number, episode: number) => void
}) {
  const [season, setSeason] = useState<number | null>(null)

  if (!entry) return null

  const aired = entry.episodes.filter(hasAired)
  const seasons = seasonsOf(aired)
  const activeSeason = season ?? (entry.progress.type === 'through' ? entry.progress.season : seasons.at(-1) ?? 1)
  const episodes = aired.filter((e) => e.season === activeSeason)

  return (
    <Sheet open onClose={onClose} title={`Last watched — ${entry.choice?.title ?? ''}`}>
      {seasons.length === 0 ? (
        <p className="text-sm text-white/50">
          No aired episodes are cached for this show yet.
        </p>
      ) : (
        <>
          <div className="no-scrollbar -mx-1 flex gap-2 overflow-x-auto px-1 pb-3">
            {seasons.map((s) => (
              <button
                key={s}
                onClick={() => setSeason(s)}
                className={`min-h-11 shrink-0 rounded-full px-4 text-sm font-medium ${
                  s === activeSeason ? 'bg-brand text-white' : 'bg-surface-2 text-white/55'
                }`}
              >
                Season {s}
              </button>
            ))}
          </div>

          <div className="flex flex-col">
            {episodes.map((e) => (
              <button
                key={`${e.season}-${e.episode}`}
                onClick={() => onPick(e.season, e.episode)}
                className="flex min-h-11 items-center gap-3 border-t border-hairline/60 px-1 py-2 text-left"
              >
                <Check className="h-4 w-4 shrink-0 text-white/20" />
                <span className="min-w-0 flex-1 truncate text-sm">
                  <span className="text-white/40">{episodeCode(e.season, e.episode)}</span>{' '}
                  {e.name ?? ''}
                </span>
              </button>
            ))}
          </div>
        </>
      )}
    </Sheet>
  )
}
