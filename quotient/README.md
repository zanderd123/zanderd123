# Quotient

A daily brain workout: one IQ-style question a day, plus unlimited practice.

- **3-minute workout**: one button runs four rounds back to back: a 30-second
  speed warm-up, the Question of the Day, a memory game, and the Word of the
  Day (a bonus question or a focus game once those are done). The games
  rotate each day, and each one's difficulty follows your Brain Score in
  that skill.
- **Today**: the Question of the Day (medium, a few minutes, never repeats),
  the **Daily Grid** (a number-placement logic puzzle in Easy 6×6, Medium and
  Hard 9×9, the same for everyone each day, always with exactly one solution),
  and a Word of the Day to guess the meaning of. A **Share results** button
  copies a short summary to paste into a message.
- **Friends leaderboard** (claude.ai version): today's points for the
  question and the hardest grid solved, plus this week's XP. Each person
  writes only their own `board/<id>` entry and stores ids, never names. On a
  personal account, friends must be invited by email as Editors to save
  scores; anyone else can watch. Times under 3 seconds (question) or 20
  seconds (grid) are ignored as implausible. Peanut the elephant cheers,
  hints and reacts as you go.
- **Practice**: as many questions as you like. Pick **Easy / Medium / Hard**
  and a category, or Mixed. Nine timed games live here too, three per skill,
  each with a short "How this helps your brain" note before you play:
  - **Memory**: Pattern Grid, Sequence, Number Span
  - **Speed**: Speed Maths, Quick Compare, Symbol Match
  - **Focus**: Colour Clash, Arrow Flanker, Star Catch
- **Test**: a 25-question, 20-minute practice test mixing every question
  type. No hints, adaptive difficulty (two right steps up, a miss steps
  down), and answers revealed at the end. The Test Score is estimated on the
  Brain Score scale. It is a practice score, not an IQ: there is no norming
  group behind it, and scores rise with practice.
- **Progress**: Test Score history, this week vs last week, Brain Score and
  accuracy trends (7 days to all time), skill per category, personal bests
  for every game, and the daily calendar.
- XP, levels, practice combos, confetti and optional sound effects.

Categories: number sequences, pattern matrices (Raven's-style grids),
arithmetic, logic (orderings, knights and knaves, day puzzles), letter series,
verbal reasoning (analogies, odd one out, compound words) and spatial
reasoning (which shape is turned rather than flipped), plus the three games.

Every question except verbal is generated from a seed, so practice never runs
out. The Question of the Day is fixed for its date and is re-rolled if it
would match any earlier day. Verbal reasoning has 34 hand-written items and
the Word of the Day list has 125 words, one per day in a fixed shuffled order.

Brain Score works like a chess rating: everyone starts at 1000, right answers
raise it, and harder questions move it more. Every answer comes with a
worked explanation.

## Files

    quotient.html      the app, written for the Claude Artifact host
    build.mjs          node quotient/build.mjs -> rebuilds app/, the installable web app
    make-icons.mjs     node quotient/make-icons.mjs -> draws the app icons from Peanut
    check.mjs          node quotient/check.mjs -> checks 63,000 generated questions,
                       ten years of daily questions for repeats, 120 Daily Grids
                       for a single solution, and the word list
    app/               open app/index.html in any browser, or host the folder
    MAKE-IT-AN-APP.md  steps to host it, install it, and reach the app stores

Keyboard: A–F or 1–6 answers, H shows the hint.

Progress is saved in the browser. When the page runs as a Claude Artifact it
is also saved to your account, so it follows you across devices.
