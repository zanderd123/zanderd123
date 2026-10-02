# Neon Sprawl

A cyberpunk idle city builder in a single HTML file. Open `index.html` in a browser; there's no build step.

You start with one Shack in the Capital, earning 1 cyber credit a second.

## Tabs

- **Build**: buy lots and upgrade buildings through eight tiers. A Shack's first upgrade picks its type, which is then fixed.
  - **Housing** fills with tenants from your whole crew, so it grows with your average headcount.
  - **Crew buildings**, one per role: Arcade (Script Kiddies), Bar (Fixers), Netcafé (Netrunners), Data Vault (Data Brokers), Server Farm (Rogue AIs), Corp Office (Turncoat Execs), Signal Shrine (Ghosts in the Grid). Each is staffed by its own crew and earns more the more of that role you hire. Senior roles count as more staff. Unstaffed, they earn 60% of Housing.
  - **Mixed-use bonus**: each building type in a district after the first adds +10%.
  - **Buy in bulk** buttons upgrade everything, or buy every lot, that you can afford, in the district you're viewing only. The Construction Drones tech unlocks an auto-builder you can switch on and off.
- **Crew**: unlimited hires, each 15% pricier than the last. "Hire everyone I can afford" hires crew only. Recruiter AI unlocks auto-hire.
- **Tech**: one-time multipliers that unlock at milestones.
- **Infra**: once your newest district has 25 lots, build a cyber road to a new district and choose its type. The building type that matches a district earns ×3 there. The Capital favours no type, so everything there earns ×1.5.

  | District | Matching type |
  |---|---|
  | Residential Ring | Housing |
  | Entertainment District | Arcades |
  | Loading Docks | Bars |
  | Net Quarter | Netcafés |
  | Financial District | Data Vaults |
  | Industrial Zone | Server Farms |
  | Corporate Plaza | Corp Offices |
  | Ghost Market | Signal Shrines |

  Each district's prices are ×600 the one before, and its buildings earn ×40. Every road also multiplies crew pay ×5. Roads upgrade to Neon Highway, Maglev Line and Hyperloop for +20% income per grade.
- **Goals**:
  - **Reboot the Grid** wipes the city in exchange for Neural Chips, each worth +2% income for good.
  - **Achievements**: 41 of them, each worth +2% income. Chips and achievements survive a reboot.

Buttons you can't afford yet show how long until you can. Once you have two districts, a bar over the city switches between them, and the map shows them all. Sound is a Tron-style techno track plus synth effects, all generated in the browser, and is off until you turn it on.

When every Capital lot reaches tier 8, the Capital fuses into the **Capitol Spire**, one megastructure that adds +25% to all income.

## Saving

- The game saves in the browser every 10 seconds and when you close it. While you're away the city keeps earning, for up to 8 hours.
- On claude.ai, a signed-in owner or contributor also gets a **cloud save**: a private copy on their account, written every minute. It loads automatically when it's newer than the browser copy. Visitors on a shared link can't write it and keep the browser copy.
- **Save codes** (Goals tab) copy the whole save as text to paste back later, on any device or in this file opened locally.

Saves from earlier versions load, with their first sector becoming the Capital.

Balance constants are at the top of the script. `window.neonSprawl` exposes the economy for testing from the console.
