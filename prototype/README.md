# WayMark UI prototype

Plain HTML, CSS and JS for the full user flow. The live pages call the API through `/ui/api`; add `?sample=1` to use the deliberately fictional offline demo.

| File | Screen |
|---|---|
| `index.html` | 1. Interview: warm up questions, task cards, practical bits, optional CV and links |
| `research.html` | 2. Live research feed while the agent works |
| `paths.html` | 3. Top 3 career paths, with a "What's this job like?" drawer |
| `roadmap.html` | 4. Isometric roadmap: learning sections and chapter tiles |
| `module.html` | Module page: why it matters, top pick, curated resources, mark as done |

Flow: interview → research feed → top 3 paths → roadmap → module.

`styles.css` holds the design tokens (colours, fonts) in `:root`. `app.js` holds the shared header, bottom step bar, icons and the isometric tile (`TILE_RADIUS` sets the corner rounding). `brand/` has the WayMark logo files.

Live mode renders only API data. Offline sample data lives in `sample.js`, uses Jane Example, Example Labs and `example.com`, and is reachable only with `?sample=1`.

## UI decisions

**Shell**
- WayMark logo in the header. Steps (Interview, Research, Paths, Roadmap) sit in a fixed bottom bar with Lucide icons and wavy dotted connectors; during the interview the active pill also shows the current part.
- Every button is a pill.

**Interview**
- First screen: Talk it through (voice) or Just tap. Voice mode is a full screen with a pulsing orb, optional captions, and a floating bar with status and "Switch to tapping". The live UI uses ElevenLabs, with browser speech as a playback fallback.
- Warm up: 3 questions, bubbles plus a pill shaped free text field. Answered questions shrink so the newest one stands out.
- "Now the fun part" screen, then task cards from real job ads rated 👎 / 🤷 / 😍. Cards sit in a visible stack and swipe down when answered. The agent picks each next card to separate the paths it is least sure about and stops once the top 3 are clear.
- Practical bits (location, hours, budget, education, languages you can work in, companies you'd love to work for), then optional CV and links, then straight into the research feed. Languages and dream companies are required by the research (Part 2 researches each dream company).
- A short plain note shows the current interview phase. "What I know" is a slim chip row with dividers.
- "Your map" is a small floating thumbnail bottom right that eases open on hover or click and closes on click outside.

**Paths**
- Cards stay in API order and show the intake counts returned by the server, sourced market evidence, current roles, ladder salaries and hiring companies. "Choose this path" is the main button, "What's this job like?" an underlined link that opens a centred modal.
- "Not feeling any of these?" with "Show me 4 more tasks".
- No match percentage or hiring chance anywhere.

**Roadmap**
- Sections stay in prerequisite order with isometric chapter tiles (radius 12). Evidence-complete chapters begin ticked and can be un-ticked.
- A transit style line with straight runs and rounded turns; labels sit on the outer side of each tile so the line never crosses text.
- The next useful chapter and the legend live in a small pill at the bottom right, without numeric progress summaries.

**Module**
- "After this you can" is the highlight, then why it matters, a top pick and curated resources (free first), then "Mark as done".
