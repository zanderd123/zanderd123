// Notebook look: white paper, black ink, the red margin line doubles as the "has a code" colour.
export const colors = {
  paper: "#ffffff",
  paper2: "#f6f6f3",
  ink: "#111111",
  ink2: "#4a4a48",
  ink3: "#8c8c88",
  rule: "#e4e6ea",
  margin: "#d7263d",
  marginSoft: "#fbe3e6",
  stalePin: "#f2a3ad",
  open: "#1f9d55",       // green pin: restroom with no code needed
  openSoft: "#a9dcbd",   // green pin that may be out of date
  openTint: "#e3f4e9",
  ok: "#1f7a4d",
  warn: "#9a6400",
};

export const fonts = {
  hand: "Kalam_700Bold",
  body: "AtkinsonHyperlegible_400Regular",
  bodyBold: "AtkinsonHyperlegible_700Bold",
  code: "JetBrainsMono_700Bold",
};

export const space = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 };

// Hard offset shadow, like a pen drawing. Android has no offset shadows, so a
// second view draws it in <Ink> instead.
export const RULE_GAP = 32;
export const MARGIN_X = 40;

// Grayscale Google Maps style (Android). iOS uses Apple Maps "mutedStandard".
export const mapStyle = [
  { elementType: "geometry", stylers: [{ color: "#f7f7f5" }] },
  { elementType: "labels.icon", stylers: [{ visibility: "off" }] },
  { elementType: "labels.text.fill", stylers: [{ color: "#4a4a48" }] },
  { elementType: "labels.text.stroke", stylers: [{ color: "#ffffff" }] },
  { featureType: "poi", stylers: [{ visibility: "off" }] },
  { featureType: "transit", stylers: [{ visibility: "off" }] },
  { featureType: "road", elementType: "geometry", stylers: [{ color: "#ffffff" }] },
  { featureType: "road", elementType: "geometry.stroke", stylers: [{ color: "#c9c9c5" }] },
  { featureType: "road.highway", elementType: "geometry", stylers: [{ color: "#e9e9e6" }] },
  { featureType: "water", elementType: "geometry", stylers: [{ color: "#e4e6ea" }] },
  { featureType: "administrative", elementType: "geometry.stroke", stylers: [{ color: "#8c8c88" }] },
];
