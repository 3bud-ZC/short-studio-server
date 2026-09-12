import { EventEmitter } from "events";
import cuid from "cuid";
import type { Response as ExpressResponse } from "express";
import { V2Database } from "./db";
import { logger } from "../../logger";
import {
  type CreateVideoJobInput,
  type JobEventRecord,
  type JobRecord,
  type JobStatus,
  terminalJobStatuses,
} from "./types";
import { convertTemplateToProductionSpec } from "./templateToSpec";
import type { ProductionSpec } from "../../types/productionSpec";
import { estimateProductionCost } from "./cost-estimator";
import {
  type CheckpointStage,
  checkpointStages,
  completeStage,
  failStage,
  beginStage,
  invalidateFromStage,
  reusableStages,
} from "./checkpoints";
import {
  attachRetryReuseManifest,
  sha256Text,
  type DurableSceneArtifact,
} from "./artifacts/durableArtifacts";
import { preprocessArabicSpeech } from "./voice-providers/arabicSpeechPreprocessor";

const allowedTransitions: Record<JobStatus, JobStatus[]> = {
  queued: ["preparing", "canceled", "failed"],
  preparing: [
    "generating_content",
    "searching_assets",
    "generating_voice",
    "failed",
    "canceled",
  ],
  generating_content: ["searching_assets", "generating_voice", "failed", "canceled"],
  searching_assets: ["generating_voice", "generating_captions", "rendering", "failed", "canceled"],
  generating_voice: ["generating_captions", "searching_assets", "failed", "canceled"],
  generating_captions: ["searching_assets", "rendering", "failed", "canceled"],
  rendering: ["finalizing", "failed", "canceled"],
  finalizing: ["ready", "needs_review", "failed", "canceled"],
  ready: [],
  // Terminal like "ready": the video exists and can be previewed, downloaded
  // and published. Retrying starts a NEW job rather than reopening this one.
  needs_review: [],
  failed: [],
  canceled: [],
};

type DbJobRow = {
  id: string;
  type: "video";
  status: JobStatus;
  progress: number;
  current_stage: string;
  title?: string;
  creation_mode?: "prompt" | "template";
  original_prompt?: string;
  production_spec?: ProductionSpec;
  ai_provider?: string;
  ai_model?: string;
  visual_mode?: string;
  visual_providers_used?: string[];
  voice_provider?: string;
  quality_profile?: string;
  resolution?: string;
  aspect_ratio?: string;
  language?: string;
  dialect?: string;
  cost_estimate?: Record<string, unknown>;
  idempotency_key?: string;
  template_id?: string;
  brand_name?: string;
  input: any;
  output?: Record<string, unknown>;
  error?: string;
  technical_error?: string;
  stage_timings?: Record<string, number>;
  checkpoint?: Record<string, unknown>;
  created_at: Date;
  started_at?: Date;
  completed_at?: Date;
  updated_at: Date;
};

type DbJobEventRow = {
  id: string;
  job_id: string;
  status: JobStatus;
  progress: number;
  stage: string;
  message: string;
  technical_message?: string;
  created_at: Date;
};

function retrySceneTextFingerprints(spec: ProductionSpec | undefined, artifact: DurableSceneArtifact): {
  canonicalSpokenContentFingerprint?: string;
  displayContentFingerprint?: string;
} {
  const scene = spec?.scenes?.[artifact.sceneIndex] as any;
  if (!scene) return {};
  const displayText = String(scene.narration || "");
  const spokenText = String(scene.spokenNarration || scene.narration || "");
  const normalizedSpoken =
    spec?.language === "ar"
      ? preprocessArabicSpeech(spokenText, {
        dialect: spec.dialect,
        pronunciationOverrides:
          (spec as any).pronunciationOverrides ||
          (spec as any).metadata?.pronunciationOverrides ||
          (spec as any).pronunciations,
        brandPronunciations: (spec.brandKit?.voiceProfile as any)?.pronunciationDictionary,
      }).ttsNormalizedText
      : spokenText.trim();
  return {
    canonicalSpokenContentFingerprint: sha256Text({
      text: normalizedSpoken,
      language: spec?.language || "auto",
      dialect: spec?.dialect || "none",
    }),
    displayContentFingerprint: sha256Text({
      text: displayText.trim(),
      language: spec?.language || "auto",
      dialect: spec?.dialect || "none",
    }),
  };
}

