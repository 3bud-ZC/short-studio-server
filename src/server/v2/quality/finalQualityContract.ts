/**
 * FINAL QUALITY CONTRACT (V2.5.1)
 * -------------------------------
 * Before this module the last step of a production collapsed every possible
 * complaint - a corrupt container, a silent mix, a scene that used a motion
 * graphic instead of stock footage - into one boolean (`professionalReady`)
 * and one English sentence ("Final video quality checks did not pass."). A
 * customer reached 99% and lost a perfectly playable 1080p render because a
 * *creative* coverage preference was not met.
 *
 * The real incident this module exists to fix (job `cmtt8qpu2000107n9cde01r3p`,
 * Arabic 16:9 15s, VoiceTut, Auto media): audio QA passed, the silence gate
 * passed, zero black frames, zero repeated assets, semantic relevance 100, and
 * a valid 1920x1080 h264+aac 15.48s MP4 existed on disk - yet the job was
 * marked `failed` because `realVisualCoveragePercent` was 64.6 instead of >= 90
 * (one of five shots fell back to a locally generated graphic).
 *
 * The fix is a severity model, not a lowered threshold. Every gate keeps its
 * threshold and keeps reporting truthfully; what changes is the *consequence*:
 *
 *   HARD  - the output is not a usable video (missing/corrupt container, no
 *           video stream, missing narration audio, impossible duration,
 *           render exception). Terminal state: `failed`, no output offered.
 *   SOFT  - the output IS a usable video but did not meet a creative or
 *           editorial preference. Terminal state: `needs_review`, output
 *           preserved, preview + download available, reasons shown verbatim.
 *
 * Every finding carries a `messageKey` rather than an English sentence, so the
 * Arabic interface renders an Arabic reason instead of a translated-at-the-edge
 * English one. `technicalDetail` stays English and stays inside the collapsed
 * technical panel.
 */

export type FinalQualityGateSeverity = "hard" | "soft";

/** Stable gate identifiers. Persisted in metadata and asserted in tests. */
export const FINAL_QUALITY_GATES = [
  "container_invalid",
  "video_stream_missing",
  "audio_stream_missing",
  "duration_invalid",
  "render_failed",
  "audio_mastering",
  "audio_silence",
  "black_frames_severe",
  "real_visual_coverage",
  "text_only_timeline",
  "repeated_visual_assets",
  "black_frames_elevated",
  "raw_prompt_leak",
  "invented_claim_risk",
  "script_content",
] as const;

export type FinalQualityGate = (typeof FINAL_QUALITY_GATES)[number];

/** Gates whose failure means the file itself is unusable. */
export const HARD_FINAL_QUALITY_GATES: readonly FinalQualityGate[] = [
  "container_invalid",
  "video_stream_missing",
  "audio_stream_missing",
  "duration_invalid",
  "render_failed",
  "audio_mastering",
  "audio_silence",
  "black_frames_severe",
];

export function severityOf(gate: FinalQualityGate): FinalQualityGateSeverity {
  return HARD_FINAL_QUALITY_GATES.includes(gate) ? "hard" : "soft";
}

export type FinalQualityFinding = {
  gate: FinalQualityGate;
  severity: FinalQualityGateSeverity;
  /** i18n key resolved by the interface in the active language. */
  messageKey: string;
  /** Values interpolated into the localized sentence. */
  params?: Record<string, string | number>;
  /** English engineering detail. Belongs in the collapsed technical panel. */
  technicalDetail: string;
};

export type FinalQualityOutcome = "ready" | "needs_review" | "failed";

export type FinalQualityAssessment = {
  outcome: FinalQualityOutcome;
  findings: FinalQualityFinding[];
  /** True when a playable render exists and may be offered to the customer. */
  outputAvailable: boolean;
  retryable: boolean;
  /** Stable short code shown next to the reason. */
  technicalCode: string;
};

/**
 * Black frames are the only signal that appears on both sides of the severity
 * line: a couple of percent is an editorial nit, a mostly-black timeline is a
 * broken render.
 */
export const SEVERE_BLACK_FRAME_PERCENT = 25;

export type FinalQualityInputs = {
  /** ffprobe-derived truth about the file that was actually written. */
  container: {
    exists: boolean;
    hasVideoStream: boolean;
    hasAudioStream: boolean;
    durationSeconds: number;
  };
  /** Narration was requested, so a missing audio stream is fatal rather than fine. */
  narrationExpected: boolean;
  audioMasteringPass: boolean;
  audioSilenceCriticalFailure: boolean;
  blackFramePercent: number;
  /** Issue identifiers from `calculateProfessionalVisualQualityReport`. */
  visualIssues: readonly string[];
  realVisualCoveragePercent: number;
  textOnlyTimelinePercent: number;
  repeatedAssetCount: number;
  scriptQualityPass: boolean;
  scriptQualityReason?: string;
  /** A render that threw. Nothing else is worth evaluating. */
  renderError?: string;
};

