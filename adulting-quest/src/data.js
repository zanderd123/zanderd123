'use strict';
// All game content: types, skills, issues, leaders, items, paths, towns.
// Balance lives here so it can be tuned without touching the engine.

// ---------------------------------------------------------------- types
// Skills (what you fight with) have SKILL types; issues (what you fight)
// have ISSUE types. EFF says how hard each skill type hits each issue type.
const SKILL_TYPES = {
  BASIC:  { label: 'BASIC',  color: '#9a948c' },
  SOCIAL: { label: 'SOCIAL', color: '#e0559a' },
  GRIT:   { label: 'GRIT',   color: '#e8772e' },
  BRAINS: { label: 'BRAINS', color: '#3f86e0' },
  CHILL:  { label: 'CHILL',  color: '#2fae63' },
  SHADY:  { label: 'SHADY',  color: '#8a5cd6' },
};
const ISSUE_TYPES = {
  PEOPLE:    { label: 'PEOPLE',    color: '#d9468a' },
  PAPERWORK: { label: 'PAPERWORK', color: '#5f7fa8' },
  MONEY:     { label: 'MONEY',     color: '#2f9e57' },
  CHORE:     { label: 'CHORE',     color: '#b07a3a' },
  STRESS:    { label: 'STRESS',    color: '#c0413a' },
};
const EFF = {
  BASIC:  { PEOPLE: 1,   PAPERWORK: 1,   MONEY: 1,   CHORE: 1,   STRESS: 1 },
  SOCIAL: { PEOPLE: 2,   PAPERWORK: 0.5, MONEY: 1,   CHORE: 0.5, STRESS: 1 },
  GRIT:   { PEOPLE: 0.5, PAPERWORK: 0.5, MONEY: 1,   CHORE: 2,   STRESS: 1 },
  BRAINS: { PEOPLE: 1,   PAPERWORK: 2,   MONEY: 2,   CHORE: 0.5, STRESS: 0.5 },
  CHILL:  { PEOPLE: 1,   PAPERWORK: 0.5, MONEY: 0.5, CHORE: 1,   STRESS: 2 },
  SHADY:  { PEOPLE: 2,   PAPERWORK: 2,   MONEY: 1,   CHORE: 0.5, STRESS: 0.5 },
};

// ---------------------------------------------------------------- skills
// fx keys: heal (fraction of max Sanity), energy, selfAtk/selfDef (stages),
// foeAtk/foeDef (stages), anxious (chance), recoil (fraction of damage),
// cure, flee, cash (reward multiplier), karma.
const SKILLS = {
  wing_it:      { name: 'Wing It', type: 'BASIC', power: 40, cost: 0, acc: 95, desc: 'No plan. No energy. Pure vibes.' },
  small_talk:   { name: 'Small Talk', type: 'SOCIAL', power: 40, cost: 2, acc: 100, desc: '"Crazy weather lately, huh?"' },
  charm:        { name: 'Charm', type: 'SOCIAL', power: 0, cost: 3, acc: 100, fx: { foeAtk: -2 }, desc: 'A winning smile. Sharply lowers the issue\'s Pressure.' },
  haggle:       { name: 'Haggle', type: 'SOCIAL', power: 50, cost: 3, acc: 95, fx: { cash: 1.5 }, desc: '"What\'s your best price?" Win with it to earn 50% more cash.' },
  networking:   { name: 'Networking', type: 'SOCIAL', power: 75, cost: 6, acc: 95, desc: 'Knows a guy who knows a guy.' },
  elbow_grease: { name: 'Elbow Grease', type: 'GRIT', power: 45, cost: 2, acc: 100, desc: 'Just scrub harder.' },
  fix_it:       { name: 'Fix It', type: 'GRIT', power: 60, cost: 4, acc: 95, desc: 'Watched one YouTube tutorial. Very confident.' },
  hustle:       { name: 'Hustle', type: 'GRIT', power: 75, cost: 6, acc: 95, desc: 'Rise and grind.' },
  jumpstart:    { name: 'Jumpstart', type: 'GRIT', power: 80, cost: 6, acc: 100, fx: { selfAtk: 1 }, desc: 'Clamp red to red. Hits hard and raises Confidence.' },
  all_nighter:  { name: 'All-Nighter', type: 'GRIT', power: 110, cost: 9, acc: 90, fx: { recoil: 0.25 }, desc: 'Massive damage. Costs you some Sanity.' },
  googling:     { name: 'Googling It', type: 'BRAINS', power: 45, cost: 2, acc: 100, desc: 'The top result was an ad, but still.' },
  read_manual:  { name: 'Read the Manual', type: 'BRAINS', power: 0, cost: 3, acc: 100, fx: { selfAtk: 2 }, desc: 'Nobody does this. It works. Sharply raises Confidence.' },
  spreadsheet:  { name: 'Spreadsheet', type: 'BRAINS', power: 75, cost: 6, acc: 95, desc: 'Color-coded. Conditional formatting. Lethal.' },
  write_off:    { name: 'Write-Off', type: 'BRAINS', power: 85, cost: 7, acc: 100, fx: { heal: 0.15 }, desc: 'Deduct the damage. Also recovers a little Sanity.' },
  deep_breaths: { name: 'Deep Breaths', type: 'CHILL', power: 0, cost: 4, acc: 100, fx: { heal: 0.4 }, desc: 'In for four, out for four. Restores Sanity.' },
  touch_grass:  { name: 'Touch Grass', type: 'CHILL', power: 50, cost: 3, acc: 100, fx: { cure: true }, desc: 'Go outside. Hits, and cures your status.' },
  power_nap:    { name: 'Power Nap', type: 'CHILL', power: 0, cost: 0, acc: 100, fx: { energy: 8, heal: 0.1 }, desc: 'Zzz. Restores Energy and a little Sanity.' },
  boundaries:   { name: 'Boundaries', type: 'CHILL', power: 0, cost: 3, acc: 100, fx: { selfDef: 2 }, desc: '"No" is a complete sentence. Sharply raises Composure.' },
  meal_prep:    { name: 'Meal Prep', type: 'CHILL', power: 0, cost: 5, acc: 100, fx: { heal: 0.3, selfDef: 1 }, desc: 'Sunday chicken & rice. Heals and raises Composure.' },
  therapy_talk: { name: 'Unpack It', type: 'CHILL', power: 80, cost: 7, acc: 95, desc: '"And how does that make you feel?"' },
  gaslight:     { name: 'Gaslight', type: 'SHADY', power: 60, cost: 3, acc: 90, fx: { anxious: 0.4, karma: -4 }, desc: '"That issue? It never happened." May confuse it. Costs Karma.' },
  passive_aggro:{ name: 'Per My Last Email', type: 'SHADY', power: 50, cost: 2, acc: 100, fx: { foeDef: -1, karma: -2 }, desc: 'Lowers the issue\'s Resistance. Costs Karma.' },
  hype_up:      { name: 'Hype Up', type: 'SOCIAL', power: 0, cost: 3, acc: 100, fx: { selfAtk: 2 }, desc: '"You got this!" Sharply raises Confidence.' },
  guilt_trip:   { name: 'Guilt Trip', type: 'SHADY', power: 65, cost: 3, acc: 95, fx: { anxious: 0.3 }, desc: '"After everything I\'ve done for you?" Moms don\'t lose Karma.' },
  packed_lunch: { name: 'Packed Lunch', type: 'CHILL', power: 0, cost: 4, acc: 100, fx: { heal: 0.45 }, desc: 'With a note in it. Restores a lot of Sanity.' },
  ghosting:     { name: 'Ghosting', type: 'SHADY', power: 0, cost: 2, acc: 100, fx: { flee: true, karma: -3 }, desc: 'Just stop responding. Escapes any wild issue. Costs Karma.' },
};

