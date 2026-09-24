// Which level-ups hand out a Backup Pass.
//
// The rule the site owner asked for, in one sentence: never two levels in a
// row, and never two levels in a row without one. If you didn't get a pass at
// the level below this one, this level gives you one; the level after that
// doesn't. So it lands every other level — often enough to be a reason to
// climb, rare enough that a pass still feels like something.
//
// Pure on purpose (no DB, no Deno): the alternation has to survive a
// multi-level jump in a single request, which is exactly the case that is
// tedious to reproduce against a live database and trivial to unit-test.
// See backup-pass-rewards.test.mjs, and leveling.ts for the caller.

export const DEFAULT_MIN_LEVEL = 2

/**
 * @param {object} opts
 * @param {number} opts.fromLevel      the level the agent was on (exclusive)
 * @param {number} opts.toLevel        the level they just reached (inclusive)
 * @param {number} [opts.lastPassLevel] the level that last granted a pass, 0 if never
 * @param {number} [opts.minLevel]     no passes below this level
 * @param {boolean} [opts.everyOther]  false grants at every level instead
 * @returns {{levels: number[], count: number, lastPassLevel: number}}
 */
export function backupPassLevelGrants(opts) {
  const fromLevel = Math.max(0, Number(opts?.fromLevel) || 0)
  const toLevel = Math.max(0, Number(opts?.toLevel) || 0)
  const minLevel = Number.isFinite(Number(opts?.minLevel)) ? Number(opts.minLevel) : DEFAULT_MIN_LEVEL
  const everyOther = opts?.everyOther !== false
  let last = Math.max(0, Number(opts?.lastPassLevel) || 0)

  const levels = []
  for (let n = fromLevel + 1; n <= toLevel; n++) {
    if (n < minLevel) continue
    // `>=` rather than `===`: a stored value that is somehow ahead of this
    // level should hold the grant back, never wave extra passes through.
    if (everyOther && last >= n - 1) continue
    levels.push(n)
    last = n
  }
  return { levels, count: levels.length, lastPassLevel: last }
}

/** Does the agent's NEXT level-up grant one? Used to preview it honestly in
 *  the Progress sheet — promising a pass at every level would be a lie two
 *  levels out of three. */
export function nextLevelGrantsBackupPass(level, lastPassLevel, opts = {}) {
  return backupPassLevelGrants({
    fromLevel: level, toLevel: Number(level) + 1, lastPassLevel, ...opts,
  }).count > 0
}
