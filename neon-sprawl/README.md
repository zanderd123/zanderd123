# Neon Sprawl

A cyberpunk idle city builder in a single HTML file. Open `index.html` in a browser; there's no build step.

You start with one Shack on one lot of a 7×7 grid, earning 1 cyber credit a second. Spend credits on:

- **Build**: buy lots outward from the centre and upgrade buildings through eight tiers. A Shack's first upgrade picks its type, which is then fixed:
  - **Housing** (Ramen Stall → … → Arcology) earns the most on its own.
  - **Crew buildings**, one type per crew role: Arcade (Script Kiddies), Bar (Fixers), Netcafé (Netrunners), Data Vault (Data Brokers), Server Farm (Rogue AIs), Corp Office (Turncoat Execs), Signal Shrine (Ghosts in the Grid). They earn 60% of housing output but multiply their crew's pay. The boost grows with the square root of the type's combined tier points, so each extra building adds a little less.
  - **Mixed-use bonus**: every building type in a sector after the first adds +10% to that sector's output.
- **Crew**: unlimited hires, each 15% pricier than the last. Hiring the first of a role unlocks its building type.
- **Tech**: one-time multipliers that unlock at milestones.
- **Infra**: once your newest sector has 25 lots, build a cyber road to a new 7×7 sector. Each sector's prices are ×300 the one before and its buildings earn ×40. Every road also multiplies all crew pay ×5. Roads can be upgraded (Neon Highway, Maglev Line, Hyperloop) for +20% to all output per grade.
- **Map**: once you have two sectors, switch between them with the bar over the city, or open the map to see them all joined by roads.
- **Jack in** pays 10% of your income per click, and the data courier drone pays 45 seconds of income.

Progress saves to `localStorage` every 10 seconds. While you're away the city keeps earning, for up to 8 hours. Saves from the first version load as one sector of Housing.

Balance constants are at the top of the script. `window.neonSprawl` exposes the economy for testing from the console.
