// Host-side bootstrap: creates a user directly, bypassing the network entirely.
// Run via `npm run create-user -- --email x --name y` (dev) or
// `docker compose exec api node dist/cli/create-user.js --email x --name y` (prod).
// The password is never accepted as an argument — it would otherwise land in shell
// history and `docker compose exec` process listings.
import bcrypt from 'bcrypt'
import { db } from '../db/client.js'

const BCRYPT_ROUNDS = 12

function parseArgs(argv: string[]): { email: string; name: string } {
  let email: string | undefined
  let name: string | undefined
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--email') email = argv[++i]
    else if (argv[i] === '--name') name = argv[++i]
  }
  if (!email || !name) {
    console.error('Usage: create-user --email <email> --name <name>')
    process.exit(1)
  }
  return { email, name }
}

/**
 * Reads a line from stdin without echoing it (a TTY is put in raw mode so
 * keystrokes never appear on screen or in scrollback). Leftover bytes past
 * the newline are kept in `buffer` so a second call — the password
 * confirmation — picks up where the first left off instead of losing input
 * that arrived in the same chunk.
 */
function createPasswordPrompter() {
  const stdin = process.stdin
  const isTTY = Boolean(stdin.isTTY)
  const wasRaw = isTTY ? stdin.isRaw : false
  if (isTTY) stdin.setRawMode(true)
  stdin.resume()
  stdin.setEncoding('utf8')

  let buffer = ''
  let ended = false

  function nextChunk(): Promise<string> {
    return new Promise((resolve) => {
      const onData = (chunk: string) => {
        cleanup()
        resolve(chunk)
      }
      const onEnd = () => {
        cleanup()
        ended = true
        resolve('')
      }
      function cleanup() {
        stdin.removeListener('data', onData)
        stdin.removeListener('end', onEnd)
      }
      stdin.once('data', onData)
      stdin.once('end', onEnd)
    })
  }

  async function prompt(query: string): Promise<string> {
    process.stdout.write(query)
    let input = ''
    for (;;) {
      let lineEnded = false
      for (let i = 0; i < buffer.length; i++) {
        const ch = buffer[i]!
        if (ch === '\n' || ch === '\r') {
          buffer = buffer.slice(i + 1)
          lineEnded = true
          break
        }
        if (ch === '') {
          // Ctrl-C
          process.stdout.write('\n')
          process.exit(130)
        }
        if (ch === '') {
          input = input.slice(0, -1) // backspace
        } else {
          input += ch
        }
      }
      if (lineEnded) break
      buffer = ''
      if (ended) break
      buffer = await nextChunk()
    }
    process.stdout.write('\n')
    return input
  }

  function close() {
    if (isTTY) stdin.setRawMode(wasRaw)
    stdin.pause()
  }

  return { prompt, close }
}

async function main() {
  const { email, name } = parseArgs(process.argv.slice(2))

  const existing = await db.query('SELECT id FROM users WHERE email = $1', [email])
  if (existing.rows.length > 0) {
    console.error(`A user with email ${email} already exists.`)
    process.exitCode = 1
    return
  }

  const { prompt, close } = createPasswordPrompter()
  try {
    const password = await prompt('Password: ')
    if (password.length < 8) {
      console.error('Password must be at least 8 characters.')
      process.exitCode = 1
      return
    }
    const confirm = await prompt('Confirm password: ')
    if (password !== confirm) {
      console.error('Passwords do not match.')
      process.exitCode = 1
      return
    }

    const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS)
    const result = await db.query<{ id: string }>(
      'INSERT INTO users (email, password_hash, name) VALUES ($1, $2, $3) RETURNING id',
      [email, passwordHash, name]
    )

    console.log(`Created user ${email} (id ${result.rows[0]!.id}).`)
  } finally {
    close()
  }
}

main()
  .catch((err) => {
    console.error(err)
    process.exitCode = 1
  })
  .finally(() => db.end())
