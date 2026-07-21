/*
 * Public browser configuration. Supabase URL and publishable/anon key are not
 * secret, but Row Level Security must be enabled. Never place service_role,
 * sb_secret_*, Stripe secret keys, or bank API secrets in this file.
 */
window.ZANDAKA_CLOUD_CONFIG = Object.freeze({
  enabled: false,
  lockConfig: true,
  supabaseUrl: "",
  supabasePublishableKey: "",
  accountDeleteFunction: "delete-account",
  defaultHouseholdName: "マイ家計",
  syncIntervalMs: 60000,
  autoSyncDelayMs: 1800
});
