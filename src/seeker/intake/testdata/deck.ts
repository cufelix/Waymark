import type { Occupation } from "../../contracts.ts";
import type { Deck } from "../deck.ts";

type PathKey = "backend" | "frontend" | "data" | "qa" | "ux" | "sales" | "marketing" | "ops";

const PATHS: { key: PathKey; label: string; kind: string }[] = [
  { key: "backend", label: "Backend developer", kind: "coding" },
  { key: "frontend", label: "Frontend developer", kind: "web building" },
  { key: "data", label: "Data analyst", kind: "data" },
  { key: "qa", label: "QA engineer", kind: "testing" },
  { key: "ux", label: "UX designer", kind: "design research" },
  { key: "sales", label: "Sales", kind: "sales" },
  { key: "marketing", label: "Marketing", kind: "marketing" },
  { key: "ops", label: "Project coordinator", kind: "organising" },
];

const occupations = Object.fromEntries(
  PATHS.map(({ key, label }) => [key, { uri: `urn:stub:occupation:${key}`, label, lang: "en" }]),
) as Record<PathKey, Occupation>;

const CARD_SPECS: { text: string; pathKey: PathKey; related?: Partial<Record<PathKey, number>> }[] = [
  { text: "Build the part of an app that saves a customer’s order and sends the receipt.", pathKey: "backend" },
  { text: "Find out why the website gets slow every Monday morning, and fix it.", pathKey: "backend", related: { qa: 0.5 } },
  { text: "Connect the online shop to a new payment provider.", pathKey: "backend" },
  { text: "Rebuild the signup page so it works on every phone.", pathKey: "frontend" },
  { text: "Turn a designer’s mockup into a working web page.", pathKey: "frontend", related: { ux: 0.5 } },
  { text: "Add a smooth animation when someone adds an item to the cart.", pathKey: "frontend" },
  { text: "Figure out why 30% of customers abandon checkout.", pathKey: "data", related: { ux: 0.3 } },
  { text: "Build a weekly sales dashboard the boss checks every Monday.", pathKey: "data" },
  { text: "Clean up a spreadsheet of 10,000 messy customer records.", pathKey: "data", related: { ops: 0.5 } },
  { text: "Try to break a new feature before it goes live, and write down exactly how you did it.", pathKey: "qa" },
  { text: "Test the app on 10 different phones and report everything that looks wrong.", pathKey: "qa" },
  { text: "Write a small script that checks the login page still works, every night.", pathKey: "qa", related: { backend: 0.5 } },
  { text: "Interview 5 users and find out why they get stuck on the settings page.", pathKey: "ux", related: { data: 0.3 } },
  { text: "Sketch three different layouts for a new home screen.", pathKey: "ux", related: { frontend: 0.3 } },
  { text: "Watch screen recordings of people using the app and spot what confuses them.", pathKey: "ux" },
  { text: "Call 20 small businesses and find out what they struggle with.", pathKey: "sales", related: { ux: 0.3 } },
  { text: "Give a 15 minute demo of the product to a potential client.", pathKey: "sales" },
  { text: "Follow up with a customer who went quiet, and win them back.", pathKey: "sales" },
  { text: "Write the posts for a product launch on Instagram and LinkedIn.", pathKey: "marketing" },
  { text: "Run two versions of an ad and work out which one works better.", pathKey: "marketing", related: { data: 0.5 } },
  { text: "Plan a month of content for the company blog.", pathKey: "marketing" },
  { text: "Plan a team offsite for 40 people: venue, travel, schedule.", pathKey: "ops" },
  { text: "Keep a project on track: who does what by when, and chase what’s late.", pathKey: "ops" },
  { text: "Set up a simple system so customer requests stop getting lost.", pathKey: "ops", related: { backend: 0.2 } },
];

const shownByPath = Object.fromEntries(PATHS.map(({ key }) => [key, 0])) as Record<PathKey, number>;

// Deliberately fake and independent of decks/cz.json, which the real deck builder will replace later.
export const FAKE_DECK: Deck = {
  country: "CZ",
  version: "fake-0",
  paths: PATHS.map(({ key, kind }) => ({ key, occupation: occupations[key], kind })),
  cards: CARD_SPECS.map(({ text, pathKey, related = {} }, index) => {
    shownByPath[pathKey] += 1;
    const suffix = String(index + 1).padStart(26, "0");
    return {
      cardId: `crd_${suffix}`,
      text,
      occupation: occupations[pathKey],
      related: Object.entries(related).map(([key, weight]) => ({ occupation: occupations[key as PathKey], weight })),
      pathKey,
      source: {
        id: `src_${suffix}`,
        url: `https://example.com/jobs/${pathKey}-${shownByPath[pathKey]}`,
        title: `[FAKE] ${occupations[pathKey].label} ad`,
        fetchedAt: "2026-10-09T00:00:00Z",
        tool: "exa",
        quote: text,
        contentHash: "0".repeat(64),
      },
    };
  }),
};
