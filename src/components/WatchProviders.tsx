import { Info } from 'lucide-react'
import { providerLogoUrl } from '../lib/images'
import {
  badgeProvider,
  groupedProviders,
  isEmpty,
  regionName,
  type WatchProvider,
  type WatchProviderEntry,
  type WatchSettings,
} from '../lib/providers'
import { Sheet } from './ui'

// Where-to-watch UI. Three surfaces, one data shape:
//
//   ProviderBadge  — one logo on a poster in a grid. An indicator, never a
//                    button: at 28px it could not carry a 44px tap target, and
//                    the card underneath already has one.
//   ProviderChips  — the full answer on Show detail, where there is room.
//   WhereToWatchSheet — the popup, opened from a card's "..." menu or the
//                    chips' info button.
//
// TMDB's terms require crediting JustWatch as the source, so every surface that
// shows more than a bare logo carries the credit.

function ProviderLogo({
  provider,
  className = '',
}: {
  provider: WatchProvider
  className?: string
}) {
  const url = providerLogoUrl(provider.logo_path)
  if (!url) {
    return (
      <span
        className={`flex items-center justify-center bg-surface-2 text-[10px] font-bold text-white/60 ${className}`}
        aria-hidden
      >
        {provider.name.slice(0, 1)}
      </span>
    )
  }
  return <img src={url} alt="" loading="lazy" className={`object-cover ${className}`} />
}

/**
 * The single logo shown over a poster. Renders nothing unless the title is
 * watchable at no extra cost — an absent badge means "not included with
 * anything", which is a useful answer in itself once the grid is consistent
 * about it.
 */
export function ProviderBadge({
  entry,
  settings,
  className = '',
}: {
  entry: WatchProviderEntry | null | undefined
  settings: WatchSettings
  className?: string
}) {
  const badge = badgeProvider(entry, settings)
  if (!badge) return null

  return (
    <span
      title={
        badge.subscribed
          ? `${badge.provider.name} — you have this`
          : `Streaming on ${badge.provider.name}`
      }
      className={`pointer-events-none absolute top-1 left-1 block h-7 w-7 overflow-hidden rounded-lg shadow-md ring-2 ${
        badge.subscribed ? 'ring-brand' : 'ring-black/40 saturate-[0.85]'
      } ${className}`}
    >
      <ProviderLogo provider={badge.provider} className="h-full w-full" />
      <span className="sr-only">
        {badge.subscribed
          ? `On ${badge.provider.name}, which you subscribe to`
          : `Streaming on ${badge.provider.name}`}
      </span>
    </span>
  )
}

/** The chip row on Show detail: every option, grouped, with the user's own
 *  services first. Each chip opens TMDB's watch page, which is the only place
 *  a rental price actually exists — the API carries none. */
export function ProviderChips({
  entry,
  settings,
  loading,
  onMore,
}: {
  entry: WatchProviderEntry | null | undefined
  settings: WatchSettings
  /** True only while a lookup is actually in flight. Without it a failed
   *  lookup leaves this claiming to still be checking, forever. */
  loading: boolean
  onMore: () => void
}) {
  const groups = groupedProviders(entry, settings)

  if (groups.length === 0) {
    return (
      <p className="text-xs text-white/35">
        {entry && isEmpty(entry)
          ? `Not streaming in ${regionName(settings.watch_region)} right now.`
          : loading
            ? 'Checking where to watch…'
            : "Couldn't check where to watch right now."}
      </p>
    )
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <h2 className="text-xs font-semibold tracking-wide text-white/40 uppercase">
          Where to watch
        </h2>
        <button
          onClick={onMore}
          aria-label="Where to watch details"
          className="flex min-h-11 min-w-11 items-center justify-center rounded-lg text-white/40 hover:bg-surface-2"
        >
          <Info className="h-4 w-4" />
        </button>
      </div>

      {groups.map((group) => (
        <div key={group.key} className="flex flex-wrap items-center gap-1.5">
          <span className="w-11 shrink-0 text-[11px] text-white/35">{group.label}</span>
          {group.providers.map(({ provider, subscribed }) => (
            <ProviderChip
              key={provider.id}
              provider={provider}
              subscribed={subscribed}
              included={group.included}
              link={entry?.link ?? null}
            />
          ))}
        </div>
      ))}
    </div>
  )
}

