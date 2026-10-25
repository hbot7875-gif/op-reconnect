// RUN AMI — the first closed-test list.
//
// No longer the live list: since migration 20261025190000 the testers are
// the rc_run_ami_testers table, which that migration seeded with these five
// and which AGENT000 manages from Settings (run-ami-testers.js). In
// production run-ami.ts asks the table (plus the Album). This constant stays
// as run-ami-service.js's default gate, which the tests and the local
// harness use without a database.

export const RUN_AMI_TESTERS = Object.freeze(['AGENT000', 'AGENT050', 'AGENT120', 'AGENT140', 'AGENT196'])

export function isRunAmiTester(agentNo) {
  return RUN_AMI_TESTERS.includes(String(agentNo ?? '').trim().toUpperCase())
}
