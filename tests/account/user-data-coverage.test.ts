import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { NOT_EXPORTED, USER_DATA_TABLES } from '../../lib/account/user-data'

const MIGRATIONS = join(__dirname, '../../supabase/migrations')

/** Tables whose own column is a cascading reference to auth.users. */
function ownedTables(): Set<string> {
  const found = new Set<string>()
  for (const file of readdirSync(MIGRATIONS).filter((name) => name.endsWith('.sql'))) {
    const sql = readFileSync(join(MIGRATIONS, file), 'utf8')
    for (const match of sql.matchAll(/create table (?:if not exists )?(?:public\.)?(\w+)\s*\(([\s\S]*?)\n\);/gi)) {
      const [, name, body] = match
      const owned = body.split('\n').some((line) =>
        /references auth\.users\(id\) on delete cascade/i.test(line)
        && /(^\s*user_id\b|^\s*id uuid primary key)/i.test(line))
      if (owned) found.add(name)
    }
  }
  return found
}

describe('account data coverage', () => {
  it('lists every user-owned table for export, or says why not', () => {
    const covered = new Set([...USER_DATA_TABLES.map((entry) => entry.table), ...Object.keys(NOT_EXPORTED)])
    const missing = [...ownedTables()].filter((table) => !covered.has(table))
    expect(missing).toEqual([])
  })

  it('only lists tables that exist', () => {
    const owned = ownedTables()
    const unknown = USER_DATA_TABLES.map((entry) => entry.table).filter((table) => !owned.has(table))
    expect(unknown).toEqual([])
  })
})
