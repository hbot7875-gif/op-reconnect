-- Goals for Carabonara Diner (mono-carabonara-diner), previously unconfigured.
--
-- Track goals, 3 tiers (target/examTarget), same pattern as
-- mono-puple-sky-overlook in the same ward: top (50/40) Swim/Haegeum/Wild
-- Flower/Killin' It Girl, middle (40/30) Winter Ahead/The Astronaut/Come
-- Over/Normal, light (30/20) Let Me Know/Run BTS. Album goals reuse the
-- exact ARIRANG/Keep Swimming/Proof track lists already live on psov, plus
-- a new Right Place, Wrong Person (RM, 2024) entry.
--
-- Reconnect goal: 8 agents, each individually clears every track on RM's
-- "This Is RM" Spotify playlist (37i9dQZF1DXa3GFRsPDpwq) at least once —
-- the new 'checklist' config shape (reconnect-missions.ts), distinct from
-- the usual pooled sharedTrack. Snapshotted at authoring time rather than
-- read live since it's an algorithmic Spotify playlist that can reshuffle
-- its own tracklist — 48 of its 50 listed tracks (one literal duplicate
-- "Come back to me" and "? (Interlude)" dropped; the latter's title
-- normalizes to an empty key, which derive.ts's bucketRows() never stores
-- under any key at all — a real scrobble of it is silently discarded the
-- same way, so no key or alias could ever have made it countable). Same
-- "? (Interlude)" is dropped from the new Right Place, Wrong Person album
-- goal for the identical reason — one permanently-0 track would make an
-- album "pass" (every track needs `target` plays) impossible forever.
insert into rc_goals (id, kind, label, artist, aliases, target, sort_order, district_id, config)
values ('mcd-swim', 'track', $lbl$SWIM$lbl$, $art$BTS$art$, $ali$["Swim"]$ali$::jsonb, 50, 1, 'mono-carabonara-diner', $cfg${"examTarget":40}$cfg$::jsonb);

insert into rc_goals (id, kind, label, artist, aliases, target, sort_order, district_id, config)
values ('mcd-haegeum', 'track', $lbl$Haegeum$lbl$, $art$Agust D$art$, $ali$["해금","해금 Haegeum"]$ali$::jsonb, 50, 2, 'mono-carabonara-diner', $cfg${"examTarget":40}$cfg$::jsonb);

insert into rc_goals (id, kind, label, artist, aliases, target, sort_order, district_id, config)
values ('mcd-wild-flower', 'track', $lbl$Wild Flower$lbl$, $art$RM$art$, $ali$["Wild Flower (with youjeen)","Wild Flower (with Youjeen)","Wild Flower (feat. Youjeen)","야생화","야생화 Wild Flower"]$ali$::jsonb, 50, 3, 'mono-carabonara-diner', $cfg${"examTarget":40}$cfg$::jsonb);

