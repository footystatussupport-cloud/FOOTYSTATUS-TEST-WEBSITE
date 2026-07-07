export const USERNAME_MAX_LENGTH = 20;

export const USERNAME_VALIDATION_MESSAGES = {
  required: "Username is required",
  taken: "This username is already taken. Please choose another username.",
  format: "Username can only contain letters, numbers, and underscores",
  banned: "This username contains prohibited language.",
  tooLong: `This username exceeds the ${USERNAME_MAX_LENGTH}-character limit.`,
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
  if (username.length > USERNAME_MAX_LENGTH) return USERNAME_VALIDATION_MESSAGES.tooLong;
  if (!USERNAME_PATTERN.test(username)) return USERNAME_VALIDATION_MESSAGES.format;
  if (BANNED_USERNAME_PARTS.some((word) => username.includes(word))) {
    return USERNAME_VALIDATION_MESSAGES.banned;
  }

  return null;
};

export const getUsernameErrorMessage = (message?: string | null) => {
  const normalized = (message || "").toLowerCase();

  if (normalized.includes("already taken") || normalized.includes("duplicate key")) return USERNAME_VALIDATION_MESSAGES.taken;
  if (normalized.includes("20-character") || normalized.includes("character limit")) return USERNAME_VALIDATION_MESSAGES.tooLong;
  if (normalized.includes("prohibited language") || normalized.includes("inappropriate words")) return USERNAME_VALIDATION_MESSAGES.banned;
  if (normalized.includes("letters") || normalized.includes("username_valid_format")) return USERNAME_VALIDATION_MESSAGES.format;
  if (normalized.includes("14 days")) return USERNAME_VALIDATION_MESSAGES.cooldown;
  if (normalized.includes(USERNAME_VALIDATION_MESSAGES.required.toLowerCase())) return USERNAME_VALIDATION_MESSAGES.required;

  return message || "Something went wrong. Please try again.";
};
