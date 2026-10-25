// War of Cards (RUN AMI) testers — who may play before owning all 15 album
// covers, managed from Settings by the owner (js/run-ami-testers.js).
//
// The live list is the rc_run_ami_testers table (migration
// 20261025190000); run-ami.ts gives this a store over it. The owner,
// AGENT000, is always a tester and is the only agent who can see or change
// the list, so the owner can never be locked out or removed.
//
// Store contract (async):
//   hasTester(agentNo)          → bool
//   listTesters()               → [{ agentNo, addedAt }]
//   addTester(agentNo, addedBy) → { ok: true } | { ok: false, error: 'tester_no_agent' }
//   removeTester(agentNo)       → void
//   names(agentNos)             → Map<agentNo, codename>

import { normalizeAgentNo } from './album-rules.js'

export const RUN_AMI_OWNER = 'AGENT000'

export const TESTER_ERRORS = Object.freeze({
  not_owner: 'Only AGENT000 can manage testers.',
  tester_bad_agent: 'Enter an agent number, like 050.',
  tester_no_agent: 'No active agent with that number.',
  tester_exists: 'That agent is already a tester.',
  tester_not_found: "That agent isn't a tester.",
  tester_owner: 'AGENT000 is always a tester.',
  server_error: 'Something went wrong. Try again.',
})

export function createTesterService({ store }) {
  const isOwner = (agentNo) => agentNo === RUN_AMI_OWNER

  async function isTester(agentNo) {
    if (isOwner(agentNo)) return true
    return !!agentNo && store.hasTester(agentNo)
  }

  /** The owner's view: everyone on the list, owner first, by codename. */
  async function list(agentNo) {
    if (!isOwner(agentNo)) return { success: false, error: 'not_owner' }
    const rows = (await store.listTesters()).filter((r) => r.agentNo !== RUN_AMI_OWNER)
    const nos = [RUN_AMI_OWNER, ...rows.map((r) => r.agentNo)]
    const names = await store.names(nos)
    return {
      success: true,
      testers: nos.map((no) => ({ agentNo: no, name: names.get(no) || 'AGENT', owner: isOwner(no) })),
    }
  }

  async function add(agentNo, target) {
    if (!isOwner(agentNo)) return { success: false, error: 'not_owner' }
    const no = normalizeAgentNo(target)
    if (!no) return { success: false, error: 'tester_bad_agent' }
    if (isOwner(no) || (await store.hasTester(no))) return { success: false, error: 'tester_exists' }
    const res = await store.addTester(no, agentNo)
    if (!res?.ok) return { success: false, error: res?.error || 'server_error' }
    return list(agentNo)
  }

  async function remove(agentNo, target) {
    if (!isOwner(agentNo)) return { success: false, error: 'not_owner' }
    const no = normalizeAgentNo(target)
    if (!no) return { success: false, error: 'tester_bad_agent' }
    if (isOwner(no)) return { success: false, error: 'tester_owner' }
    if (!(await store.hasTester(no))) return { success: false, error: 'tester_not_found' }
    await store.removeTester(no)
    return list(agentNo)
  }

  return { isTester, list, add, remove }
}
