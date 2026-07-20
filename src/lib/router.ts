import { useCallback, useEffect, useState } from 'react'

// A ~40-line router. The app has six screens and no nested layouts; pulling in
// react-router would be more configuration than routing.

export function useRoute(): {
  path: string
  navigate: (to: string, opts?: { replace?: boolean }) => void
  back: () => void
} {
  const [path, setPath] = useState(() => window.location.pathname)

  useEffect(() => {
    const onPop = () => setPath(window.location.pathname)
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
  }, [])

  const navigate = useCallback((to: string, opts?: { replace?: boolean }) => {
    if (to === window.location.pathname) return
    if (opts?.replace) window.history.replaceState(null, '', to)
    else window.history.pushState(null, '', to)
    setPath(to)
    window.scrollTo(0, 0)
  }, [])

  const back = useCallback(() => {
    // history.back() is a no-op on a cold deep-link, so fall back to home.
    if (window.history.length > 1) window.history.back()
    else navigate('/', { replace: true })
  }, [navigate])

  return { path, navigate, back }
}

/** `/show/1399` -> 1399; null when the path does not match. */
export function matchId(path: string, prefix: string): number | null {
  if (!path.startsWith(prefix)) return null
  const id = Number(path.slice(prefix.length).split('/')[0])
  return Number.isFinite(id) ? id : null
}
