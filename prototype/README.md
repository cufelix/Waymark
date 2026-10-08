# UI prototype

Clickable prototype of the full user flow, plain HTML, CSS and JS. No build step: open `index.html` in a browser.

| File | Screen |
|---|---|
| `index.html` | 1. Interview: warm up questions, task cards, practical bits, optional CV and links |
| `research.html` | 2. Live research feed while the agent works |
| `paths.html` | 3. Top 3 career paths, with a "What's this job like?" drawer |
| `roadmap.html` | 4. Isometric roadmap: sections, then numbered module tiles |
| `module.html` | Module page: why it matters, top pick, curated resources, mark as done |

Flow: interview → research feed → top 3 paths → roadmap → module.

`styles.css` holds the design tokens (colours, fonts) in `:root`. `app.js` holds the shared header, icons and the isometric tile.

All numbers, companies and the persona are sample data. Salaries and paid prices are placeholders.

## UI decisions

- Interview in four steps with a "what to expect" tracker and a live count of what's left:
  1. Warm up: 3 questions (what pulls you in; people, things, information or ideas; what matters right now). Bubbles plus free text.
  2. A "Now the fun part" screen, then task cards from real job ads rated 👎 Not for me / 🤷 Maybe / 😍 I'd enjoy this. The agent picks each next card to separate the paths it is least sure about and stops once the top 3 are clear (8 to 12 cards).
  3. Practical bits: location, hours per week, course budget, education.
  4. Optional CV and links, then straight into the research feed.
- Side panel: "What I know about you" on top, then "Your map", an Obsidian style graph. You in the centre, paths pull closer as they fit better, and every rated task attaches to its path.
- Path cards cite the evidence ("You liked 4 of 5 coding tasks"). "None of these feel right" runs 4 more cards.
- No match percentage or hiring chance on the path cards. Cards show why you, head start, market demand and time to job ready.
- Roadmap: sections in prerequisite order, each split into modules. Skills the user already has stay visible as "You've got this" with a "Review it" option.
- Modules point to curated resources (free first). Completion is a self tick, not a proof gate.
- Isometric tiles come from a fixed library tagged by category; numbered tiles are the fallback.
- Desktop first (1440px), mobile next.
