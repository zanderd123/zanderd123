# Quotient

A daily brain workout: one IQ-style question a day, plus unlimited practice.

- **Today**: one medium question per day, the same all day. The category
  rotates daily. It takes a few minutes, and a hint is there if you get stuck.
- **Practice**: as many questions as you like. Pick **Easy / Medium / Hard**
  and a category, or Mixed.
- **Progress**: daily streak, a 4-week calendar, and accuracy by category and
  difficulty.

Categories: number sequences, pattern matrices (Raven's-style grids),
arithmetic, logic (orderings, knights and knaves, day puzzles), letter series,
and verbal reasoning (analogies, odd one out, compound words).

Every question except verbal is generated from a seed, so practice never runs
out and the daily item is fixed for the date. Every answer comes with a
worked explanation.

## Files

    quotient.html   the app, written for the Claude Artifact host
    index.html      standalone build: open it in any browser
    build.mjs       node quotient/build.mjs  -> rebuilds index.html
    check.mjs       node quotient/check.mjs  -> generates 54,000 questions and
                    checks each is well formed

Keyboard: A–F or 1–6 answers, H shows the hint.

Progress is saved in the browser. When the page runs as a Claude Artifact it
is also saved to your account, so it follows you across devices.
