// Badge frames: an optional look a badge template can ask for
// (rc_badge_catalog.art_frame). Badge Maker draws the maker's cropped photo
// into the frame before upload, so the frame is part of the image and every
// place badges show (collection, reveal, Agent ID, HUD) needs no change.
//
// 'polaroid' — a pastel instant-film print. A lavender frame with rounded
// corners and a chunky bottom, a soft shadow and a playful 4° tilt, on a
// transparent square. No captions: the photo is the badge.
// 'polaroid_pro' — the same print for War of Cards — Champion Pro, a little
// fancier: warm gold paper, tilted the other way, and a small star on the
// bottom border.

export const BADGE_FRAMES = Object.freeze(['polaroid', 'polaroid_pro'])

const POLAROID = Object.freeze({
  width: 0.742,       // card width, share of the square
  side: 0.053,        // side and top border, share of the card width
  bottom: 0.242,      // bottom border, share of the card width
  corner: 0.058,      // frame corner radius, share of the card width
  photoCorner: 0.032, // photo corner radius, share of the card width
  tilt: -4,           // degrees
  paper: '#cdb6ff',   // pastel lavender
})

const LOOKS = Object.freeze({
  polaroid: { tilt: POLAROID.tilt, paper: [POLAROID.paper, POLAROID.paper], star: null },
  polaroid_pro: { tilt: 4, paper: ['#ffe39a', '#f7b267'], star: '#fffaf0' }, // gold, a cream star
})

/** Where everything goes for a `size` px square: the card (centred, before
 *  the tilt) and the square photo window inside it. Pure, for tests. */
export function polaroidLayout(size, frame = 'polaroid') {
  const w = size * POLAROID.width
  const side = w * POLAROID.side
  const photo = w - 2 * side
  const h = side + photo + w * POLAROID.bottom
  return { w, h, side, photo, x: (size - w) / 2, y: (size - h) / 2, tilt: (LOOKS[frame] || LOOKS.polaroid).tilt }
}

/** A rounded rectangle path (plain rectangle where roundRect is missing). */
function roundedPath(ctx, x, y, w, h, r) {
  ctx.beginPath()
  if (ctx.roundRect) ctx.roundRect(x, y, w, h, r)
  else ctx.rect(x, y, w, h)
}

/** A five-point star centred on (cx, cy). */
function starPath(ctx, cx, cy, r) {
  ctx.beginPath()
  for (let i = 0; i < 10; i++) {
    const a = -Math.PI / 2 + (i * Math.PI) / 5
    const d = i % 2 ? r * 0.45 : r
    ctx.lineTo(cx + d * Math.cos(a), cy + d * Math.sin(a))
  }
  ctx.closePath()
}

/** Draw the frame for a `size` px square into `ctx`. `drawPhoto(ctx, x, y,
 *  side)` paints the photo into its window; it is clipped to the window.
 *  `frame` is 'polaroid' (default) or 'polaroid_pro'. */
export function drawPolaroid(ctx, size, drawPhoto, frame = 'polaroid') {
  const look = LOOKS[frame] || LOOKS.polaroid
  const L = polaroidLayout(size, frame)
  const px = L.x + L.side
  const py = L.y + L.side
  ctx.save()
  ctx.translate(size / 2, size / 2)
  ctx.rotate((L.tilt * Math.PI) / 180)
  ctx.translate(-size / 2, -size / 2)

  ctx.save()
  ctx.shadowColor = 'rgba(0, 0, 0, .35)'
  ctx.shadowBlur = size * 0.035
  ctx.shadowOffsetY = size * 0.016
  roundedPath(ctx, L.x, L.y, L.w, L.h, L.w * POLAROID.corner)
  const paper = ctx.createLinearGradient ? ctx.createLinearGradient(L.x, L.y, L.x + L.w, L.y + L.h) : null
  if (paper) { paper.addColorStop(0, look.paper[0]); paper.addColorStop(1, look.paper[1]) }
  ctx.fillStyle = paper || look.paper[0]
  ctx.fill()
  ctx.restore()

  if (look.star) {
    const bottomTop = py + L.photo
    const r = (L.h - (bottomTop - L.y)) * 0.26
    starPath(ctx, L.x + L.w - L.side - r * 1.2, bottomTop + (L.y + L.h - bottomTop) / 2, r)
    ctx.fillStyle = look.star
    ctx.fill()
  }

  ctx.save()
  roundedPath(ctx, px, py, L.photo, L.photo, L.w * POLAROID.photoCorner)
  ctx.clip()
  ctx.fillStyle = '#1b1825'
  ctx.fillRect(px, py, L.photo, L.photo)
  drawPhoto(ctx, px, py, L.photo)
  ctx.restore()
  ctx.restore()
}

/** True for badge art with a frame baked in (a Polaroid): it is shown
 *  as-is everywhere — never cropped to a circle, never given a second frame.
 *  `artFrame` comes from the server (rc_badge_catalog.art_frame). */
export const isFramedArt = (artFrame) => BADGE_FRAMES.includes(artFrame)

/** Run ARMY game badges get their own Badge Collection section. */
export const RUN_ARMY_BADGES = Object.freeze(['achievement_card_champion', 'achievement_card_champion_pro'])

/** The frame a template asks for, or null. */
export const frameOf = (template) => (BADGE_FRAMES.includes(template?.art_frame) ? template.art_frame : null)