export function isValidJobTransition(current: JobStatus, next: JobStatus): boolean {
  if (current === next) return true;
  return allowedTransitions[current]?.includes(next) ?? false;
}

export function sanitizeIdempotencyKey(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const normalized = value.trim();
  if (!/^[A-Za-z0-9._:-]{8,160}$/.test(normalized)) return undefined;
  return normalized;
}

export class JobService {
  private events = new EventEmitter();

  constructor(private db: V2Database) {
    this.events.setMaxListeners(200);
  }

  public async createVideoJob(input: CreateVideoJobInput | any): Promise<JobRecord> {
    const idempotencyKey = sanitizeIdempotencyKey(input.idempotencyKey);
    if (idempotencyKey) {
      const existing = await this.getJobByIdempotencyKey(idempotencyKey);
      if (existing) {
        return existing;
      }
    }

    const id = cuid();

    let resolvedSpec: ProductionSpec | undefined;
    let creationMode: "prompt" | "template" = input.creationMode || "template";
    let originalPrompt: string | undefined = input.prompt || input.userPrompt;
    let templateId = input.businessTemplateId;
    let brandName = input.config?.brandKit?.brandName || input.brandName;

    if (input.productionSpec) {
      resolvedSpec = input.productionSpec;
      creationMode = resolvedSpec?.creationMode || "prompt";
      originalPrompt = resolvedSpec?.userPrompt || originalPrompt;
      templateId = resolvedSpec?.templateId || templateId;
      brandName = resolvedSpec?.brandKit?.brandName || brandName;
    } else if (input.businessTemplateId) {
      creationMode = "template";
      resolvedSpec = convertTemplateToProductionSpec({
        templateId: input.businessTemplateId,
        templateData: input.businessTemplateData,
        config: input.config,
        title: input.title,
        id,
      });
      brandName = resolvedSpec?.brandKit?.brandName || brandName;
    }

    const title =
      input.title ||
      resolvedSpec?.title ||
      brandName ||
      templateId?.replace(/_/g, " ") ||
      "Untitled Video Job";

    const aiProvider = resolvedSpec?.metadata?.planner
      ? String(resolvedSpec.metadata.planner)
      : creationMode === "prompt"
        ? "local_ai"
        : undefined;
    const visualMode = resolvedSpec?.visualMode || "stock";
    const voiceProvider = resolvedSpec?.voiceProvider || "kokoro";
    const qualityProfile = resolvedSpec?.quality || "standard";
    const resolution = resolvedSpec?.resolution || "1080p";
    const aspectRatio = resolvedSpec?.aspectRatio || "9:16";
    const language = resolvedSpec?.language || "ar";
    const dialect = resolvedSpec?.dialect || "egyptian";
    const costEstimate = resolvedSpec?.costEstimate || (resolvedSpec ? estimateProductionCost(resolvedSpec) : undefined);

    const rows = await this.db.query<DbJobRow>(
      `INSERT INTO jobs (
        id, type, status, progress, current_stage, title, template_id, brand_name, input,
        creation_mode, original_prompt, production_spec, ai_provider, visual_mode,
        voice_provider, quality_profile, resolution, aspect_ratio, language, dialect, cost_estimate,
        idempotency_key
      ) VALUES ($1, 'video', 'queued', 0, 'Queued', $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18)
      ON CONFLICT (idempotency_key) WHERE idempotency_key IS NOT NULL DO NOTHING
      RETURNING *`,
      [
        id,
        title,
        templateId || null,
        brandName || null,
        input,
        creationMode,
        originalPrompt || null,
        resolvedSpec ? JSON.stringify(resolvedSpec) : null,
        aiProvider || null,
        visualMode,
        voiceProvider,
        qualityProfile,
        resolution,
        aspectRatio,
        language,
        dialect,
        costEstimate ? JSON.stringify(costEstimate) : null,
        idempotencyKey,
      ],
    );

    if (!rows[0] && idempotencyKey) {
      const existing = await this.getJobByIdempotencyKey(idempotencyKey);
      if (existing) return existing;
    }
    if (!rows[0]) {
      throw new Error("Job could not be created.");
    }

    await this.addEvent(id, "queued", 0, "Queued", "Video job queued.");
    return this.mapJob(rows[0]);
  }

