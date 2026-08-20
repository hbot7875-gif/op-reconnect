// Mock data for the Agent Pack redesign PREVIEW — field names/shapes match
// exactly what handlers.ts's buildState() actually returns (player.codename,
// player.level, player.rank, player.streak, items[], agentCharge.eraCards,
// activeDistrict.name), so the layout is proven against real data shapes
// without hitting the live backend. Swap this for a real getGameState()
// response and nothing else needs to change.

export const MOCK_STATE = {
  agentNo: 'AGENT042',
  player: {
    codename: 'Nightflare',
    mode: 'medium',
    level: { level: 12, name: 'Signal Runner' },
    rank: { index: 4, title: 'Field Operative', nextAt: 8200, nextTitle: 'Senior Operative' },
    xp: 6140,
    streak: { current: 7, freezeChargesRemaining: 1 },
    chargeCells: 3,
    wings: 12,
    streakFreezeCharges: 1,
    deadlineExtensionCharges: 2,
    // A real, already-live badge photo (badge-art storage bucket) rather
    // than a placeholder — shows what the ID actually looks like once an
    // agent has equipped a real badge, not a generic icon standing in.
    equippedBadgeArtwork: { artworkUrl: 'https://lcvmwlioqpyaprxicdfl.supabase.co/storage/v1/object/public/badge-art/set1/taehyung.jpg', name: 'Rare Badge' },
  },
  activeDistrict: {
    id: 'mono-dazzledew-fountain',
    name: 'Dazzledew Fountain',
    chargeCellProgress: { streams: 14, required: 20, remaining: 6 },
  },
  items: [
    { id: 'i1', itemId: 'backup-pass', kind: 'utility', name: 'Backup Pass', rarity: 'rare',
      era: 'VMA 2026', blurb: 'Open one of your goals to a helper.', districtId: null, districtName: null, usedAt: null, isNew: true },
    { id: 'i2', itemId: 'ticket-1', kind: 'ticket', name: 'Concert Ticket', rarity: 'legendary',
      era: 'Yet To Come', blurb: 'Redeemable for Launch the Voyage.', districtId: null, districtName: null, usedAt: null },
    { id: 'i3', itemId: 'mug-1', kind: 'mug', name: 'BT21 Mug', rarity: 'common',
      era: 'Home Base', blurb: 'A small comfort from the first district.', districtId: 'mono-dazzledew-fountain', districtName: 'Dazzledew Fountain', usedAt: null },
    { id: 'i4', itemId: 'photocard-1', kind: 'photocard', name: 'Photocard — Jimin', rarity: 'rare',
      era: 'ARIRANG', blurb: 'A rare pull from the ARIRANG era.', districtId: null, districtName: null, usedAt: null },
    { id: 'i5', itemId: 'lightstick-1', kind: 'lightstick', name: 'ARMY Bomb Ver.4', rarity: 'legendary',
      era: 'Permission to Dance', blurb: 'The real one, more or less.', districtId: null, districtName: null, usedAt: null },
    { id: 'i6', itemId: 'rug-1', kind: 'rug', name: 'Wave Rug', rarity: 'common',
      era: 'Indigo', blurb: 'Kept at Dazzledew Fountain.', districtId: 'mono-dazzledew-fountain', districtName: 'Dazzledew Fountain', usedAt: null },
  ],
  agentCharge: {
    eraCards: [
      { id: 'e1', name: 'Wings', icon: '🦋', status: 'lit', done: 15, total: 15 },
      { id: 'e2', name: 'Love Yourself', icon: '💫', status: 'used', done: 12, total: 12 },
      { id: 'e3', name: 'Map of the Soul', icon: '🗺️', status: 'progress', done: 8, total: 12 },
      { id: 'e4', name: 'BE', icon: '🌙', status: 'progress', done: 2, total: 8 },
    ],
    newlyLitEraIds: ['e1'],
  },
}
