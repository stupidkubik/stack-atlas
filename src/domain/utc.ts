type UtcBrand = { readonly __brand: "UtcDateTime" };

export type UtcDateTime = string & UtcBrand;

export interface Clock {
  now(): Date;
}

export const systemClock: Clock = {
  now: () => new Date(),
};

export function isUtcDateTime(value: unknown): value is UtcDateTime {
  if (typeof value !== "string") return false;
  const match = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(?:\.(\d{1,3}))?Z$/.exec(value);
  const time = Date.parse(value);
  if (!match || Number.isNaN(time)) return false;

  const milliseconds = (match[2] ?? "0").padEnd(3, "0");
  return new Date(time).toISOString() === `${match[1]}.${milliseconds}Z`;
}

export function utcDateTime(value: string): UtcDateTime {
  if (!isUtcDateTime(value)) throw new Error("Invalid UTC date-time.");
  return value as UtcDateTime;
}

export function nowUtc(clock: Clock = systemClock): UtcDateTime {
  return utcDateTime(clock.now().toISOString());
}

export function fixedClock(at: UtcDateTime): Clock {
  const instant = new Date(at);
  return { now: () => new Date(instant.getTime()) };
}