  public async listJobs(status?: string, limit = 100): Promise<JobRecord[]> {
    const boundedLimit = Math.min(1000, Math.max(1, Math.floor(limit)));
    const rows = status
      ? await this.db.query<DbJobRow>(
        "SELECT * FROM jobs WHERE status = $1 ORDER BY created_at DESC LIMIT $2",
        [status, boundedLimit],
      )
      : await this.db.query<DbJobRow>(
        "SELECT * FROM jobs ORDER BY created_at DESC LIMIT $1",
        [boundedLimit],
      );
    return rows.map((row) => this.mapJob(row));
  }

  /**
   * Operational Productions listing. The database returns a bounded candidate
   * window (never the whole table, never 1000 rows to a browser); the API layer
   * filters and keyset-paginates that window. Returns raw rows so the route can
   * hand them to the customer serializer.
   */
  public async listJobRows(windowSize = 400): Promise<DbJobRow[]> {
    const bounded = Math.min(1000, Math.max(1, Math.floor(windowSize)));
    return this.db.query<DbJobRow>(
      "SELECT * FROM jobs ORDER BY created_at DESC LIMIT $1",
      [bounded],
    );
  }

  public mapJobRow(row: DbJobRow): JobRecord {
    return this.mapJob(row);
  }

  /** Real summary counts for the Productions header. */
  public async summarizeJobs(): Promise<{
    total: number;
    active: number;
    ready: number;
    /** Delivered videos carrying quality notes (V2.5.1). Not failures. */
    needsReview: number;
    needsAttention: number;
    cancelled: number;
    createdThisWeek: number;
  }> {
    const rows = await this.db.query<{ status: string; count: string }>(
      "SELECT status, count(*)::int AS count FROM jobs GROUP BY status",
    );
    const week = await this.db.query<{ count: string }>(
      "SELECT count(*)::int AS count FROM jobs WHERE created_at >= now() - interval '7 days'",
    );
    const byStatus = new Map(rows.map((row) => [row.status, Number(row.count)]));
    const active = [
      "queued",
      "preparing",
      "generating_content",
      "searching_assets",
      "generating_voice",
      "generating_captions",
      "rendering",
      "finalizing",
    ].reduce((sum, status) => sum + (byStatus.get(status) || 0), 0);
    return {
      total: Array.from(byStatus.values()).reduce((sum, count) => sum + count, 0),
      active,
      ready: byStatus.get("ready") || 0,
      needsReview: byStatus.get("needs_review") || 0,
      needsAttention: byStatus.get("failed") || 0,
      cancelled: byStatus.get("canceled") || 0,
      createdThisWeek: Number(week[0]?.count || 0),
    };
  }

  public async getJob(id: string): Promise<JobRecord | null> {
    const rows = await this.db.query<DbJobRow>("SELECT * FROM jobs WHERE id = $1", [
      id,
    ]);
    return rows[0] ? this.mapJob(rows[0]) : null;
  }

  public async getJobByIdempotencyKey(idempotencyKey: string): Promise<JobRecord | null> {
    const safeKey = sanitizeIdempotencyKey(idempotencyKey);
    if (!safeKey) return null;
    const rows = await this.db.query<DbJobRow>(
      "SELECT * FROM jobs WHERE idempotency_key = $1",
      [safeKey],
    );
    return rows[0] ? this.mapJob(rows[0]) : null;
  }

  public async getEvents(id: string): Promise<JobEventRecord[]> {
    const rows = await this.db.query<DbJobEventRow>(
      "SELECT * FROM job_events WHERE job_id = $1 ORDER BY id ASC",
      [id],
    );
    return rows.map((row) => this.mapEvent(row));
  }

