# WayMark UI prototype

Clickable prototype of the full user flow, plain HTML, CSS and JS. No build step: open `index.html` in a browser.

| File | Screen |
|---|---|
| `index.html` | 1. Interview: warm up questions, task cards, practical bits, optional CV and links |
| `research.html` | 2. Live research feed while the agent works |
| `paths.html` | 3. Top 3 career paths, with a "What's this job like?" drawer |
| `roadmap.html` | 4. Isometric roadmap: sections, then numbered module tiles |
| `module.html` | Module page: why it matters, top pick, curated resources, mark as done |

Flow: interview → research feed → top 3 paths → roadmap → module.

`styles.css` holds the design tokens (colours, fonts) in `:root`. `app.js` holds the shared header, bottom step bar, icons and the isometric tile (`TILE_RADIUS` sets the corner rounding). `brand/` has the WayMark logo files.

All numbers, companies and the persona are sample data. Salaries and paid prices are placeholders.

## UI decisions

**Shell**
- WayMark logo in the header. Steps (Interview, Research, Paths, Roadmap) sit in a fixed bottom bar with Lucide icons and wavy dotted connectors; during the interview the active pill also shows the current part.
- Every button is a pill.

**Interview**
- First screen: Talk it through (voice) or Just tap. Voice mode is a full screen with a pulsing orb, no questions on screen, optional captions, and a floating bar with status and "Switch to tapping". Prototype uses the browser voice; the real product uses ElevenLabs (swap `say()` in `index.html`).
- Warm up: 3 questions, bubbles plus a pill shaped free text field. Answered questions shrink so the newest one stands out.
- "Now the fun part" screen, then task cards from real job ads rated 👎 / 🤷 / 😍. Cards sit in a visible stack and swipe down when answered. The agent picks each next card to separate the paths it is least sure about and stops once the top 3 are clear.
- Practical bits (location, hours, budget, education, languages you can work in, companies you'd love to work for), then optional CV and links, then straight into the research feed. Languages and dream companies are required by the research (Part 2 researches each dream company).
- A one line plain note shows what is left ("About 5 cards left"). "What I know" is a slim chip row with dividers.
- "Your map" is a small floating thumbnail bottom right that eases open on hover or click and closes on click outside.

**Paths**
- Cards in order of importance: path name, the evidence ("You liked 4 of 5 coding tasks") as the highlight, the market, your head start. "Choose this path" is the main button, "What's this job like?" an underlined link that opens a centred modal.
- "Not feeling any of these?" with "Show me 4 more tasks".
- No match percentage or hiring chance anywhere.

**Roadmap**
- Sections in prerequisite order, numbered isometric tiles with rounded corners (radius 12). Skills you already have show as "You've got this".
- A transit style line with straight runs and rounded turns; labels sit on the outer side of each tile so the line never crosses text.
- Progress and the legend live in a small "2 of 16 done" pill bottom right.

**Module**
- "After this you can" is the highlight, then why it matters, a top pick and curated resources (free first), then "Mark as done".
