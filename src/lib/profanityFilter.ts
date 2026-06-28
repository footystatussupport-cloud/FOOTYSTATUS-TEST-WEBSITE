const PROFANITY_WORDS = [
  "fuck",
  "fucker",
  "fucking",
  "shit",
  "shitty",
  "bitch",
  "bitches",
  "cunt",
  "pussy",
  "asshole",
  "bastard",
  "douche",
  "douchebag",
  "motherfucker",
  "nigger",
  "nigga",
  "faggot",
  "retard",
  "slut",
  "whore",
];

const LEET_MAP: Record<string, string> = {
  "0": "o",
  "1": "i",
  "!": "i",
  "|": "i",
  "3": "e",
  "4": "a",
  "@": "a",
  "5": "s",
  "$": "s",
  "7": "t",
  "+": "t",
  "8": "b",
};

const normalizeLetters = (value: string) =>
  value
    .toLowerCase()
    .replace(/[0134@!|5$7+8]/g, (character) => LEET_MAP[character] || character)
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "");

const squeezeRepeatedLetters = (value: string) => value.replace(/([a-z])\1{1,}/g, "$1");

const escapeRegex = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const wordBoundaryPatterns = PROFANITY_WORDS.map(
  (word) => new RegExp(`(^|[^a-z])${escapeRegex(word)}([^a-z]|$)`, "i")
);

const compactWords = PROFANITY_WORDS.map((word) => squeezeRepeatedLetters(word));

export const containsProfanity = (text?: string | null) => {
  if (!text) return false;

  const normalized = normalizeLetters(text);
  const squeezed = squeezeRepeatedLetters(normalized);
  const compact = squeezeRepeatedLetters(normalized.replace(/[^a-z]/g, ""));

  return wordBoundaryPatterns.some((pattern) => pattern.test(squeezed))
    || compactWords.some((word) => compact.includes(word));
};

export const containsProfanityInFields = (fields: Array<string | null | undefined>) =>
  fields.some((field) => containsProfanity(field));