const VISUAL_ISSUE_GATES: Record<string, FinalQualityGate> = {
  real_visual_coverage_below_90_percent: "real_visual_coverage",
  text_only_timeline_above_10_percent: "text_only_timeline",
  repeated_visual_assets_detected: "repeated_visual_assets",
  raw_prompt_leak_detected: "raw_prompt_leak",
  invented_claim_risk_detected: "invented_claim_risk",
  black_frame_percentage_high: "black_frames_elevated",
};

function finding(
  gate: FinalQualityGate,
  technicalDetail: string,
  params?: Record<string, string | number>,
): FinalQualityFinding {
  return {
    gate,
    severity: severityOf(gate),
    messageKey: `quality.gate.${gate}`,
    params,
    technicalDetail,
  };
}

/**
 * Deterministic support code. Derived from the gates that fired rather than
 * from a raw stack, so the same defect always shows the same code and the code
 * carries nothing sensitive.
 */
export function finalQualityCode(seed: string): string {
  let hash = 0;
  for (let index = 0; index < seed.length; index += 1) {
    hash = (hash * 31 + seed.charCodeAt(index)) | 0;
  }
  return `ASE-${Math.abs(hash).toString(36).toUpperCase().slice(0, 6).padStart(6, "0")}`;
}

export function assessFinalQuality(input: FinalQualityInputs): FinalQualityAssessment {
  const findings: FinalQualityFinding[] = [];

  if (input.renderError) {
    findings.push(finding("render_failed", input.renderError));
  }
  if (!input.container.exists) {
    findings.push(finding("container_invalid", "Rendered container is missing or unreadable."));
  } else {
    if (!input.container.hasVideoStream) {
      findings.push(finding("video_stream_missing", "Rendered container carries no video stream."));
    }
    if (input.narrationExpected && !input.container.hasAudioStream) {
      findings.push(
        finding(
          "audio_stream_missing",
          "Narration was requested but the container carries no audio stream.",
        ),
      );
    }
    if (!Number.isFinite(input.container.durationSeconds) || input.container.durationSeconds <= 0.5) {
      findings.push(
        finding(
          "duration_invalid",
          `Rendered duration is not usable (${input.container.durationSeconds}s).`,
          { seconds: Number(input.container.durationSeconds || 0).toFixed(2) },
        ),
      );
    }
  }

  if (!input.audioMasteringPass) {
    findings.push(finding("audio_mastering", "Final audio mastering QA did not pass."));
  }
  if (input.audioSilenceCriticalFailure) {
    findings.push(finding("audio_silence", "A critical silence run was detected in the mixed audio."));
  }
  if ((input.blackFramePercent || 0) > SEVERE_BLACK_FRAME_PERCENT) {
    findings.push(
      finding("black_frames_severe", `Black frames cover ${input.blackFramePercent}% of the timeline.`, {
        percent: input.blackFramePercent,
      }),
    );
  }

  for (const issue of input.visualIssues) {
    const gate = VISUAL_ISSUE_GATES[issue];
    if (!gate) continue;
    // A severe black-frame timeline is already reported as a hard failure;
    // reporting it twice would show the same defect as both a fatal error and
    // a suggestion.
    if (gate === "black_frames_elevated" && (input.blackFramePercent || 0) > SEVERE_BLACK_FRAME_PERCENT) {
      continue;
    }
    if (gate === "real_visual_coverage") {
      findings.push(
        finding(
          gate,
          `Real footage covers ${input.realVisualCoveragePercent}% of the timeline (target 90%).`,
          { percent: input.realVisualCoveragePercent },
        ),
      );
    } else if (gate === "text_only_timeline") {
      findings.push(
        finding(
          gate,
          `Full-screen text or motion covers ${input.textOnlyTimelinePercent}% of the timeline (target 10%).`,
          { percent: input.textOnlyTimelinePercent },
        ),
      );
    } else if (gate === "repeated_visual_assets") {
      findings.push(
        finding(gate, `${input.repeatedAssetCount} visual asset(s) were reused across scenes.`, {
          count: input.repeatedAssetCount,
        }),
      );
    } else if (gate === "black_frames_elevated") {
      findings.push(
        finding(gate, `Black frames cover ${input.blackFramePercent}% of the timeline.`, {
          percent: input.blackFramePercent,
        }),
      );
    } else {
      findings.push(finding(gate, `Visual quality report raised ${issue}.`));
    }
  }

  if (!input.scriptQualityPass) {
    findings.push(
      finding("script_content", input.scriptQualityReason || "Script did not pass the content quality gate."),
    );
  }

  const hardFindings = findings.filter((item) => item.severity === "hard");
  const containerUsable =
    input.container.exists &&
    input.container.hasVideoStream &&
    Number.isFinite(input.container.durationSeconds) &&
    input.container.durationSeconds > 0.5;

  const outcome: FinalQualityOutcome = hardFindings.length
    ? "failed"
    : findings.length
      ? "needs_review"
      : "ready";

  return {
    outcome,
    findings,
    // A hard failure never offers its output, even when a partial file exists:
    // handing a customer a container with no audio track and calling it a
    // deliverable is exactly the dishonesty this contract removes.
    outputAvailable: outcome !== "failed" && containerUsable,
    retryable: true,
    technicalCode: finalQualityCode(
      findings.length ? findings.map((item) => item.gate).sort().join("|") : "ready",
    ),
  };
}