// ---------------------------------------------------------------- issue moves
// fx keys: atkDown/defDown (your stages), anxious/burnout (chance),
// drain (Energy), selfAtk/selfDef, heal (fraction of its own max).
const FOE_MOVES = {
  late_fee:     { name: 'Late Fee', power: 40 },
  fine_print:   { name: 'Fine Print', power: 0, fx: { atkDown: 1 } },
  notif_storm:  { name: '47 Notifications', power: 35, fx: { drain: 2 } },
  thumbs_up:    { name: 'Thumbs-Up Reply', power: 0, fx: { anxious: 0.6 } },
  pile_up:      { name: 'Pile Up', power: 0, fx: { selfDef: 1 } },
  crusty_pan:   { name: 'Crusty Pan', power: 45 },
  auto_renew:   { name: 'Auto-Renew', power: 40 },
  trial_ends:   { name: 'Free Trial Ends', power: 30, fx: { defDown: 1 } },
  slept_wrong:  { name: 'Slept Wrong', power: 40 },
  pinch:        { name: 'Pinched Nerve', power: 30, fx: { defDown: 1 } },
  warranty:     { name: 'Car Warranty Pitch', power: 45 },
  ring_ring:    { name: 'Ring Ring Ring', power: 0, fx: { anxious: 0.6 } },
  lost_sock:    { name: 'Lost Sock', power: 0, fx: { anxious: 0.5 } },
  smother:      { name: 'Smother', power: 55 },
  fee_35:       { name: '$35 Fee', power: 55 },
  insufficient: { name: 'Insufficient Funds', power: 25, fx: { drain: 4 } },
  peel:         { name: 'Peel', power: 50 },
  spf_regret:   { name: 'SPF Regret', power: 20, fx: { burnout: 0.5 } },
  pc_load:      { name: 'PC LOAD LETTER', power: 0, fx: { anxious: 0.6 } },
  paper_cut:    { name: 'Paper Cut', power: 50 },
  summons:      { name: 'Summons', power: 60 },
  sequester:    { name: 'Sequester', power: 30, fx: { defDown: 1 } },
  rsvp:         { name: 'RSVP By Friday', power: 55 },
  registry:     { name: 'The Registry', power: 35, fx: { drain: 4 } },
  missing_screw:{ name: 'Missing Screw', power: 0, fx: { anxious: 0.6 } },
  allen_key:    { name: 'Allen Key', power: 65 },
  three_am:     { name: '3 AM Thoughts', power: 0, fx: { anxious: 0.6 } },
  doomscroll:   { name: 'Doomscroll', power: 55, fx: { drain: 3 } },
  unsub_me:     { name: '"Unsubscribe Me"', power: 60 },
  pile_on:      { name: 'Pile On', power: 0, fx: { selfAtk: 1 } },
  rent_hike:    { name: 'Rent Hike', power: 75 },
  ignores_fix:  { name: 'Ignores Repair', power: 35, fx: { burnout: 0.4 } },
  buffering:    { name: 'Buffering...', power: 25, fx: { drain: 5 } },
  disconnect:   { name: 'Disconnect', power: 70 },
  growth_areas: { name: 'Areas for Growth', power: 0, fx: { atkDown: 1 } },
  synergy:      { name: 'Synergy', power: 70 },
  seen_it:      { name: 'You Saw It', power: 0, fx: { anxious: 0.6 } },
  best_life:    { name: 'Living Their Best Life', power: 70 },
  root_canal:   { name: 'Root Canal', power: 80 },
  not_covered:  { name: 'Not Covered', power: 40, fx: { defDown: 1 } },
  achoo:        { name: 'ACHOO', power: 65 },
  itchy_eyes:   { name: 'Itchy Eyes', power: 0, fx: { anxious: 0.6 } },
  nobody_replies:{ name: 'Nobody Replies', power: 70 },
  you_do_it:    { name: 'You Do It All', power: 30, fx: { burnout: 0.5 } },
  lawn_violation:{ name: 'Lawn Violation', power: 75 },
  who_am_i:     { name: 'Who Am I Kidding', power: 0, fx: { atkDown: 1 } },
  fraud:        { name: '"Fraud!"', power: 75 },
  // leader issues
  mystery_light:{ name: 'Mystery Light', power: 0, fx: { anxious: 0.7 } },
  weird_noise:  { name: 'Weird Noise', power: 50 },
  flat:         { name: 'Go Flat', power: 55 },
  no_spare:     { name: 'No Spare', power: 25, fx: { defDown: 1 } },
  grind:        { name: 'Grinding Gears', power: 70 },
  quote:        { name: '$3,800 Quote', power: 45, fx: { drain: 5 } },
  annual_fee:   { name: 'Annual Fee', power: 55 },
  cant_cancel:  { name: 'Can\'t Cancel', power: 0, fx: { defDown: 1 } },
  squat:        { name: 'Squat Rack', power: 65 },
  doms:         { name: 'DOMS', power: 30, fx: { burnout: 0.5 } },
  brain_freeze: { name: 'Brain Freeze', power: 55 },
  kale_aftertaste:{ name: 'Kale Aftertaste', power: 0, fx: { atkDown: 1 } },
  comparison:   { name: 'Comparison', power: 0, fx: { anxious: 0.6 } },
  flex:         { name: 'Flex', power: 75, fx: {} },
  w2_wait:      { name: 'Still Not Here', power: 0, fx: { anxious: 0.6 } },
  box_12b:      { name: 'Box 12b', power: 65 },
  receipt_avalanche:{ name: 'Receipt Avalanche', power: 70 },
  faded_ink:    { name: 'Faded Ink', power: 0, fx: { atkDown: 1 } },
  you_owe:      { name: 'You Owe', power: 75 },
  penalty:      { name: 'Penalty & Interest', power: 40, fx: { drain: 5 } },
  scrutiny:     { name: 'Scrutiny', power: 30, fx: { defDown: 1 } },
  line_by_line: { name: 'Line by Line', power: 85 },
  endless_swipe:{ name: 'Endless Swipe', power: 35, fx: { drain: 5 } },
  unmatched:    { name: 'Unmatched', power: 75 },
  split_check:  { name: 'Split the Check', power: 75 },
  fancy_menu:   { name: 'No Prices on the Menu', power: 30, fx: { drain: 5 } },
  what_are_we:  { name: '"What Are We?"', power: 0, fx: { anxious: 0.7 } },
  mixed_signals:{ name: 'Mixed Signals', power: 78 },
  awkward_dinner:{ name: 'Awkward Dinner', power: 80 },
  judgy_look:   { name: 'Judgy Look', power: 0, fx: { atkDown: 1 } },
  they_texted:  { name: '"hey stranger :)"', power: 0, fx: { anxious: 0.7 } },
  closure:      { name: 'No Closure', power: 92 },
};

