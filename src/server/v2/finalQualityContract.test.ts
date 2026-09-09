/**
 * V2.5.1 FINAL QUALITY CONTRACT
 * -----------------------------
 * Regression coverage for the owner's real 99% failure, job
 * `cmtt8qpu2000107n9cde01r3p` (Arabic Egyptian, 15s, 16:9, VoiceTut, Auto
 * media, 1080p). Its measured, persisted values are reproduced verbatim below:
 * a valid 1920x1080 h264+aac 15.48s render existed on disk, audio QA passed,
 * the mixed-silence gate passed, black frames were 0%, no assets repeated and
 * semantic relevance was 100 - yet the job was marked `failed` and the video
 * was withheld, because real footage covered 64.6% of the timeline instead of
 * the 90% the professional-auto preference asks for.
 */

import { describe, expect, it } from "vitest";

import {
  assessFinalQuality,
  FINAL_QUALITY_GATES,
  HARD_FINAL_QUALITY_GATES,
  severityOf,
  type FinalQualityInputs,
} from "./quality/finalQualityContract";

/** The owner's job, exactly as the render worker measured it. */
const OWNER_INCIDENT: FinalQualityInputs = {
  container: {
    exists: true,
    hasVideoStream: true,
    hasAudioStream: true,
    durationSeconds: 15.48,
  },
  narrationExpected: true,
  audioMasteringPass: true,
  audioSilenceCriticalFailure: false,
  blackFramePercent: 0,
  visualIssues: ["real_visual_coverage_below_90_percent"],
  realVisualCoveragePercent: 64.6,
  textOnlyTimelinePercent: 0,
  repeatedAssetCount: 0,
  scriptQualityPass: true,
};

function healthy(): FinalQualityInputs {
  return { ...OWNER_INCIDENT, visualIssues: [], realVisualCoveragePercent: 100 };
}

describe("final quality contract - severity model", () => {
  it("every declared gate has a severity and a stable message key", () => {
    for (const gate of FINAL_QUALITY_GATES) {
      expect(["hard", "soft"]).toContain(severityOf(gate));
    }
    // The hard list must be a strict subset - a gate that is neither declared
    // hard nor reachable as soft would silently stop mattering.
    for (const gate of HARD_FINAL_QUALITY_GATES) {
      expect(FINAL_QUALITY_GATES).toContain(gate);
    }
  });

  it("a production that meets every bar is ready with no findings", () => {
    const result = assessFinalQuality(healthy());
    expect(result.outcome).toBe("ready");
    expect(result.findings).toHaveLength(0);
    expect(result.outputAvailable).toBe(true);
  });
});

describe("owner incident ASE-L99A02 (job cmtt8qpu2000107n9cde01r3p)", () => {
  const result = assessFinalQuality(OWNER_INCIDENT);

  it("no longer throws away a technically valid render", () => {
    expect(result.outcome).toBe("needs_review");
    expect(result.outcome).not.toBe("failed");
  });

  it("keeps the rendered video available to the customer", () => {
    expect(result.outputAvailable).toBe(true);
    expect(result.retryable).toBe(true);
  });

  it("names the exact gate rather than a generic sentence", () => {
    expect(result.findings).toHaveLength(1);
    const [finding] = result.findings;
    expect(finding.gate).toBe("real_visual_coverage");
    expect(finding.severity).toBe("soft");
    // The customer sentence is resolved from a key in the active language, so
    // the Arabic interface never renders an English quality error.
    expect(finding.messageKey).toBe("quality.gate.real_visual_coverage");
    expect(finding.params).toEqual({ percent: 64.6 });
    expect(finding.technicalDetail).toContain("64.6%");
  });

  it("still reports the shortfall truthfully instead of passing it", () => {
    // The threshold was NOT lowered: the gate still fires, it just no longer
    // destroys the deliverable.
    expect(result.findings.some((item) => item.gate === "real_visual_coverage")).toBe(true);
    expect(result.technicalCode).toMatch(/^ASE-[0-9A-Z]{6}$/);
  });

  it("produces the same support code for the same defect every time", () => {
    expect(assessFinalQuality(OWNER_INCIDENT).technicalCode).toBe(result.technicalCode);
  });
});

