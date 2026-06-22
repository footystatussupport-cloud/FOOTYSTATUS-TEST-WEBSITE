export const USERNAME_VALIDATION_MESSAGES = {
  required: "Username is required",
  taken: "Username is already taken",
  format: "Username can only contain letters and numbers",
  banned: "Username contains inappropriate words",
  cooldown: "You can only change your username once every 14 days",
} as const;

export const USERNAME_PATTERN = /^[a-z0-9_]+$/;

const BANNED_USERNAME_PARTS = [
  "poop",
  "butt",
  "fart",
  "ass",
  "shit",
  "fuck",
  "bitch",
  "cunt",
  "dick",
  "cock",
  "pussy",
  "sex",
  "porn",
  "nude",
  "nazi",
  "hitler",
  "kkk",
  "terror",
  "rape",
];

export const normalizeUsername = (value?: string | null) =>
  (value || "")
    .trim()
    .replace(/^@+/, "")
    .toLowerCase();

export const validateUsername = (value?: string | null) => {
  const username = normalizeUsername(value);

  if (!username) return USERNAME_VALIDATION_MESSAGES.required;
  if (!USERNAME_PATTERN.test(username)) return USERNAME_VALIDATION_MESSAGES.format;
  if (BANNED_USERNAME_PARTS.some((word) => username.includes(word))) {
    return USERNAME_VALIDATION_MESSAGES.banned;
  }

  return null;
};

export const getUsernameErrorMessage = (message?: string | null) => {
  const normalized = (message || "").toLowerCase();

  if (normalized.includes(USERNAME_VALIDATION_MESSAGES.required.toLowerCase())) return USERNAME_VALIDATION_MESSAGES.required;
  if (normalized.includes(USERNAME_VALIDATION_MESSAGES.taken.toLowerCase()) || normalized.includes("duplicate key")) return USERNAME_VALIDATION_MESSAGES.taken;
  if (normalized.includes(USERNAME_VALIDATION_MESSAGES.format.toLowerCase()) || normalized.includes("username_valid_format")) return USERNAME_VALIDATION_MESSAGES.format;
  if (normalized.includes(USERNAME_VALIDATION_MESSAGES.banned.toLowerCase())) return USERNAME_VALIDATION_MESSAGES.banned;
  if (normalized.includes(USERNAME_VALIDATION_MESSAGES.cooldown.toLowerCase())) return USERNAME_VALIDATION_MESSAGES.cooldown;

  return message || "Something went wrong. Please try again.";
};

