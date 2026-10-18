// RUN AMI — who may play during the closed production test.
//
// Enforced in run-ami-service.js, which every RUN AMI route goes through:
// anyone else gets `not_invited` from state, create, join, leave, start and
// act alike, before anything is read or written. The Settings entry
// (js/screen-settings.js) imports this same list, but only to decide what
// to show; hiding it there is not the protection.
//
// Widening the test is an edit here plus a deploy of the Edge Function.

export const RUN_AMI_TESTERS = Object.freeze(['AGENT000', 'AGENT050', 'AGENT120', 'AGENT140'])

export function isRunAmiTester(agentNo) {
  return RUN_AMI_TESTERS.includes(String(agentNo ?? '').trim().toUpperCase())
}
