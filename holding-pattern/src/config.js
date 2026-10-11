// Every balance number in the game lives here, so tuning never means hunting
// through simulation code. Money is dollars, time is real seconds, rates are
// per minute unless the name says otherwise.

export const WORLD = { w: 2000, h: 1150 };

// ---------------------------------------------------------------- aircraft
export const AIRCRAFT = {
  regional: { name: 'Regional jet', short: 'RJ', pax: 60, turn: 42, landingFee: 330, scale: 0.55, heavy: false, longRunway: false, paxFeeMult: 1.0, exitIndex: 0 },
  narrow:   { name: 'Narrowbody',   short: 'NB', pax: 150, turn: 60, landingFee: 780, scale: 0.72, heavy: false, longRunway: false, paxFeeMult: 1.1, exitIndex: 1 },
  wide:     { name: 'Widebody',     short: 'WB', pax: 290, turn: 86, landingFee: 2000, scale: 0.88, heavy: true, longRunway: false, paxFeeMult: 1.45, exitIndex: 2 },
  jumbo:    { name: 'Superjumbo',   short: 'SJ', pax: 500, turn: 112, landingFee: 4300, scale: 1.0, heavy: true, longRunway: true, paxFeeMult: 1.7, exitIndex: 2 },
};
export const AIRCRAFT_ORDER = ['regional', 'narrow', 'wide', 'jumbo'];

// ---------------------------------------------------------------- flying
export const FLIGHT = {
  approachSpeed: 210,    // px/s on final
  cruiseSpeed: 260,      // px/s inbound to the fix and in the hold
  touchdownSpeed: 190,
  exitSpeed: 60,         // speed at which a plane turns off the runway
  exitSpeedRapid: 100,   // with rapid-exit taxiways
  taxiSpeed: 62,
  pushSpeed: 16,
  takeoffAccel: 150,     // px/s²
  liftoffSpeed: 250,
  holdRadius: 95,
  gateHeadway: 3,        // seconds between flight arrival and the next
  onTimeSlack: 15,       // seconds past STD that still count as on time (the airline "15 minutes")
  boardingGrace: 22,     // seconds past STD a plane waits for late passengers
  scheduleBuffer: 5,     // airlines pad the inbound leg by this much
};

// ---------------------------------------------------------------- people
export const PAX = {
  arriveEarly: 95,       // departing pax start showing up this long before STD
  arriveWindow: 50,      // ...spread over this many seconds
  securityPerLane: 2.2,  // pax/s per lane at standard staffing
  terminalComfortPerGate: 140, // pax a terminal holds comfortably, per gate
  exitTime: 4,
  missedRefund: 10,      // paid back per passenger who misses a flight
  retailPerPaxSec: 0.14, // $ per departing passenger per second in a terminal
  parkingPerPax: 1.6,    // $ per departing passenger who drives
  driveShare: 0.55,
};

// ---------------------------------------------------------------- staff
// Policies trade cost against capacity. Each applies to one department.
export const STAFFING = {
  lean:     { label: 'Lean',     cost: 0.75, capacity: 0.78, turn: 1.18 },
  standard: { label: 'Standard', cost: 1.0,  capacity: 1.0,  turn: 1.0 },
  surge:    { label: 'Surge',    cost: 1.4,  capacity: 1.25, turn: 0.86 },
};

export const COSTS = {
  controller: 95,        // $/min per air traffic controller
  movementsPerController: 4.6, // runway movements/min one controller can sequence
  securityLaneStaff: 45, // $/min per open lane
  groundCrewPerGate: 18,
  hvacBase: 40,          // $/min per terminal
  hvacPerGate: 11,
  cleaningBase: 30,
  cleaningPerPaxMin: 0.08, // $ per passenger/min flowing through
  runwayMaint: 55,
  plotTax: 14,           // $/min per purchased land parcel
};

// ---------------------------------------------------------------- terminals
export const TERMINAL = {
  baseCost: 32000,
  costGrowth: 1.72,      // each additional terminal at the same airport
  buildTime: 15,
  startGates: 3,
  gateCost: 7000,        // per added gate, grows with gate count
  gateCostGrowth: 1.35,
  heavyCost: 26000,      // converts every gate in a terminal to heavy gates
  retailLevels: [
    { mult: 1.0, cost: 0 },
    { mult: 1.6, cost: 9000 },
    { mult: 2.4, cost: 36000 },
    { mult: 3.5, cost: 140000 },
    { mult: 5.0, cost: 520000 },
  ],
};

