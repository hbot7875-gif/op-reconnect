export const SHARE_URL = 'https://hopetrackers.org'
export const SHARE_URL_LABEL = 'hopetrackers.org'

function titleCase(value) {
  return String(value || '').toLowerCase().replace(/(^|[\s/&-])([a-z])/g, (_, gap, c) => gap + c.toUpperCase())
}

function personality(name) {
  const n = String(name || '').toLowerCase()
  if (/puple|sky|overlook|night|moon|rain|cloud/.test(n)) return 'night'
  if (/fountain|ocean|river|pier|water|wave|swim/.test(n)) return 'water'
  if (/crossing|station|bridge|gate|road|route/.test(n)) return 'journey'
  if (/sun|dawn|garden|park|flower|dazzle/.test(n)) return 'bright'
  if (/alley|cave|lab|vault|grid|strange/.test(n)) return 'strange'
  return 'city'
}

export function districtLyric(name, complete) {
  const n = String(name || '').toLowerCase()
  if (n.includes('puple sky overlook')) return 'Just wait, dawn ✦'
  if (n.includes('map of seven crossing')) return 'light it up like dynamite'
  if (n.includes('dazzledew fountain')) return complete ? 'the fountain found its light ✦' : 'a little more light, drop by drop'
  if (n.includes('hopesize station')) return complete ? 'hope arrived right on time ✦' : 'the next train is hope'
  const kind = personality(name)
  if (complete) return {
    night: 'morning finally found us ✦', water: 'the light reached the water ✦',
    journey: 'we made it all the way ✦', bright: 'look how it shines ✦',
    strange: 'somehow, we brought it back ✦', city: 'we lit it up ✦',
  }[kind]
  return {
    night: 'Just wait, dawn ✦', water: 'one stream at a time',
    journey: 'still on the way ✦', bright: 'a little light is coming back',
    strange: 'okay this place is still spooky 😭', city: 'the lights are still waking up ✦',
  }[kind]
}

export function districtCaption(name, percent) {
  const label = titleCase(name)
  const complete = percent >= 100
  const kind = personality(name)
  if (complete) {
    const reaction = {
      night: 'THE LIGHTS FINALLY WON 😭💜', water: 'THE WHOLE PLACE IS GLOWING 😭💜',
      journey: 'WE MADE IT ALL THE WAY 😭💜', bright: 'LOOK HOW BRIGHT IT IS 😭💜',
      strange: 'WE ACTUALLY BROUGHT IT BACK 😭💜', city: 'I FINALLY LIT IT UP 😭💜',
    }[kind]
    return `${reaction}\n${label} · 100% restored ✦\nReConnect → ${SHARE_URL}`
  }
  const reaction = {
    night: 'is still basically dark 😭', water: 'needs a lot more light 😭',
    journey: 'still has a long way to go 😭', bright: 'is only just starting to glow 🥹',
    strange: 'is still looking a little cursed 😭', city: 'is still mostly dark 😭',
  }[kind]
  return `my ${label} ${reaction}\ncome light yours up too 💜\nReConnect → ${SHARE_URL}`
}

export function compactNumber(value) {
  const n = Math.max(0, Number(value) || 0)
  if (n >= 1000000) return `${(n / 1000000).toFixed(n >= 10000000 ? 0 : 1).replace('.0', '')}m`
  if (n >= 1000) return `${(n / 1000).toFixed(n >= 10000 ? 0 : 1).replace('.0', '')}k`
  return n.toLocaleString()
}

export function compactTime(ms) {
  const totalMinutes = Math.max(0, Math.floor(Number(ms || 0) / 60000))
  const hours = Math.floor(totalMinutes / 60)
  const minutes = totalMinutes % 60
  if (hours && minutes) return `${hours}h ${minutes}m`
  if (hours) return `${hours}h`
  return `${minutes}m`
}

export function liveRedZoneCaption({ progress, target, targetLabel, msLeft }) {
  return `okay we're at ${compactNumber(progress)}/${compactNumber(target)} 😭\nKEEP GOING — stream ${targetLabel}\n${compactTime(msLeft)} left\nReConnect → ${SHARE_URL}`
}

export function successfulRedZoneCaption({ progress, target }) {
  return `WE ACTUALLY SAVED IT 😭😭\n${Number(progress || 0).toLocaleString()} / ${Number(target || 0).toLocaleString()} — Bomb defused\nReConnect → ${SHARE_URL}`
}

export function shareTextWithoutUrl(caption) {
  return String(caption || '').split('\n').filter((line) => !line.startsWith('ReConnect →')).join('\n')
}