// ---------------------------------------------------------------- issues
// base: [sanity-ish HP, pressure (atk), resistance (def), speed]
const ISSUES = {
  parking_ticket: { name: 'Parking Ticket', type: 'PAPERWORK', base: [36, 38, 34, 40], xp: 52, cash: 3, shape: 'paper', col: '#f6d44a', moves: ['late_fee', 'fine_print'], dex: 'Appears under your wiper the one time you were "only two minutes."' },
  group_chat:     { name: 'Group Chat Drama', type: 'PEOPLE', base: [38, 36, 34, 45], xp: 52, cash: 2, shape: 'bubble', col: '#5ac46a', moves: ['notif_storm', 'thumbs_up'], dex: 'Started over who forgot to Venmo for brunch.' },
  dirty_dishes:   { name: 'Dirty Dishes', type: 'CHORE', base: [42, 36, 40, 25], xp: 52, cash: 2, shape: 'stack', col: '#d8e4ea', moves: ['crusty_pan', 'pile_up'], dex: 'It was "soaking." For eleven days.' },
  forgot_sub:     { name: 'Forgotten Subscription', type: 'MONEY', base: [36, 38, 34, 42], xp: 54, cash: 4, shape: 'card', col: '#8b5fd0', moves: ['auto_renew', 'trial_ends'], dex: 'You are paying $14.99 a month for a meditation app you opened once.' },
  back_pain:      { name: 'Back Pain', type: 'STRESS', base: [40, 38, 36, 30], xp: 52, cash: 2, shape: 'blob', col: '#e07a5a', moves: ['slept_wrong', 'pinch'], dex: 'Arrived on your 25th birthday. Did not leave.' },
  spam_call:      { name: 'Spam Call', type: 'PEOPLE', base: [50, 55, 40, 65], xp: 60, cash: 3, shape: 'phone', col: '#3b4252', moves: ['warranty', 'ring_ring'], dex: 'Would like to talk to you about your car\'s extended warranty.' },
  laundry:        { name: 'Laundry Mountain', type: 'CHORE', base: [65, 50, 55, 25], xp: 60, cash: 3, shape: 'pile', col: '#6aa0e0', moves: ['smother', 'lost_sock'], dex: 'Lives on "the chair." Everyone has the chair.' },
  overdraft:      { name: 'Overdraft Fee', type: 'MONEY', base: [55, 60, 45, 45], xp: 62, cash: 5, shape: 'envelope', col: '#e05a4a', moves: ['fee_35', 'insufficient'], dex: 'Charges you $35 for not having $35.' },
  sunburn:        { name: 'Sunburn', type: 'STRESS', base: [55, 55, 45, 50], xp: 60, cash: 3, shape: 'blob', col: '#ff6b5a', moves: ['peel', 'spf_regret'], dex: '"I don\'t need sunscreen, I tan." — You, three hours ago.' },
  printer_jam:    { name: 'Printer Jam', type: 'PAPERWORK', base: [60, 50, 60, 30], xp: 60, cash: 3, shape: 'box', col: '#c9ccd1', moves: ['paper_cut', 'pc_load'], dex: 'Only jams when the document is due in five minutes.' },
  jury_duty:      { name: 'Jury Duty', type: 'PAPERWORK', base: [65, 60, 55, 40], xp: 70, cash: 4, shape: 'paper', col: '#4a6fa5', moves: ['summons', 'sequester'], dex: 'Your civic duty. Scheduled for the exact week of your vacation.' },
  wedding_invite: { name: 'Wedding Invite #6', type: 'MONEY', base: [60, 60, 50, 50], xp: 70, cash: 5, shape: 'envelope', col: '#f4ead2', moves: ['rsvp', 'registry'], dex: 'Destination wedding. Three-night minimum. Plus-one not included.' },
  ikea:           { name: 'Flat-Pack Furniture', type: 'CHORE', base: [70, 60, 60, 30], xp: 70, cash: 4, shape: 'box', col: '#d8b57a', moves: ['allen_key', 'missing_screw'], dex: 'Step 14 shows a wordless man looking sad. Relatable.' },
  insomnia:       { name: 'Insomnia', type: 'STRESS', base: [60, 60, 50, 60], xp: 70, cash: 3, shape: 'cloud', col: '#4b4a7a', moves: ['doomscroll', 'three_am'], dex: 'Remembers something embarrassing you said in 2014.' },
  reply_all:      { name: 'Reply-All Chain', type: 'PEOPLE', base: [60, 65, 45, 55], xp: 70, cash: 4, shape: 'envelope', col: '#9ec5f0', moves: ['unsub_me', 'pile_on'], dex: '400 people. All replying "please remove me from this list."' },
  landlord:       { name: 'Landlord', type: 'MONEY', base: [75, 70, 60, 45], xp: 80, cash: 6, shape: 'house', col: '#b0705a', moves: ['rent_hike', 'ignores_fix'], dex: 'Fixes nothing. Raises rent annually. Calls it "the market."' },
  wifi:           { name: 'Wi-Fi Outage', type: 'STRESS', base: [65, 65, 55, 65], xp: 78, cash: 4, shape: 'router', col: '#2d3a4a', moves: ['disconnect', 'buffering'], dex: 'Have you tried turning it off and on again? It has.' },
  perf_review:    { name: 'Performance Review', type: 'PAPERWORK', base: [70, 65, 65, 45], xp: 80, cash: 5, shape: 'clipboard', col: '#8a6a4a', moves: ['synergy', 'growth_areas'], dex: '"Meets expectations." Whose expectations? Nobody knows.' },
  ex_post:        { name: 'Ex\'s New Post', type: 'PEOPLE', base: [65, 70, 50, 65], xp: 80, cash: 4, shape: 'phone', col: '#e57aa8', moves: ['best_life', 'seen_it'], dex: 'They took up pottery. They seem... happy. Ugh.' },
  dentist:        { name: 'Dentist Bill', type: 'MONEY', base: [70, 75, 55, 40], xp: 82, cash: 6, shape: 'tooth', col: '#f4f4f0', moves: ['root_canal', 'not_covered'], dex: 'You flossed twice before the appointment. They could tell.' },
  allergies:      { name: 'Allergy Season', type: 'STRESS', base: [65, 70, 55, 60], xp: 80, cash: 4, shape: 'cloud', col: '#e8d24a', moves: ['achoo', 'itchy_eyes'], dex: 'The trees are, scientifically speaking, attacking you.' },
  group_project:  { name: 'Group Project', type: 'PEOPLE', base: [75, 70, 60, 40], xp: 82, cash: 5, shape: 'calendar', col: '#e86a4a', moves: ['nobody_replies', 'you_do_it'], dex: 'Four names on the cover. One person did the work. It was you.' },
  hoa:            { name: 'HOA Letter', type: 'PAPERWORK', base: [70, 75, 60, 45], xp: 84, cash: 6, shape: 'envelope', col: '#7a9a6a', moves: ['lawn_violation', 'growth_areas'], dex: 'Your grass is 0.4 inches too tall. Please advise.' },
  imposter:       { name: 'Imposter Syndrome', type: 'STRESS', base: [75, 75, 60, 55], xp: 86, cash: 5, shape: 'ghost', col: '#9a7ad0', moves: ['fraud', 'who_am_i'], dex: 'Insists everyone will find out. Find out what? It won\'t say.' },

  // ---- leader issues
  check_engine:   { name: 'Check Engine Light', type: 'STRESS', base: [60, 55, 55, 55], xp: 70, cash: 0, shape: 'light', col: '#f2a62a', moves: ['weird_noise', 'mystery_light'], dex: 'Could be a loose gas cap. Could be the end of everything.' },
  flat_tire:      { name: 'Flat Tire', type: 'CHORE', base: [70, 60, 60, 35], xp: 72, cash: 0, shape: 'tire', col: '#3a3a3a', moves: ['flat', 'no_spare'], dex: 'The spare is also flat. It has always been flat.' },
  transmission:   { name: 'The Transmission', type: 'MONEY', base: [80, 70, 65, 50], xp: 85, cash: 0, shape: 'gear', col: '#8d99a6', moves: ['grind', 'quote'], dex: '"Yeah, that\'s your transmission." The scariest sentence in English.' },
  gym_membership: { name: 'Gym Membership', type: 'MONEY', base: [65, 60, 60, 55], xp: 75, cash: 0, shape: 'card', col: '#2a2a2a', moves: ['annual_fee', 'cant_cancel'], dex: 'Cancellation requires a notarized letter delivered by carrier pigeon.' },
  leg_day:        { name: 'Leg Day', type: 'STRESS', base: [70, 70, 55, 45], xp: 76, cash: 0, shape: 'kettlebell', col: '#4a4f58', moves: ['squat', 'doms'], dex: 'You will not be able to sit on a toilet for three days.' },
  kale_smoothie:  { name: 'Kale Smoothie', type: 'CHORE', base: [65, 65, 60, 50], xp: 75, cash: 0, shape: 'cup', col: '#5aa83a', moves: ['brain_freeze', 'kale_aftertaste'], dex: 'Tastes like a lawn. Costs $14.' },
  beach_body:     { name: 'Beach Body Pressure', type: 'PEOPLE', base: [80, 78, 62, 60], xp: 90, cash: 0, shape: 'blob', col: '#e0a070', shades: true, moves: ['flex', 'comparison'], dex: 'Every body is a beach body. It refuses to accept this.' },
  w2:             { name: 'Missing W-2', type: 'PAPERWORK', base: [70, 65, 65, 50], xp: 80, cash: 0, shape: 'paper', col: '#6aa86a', moves: ['box_12b', 'w2_wait'], dex: 'Your old job mailed it to an apartment you moved out of in 2021.' },
  shoebox:        { name: 'Shoebox of Receipts', type: 'CHORE', base: [75, 70, 70, 35], xp: 80, cash: 0, shape: 'shoebox', col: '#c98a4a', moves: ['receipt_avalanche', 'faded_ink'], dex: 'Every receipt is faded. Every one might be deductible.' },
  owe_money:      { name: 'Amount You Owe', type: 'MONEY', base: [75, 75, 60, 55], xp: 82, cash: 0, shape: 'envelope', col: '#c0392b', moves: ['you_owe', 'penalty'], dex: 'You expected a refund. You did not get a refund.' },
  penalty_letter: { name: 'Penalty Letter', type: 'MONEY', base: [75, 78, 62, 58], xp: 84, cash: 0, shape: 'envelope', col: '#8a2a2a', moves: ['penalty', 'you_owe'], dex: 'Arrives on a Saturday so you can worry all weekend.' },
  dating_app:     { name: 'Dating App', type: 'PEOPLE', base: [72, 72, 60, 66], xp: 86, cash: 0, shape: 'phone', col: '#e8505a', moves: ['endless_swipe', 'unmatched'], dex: 'Shows you the same six people. In a different order.' },
  first_date:     { name: 'First Date Bill', type: 'MONEY', base: [74, 74, 62, 52], xp: 86, cash: 0, shape: 'envelope', col: '#e8c8a0', moves: ['split_check', 'fancy_menu'], dex: 'They ordered the lobster. "Should we split it?"' },
  situationship:  { name: 'Situationship', type: 'PEOPLE', base: [76, 74, 62, 60], xp: 88, cash: 0, shape: 'bubble', col: '#b080e0', moves: ['what_are_we', 'mixed_signals'], dex: 'Not dating. Not not dating. Eight months now.' },
  meet_parents:   { name: 'Meeting the Parents', type: 'STRESS', base: [78, 76, 64, 50], xp: 88, cash: 0, shape: 'house', col: '#d89a6a', moves: ['awkward_dinner', 'judgy_look'], dex: '"So. What do you do?" The question every parent has loaded.' },
  the_ex:         { name: 'THE EX', type: 'PEOPLE', base: [90, 84, 70, 64], xp: 100, cash: 0, shape: 'ghost', col: '#7a6aa0', moves: ['they_texted', 'closure'], dex: '"hey stranger :)" at 2 AM. Every. Single. Time.' },
  audit:          { name: 'THE AUDIT', type: 'PAPERWORK', base: [90, 76, 70, 55], xp: 95, cash: 0, shape: 'clipboard', col: '#3a4a6a', magnifier: true, moves: ['line_by_line', 'scrutiny'], dex: 'Has questions about a $4 coffee from March.' },
};