// How passengers get between the main terminal and a satellite terminal.
// cap is passengers per second in each direction. speed is px/s along the
// route. land is parking capacity (pax/min) the connector's depot or pylons
// displace.
export const CONNECTORS = {
  walkway: {
    name: 'Covered walkway',
    blurb: 'A glazed corridor. Cheap and almost free to run, but slow and narrow. Only reaches terminals right next to the main building.',
    buildBase: 6000, buildPerPx: 10, upkeep: 15, cap: 2.6, speed: 38, buildTime: 6, land: 0,
    adjacentOnly: true, apron: false, breakdown: 0,
    upgrade: { name: 'Moving walkways', cost: 14000, cap: 1.6, speed: 1.6, upkeep: 20 },
  },
  shuttle: {
    name: 'Shuttle buses',
    blurb: 'No construction, running the next minute. Drivers and fuel are expensive, and buses crossing the apron make taxiing aircraft stop for them.',
    buildBase: 4000, buildPerPx: 0, upkeep: 0, cap: 0, speed: 95, buildTime: 3, land: 25,
    adjacentOnly: false, apron: true, breakdown: 0,
    bus: { cost: 3500, upkeep: 52, seats: 40, dwell: 4, max: 10 },
  },
  monorail: {
    name: 'Elevated monorail',
    blurb: 'Fast and high capacity. The pylons and maintenance yard eat into car parking, and trains occasionally break down unless you fund preventive maintenance.',
    buildBase: 30000, buildPerPx: 70, upkeep: 85, cap: 7.5, speed: 175, buildTime: 20, land: 60,
    adjacentOnly: false, apron: false, breakdown: 0.09, // chance per minute
    upgrade: { name: 'Preventive maintenance', cost: 30000, cap: 1.25, speed: 1, upkeep: 40, noBreakdown: true },
  },
  tunnel: {
    name: 'Underground tunnel',
    blurb: 'The most expensive to dig and the slowest to build. Once open it needs no land, crosses nothing, and costs little to run.',
    buildBase: 60000, buildPerPx: 150, upkeep: 22, cap: 11, speed: 105, buildTime: 45, land: 0,
    adjacentOnly: false, apron: false, breakdown: 0,
    upgrade: { name: 'Underground people mover', cost: 160000, cap: 1.8, speed: 2.1, upkeep: 60 },
  },
};
export const CONNECTOR_ORDER = ['walkway', 'shuttle', 'monorail', 'tunnel'];

// ---------------------------------------------------------------- airfield
export const UPGRADES = {
  radar:      { name: 'Approach radar',        cost: 18000,  desc: 'Each controller sequences 25% more movements.', atc: 1.25 },
  rapidExits: { name: 'Rapid-exit taxiways',   cost: 22000,  desc: 'Landing aircraft turn off the runway sooner and faster.' },
  hvac:       { name: 'Efficient HVAC',        cost: 15000,  desc: 'Cuts terminal climate-control bills by 35%.', hvac: 0.65 },
  solar:      { name: 'Solar canopies',        cost: 60000,  desc: 'Cuts terminal energy bills by another 30%.', hvac: 0.7, needs: 'hvac' },
  automation: { name: 'Tower automation',      cost: 95000,  desc: 'Controllers sequence another 30% more movements.', atc: 1.3, needs: 'radar' },
  cat3:       { name: 'CAT III landing system', cost: 70000, desc: 'Storms only cut runway capacity by 10% instead of 40%.' },
  ctScanners: { name: 'CT security scanners',  cost: 40000,  desc: 'Each security lane screens 40% more passengers.', security: 1.4 },
  longRunway: { name: 'Runway extension',      cost: 110000, desc: 'Lets superjumbos land and take off.', needsPlot: 'east' },
  runway2:    { name: 'Second runway',         cost: 260000, desc: 'A north runway for arrivals; departures keep the main one. Arrivals must cross the main runway.', needsPlot: 'north' },
  rail:       { name: 'Rail link',             cost: 220000, desc: 'A train station: +12% passenger fees and less driving.', paxFee: 1.12, needsPlot: 'south' },
};
export const UPGRADE_ORDER = ['radar', 'rapidExits', 'hvac', 'ctScanners', 'solar', 'cat3', 'automation', 'longRunway', 'rail', 'runway2'];

export const SECURITY = { laneCost: 3000, laneGrowth: 1.18, maxLanes: 14, startLanes: 2 };
// Car parks. Every parcel of land has room for one, next to or in front of
// the terminals (see PARKING_SITES in layout.js). A surface lot is cheap; a
// garage stacks levels on top of it. The front lot comes with the airport.
// cap is drivers a minute, upkeep $/min.
export const PARKING = {
  base: 140, // the front lot you start with
  lot:    { name: 'Surface car park', cost: 14000, cap: 90,  upkeep: 6 },
  garage: { name: 'Parking garage',   cost: 55000, cap: 220, upkeep: 20 },
};

