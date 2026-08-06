// The badge catalog — every badge the Badge Drawer can show, earned or not.
//
// Three of these (streak:7/30/100) are server-issued: rc_badges rows,
// awarded by awardStreakBadges() in the edge function and surfaced as
// state.player.badges. Everything else here is computed live from fields
// already in `state` (level, lifetime xp, districts restored) rather than
// stored server-side — there's nothing to desync, since a level or an xp
// total can't un-happen the way a stored flag could go stale.

export function districtsRestored(state) {
  return (state.map?.wards || []).reduce((a, w) => a + (w.restoredCount || 0), 0)
}

const serverBadge = (id) => (state) => (state.player?.badges || []).includes(id)

export const BADGE_CATALOG = [
  { id: 'streak:7', icon: '🔥', name: '7-Day Streak', desc: 'On the network 7 days straight.', earned: serverBadge('streak:7') },
  { id: 'streak:30', icon: '🔥', name: '30-Day Streak', desc: 'A full month without missing a day.', earned: serverBadge('streak:30') },
  { id: 'streak:100', icon: '🔥', name: '100-Day Streak', desc: 'Triple digits. The network barely remembers you ever left.', earned: serverBadge('streak:100') },
  { id: 'level:5', icon: '⭐', name: 'Rising Agent', desc: 'Reached level 5.', earned: (s) => (s.player?.level?.level || 0) >= 5 },
  { id: 'level:10', icon: '🌟', name: 'Veteran Agent', desc: 'Reached level 10.', earned: (s) => (s.player?.level?.level || 0) >= 10 },
  { id: 'level:20', icon: '💫', name: 'Elite Agent', desc: 'Reached level 20.', earned: (s) => (s.player?.level?.level || 0) >= 20 },
  { id: 'districts:1', icon: '🏙️', name: 'First Light', desc: 'Restored your first district.', earned: (s) => districtsRestored(s) >= 1 },
  { id: 'districts:10', icon: '🌆', name: 'Ward Builder', desc: 'Restored 10 districts.', earned: (s) => districtsRestored(s) >= 10 },
  { id: 'districts:50', icon: '🏗️', name: 'City Architect', desc: 'Restored 50 districts.', earned: (s) => districtsRestored(s) >= 50 },
  { id: 'xp:1000', icon: '💎', name: 'Signal Booster', desc: 'Earned 1,000 lifetime XP.', earned: (s) => (s.player?.xp || 0) >= 1000 },
  { id: 'xp:10000', icon: '👑', name: 'Network Legend', desc: 'Earned 10,000 lifetime XP.', earned: (s) => (s.player?.xp || 0) >= 10000 },
]
