// PREVIEW DATA ONLY — ARIRANG RE:CELEBRATE Party page shell.
//
// Nothing here is read from or written to the database. Programme slots, chat
// messages and agent names are made up so the layout can be reviewed with
// realistic volumes. The Battle area already reads real server results; Watch
// and Chat will once their endpoints exist, and this whole file goes away then.

export const PREVIEW_PROGRAM = [
  {
    slot: 'now', title: 'SWIM', sub: 'OFFICIAL MV', youtubeId: 'b4iVv91Z6lY',
  },
  {
    slot: 'next', title: 'ARIRANG WATCH PARTY', sub: 'YOUTUBE PLAYLIST',
    url: 'https://www.youtube.com/watch?v=mmTWieXruAw&list=PL9m3vNjHZ2N_ONJgXWpt9mIcV4ppVa2tz',
  },
  { slot: 'later', title: 'GOYANG DAY 1', sub: '2H 25M' },
]

export const PREVIEW_CHAT = {
  here: 1284,
  messages: [
    { side: 'aliens', name: 'moonchild', no: 'AGENT212', at: '9:41', text: 'SWIM on the big screen omg 😭' },
    { side: 'hooligans', name: 'bangtanlight', no: 'AGENT087', at: '9:41', text: 'hooligans where u at ⚡⚡⚡' },
    { side: 'hooligans', name: 'purplesky', no: 'AGENT154', at: '9:42', text: 'streaming Haegeum rn, we need it back' },
    { side: 'aliens', name: 'mikrokosmos7', no: 'AGENT031', at: '9:42', text: 'aliens are taking Haegeum 🛸 sorry not sorry' },
    { side: 'hooligans', name: 'yetocome', no: 'AGENT118', at: '9:43', text: 'FYA is SO close pls stream FYA' },
    { side: 'aliens', name: 'seokjinnie', no: 'AGENT176', at: '9:43', text: 'the bridge in this MV 🫠' },
    { side: 'aliens', name: 'hobisunshine', no: 'AGENT099', at: '9:44', text: 'Merry Go Round by 7 streams LMAO keep going' },
    { side: 'hooligans', name: 'dimplesRM', no: 'AGENT063', at: '9:44', text: 'see u all at goyang later ♡' },
  ],
}
