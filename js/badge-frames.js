// Badge frames: an optional look a badge template can ask for
// (rc_badge_catalog.art_frame). Badge Maker draws the maker's cropped photo
// into the frame before upload, so the frame is part of the image and every
// place badges show (collection, reveal, Agent ID, HUD) needs no change.
//
// One frame so far: 'polaroid' — a pastel instant-film print. A lavender
// frame with rounded corners and a chunky bottom, a soft shadow and a
// playful 4° tilt, on a transparent square. No captions or decoration: the
// photo is the badge.

export const BADGE_FRAMES = Object.freeze(['polaroid'])

const POLAROID = Object.freeze({
  width: 0.742,       // card width, share of the square
  side: 0.053,        // side and top border, share of the card width
  bottom: 0.242,      // bottom border, share of the card width
  corner: 0.058,      // frame corner radius, share of the card width
  photoCorner: 0.032, // photo corner radius, share of the card width
  tilt: -4,           // degrees
  paper: '#cdb6ff',   // pastel lavender
})

/** Where everything goes for a `size` px square: the card (centred, before
 *  the tilt) and the square photo window inside it. Pure, for tests. */
export function polaroidLayout(size) {
  const w = size * POLAROID.width
  const side = w * POLAROID.side
  const photo = w - 2 * side
  const h = side + photo + w * POLAROID.bottom
  return { w, h, side, photo, x: (size - w) / 2, y: (size - h) / 2, tilt: POLAROID.tilt }
}

/** A rounded rectangle path (plain rectangle where roundRect is missing). */
function roundedPath(ctx, x, y, w, h, r) {
  ctx.beginPath()
  if (ctx.roundRect) ctx.roundRect(x, y, w, h, r)
  else ctx.rect(x, y, w, h)
}

/** Draw the frame for a `size` px square into `ctx`. `drawPhoto(ctx, x, y,
 *  side)` paints the photo into its window; it is clipped to the window. */
export function drawPolaroid(ctx, size, drawPhoto) {
  const L = polaroidLayout(size)
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
  ctx.fillStyle = POLAROID.paper
  ctx.fill()
  ctx.restore()

  ctx.save()
  roundedPath(ctx, px, py, L.photo, L.photo, L.w * POLAROID.photoCorner)
  ctx.clip()
  ctx.fillStyle = '#1b1825'
  ctx.fillRect(px, py, L.photo, L.photo)
  drawPhoto(ctx, px, py, L.photo)
  ctx.restore()
  ctx.restore()
}

/** The frame a template asks for, or null. */
export const frameOf = (template) => (BADGE_FRAMES.includes(template?.art_frame) ? template.art_frame : null)
