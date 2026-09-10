export const ARMY_BOMB_SHARE_CALLOUT='get ur own virtual ARMY Bomb · keep urs glowing too ↗'

export function armyBombShareStatus(data={}) {
  return data.hoursRemaining?`${Math.round(data.hoursRemaining)}H CHARGED`:data.isDark?'NEEDS SOME LOVE':'WAITING FOR ITS SPARK'
}
