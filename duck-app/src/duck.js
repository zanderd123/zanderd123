// The Quackdex duck: a round, cartoon drake drawn in SVG.
//
// The same drawing is the animated Mallard logo, the loading-screen duck, and
// (tinted with each species' colours) the little portrait in the directory.
// Animation lives in styles.css under `.duck.is-animated`.

export const MALLARD = {
  head: "#1F7A4D", bill: "#F2C230", breast: "#7B3F24", body: "#C9CED3",
  ring: true, curl: true, speculum: true,
};

function hexToRgb(hex) {
  const h = hex.replace("#", "");
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16));
}

// Lighten (amt > 0) or darken (amt < 0) a colour.
export function shade(hex, amt) {
  const [r, g, b] = hexToRgb(hex);
  const f = (c) => Math.round(amt < 0 ? c * (1 + amt) : c + (255 - c) * amt);
  return "#" + [r, g, b].map((c) => f(c).toString(16).padStart(2, "0")).join("");
}

export function luminance(hex) {
  const [r, g, b] = hexToRgb(hex);
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
}

// One period of the wave is 20 units wide, so sliding the path left by
// exactly 20 units loops seamlessly.
function wavePath(y, amp) {
  let d = `M-40 ${y}`;
  for (let x = -40; x < 160; x += 20) d += ` q5 ${-amp} 10 0 t10 0`;
  return d + ` L160 90 L-40 90 Z`;
}

let duckSeq = 0;

export function duckSVG(opts = {}) {
  const o = { ...MALLARD, ring: false, curl: false, speculum: false, ...opts };
  const animated = !!o.animated;
  const water = o.water !== false && (animated || o.water);
  const tail = shade(o.body, -0.45);
  const wing = shade(o.body, -0.16);
  const darkHead = luminance(o.head) < 0.16;
  const id = `dk${++duckSeq}`;
  const label = o.label ? `<title>${o.label}</title>` : "";

  return `<svg class="duck${animated ? " is-animated" : ""}${o.className ? " " + o.className : ""}" viewBox="0 0 120 90" role="img"${o.label ? "" : ' aria-hidden="true"'} focusable="false">${label}
  <defs><clipPath id="${id}w"><rect x="-40" y="-10" width="200" height="${water ? 78 : 100}"/></clipPath>${water ? `
    <linearGradient id="${id}g"><stop offset="0" stop-color="#fff" stop-opacity="0"/><stop offset=".16" stop-color="#fff"/><stop offset=".84" stop-color="#fff"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></linearGradient>
    <mask id="${id}m" maskUnits="userSpaceOnUse" x="0" y="0" width="120" height="90"><rect x="0" y="0" width="120" height="90" fill="url(#${id}g)"/></mask>` : ""}</defs>
  <g class="duck-float">
    <g clip-path="url(#${id}w)">
      <g class="duck-tail">
        <path d="M20 50 C12 47 9 40 13 35 C17 42 24 44 30 44 Z" fill="${tail}"/>
        ${o.curl ? `<path d="M21 42 C17 36 22 32 25.5 35.5" fill="none" stroke="#1D1D1D" stroke-width="2.4" stroke-linecap="round"/>` : ""}
      </g>
      <path d="M18 54 C18 40 38 37 56 39 L80 41 C94 43 99 57 90 65 C80 73 36 73 26 66 C21 62 18 58 18 54 Z" fill="${o.body}"/>
      <path d="M74 41 C90 38 100 50 95 61 C92 67 84 69 78 67 C82 59 81 48 74 41 Z" fill="${o.breast}"/>
      <path d="M32 50 C42 41 64 42 74 51 C66 60 44 61 32 55 Z" fill="${wing}"/>
      ${o.speculum ? `<path d="M45 54.5 L60 55 L58.5 59 L46 58.5 Z" fill="#3D55C8" stroke="#FFFFFF" stroke-width="1"/>` : ""}
    </g>
    <g class="duck-head">
      <path d="M77 44 C77 35 79 29 83 25 L95 28 C93 34 91 40 91 47 Z" fill="${o.head}"/>
      ${o.ring ? `<path d="M78.3 40.5 C83 43.2 88 43.2 91.6 40.6" fill="none" stroke="#FFFFFF" stroke-width="2.4" stroke-linecap="round"/>` : ""}
      <circle cx="89" cy="22" r="13" fill="${o.head}"/>
      <ellipse cx="84.5" cy="16" rx="5.5" ry="3.2" fill="#FFFFFF" opacity=".2"/>
      <ellipse cx="92" cy="28.5" rx="3.3" ry="2" fill="#FF8FA3" opacity=".55"/>
      <g class="duck-eye">
        ${darkHead ? `<circle cx="93.5" cy="19" r="3.6" fill="#FFFFFF" opacity=".35"/>` : ""}
        <circle cx="93.5" cy="19" r="2.7" fill="#14202B"/>
        <circle cx="94.4" cy="18" r=".95" fill="#FFFFFF"/>
      </g>
      <path d="M100 19.5 C109 18.5 116 21 116.5 24.5 C116.8 27.5 110 28.8 101 27.6 C99.2 25.5 99.2 21.5 100 19.5 Z" fill="${o.bill}"/>
      <path d="M101 24.2 C106 24.8 111 25 116.2 24.6" fill="none" stroke="${shade(o.bill, -0.35)}" stroke-width=".8" stroke-linecap="round"/>
      <ellipse cx="114.6" cy="23.2" rx="1.5" ry="1.7" fill="${shade(o.bill, -0.45)}" opacity=".7"/>
    </g>
  </g>
  ${water ? `<g class="duck-water" mask="url(#${id}m)">
    <path class="wave wave-back" d="${wavePath(66, 2.6)}" fill="var(--wave-back, #8CC4E8)"/>
    <path class="wave wave-front" d="${wavePath(69, 2.2)}" fill="var(--wave-front, #0A6EBD)"/>
  </g>` : ""}
</svg>`;
}

// Portrait for a directory species, from its [head, bill, breast, body].
export function speciesDuck(sp, extra = {}) {
  const [head, bill, breast, body] = sp.colors.map((c) => "#" + c);
  const mallardLike = sp.id === "mallard" || sp.id === "rouen";
  return duckSVG({
    head, bill, breast, body,
    ring: mallardLike, curl: mallardLike, speculum: mallardLike,
    ...extra,
  });
}
