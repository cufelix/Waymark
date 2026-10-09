export type OpenRouterProviderPolicy = {
  zdr: boolean;
  data_collection: "allow" | "deny";
};

/**
 * Privacy-preserving provider routing is fail-closed by default. A deployment may relax it only
 * through an explicit environment setting, for example when using a separately approved provider.
 */
export function openRouterProviderPolicy(
  env: Record<string, string | undefined> = process.env,
): OpenRouterProviderPolicy {
  const disabled = /^(?:0|false|off)$/iu.test(env.OPENROUTER_ZDR?.trim() ?? "");
  return {
    zdr: !disabled,
    data_collection: env.OPENROUTER_DATA_COLLECTION?.trim().toLowerCase() === "allow" ? "allow" : "deny",
  };
}