// ---------------------------------------------------------------- items
// use: 'sanity' | 'energy' | 'full' | 'repel' | 'escape' | 'book' | 'outfit' | 'scratch'
const ITEMS = {
  coffee:        { name: 'Coffee', price: 5, use: 'energy', amt: 10, battle: true, desc: 'Restores 10 Energy. Mostly a personality.' },
  energy_drink:  { name: 'Energy Drink', price: 14, use: 'energy', amt: 25, battle: true, desc: 'Restores 25 Energy. Heart goes brrr.' },
  comfort_food:  { name: 'Comfort Food', price: 8, use: 'sanity', amt: 25, battle: true, desc: 'Restores 25 Sanity. Mac and cheese, obviously.' },
  pizza:         { name: 'Pizza Night', price: 20, use: 'sanity', amt: 60, battle: true, desc: 'Restores 60 Sanity. Pineapple optional.' },
  therapy:       { name: 'Therapy Session', price: 45, use: 'full', battle: true, desc: 'Fully restores Sanity and cures your status.' },
  car_keys:      { name: 'Car Keys', price: 0, use: 'drive', key: true, desc: 'A 2009 sedan. Drive to any town you\'ve visited. Usually starts.' },
  gym_card:      { name: 'Gym Membership', price: 0, use: 'none', key: true, desc: '10% more max Sanity for the whole crew, and faster running. You have been twice.' },
  phone:         { name: 'Phone (Call Mom)', price: 0, use: 'phone', key: true, desc: 'Call Mom. She usually sends money. Once every 5 minutes or she starts asking questions.' },
  pep_talk:      { name: 'Pep Talk', price: 20, use: 'revive', battle: true, desc: 'Gets a crew member who ran out of Sanity back up with half.' },
  headphones:    { name: 'Noise-Cancelling Headphones', price: 15, use: 'repel', amt: 150, desc: 'Weak issues leave you alone for 150 steps.' },
  uber:          { name: 'Rideshare Home', price: 25, use: 'escape', battle: true, desc: 'Escape a wild issue, or ride back to the last hospital you used.' },
  scratch:       { name: 'Scratch-Off Ticket', price: 5, use: 'scratch', desc: 'Could win $50! (Could also not.)' },
  outfit:        { name: 'Thrift Store Fit', price: 30, use: 'outfit', desc: 'A new jacket color. Vintage. Smells vintage too.' },
  book_google:   { name: 'Book: Search Like a Pro', price: 30, use: 'book', skill: 'googling', desc: 'Teaches GOOGLING IT (BRAINS).' },
  book_breathe:  { name: 'Book: Just Breathe', price: 40, use: 'book', skill: 'deep_breaths', desc: 'Teaches DEEP BREATHS.' },
  book_diy:      { name: 'Book: DIY or Die', price: 50, use: 'book', skill: 'fix_it', desc: 'Teaches FIX IT (GRIT).' },
  book_haggle:   { name: 'Book: Haggling 101', price: 50, use: 'book', skill: 'haggle', desc: 'Teaches HAGGLE.' },
  book_exit:     { name: 'Book: Leaving Without Goodbyes', price: 25, use: 'book', skill: 'ghosting', desc: 'Teaches GHOSTING. (Shady.)' },
  book_meditate: { name: 'Book: Meditation for Skeptics', price: 45, use: 'book', skill: 'touch_grass', desc: 'Teaches TOUCH GRASS (CHILL).' },
  book_no:       { name: 'Book: The Art of Saying No', price: 45, use: 'book', skill: 'boundaries', desc: 'Teaches BOUNDARIES.' },
  book_friends:  { name: 'Book: How to Win Friends', price: 80, use: 'book', skill: 'networking', desc: 'Teaches NETWORKING.' },
  book_excel:    { name: 'Book: Spreadsheets for Dummies', price: 80, use: 'book', skill: 'spreadsheet', desc: 'Teaches SPREADSHEET.' },
  book_manual:   { name: 'Book: Actually Read the Manual', price: 35, use: 'book', skill: 'read_manual', desc: 'Teaches READ THE MANUAL.' },
};
// Stock grows as you travel; index = town id, later towns sell everything.
const SHOP_STOCK = [
  ['coffee', 'comfort_food', 'pep_talk', 'headphones', 'book_google', 'book_diy', 'book_meditate', 'book_breathe', 'scratch', 'outfit'],
  ['coffee', 'energy_drink', 'comfort_food', 'pep_talk', 'headphones', 'scratch', 'book_diy', 'book_haggle', 'book_exit'],
  ['coffee', 'energy_drink', 'comfort_food', 'pizza', 'pep_talk', 'uber', 'headphones', 'scratch', 'outfit', 'book_meditate', 'book_no'],
  ['coffee', 'energy_drink', 'pizza', 'therapy', 'pep_talk', 'uber', 'headphones', 'scratch', 'book_friends', 'book_excel', 'book_manual'],
];
const OUTFIT_COLORS = [
  ['Classic Red', '#d8403a'], ['Ocean Blue', '#3a78d8'], ['Forest Green', '#3a9a52'],
  ['Hot Pink', '#e05aa0'], ['Sunshine', '#e8b830'], ['Midnight', '#3a3a5a'], ['Tangerine', '#e8782e'],
];

