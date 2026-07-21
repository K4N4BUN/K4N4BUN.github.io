/*
 * RevenueCat public configuration.
 * Public SDK keys are safe to embed. Never place RevenueCat secret keys,
 * App Store credentials, Google service-account keys, or Supabase service_role
 * keys in this file or in GitHub.
 */
window.ZANDAKA_BILLING_CONFIG = Object.freeze({
  enabled: true,
  mode: "test", // "test" during development, "production" before store review
  entitlementId: "premium",
  offeringId: "default",
  testStorePublicApiKey: "",
  iosPublicApiKey: "",
  androidPublicApiKey: "",
  verifyFunction: "verify-entitlement",
  requireVerifiedEntitlements: true,
  premiumFeatures: [
    "複数端末同期",
    "自動クラウドバックアップ",
    "家族共有",
    "高度な残高予報",
    "長期履歴・CSV高度取込"
  ]
});
