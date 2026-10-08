import type { Occupation, Skill } from "../../contracts";
import { slug } from "./index";

// Offline stand-in for ./index (no network); same three exports.
const OCCUPATIONS: Occupation[] = [
  { uri: "http://data.europa.eu/esco/occupation/stub-nurse", label: "nurse", lang: "en" },
  { uri: "http://data.europa.eu/esco/occupation/stub-software-developer", label: "software developer", lang: "en" },
  { uri: "http://data.europa.eu/esco/occupation/stub-accountant", label: "accountant", lang: "en" },
];

const SKILLS: Skill[] = [
  { uri: "http://data.europa.eu/esco/skill/stub-python", label: "Python (computer programming)", lang: "en" },
  { uri: "http://data.europa.eu/esco/skill/stub-sql", label: "SQL", lang: "en" },
  { uri: "http://data.europa.eu/esco/skill/stub-teamwork", label: "work in teams", lang: "en" },
];

const find = <T extends { label: string }>(list: T[], text: string, limit: number): T[] => {
  const q = text.toLowerCase();
  return list.filter((e) => e.label.toLowerCase().includes(q)).slice(0, limit);
};

export const searchOccupations = async (text: string, lang = "en", limit = 5): Promise<Occupation[]> =>
  find(OCCUPATIONS, text, limit).map((o) => ({ ...o, lang }));

export const searchSkills = async (text: string, lang = "en", limit = 5): Promise<Skill[]> =>
  find(SKILLS, text, limit).map((s) => ({ ...s, lang }));

export const resolveSkill = async (label: string, lang = "en"): Promise<Skill> => {
  const [hit] = await searchSkills(label, lang, 1);
  return hit ?? { uri: "custom:" + slug(label), label, lang };
};
