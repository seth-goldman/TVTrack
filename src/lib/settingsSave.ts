import type { WatchSettings } from './providers'

// Reconciling optimistic settings saves with what the server actually accepted.
//
// This is extracted from Settings.tsx and given its own tests because the
// inline version was wrong three times in a row during review: it lost an
// update when two writes raced, then rolled back to a value that had never
// been persisted, then rolled back past one that had. The rules are simple
// enough to state and subtle enough to get wrong, which is exactly what a pure
// module is for.
//
// The three rules:
//   1. Writes go out in the order they were made. Each one replaces the whole
//      row, so an older write landing last would resurrect a stale snapshot.
//   2. Only the newest attempt may roll the UI back. An older failure must not
//      discard a newer choice the user can already see applied.
//   3. A rollback restores the last value the *server confirmed*, read at the
//      moment of failure -- never the previous optimistic value, and never a
//      value captured before earlier queued writes had settled.

export interface SettingsReconciler {
  /**
   * Apply a new value optimistically and persist it.
   *
   * `publish` is called immediately with `next`, and again with the value to
   * fall back to if this write fails and is still the newest one. Resolves
   * with the error when the write failed (never rejects), so the caller can
   * decide how to report it.
   */
  save(next: WatchSettings): Promise<Error | null>
  /** The last value the server accepted, or null before any load. */
  confirmed(): WatchSettings | null
  /**
   * Seed the confirmed value from the initial load.
   *
   * Ignored once anything has been confirmed -- a slow initial read must not
   * clobber a save that has since succeeded. Deliberately NOT ignored merely
   * because a save has started: callers seed from a passive effect, which React
   * runs after paint, so a fast tap can beat it. Blocking the seed there would
   * leave the reconciler with no rollback target at all, and a failed write
   * would strand the optimistic value on screen.
   */
  seed(settings: WatchSettings): void
}

export function createSettingsReconciler(
  write: (settings: WatchSettings) => Promise<void>,
  publish: (settings: WatchSettings) => void,
): SettingsReconciler {
  let confirmed: WatchSettings | null = null
  let seq = 0
  // Serialises the writes. Each link swallows the previous link's rejection so
  // one failure does not abort every queued write behind it.
  let queue: Promise<unknown> = Promise.resolve()

  return {
    confirmed: () => confirmed,

    seed(settings) {
      if (confirmed !== null) return
      confirmed = settings
    },

    async save(next) {
      const mine = ++seq
      publish(next)

      const run = queue.catch(() => {}).then(() => write(next))
      queue = run.catch(() => {})

      try {
        await run
        confirmed = next
        return null
      } catch (error) {
        // `confirmed` is read here, not captured above: the queue guarantees
        // every earlier write has settled by now, so if one of them succeeded
        // this picks up its value rather than rolling back past it.
        if (mine === seq && confirmed) publish(confirmed)
        return error instanceof Error ? error : new Error(String(error))
      }
    },
  }
}
