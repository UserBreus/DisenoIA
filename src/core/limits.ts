export const ACCEPTED_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;

export const PHOTO = {
  maxBytes: 41_943_040,
  maxMegapixels: 50,
  normalizedLongestSide: 1500,
};

export const REFERENCE = {
  targetBytes: 8_000_000,
  maxBytes: 10_000_000,
  jpegQualities: [0.9, 0.8, 0.7, 0.6],
  shrinkFactor: 0.85,
  maxShrinkPasses: 6,
};

export const CLIENT = {
  concurrency: 6,
  versionsPerItem: 3,
  extraCrops: 2,
  enlargements: 6,
};

export const CROP = { margin: 0.15, minSide: 768, maxSide: 1500 };

export const MATTE = { color: "#ff00ff", alphaThreshold: 64, grow: 0.012, slack: 0.05 };

export const JOB_TIMEOUT_MS = 300_000;

export const LIMITS = {
  fragments: 8,
  colors: 8,
  style: 6,
  lists: 12,
};
