# Recommendation and roadmap quality evaluation

This is the release gate for claims about recommendation or roadmap quality. Passing automated tests is necessary but not sufficient: the current fixtures prove contracts and guardrails, not whether a real person receives useful career directions or a sound learning sequence.

## Evaluation set

Use at least 20 consented internal or research personas, pseudonymised before review:

- undecided starters, career changers and people with a clear target role;
- different education histories, weekly time budgets, course budgets and learning languages;
- at least four location and labour-market combinations supported by reviewed intake data;
- accessibility constraints and both sparse and detailed work histories.

Do not use production personal data for this benchmark. Keep the expected acceptable paths hidden from the system under review. Two reviewers independently assess every case and resolve disagreements only after recording their original scores.

## Required evaluation bundle

For each persona retain a versioned bundle containing:

1. the input profile, consent-safe CV summary and chosen public links;
2. intake cards shown, ratings, chat transcript and final recommended paths;
3. research coverage: resolved occupation IDs, vacancies, companies, source domains, fetched dates and duplicate counts;
4. validation output with demand, evidence tier and every cited source;
5. the complete roadmap, resource evidence and build configuration;
6. reviewer scores, critical failures and written rationale.

Remove direct identifiers and secrets. Store the dataset outside the public repository unless every item is deliberately synthetic and clearly labelled.

## Automatic gates

A case fails before human scoring when any of these occurs:

- a recommendation exposes a score, hiring probability or unsupported personal claim;
- an occupation is unresolved, comes from fake deck data or lacks reviewed provenance;
- a cited quote is not present in its source, a generated URL replaces the discovered URL, or required demand has no source;
- a high-demand missing skill is absent from the roadmap;
- a ready roadmap has an unfinished chapter without a verified resource when resource discovery is enabled, or a `free-only` chapter has no verified free option;
- a top pick is absent from its chapter, violates `free-only`, or uses expired cached evidence;
- the output leaks data from another seeker.

Record source coverage, source-domain diversity, unresolved occupations, duplicate vacancy rate, stale-source rate, resource deduplication rate and build failures for every run.

## Human rubric

Score each dimension from 0 to 2: `0` harmful or unusable, `1` usable with a material correction, `2` sound and actionable.

| Output | Dimension | Reviewer question |
|---|---|---|
| Recommendations | constraint fit | Do the paths respect location, remote, schedule, salary and deal-breakers without inventing preferences? |
| Recommendations | task fit | Can every path be traced to work the person rated, rather than prestige or title similarity? |
| Recommendations | market grounding | Are role labels, demand and companies current, local and supported by diverse sources? |
| Recommendations | explanation | Is the reasoning understandable, cautious and free of ability or hiring predictions? |
| Roadmap | prerequisite order | Can a learner reasonably complete each chapter using what came before? |
| Roadmap | demand coverage | Are the most demanded missing skills covered without repeating already-known material as mandatory? |
| Roadmap | scope | Is the work plausible for the stated weekly time and goal? |
| Roadmap | resources | Are resources available, correctly priced, suitable for the learner's language and level, and genuinely useful? |
| Roadmap | actionability | Does every unfinished chapter end in an observable task or artifact? |

Reviewers also mark a binary critical failure for unsafe advice, fabricated evidence, material constraint violation, misleading certainty or an unusable learning sequence.

## Release threshold

Do not publish a quality claim unless:

- there are no critical failures;
- at least 90% of cases pass every automatic gate;
- each rubric dimension has a median of 2 and no more than 10% of ratings are 0;
- reviewer agreement is reported, along with the dataset version, system version and date;
- at least five cases are rerun three times and material recommendation/sequence instability is explained.

Failures become regression fixtures when they can be represented without personal data. Re-run the benchmark after deck, prompt, model, taxonomy, ranking or resource-verification changes.