  public async updateJob(
    id: string,
    nextStatus: JobStatus,
    progress: number,
    currentStage: string,
    message: string,
    options: {
      output?: Record<string, unknown>;
      error?: string;
      technicalError?: string;
      technicalMessage?: string;
      visualProvidersUsed?: string[];
      stageTimings?: Record<string, number>;
      checkpoint?: Record<string, unknown>;
    } = {},
  ): Promise<JobRecord> {
    const current = await this.getJob(id);
    if (!current) {
      throw new Error("Job not found.");
    }
    if (!isValidJobTransition(current.status, nextStatus)) {
      throw new Error(`Invalid job transition ${current.status} -> ${nextStatus}.`);
    }

    const startedAt =
      !current.startedAt && nextStatus !== "queued" ? "now()" : "started_at";
    const completedAt = terminalJobStatuses.includes(nextStatus as never)
      ? "now()"
      : "completed_at";

    const rows = await this.db.query<DbJobRow>(
      `UPDATE jobs
       SET status = $2,
           progress = $3,
           current_stage = $4,
           output = COALESCE($5, output),
           error = COALESCE($6, error),
           technical_error = COALESCE($7, technical_error),
           visual_providers_used = COALESCE($8, visual_providers_used),
           stage_timings = COALESCE($9, stage_timings),
           checkpoint = COALESCE($10, checkpoint),
           started_at = ${startedAt},
           completed_at = ${completedAt},
           updated_at = now()
       WHERE id = $1
       RETURNING *`,
      [
        id,
        nextStatus,
        Math.round(progress),
        currentStage,
        options.output || null,
        options.error || null,
        options.technicalError || null,
        options.visualProvidersUsed || null,
        options.stageTimings ? JSON.stringify(options.stageTimings) : null,
        options.checkpoint ? JSON.stringify(options.checkpoint) : null,
      ],
    );

    await this.addEvent(
      id,
      nextStatus,
      Math.round(progress),
      currentStage,
      message,
      options.technicalMessage,
    );
    return this.mapJob(rows[0]);
  }

  public async updateStageCheckpoint(
    id: string,
    stage: CheckpointStage,
    state: "running" | "completed" | "failed",
    options: {
      input?: unknown;
      provider?: string;
      artifacts?: Record<string, unknown>;
      error?: string;
      timingMs?: number;
    } = {},
  ): Promise<JobRecord> {
    const current = await this.getJob(id);
    if (!current) throw new Error("Job not found.");
    let checkpoint: Record<string, unknown>;
    if (state === "running") {
      checkpoint = beginStage(current.checkpoint, stage, options.input, options.provider);
    } else if (state === "completed") {
      checkpoint = completeStage(current.checkpoint, stage, options.artifacts || {}, options.provider);
    } else {
      checkpoint = failStage(current.checkpoint, stage, options.error || "Stage failed.");
    }
    // V2.4 Pass 5 wall-clock accounting fix: a stage like "media"/"voice"/
    // "captions" fires once PER SCENE in the main render loop, and this used
    // to overwrite stage_timings[`${stage}Ms`] on every call - so only the
    // LAST scene's individual duration survived, silently discarding every
    // earlier scene's time. A real production (job cmtewtb4p000107l29fxzfggb)
    // measured 491s wall clock against only 147s of "accounted" stage time -
    // the other 344s was earlier scenes' media/caption time this overwrite
    // had already thrown away. Summing instead of replacing makes the stored
    // total genuinely cumulative across the whole production.
    const previousStageTimings = (current.stageTimings || {}) as Record<string, number>;
    const stageTimings = {
      ...previousStageTimings,
      ...(typeof options.timingMs === "number"
        ? { [`${stage}Ms`]: Math.round((previousStageTimings[`${stage}Ms`] || 0) + options.timingMs) }
        : {}),
    };
    const rows = await this.db.query<DbJobRow>(
      `UPDATE jobs
       SET checkpoint = $2,
           stage_timings = $3,
           updated_at = now()
       WHERE id = $1
       RETURNING *`,
      [id, JSON.stringify(checkpoint), JSON.stringify(stageTimings)],
    );
    return this.mapJob(rows[0]);
  }

