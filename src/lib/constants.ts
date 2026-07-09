import type { Venue, VenueType } from "@pdd27673/10s-contract";

export type { Venue, VenueType };

export const VENUES: Venue[] = [
  // Courtside platform (Tower Hamlets)
  { slug: "bethnal-green-gardens", name: "Bethnal Green Gardens", type: "courtside" },
  { slug: "ropemakers-field", name: "Ropemakers Field", type: "courtside" },
  { slug: "st-johns-park", name: "St Johns Park", type: "courtside" },
  { slug: "victoria-park", name: "Victoria Park", type: "courtside" },

  // ClubSpark platform (LTA venues)
  {
    slug: "stratford-park",
    name: "Stratford Park",
    type: "clubspark",
    clubsparkId: "stratford_newhamparkstennis_org_uk",
    clubsparkHost: "stratford.newhamparkstennis.org.uk",
  },
  {
    slug: "west-ham-park",
    name: "West Ham Park",
    type: "clubspark",
    clubsparkId: "WestHamPark",
    clubsparkHost: "clubspark.lta.org.uk",
  },
];
