export type AccessKind = "keypad" | "receipt" | "ask" | "open";

export type Category =
  | "coffee" | "restaurant" | "fastfood" | "bakery" | "bar"
  | "grocery" | "gas" | "retail" | "other";

export const CATEGORY_LABEL: Record<Category, string> = {
  coffee: "Coffee shop", restaurant: "Restaurant", fastfood: "Fast food", bakery: "Bakery",
  bar: "Bar", grocery: "Grocery store", gas: "Gas station", retail: "Store", other: "Place",
};
export const FOOD: Category[] = ["coffee", "restaurant", "fastfood", "bakery", "bar"];

export interface CodeEntry {
  id: string;
  kind: AccessKind;
  code: string | null;     // only for keypad
  note: string | null;
  addedAt: string;         // ISO time
  addedBy: string | null;  // display name, null if the account was deleted
  worked: number;
  failed: number;
  lastConfirmed: string | null;
}

/** A place as the map needs it: the current code only. */
export interface PlaceSummary {
  id: string;
  name: string;
  category: Category;
  address: string | null;
  lat: number;
  lng: number;
  current: CodeEntry | null;
  /** the business asked for its code to be removed; no new codes allowed */
  locked?: boolean;
}

export interface PlaceDetail extends PlaceSummary {
  history: { code: string | null; kind: AccessKind; addedAt: string }[];
  myVote: boolean | null;  // true worked, false didn't, null not voted
}

export interface Profile {
  id: string;
  displayName: string;
  createdAt: string;
  codesAdded: number;
  confirmations: number;
}

export interface Bounds { minLat: number; minLng: number; maxLat: number; maxLng: number }

export type ReportReason = "wrong" | "private" | "closed" | "abuse" | "business";

export interface NewCode {
  placeId?: string;
  newPlace?: { name: string; category: Category; lat: number; lng: number; address?: string };
  kind: AccessKind;
  code?: string;
  note?: string;
}
