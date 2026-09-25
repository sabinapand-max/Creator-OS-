/**
 * Package the Creator OS private pilot into a distributable zip.
 *
 * Copies the app to a staging folder under the name it should extract to, then
 * archives it. Deliberately excludes anything regenerable, anything holding
 * pilot users' data, and anything holding local configuration:
 *
 *   node_modules/   -> npm install
 *   .next/          -> build artefacts
 *   data/           -> the SQLite store (pilot users' brain dumps)
 *   *.sqlite*       -> including the -wal / -shm sidecars
 *   .env.local/.env -> local config; .env.example ships instead
 *   .git/           -> history belongs to the repo, not the snapshot
 *
 * Usage:
 *   node scripts/package.mjs [outputZipPath] [folderNameInsideZip]
 *
 * Defaults:
 *   outputZipPath  ../creator-os-private-pilot.zip
 *   folderName     creator-os-private-pilot
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'

const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const outZip = path.resolve(process.argv[2] ?? path.join(appRoot, '..', 'creator-os-private-pilot.zip'))
const folderName = process.argv[3] ?? 'creator-os-private-pilot'

const EXCLUDE_DIRS = new Set(['node_modules', '.next', '.git', 'data', '.turbo', 'dist'])
const EXCLUDE_FILES = new Set(['.env.local', '.env', '.env.development.local', '.env.production.local'])
const EXCLUDE_EXT = ['.sqlite', '.sqlite-wal', '.sqlite-shm', '.sqlite3']

function shouldSkip(name, fullPath) {
  if (EXCLUDE_DIRS.has(name)) return true
  if (EXCLUDE_FILES.has(name)) return true
  if (EXCLUDE_EXT.some((ext) => name.endsWith(ext))) return true
  // Never package an archive of itself.
  if (fullPath === outZip) return true
  return false
}

let copied = 0
let skipped = 0

function copyTree(src, dest) {
  fs.mkdirSync(dest, { recursive: true })
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const from = path.join(src, entry.name)
    const to = path.join(dest, entry.name)
    if (shouldSkip(entry.name, from)) {
      skipped += 1
      continue
    }
    if (entry.isDirectory()) {
      copyTree(from, to)
    } else if (entry.isSymbolicLink()) {
      // Symlinks in a Windows snapshot are more trouble than they are worth.
      skipped += 1
    } else {
      fs.copyFileSync(from, to)
      copied += 1
    }
  }
}

const staging = fs.mkdtempSync(path.join(os.tmpdir(), 'cop-pkg-'))
const stagedRoot = path.join(staging, folderName)

console.log(`app root:  ${appRoot}`)
console.log(`staging:   ${stagedRoot}`)
copyTree(appRoot, stagedRoot)
console.log(`copied ${copied} files, skipped ${skipped} entries`)

if (copied === 0) {
  console.error('nothing was copied — refusing to write an empty archive')
  fs.rmSync(staging, { recursive: true, force: true })
  process.exit(1)
}

// Sanity: the things that must be in a usable snapshot.
const REQUIRED = [
  'HANDOFF.md',
  '.env.example',
  '.gitignore',
  'package.json',
  'next.config.mjs',
  'tsconfig.json',
  'lib/pilot/core/conversation.ts',
  'lib/pilot/db/schema.ts',
  'lib/pilot/db/repo.ts',
  'lib/pilot/model/index.ts',
  'app/api/pilot/turn/route.ts',
  'tests/brain-dump-slice.test.ts',
  'scripts/smoke-web.mjs',
  'components/screens/brain-dump-workspace.tsx',
]
const missing = REQUIRED.filter((r) => !fs.existsSync(path.join(stagedRoot, r)))
if (missing.length) {
  console.error('\nrefusing to package, these are missing from staging:')
  console.error(missing.map((m) => `  ${m}`).join('\n'))
  fs.rmSync(staging, { recursive: true, force: true })
  process.exit(1)
}

fs.mkdirSync(path.dirname(outZip), { recursive: true })
if (fs.existsSync(outZip)) fs.rmSync(outZip)

execFileSync('tar', ['-a', '-c', '-f', outZip, folderName], { cwd: staging, stdio: 'inherit' })

// Verify the archive we just wrote.
const listing = execFileSync('tar', ['-tf', outZip], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
const entries = listing.split(/\r?\n/).filter(Boolean)
const forbidden = [
  [/node_modules/, 'node_modules'],
  [/(^|\/)\.next(\/|$)/, '.next'],
  [/(^|\/)data(\/|$)/, 'data/'],
  [/\.sqlite/, 'sqlite file'],
  [/\.env\.local$/, '.env.local'],
  [/(^|\/)\.env$/, '.env'],
]
let leaks = 0
for (const [re, label] of forbidden) {
  const hits = entries.filter((e) => re.test(e))
  if (hits.length) {
    leaks += hits.length
    console.log(`LEAK: ${label} (${hits.length}) e.g. ${hits[0]}`)
  }
}

const size = fs.statSync(outZip).size
console.log(`\nzip:     ${outZip}`)
console.log(`size:    ${(size / 1024 / 1024).toFixed(2)} MB`)
console.log(`entries: ${entries.length}`)
console.log(`leaks:   ${leaks}`)

fs.rmSync(staging, { recursive: true, force: true })

if (leaks > 0) {
  console.error('\nPACKAGE REJECTED — sensitive or regenerable content was included')
  fs.rmSync(outZip, { force: true })
  process.exit(1)
}
console.log('\nPACKAGE OK')
