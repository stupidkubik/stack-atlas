import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { DownloadsSparkline } from "../src/features/catalog/downloads-sparkline";

describe("dated package download chart", () => {
  it("keeps an all-zero series visible with exact UTC daily values", () => {
    const html = renderToStaticMarkup(<DownloadsSparkline series={[
      { day: "2026-10-01", downloads: 0 }, { day: "2026-10-02", downloads: 0 },
    ]} />);
    expect(html).toContain('role="img"');
    expect(html).toContain("Daily package downloads from 2026-10-01 to 2026-10-02");
    expect(html).toContain("Day (UTC)");
    expect(html.match(/<td>0<\/td>/g)).toHaveLength(2);
    expect(html).not.toMatch(/NaN|Infinity/);
    expect(html).toContain("not total CMS usage");
  });

  it("exposes the retained values alongside a non-constant chart", () => {
    const html = renderToStaticMarkup(<DownloadsSparkline series={[
      { day: "2026-10-01", downloads: 0 }, { day: "2026-10-02", downloads: 120 },
      { day: "2026-10-03", downloads: 60 },
    ]} />);
    expect(html).toContain("<td>120</td>");
    expect(html).toContain("<td>60</td>");
    expect(html).toContain("View daily download values");
  });

  it.each([null, [], [{ day: "2026-10-01", downloads: -1 }, { day: "2026-10-02", downloads: 2 }]])("does not draw a made-up or invalid series", (series) => {
    expect(renderToStaticMarkup(<DownloadsSparkline series={series} />)).toBe("");
  });
});