// ---------------------------------------------------------------- paths
// Dr. Street's choice. base = stat bases (see Stats in game.js).
const PATHS = {
  college: {
    name: 'College', icon: 'diploma',
    base: { san: 70, conf: 62, comp: 55, hus: 55, energy: 2 },
    xpMult: 1.25, cashMult: 1.0, boost: 'BRAINS', debt: 3000, money: 25,
    start: ['wing_it', 'googling', 'small_talk'],
    learn: { 6: 'deep_breaths', 9: 'passive_aggro', 12: 'read_manual', 15: 'spreadsheet', 19: 'networking', 23: 'therapy_talk' },
    pros: ['+25% XP from every issue', 'BRAINS skills hit 20% harder', 'Starts with GOOGLING IT'],
    cons: ['$3,000 student debt: 10% of all cash you earn goes to loans', 'Starts with only $25'],
    blurb: 'Four years, one diploma, a lot of ramen.',
  },
  trade: {
    name: 'Trade School', icon: 'wrench',
    base: { san: 74, conf: 60, comp: 61, hus: 50, energy: 0 },
    xpMult: 1.0, cashMult: 1.15, boost: 'GRIT', debt: 800, money: 100,
    start: ['wing_it', 'elbow_grease', 'fix_it'],
    learn: { 6: 'small_talk', 9: 'power_nap', 12: 'gaslight', 15: 'hustle', 19: 'boundaries', 23: 'all_nighter' },
    pros: ['Tougher: more Sanity & Composure', 'GRIT skills hit 20% harder', '+15% cash, starts with FIX IT'],
    cons: ['$800 tool loan (10% of earnings)', 'Early mornings: less Energy'],
    blurb: 'Two years, real skills, and you can fix your own sink.',
  },
  job: {
    name: 'Get a Job', icon: 'badge',
    base: { san: 70, conf: 64, comp: 55, hus: 64, energy: 2 },
    xpMult: 0.9, cashMult: 1.4, boost: 'SOCIAL', debt: 0, money: 250,
    start: ['wing_it', 'small_talk', 'haggle'],
    learn: { 6: 'elbow_grease', 9: 'gaslight', 12: 'charm', 15: 'networking', 19: 'power_nap', 23: 'hustle' },
    pros: ['+40% cash and faster (Hustle)', 'SOCIAL skills hit 20% harder', 'Starts with $250 and HAGGLE'],
    cons: ['No degree: 10% less XP', 'Starts at the bottom of the ladder'],
    blurb: 'Paycheck now, figure out the rest later.',
  },
};

// ---------------------------------------------------------------- world
const BIOME_IDS = ['suburb', 'desert', 'beach', 'snow', 'forest', 'swamp', 'farm', 'city'];

const TOWNS = [
  { name: 'Maple Grove',     biome: 'suburb', col: 0, row: 0, leader: 'parents',
    sign: 'MAPLE GROVE\nNice lawns. Nosy neighbors.' },
  { name: 'Dusty Gulch',     biome: 'desert', col: 1, row: 0, leader: 'car',
    sign: 'DUSTY GULCH\nNext gas: 140 miles. Good luck.' },
  { name: 'Sunnyside Beach', biome: 'beach',  col: 2, row: 0, leader: 'fitness',
    sign: 'SUNNYSIDE BEACH\nNo lifeguard on duty. Or ever.' },
  { name: 'Frostpeak',       biome: 'snow',   col: 3, row: 0, leader: 'taxes',
    sign: 'FROSTPEAK\nKeep warm. Keep receipts.' },
  { name: 'Pinewood',        biome: 'forest', col: 3, row: 1, leader: 'dating',
    sign: 'PINEWOOD\nPopulation: mostly squirrels.' },
  { name: 'Boggy Bayou',     biome: 'swamp',  col: 2, row: 1, leader: 'loans',
    sign: 'BOGGY BAYOU\nEverything here grows. Especially interest.' },
  { name: 'Harvest Hollow',  biome: 'farm',   col: 1, row: 1, leader: 'masters',
    sign: 'HARVEST HOLLOW\nHome of Hollow State University (Go Gourds!)' },
  { name: 'Metro Heights',   biome: 'city',   col: 0, row: 1, leader: 'career',
    sign: 'METRO HEIGHTS\nThe city that never sleeps (because rent).' },
];

