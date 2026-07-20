// Create a household account and produce a sign-in link WITHOUT sending email.
//
// Supabase's built-in email service allows only a couple of messages an hour,
// which is easy to exhaust while setting up a magic-link-only app. The admin
// API can mint the same link directly, so an account can be handed over in
// person without touching the mail path at all.
//
//   node --env-file=.env.local scripts/invite-user.mjs someone@example.com
//
// The link is written to a file rather than printed: it is a credential, and
// anything on a terminal ends up in scrollback, screenshots and transcripts.
import { createClient } from '@supabase/supabase-js'
import { writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const email = process.argv[2]
if (!email || !email.includes('@')) {
  console.error('Usage: node --env-file=.env.local scripts/invite-user.mjs <email>')
  process.exit(1)
}

const url = process.env.SUPABASE_URL
const secret = process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY
const siteUrl = process.env.SITE_URL ?? 'https://show-track-two.vercel.app'

if (!url || !secret) {
  console.error('Missing SUPABASE_URL / SUPABASE_SECRET_KEY. Run with --env-file=.env.local')
  process.exit(1)
}

const allowed = (process.env.ALLOWED_USER_EMAILS ?? '')
  .split(',')
  .map((e) => e.trim().toLowerCase())
  .filter(Boolean)

if (allowed.length > 0 && !allowed.includes(email.toLowerCase())) {
  console.error(
    `\n${email} is not in ALLOWED_USER_EMAILS.\n` +
      'They would sign in successfully and then get 403 from every API call.\n' +
      'Add the address to .env.local, push it to Vercel, redeploy, then re-run this.',
  )
  process.exit(1)
}

const supabase = createClient(url, secret, {
  auth: { persistSession: false, autoRefreshToken: false },
})

// Pre-confirm the address. The point of this script is to avoid the mail path,
// so leaving them to confirm by email would defeat it.
const { data: created, error: createError } = await supabase.auth.admin.createUser({
  email,
  email_confirm: true,
})

if (createError && !/already/i.test(createError.message)) {
  console.error('Could not create the account:', createError.message)
  process.exit(1)
}
console.log(created?.user ? `Created ${email} (pre-confirmed).` : `${email} already existed.`)

const { data: link, error: linkError } = await supabase.auth.admin.generateLink({
  type: 'magiclink',
  email,
  options: { redirectTo: siteUrl },
})

if (linkError) {
  console.error('Could not generate a sign-in link:', linkError.message)
  process.exit(1)
}

const actionLink = link?.properties?.action_link
if (!actionLink) {
  console.error('Supabase returned no action_link.')
  process.exit(1)
}

const outPath = join(tmpdir(), `showtrack-signin-${email.replace(/[^a-z0-9]/gi, '-')}.txt`)
writeFileSync(
  outPath,
  [
    `Sign-in link for ${email}`,
    `Generated ${new Date().toISOString()}`,
    '',
    'Single use. Open it on the device that will use the app, then delete this file.',
    '',
    actionLink,
    '',
  ].join('\n'),
)

console.log(`\nSign-in link written to:\n  ${outPath}`)
console.log('\nOpen that file, send the link to them however you like, then delete it.')
console.log('The link is single-use and signs them in directly — no email involved.')
