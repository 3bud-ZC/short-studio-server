/**
 * QUALITY REVIEW PANEL (V2.5.1)
 * -----------------------------
 * Renders the structured final-quality verdict a production carries.
 *
 * The screen this replaces showed one sentence - "Final video quality checks
 * did not pass. Retry will reuse valid saved assets where possible." - in
 * English, inside an Arabic interface, next to a 99% progress bar, with the
 * finished 1080p video nowhere in sight. It named no gate, said nothing about
 * what would be reused, and gave the customer no way to judge whether the video
 * was usable.
 *
 * This panel says which check did not pass and by how much, in the interface
 * language, resolved from the finding's message key rather than from a sentence
 * the backend pre-translated. English engineering detail stays folded away in
 * Technical Details, where a developer can still read it and a customer is
 * never shown it by accident.
 */

import React from "react";
import {
  Accordion,
  AccordionDetails,
  AccordionSummary,
  Alert,
  Button,
  Chip,
  Stack,
  Typography,
} from "@mui/material";
import ExpandMoreIcon from "@mui/icons-material/ExpandMore";
import RefreshIcon from "@mui/icons-material/Refresh";

import { SectionCard } from "./v2";
import { useI18n } from "../i18n";
import type { CustomerQualityReview } from "../pages/v2Types";

export function QualityReviewPanel({
  review,
  onRetry,
  retrying,
}: {
  review: CustomerQualityReview;
  onRetry?: () => void;
  retrying?: boolean;
}) {
  const { t, format } = useI18n();
  if (!review || review.outcome === "ready" || review.findings.length === 0) return null;

  const failed = review.outcome === "failed";

  return (
    <SectionCard title={t(failed ? "quality.failedTitle" : "quality.reviewTitle")}>
      <Stack spacing={1.5}>
        <Alert severity={failed ? "error" : "warning"}>
          {t(failed ? "quality.failedBody" : "quality.reviewBody")}
        </Alert>

        <Stack spacing={1}>
          {review.findings.map((finding) => (
            <Stack
              key={finding.gate}
              direction="row"
              spacing={1}
              alignItems="flex-start"
              sx={{ border: 1, borderColor: "divider", borderRadius: 1, p: 1.25 }}
            >
              <Chip
                size="small"
                color={finding.severity === "hard" ? "error" : "warning"}
                variant="outlined"
                label={t(`quality.severity.${finding.severity}`)}
                sx={{ flexShrink: 0 }}
              />
              <Typography variant="body2" sx={{ flex: 1, minWidth: 0 }}>
                {t(finding.messageKey, finding.params)}
              </Typography>
            </Stack>
          ))}
        </Stack>

        {review.technicalCode && (
          <Typography variant="caption" color="text.secondary">
            {t("quality.reference", { code: format.technical(review.technicalCode) })}
          </Typography>
        )}

        {onRetry && (
          <Stack spacing={0.75} alignItems="flex-start">
            <Button
              variant="contained"
              color="warning"
              startIcon={<RefreshIcon />}
              disabled={retrying}
              onClick={onRetry}
            >
              {t("productions.retry")}
            </Button>
            <Typography variant="caption" color="text.secondary">
              {t("productions.retryReuse")}
            </Typography>
          </Stack>
        )}

        <Accordion variant="outlined" sx={{ borderRadius: 1 }}>
          <AccordionSummary expandIcon={<ExpandMoreIcon />}>
            <Typography variant="caption" fontWeight={700}>
              {t("quality.technicalDetails")}
            </Typography>
          </AccordionSummary>
          <AccordionDetails>
            <Stack spacing={0.75}>
              {review.findings.map((finding) => (
                // Deliberately English and deliberately raw: this is the
                // engineering sentence, and it is only ever reached by someone
                // who opened Technical Details on purpose.
                <Typography key={finding.gate} variant="caption" dir="ltr" sx={{ textAlign: "left" }}>
                  <code>{finding.gate}</code> — {finding.technicalDetail}
                </Typography>
              ))}
            </Stack>
          </AccordionDetails>
        </Accordion>
      </Stack>
    </SectionCard>
  );
}
