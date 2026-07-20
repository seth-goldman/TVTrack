// Who has an account, and is anyone using it who shouldn't be?
//
// Public signup is currently enabled on the Supabase project, so this is the
// check that catches an unexpected registration. Run it with:
//
//   node --env-file=.env.local scripts/check-users.mjs
//
// Reads SUPABASE_SECRET_KEY, which bypasses RLS — hence server-side only, and
// never anything that prints a key value.
import { createClient } from '@supabase/supabase-js'

const url = process.env.SUPABASE_URL
const secret = process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY

if (!url || !secret) {
  console.error('Missing SUPABASE_URL or SUPABASE_SECRET_KEY. Run with --env-file=.env.local')
  process.exit(1)
}

const allowed = (process.env.ALLOWED_USER_EMAILS ?? '')
  .split(',')
  .map((e) => e.trim().toLowerCase())
  .filter(Boolean)

const supabase = createClient(url, secret, {
  auth: { persistSession: false, autoRefreshToken: false },
})

const { data, error } = await supabase.auth.admin.listUsers({ perPage: 200 })
if (error) {
  console.error('Could not list users:', error.message)
  process.exit(1)
}

const users = data.users ?? []
console.log(`${users.length} account${users.length === 1 ? '' : 's'} on this project\n`)

let unexpected = 0
for (const user of users) {
  const email = user.email ?? '(no email)'
  const known = allowed.length === 0 || allowed.includes(email.toLowerCase())
  if (!known) unexpected += 1

  console.log(
    [
      known ? '  ok  ' : ' NEW! ',
      email.padEnd(34),
      user.email_confirmed_at ? 'confirmed' : 'UNCONFIRMED',
      user.last_sign_in_at
        ? `last sign-in ${user.last_sign_in_at.slice(0, 16).replace('T', ' ')}`
        : 'never signed in',
    ].join(' '),
  )
}

if (allowed.length === 0) {
  console.log('\nALLOWED_USER_EMAILS is not set, so every signed-in account can use the API.')
} else if (unexpected > 0) {
  console.log(
    `\n${unexpected} account(s) are not on the allowlist. They cannot use the API, but they` +
      ' can sign in. Disable signup in the Supabase dashboard and delete them.',
  )
  process.exitCode = 1
} else {
  console.log('\nNo unexpected accounts.')
}
