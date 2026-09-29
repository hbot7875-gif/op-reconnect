// The decisions behind the ReConnect selector sheet — grouping, filtering,
// labelling and keyboard movement — kept apart from the DOM that draws them.
//
// Same reason every other *-rules.js / *-ui.js module in this repo exists:
// rc-select.js has to touch document, showOverlay and a live <select>, and
// none of that is what is worth pinning in a test. What IS worth pinning is
// that ACHIEVEMENT still comes before DISTRICT before EVENT, that a search
// keeps its groups, and that a badge's rarity is read from structured data
// rather than from " (rare)" glued onto its name.

/** Below this many options a search field is clutter, not help. The district
 *  selector has ~10 entries and reads fine as one scroll; the badge catalog
 *  grows every time a migration adds a template, which is why this is a
 *  threshold and not a per-call decision someone has to remember to revisit. */
export const SEARCH_THRESHOLD = 12

/** Sections come from rc_badge_catalog.section, which is a CHECK constraint
 *  over exactly these four values (migration 20260819090000). Ordering them
 *  here keeps the sheet stable no matter what order the rows arrive in, and
 *  anything unrecognised simply keeps its first-seen position after them
 *  rather than being dropped. */
export const SECTION_ORDER = ['achievement', 'district', 'ward', 'event']

/** Section headings are display-only uppercase. The catalog stores them
 *  lowercase and the old <optgroup> printed them raw, which is exactly the
 *  "achievement / district / event" the sheet is replacing. */
export function sectionLabel(section) {
  return String(section || '').trim().toUpperCase()
}

/** " (rare)" was appended to the option text because an <option> cannot hold
 *  a chip. It can hold a data attribute, so the name goes back to being the
 *  name and rarity becomes its own tag. Stripping is conditional on the
 *  structured field: a badge genuinely called "(rare)" something keeps it. */
export function displayName(option) {
  const name = String(option?.name ?? '')
  if (option?.rarity !== 'rare') return name
  return name.replace(/\s*[·(]\s*rare\s*\)?$/i, '').trim() || name
}

/** Small uppercase tags on the right of a row, before the selected mark.
 *  Only structured state earns one — nothing here is inferred from a name. */
export function optionTags(option) {
  const tags = []
  if (option?.rarity === 'rare') tags.push('RARE')
  // The district you are actually restoring, as opposed to the one you are
  // previewing goals for. The old menu said "· current" inside the name;
  // that is the same fact, no longer pretending to be part of the title.
  if (option?.current) tags.push('CURRENT')
  return tags
}

/** Group in SECTION_ORDER, then by first appearance for anything else.
 *  Options with no section at all collapse into one unlabelled group, which
 *  is what the district selector wants — headings over a single flat list
 *  would be noise. */
export function groupOptions(options) {
  const list = Array.isArray(options) ? options : []
  if (!list.some((o) => o && o.section)) {
    return list.length ? [{ key: '', label: null, items: list }] : []
  }
  const groups = new Map()
  for (const option of list) {
    const key = String(option?.section || '')
    if (!groups.has(key)) groups.set(key, { key, label: sectionLabel(key) || null, items: [] })
    groups.get(key).items.push(option)
  }
  const rank = (key) => {
    const i = SECTION_ORDER.indexOf(key)
    return i === -1 ? SECTION_ORDER.length : i
  }
  return [...groups.values()]
    .map((group, i) => ({ group, i }))
    .sort((a, b) => rank(a.group.key) - rank(b.group.key) || a.i - b.i)
    .map(({ group }) => group)
}

/** Client-side, case-insensitive, over the visible name only. Deliberately
 *  not over the id: matching "event_vma_voter" would let a query hit rows
 *  whose printed text does not contain it, which reads as a broken filter. */
export function filterOptions(options, query) {
  const q = String(query ?? '').trim().toLowerCase()
  const list = Array.isArray(options) ? options : []
  if (!q) return list
  return list.filter((option) => displayName(option).toLowerCase().includes(q))
}

/** Auto means "only once the list is long enough to be annoying". An
 *  explicit true/false from a caller always wins. */
export function shouldSearch(mode, count) {
  if (mode === true || mode === false) return mode
  return (count || 0) >= SEARCH_THRESHOLD
}

/** Arrow-key movement over the flat, post-filter row order. Wraps, because
 *  a list that silently stops at its ends feels broken on a keyboard, and
 *  returns -1 for an empty list so callers have nothing to focus. */
export function nextIndex(current, delta, length) {
  if (!length) return -1
  if (current < 0 || current >= length) return delta > 0 ? 0 : length - 1
  return (current + delta + length) % length
}

/** The option a value points at, or null. Used to label the closed trigger
 *  and to decide which row opens focused. */
export function selectedOption(options, value) {
  const list = Array.isArray(options) ? options : []
  return list.find((option) => option && option.id === value) || null
}