// Routes connect towns in order; the last one closes the loop back home.
// lv = wild level range, need = milestones needed to pass the gate.
const ROUTES = [
  { a: 0, b: 1, lv: [2, 4],   enc: ['parking_ticket', 'group_chat', 'dirty_dishes', 'forgot_sub', 'back_pain'], need: 0, gateFlag: 'path' },
  { a: 1, b: 2, lv: [8, 12],  enc: ['spam_call', 'laundry', 'overdraft', 'sunburn', 'printer_jam', 'group_chat'], need: 1 },
  { a: 2, b: 3, lv: [13, 17], enc: ['jury_duty', 'wedding_invite', 'ikea', 'insomnia', 'reply_all', 'overdraft'], need: 2 },
  { a: 3, b: 4, lv: [19, 22], enc: ['landlord', 'wifi', 'perf_review', 'ex_post', 'insomnia'], need: 3 },
  { a: 4, b: 5, lv: [21, 24], enc: ['ex_post', 'dentist', 'allergies', 'group_project', 'ikea'], need: 0 },
  { a: 5, b: 6, lv: [23, 26], enc: ['dentist', 'hoa', 'imposter', 'landlord', 'allergies'], need: 0 },
  { a: 6, b: 7, lv: [25, 28], enc: ['perf_review', 'imposter', 'hoa', 'group_project', 'wifi'], need: 0 },
  { a: 7, b: 0, lv: [29, 32], enc: ['imposter', 'landlord', 'dentist', 'hoa'], need: 7 },
];

// ---------------------------------------------------------------- leaders
// Order of the 8 is just data: move them between towns by changing `town`.
const LEADERS = {
  car: {
    name: 'RUSTY', title: 'CAR TROUBLE', town: 1, badge: 'Jumper Cable Badge', badgeIcon: 'bolt', color: '#e0902a',
    team: [['check_engine', 8], ['flat_tire', 9], ['transmission', 11]], power: 1.05,
    reward: 400, skill: 'jumpstart', look: 'cap',
    perk: { item: 'car_keys', name: 'A USED CAR', text: 'Rusty tossed you the keys to a 2009 sedan. "She runs. Mostly." Use the CAR KEYS in your bag to drive to any town you\'ve visited.' },
    pal: { h: '#3a2a1a', s: '#e0a878', c: '#3a5a9a', p: '#2a3a6a', b: '#2a2a2a', style: 'short' },
    intro: [
      'Hear that rattle? That\'s the sound of your weekend plans dying.',
      'I\'m RUSTY. Folks call me CAR TROUBLE. I show up right after you pay off your car.',
      'Let\'s see if you can handle what\'s under the hood!',
    ],
    win: ['Well I\'ll be. You didn\'t even need a tow.', 'Take the JUMPER CABLE BADGE. And this...'],
    after: 'Pro tip: that check engine light? Probably the gas cap. Probably.',
    lose: 'Come back when you know where the dipstick is.',
    tip: 'Rusty\'s issues are STRESS, CHORE and MONEY types. CHILL beats STRESS, GRIT beats CHORE, BRAINS beats MONEY!',
  },
  fitness: {
    name: 'COACH MAX GAINS', title: 'FITNESS', town: 2, badge: 'Sweatband Badge', badgeIcon: 'heart', color: '#e0503a',
    team: [['gym_membership', 13], ['leg_day', 14], ['kale_smoothie', 14], ['beach_body', 17]], power: 1.2,
    reward: 650, skill: 'meal_prep', look: 'headband',
    perk: { item: 'gym_card', name: 'A GYM MEMBERSHIP', text: 'Coach Max signed you up. "Annual. Non-refundable." Your whole crew gets 10% more max Sanity, and you run faster.' },
    pal: { h: '#e8c050', s: '#c88858', c: '#e8603a', p: '#2a2a3a', b: '#f0f0f0', style: 'short' },
    intro: [
      'YO! You look like you skip leg day. You look like you skip EVERY day.',
      'I\'m COACH MAX GAINS. I am FITNESS. I wake up at 4 AM to be disappointed in people.',
      'Drop and give me a battle!',
    ],
    win: ['Okay, okay! That was a solid set. Respect.', 'You earned the SWEATBAND BADGE. Hydrate.'],
    after: 'Rest days are part of the program. Nobody tells you that. I\'m telling you that.',
    lose: 'Walk it off. Then walk back here.',
    tip: 'Coach Max uses MONEY, STRESS, CHORE and PEOPLE issues. Bring variety! SOCIAL or SHADY skills crush PEOPLE.',
  },
  taxes: {
    name: 'THE AUDITOR', title: 'TAXES', town: 3, badge: 'Refund Badge', badgeIcon: 'doc', color: '#4a6a9a',
    team: [['w2', 17], ['shoebox', 17], ['owe_money', 18], ['penalty_letter', 18], ['audit', 21]], power: 1.02,
    reward: 900, skill: 'write_off', look: 'glasses',
    perk: { refund: 300, debtPay: 800, name: 'A TAX REFUND', text: 'You actually got money back! A $300 check, and up to $800 of your debt got paid off.' },
    pal: { h: '#8a8a8a', s: '#e8c0a0', c: '#4a4f5a', p: '#3a3f4a', b: '#1a1a1a', style: 'bald', tie: '#2a4a8a' },
    intro: [
      'Ah. Another one. Please take a number.',
      'I am THE AUDITOR. I am TAXES. I come for everyone. Every year. Forever.',
      'Let us review your... records.',
    ],
    win: ['...I find your filing to be in order. Begrudgingly.', 'The REFUND BADGE is yours. Don\'t spend it all at once.'],
    after: 'Keep your receipts. All of them. Yes, even that one.',
    lose: 'You may file for an extension. Come back when you\'re ready.',
    tip: 'TAXES is mostly PAPERWORK. BRAINS and SHADY skills tear through paperwork. Bring snacks.',
  },
  dating: {
    name: 'VALENTINA', title: 'DATING', town: 4, badge: 'Rose Badge', badgeIcon: 'heart2', color: '#e05a8a',
    team: [['dating_app', 21], ['first_date', 21], ['situationship', 22], ['meet_parents', 22], ['the_ex', 25]], power: 1.15,
    reward: 1100, skill: 'charm', look: null,
    pal: { h: '#2a1a1a', s: '#e8b890', c: '#c8304a', p: '#2a2a3a', b: '#c8304a', style: 'long' },
    perk: { so: true, name: 'SOMEONE SPECIAL', text: 'Love is in the air. Someone has been waiting to meet you outside.' },
    intro: [
      'Welcome to DATING, sweetie. I\'m VALENTINA.',
      'Four hundred first dates. Zero second dates. I am the expert.',
      'Let\'s see if you\'re relationship material. Swipe right on PAIN!',
    ],
    win: ['...Okay. Fine. You\'re a catch. Don\'t let it go to your head.', 'Take the ROSE BADGE. And go outside. Trust me.'],
    after: 'Communication. Therapy. A decent haircut. That\'s the whole secret.',
    lose: 'It\'s not you, it\'s me. (It\'s you.) Come back when you\'ve worked on yourself.',
    tip: 'Dating throws PEOPLE, MONEY and STRESS issues. SOCIAL and SHADY crush PEOPLE, BRAINS handles MONEY, CHILL calms STRESS.',
  },
  loans:   { title: 'STUDENT LOANS', town: 5, locked: true, perk: { clearDebt: true, name: 'DEBT FREEDOM', text: 'Your loans are PAID OFF. No more 10% cut from everything you earn.' }, badgeIcon: 'coin', color: '#5a8a4a',
    closed: 'STUDENT LOANS is in forbearance. Interest is still accruing. (Coming in a future update.)' },
  masters: { title: 'MASTERS DEGREE', town: 6, locked: true, perk: { xp: 1.2, name: 'A DIPLOMA', text: 'Framed and everything. You now earn 20% more XP from every fight.' }, badgeIcon: 'cap', color: '#6a4aa8',
    closed: 'MASTERS DEGREE is writing a thesis. Due date: unknown. (Coming in a future update.)' },
  career:  { title: 'CAREER', town: 7, locked: true, perk: { salary: true, name: 'A SALARY', text: 'Direct deposit! You now earn money just by walking around.' }, badgeIcon: 'case', color: '#3a4a5a',
    closed: 'CAREER is in a meeting about meetings. (Coming in a future update.)' },
  parents: { title: 'PARENTS', town: 0, locked: true, perk: { name: 'THEIR APPROVAL', text: '"We\'re proud of you." They finally said it.' }, badgeIcon: 'house', color: '#c05a3a',
    closed: '"We\'ll talk when you\'ve done something with your life." (The final leader. Needs 7 milestones.)' },
};
const LEADER_ORDER = ['car', 'fitness', 'taxes', 'dating', 'loans', 'masters', 'career', 'parents'];