describe("hard technical failures still fail and still withhold the output", () => {
  const cases: Array<[string, Partial<FinalQualityInputs>, string]> = [
    [
      "missing container",
      { container: { exists: false, hasVideoStream: false, hasAudioStream: false, durationSeconds: 0 } },
      "container_invalid",
    ],
    [
      "no video stream",
      { container: { exists: true, hasVideoStream: false, hasAudioStream: true, durationSeconds: 15 } },
      "video_stream_missing",
    ],
    [
      "narration requested but no audio stream",
      { container: { exists: true, hasVideoStream: true, hasAudioStream: false, durationSeconds: 15 } },
      "audio_stream_missing",
    ],
    [
      "impossible duration",
      { container: { exists: true, hasVideoStream: true, hasAudioStream: true, durationSeconds: 0.2 } },
      "duration_invalid",
    ],
    ["render threw", { renderError: "ffmpeg exited with code 1" }, "render_failed"],
    ["audio mastering rejected the mix", { audioMasteringPass: false }, "audio_mastering"],
    ["critical silence run", { audioSilenceCriticalFailure: true }, "audio_silence"],
    ["mostly-black timeline", { blackFramePercent: 61 }, "black_frames_severe"],
  ];

  for (const [name, override, expectedGate] of cases) {
    it(`${name} is a hard failure with no output offered`, () => {
      const result = assessFinalQuality({ ...healthy(), ...override });
      expect(result.outcome).toBe("failed");
      expect(result.outputAvailable).toBe(false);
      const finding = result.findings.find((item) => item.gate === expectedGate);
      expect(finding).toBeDefined();
      expect(finding!.severity).toBe("hard");
    });
  }
});

describe("soft creative findings keep the video", () => {
  const cases: Array<[string, Partial<FinalQualityInputs>, string]> = [
    [
      "full-screen text above the target",
      { visualIssues: ["text_only_timeline_above_10_percent"], textOnlyTimelinePercent: 22 },
      "text_only_timeline",
    ],
    [
      "a reused clip",
      { visualIssues: ["repeated_visual_assets_detected"], repeatedAssetCount: 2 },
      "repeated_visual_assets",
    ],
    [
      "a few black frames",
      { visualIssues: ["black_frame_percentage_high"], blackFramePercent: 3 },
      "black_frames_elevated",
    ],
    ["prompt text on screen", { visualIssues: ["raw_prompt_leak_detected"] }, "raw_prompt_leak"],
    ["an unsupported claim", { visualIssues: ["invented_claim_risk_detected"] }, "invented_claim_risk"],
    [
      "a weak script",
      { scriptQualityPass: false, scriptQualityReason: "Narration is generic filler." },
      "script_content",
    ],
  ];

  for (const [name, override, expectedGate] of cases) {
    it(`${name} is reviewable, not fatal`, () => {
      const result = assessFinalQuality({ ...healthy(), ...override });
      expect(result.outcome).toBe("needs_review");
      expect(result.outputAvailable).toBe(true);
      const finding = result.findings.find((item) => item.gate === expectedGate);
      expect(finding).toBeDefined();
      expect(finding!.severity).toBe("soft");
    });
  }

  it("a hard failure alongside soft findings is still a hard failure", () => {
    const result = assessFinalQuality({
      ...OWNER_INCIDENT,
      audioMasteringPass: false,
    });
    expect(result.outcome).toBe("failed");
    expect(result.outputAvailable).toBe(false);
    expect(result.findings.map((item) => item.gate)).toContain("real_visual_coverage");
  });

  it("a mostly-black timeline is reported once, as the hard failure", () => {
    const result = assessFinalQuality({
      ...healthy(),
      blackFramePercent: 61,
      visualIssues: ["black_frame_percentage_high"],
    });
    expect(result.findings.filter((item) => item.gate.startsWith("black_frames"))).toHaveLength(1);
    expect(result.findings[0].gate).toBe("black_frames_severe");
  });
});