  public async retryStage(id: string, stage: CheckpointStage): Promise<JobRecord> {
    const current = await this.getJob(id);
    if (!current) throw new Error("Job not found.");
    const checkpoint = invalidateFromStage(current.checkpoint, stage);
    const rows = await this.db.query<DbJobRow>(
      `UPDATE jobs
       SET status = 'queued',
           progress = LEAST(progress, 75),
           current_stage = $3,
           checkpoint = $2,
           updated_at = now()
       WHERE id = $1 AND status IN ('failed','canceled','ready','queued')
       RETURNING *`,
      [id, JSON.stringify(checkpoint), `Retry queued from ${stage}`],
    );
    if (!rows[0]) {
      throw new Error("Stage retry is only available for queued, failed, canceled, or ready jobs.");
    }
    await this.addEvent(
      id,
      "queued",
      rows[0].progress,
      `Retry ${stage}`,
      `Retry queued from ${stage}; reusable stages: ${reusableStages(checkpoint).join(", ") || "none"}.`,
    );
    return this.mapJob(rows[0]);
  }

  public async completeJob(
    id: string,
    videoId: string,
    output: Record<string, unknown> = {},
  ): Promise<JobRecord> {
    const job = await this.updateJob(id, "ready", 100, "Ready", "Video is ready.", {
      output: {
        ...output,
        videoId,
        previewUrl: `/api/short-video/${videoId}`,
        downloadUrl: `/api/videos/${videoId}/download`,
      },
    });

    await this.db.query(
      `INSERT INTO generated_assets (id, job_id, video_id, kind, path, metadata)
       VALUES ($1, $2, $3, 'video', $4, $5)
       ON CONFLICT (id) DO UPDATE SET metadata = EXCLUDED.metadata`,
      [
        videoId,
        id,
        videoId,
        String(output.path || ""),
        { ...output, videoId },
      ],
    );
    return job;
  }

  public async cancelJob(id: string): Promise<JobRecord> {
    const current = await this.getJob(id);
    if (!current) {
      throw new Error("Job not found.");
    }
    if (terminalJobStatuses.includes(current.status as never)) {
      throw new Error("Completed jobs cannot be canceled.");
    }
    return this.updateJob(
      id,
      "canceled",
      current.progress,
      "Canceled",
      "Job canceled before completion.",
    );
  }

  public async retryJob(
    id: string,
    options: {
      idempotencyKey?: string;
      reuseArtifacts?: DurableSceneArtifact[];
    } = {},
  ): Promise<JobRecord> {
    const current = await this.getJob(id);
    if (!current) {
      throw new Error("Job not found.");
    }
    if (current.status !== "failed" && current.status !== "canceled") {
      throw new Error("Only failed or canceled jobs can be retried.");
    }
    const priorLineage = Array.isArray((current.input as any)?.__retryLineage)
      ? (current.input as any).__retryLineage.filter((item: unknown) => typeof item === "string")
      : [];
    const originalJobId = (current.input as any)?.__originalJobId || priorLineage[0] || current.id;
    const retryNumber = priorLineage.length + 1;
    const safeReuseArtifacts = (options.reuseArtifacts || [])
      .filter((artifact) => artifact.valid === true)
      .map((artifact) =>
        attachRetryReuseManifest(artifact, retrySceneTextFingerprints(current.productionSpec, artifact)),
      );
    const reusedStageSet = new Set<string>(reusableStages(current.checkpoint));
    for (const artifact of safeReuseArtifacts) {
      if (artifact.type === "voice") reusedStageSet.add("voice");
      if (artifact.type === "captions") reusedStageSet.add("captions");
      if (artifact.type === "media") reusedStageSet.add("media");
      if (artifact.type === "mastered_voice") reusedStageSet.add("mastering");
    }
    reusedStageSet.add("planning");
    const reusedStageList = checkpointStages.filter((stage) => reusedStageSet.has(stage));
    const regeneratedStages = checkpointStages.filter(
      (stage) => !reusedStageSet.has(stage) || stage === "render" || stage === "validation",
    );
    const retryIdempotencyKey =
      sanitizeIdempotencyKey(options.idempotencyKey) ||
      sanitizeIdempotencyKey(`retry:${current.id}:${current.completedAt || current.updatedAt}:${retryNumber}`);

    const productionSpec = current.productionSpec
      ? {
        ...current.productionSpec,
        metadata: {
          ...((current.productionSpec as any).metadata || {}),
          revision: {
            ...(((current.productionSpec as any).metadata || {}).revision || {}),
            type: "retry",
            originalJobId,
            retryOf: current.id,
            retryNumber,
            reuseStages: reusedStageList,
            regeneratedStages,
            reuseArtifacts: safeReuseArtifacts,
          },
        },
      }
      : undefined;

    // Historical truth is preserved: the failed record is untouched and the new
    // attempt records its lineage. The retry gets its own idempotency key so a
    // double-click cannot create parallel retries for the same failed attempt.
    const carried = { ...((current.input || {}) as Record<string, unknown>) };
    delete carried.idempotencyKey;
    return this.createVideoJob({
      ...carried,
      ...(productionSpec ? { productionSpec } : {}),
      title: current.title ? `${current.title} retry` : undefined,
      idempotencyKey: retryIdempotencyKey,
      __originalJobId: originalJobId,
      __retryOf: current.id,
      __retryLineage: [
        ...priorLineage,
        current.id,
      ],
      __retryReuse: {
        reusedStages: reusedStageList,
        regeneratedStages,
        reusedArtifactIds: safeReuseArtifacts.map((artifact) => artifact.artifactId),
      },
    });
  }