// ---------------------------------------------------------------- town folks
// Per town: outdoor wanderers and one line-set per house (h0..h2).
// gift: [item, count] given once.
const TOWNFOLK = [
  { // Maple Grove
    out: [
      { pal: 'kid', say: ['When I grow up I want a mortgage like my dad! He says it\'s "crushing." Sounds awesome.'] },
      { pal: 'lady', say: ['The HOA says my lawn flamingos are "a bit much." There are only forty of them.'] },
      { pal: 'dude', say: ['Tall grass outside town is FULL of issues. Parking tickets, group chats...', 'But sometimes people drop cash in there too. Keep your eyes peeled!'] },
    ],
    houses: [
      null, // player's home (special)
      { pal: 'dude', say: ['I\'ve been "about to start a podcast" for six years.', 'The mic is still in the box. It\'s a really nice box.'] },
    ],
  },
  { // Dusty Gulch
    out: [
      { pal: 'old', say: ['My check engine light\'s been on so long I think of it as a nightlight.'] },
      { pal: 'lady', say: ['It\'s a dry heat. A dry, relentless, soul-cooking heat.'] },
      { pal: 'kid', say: ['RUSTY at the Leader Hall can make ANY car break down just by looking at it!'] },
    ],
    houses: [
      { pal: 'old', say: ['I came out here for gold. Now I\'m just here for the cheap rent.'] },
      { pal: 'lady', say: ['My car broke down here in 2009. Still waiting on the tow truck.', 'Here, you look thirsty. Take these.'], gift: ['energy_drink', 2] },
      { pal: 'dude', say: ['I collect cacti. They need no water, no attention, no validation.', 'Honestly? Role models.'] },
    ],
  },
  { // Sunnyside Beach
    out: [
      { pal: 'dude', say: ['Coach Max did 400 pushups and then told ME I looked tired.'] },
      { pal: 'lady', say: ['Sunscreen is the cheapest therapy. Wear it.'] },
      { pal: 'musician', busk: true, say: ['♪ Strummin\' for tips, livin\' on chips ♪'] },
    ],
    houses: [
      { pal: 'dude', say: ['Dude, I\'m not unemployed. I\'m "between swells."'] },
      { pal: 'old', say: ['Grandma\'s cookies. Take some. Don\'t tell Coach Max.'], gift: ['comfort_food', 3] },
      { pal: 'lady', say: ['I\'ve posted "living my best life" forty times today.', 'I am so tired.'] },
    ],
  },
  { // Frostpeak
    out: [
      { pal: 'old', say: ['The Auditor hasn\'t smiled since 1998. Rumor is it was a rounding error.'] },
      { pal: 'kid', say: ['Brrr! My mom\'s W-2 froze to the mailbox!'] },
      { pal: 'lady', say: ['Taxes are mostly PAPERWORK. If you\'ve got BRAINS, use them!'] },
    ],
    houses: [
      { pal: 'dude', say: ['I\'m an accountant. It\'s April somewhere. It\'s ALWAYS April somewhere.'] },
      { pal: 'lady', say: ['Cold out there. Coffee is the only currency that matters.'], gift: ['coffee', 4] },
      { pal: 'old', say: ['Snowed in for three days. I finally finished all my laundry.', 'Then I made more. The cycle continues.'] },
    ],
  },
  { // Pinewood
    out: [
      { pal: 'dude', say: ['I swiped right on a tree. We\'re taking things slow.'] },
      { pal: 'lady', say: ['The DATING leader? Always "busy." Always "something came up."'] },
      { pal: 'kid', say: ['A squirrel stole my sandwich and I respect it.'] },
    ],
    houses: [
      { pal: 'lady', say: ['My friend said "just be yourself." Terrible advice. Have you MET me?'] },
      { pal: 'dude', say: ['These headphones blocked out my ex\'s voice for a whole year.', 'I\'m healed now. You take them.'], gift: ['headphones', 2] },
      { pal: 'old', say: ['Back in my day, we met people at the grocery store. In person. Like animals.'] },
    ],
  },
  { // Boggy Bayou
    out: [
      { pal: 'old', say: ['Everything in this swamp grows. Moss. Mushrooms. Interest.'] },
      { pal: 'dude', say: ['I paid off my loans! ...Just kidding. I just like saying it.'] },
      { pal: 'musician', busk: true, say: ['♪ Banjo for a buck, buck for some luck ♪'] },
    ],
    houses: [
      { pal: 'lady', say: ['I put my loans in forbearance and now they\'re bigger. How?!'] },
      { pal: 'old', say: ['Gator stew. Don\'t ask. Just eat. You look stressed.'], gift: ['pizza', 1] },
      { pal: 'kid', say: ['My big sister says a degree is "an investment." She cries a lot.'] },
    ],
  },
  { // Harvest Hollow
    out: [
      { pal: 'dude', say: ['Hollow State! Go Gourds! I\'m a ninth-year senior.'] },
      { pal: 'old', say: ['Farm life is simple. Wake up. Work. Sleep. Worry about rain.'] },
      { pal: 'lady', say: ['I\'m getting my second master\'s. I simply cannot leave school.'] },
    ],
    houses: [
      { pal: 'old', say: ['Corn, corn, corn. You want some corn? It\'s mostly corn here.'] },
      { pal: 'lady', say: ['Grad school stipend: $900 a month. I\'m thriving. (I am not.)', 'Take a coffee. Take two. Please.'], gift: ['coffee', 2] },
      { pal: 'dude', say: ['My thesis is on the social life of chickens. They\'re messy.'] },
    ],
  },
  { // Metro Heights
    out: [
      { pal: 'suit', say: ['I can\'t talk, I\'m late for a meeting about the last meeting.'] },
      { pal: 'lady', say: ['I pay $2,400 a month for a closet with a window. The window faces a wall.'] },
      { pal: 'dude', say: ['They call it "hustle culture." I call it "Tuesday."'] },
    ],
    houses: [
      { pal: 'suit', say: ['I have 14 roommates. It\'s called "co-living." It\'s called "a hostel."'] },
      { pal: 'lady', say: ['I\'m "circling back." I\'ve been circling for three years.'] },
      { pal: 'dude', say: ['Take this. My company gives them away. It\'s called "wellness."'], gift: ['therapy', 1] },
    ],
  },
];

