import React from "react";
import axios from "axios";

/**
 * PRODUCT IDENTITY, READ FROM THE CANONICAL CONTRACT
 * --------------------------------------------------
 * `/api/v2/system/info` serves `src/version.ts`, which is the one place that
 * says what this build is. The Setup wizard used to print "Version 2.1.0" as a
 * literal, so a customer running 2.2.0 was told they were running 2.1.0 - the
 * kind of claim that quietly makes every support conversation start from a
 * false premise.
 *
 * Nothing in the interface should ever hardcode a version again. When the
 * endpoint has not answered yet, `version` is `null` and the caller renders
 * nothing rather than guessing.
 */
export type ProductInfo = {
  name: string;
  version: string;
  stage: string;
  build: string;
  accessMode?: "local" | "secure_server";
  remoteAccess?: "disabled" | "secure_server";
  schemaVersion?: string;
  releaseChannel?: string;
  canonicalUrl?: string;
};

export function useProductInfo(): { info: ProductInfo | null; loading: boolean } {
  const [info, setInfo] = React.useState<ProductInfo | null>(null);
  const [loading, setLoading] = React.useState(true);

  React.useEffect(() => {
    let cancelled = false;
    axios
      .get("/api/v2/system/info", { timeout: 6000 })
      .then((response) => {
        if (!cancelled) setInfo(response.data);
      })
      .catch(() => {
        // An unknown version reads as unknown. Never as a guess.
        if (!cancelled) setInfo(null);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return { info, loading };
}
