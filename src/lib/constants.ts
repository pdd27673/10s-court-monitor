export const VENUES = [
  { slug: "bethnal-green-gardens", name: "Bethnal Green Gardens" },
  { slug: "king-edward-memorial-park", name: "King Edward Memorial Park" },
  { slug: "poplar-rec-ground", name: "Poplar Rec Ground" },
  { slug: "ropemakers-field", name: "Ropemakers Field" },
  { slug: "st-johns-park", name: "St Johns Park" },
  { slug: "victoria-park", name: "Victoria Park" },
  { slug: "wapping-gardens", name: "Wapping Gardens" },
] as const;

export type VenueSlug = (typeof VENUES)[number]["slug"];