  public subscribe(jobId: string, res: ExpressResponse): () => void {
    const listener = (event: JobEventRecord) => {
      res.write(`event: job-event\n`);
      res.write(`data: ${JSON.stringify(event)}\n\n`);
    };
    this.events.on(jobId, listener);
    return () => this.events.off(jobId, listener);
  }

  private async addEvent(
    jobId: string,
    status: JobStatus,
    progress: number,
    stage: string,
    message: string,
    technicalMessage?: string,
  ): Promise<void> {
    try {
      const rows = await this.db.query<DbJobEventRow>(
        `INSERT INTO job_events (job_id, status, progress, stage, message, technical_message)
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING *`,
        [jobId, status, progress, stage, message, technicalMessage || null],
      );
      this.events.emit(jobId, this.mapEvent(rows[0]));
    } catch (err: any) {
      // The job_events table has a foreign key on job_id. If the job was
      // deleted (e.g. by a restart race or explicit cleanup) between the
      // update and this event insert, the FK violation would crash the
      // process. Log and swallow so a missing job can never kill the server.
      if (err?.constraint === "job_events_job_id_fkey" || err?.code === "23503") {
        logger?.warn?.({ jobId, err: err.message }, "Suppressed job_events FK violation (job no longer exists)");
        return;
      }
      throw err;
    }
  }

  private mapJob(row: DbJobRow): JobRecord {
    return {
      id: row.id,
      type: row.type,
      status: row.status,
      progress: row.progress,
      currentStage: row.current_stage,
      title: row.title,
      creationMode: row.creation_mode || "template",
      originalPrompt: row.original_prompt,
      productionSpec: row.production_spec,
      aiProvider: row.ai_provider,
      aiModel: row.ai_model,
      visualMode: row.visual_mode,
      visualProvidersUsed: row.visual_providers_used,
      voiceProvider: row.voice_provider,
      qualityProfile: row.quality_profile,
      resolution: row.resolution,
      aspectRatio: row.aspect_ratio,
      language: row.language,
      dialect: row.dialect,
      costEstimate: row.cost_estimate,
      idempotencyKey: row.idempotency_key,
      templateId: row.template_id,
      brandName: row.brand_name,
      input: row.input,
      output: row.output,
      error: row.error,
      technicalError: row.technical_error,
      stageTimings: row.stage_timings || {},
      checkpoint: row.checkpoint || {},
      createdAt: row.created_at.toISOString(),
      startedAt: row.started_at?.toISOString(),
      completedAt: row.completed_at?.toISOString(),
      updatedAt: row.updated_at.toISOString(),
    };
  }

  private mapEvent(row: DbJobEventRow): JobEventRecord {
    return {
      id: Number(row.id),
      jobId: row.job_id,
      status: row.status,
      progress: row.progress,
      stage: row.stage,
      message: row.message,
      technicalMessage: row.technical_message,
      createdAt: row.created_at.toISOString(),
    };
  }
}
