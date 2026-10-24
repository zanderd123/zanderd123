# Quotient

A daily brain workout: one IQ-style question a day, plus unlimited practice.

- **Today**: the Question of the Day (medium, a few minutes, never repeats)
  and a Word of the Day to guess the meaning of. Peanut the elephant cheers,
  hints and reacts as you go.
- **Practice**: as many questions as you like. Pick **Easy / Medium / Hard**
  and a category, or Mixed.
- **Progress**: this week vs last week, Brain Score and accuracy trends
  (7 days to all time), skill per category, and the daily calendar.
- XP, levels, practice combos, confetti and optional sound effects.

Categories: number sequences, pattern matrices (Raven's-style grids),
arithmetic, logic (orderings, knights and knaves, day puzzles), letter series,
and verbal reasoning (analogies, odd one out, compound words).

Every question except verbal is generated from a seed, so practice never runs
out. The Question of the Day is fixed for its date and is re-rolled if it
would match any earlier day. Verbal reasoning has 34 hand-written items and
the Word of the Day list has 125 words, one per day in a fixed shuffled order.

Brain Score works like a chess rating: everyone starts at 1000, right answers
raise it, and harder questions move it more. Every answer comes with a
worked explanation.

## Files

    quotient.html   the app, written for the Claude Artifact host
    index.html      standalone build: open it in any browser
    build.mjs       node quotient/build.mjs  -> rebuilds index.html
    check.mjs       node quotient/check.mjs  -> checks 54,000 generated questions,
                    ten years of daily questions for repeats, and the word list

Keyboard: A–F or 1–6 answers, H shows the hint.

Progress is saved in the browser. When the page runs as a Claude Artifact it
is also saved to your account, so it follows you across devices.