// ---------------------------------------------------------------- levels
// Passengers served (both directions) to reach each airport level.
export const LEVELS = [0, 800, 2500, 6000, 14000, 32000, 70000, 150000, 320000, 700000, 1500000];
export const UNLOCKS = {
  narrow: 2,     // contracts for this class appear from this level
  wide: 3,
  jumbo: 5,
  nextAirport: 4,
};

// ---------------------------------------------------------------- the world
// Each new airport grows faster: revenue scales harder than costs do.
export const SITES = [
  { id: 'PWR', name: 'Pinewood Regional',   x: 0.22, y: 0.36, rev: 1.0,  cost: 1.0, demand: 1.0,  price: 0 },
  { id: 'BSI', name: 'Bayside International', x: 0.38, y: 0.62, rev: 1.7,  cost: 1.3, demand: 1.15, price: 75000 },
  { id: 'HMA', name: 'High Mesa',           x: 0.13, y: 0.72, rev: 2.9,  cost: 1.7, demand: 1.3,  price: 650000 },
  { id: 'HBC', name: 'Harbor City',         x: 0.58, y: 0.40, rev: 4.9,  cost: 2.25, demand: 1.45, price: 3.2e6 },
  { id: 'NGT', name: 'Northgate',           x: 0.47, y: 0.14, rev: 8.3,  cost: 3.0, demand: 1.6,  price: 1.6e7 },
  { id: 'CRL', name: 'Coral Coast',         x: 0.78, y: 0.70, rev: 14,   cost: 4.0, demand: 1.75, price: 8e7 },
  { id: 'MRD', name: 'Meridian Hub',        x: 0.84, y: 0.26, rev: 24,   cost: 5.3, demand: 1.9,  price: 4e8 },
];
export const NETWORK = {
  paxFeePerAirport: 0.06, // passive fee bonus at every airport per other owned airport
  routeFeeBonus: 1.35,    // network contracts pay this multiple
};

// ---------------------------------------------------------------- contracts
export const CONTRACTS = {
  offerEvery: 35,       // seconds between offers at an airport (before demand)
  maxOffers: 3,
  offerLife: 100,
  freq: { regional: [0.5, 1.1], narrow: [0.35, 0.85], wide: [0.22, 0.5], jumbo: [0.14, 0.3] },
  paxFee: [10, 17],
  load: [0.72, 0.95],
  unhappyOtp: 0.45,     // airlines below this on-time rate grow unhappy...
  leaveAfter: 150,      // ...and leave after this many seconds of it
  cancelPenaltyMins: 3, // breaking a contract costs this many minutes of its revenue
};

export const AIRLINES = [
  { name: 'Cedar Air', code: 'CD', color: '#2f8f5b' },
  { name: 'Polaris', code: 'PL', color: '#2c5fb8' },
  { name: 'Bluefin Airways', code: 'BF', color: '#1d8fb0' },
  { name: 'Kestrel', code: 'KS', color: '#c4572b' },
  { name: 'Atlas Pacific', code: 'AP', color: '#7a3fb0' },
  { name: 'Sundial', code: 'SD', color: '#e0a21b' },
  { name: 'Northwind', code: 'NW', color: '#4a6b82' },
  { name: 'Crimson Jet', code: 'CJ', color: '#c22f45' },
  { name: 'Tern Express', code: 'TX', color: '#d97a9a' },
  { name: 'Aurora International', code: 'AU', color: '#159e8f' },
  { name: 'Lumen Air', code: 'LA', color: '#a58c2a' },
  { name: 'Ironwood', code: 'IW', color: '#6b4a32' },
];

export const CITIES = {
  regional: ['Fresno', 'Boise', 'Spokane', 'Duluth', 'Bend', 'Asheville', 'Bozeman', 'Moncton', 'Kelowna', 'Billings', 'Eugene', 'Erie', 'Fargo', 'Medford'],
  narrow: ['Denver', 'Chicago', 'Seattle', 'Atlanta', 'Phoenix', 'Toronto', 'Dallas', 'Las Vegas', 'Minneapolis', 'Mexico City', 'Montreal', 'Orlando', 'Nashville', 'Calgary'],
  wide: ['London', 'Tokyo', 'Frankfurt', 'Seoul', 'Paris', 'Amsterdam', 'Honolulu', 'Madrid', 'São Paulo', 'Sydney', 'Taipei', 'Zurich'],
  jumbo: ['Dubai', 'Singapore', 'Hong Kong', 'Doha', 'Shanghai', 'Johannesburg', 'Delhi'],
};

export const WEATHER = {
  stormEvery: [240, 420],
  stormLength: [45, 80],
  stormRunway: 0.6,      // runway & ATC throughput multiplier during a storm
  stormRunwayCat3: 0.9,
};

export const START = { cash: 50000 };
export const OFFLINE = { maxSeconds: 8 * 3600, efficiency: 0.6 };
