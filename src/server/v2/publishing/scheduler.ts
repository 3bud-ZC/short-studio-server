import { logger } from "../../../logger";
import { V2Database } from "../db";
import { PublishingService } from "./publishingService";
import type { ScheduledPublicationRecord } from "./types";

export class PublishingScheduler {
  private timer?: NodeJS.Timeout;
  private running = false;
  private workerId: string;
  private pollIntervalMs: number;

  constructor(
    private db: V2Database,
    private publishingService: PublishingService,
    options: { pollIntervalMs?: number; workerId?: string } = {},
  ) {
    this.pollIntervalMs = options.pollIntervalMs || 5000;
    this.workerId = options.workerId || `worker_${process.pid}_${Date.now()}`;
  }

  public start(): void {
    if (this.running) return;
    this.running = true;
    logger.info({ workerId: this.workerId, pollIntervalMs: this.pollIntervalMs }, "Publishing scheduler started");

    // Run first check immediately
    this.tick().catch((err) => {
      logger.error({ err }, "Initial scheduler tick failed");
    });

    this.timer = setInterval(() => {
      this.tick().catch((err) => {
        logger.error({ err }, "Scheduler tick error");
      });
    }, this.pollIntervalMs);
  }

  public stop(): void {
    this.running = false;
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = undefined;
    }
    logger.info({ workerId: this.workerId }, "Publishing scheduler stopped");
  }

  public async tick(): Promise<number> {
    if (!this.db.enabled) return 0;

    // Publications the provider is still processing are settled from provider
    // truth on the same heartbeat that runs due schedules. Without this nothing
    // ever called getStatus(), so an asynchronous provider completion could only
    // be recorded by editing the database by hand.
    try {
      await this.publishingService.reconcileProcessingPublications();
    } catch (error) {
      logger.error({ error }, "Remote state reconciliation sweep failed");
    }

    try {
      // Find due pending schedules
      const dueRows = await this.db.query<{
        id: string;
        publication_id: string;
        video_id: string;
        scheduled_at: string;
        timezone: string;
      }>(
        `SELECT id, publication_id, video_id, scheduled_at, timezone
         FROM scheduled_publications
         WHERE status = 'pending' AND scheduled_at <= now()
         ORDER BY scheduled_at ASC
         LIMIT 10`,
      );

      if (dueRows.length === 0) return 0;

      logger.info({ count: dueRows.length }, "Found due scheduled publications");
      let executedCount = 0;

      for (const row of dueRows) {
        // Atomic claim
        const claimRows = await this.db.query(
          `UPDATE scheduled_publications
           SET status = 'claimed', locked_at = now(), locked_by = $2, updated_at = now()
           WHERE id = $1 AND status = 'pending'
           RETURNING *`,
          [row.id, this.workerId],
        );

        if (claimRows.length === 0) {
          // Already claimed by another worker
          continue;
        }

        executedCount++;
        try {
          logger.info({ publicationId: row.publication_id, scheduleId: row.id }, "Executing due publication");
          const result = this.publishingService.isN8nAvailable()
            ? await this.publishingService.dispatchViaN8n(row.publication_id)
            : await this.publishingService.publishPublication(row.publication_id);
          const finalStatus = ["published", "processing"].includes(result.status) ? "completed" : "failed";
          await this.db.query(
            `UPDATE scheduled_publications SET status = $2, updated_at = now() WHERE id = $1`,
            [row.id, finalStatus],
          );
        } catch (error) {
          logger.error({ error, publicationId: row.publication_id }, "Error executing scheduled publication");
          await this.db.query(
            `UPDATE scheduled_publications SET status = 'failed', updated_at = now() WHERE id = $1`,
            [row.id],
          );
        }
      }

      return executedCount;
    } catch (error) {
      logger.error({ error }, "Error querying due schedules");
      return 0;
    }
  }
}
