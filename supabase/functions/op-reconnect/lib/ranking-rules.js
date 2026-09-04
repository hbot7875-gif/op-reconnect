/** Keep historical XP/contributions in storage while removing retired
 * identities from every public ranking surface. The caller reassigns rank
 * numbers after this filter, so the visible board never contains gaps. */
export function activeRankingRows(rows, activeAgentNos) {
  const active = activeAgentNos instanceof Set
    ? activeAgentNos
    : new Set((activeAgentNos || []).map((value) => String(value)))
  return (rows || []).filter((row) => active.has(String(row.agent_no)))
}
