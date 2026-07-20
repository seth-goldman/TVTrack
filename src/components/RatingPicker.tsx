import { Star } from 'lucide-react'

// 1-10, matching the PRD's rating scale and TV Time's export values.
export default function RatingPicker({
  value,
  onChange,
}: {
  value: number | null
  onChange: (value: number | null) => void
}) {
  return (
    <div>
      <div className="flex items-center justify-between">
        <span className="text-xs tracking-wide text-white/40 uppercase">Your rating</span>
        {value !== null ? (
          <button className="text-xs text-white/40" onClick={() => onChange(null)}>
            Clear
          </button>
        ) : null}
      </div>
      <div className="mt-2 flex gap-1">
        {Array.from({ length: 10 }, (_, i) => i + 1).map((n) => {
          const filled = value !== null && n <= value
          return (
            <button
              key={n}
              onClick={() => onChange(value === n ? null : n)}
              aria-label={`Rate ${n} out of 10`}
              aria-pressed={filled}
              className="flex h-9 flex-1 items-center justify-center rounded-md"
            >
              <Star
                className={`h-4 w-4 ${filled ? 'fill-warn text-warn' : 'text-white/20'}`}
              />
            </button>
          )
        })}
      </div>
    </div>
  )
}
