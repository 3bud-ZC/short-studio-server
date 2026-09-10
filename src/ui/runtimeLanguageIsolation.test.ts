import fs from "fs";
import path from "path";
import { describe, expect, it } from "vitest";

const read = (relative: string) => fs.readFileSync(path.join(process.cwd(), relative), "utf8");

describe("runtime customer-message language isolation", () => {
  it("does not render backend public-address prose directly", () => {
    const source = read("src/ui/components/PublicAddressPanel.tsx");
    expect(source).not.toContain("{warning}");
    expect(source).toContain('tr("settings.publicAddress.warningLocal")');
  });

  it("keeps English-only engineering detail out of the Arabic DOM", () => {
    const reviewSource = read("src/ui/components/QualityReviewPanel.tsx");
    const jobSource = read("src/ui/pages/JobDetails.tsx");
    expect(reviewSource).toContain('locale === "en"');
    expect(reviewSource).toContain("finding.technicalDetail");
    expect(jobSource).toContain('locale === "en" && job.technicalError');
  });
});
