-- Replace the placeholder watermark word list with real fandom-flavored
-- words, per request. Same mechanism as before (lib/vma-voting.ts's
-- dailyWatermarkWord picks one deterministically per ET day) — only the
-- word pool changes.
update rc_config set value = jsonb_set(
  value, '{watermark_words}',
  '["JOON","JINNIE","YOONGI","HOBA","JIMINA","TAETAE","KOOKIE","TANG","BEETEESSS","AMI","LEAVES","ARIRANG","AOTY","SEVEN","HT","LAMRON"]'::jsonb
)
where key = 'vma_2026';
