# Holding Pattern

An idle game about running airports, not just building them. Planes land,
turn around and leave on their own; passengers drive in, queue for
security, ride to their gate and board. You decide what to build, which
airline routes to sign, and how to keep everything moving.

Open `dist/holding-pattern.html` in a browser. It is one self-contained
file and needs no server.

## How it plays

**Learning it.** A one-minute tutorial runs on first play (replay it from
Help). The **Advisor** tab names the real bottleneck, explains what it is
doing to the airport, and puts the cheapest fix one click away; its *Best
next step* is always a safe purchase. Items it recommends are tagged in the
Build and Staff tabs too. **Help** explains how a passenger and a plane
move through the airport and what causes what.

**Running costs, line by line.** Every terminal adds an air traffic
controller, ground crews for its gates, climate control and cleaning. Every
security lane has screeners, every shuttle bus has a driver, every parcel
of land pays property tax. Money runs per second; the Money tab shows each
line. If you are losing money, a red *why?* button opens the Advisor.
Growth pays as long as the new capacity is filled with routes.

**Contracts.** Airlines offer routes: aircraft type, flights per minute,
fee per passenger and a signing bonus. Each offer shows how it would load
your runway, the chosen terminal's gates, security, the connector to that
terminal and parking, before and after; signing one that overloads
anything asks you to confirm. Offers you can't take yet (widebodies need
heavy gates) show the button that unlocks them. Sign too much and the airport
clogs: arrivals circle in the holding stack, passengers miss flights (the
alert says where they got stuck). Airlines whose on-time rate stays under 45% for
two and a half minutes pull their route.

**Congestion, for planes and for people.**

| Where | What backs up | What fixes it |
|---|---|---|
| Runway | Arrivals hold west of the field; departures queue at the hold line | Approach radar, rapid-exit taxiways, tower automation, a second runway, more terminals (each adds a controller) |
| Gates | Aircraft circle until a gate at their terminal is free | More gates, more terminals, faster ground crews |
| Security | The line spills out of the terminal onto the curb | More lanes, CT scanners, surge staffing |
| Connectors | Passengers pile up on the platforms | More buses, upgrades, a better connector |
| Terminals | Crowds above comfortable capacity spend less and hurt reputation | Spread routes across terminals |
| Car parks | Drivers who find no space pay nothing | A surface lot on any parcel of land you own, then a garage on top |

**Connectors.** A new terminal needs a way for passengers to reach it from
security in the main terminal:

| | Build | Running | Capacity | Catch |
|---|---|---|---|---|
| Covered walkway | Cheap | Almost free | Low, slow | Only reaches the piers next to the main terminal |
| Shuttle buses | Cheapest, instant | Expensive: drivers and fuel per bus | Scales with buses | Buses crossing the apron stop taxiing aircraft; the depot takes parking |
| Elevated monorail | Expensive | Moderate | High, fast | Pylons and the yard take parking; breaks down without maintenance |
| Underground tunnel | Most expensive, slowest to build | Low | Highest | None once it is open |

**No restart.** At level 4 the network map offers your next airport. Every
airport keeps running when you leave it, each new one earns more per
passenger than the last, and every airport you own adds connecting
passengers to all the others. Network routes between your own airports pay
a premium.

**Ground traffic.** Taxiways are one-way (the yellow arrows). Every taxiing
aircraft looks ahead along its route and stops short of any other;
junctions are locks that nobody enters without room to get out the other
side; at merges the aircraft nearer the meeting point goes first; ground
control limits how many aircraft taxi at once; and a plane lands only when
its gate is free. If two aircraft ever end up nose to nose, the newer one
is towed back a few metres.

## Development

    node build.mjs              build dist/holding-pattern.html
    node build.mjs --artifact   build the variant without the outer html/head/body
    node tools/bot.mjs 120      a greedy bot plays 120 minutes headless; prints the economy
    node tools/runway.mjs       measures real runway throughput against the model
    node tools/traffic.mjs 15   stress-tests ground traffic on four layouts; fails on any
                                overlap or gridlock (SEED=n for other random seeds)
    node tools/perf.mjs         times one simulation step on a comfortable and an overbooked airport
    node tools/smoke.mjs        plays in headless Chromium, takes screenshots, fails on errors
    node tools/showcase.mjs     builds a busy airport in the browser and photographs it

`src/config.js` holds every balance number. `src/sim.js` is the simulation
and has no DOM dependency, which is what lets the bot run it under node.
`src/render.js` draws the field; `src/ui.js` is the panel and ops board.
