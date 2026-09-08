/* eslint-disable @typescript-eslint/no-unused-vars */
import path from "path";
import fs from "fs-extra";

import { Kokoro } from "./short-creator/libraries/Kokoro";
import { Remotion } from "./short-creator/libraries/Remotion";
import { Whisper } from "./short-creator/libraries/Whisper";
import { FFMpeg } from "./short-creator/libraries/FFmpeg";
import { PexelsAPI } from "./short-creator/libraries/Pexels";
import { Config } from "./config";
import { ShortCreator } from "./short-creator/ShortCreator";
import { logger } from "./logger";
import { Server } from "./server/server";
import { MusicManager } from "./short-creator/music";
import { V2Database } from "./server/v2/db";
import { JobService } from "./server/v2/jobs";
import { ProviderCredentialsVault } from "./server/v2/provider-vault/providerCredentialsVault";
import { providerSecrets } from "./server/v2/provider-vault/providerSecrets";

async function main() {
  const config = new Config();
  try {
    config.ensureConfig();
  } catch (err: unknown) {
    logger.error(err, "Error in config");
    process.exit(1);
  }

  const musicManager = new MusicManager(config);
  try {
    logger.debug("checking music files");
    musicManager.ensureMusicFilesExist();
  } catch (error: unknown) {
    logger.error(error, "Missing music files");
    process.exit(1);
  }

  logger.debug("initializing remotion");
  const remotion = await Remotion.init(config);
  logger.debug("initializing kokoro");
  const kokoro = config.runningInDocker
    ? Kokoro.lazy(config.kokoroModelPrecision)
    : await Kokoro.init(config.kokoroModelPrecision);
  logger.debug("initializing whisper");
  const whisper = await Whisper.init(config);
  logger.debug("initializing ffmpeg");
  const ffmpeg = await FFMpeg.init();
  const pexelsApi = new PexelsAPI(config.pexelsApiKey);

  logger.debug("initializing the short creator");
  const shortCreator = new ShortCreator(
    config,
    remotion,
    kokoro,
    whisper,
    ffmpeg,
    pexelsApi,
    musicManager,
  );

  let v2Database: V2Database | undefined;
  let jobService: JobService | undefined;
  if (process.env.V2_ENABLED === "true" && config.serviceRole === "app") {
    logger.debug("initializing V2 database");
    v2Database = new V2Database(config);
    try {
      await v2Database.migrate();
    } catch (error) {
      logger.error(error, "V2 database migration failed; API will start degraded");
    }
    jobService = new JobService(v2Database);
  }

  // Both the API and the render worker read provider credentials from the
  // encrypted vault so a customer never has to edit .env by hand. Secrets are
  // decrypted into process memory only and are never logged or returned.
  // The render worker gets a credentials-only connection: it must not pick up
  // the app-role publishing and lease routes that a full db handle enables.
  if (process.env.V2_ENABLED === "true" && config.databaseUrl && config.providerVaultMasterKey) {
    const credentialsDb = v2Database || new V2Database(config);
    const vault = new ProviderCredentialsVault(credentialsDb, config);
    providerSecrets.registerResolver((providerId, credentialType) =>
      vault.readPlaintext(providerId, credentialType),
    );
    await providerSecrets.refreshElevenLabsApiKey().catch(() => undefined);
    await providerSecrets.refresh("upload_post", "api_key").catch(() => undefined);
  }

  if (!config.runningInDocker) {
    // the project is running with npm - we need to check if the installation is correct
    if (fs.existsSync(config.installationSuccessfulPath)) {
      logger.info("the installation is successful - starting the server");
    } else {
      logger.info(
        "testing if the installation was successful - this may take a while...",
      );
      try {
        const audioBuffer = (await kokoro.generate("hi", "af_heart")).audio;
        await ffmpeg.createMp3DataUri(audioBuffer);
        await pexelsApi.findVideo(["dog"], 2.4);
        const testVideoPath = path.join(config.tempDirPath, "test.mp4");
        await remotion.testRender(testVideoPath);
        fs.rmSync(testVideoPath, { force: true });
        fs.writeFileSync(config.installationSuccessfulPath, "ok", {
          encoding: "utf-8",
        });
        logger.info("the installation was successful - starting the server");
      } catch (error: unknown) {
        logger.fatal(
          error,
          "The environment is not set up correctly - please follow the instructions in the README.md file https://github.com/gyoridavid/short-video-maker",
        );
        process.exit(1);
      }
    }
  }

  logger.debug("initializing the server");
  const server = new Server(config, shortCreator, v2Database, jobService);
  const app = server.start();

  // todo add shutdown handler
}

main().catch((error: unknown) => {
  logger.error(error, "Error starting server");
});
