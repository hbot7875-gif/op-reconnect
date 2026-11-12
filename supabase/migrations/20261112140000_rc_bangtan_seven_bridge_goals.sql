-- Bangtan Seven Bridge (mono-bangtan-seven-bridge): its goals, and a
-- two-stage ReConnect Quest.
--
-- Targets follow the ward's latest district (Angel 613 Bell Tower):
--   tracks  high 50 · medium 40 · low 30 plays
--   albums  high 5 · medium 3 · low 2 passes
-- Songs and albums that already exist in the ward are copied with the
-- aliases and track lists that have been matching in production; the seven
-- songs new to goals (Aliens, One More Night, Hooligan, Rainy Days, Lie,
-- Rain, Forever Rain) match their plain titles.
--
-- The quest (config.warOfCards, see lib/reconnect-war-stage.js):
--   stage 1  a team of 4 streams Danger 150 times between them;
--   stage 2  every teammate finishes one War of Cards game. Reaching 150
--            gives the team a temporary quest pass to play it — access only,
--            no covers are awarded and gifting is unchanged.
-- rc_reconnect_missions.cards_unlocked_at records when stage 2 opened; only
-- games that finish after it count.

alter table rc_reconnect_missions
  add column if not exists cards_unlocked_at timestamptz;

comment on column rc_reconnect_missions.cards_unlocked_at is
  'War of Cards quest stage (config.warOfCards): when the pooled target was reached and phase moved to ''cards''. Games finished after this count.';

