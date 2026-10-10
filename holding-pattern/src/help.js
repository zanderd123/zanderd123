// The Help tab: how the airport works, and how one thing leads to another.
// Static text; the numbers that matter come from config so they stay true.

import { FLIGHT, PAX, CONTRACTS, COSTS, UNLOCKS, LEVELS } from './config.js';

const sec = (t) => `<h3 class="sec">${t}</h3>`;

export function helpHtml() {
  return `
  <p class="note">Planes and passengers come by themselves. Your job is to keep them moving and to make sure each thing you build pays for its running costs.</p>

  ${sec('A passenger\'s trip')}
  <ol class="flow">
    <li><b>Curb & car park</b><span>Departing passengers arrive about ${PAX.arriveEarly}s before their flight. Drivers pay for parking if there is space.</span></li>
    <li><b>Security</b><span>Every departing passenger goes through the checkpoint in the main terminal (A). Each lane screens a fixed number per minute.</span></li>
    <li><b>Connector</b><span>For a gate in any other terminal they then ride the walkway, bus, monorail or tunnel to it.</span></li>
    <li><b>Gate lounge</b><span>They wait and shop. Waiting passengers are your shop income; crowds spend less.</span></li>
    <li><b>Boarding</b><span>The plane waits up to ${FLIGHT.boardingGrace}s past its departure time for latecomers, then leaves without them. Each passenger it leaves behind is refunded.</span></li>
  </ol>

  ${sec('A plane\'s trip')}
  <ol class="flow">
    <li><b>Approach</b><span>A plane lands only when the runway has a slot, a controller is free, and a gate is free at its terminal. Otherwise it circles in the holding stack west of the field.</span></li>
    <li><b>Taxi in</b><span>Taxiways are one-way (the yellow arrows), and aircraft wait for each other at junctions.</span></li>
    <li><b>Turnaround</b><span>Passengers get off, the plane is serviced, passengers board. Ground crews set the pace.</span></li>
    <li><b>Push back & take off</b><span>It is on time if it pushes back within ${FLIGHT.onTimeSlack}s of schedule.</span></li>
  </ol>

  ${sec('What causes what')}
  <table class="cause">
    <tr><th>If this happens</th><th>…this follows</th></tr>
    <tr><td>Too many routes for the <b>runway or tower</b></td><td>Planes circle, land late, leave late. Every route's on-time score drops at once.</td></tr>
    <tr><td>Too many routes for a terminal's <b>gates</b></td><td>Planes can't land until a gate frees up, so they circle. Their passengers wait longer and crowd the terminal.</td></tr>
    <tr><td>A long <b>security line</b></td><td>Passengers reach the gate late or miss the flight: refunds, a worse reputation, slower boarding, delays.</td></tr>
    <tr><td>A slow or full <b>connector</b></td><td>Same as security, but only for that terminal's flights.</td></tr>
    <tr><td>Flights often late</td><td>An airline under ${Math.round(CONTRACTS.unhappyOtp * 100)}% on time for ${CONTRACTS.leaveAfter}s pulls its route, and its income goes with it.</td></tr>
    <tr><td>Low reputation</td><td>Passenger fees shrink and new offers pay less.</td></tr>
  </table>
  <p class="note"><b>Fix the cause, not the symptom.</b> A long security line is often caused by planes that are late because the runway or gates are full. When that happens, passengers bunch up. The Advisor tab tells you which it is.</p>

  ${sec('Money')}
  <ul class="plain">
    <li><b>You earn</b> a landing fee per landing, a fee per boarding passenger, shop income while passengers wait, and parking.</li>
    <li><b>You pay every second</b> for controllers (one per runway and one per terminal), security staff per lane, ground crews per gate, climate control and cleaning per terminal, connector running costs, runway upkeep, and property tax on land.</li>
    <li>A new terminal adds about $${((COSTS.controller + COSTS.hvacBase + COSTS.cleaningBase + 3 * (COSTS.groundCrewPerGate + COSTS.hvacPerGate)) / 60).toFixed(1)}/s in running costs before any connector. It pays once routes fill its gates.</li>
    <li>If you are losing money, the Advisor shows the biggest bill and what to trim.</li>
  </ul>

  ${sec('Building')}
  <ul class="plain">
    <li><b>Gates</b>: click a terminal on the map, then <i>Add a gate</i>.</li>
    <li><b>Heavy gates</b>: widebodies and superjumbos need them. Click a terminal, then <i>Heavy gates → Convert</i>. An offer that needs them shows the button too.</li>
    <li><b>New terminals</b>: click a dashed <i>+ Build terminal</i> site. If there is none, buy farmland around the field (Build tab, Land).</li>
    <li><b>Connectors</b>: walkways are cheap but slow and only reach the piers next to A. Buses start at once but cost a lot to run and make planes stop where they cross the apron. A monorail is fast but uses car-park land and sometimes breaks down. A tunnel costs the most and takes longest to build, then runs cheaply with nothing in the way.</li>
    <li><b>Staffing</b> (Operations tab): lean saves wages and slows things down; surge costs more and speeds them up.</li>
  </ul>

  ${sec('Growing')}
  <ul class="plain">
    <li>Levels come from passengers served (${LEVELS.slice(1, 5).map((v) => v.toLocaleString('en-US')).join(', ')}…). Narrowbody routes appear at level ${UNLOCKS.narrow}, widebodies at ${UNLOCKS.wide}, superjumbos at ${UNLOCKS.jumbo}.</li>
    <li>At level ${UNLOCKS.nextAirport} the <b>Network map</b> sells you a second airport. Your first keeps earning; the new one earns more per passenger. Every airport you own adds passengers to all the others.</li>
  </ul>

  <div class="btns"><button type="button" class="btn" data-act="tutorial">Replay the tutorial</button></div>`;
}
