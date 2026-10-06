# Neon Sprawl

A cyberpunk idle city builder in a single HTML file. Open `index.html` in a browser; there's no build step.

**Play it:** https://zanderd123.github.io/zanderd123/

## Publishing

`.github/workflows/pages.yml` publishes this folder to GitHub Pages whenever `neon-sprawl/` changes on the repo's default branch. It needs one setting: **Settings → Pages → Source: GitHub Actions**. `preview.png` is the image shown when the link is shared.

On the public site there's no claude.ai cloud save; players keep the browser save and save codes.

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

## Skill trees

At tier 3, and again at tier 6, every building picks a specialization. The first sets its massing, the second adds a crown, and they stack:

| Specialization | Looks like | Does |
|---|---|---|
| Highrise | Slender, tall tower with a needle | This building earns ×1.3 per level |
| Hub | Wide podium, twin towers, sky-bridge, landing pad | Buildings beside it earn +8% per level |
| Uplink | Antenna farm and satellite dishes | Jack in and couriers pay more, citywide |
| Barracks | Offset stacked crew quarters in neon | All crew pay more, citywide |

Buildings that reached tier 3 before skill trees existed keep their classic look.

## The Capital

The Capital has gold-trimmed streets, sweeping searchlights, a holographic monument, busier crowds, more hover cars and police drones. Once it has 10 lots, the council can enact one **edict** at a time (Curfew Lifted, Tax Holiday, Building Boom, Open Data Act, Labour Accord, Mixed-Use Mandate, Smog Waiver). Changing edicts waits for the council, which meets every 3 minutes.

## A living city

Pedestrians walk the streets between buildings, hover cars and drones fly overhead, and windows switch on and off at random. Financial District towers carry stock-ticker jumbotrons; Entertainment District buildings carry animated electric billboards.

## Performance

The game draws at full speed while you play and eases off when you step away: about 20 frames a second after 30 seconds without input (or when the window loses focus), 8 after 3 minutes, and none at all in a hidden tab. Music pauses with the tab. Income, the auto-builder and saves keep running on real time throughout, so a background tab still earns and builds. The Goals tab has a Performance setting, stored per device: **Auto** (the default), **Full** (always 60 fps) or **Battery saver** (standard resolution, no rain or glow pools, 30 fps while playing).

## Saving

- The game saves in the browser every 10 seconds and when you close it. While you're away the city keeps earning, for up to 8 hours.
- On claude.ai, a signed-in owner or contributor also gets a **cloud save**: a private copy on their account, written every minute. It loads automatically when it's newer than the browser copy. Visitors on a shared link can't write it and keep the browser copy.
- **Save codes** (Goals tab) copy the whole save as text to paste back later, on any device or in this file opened locally.

Saves from earlier versions load, with their first sector becoming the Capital.

Balance constants are at the top of the script. `window.neonSprawl` exposes the economy for testing from the console.
