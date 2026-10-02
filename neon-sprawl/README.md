# Neon Sprawl

A cyberpunk idle city builder in a single HTML file. Open `index.html` in a browser; there's no build step.

You start with one Shack on one lot of a 7×7 grid, earning 1 cyber credit a second. Spend credits to:

- **Build**: upgrade any building through eight tiers (Shack, Ramen Stall, Hab Block, Data Den, Corp Tower, Skyscraper, Megascraper, Arcology), and buy new lots outward from the centre. Click a building to select it, or click the glowing dashed lot to buy it.
- **Crew**: hire Script Kiddies, Fixers, Netrunners, Rogue AIs and more for flat credits per second (×1, ×10 or max).
- **Tech**: one-time multipliers that unlock as you hit milestones.
- **Jack in**: click for a burst of credits worth 10% of your income per second.
- **Data couriers**: a drone crosses the sky every minute or so. Click it for 45 seconds' worth of income.

Progress saves to `localStorage` every 10 seconds. While you're away the city keeps earning, for up to 8 hours.

Balance numbers live at the top of the script (`TIERS`, `CREW`, `TECH`, `LOT_BASE`, `LOT_GROWTH`).
