import "server-only";

/** Offline synthetic payloads. They contain no live vendor observations. */
export const syntheticNpmFullPeriodResponse = {
  fixtureLabel: "synthetic only",
  packageName: "@fixture/sanity-sdk",
  start: "2026-09-05",
  end: "2026-10-04",
  downloads: Array.from({ length: 30 }, (_, offset) => ({
    day: new Date(Date.UTC(2026, 8, 5 + offset)).toISOString().slice(0, 10),
    count: offset % 7,
  })),
};

export const syntheticNpmIncompletePeriodResponse = {
  fixtureLabel: "synthetic only; incomplete period example",
  packageName: "@fixture/contentful-sdk",
  start: "2026-09-05",
  end: "2026-10-04",
  downloads: [
    { day: "2026-10-02", count: 2 },
    { day: "2026-10-04", count: 0 },
  ],
} as const;

export const syntheticGitHubRepositoryResponse = {
  fixtureLabel: "synthetic only",
  full_name: "fixture-source/contentful-monorepo",
  html_url: "https://example.invalid/fixture-source/contentful-monorepo",
  stargazers_count: 0,
  open_issues_count: 7,
} as const;
