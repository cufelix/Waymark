# UI prototype

Clickable prototype of the full user flow, plain HTML, CSS and JS. No build step: open `index.html` in a browser.

| File | Screen |
|---|---|
| `index.html` | 1. Interview: 3 opening questions, then adaptive task cards from real job ads, then practical limits |
| `upload.html` | 2. Your stuff (optional): CV upload and links |
| `research.html` | 3. Live research feed while the agent works |
| `paths.html` | 4. Top 3 career paths, with a "What's this job like?" drawer |
| `roadmap.html` | 5. Isometric roadmap: sections, then numbered module tiles |
| `module.html` | 6. Module: why it matters, top pick, curated resources, mark as done |

`styles.css` holds the design tokens (colours, fonts) in `:root`. `app.js` holds the shared header, icons and the isometric tile.

All numbers, companies and the persona are sample data. Salaries and paid prices are placeholders.

## UI decisions

- Onboarding: 3 opening questions (bubbles plus free text), then task cards. The user reacts to real tasks from job ads (not for me / maybe / I'd enjoy this) instead of describing themselves.
- The agent picks each next card to separate the paths it is least sure about, and stops when the top 3 are clear (8 to 12 cards), not after a fixed count.
- A live "Paths forming" panel shows the candidates moving with every answer.
- Practical limits (hours per week, course budget, education) are asked last, since they shape the roadmap.
- Path cards cite the evidence ("You liked 4 of 5 coding tasks"). "None of these feel right" runs 4 more cards.
- CV and links are optional, asked at the end of the interview. Every detected skill shows its source ("from your CV").
- No match percentage or hiring chance on the path cards. Cards show why you, head start, market demand and time to job ready.
- Roadmap: sections in prerequisite order, each split into modules. Skills the user already has stay visible as "You've got this" with a "Review it" option.
- Modules point to curated resources (free first). Completion is a self tick, not a proof gate.
- Isometric tiles come from a fixed library tagged by category; numbered tiles are the fallback.
- Desktop first (1440px), mobile next.
