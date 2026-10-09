export type WarmupQuestion = { key: string; text: string; options: string[] };

export const OPENING: WarmupQuestion[] = [
  {
    key: "drawn",
    text: "Let's start easy. When you lose track of time, what are you usually doing?",
    options: ["Making things look good", "Figuring out why something broke", "Convincing people", "Organising chaos", "Helping someone feel better"],
  },
  {
    key: "with",
    text: "Which sounds more like you?",
    options: ["Working with people", "Building things", "Working with information and numbers", "Playing with ideas and visuals"],
  },
  {
    key: "goal",
    text: "Last warm up one. What matters most to you right now?",
    options: ["Learn fast and grow", "A stable job and salary", "Work that means something"],
  },
];

export const WARMUP_QUESTIONS = OPENING;

export const PRIORS: Record<string, Record<string, number>> = {
  "Making things look good": { ux: 2, frontend: 2, marketing: 1 },
  "Figuring out why something broke": { backend: 2, qa: 2, data: 1 },
  "Convincing people": { sales: 2, marketing: 2 },
  "Organising chaos": { ops: 2, data: 1, qa: 1 },
  "Helping someone feel better": { ux: 1, sales: 1, ops: 1 },
  "Working with people": { sales: 1, ops: 1, ux: 1 },
  "Building things": { backend: 1, frontend: 1, qa: 0.5 },
  "Working with information and numbers": { data: 2, qa: 0.5 },
  "Playing with ideas and visuals": { ux: 1, marketing: 1, frontend: 0.5 },
};

export const GOALS: Record<string, "learn-fast" | "stability" | "mission"> = {
  "Learn fast and grow": "learn-fast",
  "A stable job and salary": "stability",
  "Work that means something": "mission",
};

export const GOAL_BY_OPTION = GOALS;