function ProviderChip({
  provider,
  subscribed,
  included,
  link,
}: {
  provider: WatchProvider
  subscribed: boolean
  included: boolean
  link: string | null
}) {
  const tone = subscribed
    ? 'border-brand bg-brand/15 text-white'
    : included
      ? 'border-hairline bg-surface-2 text-white/85'
      : 'border-hairline/60 bg-transparent text-white/45'

  const content = (
    <>
      <ProviderLogo provider={provider} className="h-5 w-5 shrink-0 rounded" />
      <span className="truncate">{provider.name}</span>
    </>
  )

  const className = `inline-flex min-h-11 max-w-full items-center gap-1.5 rounded-xl border px-2 text-xs font-medium ${tone}`

  if (!link) return <span className={className}>{content}</span>

  return (
    <a
      href={link}
      target="_blank"
      rel="noreferrer noopener"
      className={className}
      title={subscribed ? `${provider.name} — you have this` : provider.name}
    >
      {content}
    </a>
  )
}

/** The popup. Same data as the chips, with room for the region, the
 *  subscription hint and the JustWatch credit. */
export function WhereToWatchSheet({
  open,
  onClose,
  title,
  entry,
  settings,
  loading,
}: {
  open: boolean
  onClose: () => void
  title: string
  entry: WatchProviderEntry | null | undefined
  settings: WatchSettings
  loading: boolean
}) {
  const groups = groupedProviders(entry, settings)

  return (
    <Sheet open={open} onClose={onClose} title={`Where to watch — ${title}`}>
      <div className="flex flex-col gap-4">
        {groups.length === 0 ? (
          <p className="text-sm text-white/55">
            {entry
              ? `TMDB has no listings for this in ${regionName(settings.watch_region)}. You can change your region in Settings.`
              : loading
                ? 'Still checking where this is available.'
                : "Couldn't reach the listings for this one. Try again in a moment."}
          </p>
        ) : null}

        {groups.map((group) => (
          <div key={group.key}>
            <h3 className="pb-2 text-xs font-semibold tracking-wide text-white/40 uppercase">
              {group.label}
              {group.included ? '' : ' — costs extra'}
            </h3>
            <div className="flex flex-col gap-1.5">
              {group.providers.map(({ provider, subscribed }) => (
                <div
                  key={provider.id}
                  className={`flex min-h-11 items-center gap-3 rounded-xl border px-3 ${
                    subscribed ? 'border-brand bg-brand/10' : 'border-hairline bg-surface-2'
                  }`}
                >
                  <ProviderLogo provider={provider} className="h-7 w-7 shrink-0 rounded-lg" />
                  <span className="min-w-0 flex-1 truncate text-sm">{provider.name}</span>
                  {subscribed ? (
                    <span className="shrink-0 text-[11px] font-semibold text-brand-soft">
                      You have this
                    </span>
                  ) : null}
                </div>
              ))}
            </div>
          </div>
        ))}

        {entry?.link ? (
          <a
            href={entry.link}
            target="_blank"
            rel="noreferrer noopener"
            className="inline-flex min-h-11 items-center justify-center rounded-xl bg-surface-2 px-4 text-sm font-medium text-brand-soft"
          >
            See prices and open
          </a>
        ) : null}

        <p className="text-[11px] leading-relaxed text-white/30">
          Availability in {regionName(settings.watch_region)}. Rental and purchase prices are not
          part of the data — the link above goes to TMDB, which lists them.
        </p>
        <JustWatchCredit />
      </div>
    </Sheet>
  )
}

/** Required attribution wherever this data is shown. */
export function JustWatchCredit() {
  return (
    <p className="text-[11px] text-white/30">
      Streaming availability data from{' '}
      <a
        href="https://www.justwatch.com/"
        target="_blank"
        rel="noreferrer noopener"
        className="text-brand-soft"
      >
        JustWatch
      </a>
      .
    </p>
  )
}