// NPC palettes (h=hair, s=skin, c=shirt, p=pants, b=shoes)
const PALS = {
  player:  { h: '#6b3a1c', s: '#f6c79c', c: '#d8403a', p: '#3c3a58', b: '#4a2a16', style: 'short', pack: '#a0682e' },
  mom:     { h: '#8a4a2a', s: '#f0c8a0', c: '#7aa04a', p: '#5a5a7a', b: '#4a3a2a', style: 'long' },
  street:  { h: '#eeeef4', s: '#f0c098', c: '#6a8ab0', p: '#4a4a5a', b: '#2a1a1a', style: 'bald', coat: '#f4f4f0' },
  aide:    { h: '#2a2a2a', s: '#c89070', c: '#5a9a8a', p: '#3a4a6a', b: '#2a2a2a', style: 'short', coat: '#f4f4f0' },
  nurse:   { h: '#e88aa8', s: '#f0c8a8', c: '#f8d0dc', p: '#f0c0d0', b: '#f4f4f4', style: 'bun' },
  clerk:   { h: '#3a2a1a', s: '#d8a070', c: '#3a7ad8', p: '#3a3a4a', b: '#2a2a2a', style: 'short' },
  pastor:  { h: '#8a8a8a', s: '#a87050', c: '#2a2a3a', p: '#2a2a3a', b: '#1a1a1a', style: 'bald' },
  guard:   { h: '#2a2a3a', s: '#e0b088', c: '#f08a2a', p: '#2a3a5a', b: '#1a1a1a', style: 'short' },
  guide:   { h: '#f0d050', s: '#f0c8a0', c: '#4ab0a0', p: '#3a3a4a', b: '#2a2a2a', style: 'short' },
  kid:     { h: '#e8a040', s: '#f0c8a0', c: '#4ab04a', p: '#3a5aa0', b: '#c03a3a', style: 'short' },
  lady:    { h: '#a04a2a', s: '#e8b890', c: '#c05ab0', p: '#4a4a6a', b: '#3a2a2a', style: 'long' },
  dude:    { h: '#2a1a0a', s: '#9a6a4a', c: '#e8c040', p: '#4a5a7a', b: '#2a2a2a', style: 'short' },
  old:     { h: '#e8e8e8', s: '#e8c0a0', c: '#8a6a4a', p: '#5a4a3a', b: '#3a2a1a', style: 'bald' },
  suit:    { h: '#1a1a1a', s: '#c89070', c: '#3a4050', p: '#2a3040', b: '#1a1a1a', style: 'short', tie: '#c83a3a' },
  musician:{ h: '#6a3a1a', s: '#d8a078', c: '#c0302a', p: '#3a3a5a', b: '#5a3a1a', style: 'long' },
};

// ---------------------------------------------------------------- crew
// People who fight alongside you. They level with you; `learn` is
// [level, skill] and an ally fights with Wing It plus the last three skills it
// has learned. `after` = the leader whose defeat brings them into your life.
const ALLIES = {
  chad: {
    name: 'CHAD', title: 'High School Best Friend', after: 'car', boost: 'SOCIAL',
    pal: { h: '#2a1a0a', s: '#c08860', c: '#3a9ad8', p: '#3a3a58', b: '#e8e8e8', style: 'short' },
    base: { san: 66, conf: 60, comp: 54, hus: 62, energy: 2 },
    learn: [[1, 'small_talk'], [1, 'touch_grass'], [1, 'hype_up'], [12, 'networking'], [16, 'elbow_grease']],
    shout: '"{NAME}?! NO WAY!"',
    pitch: ['It\'s me! CHAD! From high school! Chemistry lab partner! Your car-pool to prom!',
      'Dude, I haven\'t seen you since graduation. I heard you just beat CAR TROUBLE. That\'s insane.',
      'I\'ve been working at the smoothie place, but honestly? I\'m bored. Adulting solo is rough.',
      'Let me come with you. I\'m great with people. Mostly. Sometimes.'],
    line: 'Best friends don\'t let best friends adult alone.',
  },
  // the significant other is the opposite gender of your character
  so_f: {
    name: 'SOPHIE', title: 'Significant Other', after: 'dating', boost: 'CHILL',
    pal: { h: '#3a1a1a', s: '#e8b890', c: '#e86a8a', p: '#3a3a5a', b: '#f4f4f4', style: 'long' },
    base: { san: 72, conf: 62, comp: 62, hus: 58, energy: 4 },
    learn: [[1, 'touch_grass'], [1, 'deep_breaths'], [1, 'spreadsheet'], [1, 'therapy_talk'], [24, 'boundaries']],
    shout: '"Oh! Sorry, I wasn\'t looking where I was going!"',
    pitch: ['...Wait. Did you just survive VALENTINA? Nobody survives Valentina.',
      'I\'ve been on the apps for three years. Nothing. And then you walk out of THAT building.',
      'That\'s... honestly kind of attractive. I\'m SOPHIE.',
      'Want to get coffee sometime? Or, like, every day? I could come along. I\'m very organized.'],
    line: 'You did the dishes AND filed on time? Marry me. (Kidding.) (Unless?)',
  },
  so_m: {
    name: 'MARCUS', title: 'Significant Other', after: 'dating', boost: 'GRIT',
    pal: { h: '#1a1a1a', s: '#9a6a4a', c: '#4a7ad8', p: '#3a3a4a', b: '#2a2a2a', style: 'short' },
    base: { san: 76, conf: 64, comp: 60, hus: 54, energy: 2 },
    learn: [[1, 'fix_it'], [1, 'hustle'], [1, 'small_talk'], [1, 'meal_prep'], [24, 'networking']],
    shout: '"Whoa! Sorry, I wasn\'t looking where I was going!"',
    pitch: ['...Wait. Did you just survive VALENTINA? Nobody survives Valentina.',
      'I\'ve been on the apps for three years. Nothing. And then you walk out of THAT building.',
      'That\'s... honestly kind of amazing. I\'m MARCUS.',
      'Want to get coffee sometime? Or, like, every day? I could come along. I meal prep.'],
    line: 'You did the dishes AND filed on time? Marry me. (Kidding.) (Unless?)',
  },
};

// The two playable characters (after House Keeper's explorers).
const HEROES = {
  boy:  { label: 'BOY', pal: { h: '#6b3a1c', s: '#f6c79c', c: '#3a6fd0', p: '#3c3a58', b: '#4a2a16', style: 'short', pack: '#a0682e' }, look: 'headband',
    blurb: ['Red bandana and a backpack', 'Fresh out of high school'] },
  girl: { label: 'GIRL', pal: { h: '#f4d65a', s: '#f6c79c', c: '#3aa078', p: '#7a4a2a', b: '#4a2a16', style: 'long', pack: '#a0682e' }, look: null,
    blurb: ['Golden hair and a backpack', 'Fresh out of high school'] },
};
