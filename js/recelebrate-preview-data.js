// PREVIEW DATA ONLY — ARIRANG RE:CELEBRATE Party Chat, local dev builds only.
//
// Nothing here is read from or written to the database. These chat lines and
// agent names are made up so the chat layout can be reviewed with realistic
// volume; recelebrate-chat.js only ever shows them when import.meta.env.DEV
// is true, so a production build never renders them. Battle reads real server
// results and Watch reads recelebrate-watch-program.js; this file goes away
// once realtime chat exists.

export const PREVIEW_CHAT = {
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
  // Dripped in one at a time to show the unread badge while minimised.
  later: [
    { side: 'aliens', name: 'jiminsmochi', no: 'AGENT141', at: '9:45', text: 'MIC DROP next?? im not ready' },
    { side: 'hooligans', name: 'taetaelight', no: 'AGENT201', at: '9:46', text: 'the bombs are going CRAZY rn 💜' },
    { side: 'aliens', name: 'kookiesnbts', no: 'AGENT077', at: '9:46', text: 'ok but that ment 😭😭' },
  ],
}