insert into rc_goals (id, kind, label, artist, aliases, target, sort_order, district_id, config)
values ('mcd-kig', 'track', $lbl$Killin' It Girl$lbl$, $art$j-hope$art$, $ali$["Killin It Girl","Killing It Girl","Killin' It Girl (feat. GloRilla)","Killin' It Girl (Solo Version)"]$ali$::jsonb, 50, 4, 'mono-carabonara-diner', $cfg${"examTarget":40}$cfg$::jsonb);

insert into rc_goals (id, kind, label, artist, aliases, target, sort_order, district_id, config)
values ('mcd-winter-ahead', 'track', $lbl$Winter Ahead$lbl$, $art$V$art$, $ali$["Winter Ahead (with PARK HYO SHIN)","Winter Ahead (with Park Hyo Shin)","Winter Ahead (feat. Park Hyo Shin)"]$ali$::jsonb, 40, 5, 'mono-carabonara-diner', $cfg${"examTarget":30}$cfg$::jsonb);

insert into rc_goals (id, kind, label, artist, aliases, target, sort_order, district_id, config)
values ('mcd-astronaut', 'track', $lbl$The Astronaut$lbl$, $art$Jin$art$, $ali$[]$ali$::jsonb, 40, 6, 'mono-carabonara-diner', $cfg${"examTarget":30}$cfg$::jsonb);

insert into rc_goals (id, kind, label, artist, aliases, target, sort_order, district_id, config)
values ('mcd-come-over', 'track', $lbl$Come Over$lbl$, $art$BTS$art$, $ali$[]$ali$::jsonb, 40, 7, 'mono-carabonara-diner', $cfg${"examTarget":30}$cfg$::jsonb);

insert into rc_goals (id, kind, label, artist, aliases, target, sort_order, district_id, config)
values ('mcd-normal', 'track', $lbl$Normal$lbl$, $art$BTS$art$, $ali$[]$ali$::jsonb, 40, 8, 'mono-carabonara-diner', $cfg${"examTarget":30}$cfg$::jsonb);

insert into rc_goals (id, kind, label, artist, aliases, target, sort_order, district_id, config)
values ('mcd-let-me-know', 'track', $lbl$Let Me Know$lbl$, $art$BTS$art$, $ali$[]$ali$::jsonb, 30, 9, 'mono-carabonara-diner', $cfg${"examTarget":20}$cfg$::jsonb);

insert into rc_goals (id, kind, label, artist, aliases, target, sort_order, district_id, config)
values ('mcd-run-bts', 'track', $lbl$Run BTS$lbl$, $art$BTS$art$, $ali$[]$ali$::jsonb, 30, 10, 'mono-carabonara-diner', $cfg${"examTarget":20}$cfg$::jsonb);

insert into rc_goals (id, kind, label, target, tracks, sort_order, district_id)
values ('mcd-album-arirang', 'album', $lbl$ARIRANG$lbl$, 5, $trk$[{"aliases":["Swim"],"label":"SWIM"},{"aliases":[],"label":"Body to Body"},{"aliases":[],"label":"Hooligan"},{"aliases":[],"label":"Aliens"},{"aliases":[],"label":"FYA"},{"aliases":[],"label":"Merry Go Round"},{"aliases":[],"label":"One More Night"},{"aliases":[],"label":"Please"},{"aliases":[],"label":"Into the Sun"},{"aliases":["No 29"],"label":"No. 29"},{"aliases":["NORMAL"],"label":"Normal"},{"aliases":["They Don't Know 'Bout Us"],"label":"they don't know 'bout us"},{"aliases":[],"label":"2.0"},{"aliases":[],"label":"Like Animals"}]$trk$::jsonb, 11, 'mono-carabonara-diner');

insert into rc_goals (id, kind, label, target, tracks, sort_order, district_id)
values ('mcd-album-keep-swimming', 'album', $lbl$Keep Swimming$lbl$, 5, $trk$[{"aliases":["Swim"],"label":"SWIM"},{"aliases":["SWIM with RM"],"label":"SWIM with RM (Chill Hip Hop Remix)"},{"aliases":["SWIM with Jin"],"label":"SWIM with Jin (Alternative Rock Remix)"},{"aliases":["SWIM with SUGA"],"label":"SWIM with SUGA (Melodic Techno Remix)"},{"aliases":["SWIM with jhope","SWIM with J-Hope"],"label":"SWIM with j-hope (Afrobeat Remix)"},{"aliases":["SWIM with Jimin"],"label":"SWIM with Jimin (Slow Jam R&B Remix)"},{"aliases":["SWIM with V"],"label":"SWIM with V (Electronic Remix)"},{"aliases":["SWIM with Jungkook","SWIM with Jung Kook"],"label":"SWIM with Jung Kook (Acoustic Lofi Remix)"},{"aliases":["SWIM Instrumental"],"label":"SWIM (Instrumental)"}]$trk$::jsonb, 12, 'mono-carabonara-diner');

insert into rc_goals (id, kind, label, target, tracks, sort_order, district_id)
values ('mcd-album-right-place-wrong-person', 'album', $lbl$Right Place, Wrong Person$lbl$, 5, $trk$[{"label":"Right People, Wrong Place","aliases":[]},{"label":"Nuts","aliases":[]},{"label":"out of love","aliases":[]},{"label":"Domodachi (feat. Little Simz)","aliases":[]},{"label":"Groin","aliases":[]},{"label":"Heaven","aliases":[]},{"label":"LOST!","aliases":[]},{"label":"Around the world in a day (feat. Moses Sumney)","aliases":[]},{"label":"ㅠㅠ (Credit Roll)","aliases":[]},{"label":"Come back to me","aliases":[]}]$trk$::jsonb, 13, 'mono-carabonara-diner');

insert into rc_goals (id, kind, label, target, tracks, sort_order, district_id)
values ('mcd-album-proof', 'album', $lbl$Proof$lbl$, 2, $trk$[{"aliases":[],"label":"Born Singer"},{"aliases":[],"label":"No More Dream"},{"aliases":[],"label":"N.O"},{"aliases":[],"label":"Boy In Luv"},{"aliases":[],"label":"Danger"},{"aliases":[],"label":"I NEED U"},{"aliases":[],"label":"RUN"},{"aliases":[],"label":"Burning Up (FIRE)"},{"aliases":[],"label":"Blood Sweat & Tears"},{"aliases":[],"label":"Spring Day"},{"aliases":[],"label":"DNA"},{"aliases":[],"label":"FAKE LOVE"},{"aliases":[],"label":"IDOL"},{"aliases":[],"label":"Boy With Luv (Feat. Halsey)"},{"aliases":[],"label":"ON"},{"aliases":[],"label":"Dynamite"},{"aliases":[],"label":"Life Goes On"},{"aliases":[],"label":"Butter"},{"aliases":[],"label":"Yet To Come"},{"aliases":[],"label":"Run BTS"},{"aliases":[],"label":"Intro : Persona"},{"aliases":[],"label":"Stay"},{"aliases":[],"label":"Moon"},{"aliases":[],"label":"Jamais Vu"},{"aliases":[],"label":"Trivia 轉 : Seesaw"},{"aliases":[],"label":"BTS Cypher PT.3 : KILLER (Feat. Supreme Boi)"},{"aliases":[],"label":"Outro : Ego"},{"aliases":[],"label":"Her"},{"aliases":[],"label":"Filter"},{"aliases":[],"label":"Friends"}]$trk$::jsonb, 14, 'mono-carabonara-diner');

insert into rc_goals (id, kind, label, target, sort_order, district_id, variant, config)
values ('mcd-reconnect-rm-checklist', 'reconnect', $lbl$This Is RM: Full Playlist$lbl$, 1, 15, 'mono-carabonara-diner', 'connect', $cfg${"requiredAgents":8,"checklist":{"tracks":[{"label":"SWIM with RM (Chill Hip Hop Remix)","keys":["swim with rm"]},{"label":"Stop The Rain (TABLO X RM)","keys":["stop the rain"]},{"label":"Neva Play (feat. RM of BTS)","keys":["neva play"]},{"label":"LOST!","keys":["lost"]},{"label":"Right People, Wrong Place","keys":["right people wrong place"]},{"label":"Nuts","keys":["nuts"]},{"label":"out of love","keys":["out of love"]},{"label":"Domodachi (feat. Little Simz)","keys":["domodachi"]},{"label":"Groin","keys":["groin"]},{"label":"Heaven","keys":["heaven"]},{"label":"Around the world in a day (feat. Moses Sumney)","keys":["around the world in a day"]},{"label":"ㅠㅠ (Credit Roll)","keys":["ᅲᅲ"]},{"label":"Come back to me","keys":["come back to me"]},{"label":"Don't ever say love me (Feat. RM of BTS)","keys":["dont ever say love me"]},{"label":"Smoke Sprite (feat. RM of BTS)","keys":["smoke sprite"]},{"label":"Wild Flower (with youjeen)","keys":["wild flower"]},{"label":"Yun (with Erykah Badu)","keys":["yun"]},{"label":"Still Life (with Anderson .Paak)","keys":["still life"]},{"label":"All Day (with Tablo)","keys":["all day"]},{"label":"Forg_tful (with Kim Sawol)","keys":["forgtful"]},{"label":"Closer (with Paul Blanco, Mahalia)","keys":["closer"]},{"label":"Change pt.2","keys":["change pt2"]},{"label":"Lonely","keys":["lonely"]},{"label":"Hectic (with Colde)","keys":["hectic"]},{"label":"No.2 (with parkjiyoon)","keys":["no2"]},{"label":"SEXY NUKIM (feat. RM of BTS)","keys":["sexy nukim"]},{"label":"Bicycle","keys":["bicycle"]},{"label":"tokyo","keys":["tokyo"]},{"label":"seoul (prod. HONNE)","keys":["seoul"]},{"label":"moonchild","keys":["moonchild"]},{"label":"badbye","keys":["badbye"]},{"label":"uhgood","keys":["uhgood"]},{"label":"everythingoes","keys":["everythingoes"]},{"label":"forever rain","keys":["forever rain"]},{"label":"Old Town Road (feat. RM of BTS) - Seoul Town Road Remix","keys":["old town road feat rm of bts seoul town road remix"]},{"label":"Change","keys":["change"]},{"label":"Intro : Persona","keys":["intro persona"]},{"label":"Crying Over You ◐ (feat. RM & BEKA)","keys":["crying over you"]},{"label":"Strange (feat. RM)","keys":["strange"]},{"label":"Champion - Remix","keys":["champion remix"]},{"label":"WINTER FLOWER(Feat.RM)","keys":["winter flower"]},{"label":"Don't (feat. RM)","keys":["dont"]},{"label":"U (Feat. Kwon Jin Ah & Rap Monster)","keys":["u"]},{"label":"Timeless","keys":["timeless"]},{"label":"Gajah (Feat. RM)","keys":["gajah"]},{"label":"ProMeTheUs","keys":["prometheus"]},{"label":"Buckubucku (Feat. EE, RM Of BTS, Dino-J)","keys":["buckubucku"]},{"label":"A Song Make to You Smile","keys":["a song make to you smile"]}]}}$cfg$::jsonb);
