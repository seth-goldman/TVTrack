import { describe, expect, it } from 'vitest'
import { createSettingsReconciler } from './settingsSave'
import type { WatchSettings } from './providers'

// Every case below is a bug that actually shipped into a review round. The
// inline version of this logic was wrong three times running, so these are
// regression tests first and documentation second.

const S0: WatchSettings = { watch_region: 'US', subscribed_providers: [] }
const S1: WatchSettings = { watch_region: 'US', subscribed_providers: [8] }
const S2: WatchSettings = { watch_region: 'US', subscribed_providers: [8, 15] }

/** Flush pending microtasks. `save` hands the write to a promise chain rather
 *  than calling it synchronously, so a test must let the queue advance before
 *  inspecting which writes have actually been issued. */
async function tick(times = 4): Promise<void> {
  for (let i = 0; i < times; i++) await Promise.resolve()
}

/** A write whose success or failure is decided per call, resolved by hand so a
 *  test can control the order two in-flight writes complete in. */
function controllable() {
  const calls: { settings: WatchSettings; settle: (ok: boolean) => void }[] = []
  const write = (settings: WatchSettings) =>
    new Promise<void>((resolve, reject) => {
      calls.push({
        settings,
        settle: (ok) => (ok ? resolve() : reject(new Error('write failed'))),
      })
    })
  return { calls, write }
}

function harness(write: (s: WatchSettings) => Promise<void>) {
  const published: WatchSettings[] = []
  const reconciler = createSettingsReconciler(write, (s) => published.push(s))
  return { published, reconciler }
}

describe('createSettingsReconciler', () => {
  it('publishes optimistically before the write resolves', async () => {
    const { calls, write } = controllable()
    const { published, reconciler } = harness(write)

    const done = reconciler.save(S1)
    expect(published).toEqual([S1])
    expect(reconciler.confirmed()).toBeNull()

    await tick()
    calls[0].settle(true)
    expect(await done).toBeNull()
    expect(reconciler.confirmed()).toEqual(S1)
  })

  it('reports the failure without rejecting', async () => {
    const { calls, write } = controllable()
    const { reconciler } = harness(write)

    const done = reconciler.save(S1)
    await tick()
    calls[0].settle(false)
    expect(await done).toBeInstanceOf(Error)
  })

  // Rule 1: writes are serialised, so the newest value is the one left in the
  // row even if the requests would otherwise have raced.
  it('sends writes in order rather than concurrently', async () => {
    const { calls, write } = controllable()
    const { reconciler } = harness(write)

    reconciler.seed(S0)
    void reconciler.save(S1)
    void reconciler.save(S2)

    await tick()
    expect(calls).toHaveLength(1)
    expect(calls[0].settings).toEqual(S1)

    calls[0].settle(true)
    await tick()

    expect(calls).toHaveLength(2)
    expect(calls[1].settings).toEqual(S2)
  })

  // Rule 2: an older failure must not discard a newer choice already on screen.
  it('does not roll back when a superseded write fails', async () => {
    const { calls, write } = controllable()
    const { published, reconciler } = harness(write)

    reconciler.seed(S0)
    const first = reconciler.save(S1)
    void reconciler.save(S2)

    await tick()
    calls[0].settle(false)
    expect(await first).toBeInstanceOf(Error)

    // S1 and S2 optimistically, and nothing else -- no rollback to S0.
    expect(published).toEqual([S1, S2])
  })

  // Rule 3, first half: two consecutive failures must land on the value the
  // server actually holds, not on the first failed attempt's value.
  it('rolls back to the seeded value when both writes fail', async () => {
    const { calls, write } = controllable()
    const { published, reconciler } = harness(write)

    reconciler.seed(S0)
    const first = reconciler.save(S1)
    const second = reconciler.save(S2)

    await tick()
    calls[0].settle(false)
    await first
    await tick()

    calls[1].settle(false)
    await second

    expect(published).toEqual([S1, S2, S0])
    expect(reconciler.confirmed()).toEqual(S0)
  })

  // Rule 3, second half: the earlier write succeeded, so the rollback target
  // moved. Capturing it up front would discard a save that did land.
  it('rolls back to the earlier write when that one succeeded', async () => {
    const { calls, write } = controllable()
    const { published, reconciler } = harness(write)

    reconciler.seed(S0)
    void reconciler.save(S1)
    const second = reconciler.save(S2)

    await tick()
    calls[0].settle(true)
    await tick()

    calls[1].settle(false)
    await second

    expect(published).toEqual([S1, S2, S1])
    expect(reconciler.confirmed()).toEqual(S1)
  })

  it('ignores a late seed so a slow read cannot undo a saved value', async () => {
    const { calls, write } = controllable()
    const { reconciler } = harness(write)

    const done = reconciler.save(S1)
    await tick()
    calls[0].settle(true)
    await done

    reconciler.seed(S0)
    expect(reconciler.confirmed()).toEqual(S1)
  })

  // The seeding effect is passive, so React runs it after paint -- a fast tap on
  // a freshly loaded screen beats it. The seed must still take effect, or the
  // reconciler has no rollback target and a failed write strands the optimistic
  // value on screen permanently.
  it('accepts a seed that arrives after a save has already started', async () => {
    const { calls, write } = controllable()
    const { published, reconciler } = harness(write)

    const done = reconciler.save(S1)
    reconciler.seed(S0)
    expect(reconciler.confirmed()).toEqual(S0)

    await tick()
    calls[0].settle(false)
    await done

    expect(published).toEqual([S1, S0])
  })

  // The mirror of the case above: the write fails *before* the seed lands, so
  // there is no baseline to roll back to at failure time. The rollback is owed
  // until the seed supplies one -- otherwise the failed value sits on screen
  // permanently with nothing behind it.
  it('rolls back when the seed arrives after the save has already failed', async () => {
    const { calls, write } = controllable()
    const { published, reconciler } = harness(write)

    const done = reconciler.save(S1)
    await tick()
    calls[0].settle(false)
    await done

    expect(published).toEqual([S1])

    reconciler.seed(S0)
    expect(published).toEqual([S1, S0])
    expect(reconciler.confirmed()).toEqual(S0)
  })

  // ...but only if nothing newer is on screen. A newer save owns the display.
  it('does not pay an owed rollback once a newer save has started', async () => {
    const { calls, write } = controllable()
    const { published, reconciler } = harness(write)

    const first = reconciler.save(S1)
    await tick()
    calls[0].settle(false)
    await first

    void reconciler.save(S2)
    reconciler.seed(S0)

    expect(published).toEqual([S1, S2])
    expect(reconciler.confirmed()).toEqual(S0)
  })

  it('takes only the first seed', () => {
    const { write } = controllable()
    const { reconciler } = harness(write)

    reconciler.seed(S0)
    reconciler.seed(S2)
    expect(reconciler.confirmed()).toEqual(S0)
  })
})
