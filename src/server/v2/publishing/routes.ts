import { Router } from "express";
import { Config } from "../../../config";
import { aiMetadataGenerator } from "./aiMetadataGenerator";
import { PublishingService } from "./publishingService";
import { publishingRegistry } from "./registry";
import {
  batchPublicationSchema,
  createPublicationSchema,
  createSocialAccountSchema,
  generatePlatformMetadataRequestSchema,
  publishingPlatformSchema,
  updateSocialAccountSchema,
  validateVideoForPlatformSchema,
  type PublishingPlatform,
} from "./types";

export function createPublishingRouter(
  config: Config,
  publishingService: PublishingService,
): Router {
  const router = Router();

  // =========================================================================
  // SOCIAL ACCOUNTS
  // =========================================================================

  router.get("/accounts", async (_req, res) => {
    try {
      const accounts = await publishingService.listAccounts();
      res.status(200).json({ accounts });
    } catch (error) {
      res.status(500).json({
        error: "Failed to list accounts",
        message: error instanceof Error ? error.message : String(error),
      });
    }
  });

  router.post("/accounts", async (req, res) => {
    const parsed = createSocialAccountSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({
        error: "Invalid account payload",
        issues: parsed.error.flatten(),
      });
      return;
    }

    try {
      const account = await publishingService.createAccount(parsed.data);
      res.status(201).json({ account });
    } catch (error) {
      res.status(500).json({
        error: "Failed to create account",
        message: error instanceof Error ? error.message : String(error),
      });
    }
  });

  router.put("/accounts/:id", async (req, res) => {
    const parsed = updateSocialAccountSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({
        error: "Invalid update payload",
        issues: parsed.error.flatten(),
      });
      return;
    }

    try {
      const account = await publishingService.updateAccount(req.params.id, parsed.data);
      if (!account) {
        res.status(404).json({ error: "Account not found" });
        return;
      }
      res.status(200).json({ account });
    } catch (error) {
      res.status(500).json({
        error: "Failed to update account",
        message: error instanceof Error ? error.message : String(error),
      });
    }
  });

  router.delete("/accounts/:id", async (req, res) => {
    try {
      const result = await publishingService.disconnectAccount(req.params.id);
      if (!result.disconnected) {
        res.status(404).json({ error: "Account not found" });
        return;
      }
      res.status(200).json({
        success: true,
        revoked: result.revoked,
        scheduledNeedingAttention: result.scheduledNeedingAttention,
      });
    } catch (error) {
      res.status(500).json({
        error: "Failed to disconnect account",
        message: error instanceof Error ? error.message : String(error),
      });
    }
  });

  router.post("/accounts/:id/test", async (req, res) => {
    try {
      const result = await publishingService.testAccountConnection(req.params.id);
      res.status(200).json(result);
    } catch (error) {
      res.status(500).json({
        error: "Test connection failed",
        message: error instanceof Error ? error.message : String(error),
      });
    }
  });

  // =========================================================================
  // PUBLICATIONS
  // =========================================================================

  router.get("/publications", async (req, res) => {
    try {
      const platform = req.query.platform as PublishingPlatform | undefined;
      const status = req.query.status as any;
      const accountId = req.query.accountId as string | undefined;
      const videoId = req.query.videoId as string | undefined;
      const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : 50;
      const offset = req.query.offset ? parseInt(req.query.offset as string, 10) : 0;

      const result = await publishingService.listPublications({
        platform,
        status,
        accountId,
        videoId,
        limit,
        offset,
      });

      res.status(200).json(result);
    } catch (error) {
      res.status(500).json({
        error: "Failed to list publications",
        message: error instanceof Error ? error.message : String(error),
      });
    }
  });

  router.post("/publications", async (req, res) => {
    const parsed = createPublicationSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({
        error: "Invalid publication payload",
        issues: parsed.error.flatten(),
      });
      return;
    }

    try {
      const publication = await publishingService.createPublication(parsed.data);
      res.status(201).json({ publication });
    } catch (error) {
      res.status(500).json({
        error: "Failed to create publication",
        message: error instanceof Error ? error.message : String(error),
      });
    }
  });

  router.post("/batch", async (req, res) => {
    const parsed = batchPublicationSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({
        error: "Invalid batch payload",
        issues: parsed.error.flatten(),
      });
      return;
    }

    try {
      const publications = await publishingService.batchPublish(parsed.data);
      res.status(201).json({ publications, count: publications.length });
    } catch (error) {
      res.status(500).json({
        error: "Batch publication failed",
        message: error instanceof Error ? error.message : String(error),
      });
    }
  });

  router.get("/publications/:id", async (req, res) => {
    try {
      const publication = await publishingService.getPublication(req.params.id);
      if (!publication) {
        res.status(404).json({ error: "Publication not found" });
        return;
      }
      res.status(200).json({ publication });
    } catch (error) {
      res.status(500).json({
        error: "Failed to get publication",
        message: error instanceof Error ? error.message : String(error),
      });
    }
  });

  router.post("/publications/:id/publish", async (req, res) => {
    try {
      const publication = await publishingService.publishPublication(req.params.id);
      res.status(200).json({ publication });
    } catch (error) {
      res.status(500).json({
        error: "Publish failed",
        message: error instanceof Error ? error.message : String(error),
      });
    }
  });

  router.post("/publications/:id/retry", async (req, res) => {
    try {
      const publication = await publishingService.retryPublication(req.params.id);
      res.status(200).json({ publication });
    } catch (error) {
      res.status(500).json({
        error: "Retry failed",
        message: error instanceof Error ? error.message : String(error),
      });
    }
  });

  router.post("/publications/:id/cancel", async (req, res) => {
    try {
      const publication = await publishingService.cancelPublication(req.params.id);
      res.status(200).json({ publication });
    } catch (error) {
      res.status(500).json({
        error: "Cancel failed",
        message: error instanceof Error ? error.message : String(error),
      });
    }
  });

  router.get("/publications/:id/events", async (req, res) => {
    try {
      const events = await publishingService.getEvents(req.params.id);
      res.status(200).json({ events });
    } catch (error) {
      res.status(500).json({
        error: "Failed to get events",
        message: error instanceof Error ? error.message : String(error),
      });
    }
  });

  router.get("/summary", async (_req, res) => {
    try {
      const summary = await publishingService.getSummary();
      res.status(200).json(summary);
    } catch (error) {
      res.status(500).json({
        error: "Failed to get summary",
        message: error instanceof Error ? error.message : String(error),
      });
    }
  });

  // SSE Live Events
  router.get("/events", (req, res) => {
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.flushHeaders?.();

    res.write(`event: connected\ndata: ${JSON.stringify({ ok: true, time: new Date() })}\n\n`);
    const unsubscribe = publishingService.subscribe(res);
    req.on("close", unsubscribe);
  });

  // AI Platform Metadata Generator
  router.post("/metadata/generate", (req, res) => {
    const parsed = generatePlatformMetadataRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({
        error: "Invalid metadata generation payload",
        issues: parsed.error.flatten(),
      });
      return;
    }

    try {
      const metadata = aiMetadataGenerator.generateMetadata(parsed.data);
      res.status(200).json({ metadata });
    } catch (error) {
      res.status(500).json({
        error: "Failed to generate metadata",
        message: error instanceof Error ? error.message : String(error),
      });
    }
  });

  // Pre-flight Video Format Validation
  router.post("/validate-video", async (req, res) => {
    const parsed = validateVideoForPlatformSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({
        error: "Invalid validation payload",
        issues: parsed.error.flatten(),
      });
      return;
    }

    try {
      const validation = await publishingService.validateVideoForPlatform(
        parsed.data.videoId,
        parsed.data.platform,
      );
      res.status(200).json(validation);
    } catch (error) {
      res.status(500).json({
        error: "Validation failed",
        message: error instanceof Error ? error.message : String(error),
      });
    }
  });

  // Platform Capabilities
  router.get("/capabilities/:platform", (req, res) => {
    const parsed = publishingPlatformSchema.safeParse(req.params.platform);
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid platform" });
      return;
    }
    const capabilities = publishingRegistry.getPlatformCapabilities(parsed.data);
    res.status(200).json({ capabilities });
  });

  // Publishing Providers
  router.get("/providers", async (_req, res) => {
    try {
      const providers = publishingRegistry
        .listProviders()
        .filter((provider) => provider.id === "upload_post");
      const validations = await publishingRegistry.validateAll();

      const items = providers.map((p) => {
        const val = validations.find((v) => v.provider === p.displayName);
        const configured = val?.configured ?? false;
        const authenticated = val?.healthy ?? false;
        const connectionVerified = authenticated && val?.status === "healthy";
        const blocker = !configured
          ? "Ready to connect."
          : !authenticated
            ? val?.message || "Connection needs attention."
            : undefined;
        return {
          id: p.id,
          name: p.displayName,
          category: "Publishing",
          implemented: true,
          enabled: true,
          supportedPlatforms: p.getSupportedPlatforms(),
          configured,
          authenticated,
          connectionVerified,
          // Publication verification requires a real external post reaching a
          // provider-confirmed terminal state. Pass 8 intentionally performs no
          // external posting, so the API must not claim it here.
          publicationVerified: false,
          accountIdentitySafeLabel: val?.accountDetails?.channelTitle || val?.accountDetails?.accountName,
          status: val?.status ?? "not_configured",
          healthy: authenticated,
          message: val?.message ?? "Provider initialized.",
          checkedAt: val?.checkedAt ?? new Date().toISOString(),
          lastVerifiedAt: val?.checkedAt,
          blocker,
          capabilities: p.getSupportedPlatforms().map((platform) => p.getCapabilities(platform)),
        };
      });

      res.status(200).json({ providers: items });
    } catch (error) {
      res.status(500).json({
        error: "Failed to list publishing providers",
        message: error instanceof Error ? error.message : String(error),
      });
    }
  });

  return router;
}
