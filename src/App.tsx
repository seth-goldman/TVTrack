import { useCallback, useEffect, useState } from 'react'
import type { Session } from '@supabase/supabase-js'
import { supabase } from './lib/supabase'
import { matchId, useRoute } from './lib/router'
import { ToastStack, useToasts } from './components/ui'
import BottomNav from './components/BottomNav'
import Login from './screens/Login'
import UpNext from './screens/UpNext'
import Upcoming from './screens/Upcoming'
import Library from './screens/Library'
import Search from './screens/Search'
import Settings from './screens/Settings'
import ShowDetail from './screens/ShowDetail'
import Import from './screens/Import'
import CatchUp from './screens/CatchUp'

export default function App() {
  const [session, setSession] = useState<Session | null>(null)
  const [ready, setReady] = useState(false)
  const { path, navigate, back } = useRoute()
  const { toasts, push, dismiss } = useToasts()

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session)
      setReady(true)
    })
    const { data: sub } = supabase.auth.onAuthStateChange((_event, next) => setSession(next))
    return () => sub.subscription.unsubscribe()
  }, [])

  const openShow = useCallback((showId: number) => navigate(`/show/${showId}`), [navigate])
  const toast = useCallback(
    (message: string, tone: 'ok' | 'error' = 'ok', undo?: () => void | Promise<void>) =>
      push(message, tone, undo),
    [push],
  )

  if (!ready) return <div className="min-h-full" />
  if (!session) return <Login />

  const showId = matchId(path, '/show/')

  return (
    <>
      {showId !== null ? (
        <ShowDetail showId={showId} onBack={back} toast={toast} />
      ) : path === '/import' ? (
        <Import onBack={() => navigate('/settings')} toast={toast} />
      ) : path === '/catch-up' ? (
        <CatchUp
          onBack={back}
          onFinish={() => navigate('/', { replace: true })}
          toast={toast}
        />
      ) : path === '/upcoming' ? (
        <Upcoming onOpenShow={openShow} />
      ) : path === '/library' ? (
        <Library
          onOpenShow={openShow}
          onSearch={() => navigate('/search')}
          onCatchUp={() => navigate('/catch-up')}
          toast={toast}
        />
      ) : path === '/search' ? (
        <Search onOpenShow={openShow} toast={toast} />
      ) : path === '/settings' ? (
        <Settings
          email={session.user.email ?? null}
          onImport={() => navigate('/import')}
          onCatchUp={() => navigate('/catch-up')}
          toast={toast}
        />
      ) : (
        <UpNext
          onOpenShow={openShow}
          onSearch={() => navigate('/search')}
          onCatchUp={() => navigate('/catch-up')}
          toast={toast}
        />
      )}

      {showId === null && path !== '/import' && path !== '/catch-up' ? (
        <BottomNav path={path} onNavigate={navigate} />
      ) : null}

      <ToastStack toasts={toasts} onDismiss={dismiss} />
    </>
  )
}