insert into rc_goals (id, kind, label, artist, aliases, tracks, target, active, sort_order, district_id, variant, config)
values ($q$bridge-swim$q$, $q$track$q$, $q$Swim$q$, $q$BTS$q$, $q$["SWIM"]$q$::jsonb, null, 50, true, 601, $q$mono-bangtan-seven-bridge$q$, null, $q${}$q$::jsonb)
on conflict (id) do nothing;
insert into rc_goals (id, kind, label, artist, aliases, tracks, target, active, sort_order, district_id, variant, config)
values ($q$bridge-haegeum$q$, $q$track$q$, $q$Haegeum$q$, $q$Agust D$q$, $q$["해금","해금 Haegeum"]$q$::jsonb, null, 50, true, 602, $q$mono-bangtan-seven-bridge$q$, null, $q${}$q$::jsonb)
on conflict (id) do nothing;
insert into rc_goals (id, kind, label, artist, aliases, tracks, target, active, sort_order, district_id, variant, config)
values ($q$bridge-wild-flower$q$, $q$track$q$, $q$Wild Flower$q$, $q$RM$q$, $q$["Wild Flower (with youjeen)","Wild Flower (with Youjeen)","Wild Flower (feat. Youjeen)","야생화","야생화 Wild Flower"]$q$::jsonb, null, 50, true, 603, $q$mono-bangtan-seven-bridge$q$, null, $q${}$q$::jsonb)
on conflict (id) do nothing;
insert into rc_goals (id, kind, label, artist, aliases, tracks, target, active, sort_order, district_id, variant, config)
values ($q$bridge-killin-it-girl$q$, $q$track$q$, $q$Killin' It Girl$q$, $q$j-hope$q$, $q$["Killin' It Girl (feat. GloRilla)","Killin It Girl","Killing It Girl","Killin' It Girl - feat. GloRilla","Killin' It Girl (Solo Version)"]$q$::jsonb, null, 50, true, 604, $q$mono-bangtan-seven-bridge$q$, null, $q${}$q$::jsonb)
on conflict (id) do nothing;
insert into rc_goals (id, kind, label, artist, aliases, tracks, target, active, sort_order, district_id, variant, config)
values ($q$bridge-aliens$q$, $q$track$q$, $q$Aliens$q$, $q$BTS$q$, $q$[]$q$::jsonb, null, 50, true, 605, $q$mono-bangtan-seven-bridge$q$, null, $q${}$q$::jsonb)
on conflict (id) do nothing;
insert into rc_goals (id, kind, label, artist, aliases, tracks, target, active, sort_order, district_id, variant, config)
values ($q$bridge-running-wild$q$, $q$track$q$, $q$Running Wild$q$, $q$Jin$q$, $q$[]$q$::jsonb, null, 40, true, 606, $q$mono-bangtan-seven-bridge$q$, null, $q${}$q$::jsonb)
on conflict (id) do nothing;
insert into rc_goals (id, kind, label, artist, aliases, tracks, target, active, sort_order, district_id, variant, config)
values ($q$bridge-spring-day$q$, $q$track$q$, $q$Spring Day$q$, $q$BTS$q$, $q$["봄날"]$q$::jsonb, null, 40, true, 607, $q$mono-bangtan-seven-bridge$q$, null, $q${}$q$::jsonb)
on conflict (id) do nothing;
insert into rc_goals (id, kind, label, artist, aliases, tracks, target, active, sort_order, district_id, variant, config)
values ($q$bridge-one-more-night$q$, $q$track$q$, $q$One More Night$q$, $q$BTS$q$, $q$[]$q$::jsonb, null, 40, true, 608, $q$mono-bangtan-seven-bridge$q$, null, $q${}$q$::jsonb)
on conflict (id) do nothing;
insert into rc_goals (id, kind, label, artist, aliases, tracks, target, active, sort_order, district_id, variant, config)
values ($q$bridge-hooligan$q$, $q$track$q$, $q$Hooligan$q$, $q$BTS$q$, $q$[]$q$::jsonb, null, 40, true, 609, $q$mono-bangtan-seven-bridge$q$, null, $q${}$q$::jsonb)
on conflict (id) do nothing;
insert into rc_goals (id, kind, label, artist, aliases, tracks, target, active, sort_order, district_id, variant, config)
values ($q$bridge-rainy-days$q$, $q$track$q$, $q$Rainy Days$q$, $q$V$q$, $q$[]$q$::jsonb, null, 40, true, 610, $q$mono-bangtan-seven-bridge$q$, null, $q${}$q$::jsonb)
on conflict (id) do nothing;
insert into rc_goals (id, kind, label, artist, aliases, tracks, target, active, sort_order, district_id, variant, config)
values ($q$bridge-lie$q$, $q$track$q$, $q$Lie$q$, $q$Jimin$q$, $q$[]$q$::jsonb, null, 30, true, 611, $q$mono-bangtan-seven-bridge$q$, null, $q${}$q$::jsonb)
on conflict (id) do nothing;
insert into rc_goals (id, kind, label, artist, aliases, tracks, target, active, sort_order, district_id, variant, config)
values ($q$bridge-rain$q$, $q$track$q$, $q$Rain$q$, $q$BTS$q$, $q$[]$q$::jsonb, null, 30, true, 612, $q$mono-bangtan-seven-bridge$q$, null, $q${}$q$::jsonb)
on conflict (id) do nothing;
insert into rc_goals (id, kind, label, artist, aliases, tracks, target, active, sort_order, district_id, variant, config)
values ($q$bridge-forever-rain$q$, $q$track$q$, $q$Forever Rain$q$, $q$RM$q$, $q$[]$q$::jsonb, null, 30, true, 613, $q$mono-bangtan-seven-bridge$q$, null, $q${}$q$::jsonb)
on conflict (id) do nothing;
insert into rc_goals (id, kind, label, artist, aliases, tracks, target, active, sort_order, district_id, variant, config)
values ($q$bridge-album-arirang$q$, $q$album$q$, $q$ARIRANG$q$, $q$BTS$q$, $q$[]$q$::jsonb, $q$[{"aliases":[],"label":"Swim"},{"aliases":[],"label":"Body to Body"},{"aliases":[],"label":"Hooligan"},{"aliases":[],"label":"Aliens"},{"aliases":[],"label":"FYA"},{"aliases":[],"label":"Merry Go Round"},{"aliases":[],"label":"One More Night"},{"aliases":[],"label":"Please"},{"aliases":[],"label":"Into the Sun"},{"aliases":[],"label":"No. 29"},{"aliases":[],"label":"Normal"},{"aliases":[],"label":"they don't know 'bout us"},{"aliases":[],"label":"2.0"},{"aliases":[],"label":"Like Animals"}]$q$::jsonb, 5, true, 620, $q$mono-bangtan-seven-bridge$q$, null, $q${}$q$::jsonb)
on conflict (id) do nothing;
insert into rc_goals (id, kind, label, artist, aliases, tracks, target, active, sort_order, district_id, variant, config)
values ($q$bridge-album-keep-swimming$q$, $q$album$q$, $q$Keep Swimming$q$, $q$BTS$q$, $q$[]$q$::jsonb, $q$[{"aliases":["Swim"],"label":"SWIM"},{"aliases":["SWIM with RM"],"label":"SWIM with RM (Chill Hip Hop Remix)"},{"aliases":["SWIM with Jin"],"label":"SWIM with Jin (Alternative Rock Remix)"},{"aliases":["SWIM with SUGA"],"label":"SWIM with SUGA (Melodic Techno Remix)"},{"aliases":["SWIM with jhope","SWIM with J-Hope"],"label":"SWIM with j-hope (Afrobeat Remix)"},{"aliases":["SWIM with Jimin"],"label":"SWIM with Jimin (Slow Jam R&B Remix)"},{"aliases":["SWIM with V"],"label":"SWIM with V (Electronic Remix)"},{"aliases":["SWIM with Jungkook","SWIM with Jung Kook"],"label":"SWIM with Jung Kook (Acoustic Lofi Remix)"},{"aliases":["SWIM Instrumental"],"label":"SWIM (Instrumental)"}]$q$::jsonb, 5, true, 621, $q$mono-bangtan-seven-bridge$q$, null, $q${}$q$::jsonb)
on conflict (id) do nothing;
insert into rc_goals (id, kind, label, artist, aliases, tracks, target, active, sort_order, district_id, variant, config)
values ($q$bridge-album-happy$q$, $q$album$q$, $q$Happy$q$, $q$Jin$q$, $q$[]$q$::jsonb, $q$[{"aliases":[],"label":"Running Wild"},{"aliases":["I’ll Be There"],"label":"I'll Be There"},{"aliases":[],"label":"Another Level"},{"aliases":[],"label":"Falling"},{"aliases":["Heart on the Window"],"label":"Heart on the Window (with WENDY)"},{"aliases":["I Will Come To You"],"label":"I will come to you"}]$q$::jsonb, 3, true, 622, $q$mono-bangtan-seven-bridge$q$, null, $q${}$q$::jsonb)
on conflict (id) do nothing;
insert into rc_goals (id, kind, label, artist, aliases, tracks, target, active, sort_order, district_id, variant, config)
values ($q$bridge-album-dark-wild$q$, $q$album$q$, $q$Dark & Wild$q$, $q$BTS$q$, $q$[]$q$::jsonb, $q$[{"aliases":[],"label":"Intro: What Am I to You"},{"aliases":[],"label":"Danger"},{"aliases":[],"label":"War of Hormone"},{"aliases":[],"label":"Hip Hop Phile"},{"aliases":[],"label":"Let Me Know"},{"aliases":[],"label":"Rain"},{"aliases":["BTS Cypher, Pt. 3: KILLER (feat. Supreme Boi)"],"label":"BTS Cypher Pt.3: Killer"},{"aliases":[],"label":"Interlude: What Are You Doing Now"},{"aliases":[],"label":"Could You Turn off Your Cell Phone"},{"aliases":[],"label":"Embarrassed"},{"aliases":[],"label":"24/7=Heaven"},{"aliases":[],"label":"Look Here"},{"aliases":["2nd Grade","2학년"],"label":"So 4 more"},{"aliases":[],"label":"Outro: Do You Think It Makes Sense?"}]$q$::jsonb, 3, true, 623, $q$mono-bangtan-seven-bridge$q$, null, $q${}$q$::jsonb)
on conflict (id) do nothing;
insert into rc_goals (id, kind, label, artist, aliases, tracks, target, active, sort_order, district_id, variant, config)
values ($q$bridge-album-proof$q$, $q$album$q$, $q$Proof$q$, $q$BTS$q$, $q$[]$q$::jsonb, $q$[{"aliases":[],"label":"Born Singer"},{"aliases":[],"label":"No More Dream"},{"aliases":[],"label":"N.O"},{"aliases":[],"label":"Boy In Luv"},{"aliases":[],"label":"Danger"},{"aliases":[],"label":"I NEED U"},{"aliases":[],"label":"RUN"},{"aliases":[],"label":"Burning Up (FIRE)"},{"aliases":[],"label":"Blood Sweat & Tears"},{"aliases":[],"label":"Spring Day"},{"aliases":[],"label":"DNA"},{"aliases":[],"label":"FAKE LOVE"},{"aliases":[],"label":"IDOL"},{"aliases":[],"label":"Boy With Luv (Feat. Halsey)"},{"aliases":[],"label":"ON"},{"aliases":[],"label":"Dynamite"},{"aliases":[],"label":"Life Goes On"},{"aliases":[],"label":"Butter"},{"aliases":[],"label":"Yet To Come"},{"aliases":[],"label":"Run BTS"},{"aliases":[],"label":"Intro : Persona"},{"aliases":[],"label":"Stay"},{"aliases":[],"label":"Moon"},{"aliases":[],"label":"Jamais Vu"},{"aliases":[],"label":"Trivia 轉 : Seesaw"},{"aliases":[],"label":"BTS Cypher PT.3 : KILLER (Feat. Supreme Boi)"},{"aliases":[],"label":"Outro : Ego"},{"aliases":[],"label":"Her"},{"aliases":[],"label":"Filter"},{"aliases":[],"label":"Friends"}]$q$::jsonb, 2, true, 624, $q$mono-bangtan-seven-bridge$q$, null, $q${}$q$::jsonb)
on conflict (id) do nothing;
insert into rc_goals (id, kind, label, artist, aliases, tracks, target, active, sort_order, district_id, variant, config)
values ($q$bridge-album-right-place-wrong-person$q$, $q$album$q$, $q$Right Place, Wrong Person$q$, null, $q$[]$q$::jsonb, $q$[{"aliases":[],"label":"Right People, Wrong Place"},{"aliases":[],"label":"Nuts"},{"aliases":[],"label":"out of love"},{"aliases":[],"label":"Domodachi (feat. Little Simz)"},{"aliases":[],"label":"Groin"},{"aliases":[],"label":"Heaven"},{"aliases":[],"label":"LOST!"},{"aliases":[],"label":"Around the world in a day (feat. Moses Sumney)"},{"aliases":[],"label":"ㅠㅠ (Credit Roll)"},{"aliases":[],"label":"Come back to me"}]$q$::jsonb, 2, true, 625, $q$mono-bangtan-seven-bridge$q$, null, $q${}$q$::jsonb)
on conflict (id) do nothing;
insert into rc_goals (id, kind, label, artist, aliases, tracks, target, active, sort_order, district_id, variant, config)
values ($q$bridge-album-d-day$q$, $q$album$q$, $q$D-DAY$q$, $q$Agust D$q$, $q$[]$q$::jsonb, $q$[{"aliases":[],"label":"D-Day"},{"aliases":[],"label":"Haegeum"},{"aliases":["Huh?!"],"label":"Huh?! (feat. j-hope)"},{"aliases":[],"label":"Amygdala"},{"aliases":[],"label":"SDL"},{"aliases":["People Pt.2","People Part 2"],"label":"People Pt.2 (feat. IU)"},{"aliases":[],"label":"Polar Night"},{"aliases":["Interlude: Dawn","Interlude Dawn"],"label":"Interlude : Dawn"},{"aliases":["Snooze"],"label":"Snooze (feat. Ryuichi Sakamoto, woosung of The Rose)"},{"aliases":[],"label":"Life Goes On"}]$q$::jsonb, 2, true, 626, $q$mono-bangtan-seven-bridge$q$, null, $q${}$q$::jsonb)
on conflict (id) do nothing;
insert into rc_goals (id, kind, label, artist, aliases, tracks, target, active, sort_order, district_id, variant, config)
values ($q$bridge-reconnect-danger-150$q$, $q$reconnect$q$, $q$Danger + War of Cards$q$, $q$BTS$q$, $q$[]$q$::jsonb, null, 1, true, 630, $q$mono-bangtan-seven-bridge$q$, $q$connect$q$, $q${"requiredAgents":4,"sharedTrack":{"keys":["danger"],"label":"Danger","target":150},"warOfCards":{"gamesEach":1}}$q$::jsonb)
on conflict (id) do nothing;
