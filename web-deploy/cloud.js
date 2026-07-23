(() => {
  "use strict";

  const CONFIG_KEY = "zandaka-cloud-config-v1";
  const SESSION_KEY = "zandaka-cloud-session-v1";
  const META_KEY = "zandaka-cloud-meta-v1";
  const RECOVERY_KEY = "zandaka-cloud-recovery-v1";
  const MAX_RECOVERY = 4;

  const runtime = {
    config: null,
    session: null,
    meta: null,
    bundle: null,
    busy: false,
    applyingRemote: false,
    saveTimer: null,
    pollTimer: null,
    lastError: "",
    initialized: false,
    originalSaveState: null,
    originalRender: null,
    recoveryMode: false,
  };

  function emit(name, detail = {}) {
    try { window.dispatchEvent(new CustomEvent(name, { detail })); } catch {}
  }
  function emitSession() { emit("zandaka-auth-changed", { userId: runtime.session?.user?.id || "", signedIn: signedIn() }); }
  function emitBundle() { emit("zandaka-cloud-bundle-changed", { bundle: runtime.bundle, plan: runtime.meta?.plan || "free" }); }

  const html = (value) => String(value ?? "").replace(/[&<>'"]/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;",
  })[c]);
  const nowIso = () => new Date().toISOString();
  const appVersion = () => window.__ZY_TEST__?.APP_VERSION || "0.8.4";
  const getState = () => window.__ZY_TEST__?.getState?.() || {};
  const setState = (value) => window.__ZY_TEST__?.setState?.(value);
  const toast = (message) => window.showToast ? window.showToast(message) : console.info(message);
  const modal = (title, body) => window.openModal ? window.openModal(title, body) : alert(`${title}\n${body.replace(/<[^>]+>/g, " ")}`);

  function readJson(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch {
      return fallback;
    }
  }
  function writeJson(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
      return true;
    } catch {
      return false;
    }
  }
  function removeKey(key) {
    try { localStorage.removeItem(key); } catch {}
  }

  function normalizeUrl(value) {
    return String(value || "").trim().replace(/\/+$/, "");
  }
  function loadConfig() {
    const file = window.ZANDAKA_CLOUD_CONFIG || {};
    const local = readJson(CONFIG_KEY, {});
    const merged = {
      enabled: false,
      lockConfig: false,
      supabaseUrl: "",
      supabasePublishableKey: "",
      accountDeleteFunction: "delete-account",
      defaultHouseholdName: "マイ家計",
      syncIntervalMs: 60000,
      autoSyncDelayMs: 1800,
      ...file,
      ...(file.lockConfig ? {} : local),
    };
    merged.supabaseUrl = normalizeUrl(merged.supabaseUrl);
    merged.supabasePublishableKey = String(merged.supabasePublishableKey || "").trim();
    merged.enabled = Boolean(merged.enabled || (merged.supabaseUrl && merged.supabasePublishableKey));
    return merged;
  }
  function configReady() {
    const c = runtime.config;
    return Boolean(c?.enabled && /^https:\/\/[a-z0-9.-]+$/i.test(c.supabaseUrl) && c.supabasePublishableKey.length > 20);
  }
  function rejectSecretKey(key) {
    const v = String(key || "").toLowerCase();
    return v.startsWith("sb_secret_") || v.includes("service_role") || v.includes("stripe_secret");
  }

  function platformName() {
    const ua = navigator.userAgent || "";
    if (/iphone|ipad|ipod/i.test(ua)) return "iOS";
    if (/android/i.test(ua)) return "Android";
    if (/windows/i.test(ua)) return "Windows";
    if (/macintosh|mac os/i.test(ua)) return "macOS";
    if (/linux/i.test(ua)) return "Linux";
    return "Web";
  }
  function defaultDeviceName() {
    const standalone = matchMedia?.("(display-mode: standalone)")?.matches ? "PWA" : "ブラウザ";
    return `${platformName()} ${standalone}`;
  }
  function createDeviceId() {
    return globalThis.crypto?.randomUUID ? crypto.randomUUID() : `dev-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  }
  function defaultMeta() {
    return {
      schema: 1,
      deviceId: createDeviceId(),
      deviceName: defaultDeviceName(),
      householdId: "",
      revision: 0,
      role: "",
      plan: "free",
      autoSync: true,
      dirty: false,
      pendingSince: "",
      lastSyncedAt: "",
      lastCloudUpdatedAt: "",
      lastSyncedHash: "",
      conflict: null,
      selectedHouseholdId: "",
      lastPollAt: "",
    };
  }
  function loadMeta() {
    const base = defaultMeta();
    const saved = readJson(META_KEY, {});
    return {
      ...base,
      ...saved,
      deviceId: saved.deviceId || base.deviceId,
      deviceName: saved.deviceName || base.deviceName,
      autoSync: saved.autoSync !== false,
    };
  }
  function saveMeta() { writeJson(META_KEY, runtime.meta); }

  function stableHash(value) {
    const text = typeof value === "string" ? value : JSON.stringify(value);
    let h = 2166136261;
    for (let i = 0; i < text.length; i += 1) {
      h ^= text.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return `${text.length.toString(36)}-${(h >>> 0).toString(36)}`;
  }
  function stateHash() { return stableHash(getState()); }
  function stateBytes(value = getState()) {
    try { return new TextEncoder().encode(JSON.stringify(value)).byteLength; }
    catch { return 0; }
  }
  function meaningfulState(value = getState()) {
    const accounts = Array.isArray(value.accounts) ? value.accounts : [];
    return Boolean(
      (value.ledgerEntries?.length || 0) > 0 ||
      (value.financing?.length || 0) > 0 ||
      (value.oneOff?.length || 0) > 0 ||
      (value.transfers?.length || 0) > 0 ||
      (value.v13?.cards?.length || 0) > 0 ||
      accounts.some((a) => Number(a.balance) !== 0 || Number(a.buffer) !== 0) ||
      (value.recurring || []).some((x) => Number(x.amount) !== 0)
    );
  }
  function saveRecovery(label, payload) {
    const rows = readJson(RECOVERY_KEY, []);
    rows.unshift({ id: crypto.randomUUID?.() || String(Date.now()), label, createdAt: nowIso(), payload });
    writeJson(RECOVERY_KEY, rows.slice(0, MAX_RECOVERY));
  }
  function recoveryList() { return readJson(RECOVERY_KEY, []); }

  function normalizeSession(data) {
    if (!data?.access_token) return null;
    return {
      access_token: data.access_token,
      refresh_token: data.refresh_token || "",
      token_type: data.token_type || "bearer",
      expires_at: Number(data.expires_at || Math.floor(Date.now() / 1000) + Number(data.expires_in || 3600)),
      user: data.user || runtime.session?.user || null,
    };
  }
  function saveSession(session) {
    runtime.session = session;
    if (session) writeJson(SESSION_KEY, session); else removeKey(SESSION_KEY);
    queueMicrotask(emitSession);
  }
  function loadSession() { return readJson(SESSION_KEY, null); }
  function signedIn() { return Boolean(runtime.session?.access_token && runtime.session?.user?.id); }
  function sessionExpiring() { return !runtime.session?.expires_at || runtime.session.expires_at * 1000 < Date.now() + 90_000; }

  async function parseResponse(response) {
    const text = await response.text();
    let body = null;
    try { body = text ? JSON.parse(text) : null; } catch { body = text; }
    if (!response.ok) {
      const message = body?.msg || body?.message || body?.error_description || body?.error || body?.details || `${response.status} ${response.statusText}`;
      const error = new Error(String(message));
      error.status = response.status;
      error.body = body;
      throw error;
    }
    return body;
  }

  async function rawFetch(path, { method = "GET", body, auth = true, retry = true, headers = {} } = {}) {
    if (!configReady()) throw new Error("Supabase接続設定がありません");
    if (auth) await ensureSession();
    const requestHeaders = {
      apikey: runtime.config.supabasePublishableKey,
      "Content-Type": "application/json",
      ...headers,
    };
    if (auth && runtime.session?.access_token) requestHeaders.Authorization = `Bearer ${runtime.session.access_token}`;
    const response = await fetch(`${runtime.config.supabaseUrl}${path}`, {
      method,
      headers: requestHeaders,
      body: body === undefined ? undefined : JSON.stringify(body),
      cache: "no-store",
    });
    if (response.status === 401 && auth && retry && runtime.session?.refresh_token) {
      await refreshSession();
      return rawFetch(path, { method, body, auth, retry: false, headers });
    }
    return parseResponse(response);
  }

  async function invokeFunction(name, body = {}) {
    if (!/^[a-z0-9-]+$/i.test(String(name || ""))) throw new Error("Edge Function名が不正です");
    return rawFetch(`/functions/v1/${encodeURIComponent(name)}`, { method: "POST", body });
  }

  async function refreshSession() {
    if (!runtime.session?.refresh_token) throw new Error("再ログインが必要です");
    const data = await rawFetch("/auth/v1/token?grant_type=refresh_token", {
      method: "POST", auth: false, retry: false, body: { refresh_token: runtime.session.refresh_token },
    });
    const next = normalizeSession(data);
    if (!next) throw new Error("セッション更新に失敗しました");
    saveSession(next);
    return next;
  }
  async function ensureSession() {
    if (!runtime.session) throw new Error("ログインが必要です");
    if (sessionExpiring()) await refreshSession();
    return runtime.session;
  }
  async function authSignUp(email, password, displayName) {
    const data = await rawFetch("/auth/v1/signup", {
      method: "POST", auth: false,
      body: { email, password, data: { display_name: displayName || "" } },
    });
    const session = normalizeSession(data);
    if (session) saveSession(session);
    return data;
  }
  async function authSignIn(email, password) {
    const data = await rawFetch("/auth/v1/token?grant_type=password", {
      method: "POST", auth: false, body: { email, password },
    });
    const session = normalizeSession(data);
    if (!session) throw new Error("ログイン情報を取得できませんでした");
    saveSession(session);
    return session;
  }
  async function authSignOut() {
    try {
      if (runtime.session?.access_token) await rawFetch("/auth/v1/logout", { method: "POST", body: {}, retry: false });
    } catch {}
    saveSession(null);
    runtime.bundle = null;
    emitBundle();
    runtime.meta.householdId = "";
    runtime.meta.revision = 0;
    runtime.meta.role = "";
    runtime.meta.dirty = false;
    runtime.meta.conflict = null;
    saveMeta();
    render();
  }
  async function sendPasswordReset(email) {
    const redirect = `${location.origin}${location.pathname}`;
    return rawFetch(`/auth/v1/recover?redirect_to=${encodeURIComponent(redirect)}`, {
      method: "POST", auth: false, body: { email },
    });
  }
  async function updatePassword(password) {
    await rawFetch("/auth/v1/user", { method: "PUT", body: { password } });
  }
  async function rpc(name, args = {}) {
    return rawFetch(`/rest/v1/rpc/${encodeURIComponent(name)}`, {
      method: "POST", body: args, headers: { Prefer: "return=representation" },
    });
  }

  function unwrapRpc(value) {
    if (Array.isArray(value) && value.length === 1 && value[0] && Object.keys(value[0]).length === 1) {
      return Object.values(value[0])[0];
    }
    return value;
  }

  async function bootstrap() {
    if (!signedIn()) return;
    runtime.busy = true; runtime.lastError = ""; render();
    try {
      const local = getState();
      const result = unwrapRpc(await rpc("zy_bootstrap", {
        p_household_name: runtime.config.defaultHouseholdName || "マイ家計",
        p_payload: local,
        p_device_id: runtime.meta.deviceId,
        p_device_name: runtime.meta.deviceName,
        p_platform: platformName(),
        p_app_version: appVersion(),
      }));
      await receiveBundle(result, { initial: true });
      startPolling();
    } catch (error) {
      runtime.lastError = error.message;
      toast(`クラウド接続失敗：${error.message}`);
    } finally {
      runtime.busy = false; render();
    }
  }

  async function receiveBundle(bundle, { initial = false, forceCloud = false } = {}) {
    if (!bundle?.household?.id || !bundle?.state) throw new Error("クラウド応答の形式が不正です");
    runtime.bundle = bundle;
    emitBundle();
    const cloudState = bundle.state.payload || {};
    const cloudRevision = Number(bundle.state.revision || 0);
    const local = getState();
    const linkedBefore = runtime.meta.householdId === bundle.household.id && runtime.meta.revision > 0;
    runtime.meta.householdId = bundle.household.id;
    runtime.meta.selectedHouseholdId = bundle.household.id;
    runtime.meta.role = bundle.role || "viewer";
    runtime.meta.plan = bundle.entitlement?.plan || "free";
    runtime.meta.lastCloudUpdatedAt = bundle.state.updated_at || "";

    if (bundle.created) {
      runtime.meta.revision = cloudRevision;
      runtime.meta.lastSyncedHash = stableHash(local);
      runtime.meta.dirty = false;
      runtime.meta.pendingSince = "";
      runtime.meta.lastSyncedAt = nowIso();
      runtime.meta.conflict = null;
      saveMeta();
      return;
    }

    const localHash = stableHash(local);
    const cloudHash = stableHash(cloudState);
    if (forceCloud || (!meaningfulState(local) && cloudHash !== localHash)) {
      applyRemoteState(cloudState, cloudRevision, "クラウド初期読込");
    } else if (!linkedBefore && localHash !== cloudHash) {
      runtime.meta.conflict = {
        kind: "initial",
        remoteRevision: cloudRevision,
        remotePayload: cloudState,
        remoteUpdatedAt: bundle.state.updated_at || "",
        localHash,
        cloudHash,
      };
    } else if (cloudRevision > Number(runtime.meta.revision || 0)) {
      if (runtime.meta.dirty && localHash !== cloudHash) {
        runtime.meta.conflict = {
          kind: "revision",
          remoteRevision: cloudRevision,
          remotePayload: cloudState,
          remoteUpdatedAt: bundle.state.updated_at || "",
        };
      } else {
        applyRemoteState(cloudState, cloudRevision, "他端末の変更を取得");
      }
    } else {
      runtime.meta.revision = cloudRevision;
      runtime.meta.lastSyncedHash = localHash;
      runtime.meta.dirty = false;
      runtime.meta.pendingSince = "";
      runtime.meta.conflict = null;
    }
    saveMeta();
  }

  function applyRemoteState(payload, revision, label) {
    const current = getState();
    if (meaningfulState(current)) saveRecovery(label, current);
    runtime.applyingRemote = true;
    try { setState(payload); }
    finally { runtime.applyingRemote = false; }
    runtime.meta.revision = Number(revision || 0);
    runtime.meta.lastSyncedHash = stableHash(getState());
    runtime.meta.lastSyncedAt = nowIso();
    runtime.meta.dirty = false;
    runtime.meta.pendingSince = "";
    runtime.meta.conflict = null;
    saveMeta();
  }

  async function pull({ force = false } = {}) {
    if (!signedIn() || !runtime.meta.householdId) return bootstrap();
    runtime.busy = true; runtime.lastError = ""; render();
    try {
      const result = unwrapRpc(await rpc("zy_get_bundle", {
        p_household_id: runtime.meta.householdId,
        p_device_id: runtime.meta.deviceId,
      }));
      await receiveBundle(result, { forceCloud: force });
      runtime.meta.lastPollAt = nowIso(); saveMeta();
    } catch (error) {
      runtime.lastError = error.message;
      throw error;
    } finally { runtime.busy = false; render(); }
  }

  async function push({ force = false } = {}) {
    if (!signedIn()) throw new Error("ログインが必要です");
    if (!runtime.meta.householdId) await bootstrap();
    if (!["owner", "editor"].includes(runtime.meta.role)) throw new Error("閲覧権限ではクラウドへ保存できません");
    if (!navigator.onLine) {
      runtime.meta.dirty = true;
      runtime.meta.pendingSince ||= nowIso();
      saveMeta(); render();
      return { queued: true };
    }
    runtime.busy = true; runtime.lastError = ""; render();
    const payload = getState();
    try {
      const expectedRevision = force && runtime.meta.conflict
        ? Number(runtime.meta.conflict.remoteRevision || runtime.meta.revision || 0)
        : Number(runtime.meta.revision || 0);
      const result = unwrapRpc(await rpc("zy_save_state", {
        p_household_id: runtime.meta.householdId,
        p_expected_revision: expectedRevision,
        p_payload: payload,
        p_device_id: runtime.meta.deviceId,
        p_app_version: appVersion(),
        p_force: Boolean(force),
      }));
      if (result?.conflict) {
        runtime.meta.conflict = {
          kind: "revision",
          remoteRevision: Number(result.current_revision || 0),
          remotePayload: result.current_payload,
          remoteUpdatedAt: result.current_updated_at || "",
        };
        runtime.meta.dirty = true;
        saveMeta(); render();
        return result;
      }
      if (!result?.ok) throw new Error(result?.message || "同期に失敗しました");
      runtime.meta.revision = Number(result.revision || expectedRevision + 1);
      runtime.meta.lastSyncedHash = stableHash(payload);
      runtime.meta.lastSyncedAt = nowIso();
      runtime.meta.lastCloudUpdatedAt = result.updated_at || runtime.meta.lastSyncedAt;
      runtime.meta.dirty = false;
      runtime.meta.pendingSince = "";
      runtime.meta.conflict = null;
      saveMeta();
      await refreshBundleQuietly();
      return result;
    } catch (error) {
      runtime.lastError = error.message;
      runtime.meta.dirty = true;
      runtime.meta.pendingSince ||= nowIso();
      saveMeta();
      throw error;
    } finally { runtime.busy = false; render(); }
  }

  async function refreshBundleQuietly() {
    try {
      const result = unwrapRpc(await rpc("zy_get_bundle", {
        p_household_id: runtime.meta.householdId,
        p_device_id: runtime.meta.deviceId,
      }));
      if (result?.household) {
        runtime.bundle = result;
        emitBundle();
        runtime.meta.role = result.role || runtime.meta.role || "viewer";
        runtime.meta.plan = result.entitlement?.plan || runtime.meta.plan || "free";
        runtime.meta.lastCloudUpdatedAt = result.state?.updated_at || runtime.meta.lastCloudUpdatedAt || "";
        saveMeta();
      }
    } catch {}
  }

  function noteLocalChange() {
    if (!runtime.initialized || runtime.applyingRemote || runtime.recoveryMode) return;
    const hash = stateHash();
    if (hash === runtime.meta.lastSyncedHash) return;
    runtime.meta.dirty = true;
    runtime.meta.pendingSince ||= nowIso();
    saveMeta();
    render();
    if (runtime.meta.autoSync && signedIn() && runtime.meta.householdId && ["owner", "editor"].includes(runtime.meta.role)) schedulePush();
  }
  function schedulePush() {
    clearTimeout(runtime.saveTimer);
    runtime.saveTimer = setTimeout(() => {
      if (runtime.meta.dirty && !runtime.meta.conflict) push().catch(() => {});
    }, Number(runtime.config.autoSyncDelayMs || 1800));
  }
  function startPolling() {
    clearInterval(runtime.pollTimer);
    runtime.pollTimer = setInterval(() => {
      if (document.visibilityState === "visible" && navigator.onLine && signedIn() && runtime.meta.householdId && !runtime.busy) {
        pull().catch(() => {});
      }
    }, Math.max(15000, Number(runtime.config.syncIntervalMs || 60000)));
  }

  async function resolveConflict(choice) {
    const conflict = runtime.meta.conflict;
    if (!conflict) return;
    if (choice === "cloud") {
      applyRemoteState(conflict.remotePayload, conflict.remoteRevision, "競合解決前の端末データ");
      toast("クラウド版を採用しました");
      render();
      return;
    }
    if (choice === "local") {
      await push({ force: true });
      toast("この端末版でクラウドを更新しました");
    }
  }

  async function switchHousehold(householdId) {
    if (!householdId || householdId === runtime.meta.householdId) return;
    if (runtime.meta.dirty && !confirm("未同期の変更があります。家計を切り替えますか？")) return;
    runtime.meta.selectedHouseholdId = householdId;
    runtime.meta.householdId = householdId;
    runtime.meta.revision = 0;
    runtime.meta.lastSyncedHash = "";
    runtime.meta.dirty = false;
    runtime.meta.conflict = null;
    saveMeta();
    await pull({ force: true });
  }

  async function createCloudBackup(reason = "manual") {
    const result = unwrapRpc(await rpc("zy_create_backup", {
      p_household_id: runtime.meta.householdId,
      p_device_id: runtime.meta.deviceId,
      p_reason: reason,
    }));
    await refreshBundleQuietly(); render();
    return result;
  }
  async function restoreCloudBackup(backupId) {
    if (!confirm("このバックアップで現在のクラウドデータを置き換えますか？現在状態も復元前バックアップとして保存されます。")) return;
    const result = unwrapRpc(await rpc("zy_restore_backup", {
      p_household_id: runtime.meta.householdId,
      p_backup_id: backupId,
      p_device_id: runtime.meta.deviceId,
      p_expected_revision: Number(runtime.meta.revision || 0),
    }));
    if (!result?.ok) throw new Error(result?.message || "復元に失敗しました");
    applyRemoteState(result.payload, result.revision, "クラウドバックアップ復元前");
    await refreshBundleQuietly(); render();
  }
  async function createInvite(role) {
    const result = unwrapRpc(await rpc("zy_create_invite", {
      p_household_id: runtime.meta.householdId,
      p_role: role,
      p_device_id: runtime.meta.deviceId,
      p_expires_hours: 168,
    }));
    runtime.bundle.lastInvite = result;
    render();
    return result;
  }
  async function acceptInvite(code) {
    const result = unwrapRpc(await rpc("zy_accept_invite", {
      p_code: String(code || "").trim().toUpperCase(),
      p_device_id: runtime.meta.deviceId,
      p_device_name: runtime.meta.deviceName,
      p_platform: platformName(),
      p_app_version: appVersion(),
    }));
    await receiveBundle(result, { forceCloud: true });
    startPolling(); render();
  }
  async function updateMemberRole(userId, role) {
    await rpc("zy_update_member_role", {
      p_household_id: runtime.meta.householdId,
      p_member_user_id: userId,
      p_role: role,
      p_device_id: runtime.meta.deviceId,
    });
    await refreshBundleQuietly(); render();
  }
  async function removeMember(userId) {
    if (!confirm("このメンバーを家計から外しますか？")) return;
    await rpc("zy_remove_member", {
      p_household_id: runtime.meta.householdId,
      p_member_user_id: userId,
      p_device_id: runtime.meta.deviceId,
    });
    await refreshBundleQuietly(); render();
  }
  async function transferOwnership(userId) {
    if (!confirm("このメンバーへ家計の所有権を移しますか？移管後、あなたは編集メンバーになります。")) return;
    await rpc("zy_transfer_ownership", {
      p_household_id: runtime.meta.householdId,
      p_new_owner_user_id: userId,
      p_device_id: runtime.meta.deviceId,
    });
    await refreshBundleQuietly(); render();
  }
  async function leaveHousehold() {
    if (!confirm("この共有家計から退出しますか？この端末に残るデータは復旧コピーへ保存されます。")) return;
    saveRecovery("共有家計退出前", getState());
    await rpc("zy_leave_household", {
      p_household_id: runtime.meta.householdId,
      p_device_id: runtime.meta.deviceId,
    });
    runtime.meta.householdId = "";
    runtime.meta.revision = 0;
    runtime.bundle = null;
    saveMeta();
    await bootstrap(); render();
  }
  async function renameHousehold(name) {
    await rpc("zy_rename_household", {
      p_household_id: runtime.meta.householdId,
      p_name: name,
      p_device_id: runtime.meta.deviceId,
    });
    await refreshBundleQuietly(); render();
  }
  async function revokeDevice(deviceId) {
    if (!confirm("この端末からの今後の同期を停止しますか？")) return;
    await rpc("zy_revoke_device", {
      p_household_id: runtime.meta.householdId,
      p_target_device_id: deviceId,
      p_current_device_id: runtime.meta.deviceId,
    });
    await refreshBundleQuietly(); render();
  }
  async function deleteCloudAccount() {
    const typed = prompt("クラウドアカウントとクラウド上の個人データを削除します。確認のため「削除」と入力してください。");
    if (typed !== "削除") return;
    await ensureSession();
    const response = await fetch(`${runtime.config.supabaseUrl}/functions/v1/${encodeURIComponent(runtime.config.accountDeleteFunction || "delete-account")}`, {
      method: "POST",
      headers: {
        apikey: runtime.config.supabasePublishableKey,
        Authorization: `Bearer ${runtime.session.access_token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ confirmation: "削除" }),
    });
    await parseResponse(response);
    saveSession(null);
    runtime.bundle = null;
    runtime.meta = { ...defaultMeta(), deviceId: runtime.meta.deviceId, deviceName: runtime.meta.deviceName };
    saveMeta();
    toast("クラウドアカウントを削除しました。端末内データは残しています。");
    render();
  }

  function syncLabel() {
    if (!configReady()) return ["端末のみ", "warn"];
    if (!signedIn()) return ["未ログイン", "warn"];
    if (!navigator.onLine) return [runtime.meta.dirty ? "オフライン・未同期" : "オフライン", "warn"];
    if (runtime.meta.conflict) return ["競合あり", "danger"];
    if (runtime.busy) return ["同期中", "warn"];
    if (runtime.meta.dirty) return ["未同期", "warn"];
    return ["クラウド同期済み", "ok"];
  }
  function roleLabel(role) { return ({ owner: "所有者", editor: "編集可", viewer: "閲覧のみ" })[role] || role || "—"; }
  function formatDate(value) {
    if (!value) return "—";
    try { return new Date(value).toLocaleString("ja-JP"); } catch { return String(value); }
  }

  function configHtml() {
    const c = runtime.config;
    if (c.lockConfig) return `<div class="zy-cloud-section"><div class="zy-cloud-row"><div><strong>クラウド接続先：配布版で固定</strong><div class="list-meta">利用者が管理者用接続先へ変更できない本番向け設定です。</div></div><span class="pill ${configReady() ? "ok" : "danger"}">${configReady() ? "設定済み" : "設定不備"}</span></div><label style="margin-top:9px">端末名<input id="zyCloudLockedDeviceName" value="${html(runtime.meta.deviceName)}" maxlength="50"></label><button class="btn btn-small" data-cloud-action="save-device-name" type="button" style="margin-top:8px">端末名を保存</button></div>`;
    return `<details class="zy-cloud-section" ${configReady() ? "" : "open"}>
      <summary><strong>Supabase接続設定</strong><span class="small" style="display:block">無料プロジェクトのURLとpublishable/anonキー</span></summary>
      <div class="zy-cloud-grid" style="margin-top:10px">
        <label>Project URL<input id="zyCloudUrl" inputmode="url" value="${html(c.supabaseUrl)}" placeholder="https://xxxxx.supabase.co"></label>
        <label>Publishable / anon key<input id="zyCloudKey" type="password" value="${html(c.supabasePublishableKey)}" autocomplete="off" placeholder="sb_publishable_... または anon JWT"></label>
        <label>端末名<input id="zyCloudDeviceName" value="${html(runtime.meta.deviceName)}" maxlength="50"></label>
        <label class="zy-cloud-switch"><input id="zyCloudEnabled" type="checkbox" ${c.enabled ? "checked" : ""}><span>クラウド機能を有効化</span></label>
      </div>
      <p class="zy-cloud-form-note">公開キーはブラウザ配置を前提としますが、RLS設定が必須です。service_role、sb_secret_*、Stripe秘密鍵は入力できません。</p>
      <div class="zy-cloud-actions"><button class="btn btn-primary" data-cloud-action="save-config" type="button">設定を保存</button><button class="btn" data-cloud-action="clear-config" type="button">端末内モードへ戻す</button></div>
    </details>`;
  }

  function authHtml() {
    if (signedIn()) {
      return `<div class="zy-cloud-section"><div class="zy-cloud-row"><div><strong>${html(runtime.session.user?.email || "ログイン中")}</strong><div class="list-meta">ユーザーID ${html(String(runtime.session.user?.id || "").slice(0, 8))}…</div></div><div class="zy-cloud-actions"><button class="btn btn-small" data-cloud-action="sign-out" type="button">ログアウト</button></div></div></div>`;
    }
    return `<div class="zy-cloud-section"><h3>ログイン・新規登録</h3><div class="zy-cloud-grid" style="margin-top:8px">
      <label>メールアドレス<input id="zyCloudEmail" type="email" autocomplete="email"></label>
      <label>パスワード<input id="zyCloudPassword" type="password" minlength="8" autocomplete="current-password"></label>
      <label>表示名（新規登録時）<input id="zyCloudDisplayName" maxlength="40" autocomplete="name"></label>
    </div><div class="zy-cloud-actions" style="margin-top:8px"><button class="btn btn-primary" data-cloud-action="sign-in" type="button">ログイン</button><button class="btn" data-cloud-action="sign-up" type="button">新規登録</button><button class="btn btn-ghost" data-cloud-action="reset-password" type="button">再設定メール</button></div>
      <p class="zy-cloud-form-note">メール確認を有効にしたSupabaseでは、登録後に確認メールの操作が必要です。</p></div>`;
  }

  function syncHtml() {
    if (!signedIn() || !runtime.bundle) return "";
    const b = runtime.bundle;
    const households = Array.isArray(b.households) ? b.households : [];
    const stateKb = (stateBytes() / 1024).toFixed(1);
    return `<div class="zy-cloud-section"><div class="section-head"><div><h3>複数端末同期</h3><p class="small">同じアカウントでWeb・PWA・iOS・Android版を同期します。無料プランは1端末、Premiumは複数端末です。</p></div></div>
      ${households.length > 1 ? `<label>使用する家計<select id="zyCloudHouseholdSelect">${households.map((x) => `<option value="${html(x.id)}" ${x.id === runtime.meta.householdId ? "selected" : ""}>${html(x.name)}（${html(roleLabel(x.role))}）</option>`).join("")}</select></label>` : ""}
      <div class="zy-cloud-grid-3" style="margin-top:9px"><div class="zy-cloud-kpi">クラウド版<strong>rev.${Number(runtime.meta.revision || 0)}</strong></div><div class="zy-cloud-kpi">端末データ<strong>${stateKb} KB</strong></div><div class="zy-cloud-kpi">最終同期<strong>${html(runtime.meta.lastSyncedAt ? new Date(runtime.meta.lastSyncedAt).toLocaleTimeString("ja-JP", {hour:"2-digit",minute:"2-digit"}) : "未実施")}</strong></div></div>
      <label class="zy-cloud-switch" style="margin-top:10px"><input id="zyCloudAutoSync" type="checkbox" ${runtime.meta.autoSync ? "checked" : ""}><span>変更後に自動同期する</span></label>
      <div class="zy-cloud-actions" style="margin-top:9px"><button class="btn btn-primary" data-cloud-action="sync-now" type="button" ${runtime.busy ? "disabled" : ""}>今すぐ同期</button><button class="btn" data-cloud-action="upload-local" type="button">この端末版を送る</button><button class="btn" data-cloud-action="download-cloud" type="button">クラウド版を取得</button></div>
      ${runtime.lastError ? `<div class="alert danger" style="margin-top:9px">${html(runtime.lastError)}</div>` : ""}
    </div>`;
  }

  function conflictHtml() {
    const c = runtime.meta.conflict;
    if (!c) return "";
    return `<div class="zy-cloud-section zy-cloud-conflict"><strong>同期競合があります</strong><p class="small">別端末のクラウド版 rev.${Number(c.remoteRevision || 0)} と、この端末の変更が両方あります。採用しなかった側は端末内復旧コピーまたはクラウドバックアップとして残します。</p><div class="zy-cloud-actions"><button class="btn btn-primary" data-cloud-action="resolve-cloud" type="button">クラウド版を採用</button><button class="btn" data-cloud-action="resolve-local" type="button">この端末版を採用</button></div></div>`;
  }

  function familyHtml() {
    if (!signedIn() || !runtime.bundle) return "";
    const b = runtime.bundle;
    const members = Array.isArray(b.members) ? b.members : [];
    const owner = runtime.meta.role === "owner";
    const invite = b.lastInvite;
    return `<div class="zy-cloud-section"><div class="section-head"><div><h3>家族共有</h3><p class="small">Premium機能です。7日間有効・1回利用の招待コードを共有します。</p></div><span class="zy-cloud-role">${html(roleLabel(runtime.meta.role))}</span></div>
      ${owner ? `<div class="zy-cloud-grid"><label>家計名<input id="zyCloudHouseholdName" value="${html(b.household?.name || "")}" maxlength="60"></label><div style="align-self:end"><button class="btn" data-cloud-action="rename-household" type="button">名称変更</button></div><label>招待権限<select id="zyCloudInviteRole"><option value="editor">編集可</option><option value="viewer">閲覧のみ</option></select></label><div style="align-self:end"><button class="btn btn-primary" data-cloud-action="create-invite" type="button">招待コード作成</button></div></div>` : ""}
      ${invite?.code ? `<div style="margin-top:9px"><div class="zy-cloud-code">${html(invite.code)}</div><p class="small">有効期限 ${html(formatDate(invite.expires_at))}</p></div>` : ""}
      <details style="margin-top:10px" open><summary><strong>メンバー ${members.length}人</strong></summary><div>${members.map((m) => `<div class="zy-cloud-row"><div><strong>${html(m.display_name || m.email || "メンバー")}</strong><div class="list-meta">${html(m.email || "")}・${html(roleLabel(m.role))}</div></div>${owner && m.role !== "owner" ? `<div class="zy-cloud-actions"><select data-cloud-member-role="${html(m.user_id)}" aria-label="権限"><option value="editor" ${m.role === "editor" ? "selected" : ""}>編集可</option><option value="viewer" ${m.role === "viewer" ? "selected" : ""}>閲覧のみ</option></select><button class="btn btn-small" data-cloud-transfer-owner="${html(m.user_id)}" type="button">所有権移管</button><button class="btn btn-small btn-danger" data-cloud-remove-member="${html(m.user_id)}" type="button">解除</button></div>` : ""}</div>`).join("")}</div></details>
      <details style="margin-top:10px"><summary><strong>招待コードで参加</strong></summary><div class="zy-cloud-grid" style="margin-top:8px"><label>招待コード<input id="zyCloudInviteCode" maxlength="16" style="text-transform:uppercase"></label><div style="align-self:end"><button class="btn" data-cloud-action="accept-invite" type="button">参加する</button></div></div></details>
      ${!owner ? `<div style="margin-top:10px"><button class="btn btn-danger" data-cloud-action="leave-household" type="button">この共有家計から退出</button></div>` : ""}
    </div>`;
  }

  function backupsHtml() {
    if (!signedIn() || !runtime.bundle) return "";
    const backups = Array.isArray(runtime.bundle.backups) ? runtime.bundle.backups : [];
    const recovery = recoveryList();
    return `<div class="zy-cloud-section"><div class="section-head"><div><h3>自動・クラウドバックアップ</h3><p class="small">手動バックアップは全プラン、日次自動バックアップ30日保持はPremiumです。</p></div><button class="btn btn-small" data-cloud-action="create-backup" type="button">今保存</button></div>
      <details ${backups.length ? "open" : ""}><summary><strong>クラウド ${backups.length}件</strong></summary>${backups.length ? backups.map((x) => `<div class="zy-cloud-row"><div><strong>${html(x.reason || "backup")}</strong><div class="list-meta">rev.${Number(x.revision || 0)}・${html(formatDate(x.created_at))}</div></div><button class="btn btn-small" data-cloud-restore-backup="${html(x.id)}" type="button">復元</button></div>`).join("") : `<p class="small">まだありません。</p>`}</details>
      <details style="margin-top:8px"><summary><strong>端末内の競合・復旧コピー ${recovery.length}件</strong></summary>${recovery.length ? recovery.map((x) => `<div class="zy-cloud-row"><div><strong>${html(x.label)}</strong><div class="list-meta">${html(formatDate(x.createdAt))}</div></div><button class="btn btn-small" data-cloud-restore-local="${html(x.id)}" type="button">復元</button></div>`).join("") : `<p class="small">まだありません。</p>`}</details>
    </div>`;
  }

  function devicesHtml() {
    if (!signedIn() || !runtime.bundle) return "";
    const devices = Array.isArray(runtime.bundle.devices) ? runtime.bundle.devices : [];
    return `<div class="zy-cloud-section"><h3>端末管理</h3><p class="small">失った端末を無効化すると、その端末IDからの同期RPCを拒否します。</p>${devices.map((d) => `<div class="zy-cloud-row"><div><strong>${html(d.name || d.platform || "端末")}${d.device_id === runtime.meta.deviceId ? "（この端末）" : ""}</strong><div class="list-meta">${html(d.platform || "")}・最終 ${html(formatDate(d.last_seen_at))}${d.revoked_at ? `・無効 ${html(formatDate(d.revoked_at))}` : ""}</div></div>${!d.revoked_at && d.device_id !== runtime.meta.deviceId ? `<button class="btn btn-small btn-danger" data-cloud-revoke-device="${html(d.device_id)}" type="button">無効化</button>` : ""}</div>`).join("")}</div>`;
  }

  function planHtml() {
    if (!signedIn() || !runtime.bundle) return "";
    const e = runtime.bundle.entitlement || { plan: "free", status: "active" };
    const premium = e.plan !== "free" && ["active","trialing","grace"].includes(e.status || "active") && (!e.valid_until || Date.parse(e.valid_until) > Date.now());
    const detail = [e.source || "internal", e.product_id || "", e.valid_until ? `期限 ${formatDate(e.valid_until)}` : "", e.will_renew ? "自動更新" : ""].filter(Boolean).join("・");
    return `<div class="zy-cloud-section"><div class="zy-cloud-row"><div><strong>利用プラン：${premium ? "Premium" : "無料"}</strong><div class="list-meta">状態 ${html(e.status || "active")}${detail ? `・${html(detail)}` : ""}</div></div><span class="pill ${premium ? "ok" : ""}">${premium ? "RevenueCat確認済み" : "Free"}</span></div></div>`;
  }

  function dangerHtml() {
    if (!signedIn()) return "";
    return `<details class="zy-cloud-section zy-cloud-danger"><summary><strong>クラウドアカウント削除</strong></summary><p class="small">クラウド上の家計・会員情報・認証アカウントを削除します。端末内データは自動削除しません。共有家計の所有者は、先に所有権整理が必要です。</p><button class="btn btn-danger" data-cloud-action="delete-account" type="button">クラウドアカウントを削除</button></details>`;
  }

  function render() {
    const root = document.getElementById("cloudSettingsRoot");
    const header = document.getElementById("cloudHeaderStatus");
    const banner = document.getElementById("cloudBanner");
    const privacy = document.getElementById("cloudPrivacyText");
    const footer = document.getElementById("cloudFooterPrivacy");
    const [label, tone] = syncLabel();
    if (header) { header.textContent = label; header.className = `pill ${tone}`; }
    if (privacy) privacy.textContent = configReady() && signedIn()
      ? "クラウド同期を有効にした場合、家計データを設定済みSupabaseへ暗号化通信で送信します。銀行・カード会社への直接接続はありません。"
      : "クラウド未設定・未ログイン時は、この端末のブラウザ保存領域だけを使用します。銀行・カード会社への直接接続はありません。";
    if (footer) footer.textContent = configReady() && signedIn() ? "クラウド同期は任意。ログアウト後も端末内データは保持されます。" : "端末内モード。入力データは外部送信されません。";
    if (banner) {
      const conflict = runtime.meta?.conflict;
      const pendingOffline = signedIn() && runtime.meta?.dirty && !navigator.onLine;
      if (conflict) {
        banner.className = "alert danger zy-cloud-banner";
        banner.innerHTML = `<strong>同期競合があります。</strong><div class="row-actions"><button class="btn btn-small btn-primary" data-cloud-action="open-cloud-settings" type="button">設定で解決</button></div>`;
      } else if (pendingOffline) {
        banner.className = "alert warn zy-cloud-banner";
        banner.innerHTML = `<strong>オフラインのため変更を端末内に保持しています。</strong><div class="small">オンライン復帰後に自動同期します。</div>`;
      } else banner.className = "hidden";
    }
    if (!root) return;
    runtime.config = loadConfig();
    root.innerHTML = `<div class="zy-cloud-head"><div><h2>クラウド・家族共有</h2><p class="small">Supabase Freeを任意接続。未設定なら従来どおり端末内だけで動作します。</p></div><span class="pill ${tone}"><span class="zy-cloud-badge-dot"></span>&nbsp;${html(label)}</span></div>
      ${configHtml()}
      ${configReady() ? authHtml() : `<div class="alert warn" style="margin-top:10px">Supabaseを設定するまでログイン・同期は無効です。</div>`}
      ${conflictHtml()}${syncHtml()}${familyHtml()}${backupsHtml()}${devicesHtml()}${planHtml()}${dangerHtml()}`;
  }

  async function runAction(action, source) {
    try {
      if (runtime.busy && !["save-config", "clear-config"].includes(action)) return;
      if (action === "save-device-name") {
        runtime.meta.deviceName = String(document.getElementById("zyCloudLockedDeviceName")?.value || defaultDeviceName()).trim().slice(0, 50);
        saveMeta(); render(); toast("端末名を保存しました"); return;
      }
      if (action === "save-config") {
        if (runtime.config.lockConfig) throw new Error("配布版では接続設定が固定されています");
        const url = normalizeUrl(document.getElementById("zyCloudUrl")?.value);
        const key = String(document.getElementById("zyCloudKey")?.value || "").trim();
        if (rejectSecretKey(key)) throw new Error("秘密鍵はブラウザへ保存できません。publishable/anonキーを使用してください");
        if (url && !/^https:\/\//i.test(url)) throw new Error("Project URLはhttps://から入力してください");
        writeJson(CONFIG_KEY, {
          ...readJson(CONFIG_KEY, {}), enabled: Boolean(document.getElementById("zyCloudEnabled")?.checked),
          supabaseUrl: url, supabasePublishableKey: key,
        });
        runtime.meta.deviceName = String(document.getElementById("zyCloudDeviceName")?.value || defaultDeviceName()).trim().slice(0, 50);
        saveMeta(); runtime.config = loadConfig(); render(); toast("クラウド設定を保存しました");
        if (configReady() && signedIn()) await bootstrap();
        return;
      }
      if (action === "clear-config") {
        if (runtime.config.lockConfig) throw new Error("配布版では接続設定を解除できません。ログアウトを使用してください");
        if (!confirm("Supabase接続設定とログイン状態をこの端末から消しますか？家計データは残ります。")) return;
        removeKey(CONFIG_KEY); saveSession(null); runtime.config = loadConfig(); runtime.bundle = null;
        runtime.meta.householdId = ""; runtime.meta.revision = 0; runtime.meta.dirty = false; runtime.meta.conflict = null; saveMeta(); render(); return;
      }
      if (action === "sign-in" || action === "sign-up") {
        const email = String(document.getElementById("zyCloudEmail")?.value || "").trim();
        const password = String(document.getElementById("zyCloudPassword")?.value || "");
        if (!email || password.length < 8) throw new Error("メールアドレスと8文字以上のパスワードを入力してください");
        runtime.busy = true; render();
        if (action === "sign-in") await authSignIn(email, password);
        else {
          const data = await authSignUp(email, password, document.getElementById("zyCloudDisplayName")?.value || "");
          if (!data?.access_token) { toast("確認メールを送信しました。確認後にログインしてください"); runtime.busy = false; render(); return; }
        }
        await bootstrap(); toast("ログインしました"); return;
      }
      if (action === "reset-password") {
        const email = String(document.getElementById("zyCloudEmail")?.value || "").trim();
        if (!email) throw new Error("メールアドレスを入力してください");
        await sendPasswordReset(email); toast("パスワード再設定メールを送信しました"); return;
      }
      if (action === "sign-out") { await authSignOut(); toast("ログアウトしました"); return; }
      if (action === "sync-now") { if (runtime.meta.dirty) await push(); else await pull(); toast("同期しました"); return; }
      if (action === "upload-local") {
        if (!confirm("この端末のデータをクラウド版として保存しますか？競合時は確認画面を表示します。")) return;
        runtime.meta.dirty = true; await push({ force: Boolean(runtime.meta.conflict) }); toast("この端末版を送信しました"); return;
      }
      if (action === "download-cloud") {
        if (!confirm("クラウド版をこの端末へ読み込みますか？現在の端末データは復旧コピーへ保存します。")) return;
        await pull({ force: true }); toast("クラウド版を取得しました"); return;
      }
      if (action === "resolve-cloud") return resolveConflict("cloud");
      if (action === "resolve-local") return resolveConflict("local");
      if (action === "create-backup") { await createCloudBackup("manual"); toast("クラウドバックアップを作成しました"); return; }
      if (action === "create-invite") {
        const r = await createInvite(document.getElementById("zyCloudInviteRole")?.value || "editor");
        toast(`招待コード ${r.code} を作成しました`); return;
      }
      if (action === "accept-invite") {
        const code = document.getElementById("zyCloudInviteCode")?.value || "";
        if (!code.trim()) throw new Error("招待コードを入力してください");
        await acceptInvite(code); toast("共有家計へ参加しました"); return;
      }
      if (action === "rename-household") {
        const name = String(document.getElementById("zyCloudHouseholdName")?.value || "").trim();
        if (!name) throw new Error("家計名を入力してください");
        await renameHousehold(name); toast("家計名を変更しました"); return;
      }
      if (action === "leave-household") { await leaveHousehold(); toast("共有家計から退出しました"); return; }
      if (action === "delete-account") return deleteCloudAccount();
      if (action === "open-cloud-settings") {
        window.setView?.("settings"); document.getElementById("cloudSettingsRoot")?.scrollIntoView({ behavior: "smooth", block: "start" }); return;
      }
    } catch (error) {
      runtime.lastError = error.message;
      toast(error.message);
      console.error("ZandakaCloud", error);
    } finally {
      runtime.busy = false; render();
    }
  }

  function bindEvents() {
    document.addEventListener("click", (event) => {
      const button = event.target.closest?.("[data-cloud-action]");
      if (button) { event.preventDefault(); runAction(button.dataset.cloudAction, button); return; }
      const restore = event.target.closest?.("[data-cloud-restore-backup]");
      if (restore) restoreCloudBackup(restore.dataset.cloudRestoreBackup).catch((e) => toast(e.message));
      const local = event.target.closest?.("[data-cloud-restore-local]");
      if (local) {
        const item = recoveryList().find((x) => x.id === local.dataset.cloudRestoreLocal);
        if (item && confirm("この端末内復旧コピーを読み込みますか？")) {
          saveRecovery("復旧コピー適用前", getState());
          runtime.recoveryMode = true; try { setState(item.payload); } finally { runtime.recoveryMode = false; }
          runtime.meta.dirty = true; runtime.meta.pendingSince ||= nowIso(); saveMeta(); render();
        }
      }
      const remove = event.target.closest?.("[data-cloud-remove-member]");
      if (remove) removeMember(remove.dataset.cloudRemoveMember).catch((e) => toast(e.message));
      const transfer = event.target.closest?.("[data-cloud-transfer-owner]");
      if (transfer) transferOwnership(transfer.dataset.cloudTransferOwner).catch((e) => toast(e.message));
      const revoke = event.target.closest?.("[data-cloud-revoke-device]");
      if (revoke) revokeDevice(revoke.dataset.cloudRevokeDevice).catch((e) => toast(e.message));
    });
    document.addEventListener("change", (event) => {
      if (event.target.id === "zyCloudAutoSync") {
        runtime.meta.autoSync = event.target.checked; saveMeta(); render();
        if (runtime.meta.autoSync && runtime.meta.dirty) schedulePush();
      }
      if (event.target.id === "zyCloudHouseholdSelect") switchHousehold(event.target.value).catch((e) => toast(e.message));
      const member = event.target.dataset?.cloudMemberRole;
      if (member) updateMemberRole(member, event.target.value).catch((e) => toast(e.message));
    });
    window.addEventListener("online", () => {
      render();
      if (runtime.meta.dirty && signedIn()) push().catch(() => {}); else if (signedIn()) pull().catch(() => {});
    });
    window.addEventListener("offline", render);
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible" && navigator.onLine && signedIn()) pull().catch(() => {});
    });
  }

  function patchCore() {
    if (runtime.originalSaveState) return;
    runtime.originalSaveState = window.saveState;
    if (typeof runtime.originalSaveState === "function") {
      window.saveState = function patchedSaveState(...args) {
        const result = runtime.originalSaveState.apply(this, args);
        queueMicrotask(noteLocalChange);
        return result;
      };
    }
    runtime.originalRender = window.render;
    if (typeof runtime.originalRender === "function") {
      window.render = function patchedRender(...args) {
        const result = runtime.originalRender.apply(this, args);
        queueMicrotask(render);
        return result;
      };
    }
  }

  function parseAuthRedirect() {
    const params = new URLSearchParams(location.hash.replace(/^#/, ""));
    if (!params.get("access_token")) return false;
    const session = normalizeSession({
      access_token: params.get("access_token"), refresh_token: params.get("refresh_token"),
      token_type: params.get("token_type"), expires_in: params.get("expires_in"),
      user: runtime.session?.user || null,
    });
    if (!session) return false;
    saveSession(session);
    history.replaceState(null, "", `${location.pathname}${location.search}`);
    if (params.get("type") === "recovery") {
      setTimeout(() => {
        modal("新しいパスワード", `<label>新しいパスワード<input id="zyRecoveryPassword" type="password" minlength="8" autocomplete="new-password"></label><button id="zyRecoverySave" class="btn btn-primary" style="margin-top:10px" type="button">変更する</button>`);
        document.getElementById("zyRecoverySave").onclick = async () => {
          const p = document.getElementById("zyRecoveryPassword").value;
          if (p.length < 8) return toast("8文字以上にしてください");
          try { await updatePassword(p); window.closeModal?.(); toast("パスワードを変更しました"); await bootstrap(); }
          catch (e) { toast(e.message); }
        };
      }, 50);
    }
    return true;
  }

  async function hydrateUser() {
    if (!runtime.session?.access_token || runtime.session?.user?.id) return;
    try {
      const user = await rawFetch("/auth/v1/user", { method: "GET" });
      runtime.session.user = user; saveSession(runtime.session);
    } catch {
      saveSession(null);
    }
  }

  async function init() {
    if (runtime.initialized) return;
    runtime.config = loadConfig();
    runtime.meta = loadMeta();
    runtime.session = loadSession();
    runtime.initialized = true;
    patchCore(); bindEvents(); parseAuthRedirect(); render();
    if (configReady() && runtime.session) {
      try { await hydrateUser(); if (signedIn()) await bootstrap(); }
      catch (error) { runtime.lastError = error.message; render(); }
    }
    startPolling();
  }

  window.ZandakaCloud = {
    init, render, push, pull, bootstrap, resolveConflict, createCloudBackup, invokeFunction,
    isSignedIn: signedIn,
    getUserId: () => runtime.session?.user?.id || "",
    getAccessToken: () => runtime.session?.access_token || "",
    refreshEntitlementBundle: async () => { await refreshBundleQuietly(); render(); return runtime.bundle; },
    getRuntime: () => JSON.parse(JSON.stringify({
      config: runtime.config, session: runtime.session, meta: runtime.meta, bundle: runtime.bundle,
      busy: runtime.busy, lastError: runtime.lastError,
    })),
    __test: {
      stableHash, meaningfulState, stateBytes, noteLocalChange,
      setSession(value) { saveSession(value); render(); },
      setBundle(value) { runtime.bundle = value; emitBundle(); render(); },
      setMeta(value) { runtime.meta = { ...runtime.meta, ...value }; saveMeta(); render(); },
      receiveBundle, applyRemoteState, rpc,
    },
  };

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init, { once: true });
  else init();
})();
