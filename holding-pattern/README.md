# Holding Pattern

An idle game about running airports, not just building them. Planes land,
turn around and leave on their own; passengers drive in, queue for
security, ride to their gate and board. You decide what to build, which
airline routes to sign, and how to keep everything moving.

Open `dist/holding-pattern.html` in a browser. It is one self-contained
file and needs no server.

## How it plays

**Running costs, line by line.** Every terminal adds an air traffic
controller, ground crews for its gates, climate control and cleaning. Every
security lane has screeners, every shuttle bus has a driver, every parcel
of land pays property tax. The Finance tab shows each line per minute.
Growth pays as long as the new capacity is filled with routes.

**Contracts.** Airlines offer routes: aircraft type, flights per minute,
fee per passenger and a signing bonus. Each offer shows how it would load
your runway, the chosen terminal's gates, security, the connector to that
terminal and parking, before and after. Sign too much and the airport
clogs: arrivals circle in the holding stack, planes wait for gates,
passengers miss flights. Airlines whose on-time rate stays under 55% for
two minutes pull their route.

**Congestion, for planes and for people.**

| Where | What backs up | What fixes it |
|---|---|---|
| Runway | Arrivals hold west of the field; departures queue at the hold line | Approach radar, rapid-exit taxiways, tower automation, a second runway, more terminals (each adds a controller) |
| Gates | Aircraft park on the taxiway waiting for a stand | More gates, more terminals, faster ground crews |
| Security | The line spills out of the terminal onto the curb | More lanes, CT scanners, surge staffing |
| Connectors | Passengers pile up on the platforms | More buses, upgrades, a better connector |
| Terminals | Crowds above comfortable capacity spend less and hurt reputation | Spread routes across terminals |

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

## Development

    node build.mjs              build dist/holding-pattern.html
    node build.mjs --artifact   build the variant without the outer html/head/body
    node tools/bot.mjs 120      a greedy bot plays 120 minutes headless; prints the economy
    node tools/runway.mjs       measures real runway throughput against the model
    node tools/smoke.mjs        plays in headless Chromium, takes screenshots, fails on errors
    node tools/showcase.mjs     builds a busy airport in the browser and photographs it

`src/config.js` holds every balance number. `src/sim.js` is the simulation
and has no DOM dependency, which is what lets the bot run it under node.
`src/render.js` draws the field; `src/ui.js` is the panel and ops board.
