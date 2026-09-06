import type { Config } from "../../../config";
import type { AdminUser } from "./authService";

export function isLocalSingleUserAccess(config: Pick<Config, "accessMode">): boolean {
  return config.accessMode === "local";
}

export function localSingleUserOwner(): AdminUser & {
  accessMode: "local";
  remoteAccess: "disabled";
} {
  return {
    id: "local-owner",
    username: "Local Owner",
    role: "admin",
    createdAt: new Date(0),
    accessMode: "local",
    remoteAccess: "disabled",
  };
}
