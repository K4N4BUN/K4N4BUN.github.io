"use strict";
const APP_VERSION = "0.8.8",
  STORAGE_KEY = "zandaka-yohou-v1",
  RECOVERY_KEYS = [
    "zandaka-yohou-recovery-update",
    "zandaka-yohou-recovery-current",
    "zandaka-yohou-recovery-previous",
  ],
  LEGACY_KEYS = [
    "zandaka-yohou-html-v5",
    "zandaka-yohou-mvp-v4",
    "zandaka-yohou-mvp-v3",
    "zandaka-yohou-mvp-v1",
  ];
let storageAvailable = true;
let automaticSaveBlocked = false;
let stateLoadStatus = { source: "empty", recovered: false, error: "" };
const memoryStorage = new Map();
const {
  deepClone, yen, dateFmt, fullDateFmt, uid, toISODate, todayISO,
  parseISODate, isValidISODate, addDays, compareDates, sameDate, monthKey,
  daysBetween, intMoney, num, clampDay, esc, isoNow, ageDays,
} = window.ZYCore;
const { japaneseHolidaySet } = window.ZYCalendar;
function storageGet(key) {
  try {
    return localStorage.getItem(key);
  } catch {
    storageAvailable = false;
    return memoryStorage.get(key) ?? null;
  }
}
function storageSet(key, value) {
  memoryStorage.set(key, value);
  try {
    localStorage.setItem(key, value);
    return true;
  } catch {
    storageAvailable = false;
    return false;
  }
}
function storageRemove(key) {
  memoryStorage.delete(key);
  try {
    localStorage.removeItem(key);
  } catch {
    storageAvailable = false;
  }
}
function accountName(id) {
  return state.accounts.find((a) => a.id === id)?.name || "未設定";
}
const DEFAULT_HOUSEHOLD_CATEGORIES = [
  "食費",
  "日用品",
  "住居",
  "水道光熱",
  "通信",
  "交通",
  "医療",
  "保険",
  "衣服",
  "娯楽",
  "教育",
  "税・社会保険",
  "借入返済",
  "決済・返済",
  "給与",
  "副収入",
  "臨時収入",
  "その他",
];
const HOUSEHOLD_PAYMENT_METHODS = {
  cash: "現金",
  bank: "口座振替・振込",
  debit: "デビット・即時決済",
  credit: "クレジットカード",
  other: "その他",
};
function defaultHousehold() {
  return {
    selectedMonth: monthKey(new Date()),
    monthlyBudget: 0,
    defaultPaymentMethod: "debit",
    filterCategory: "all",
    categories: [...DEFAULT_HOUSEHOLD_CATEGORIES],
  };
}
function defaultState() {
  return {
    version: 9,
    appVersion: APP_VERSION,
    setupComplete: false,
    activeView: "household",
    calendarMonth: monthKey(new Date()),
    asOfDate: todayISO(),
    horizonDays: 90,
    forecastMode: "expected",
    defaultAccountId: "",
    scenarioSpend: 0,
    staleDays: 30,
    lastBackupAt: "",
    accounts: [],
    recurring: [],
    financing: [],
    oneOff: [],
    transfers: [],
    ledgerEntries: [],
    household: defaultHousehold(),
    calendar: {
      useWeekends: true,
      useNationalHolidays: true,
      useBankYearEnd: true,
      customClosures: [],
    },
  };
}
function wizardTemplateState() {
  const s = defaultState();
  const bank = uid();
  s.defaultAccountId = bank;
  s.accounts = [{
    id: bank,
    name: "メイン口座",
    balance: 0,
    buffer: 0,
    lastConfirmedAt: "",
    active: true,
  }];
  s.recurring = [
    sanitizeRecurring({name:"給与",kind:"income",accountId:bank,amount:0,day:25,shift:"previous",active:true}),
    sanitizeRecurring({name:"家賃・固定費",kind:"expense",accountId:bank,amount:0,day:27,shift:"next",active:true}),
    sanitizeRecurring({name:"クレジットカード",kind:"expense",accountId:bank,amount:0,day:5,shift:"next",amountMode:"buffer",bufferPercent:15,active:true}),
  ];
  return s;
}
function demoState() {
  const s = wizardTemplateState(),
    bank = s.accounts[0].id;
  s.setupComplete = true;
  s.accounts[0] = {
    ...s.accounts[0],
    name: "給与口座",
    balance: 180000,
    buffer: 20000,
    lastConfirmedAt: isoNow(),
  };
  s.recurring[0] = {
    ...s.recurring[0],
    amount: 260000,
    minAmount: 260000,
    maxAmount: 260000,
  };
  s.recurring[1] = {
    ...s.recurring[1],
    name: "家賃",
    amount: 65000,
    minAmount: 65000,
    maxAmount: 65000,
  };
  s.recurring[2] = {
    ...s.recurring[2],
    amount: 48000,
    minAmount: 35000,
    maxAmount: 65000,
    lastConfirmedAt: isoNow(),
  };
  const card = sanitizeAccount({
    name: "カード引落口座",
    balance: 50000,
    buffer: 10000,
    lastConfirmedAt: isoNow(),
  });
  s.accounts.push(card);
  s.recurring[2].accountId = card.id;
  s.recurring[2].confirmedByMonth[monthKey(parseISODate(s.asOfDate))] = 53500;
  s.financing.push(
    sanitizeFinancing({
      name: "リボ残高",
      accountId: card.id,
      principal: 220000,
      apr: 15,
      paymentRule: "fixedTotal",
      paymentAmount: 20000,
      paymentDay: 27,
      shift: "next",
      lastPaymentDate: toISODate(addDays(parseISODate(s.asOfDate), -30)),
      lateRate: 20,
    }),
  );
  s.transfers.push({
    id: uid(),
    name: "引落資金移動",
    fromAccountId: bank,
    toAccountId: card.id,
    amount: 60000,
    date: toISODate(addDays(parseISODate(s.asOfDate), 5)),
  });
  s.household.monthlyBudget = 120000;
  const demoDate = parseISODate(s.asOfDate);
  s.household.selectedMonth = monthKey(demoDate);
  s.ledgerEntries = [
    sanitizeLedgerEntry({name:"スーパー",kind:"expense",amount:4680,category:"食費",date:toISODate(addDays(demoDate,-2)),accountId:bank,paymentMethod:"debit",affectsBalance:false,note:"デモ：現在残高へ反映済み"}),
    sanitizeLedgerEntry({name:"ドラッグストア",kind:"expense",amount:2380,category:"日用品",date:toISODate(addDays(demoDate,-4)),accountId:card.id,paymentMethod:"credit",affectsBalance:false,note:"デモ：カード請求で予報へ反映"}),
    sanitizeLedgerEntry({name:"外食",kind:"expense",amount:3200,category:"食費",date:toISODate(addDays(demoDate,-6)),accountId:card.id,paymentMethod:"credit",affectsBalance:false}),
    sanitizeLedgerEntry({name:"副収入",kind:"income",amount:12000,category:"副収入",date:toISODate(addDays(demoDate,-8)),accountId:bank,paymentMethod:"bank",affectsBalance:false,note:"デモ：現在残高へ反映済み"}),
  ];
  return s;
}
function migrateV3(raw) {
  const base = wizardTemplateState(),
    aid = base.accounts[0].id;
  base.setupComplete = true;
  base.asOfDate = isValidISODate(raw.asOfDate) ? raw.asOfDate : base.asOfDate;
  base.horizonDays = [30, 60, 90, 180, 365].includes(Number(raw.horizonDays))
    ? Number(raw.horizonDays)
    : 90;
  base.forecastMode = raw.forecastMode || "expected";
  base.scenarioSpend = Math.max(0, intMoney(raw.scenarioSpend));
  base.accounts[0].balance = intMoney(raw.currentBalance, 180000);
  base.accounts[0].buffer = Math.max(0, intMoney(raw.minimumBuffer, 20000));
  base.recurring = [];
  if (Number(raw.incomeAmount) > 0)
    base.recurring.push(
      sanitizeRecurring({
        name: "給与",
        kind: "income",
        accountId: aid,
        amount: raw.incomeAmount,
        day: raw.incomeDay,
        offsetDays: raw.incomeOffsetDays,
        shift: raw.incomeShift,
        amountMode: "fixed",
        active: true,
      }),
    );
  for (const e of raw.recurring || [])
    base.recurring.push(
      sanitizeRecurring({
        ...e,
        kind: "expense",
        accountId: aid,
        confirmedByMonth: e.overrideMonth
          ? { [e.overrideMonth]: e.overrideAmount }
          : {},
      }),
    );
  base.financing = (raw.financing || []).map((x) =>
    sanitizeFinancing({ ...x, accountId: aid }),
  );
  base.oneOff = (raw.oneOff || []).map((x) =>
    sanitizeOneOff({ ...x, accountId: aid }),
  );
  base.calendar = raw.calendar || base.calendar;
  return base;
}
function sanitizeAccount(a) {
  return {
    id: a?.id || uid(),
    name: String(a?.name || "口座"),
    balance: intMoney(a?.balance),
    buffer: Math.max(0, intMoney(a?.buffer)),
    lastConfirmedAt: a?.lastConfirmedAt || "",
    active: a?.active !== false,
  };
}
function sanitizeRecurring(e) {
  const amount = Math.max(0, intMoney(e?.amount));
  const min = Math.max(0, intMoney(e?.minAmount, amount));
  return {
    id: e?.id || uid(),
    name: String(e?.name || "毎月の入出金"),
    kind: e?.kind === "income" ? "income" : "expense",
    accountId: String(e?.accountId || ""),
    amount,
    day: Math.min(31, Math.max(1, Math.trunc(Number(e?.day)) || 1)),
    offsetDays: Math.min(
      31,
      Math.max(-31, Math.trunc(Number(e?.offsetDays)) || 0),
    ),
    shift: ["none", "previous", "next"].includes(e?.shift) ? e.shift : "next",
    amountMode: ["fixed", "buffer", "range"].includes(e?.amountMode)
      ? e.amountMode
      : "fixed",
    bufferPercent: Math.min(500, Math.max(0, num(e?.bufferPercent))),
    minAmount: min,
    maxAmount: Math.max(min, intMoney(e?.maxAmount, amount)),
    confirmedByMonth:
      e?.confirmedByMonth && typeof e.confirmedByMonth === "object"
        ? e.confirmedByMonth
        : {},
    history: Array.isArray(e?.history)
      ? e.history
          .filter((x) => /^\d{4}-\d{2}$/.test(x.month))
          .map((x) => ({
            month: x.month,
            amount: Math.max(0, intMoney(x.amount)),
          }))
      : [],
    skipMonths: Array.isArray(e?.skipMonths)
      ? e.skipMonths.filter((x) => /^\d{4}-\d{2}$/.test(x))
      : [],
    active: e?.active !== false,
    lastConfirmedAt: e?.lastConfirmedAt || "",
  };
}
function sanitizeFinancing(a) {
  return {
    id: a?.id || uid(),
    name: String(a?.name || "リボ・ローン"),
    accountId: String(a?.accountId || ""),
    principal: Math.max(0, intMoney(a?.principal)),
    apr: Math.min(100, Math.max(0, num(a?.apr, 15))),
    paymentRule: ["fixedPrincipal", "fixedTotal"].includes(a?.paymentRule)
      ? a.paymentRule
      : "fixedPrincipal",
    paymentAmount: Math.max(0, intMoney(a?.paymentAmount, 10000)),
    paymentDay: Math.min(
      31,
      Math.max(1, Math.trunc(Number(a?.paymentDay)) || 1),
    ),
    offsetDays: Math.min(
      31,
      Math.max(-31, Math.trunc(Number(a?.offsetDays)) || 0),
    ),
    shift: ["none", "previous", "next"].includes(a?.shift) ? a.shift : "next",
    lastPaymentDate: isValidISODate(a?.lastPaymentDate)
      ? a.lastPaymentDate
      : "",
    dayCount: ["365", "actual"].includes(String(a?.dayCount))
      ? String(a.dayCount)
      : "365",
    rounding: ["floor", "round", "ceil"].includes(a?.rounding)
      ? a.rounding
      : "floor",
    futureRateDate: isValidISODate(a?.futureRateDate) ? a.futureRateDate : "",
    futureApr: Math.min(100, Math.max(0, num(a?.futureApr, num(a?.apr, 15)))),
    lateRate: Math.min(100, Math.max(0, num(a?.lateRate))),
    lateDays: Math.min(365, Math.max(0, Math.trunc(Number(a?.lateDays)) || 0)),
    lateBase: ["payment", "principal"].includes(a?.lateBase)
      ? a.lateBase
      : "payment",
    active: a?.active !== false,
    lastConfirmedAt: a?.lastConfirmedAt || "",
  };
}
function sanitizeOneOff(e) {
  return {
    id: e?.id || uid(),
    name: String(e?.name || "臨時入出金"),
    accountId: String(e?.accountId || ""),
    amount: intMoney(e?.amount),
    date: isValidISODate(e?.date) ? e.date : todayISO(),
    certainty: ["confirmed", "estimated"].includes(e?.certainty)
      ? e.certainty
      : "confirmed",
  };
}
function sanitizeLedgerEntry(e) {
  const kind = e?.kind === "income" ? "income" : e?.kind === "settlement" ? "settlement" : "expense";
  const paymentMethod = Object.prototype.hasOwnProperty.call(HOUSEHOLD_PAYMENT_METHODS, e?.paymentMethod)
    ? e.paymentMethod
    : "debit";
  return {
    id: e?.id || uid(),
    name: String(e?.name || (kind === "income" ? "収入" : kind === "settlement" ? "決済・返済" : "支出")),
    kind,
    amount: Math.max(0, intMoney(e?.amount)),
    category: String(e?.category || (kind === "income" ? "臨時収入" : kind === "settlement" ? "決済・返済" : "その他")),
    date: isValidISODate(e?.date) ? e.date : todayISO(),
    accountId: String(e?.accountId || ""),
    paymentMethod,
    affectsBalance: e?.affectsBalance === true,
    note: String(e?.note || ""),
    sourceKey: String(e?.sourceKey || ""),
    createdAt: e?.createdAt || isoNow(),
  };
}
function sanitizeHousehold(value) {
  const b = defaultHousehold(), h = value && typeof value === "object" ? value : {};
  const categories = Array.isArray(h.categories)
    ? [...new Set(h.categories.map((x) => String(x).trim()).filter(Boolean))]
    : b.categories;
  return {
    selectedMonth: /^\d{4}-\d{2}$/.test(h.selectedMonth) ? h.selectedMonth : b.selectedMonth,
    monthlyBudget: Math.max(0, intMoney(h.monthlyBudget)),
    defaultPaymentMethod: Object.prototype.hasOwnProperty.call(HOUSEHOLD_PAYMENT_METHODS, h.defaultPaymentMethod) ? h.defaultPaymentMethod : b.defaultPaymentMethod,
    filterCategory: String(h.filterCategory || "all"),
    categories: categories.length ? categories : [...DEFAULT_HOUSEHOLD_CATEGORIES],
  };
}
function sanitizeState(raw) {
  const b = defaultState();
  if (!raw || typeof raw !== "object") return b;
  if (!raw.version || raw.version < 4) return migrateV3(raw);
  const s = { ...b, ...raw };
  s.version = 9;
  s.appVersion = APP_VERSION;
  s.activeView = ["household", "home", "calendar", "register", "settings"].includes(raw.activeView) ? raw.activeView : b.activeView;
  s.accounts =
    Array.isArray(raw.accounts) && raw.accounts.length
      ? raw.accounts.map(sanitizeAccount)
      : b.accounts;
  s.defaultAccountId = s.accounts.some((a) => a.id === raw.defaultAccountId)
    ? raw.defaultAccountId
    : s.accounts[0]?.id || "";
  s.recurring = Array.isArray(raw.recurring)
    ? raw.recurring.map(sanitizeRecurring)
    : b.recurring;
  s.financing = Array.isArray(raw.financing)
    ? raw.financing.map(sanitizeFinancing)
    : [];
  s.oneOff = Array.isArray(raw.oneOff) ? raw.oneOff.map(sanitizeOneOff) : [];
  s.transfers = Array.isArray(raw.transfers)
    ? raw.transfers.map((t) => ({
        id: t?.id || uid(),
        name: String(t?.name || "口座間振替"),
        fromAccountId: String(t?.fromAccountId || ""),
        toAccountId: String(t?.toAccountId || ""),
        amount: Math.max(0, intMoney(t?.amount)),
        date: isValidISODate(t?.date) ? t.date : todayISO(),
      }))
    : [];
  s.household = sanitizeHousehold(raw.household);
  s.ledgerEntries = Array.isArray(raw.ledgerEntries) ? raw.ledgerEntries.map(sanitizeLedgerEntry) : [];
  for (const entry of s.ledgerEntries) if (!s.household.categories.includes(entry.category)) s.household.categories.push(entry.category);
  s.asOfDate = isValidISODate(raw.asOfDate) ? raw.asOfDate : todayISO();
  s.horizonDays = [30, 60, 90, 180, 365].includes(Number(raw.horizonDays))
    ? Number(raw.horizonDays)
    : 90;
  s.staleDays = Math.min(
    365,
    Math.max(1, Math.trunc(Number(raw.staleDays)) || 30),
  );
  s.calendar = {
    ...b.calendar,
    ...(raw.calendar || {}),
    customClosures: Array.isArray(raw.calendar?.customClosures)
      ? raw.calendar.customClosures.map((c) => ({
          id: c?.id || uid(),
          name: String(c?.name || "独自休業日"),
          date: isValidISODate(c?.date) ? c.date : s.asOfDate,
        }))
      : [],
  };
  return s;
}
function blankInitialState() {
  const s = defaultState();
  s.defaultAccountId = "";
  s.accounts = [];
  s.recurring = [];
  s.financing = [];
  s.oneOff = [];
  s.transfers = [];
  s.ledgerEntries = [];
  s.setupComplete = false;
  return s;
}
function isUntouchedLegacyTemplate(raw) {
  if (!raw || raw.setupComplete) return false;
  const accounts = Array.isArray(raw.accounts) ? raw.accounts : [];
  const recurring = Array.isArray(raw.recurring) ? raw.recurring : [];
  const noAmounts = accounts.every(a => Number(a?.balance || 0) === 0 && Number(a?.buffer || 0) === 0)
    && recurring.every(r => Number(r?.amount || 0) === 0 && !(r?.history?.length));
  const templateNames = accounts.length === 1 && accounts[0]?.name === "メイン口座"
    && recurring.length === 3
    && recurring.some(r => r?.name === "給与")
    && recurring.some(r => r?.name === "家賃・固定費")
    && recurring.some(r => r?.name === "クレジットカード");
  const noUserData = !(raw.oneOff?.length || raw.transfers?.length || raw.ledgerEntries?.length || raw.financing?.length);
  return noAmounts && templateNames && noUserData;
}
function ensureWizardSeed() {
  if (state.accounts.length && state.recurring.length) return;
  const seed = wizardTemplateState();
  state.accounts = seed.accounts;
  state.recurring = seed.recurring;
  state.defaultAccountId = seed.defaultAccountId;
}
function parseStoredState(text, source) {
  if (!text) return null;
  const raw = JSON.parse(text);
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error(`${source}: 保存形式が不正です`);
  return isUntouchedLegacyTemplate(raw) ? blankInitialState() : sanitizeState(raw);
}
function loadState() {
  const candidates = [
    [STORAGE_KEY, "primary"],
    ...RECOVERY_KEYS.map((key, index) => [key, `recovery-${index + 1}`]),
    ...LEGACY_KEYS.map((key) => [key, `legacy:${key}`]),
  ];
  const errors = [];
  for (const [key, source] of candidates) {
    const text = storageGet(key);
    if (!text) continue;
    try {
      const loaded = parseStoredState(text, source);
      stateLoadStatus = { source, recovered: source !== "primary", error: errors.join(" / ") };
      if (source !== "primary") {
        storageSet(STORAGE_KEY, JSON.stringify(loaded));
      }
      return loaded;
    } catch (error) {
      console.error(`保存データの読込失敗: ${source}`, error);
      errors.push(`${source}: ${error?.message || error}`);
    }
  }
  if (errors.length) {
    automaticSaveBlocked = true;
    stateLoadStatus = { source: "failed", recovered: false, error: errors.join(" / ") };
  } else {
    stateLoadStatus = { source: "empty", recovered: false, error: "" };
  }
  return blankInitialState();
}
function rotateRecoveryCopies(nextJson) {
  const current = storageGet(STORAGE_KEY);
  if (!current || current === nextJson) return;
  try {
    JSON.parse(current);
  } catch {
    return;
  }
  const previousRecovery = storageGet(RECOVERY_KEYS[1]);
  if (previousRecovery) storageSet(RECOVERY_KEYS[2], previousRecovery);
  storageSet(RECOVERY_KEYS[1], current);
}
function createUpdateRecoveryPoint(label = "update") {
  try {
    const json = JSON.stringify(state);
    JSON.parse(json);
    storageSet(RECOVERY_KEYS[0], json);
    return true;
  } catch (error) {
    console.error(`更新前復元点の作成失敗: ${label}`, error);
    return false;
  }
}
function setSaveStatus(ok = true) {
  const el = document.getElementById("saveStatus");
  if (!el) return;
  el.textContent = ok
    ? storageAvailable
      ? "自動保存済み"
      : "一時保存"
    : "保存失敗";
  el.className = `pill ${ok ? (storageAvailable ? "ok" : "warn") : "danger"}`;
}
function saveState(options = {}) {
  if (automaticSaveBlocked && options.force !== true) {
    setSaveStatus(false);
    const el = document.getElementById("saveStatus");
    if (el) el.textContent = "読込異常・上書き停止";
    return false;
  }
  let json;
  try {
    json = JSON.stringify(state);
    JSON.parse(json);
  } catch (error) {
    console.error("保存データの直列化失敗", error);
    setSaveStatus(false);
    return false;
  }
  rotateRecoveryCopies(json);
  const persisted = storageSet(STORAGE_KEY, json);
  setSaveStatus(persisted || !storageAvailable);
  try {
    const cap = window.Capacitor;
    if (cap?.isNativePlatform?.() && cap.getPlatform?.() === "android") {
      cap.Plugins?.NativeBackup?.save?.({ data: json }).catch?.(() => {});
    }
  } catch {}
  return persisted;
}
async function restoreAndroidNativeBackupIfNeeded() {
  try {
    if (storageGet(STORAGE_KEY)) return false;
    const cap = window.Capacitor;
    if (!(cap?.isNativePlatform?.() && cap.getPlatform?.() === "android")) return false;
    const result = await cap.Plugins?.NativeBackup?.load?.();
    if (!result?.data) return false;
    const raw = JSON.parse(result.data);
    state = isUntouchedLegacyTemplate(raw) ? blankInitialState() : sanitizeState(raw);
    storageSet(STORAGE_KEY, JSON.stringify(state));
    calendarCursor = /^\d{4}-\d{2}$/.test(state.calendarMonth)
      ? parseISODate(state.calendarMonth + "-01") : new Date();
    return true;
  } catch (e) {
    console.warn("Androidバックアップの復元をスキップしました", e);
    return false;
  }
}
let state = loadState(),
  calendarCursor = /^\d{4}-\d{2}$/.test(state.calendarMonth)
    ? parseISODate(state.calendarMonth + "-01")
    : new Date();
function isNonBusinessDay(d) {
  if (state.calendar.useWeekends && (d.getDay() === 0 || d.getDay() === 6))
    return true;
  if (
    state.calendar.useNationalHolidays &&
    japaneseHolidaySet(d.getFullYear()).has(toISODate(d))
  )
    return true;
  if (state.calendar.useBankYearEnd) {
    const m = d.getMonth() + 1,
      x = d.getDate();
    if ((m === 12 && x === 31) || (m === 1 && x <= 3)) return true;
  }
  return state.calendar.customClosures.some((c) => c.date === toISODate(d));
}
function adjustBusinessDate(d, shift) {
  const x = new Date(d);
  if (shift === "none") return x;
  const step = shift === "next" ? 1 : -1;
  let guard = 0;
  while (isNonBusinessDay(x) && guard++ < 62) x.setDate(x.getDate() + step);
  return x;
}
function monthlyOccurrence(y, m, item) {
  const nominal = addDays(
    new Date(y, m, clampDay(y, m, item.day ?? item.paymentDay)),
    item.offsetDays || 0,
  );
  return {
    nominal,
    adjusted: adjustBusinessDate(nominal, item.shift || "none"),
  };
}
function nextMonthlyOccurrence(asOf, item, includeToday = false) {
  for (let i = 0; i < 18; i++) {
    const occ = monthlyOccurrence(
        asOf.getFullYear(),
        asOf.getMonth() + i,
        item,
      ),
      c = compareDates(occ.adjusted, asOf);
    if (c > 0 || (includeToday && c === 0)) return occ.adjusted;
  }
  return null;
}
function previousMonthlyOccurrence(asOf, item) {
  for (let i = 0; i < 18; i++) {
    const occ = monthlyOccurrence(
      asOf.getFullYear(),
      asOf.getMonth() - i,
      item,
    );
    if (compareDates(occ.adjusted, asOf) <= 0) return occ.adjusted;
  }
  return asOf;
}
function resolveRecurringAmount(e, nominal, mode) {
  const mk = monthKey(nominal);
  if (e.confirmedByMonth?.[mk] != null)
    return {
      amount: Math.max(0, intMoney(e.confirmedByMonth[mk])),
      basis: "確定額",
      certainty: "confirmed",
    };
  if (e.amountMode === "fixed")
    return { amount: e.amount, basis: "固定額", certainty: "confirmed" };
  if (mode === "conservative") {
    if (e.kind === "income") {
      if (e.amountMode === "buffer")
        return {
          amount: Math.max(
            0,
            Math.floor(e.amount * (1 - e.bufferPercent / 100)),
          ),
          basis: `下振れ-${e.bufferPercent}%`,
          certainty: "estimated",
        };
      if (e.amountMode === "range")
        return {
          amount: e.minAmount,
          basis: "範囲下限",
          certainty: "estimated",
        };
    } else {
      if (e.amountMode === "buffer")
        return {
          amount: Math.ceil(e.amount * (1 + e.bufferPercent / 100)),
          basis: `上振れ+${e.bufferPercent}%`,
          certainty: "estimated",
        };
      if (e.amountMode === "range")
        return {
          amount: e.maxAmount,
          basis: "範囲上限",
          certainty: "estimated",
        };
    }
  }
  return { amount: e.amount, basis: "予想額", certainty: "estimated" };
}
function roundCharge(v, method) {
  return method === "ceil"
    ? Math.ceil(v)
    : method === "round"
      ? Math.round(v)
      : Math.floor(v);
}
function rateOnDate(a, d) {
  return a.futureRateDate &&
    compareDates(d, parseISODate(a.futureRateDate)) >= 0
    ? a.futureApr
    : a.apr;
}
function annualBasis(a, d) {
  if (a.dayCount === "actual") {
    const y = d.getFullYear();
    return new Date(y, 1, 29).getMonth() === 1 ? 366 : 365;
  }
  return 365;
}
function simpleCharge(principal, start, end, a, overrideRate = null) {
  const days = Math.max(0, daysBetween(start, end));
  if (!days || principal <= 0) return 0;
  let total = 0,
    cursor = new Date(start);
  while (compareDates(cursor, end) < 0) {
    const next = addDays(cursor, 1),
      rate = overrideRate ?? rateOnDate(a, cursor);
    total += (principal * (rate / 100)) / annualBasis(a, cursor);
    cursor = next;
  }
  return roundCharge(total, a.rounding);
}
function buildFinancingSchedule(a, start, end) {
  const events = [];
  let principal = Math.max(0, a.principal),
    unpaid = 0;
  if (!a.active || principal <= 0)
    return { events, endingPrincipal: principal, endingFees: 0 };
  const item = { day: a.paymentDay, offsetDays: a.offsetDays, shift: a.shift };
  let accrual = a.lastPaymentDate
    ? parseISODate(a.lastPaymentDate)
    : previousMonthlyOccurrence(start, item);
  if (compareDates(accrual, start) > 0) accrual = start;
  const cursor = new Date(start.getFullYear(), start.getMonth() - 1, 1),
    last = new Date(end.getFullYear(), end.getMonth() + 1, 1);
  let guard = 0;
  while (cursor <= last && principal + unpaid > 0 && guard++ < 240) {
    const occ = monthlyOccurrence(
        cursor.getFullYear(),
        cursor.getMonth(),
        item,
      ),
      due = occ.adjusted;
    if (compareDates(due, accrual) <= 0) {
      cursor.setMonth(cursor.getMonth() + 1);
      continue;
    }
    const payDate = addDays(due, a.lateDays);
    if (compareDates(payDate, start) >= 0 && compareDates(payDate, end) <= 0) {
      const interest = simpleCharge(principal, accrual, due, a);
      unpaid += interest;
      const scheduled =
        a.paymentRule === "fixedPrincipal"
          ? Math.min(a.paymentAmount, principal) + unpaid
          : Math.min(a.paymentAmount, principal + unpaid);
      const lateBase = a.lateBase === "principal" ? principal : scheduled;
      const late =
        a.lateDays && a.lateRate
          ? simpleCharge(lateBase, due, payDate, a, a.lateRate)
          : 0;
      unpaid += late;
      let cash = 0,
        principalPay = 0,
        feePay = 0;
      if (a.paymentRule === "fixedPrincipal") {
        principalPay = Math.min(a.paymentAmount, principal);
        feePay = unpaid;
        cash = principalPay + feePay;
        unpaid = 0;
      } else {
        cash = Math.min(a.paymentAmount, principal + unpaid);
        feePay = Math.min(cash, unpaid);
        unpaid -= feePay;
        principalPay = Math.min(principal, Math.max(0, cash - feePay));
      }
      principal -= principalPay;
      events.push({
        date: payDate,
        name: a.name,
        amount: -intMoney(cash),
        accountId: a.accountId,
        source: "financing",
        certainty: "calculated",
        meta: {
          basis: "日割り単利",
          principalPayment: principalPay,
          regularInterest: interest,
          lateFee: late,
          principalAfter: principal,
          unpaidFeesAfter: unpaid,
          days: daysBetween(accrual, due),
          apr: rateOnDate(a, due),
          financingId: a.id,
        },
      });
      accrual = payDate;
    }
    cursor.setMonth(cursor.getMonth() + 1);
  }
  return { events, endingPrincipal: principal, endingFees: unpaid };
}
function collectEvents(start, end, mode = state.forecastMode, scenario = 0) {
  const events = [],
    activeAccounts = new Set(
      state.accounts.filter((a) => a.active).map((a) => a.id),
    );
  for (const e of state.recurring) {
    if (!e.active || !activeAccounts.has(e.accountId)) continue;
    const cursor = new Date(start.getFullYear(), start.getMonth() - 1, 1),
      last = new Date(end.getFullYear(), end.getMonth() + 1, 1);
    while (cursor <= last) {
      const occ = monthlyOccurrence(cursor.getFullYear(), cursor.getMonth(), e),
        mk = monthKey(occ.nominal);
      if (
        !e.skipMonths.includes(mk) &&
        occ.adjusted >= start &&
        occ.adjusted <= end
      ) {
        const r = resolveRecurringAmount(e, occ.nominal, mode);
        events.push({
          date: occ.adjusted,
          name: e.name,
          amount: (e.kind === "income" ? 1 : -1) * r.amount,
          accountId: e.accountId,
          source: e.kind,
          certainty: r.certainty,
          meta: { basis: r.basis, nominalDate: occ.nominal, recurringId: e.id },
        });
      }
      cursor.setMonth(cursor.getMonth() + 1);
    }
  }
  for (const a of state.financing)
    if (activeAccounts.has(a.accountId))
      events.push(...buildFinancingSchedule(a, start, end).events);
  for (const e of state.ledgerEntries || []) {
    if (!e.affectsBalance || !activeAccounts.has(e.accountId)) continue;
    const d = parseISODate(e.date);
    if (d >= start && d <= end)
      events.push({
        date: d,
        name: e.name,
        amount: (e.kind === "income" ? 1 : -1) * e.amount,
        accountId: e.accountId,
        source: "ledger",
        certainty: "confirmed",
        meta: { basis: `家計簿実績・${HOUSEHOLD_PAYMENT_METHODS[e.paymentMethod] || "その他"}`, ledgerId: e.id, category: e.category },
      });
  }
  for (const e of state.oneOff) {
    if (!activeAccounts.has(e.accountId)) continue;
    const d = parseISODate(e.date);
    if (d >= start && d <= end)
      events.push({
        date: d,
        name: e.name,
        amount: e.amount,
        accountId: e.accountId,
        source: "oneOff",
        certainty: e.certainty,
        meta: { basis: e.certainty === "confirmed" ? "確定" : "予想", oneOffId: e.id },
      });
  }
  for (const t of state.transfers) {
    if (
      !activeAccounts.has(t.fromAccountId) ||
      !activeAccounts.has(t.toAccountId)
    )
      continue;
    const d = parseISODate(t.date);
    if (d >= start && d <= end) {
      events.push({
        date: d,
        name: t.name + "（振替出）",
        amount: -t.amount,
        accountId: t.fromAccountId,
        source: "transferOut",
        certainty: "confirmed",
        meta: { basis: "口座間振替" },
      });
      events.push({
        date: d,
        name: t.name + "（振替入）",
        amount: t.amount,
        accountId: t.toAccountId,
        source: "transferIn",
        certainty: "confirmed",
        meta: { basis: "口座間振替" },
      });
    }
  }
  if (scenario > 0 && activeAccounts.has(state.defaultAccountId))
    events.push({
      date: start,
      name: "追加支出シナリオ",
      amount: -Math.abs(intMoney(scenario)),
      accountId: state.defaultAccountId,
      source: "scenario",
      certainty: "confirmed",
      meta: { basis: "シナリオ" },
    });
  const priority = (e) =>
    e.source === "scenario"
      ? 0
      : e.source === "expense" ||
          e.source === "financing" ||
          ((e.source === "oneOff" || e.source === "ledger") && e.amount < 0)
        ? 1
        : e.source === "transferOut"
          ? 2
          : e.source === "transferIn"
            ? 3
            : 4;
  events.sort(
    (a, b) =>
      compareDates(a.date, b.date) ||
      priority(a) - priority(b) ||
      a.name.localeCompare(b.name, "ja"),
  );
  return events;
}
function buildForecast(mode = state.forecastMode, scenario = 0) {
  const start = parseISODate(state.asOfDate),
    end = addDays(start, state.horizonDays),
    events = collectEvents(start, end, mode, scenario),
    balances = Object.fromEntries(
      state.accounts.filter((a) => a.active).map((a) => [a.id, a.balance]),
    ),
    buffers = Object.fromEntries(
      state.accounts.filter((a) => a.active).map((a) => [a.id, a.buffer]),
    ),
    grouped = new Map();
  for (const e of events) {
    const k = toISODate(e.date);
    if (!grouped.has(k)) grouped.set(k, []);
    grouped.get(k).push(e);
  }
  const daily = [],
    eventRows = [];
  let lowest = {
      balance: Object.values(balances).reduce((a, b) => a + b, 0),
      date: start,
    },
    firstShortage = null,
    firstBufferBreach = null;
  for (const [accountId, balance] of Object.entries(balances)) {
    if (!firstShortage && balance < 0)
      firstShortage = { date: start, accountId, balance };
    if (!firstBufferBreach && balance < Number(buffers[accountId] || 0))
      firstBufferBreach = { date: start, accountId, balance };
  }
  for (let i = 0; i <= state.horizonDays; i++) {
    const date = addDays(start, i);
    for (const e of grouped.get(toISODate(date)) || []) {
      if (!(e.accountId in balances)) balances[e.accountId] = 0;
      balances[e.accountId] += e.amount;
      const total = Object.values(balances).reduce((a, b) => a + b, 0);
      eventRows.push({
        ...e,
        accountBalanceAfter: balances[e.accountId],
        totalBalanceAfter: total,
      });
      if (!firstShortage && balances[e.accountId] < 0)
        firstShortage = {
          date,
          accountId: e.accountId,
          balance: balances[e.accountId],
        };
      if (
        !firstBufferBreach &&
        balances[e.accountId] < Number(buffers[e.accountId] || 0)
      )
        firstBufferBreach = {
          date,
          accountId: e.accountId,
          balance: balances[e.accountId],
        };
      if (total < lowest.balance) lowest = { balance: total, date };
    }
    const snapshot = {};
    for (const [id, v] of Object.entries(balances)) snapshot[id] = v;
    daily.push({
      date,
      total: Object.values(snapshot).reduce((a, b) => a + b, 0),
      accounts: snapshot,
    });
  }
  return {
    start,
    end,
    events,
    eventRows,
    daily,
    lowest,
    firstShortage,
    firstBufferBreach,
  };
}
function nextIncomeForAccount(accountId, start, mode) {
  const events = collectEvents(
    start,
    addDays(start, state.horizonDays),
    mode,
    0,
  );
  return (
    events.find((e) => e.accountId === accountId && e.amount > 0)?.date || null
  );
}
function safeSpendForAccount(accountId, until, mode) {
  const start = parseISODate(state.asOfDate),
    account = state.accounts.find((a) => a.id === accountId && a.active);
  if (!account) return 0;
  const end = until || addDays(start, state.horizonDays),
    events = collectEvents(start, end, mode, 0).filter(
      (e) => e.accountId === accountId,
    );
  let bal = account.balance,
    min = bal;
  for (const e of events) {
    if (until && compareDates(e.date, until) > 0) break;
    if (until && sameDate(e.date, until) && e.amount > 0) continue;
    bal += e.amount;
    min = Math.min(min, bal);
  }
  return intMoney(min - account.buffer);
}
function confidenceScore(forecast, until) {
  let total = 0,
    weighted = 0;
  for (const e of forecast.events) {
    if (until && e.date > until) continue;
    if (e.amount >= 0) continue;
    const w = Math.abs(e.amount);
    total += w;
    const certaintyWeight =
      e.certainty === "confirmed" ? 1 : e.certainty === "calculated" ? 0.8 : 0;
    weighted += w * certaintyWeight;
  }
  let ratio = total ? weighted / total : 1;
  const stale =
    state.accounts.filter((a) => ageDays(a.lastConfirmedAt) > state.staleDays)
      .length +
    state.recurring.filter(
      (e) =>
        e.amountMode !== "fixed" &&
        ageDays(e.lastConfirmedAt) > state.staleDays,
    ).length;
  ratio = Math.max(0, ratio - stale * 0.06);
  return { ratio, stale };
}
function calculateSummary(mode = state.forecastMode) {
  const start = parseISODate(state.asOfDate),
    scenario = Math.max(0, intMoney(state.scenarioSpend)),
    expected = buildForecast("expected", scenario),
    conservative = buildForecast("conservative", scenario),
    main = mode === "conservative" ? conservative : expected,
    aid = state.defaultAccountId,
    nextIncome = nextIncomeForAccount(aid, start, mode),
    safeNow = safeSpendForAccount(aid, nextIncome, mode) - scenario,
    endMonth = new Date(start.getFullYear(), start.getMonth() + 1, 0),
    safeMonth = safeSpendForAccount(aid, endMonth, mode) - scenario,
    days = nextIncome
      ? Math.max(1, daysBetween(start, nextIncome))
      : state.horizonDays,
    daily = safeNow > 0 ? Math.floor(safeNow / days) : 0,
    confidence = confidenceScore(main, nextIncome);
  return {
    expected,
    conservative,
    main,
    nextIncome,
    safeNow,
    safeMonth,
    daily,
    days,
    confidence,
    scenarioSpend: scenario,
  };
}
function groupRiskDays(forecast) {
  const map = new Map();
  for (const r of forecast.eventRows) {
    const k = toISODate(r.date);
    if (!map.has(k))
      map.set(k, { date: r.date, outflow: 0, minMargin: Infinity, items: [] });
    const x = map.get(k);
    if (r.amount < 0) x.outflow += Math.abs(r.amount);
    const buffer =
      state.accounts.find((a) => a.id === r.accountId)?.buffer || 0;
    x.minMargin = Math.min(x.minMargin, r.accountBalanceAfter - buffer);
    x.items.push(r);
  }
  return [...map.values()]
    .sort((a, b) => a.minMargin - b.minMargin || b.outflow - a.outflow)
    .slice(0, 3);
}
function validationIssues() {
  const issues = [];
  for (const a of state.accounts) {
    if (!a.name.trim())
      issues.push({ severity: "error", text: "名称が空の口座があります。" });
    if (a.buffer < 0)
      issues.push({ severity: "error", text: `${a.name}: 維持残高が負です。` });
  }
  for (const e of state.recurring) {
    const linkedAccount = state.accounts.find((a) => a.id === e.accountId);
    if (!linkedAccount)
      issues.push({ severity: "error", text: `${e.name}: 口座が未設定です。` });
    else if (!linkedAccount.active)
      issues.push({
        severity: "warning",
        text: `${e.name}: 停止中口座のため予測から除外されています。`,
      });
    if (e.amountMode === "range" && e.minAmount > e.maxAmount)
      issues.push({
        severity: "error",
        text: `${e.name}: 範囲下限が上限を超えています。`,
      });
    const dup = state.recurring.filter(
      (x) =>
        x.id !== e.id &&
        x.active &&
        e.active &&
        x.name === e.name &&
        x.day === e.day &&
        x.accountId === e.accountId,
    );
    if (dup.length)
      issues.push({
        severity: "warning",
        text: `${e.name}: 同じ日・口座の重複登録候補があります。`,
      });
  }
  for (const a of state.financing) {
    const linkedAccount = state.accounts.find((x) => x.id === a.accountId);
    if (!linkedAccount)
      issues.push({
        severity: "error",
        text: `${a.name}: 引落口座が未設定です。`,
      });
    else if (!linkedAccount.active)
      issues.push({
        severity: "warning",
        text: `${a.name}: 停止中口座のため予測から除外されています。`,
      });
    const start = parseISODate(state.asOfDate),
      next = nextMonthlyOccurrence(start, {
        day: a.paymentDay,
        offsetDays: a.offsetDays,
        shift: a.shift,
      });
    if (next && a.paymentRule === "fixedTotal") {
      const prev = a.lastPaymentDate
          ? parseISODate(a.lastPaymentDate)
          : previousMonthlyOccurrence(start, {
              day: a.paymentDay,
              offsetDays: a.offsetDays,
              shift: a.shift,
            }),
        fee = simpleCharge(a.principal, prev, next, a);
      if (a.paymentAmount <= fee)
        issues.push({
          severity: "error",
          text: `${a.name}: 毎月返済額が次回手数料以下で、元本が減らない可能性があります。`,
        });
    }
    if (a.lateRate > 0 && a.lateRate < a.apr)
      issues.push({
        severity: "warning",
        text: `${a.name}: 遅延損害金率が通常年率より低く設定されています。`,
      });
  }
  for (const t of state.transfers) {
    if (t.fromAccountId === t.toAccountId)
      issues.push({
        severity: "error",
        text: `${t.name}: 振替元と振替先が同じです。`,
      });
    const sameDayExpense = collectEvents(
      parseISODate(t.date),
      parseISODate(t.date),
      state.forecastMode,
      0,
    ).some(
      (e) =>
        e.accountId === t.toAccountId &&
        e.amount < 0 &&
        e.source !== "transferOut",
    );
    if (sameDayExpense)
      issues.push({
        severity: "warning",
        text: `${t.name}: 振替日と引落日が同日です。処理順が不明な場合は前日以前へ移してください。`,
      });
  }
  return issues;
}
function showToast(text) {
  const el = document.getElementById("toast");
  el.textContent = text;
  el.classList.remove("hidden");
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => el.classList.add("hidden"), 2600);
}
function setView(name) {
  state.activeView = name;
  document
    .querySelectorAll(".tab")
    .forEach((b) => b.classList.toggle("active", b.dataset.view === name));
  document
    .querySelectorAll(".view")
    .forEach((v) => v.classList.toggle("active", v.id === `view-${name}`));
  saveState();
  if (name === "household") renderHousehold();
  if (name === "home") renderHome(calculateSummary());
  if (name === "calendar") renderCalendar();
}
function showFatal(error) {
  console.error(error);
  const el = document.getElementById("fatalError");
  if (!el) return;
  el.textContent = `画面更新中にエラーが発生しました：${error?.message || error}`;
  el.classList.remove("hidden");
}
function householdMonthRange(monthValue = state.household.selectedMonth) {
  const [y, m] = monthValue.split("-").map(Number), start = new Date(y, m - 1, 1), end = new Date(y, m, 0);
  return { start, end };
}
function householdEntriesForMonth(monthValue = state.household.selectedMonth) {
  return (state.ledgerEntries || [])
    .filter((e) => e.date.startsWith(monthValue))
    .sort((a, b) => b.date.localeCompare(a.date) || String(b.createdAt).localeCompare(String(a.createdAt)));
}
function householdSummary(monthValue = state.household.selectedMonth) {
  const entries = householdEntriesForMonth(monthValue), category = {}, payment = {};
  let expense = 0, income = 0, settlement = 0, linked = 0, recordOnly = 0;
  for (const e of entries) {
    if (e.kind === "expense") {
      expense += e.amount;
      category[e.category] = (category[e.category] || 0) + e.amount;
      payment[e.paymentMethod] = (payment[e.paymentMethod] || 0) + e.amount;
    } else if (e.kind === "income") income += e.amount;
    else settlement += e.amount;
    if (e.affectsBalance) linked++; else recordOnly++;
  }
  const budget = state.household.monthlyBudget;
  return {entries, expense, income, settlement, net:income-expense, budget, remaining:budget-expense, category, payment, linked, recordOnly};
}
function guessHouseholdCategory(name, amount) {
  const n = String(name || "");
  if (amount > 0) return n.includes("給与") ? "給与" : n.includes("副") ? "副収入" : "臨時収入";
  if (/家賃|住宅|管理費/.test(n)) return "住居";
  if (/電気|ガス|水道/.test(n)) return "水道光熱";
  if (/通信|携帯|スマホ|インターネット/.test(n)) return "通信";
  if (/保険/.test(n)) return "保険";
  if (/ローン|リボ|返済/.test(n)) return "借入返済";
  if (/スーパー|食品|食費|外食|コンビニ/.test(n)) return "食費";
  return "その他";
}
function sourceKeyForEvent(e) {
  const id = e.meta?.recurringId || e.meta?.financingId || e.meta?.oneOffId || e.name;
  return `${e.source}|${id}|${toISODate(e.date)}|${e.amount}`;
}
function plannedHouseholdCandidates(monthValue = state.household.selectedMonth) {
  const {start,end}=householdMonthRange(monthValue), existing=new Set((state.ledgerEntries||[]).map(e=>e.sourceKey).filter(Boolean));
  return collectEvents(start,end,state.forecastMode,0)
    .filter(e => ["income","expense","financing","oneOff"].includes(e.source))
    .map(e => ({...e, sourceKey:sourceKeyForEvent(e)}))
    .filter(e => !existing.has(e.sourceKey));
}
function paymentMethodLabel(value){return HOUSEHOLD_PAYMENT_METHODS[value] || "その他"}
function renderHousehold() {
  const s = householdSummary(), [y,m]=state.household.selectedMonth.split("-").map(Number);
  document.getElementById("householdTitle").textContent = `${y}年${m}月`;
  document.getElementById("householdExpense").textContent = yen.format(s.expense);
  document.getElementById("householdIncome").textContent = yen.format(s.income);
  const net=document.getElementById("householdNet"); net.textContent=yen.format(s.net); net.className=`metric-value ${s.net<0?"negative":"positive"}`;
  const remaining=document.getElementById("householdBudgetRemaining");
  if(s.budget>0){remaining.textContent=yen.format(s.remaining);remaining.className=`metric-value ${s.remaining<0?"budget-negative":"budget-positive"}`;document.getElementById("householdBudgetNote").textContent=`月予算 ${yen.format(s.budget)}・消化 ${Math.round(s.expense/s.budget*100)}%`;}
  else{remaining.textContent="未設定";remaining.className="metric-value";document.getElementById("householdBudgetNote").textContent="設定から月予算を入力";}
  const categoryEl=document.getElementById("householdCategoryBreakdown"), cats=Object.entries(s.category).sort((a,b)=>b[1]-a[1]), max=Math.max(1,...cats.map(x=>x[1]));
  categoryEl.innerHTML=cats.length?cats.map(([name,value])=>`<div class="category-row"><span>${esc(name)}</span><div class="category-track"><span style="width:${Math.max(2,value/max*100)}%"></span></div><strong>${yen.format(value)}</strong></div>`).join(""):"<div class='household-empty'>この月の支出実績はありません。</div>";
  const filter=document.getElementById("householdCategoryFilter"), available=[...new Set(s.entries.map(e=>e.category))].sort((a,b)=>a.localeCompare(b,"ja"));
  filter.innerHTML=`<option value="all">すべて</option>`+available.map(c=>`<option value="${esc(c)}">${esc(c)}</option>`).join("");
  if(!available.includes(state.household.filterCategory)) state.household.filterCategory="all";
  filter.value=state.household.filterCategory;
  const visible=s.entries.filter(e=>state.household.filterCategory==="all"||e.category===state.household.filterCategory), list=document.getElementById("householdTransactions");
  list.innerHTML=visible.length?visible.map(e=>`<div class="household-transaction"><div class="transaction-date">${esc(e.date.slice(5).replace("-","/"))}</div><div class="transaction-main"><div class="transaction-title">${esc(e.name)}</div><div class="transaction-meta">${e.kind==="settlement"?"決済・返済・":""}${esc(e.category)}・${esc(paymentMethodLabel(e.paymentMethod))}・${esc(accountName(e.accountId))}${e.affectsBalance?"・予報反映":"・記録のみ"}${e.note?`・${esc(e.note)}`:""}</div></div><div><div class="transaction-amount ${e.kind==="income"?"positive":"negative"}">${e.kind==="income"?"＋":"－"}${yen.format(e.amount)}</div><div class="row-actions" style="justify-content:flex-end;margin-top:4px"><button class="btn btn-small" data-action="edit-ledger:${e.id}" type="button">編集</button><button class="btn btn-small btn-danger" data-action="delete-ledger:${e.id}" type="button">削除</button></div></div></div>`).join(""):"<div class='household-empty'>該当する取引はありません。</div>";
  const paymentEl=document.getElementById("householdPaymentSummary"), pays=Object.entries(s.payment).sort((a,b)=>b[1]-a[1]);
  paymentEl.innerHTML=pays.length?pays.map(([key,value])=>`<div class="list-row"><div><div class="list-title">${esc(paymentMethodLabel(key))}</div></div><strong>${yen.format(value)}</strong></div>`).join(""):"<p class='small'>支出実績はありません。</p>";
  const creditTotal=s.payment.credit||0;
  document.getElementById("householdForecastLink").innerHTML=`<div class="list-row"><div><div class="list-title">予報へ反映</div><div class="list-meta">基準日以降の口座残高へ影響</div></div><strong>${s.linked}件</strong></div><div class="list-row"><div><div class="list-title">記録のみ</div><div class="list-meta">カード請求・既存予定との二重計上を回避</div></div><strong>${s.recordOnly}件</strong></div><div class="list-row"><div><div class="list-title">カード利用集計</div><div class="list-meta">締日が異なるため請求額へ自動確定しません</div></div><strong>${yen.format(creditTotal)}</strong></div><div class="list-row"><div><div class="list-title">決済・返済</div><div class="list-meta">カード請求・返済額。予算と支出集計から除外</div></div><strong>${yen.format(s.settlement)}</strong></div>`;
  const planned=plannedHouseholdCandidates(), plannedEl=document.getElementById("householdPlanned"), asOf=parseISODate(state.asOfDate);
  plannedEl.innerHTML=planned.length?planned.slice(0,8).map(e=>{const future=compareDates(e.date,asOf)>0;return `<div class="action-card"><div class="action-title">${esc(e.name)} <span class="${e.amount<0?"negative":"positive"}">${yen.format(Math.abs(e.amount))}</span></div><div class="action-desc">${esc(dateFmt.format(e.date))}・${esc(accountName(e.accountId))}・予報には登録済み</div><button class="btn btn-small" data-action="import-household:${encodeURIComponent(e.sourceKey)}" type="button" ${future?"disabled":""}>${future?"予定日後に登録":"実績に追加"}</button></div>`}).join(""):"<p class='small'>未登録の予定はありません。</p>";
}
function openLedgerModal(entryId="", kind="expense") {
  const existing=(state.ledgerEntries||[]).find(e=>e.id===entryId), e=existing?deepClone(existing):sanitizeLedgerEntry({kind,amount:0,date:state.asOfDate,accountId:state.defaultAccountId,paymentMethod:state.household.defaultPaymentMethod,affectsBalance:state.household.defaultPaymentMethod!=="credit",category:kind==="income"?"臨時収入":"食費"});
  const categories=[...new Set([...state.household.categories,e.category])];
  openModal(existing?"家計簿を編集":kind==="income"?"収入を追加":"支出を追加",`<div class="form-grid"><label>区分<select id="ledgerKind"><option value="expense" ${e.kind==="expense"?"selected":""}>支出</option><option value="income" ${e.kind==="income"?"selected":""}>収入</option><option value="settlement" ${e.kind==="settlement"?"selected":""}>決済・返済（集計除外）</option></select></label><label>金額<input id="ledgerAmount" data-money type="number" min="0" step="1" value="${e.amount}"/><div class="money-preview"></div></label><label>日付<input id="ledgerDate" type="date" value="${e.date}"/></label><label>内容<input id="ledgerName" value="${esc(e.name)}"/></label><label>カテゴリ<select id="ledgerCategory">${categories.map(c=>`<option value="${esc(c)}" ${c===e.category?"selected":""}>${esc(c)}</option>`).join("")}</select></label><label>支払方法<select id="ledgerPayment">${Object.entries(HOUSEHOLD_PAYMENT_METHODS).map(([k,v])=>`<option value="${k}" ${k===e.paymentMethod?"selected":""}>${v}</option>`).join("")}</select></label><label>対象口座<select id="ledgerAccount">${optAccounts(e.accountId)}</select></label><label style="grid-column:1/-1">メモ<textarea id="ledgerNote" rows="2">${esc(e.note)}</textarea></label></div><label style="margin-top:12px"><input id="ledgerAffects" type="checkbox" style="width:auto;display:inline;margin-right:6px" ${e.affectsBalance?"checked":""}/>残高予報へ反映する</label><p class="small">現金・デビット・即時振込は通常ON。クレジット利用や、すでに「毎月の入出金」「一度だけの入出金」へ登録済みの支払いは、二重計上を避けるためOFFにします。</p><button class="btn btn-primary" id="ledgerSave" style="margin-top:12px" type="button">保存</button>`);
  const payment=document.getElementById("ledgerPayment"), affects=document.getElementById("ledgerAffects");
  if(!existing) payment.addEventListener("change",()=>{affects.checked=payment.value!=="credit"});
  document.getElementById("ledgerSave").onclick=()=>{
    const next=sanitizeLedgerEntry({...e,id:existing?.id||uid(),kind:document.getElementById("ledgerKind").value,amount:document.getElementById("ledgerAmount").value,date:document.getElementById("ledgerDate").value,name:document.getElementById("ledgerName").value,category:document.getElementById("ledgerCategory").value,paymentMethod:payment.value,accountId:document.getElementById("ledgerAccount").value,affectsBalance:affects.checked,note:document.getElementById("ledgerNote").value,sourceKey:e.sourceKey,createdAt:e.createdAt});
    if(existing) state.ledgerEntries=state.ledgerEntries.map(x=>x.id===existing.id?next:x); else state.ledgerEntries.push(next);
    if(!state.household.categories.includes(next.category)) state.household.categories.push(next.category);
    state.household.selectedMonth=next.date.slice(0,7);closeModal();render();showToast(`${next.name}：${yen.format(next.amount)}`);
  };
}
function importPlannedToHousehold(encodedKey) {
  const key=decodeURIComponent(encodedKey||""), candidate=plannedHouseholdCandidates().find(e=>e.sourceKey===key); if(!candidate)return showToast("予定を見つけられませんでした");
  if(compareDates(candidate.date,parseISODate(state.asOfDate))>0)return showToast("予定日後に実績登録してください");
  const settlement = candidate.source === "financing" || /カード|JCB|VISA|MASTER|MASTERCARD|AMEX|楽天|PAYPAY|メルカリ|エポス/i.test(candidate.name);
  const kind = candidate.amount >= 0 ? "income" : settlement ? "settlement" : "expense";
  const entry=sanitizeLedgerEntry({name:candidate.name,kind,amount:Math.abs(candidate.amount),category:kind==="settlement"?"決済・返済":guessHouseholdCategory(candidate.name,candidate.amount),date:toISODate(candidate.date),accountId:candidate.accountId,paymentMethod:"bank",affectsBalance:false,note:kind==="settlement"?"予定から決済・返済として登録":"予定から実績登録",sourceKey:candidate.sourceKey});
  state.ledgerEntries.push(entry);if(!state.household.categories.includes(entry.category))state.household.categories.push(entry.category);render();showToast("家計簿へ実績登録しました");
}
function render() {
  try {
    document.getElementById("fatalError")?.classList.add("hidden");
    renderSettings();
    renderHousehold();
    const summary = calculateSummary();
    renderHome(summary);
    renderRegister();
    renderCalendar();
    renderBackup();
    renderInstallHelp();
    saveState();
    bindMoneyPreviews();
  } catch (error) {
    showFatal(error);
  }
}
function renderHome(s) {
  const aid = state.defaultAccountId,
    acc = state.accounts.find((a) => a.id === aid),
    conSafe =
      safeSpendForAccount(aid, s.nextIncome, "conservative") - s.scenarioSpend,
    visibleSafeNow = Math.max(0, s.safeNow),
    visibleSafeMonth = Math.max(0, s.safeMonth);
  document.getElementById("safeNow").textContent = yen.format(visibleSafeNow);
  document.getElementById("safeNowNote").textContent =
    s.safeNow < 0
      ? `維持残高まで ${yen.format(Math.abs(s.safeNow))}不足`
      : `${acc?.name || "通常口座"}・保守 ${yen.format(Math.max(0, conSafe))}${s.scenarioSpend ? `・仮支出 ${yen.format(s.scenarioSpend)}反映` : ""}`;
  document.getElementById("safeMonth").textContent =
    yen.format(visibleSafeMonth);
  document.getElementById("safeMonthNote").textContent =
    `${new Date(parseISODate(state.asOfDate).getFullYear(), parseISODate(state.asOfDate).getMonth() + 1, 0).getDate()}日まで`;
  document.getElementById("dailyGuide").textContent = yen.format(s.daily);
  document.getElementById("dailyGuideNote").textContent = s.nextIncome
    ? `${dateFmt.format(s.nextIncome)}まで${s.days}日`
    : "定期入金なし";
  document.getElementById("lowestBalance").textContent = yen.format(
    s.main.lowest.balance,
  );
  document.getElementById("lowestNote").textContent = dateFmt.format(
    s.main.lowest.date,
  );
  document
    .getElementById("safeNowCard")
    .classList.toggle("risk", s.safeNow <= 0);
  document
    .getElementById("lowestCard")
    .classList.toggle("risk", s.main.lowest.balance < 0);
  const alert = document.getElementById("statusAlert");
  if (s.main.firstShortage) {
    alert.className = "alert danger";
    alert.textContent = `${fullDateFmt.format(s.main.firstShortage.date)}に${accountName(s.main.firstShortage.accountId)}が${yen.format(Math.abs(s.main.firstShortage.balance))}不足する予測です。`;
  } else if (s.main.firstBufferBreach) {
    alert.className = "alert warn";
    alert.textContent = `残高不足はありませんが、${fullDateFmt.format(s.main.firstBufferBreach.date)}に${accountName(s.main.firstBufferBreach.accountId)}が維持残高を下回ります。`;
  } else {
    alert.className = "alert ok";
    alert.textContent = `登録済み条件では今後${state.horizonDays}日間に口座不足は予測されていません。`;
  }
  renderActionCenter();
  const pct = Math.round(s.confidence.ratio * 100),
    level = pct >= 90 ? "高" : pct >= 70 ? "中" : "低",
    pill = document.getElementById("confidencePill");
  pill.textContent = level;
  pill.className = `pill ${level === "高" ? "ok" : level === "中" ? "warn" : "danger"}`;
  document.getElementById("confidenceBar").style.width = `${pct}%`;
  document.getElementById("confidencePercent").textContent = `${pct}%`;
  document.getElementById("confidenceBreakdown").textContent =
    `未確定・古い情報 ${s.confidence.stale}件`;
  document.getElementById("modeRange").textContent =
    `今すぐ使える金額：標準 ${yen.format(Math.max(0, safeSpendForAccount(aid, nextIncomeForAccount(aid, parseISODate(state.asOfDate), "expected"), "expected") - s.scenarioSpend))} / 保守 ${yen.format(Math.max(0, conSafe))}`;
  const risks = groupRiskDays(s.main),
    riskEl = document.getElementById("riskDays");
  riskEl.innerHTML = risks.length
    ? risks
        .map(
          (x) =>
            `<div class="risk-day"><strong>${esc(dateFmt.format(x.date))}</strong><div>${esc(
              x.items
                .slice(0, 2)
                .map((i) => i.name)
                .join("、"),
            )}${x.items.length > 2 ? "ほか" : ""}</div><span class="${x.minMargin < 0 ? "negative" : ""}">${yen.format(x.outflow)}</span></div>`,
        )
        .join("")
    : "<p class='small'>予測期間内の入出金はありません。</p>";
  const sh = document.getElementById("shortageActions");
  if (s.main.firstShortage) {
    const x = s.main.firstShortage,
      need = Math.abs(x.balance);
    sh.innerHTML = `<strong>${esc(accountName(x.accountId))}</strong>へ${fullDateFmt.format(x.date)}までに<strong>${yen.format(need)}</strong>移すか、それまでの追加支出を同額減らすと残高0円以上になります。`;
  } else if (s.main.firstBufferBreach) {
    const x = s.main.firstBufferBreach,
      a = state.accounts.find((z) => z.id === x.accountId),
      need = (a?.buffer || 0) - x.balance;
    sh.innerHTML = `${esc(accountName(x.accountId))}へ${fullDateFmt.format(x.date)}までに<strong>${yen.format(need)}</strong>移すと維持残高を守れます。`;
  } else sh.textContent = "不足は予測されていません。";
  renderAccountSummary(s.main);
  drawChart(
    s.main.daily,
    state.accounts.filter((a) => a.active).reduce((q, a) => q + a.buffer, 0),
  );
}
function renderActionCenter() {
  const mk = monthKey(parseISODate(state.asOfDate)),
    items = [];
  if (!storageAvailable)
    items.push({
      title: "自動保存が利用できません",
      desc: "このプレビュー環境では、画面を閉じると入力内容が消える可能性があります。継続利用時はJSONバックアップを書き出してください。",
      action: "export",
      label: "バックアップを書き出す",
    });
  for (const e of state.recurring.filter(
    (x) => x.active && x.kind === "expense" && x.amountMode !== "fixed",
  )) {
    if (e.confirmedByMonth?.[mk] == null)
      items.push({
        title: e.name,
        desc: `${mk}の請求額が未確定です。現在 ${yen.format(e.amount)}`,
        action: `confirm-recurring:${e.id}`,
        label: "確定額を入力",
      });
  }
  for (const a of state.accounts) {
    if (ageDays(a.lastConfirmedAt) > state.staleDays)
      items.push({
        title: a.name,
        desc: `残高の最終確認から${ageDays(a.lastConfirmedAt)}日経過`,
        action: `reconcile:${a.id}`,
        label: "残高を更新",
      });
  }
  if (!state.lastBackupAt || ageDays(state.lastBackupAt) > 30)
    items.push({
      title: "バックアップ",
      desc: "最終バックアップから30日以上経過、または未実施です。",
      action: "export",
      label: "書き出す",
    });
  const el = document.getElementById("actionCenter");
  el.innerHTML = items.length
    ? items
        .map(
          (i) =>
            `<div class="action-card"><div class="action-title">${esc(i.title)}</div><div class="action-desc">${esc(i.desc)}</div><button class="btn btn-small" data-action="${esc(i.action)}" type="button">${esc(i.label)}</button></div>`,
        )
        .join("")
    : "<div class='alert ok' style='margin:0'>確認が必要な項目はありません。</div>";
}
function renderAccountSummary(forecast) {
  const final = forecast.daily.at(-1)?.accounts || {},
    el = document.getElementById("accountSummary");
  el.innerHTML = state.accounts
    .filter((a) => a.active)
    .map((a) => {
      let min = a.balance,
        minDate = parseISODate(state.asOfDate);
      for (const d of forecast.daily) {
        const v = d.accounts[a.id] ?? a.balance;
        if (v < min) {
          min = v;
          minDate = d.date;
        }
      }
      return `<div class="list-row"><div><div class="list-title"><span class="status-dot ${min < 0 ? "danger" : min < a.buffer ? "warn" : ""}"></span>${esc(a.name)}</div><div class="list-meta">現在 ${yen.format(a.balance)} / 最低 ${yen.format(min)}（${dateFmt.format(minDate)}）</div></div><strong>${yen.format(final[a.id] ?? a.balance)}</strong></div>`;
    })
    .join("");
}
function renderSettings() {
  document.getElementById("asOfDate").value = state.asOfDate;
  document.getElementById("horizonDays").value = state.horizonDays;
  document.getElementById("forecastMode").value = state.forecastMode;
  document.getElementById("scenarioSpend").value = state.scenarioSpend;
  document.getElementById("staleDays").value = state.staleDays;
  const sel = document.getElementById("defaultAccountId");
  sel.innerHTML = state.accounts
    .filter((a) => a.active)
    .map((a) => `<option value="${esc(a.id)}">${esc(a.name)}</option>`)
    .join("");
  sel.value = state.defaultAccountId;
  document.getElementById("householdMonthlyBudget").value = state.household.monthlyBudget;
  document.getElementById("householdDefaultPayment").value = state.household.defaultPaymentMethod;
  document.getElementById("householdCategoryList").innerHTML = state.household.categories.map(c => `<span class="category-chip">${esc(c)}<button type="button" aria-label="${esc(c)}を削除" data-action="delete-household-category:${encodeURIComponent(c)}">×</button></span>`).join("");
  document.getElementById("useWeekends").checked = state.calendar.useWeekends;
  document.getElementById("useNationalHolidays").checked =
    state.calendar.useNationalHolidays;
  document.getElementById("useBankYearEnd").checked =
    state.calendar.useBankYearEnd;
  document.getElementById("closureList").innerHTML = state.calendar
    .customClosures.length
    ? state.calendar.customClosures
        .map(
          (c) =>
            `<div class="list-row" data-type="closure" data-id="${c.id}"><div class="form-grid"><label>名称<input data-field="name" value="${esc(c.name)}"/></label><label>日付<input data-field="date" type="date" value="${esc(c.date)}"/></label></div><button class="btn btn-small btn-danger" data-action="delete-closure:${c.id}" type="button">削除</button></div>`,
        )
        .join("")
    : "<p class='small'>独自休業日はありません。</p>";
}
function optAccounts(selected) {
  return state.accounts
    .map(
      (a) =>
        `<option value="${esc(a.id)}" ${a.id === selected ? "selected" : ""}>${esc(a.name)}${a.active ? "" : "（停止）"}</option>`,
    )
    .join("");
}
function moneyField(label, key, value, extra = "") {
  return `<label>${label}<input data-field="${key}" data-money type="number" step="1" value="${value}" ${extra}/><div class="money-preview">${yen.format(value)}</div></label>`;
}
function renderRegister() {
  const issues = validationIssues(),
    vc = document.getElementById("validationCenter");
  vc.className = `alert ${issues.some((x) => x.severity === "error") ? "danger" : issues.length ? "warn" : "ok"}`;
  vc.innerHTML = issues.length
    ? `<strong>要確認 ${issues.length}件</strong><ul>${issues
        .slice(0, 8)
        .map((x) => `<li>${esc(x.text)}</li>`)
        .join("")}</ul>`
    : "入力上の矛盾は検出されていません。";
  document.getElementById("accountsList").innerHTML = state.accounts
    .map(
      (a) =>
        `<details class="editor-card" data-type="account" data-id="${a.id}"><summary><div class="summary-line"><div><strong>${esc(a.name)}</strong><div class="list-meta">${yen.format(a.balance)}・維持 ${yen.format(a.buffer)}・確認 ${a.lastConfirmedAt ? ageDays(a.lastConfirmedAt) + "日前" : "未確認"}</div></div><span class="pill ${a.active ? "ok" : "warn"}">${a.active ? "使用中" : "停止"}</span></div></summary><div class="editor-body"><div class="editor-grid"><label>名称<input data-field="name" value="${esc(a.name)}"/></label>${moneyField("現在残高", "balance", a.balance)}${moneyField("維持残高", "buffer", a.buffer)}<label>最終確認<input data-field="lastConfirmedAt" type="date" value="${a.lastConfirmedAt ? toISODate(new Date(a.lastConfirmedAt)) : ""}"/></label></div><div class="row-actions" style="margin-top:10px"><button class="btn btn-small" data-action="toggle-account:${a.id}" type="button">${a.active ? "一時停止" : "再開"}</button><button class="btn btn-small" data-action="reconcile:${a.id}" type="button">残高照合</button>${state.accounts.length > 1 ? `<button class="btn btn-small btn-danger" data-action="delete-account:${a.id}" type="button">削除</button>` : ""}</div></div></details>`,
    )
    .join("");
  document.getElementById("recurringList").innerHTML = state.recurring
    .map((e) => {
      const current = monthKey(parseISODate(state.asOfDate)),
        resolved = resolveRecurringAmount(
          e,
          parseISODate(current + "-01"),
          state.forecastMode,
        ),
        status = e.active
          ? e.skipMonths.includes(current)
            ? "今月除外"
            : resolved.certainty === "confirmed"
              ? "確定"
              : "予想"
          : "停止";
      return `<details class="editor-card" data-type="recurring" data-id="${e.id}"><summary><div class="summary-line"><div><strong>${esc(e.name)}</strong><div class="list-meta">${e.kind === "income" ? "入金" : "支払"}・毎月${e.day}日・${yen.format(resolved.amount)}・${esc(accountName(e.accountId))}</div></div><span class="pill ${status === "確定" ? "ok" : status === "予想" ? "warn" : ""}">${status}</span></div></summary><div class="editor-body"><div class="editor-grid"><label>名称<input data-field="name" value="${esc(e.name)}"/></label><label>区分<select data-field="kind"><option value="expense" ${e.kind === "expense" ? "selected" : ""}>支出</option><option value="income" ${e.kind === "income" ? "selected" : ""}>収入</option></select></label><label>口座<select data-field="accountId">${optAccounts(e.accountId)}</select></label>${moneyField("基準額", "amount", e.amount)}<label>毎月の日<input data-field="day" type="number" min="1" max="31" value="${e.day}"/></label><label>休業日補正<select data-field="shift"><option value="none" ${e.shift === "none" ? "selected" : ""}>なし</option><option value="previous" ${e.shift === "previous" ? "selected" : ""}>前営業日</option><option value="next" ${e.shift === "next" ? "selected" : ""}>翌営業日</option></select></label></div><details class="advanced"><summary>詳細設定</summary><div class="advanced-grid"><label>金額方式<select data-field="amountMode"><option value="fixed" ${e.amountMode === "fixed" ? "selected" : ""}>固定額</option><option value="buffer" ${e.amountMode === "buffer" ? "selected" : ""}>予想＋上振れ率</option><option value="range" ${e.amountMode === "range" ? "selected" : ""}>範囲</option></select></label><label>上振れ率（%）<span class="help" title="保守モードで基準額へ加算します">?</span><input data-field="bufferPercent" type="number" step="0.1" value="${e.bufferPercent}"/></label>${moneyField("範囲下限", "minAmount", e.minAmount)}${moneyField("範囲上限", "maxAmount", e.maxAmount)}<label>日数調整<input data-field="offsetDays" type="number" min="-31" max="31" value="${e.offsetDays}"/></label></div></details><div class="row-actions" style="margin-top:10px"><button class="btn btn-small" data-action="duplicate-recurring:${e.id}" type="button">複製</button><button class="btn btn-small" data-action="toggle-recurring:${e.id}" type="button">${e.active ? "一時停止" : "再開"}</button><button class="btn btn-small" data-action="skip-recurring:${e.id}" type="button">${e.skipMonths.includes(current) ? "今月除外を解除" : "今月だけ除外"}</button><button class="btn btn-small" data-action="confirm-recurring:${e.id}" type="button">今月額を変更</button><button class="btn btn-small btn-danger" data-action="delete-recurring:${e.id}" type="button">削除</button></div></div></details>`;
    })
    .join("");
  document.getElementById("financingList").innerHTML = state.financing.length
    ? state.financing
        .map(
          (a) =>
            `<details class="editor-card" data-type="financing" data-id="${a.id}"><summary><div class="summary-line"><div><strong>${esc(a.name)}</strong><div class="list-meta">元本 ${yen.format(a.principal)}・年率 ${a.apr}%・毎月 ${yen.format(a.paymentAmount)}</div></div><span class="pill ${a.active ? "ok" : "warn"}">${a.active ? "計算中" : "停止"}</span></div></summary><div class="editor-body"><div class="editor-grid"><label>名称<input data-field="name" value="${esc(a.name)}"/></label><label>引落口座<select data-field="accountId">${optAccounts(a.accountId)}</select></label>${moneyField("現在元本", "principal", a.principal)}<label>実質年率（%）<input data-field="apr" type="number" step="0.01" value="${a.apr}"/></label>${moneyField("毎月返済額", "paymentAmount", a.paymentAmount)}<label>支払日<input data-field="paymentDay" type="number" min="1" max="31" value="${a.paymentDay}"/></label></div><details class="advanced"><summary>詳細設定</summary><div class="advanced-grid"><label>返済方式<span class="help" title="元金固定は毎月一定元金＋手数料、総額固定は支払総額が一定">?</span><select data-field="paymentRule"><option value="fixedPrincipal" ${a.paymentRule === "fixedPrincipal" ? "selected" : ""}>元金固定＋手数料</option><option value="fixedTotal" ${a.paymentRule === "fixedTotal" ? "selected" : ""}>支払総額固定</option></select></label><label>休業日補正<select data-field="shift"><option value="none" ${a.shift === "none" ? "selected" : ""}>なし</option><option value="previous" ${a.shift === "previous" ? "selected" : ""}>前営業日</option><option value="next" ${a.shift === "next" ? "selected" : ""}>翌営業日</option></select></label><label>前回返済日<input data-field="lastPaymentDate" type="date" value="${a.lastPaymentDate}"/></label><label>日数基準<select data-field="dayCount"><option value="365" ${a.dayCount === "365" ? "selected" : ""}>365日固定</option><option value="actual" ${a.dayCount === "actual" ? "selected" : ""}>365/366日</option></select></label><label>丸め<select data-field="rounding"><option value="floor" ${a.rounding === "floor" ? "selected" : ""}>切捨て</option><option value="round" ${a.rounding === "round" ? "selected" : ""}>四捨五入</option><option value="ceil" ${a.rounding === "ceil" ? "selected" : ""}>切上げ</option></select></label><label>金利変更日<input data-field="futureRateDate" type="date" value="${a.futureRateDate}"/></label><label>変更後年率<input data-field="futureApr" type="number" step="0.01" value="${a.futureApr}"/></label><label>遅延損害金率<input data-field="lateRate" type="number" step="0.01" value="${a.lateRate}"/></label><label>想定遅延日数<input data-field="lateDays" type="number" min="0" value="${a.lateDays}"/></label><label>遅延計算基礎<select data-field="lateBase"><option value="payment" ${a.lateBase === "payment" ? "selected" : ""}>予定支払額</option><option value="principal" ${a.lateBase === "principal" ? "selected" : ""}>元本残高</option></select></label></div></details><div class="row-actions" style="margin-top:10px"><button class="btn btn-small" data-action="toggle-financing:${a.id}" type="button">${a.active ? "一時停止" : "再開"}</button><button class="btn btn-small btn-danger" data-action="delete-financing:${a.id}" type="button">削除</button></div></div></details>`,
        )
        .join("")
    : "<p class='small'>登録はありません。</p>";
  document.getElementById("oneOffList").innerHTML = state.oneOff.length
    ? state.oneOff
        .map(
          (e) =>
            `<details class="editor-card" data-type="oneoff" data-id="${e.id}"><summary><div class="summary-line"><div><strong>${esc(e.name)}</strong><div class="list-meta">${e.date}・${yen.format(e.amount)}・${esc(accountName(e.accountId))}</div></div><span class="pill ${e.certainty === "confirmed" ? "ok" : "warn"}">${e.certainty === "confirmed" ? "確定" : "予想"}</span></div></summary><div class="editor-body"><div class="editor-grid"><label>名称<input data-field="name" value="${esc(e.name)}"/></label>${moneyField("金額（支出は－）", "amount", e.amount)}<label>日付<input data-field="date" type="date" value="${e.date}"/></label><label>口座<select data-field="accountId">${optAccounts(e.accountId)}</select></label><label>状態<select data-field="certainty"><option value="confirmed" ${e.certainty === "confirmed" ? "selected" : ""}>確定</option><option value="estimated" ${e.certainty === "estimated" ? "selected" : ""}>予想</option></select></label></div><div class="row-actions" style="margin-top:10px"><button class="btn btn-small btn-danger" data-action="delete-oneoff:${e.id}" type="button">削除</button></div></div></details>`,
        )
        .join("")
    : "<p class='small'>登録はありません。</p>";
  document.getElementById("transferList").innerHTML = state.transfers.length
    ? state.transfers
        .map(
          (t) =>
            `<details class="editor-card" data-type="transfer" data-id="${t.id}"><summary><div class="summary-line"><div><strong>${esc(t.name)}</strong><div class="list-meta">${t.date}・${yen.format(t.amount)}・${esc(accountName(t.fromAccountId))}→${esc(accountName(t.toAccountId))}</div></div></div></summary><div class="editor-body"><div class="editor-grid"><label>名称<input data-field="name" value="${esc(t.name)}"/></label>${moneyField("金額", "amount", t.amount)}<label>日付<input data-field="date" type="date" value="${t.date}"/></label><label>振替元<select data-field="fromAccountId">${optAccounts(t.fromAccountId)}</select></label><label>振替先<select data-field="toAccountId">${optAccounts(t.toAccountId)}</select></label></div><div class="row-actions" style="margin-top:10px"><button class="btn btn-small btn-danger" data-action="delete-transfer:${t.id}" type="button">削除</button></div></div></details>`,
        )
        .join("")
    : "<p class='small'>登録はありません。</p>";
}
function renderCalendar() {
  const y = calendarCursor.getFullYear(),
    m = calendarCursor.getMonth();
  document.getElementById("calendarTitle").textContent = `${y}年${m + 1}月`;
  const start = new Date(y, m, 1),
    gridStart = addDays(start, -start.getDay()),
    end = addDays(gridStart, 41),
    events = collectEvents(addDays(gridStart, -1), end, state.forecastMode, 0),
    byDate = new Map();
  for (const e of events) {
    const k = toISODate(e.date);
    if (!byDate.has(k)) byDate.set(k, []);
    byDate.get(k).push(e);
  }
  const weekdays = ["日", "月", "火", "水", "木", "金", "土"];
  let html = weekdays.map((x) => `<div class="weekday">${x}</div>`).join("");
  for (let i = 0; i < 42; i++) {
    const d = addDays(gridStart, i),
      list = byDate.get(toISODate(d)) || [];
    html += `<div class="day ${d.getMonth() !== m ? "other" : ""} ${toISODate(d) === state.asOfDate ? "today" : ""}"><div class="day-num">${d.getDate()}</div>${list
      .slice(0, 3)
      .map(
        (e) =>
          `<span class="event-chip ${e.amount < 0 ? "expense" : "income"}" title="${esc(e.name)} ${yen.format(e.amount)}">${esc(e.name)} ${yen.format(e.amount)}</span>`,
      )
      .join(
        "",
      )}${list.length > 3 ? `<span class="event-chip">ほか${list.length - 3}件</span>` : ""}</div>`;
  }
  document.getElementById("calendarGrid").innerHTML = html;
  const forecast = buildForecast(state.forecastMode),
    tbody = document.getElementById("forecastTableBody");
  tbody.innerHTML = forecast.eventRows.length
    ? forecast.eventRows
        .map(
          (r) =>
            `<tr><td>${esc(dateFmt.format(r.date))}</td><td>${r.source === "financing" ? `<details><summary>${esc(r.name)}</summary><div class="small">元金 ${yen.format(r.meta.principalPayment)} / 通常手数料 ${yen.format(r.meta.regularInterest)} / 遅延 ${yen.format(r.meta.lateFee)} / 支払後元本 ${yen.format(r.meta.principalAfter)} / ${r.meta.days}日 / 年率 ${r.meta.apr}%</div></details>` : `${esc(r.name)}<div class="small">${esc(r.meta?.basis || "")}</div>`}</td><td>${esc(accountName(r.accountId))}</td><td class="${r.amount >= 0 ? "positive" : "negative"}">${r.amount >= 0 ? "+" : ""}${yen.format(r.amount)}</td><td class="${r.accountBalanceAfter < 0 ? "negative" : ""}">${yen.format(r.accountBalanceAfter)}</td></tr>`,
        )
        .join("")
    : "<tr><td colspan='5'>予定はありません。</td></tr>";
}
function renderBackup() {
  const text = state.lastBackupAt
    ? `最終バックアップ：${fullDateFmt.format(new Date(state.lastBackupAt))}`
    : "バックアップ未実施";
  document.getElementById("backupStatus").textContent = text;
  const banner = document.getElementById("backupBanner");
  if (!state.lastBackupAt || ageDays(state.lastBackupAt) > 30) {
    banner.classList.remove("hidden");
    banner.innerHTML = `<div class="backup-banner"><span>バックアップを推奨します。</span><button class="btn btn-small" data-action="export" type="button">書き出す</button></div>`;
  } else banner.classList.add("hidden");
}
function bindMoneyPreviews() {
  document.querySelectorAll("input[data-money]").forEach((i) => {
    const p = i.parentElement.querySelector(".money-preview");
    const update = () => {
      if (p) p.textContent = yen.format(intMoney(i.value));
    };
    update();
    i.addEventListener("input", update);
    if (!i.parentElement.querySelector(".money-quick")) {
      const q = document.createElement("div");
      q.className = "quick-actions money-quick";
      q.style.marginTop = "5px";
      for (const [label, add] of [
        ["＋1,000", 1000],
        ["＋5,000", 5000],
        ["＋10,000", 10000],
      ]) {
        const b = document.createElement("button");
        b.type = "button";
        b.className = "btn btn-small";
        b.textContent = label;
        b.addEventListener("click", () => {
          i.value = intMoney(i.value) + add;
          i.dispatchEvent(new Event("input", { bubbles: true }));
          i.dispatchEvent(new Event("change", { bubbles: true }));
        });
        q.appendChild(b);
      }
      i.parentElement.appendChild(q);
    }
  });
}
let balanceChartState = null;
function chartDateLabel(date, showYear = false) {
  return showYear
    ? `${date.getFullYear()}/${date.getMonth() + 1}/${date.getDate()}`
    : `${date.getMonth() + 1}/${date.getDate()}`;
}
function drawChart(data, buffer, selectedIndex = null) {
  const c = document.getElementById("balanceChart"),
    tooltip = document.getElementById("chartTooltip"),
    rect = c.getBoundingClientRect();
  if (!rect.width || !rect.height || !data.length) return;
  const dpr = Math.max(1, devicePixelRatio || 1);
  c.width = Math.round(rect.width * dpr);
  c.height = Math.round(rect.height * dpr);
  const ctx = c.getContext("2d");
  ctx.scale(dpr, dpr);
  const w = rect.width,
    h = rect.height,
    p = { l: 56, r: 12, t: 15, b: 44 },
    pw = w - p.l - p.r,
    ph = h - p.t - p.b,
    vals = data.map((x) => x.total).concat([buffer, 0]);
  let min = Math.min(...vals),
    max = Math.max(...vals);
  if (min === max) {
    min--;
    max++;
  }
  const margin = (max - min) * 0.12;
  min -= margin;
  max += margin;
  const X = (i) => p.l + (i / Math.max(1, data.length - 1)) * pw,
    Y = (v) => p.t + ((max - v) / (max - min)) * ph,
    css = (n) =>
      getComputedStyle(document.documentElement).getPropertyValue(n).trim();
  ctx.clearRect(0, 0, w, h);
  ctx.font = "12px sans-serif";
  ctx.fillStyle = css("--muted");
  ctx.strokeStyle = css("--line");
  ctx.lineWidth = 1;
  for (let i = 0; i <= 4; i++) {
    const v = max - (i / 4) * (max - min),
      yy = Y(v);
    ctx.beginPath();
    ctx.moveTo(p.l, yy);
    ctx.lineTo(w - p.r, yy);
    ctx.stroke();
    ctx.textAlign = "left";
    ctx.fillText(
      Math.abs(v) >= 10000 ? `${Math.round(v / 10000)}万` : `${Math.round(v)}`,
      3,
      yy + 4,
    );
  }
  const tickTarget = w < 430 ? 4 : w < 700 ? 5 : 7,
    tickIndexes = [
      ...new Set(
        Array.from({ length: tickTarget }, (_, i) =>
          Math.round((i * (data.length - 1)) / Math.max(1, tickTarget - 1)),
        ),
      ),
    ],
    crossYear = data[0].date.getFullYear() !== data.at(-1).date.getFullYear();
  ctx.textBaseline = "top";
  for (const [n, idx] of tickIndexes.entries()) {
    const xx = X(idx);
    ctx.strokeStyle = css("--line");
    ctx.beginPath();
    ctx.moveTo(xx, h - p.b);
    ctx.lineTo(xx, h - p.b + 5);
    ctx.stroke();
    ctx.fillStyle = css("--muted");
    ctx.textAlign =
      n === 0 ? "left" : n === tickIndexes.length - 1 ? "right" : "center";
    ctx.fillText(chartDateLabel(data[idx].date, crossYear), xx, h - p.b + 8);
  }
  ctx.save();
  ctx.setLineDash([6, 5]);
  ctx.strokeStyle = css("--warn");
  ctx.beginPath();
  ctx.moveTo(p.l, Y(buffer));
  ctx.lineTo(w - p.r, Y(buffer));
  ctx.stroke();
  ctx.restore();
  ctx.strokeStyle = css("--primary");
  ctx.lineWidth = 2.5;
  ctx.beginPath();
  data.forEach((d, i) =>
    i ? ctx.lineTo(X(i), Y(d.total)) : ctx.moveTo(X(i), Y(d.total)),
  );
  ctx.stroke();
  if (
    Number.isInteger(selectedIndex) &&
    selectedIndex >= 0 &&
    selectedIndex < data.length
  ) {
    const d = data[selectedIndex],
      xx = X(selectedIndex),
      yy = Y(d.total);
    ctx.save();
    ctx.setLineDash([3, 4]);
    ctx.strokeStyle = css("--muted");
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(xx, p.t);
    ctx.lineTo(xx, h - p.b);
    ctx.stroke();
    ctx.restore();
    ctx.fillStyle = css("--primary");
    ctx.beginPath();
    ctx.arc(xx, yy, 4.5, 0, Math.PI * 2);
    ctx.fill();
    tooltip.classList.remove("hidden");
    tooltip.innerHTML = `<strong>${fullDateFmt.format(d.date)}</strong><br>${yen.format(d.total)}`;
    const tw = tooltip.offsetWidth || 110,
      half = tw / 2 + 5;
    tooltip.style.left = `${Math.max(half, Math.min(w - half, xx))}px`;
    tooltip.style.top = `${Math.max(46, yy - 8)}px`;
  } else tooltip.classList.add("hidden");
  balanceChartState = { data, buffer, p, pw, w };
}
function selectChartPoint(event) {
  const c = document.getElementById("balanceChart"),
    st = balanceChartState;
  if (!st || !st.data.length) return;
  const rect = c.getBoundingClientRect(),
    x = event.clientX - rect.left,
    ratio = Math.max(0, Math.min(1, (x - st.p.l) / Math.max(1, st.pw))),
    idx = Math.round(ratio * (st.data.length - 1));
  drawChart(st.data, st.buffer, idx);
}
function bindChartInteraction() {
  const c = document.getElementById("balanceChart");
  if (c.dataset.bound) return;
  c.dataset.bound = "1";
  c.addEventListener("pointerdown", selectChartPoint);
  c.addEventListener("pointermove", (e) => {
    if (e.pointerType === "mouse") selectChartPoint(e);
  });
  c.addEventListener("pointerleave", () => {
    const st = balanceChartState;
    if (st) drawChart(st.data, st.buffer, null);
  });
}
function openModal(title, html) {
  document.getElementById("modalTitle").textContent = title;
  document.getElementById("modalBody").innerHTML = html;
  document.getElementById("modal").classList.remove("hidden");
  bindMoneyPreviews();
}
function closeModal() {
  document.getElementById("modal").classList.add("hidden");
}
function confirmRecurring(id) {
  const e = state.recurring.find((x) => x.id === id);
  if (!e) return;
  const mk = monthKey(parseISODate(state.asOfDate)),
    prev = e.history.at(-1)?.amount ?? e.amount,
    avg = e.history.length
      ? Math.round(
          e.history.slice(-3).reduce((s, x) => s + x.amount, 0) /
            Math.min(3, e.history.length),
        )
      : e.amount;
  openModal(
    `${e.name}の${mk}請求額`,
    `<p class="small">前月 ${yen.format(prev)} / 3カ月平均 ${yen.format(avg)}</p><label>確定額<input id="confirmAmount" data-money type="number" value="${e.confirmedByMonth?.[mk] ?? prev}"/><div class="money-preview"></div></label><div class="quick-actions" style="margin-top:8px"><button class="btn btn-small" data-fill="${prev}" type="button">前月額</button><button class="btn btn-small" data-fill="${avg}" type="button">3カ月平均</button></div><button class="btn btn-primary" id="confirmAmountSave" style="margin-top:12px" type="button">保存</button>`,
  );
  document.querySelectorAll("[data-fill]").forEach(
    (b) =>
      (b.onclick = () => {
        const i = document.getElementById("confirmAmount");
        i.value = b.dataset.fill;
        i.dispatchEvent(new Event("input"));
      }),
  );
  document.getElementById("confirmAmountSave").onclick = () => {
    const amount = Math.max(
      0,
      intMoney(document.getElementById("confirmAmount").value),
    );
    e.confirmedByMonth[mk] = amount;
    e.history = e.history.filter((x) => x.month !== mk);
    e.history.push({ month: mk, amount });
    e.lastConfirmedAt = isoNow();
    closeModal();
    showToast(`${e.name}：${e.day}日に${yen.format(amount)}（確定）`);
    render();
  };
}
function reconcile(accountId = state.defaultAccountId) {
  const a = state.accounts.find((x) => x.id === accountId);
  if (!a) return;
  openModal(
    `${a.name}の残高照合`,
    `<p class="small">基準日時点の残高を実際の残高へ置き換えます。差額を別取引として二重計上しません。</p><label>実際の現在残高<input id="actualBalance" data-money type="number" value="${a.balance}"/><div class="money-preview"></div></label><div id="reconcileDiff" class="range-line">差額 0円</div><button class="btn btn-primary" id="reconcileSave" style="margin-top:12px" type="button">実残高へ合わせる</button>`,
  );
  const inp = document.getElementById("actualBalance"),
    diff = document.getElementById("reconcileDiff");
  inp.oninput = () => {
    diff.textContent = `差額 ${yen.format(intMoney(inp.value) - a.balance)}`;
  };
  document.getElementById("reconcileSave").onclick = () => {
    const next = intMoney(inp.value);
    a.balance = next;
    a.lastConfirmedAt = isoNow();
    closeModal();
    showToast(`${a.name}：${yen.format(next)}へ更新`);
    render();
  };
}
function exportData() {
  state.lastBackupAt = isoNow();
  saveState();
  const payload = {
      format: "zandaka-yohou-backup",
      version: 1,
      appVersion: APP_VERSION,
      exportedAt: state.lastBackupAt,
      state,
    },
    blob = new Blob([JSON.stringify(payload, null, 2)], {
      type: "application/json",
    }),
    url = URL.createObjectURL(blob),
    a = document.createElement("a");
  a.href = url;
  a.download = `zandaka-yohou-${state.asOfDate}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  renderBackup();
  showToast("バックアップを書き出しました");
}
function addQuickOneOff() {
  openModal(
    "臨時入出金を追加",
    `<div class="form-grid"><label>名称<input id="quickName" value="臨時支出"/></label><label>口座<select id="quickAccount">${optAccounts(state.defaultAccountId)}</select></label><label>金額（支出は－）<input id="quickAmount" data-money type="number" value="-1000"/><div class="money-preview"></div></label><label>日付<input id="quickDate" type="date" value="${state.asOfDate}"/></label></div><label style="margin-top:12px"><input id="quickToHousehold" type="checkbox" style="width:auto;display:inline;margin-right:6px" checked/>家計簿にも記録する</label><p class="small">予報への反映は「一度だけの入出金」が担当し、家計簿側は二重計上を避けるため記録のみで追加します。</p><button class="btn btn-primary" id="quickSave" style="margin-top:12px" type="button">保存</button>`,
  );
  document.getElementById("quickSave").onclick = () => {
    const e = sanitizeOneOff({
      name: document.getElementById("quickName").value,
      accountId: document.getElementById("quickAccount").value,
      amount: document.getElementById("quickAmount").value,
      date: document.getElementById("quickDate").value,
      certainty: "confirmed",
    });
    state.oneOff.push(e);
    if (document.getElementById("quickToHousehold")?.checked) {
      const entry=sanitizeLedgerEntry({name:e.name,kind:e.amount>=0?"income":"expense",amount:Math.abs(e.amount),category:guessHouseholdCategory(e.name,e.amount),date:e.date,accountId:e.accountId,paymentMethod:"bank",affectsBalance:false,note:"予報の臨時入出金と連携",sourceKey:`oneOff|${e.id}|${e.date}|${e.amount}`});
      state.ledgerEntries.push(entry); if(!state.household.categories.includes(entry.category))state.household.categories.push(entry.category);
    }
    closeModal();
    showToast(`${e.name}：${yen.format(e.amount)}`);
    render();
  };
}
function exportHouseholdCsv() {
  const rows=householdEntriesForMonth(), escCsv=(v)=>`"${String(v??"").replaceAll('"','""')}"`, header=["日付","区分","内容","カテゴリ","金額","支払方法","口座","予報連携","メモ"];
  const body=rows.map(e=>[e.date,e.kind==="expense"?"支出":"収入",e.name,e.category,e.amount,paymentMethodLabel(e.paymentMethod),accountName(e.accountId),e.affectsBalance?"反映":"記録のみ",e.note]);
  const csv="\ufeff"+[header,...body].map(r=>r.map(escCsv).join(",")).join("\r\n"), blob=new Blob([csv],{type:"text/csv;charset=utf-8"}),url=URL.createObjectURL(blob),a=document.createElement("a");
  a.href=url;a.download=`zandaka-kakeibo-${state.household.selectedMonth}.csv`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);showToast("家計簿CSVを書き出しました");
}
function handleAction(action) {
  const [cmd, id] = String(action).split(":");
  if (cmd === "export") return exportData();
  if (cmd === "export-household-csv") return exportHouseholdCsv();
  if (cmd === "add-ledger-expense") return openLedgerModal("", "expense");
  if (cmd === "add-ledger-income") return openLedgerModal("", "income");
  if (cmd === "edit-ledger") return openLedgerModal(id);
  if (cmd === "delete-ledger") { state.ledgerEntries = state.ledgerEntries.filter(x=>x.id!==id); return render(); }
  if (cmd === "import-household") return importPlannedToHousehold(id);
  if (cmd === "open-forecast") return setView("home");
  if (cmd === "add-household-category") { const input=document.getElementById("householdNewCategory"), value=String(input?.value||"").trim(); if(!value)return showToast("カテゴリ名を入力してください"); if(state.household.categories.includes(value))return showToast("同じカテゴリがあります"); state.household.categories.push(value); return render(); }
  if (cmd === "delete-household-category") { const value=decodeURIComponent(id||""); if((state.ledgerEntries||[]).some(e=>e.category===value))return showToast("使用中のカテゴリは削除できません"); state.household.categories=state.household.categories.filter(c=>c!==value); return render(); }
  if (cmd === "quick-oneoff") return addQuickOneOff();
  if (cmd === "reconcile") return reconcile(id || state.defaultAccountId);
  if (cmd === "confirm-recurring") return confirmRecurring(id);
  if (cmd === "add-account") {
    state.accounts.push(
      sanitizeAccount({
        name: "新しい口座",
        balance: 0,
        buffer: 0,
        lastConfirmedAt: isoNow(),
      }),
    );
    return render();
  }
  if (cmd === "delete-account") {
    if (state.accounts.length <= 1)
      return showToast("最後の口座は削除できません");
    const linked =
      state.recurring.some((x) => x.accountId === id) ||
      state.financing.some((x) => x.accountId === id) ||
      state.oneOff.some((x) => x.accountId === id) ||
      (state.ledgerEntries || []).some((x) => x.accountId === id) ||
      state.transfers.some(
        (x) => x.fromAccountId === id || x.toAccountId === id,
      );
    if (linked)
      return showToast("この口座を使う取引を先に変更または削除してください");
    state.accounts = state.accounts.filter((x) => x.id !== id);
    if (state.defaultAccountId === id)
      state.defaultAccountId = state.accounts[0].id;
    return render();
  }
  if (cmd === "toggle-account") {
    const x = state.accounts.find((a) => a.id === id);
    if (!x) return;
    if (x.active && state.accounts.filter((a) => a.active).length <= 1)
      return showToast("使用中の口座を最低1つ残してください");
    x.active = !x.active;
    if (!x.active && state.defaultAccountId === x.id)
      state.defaultAccountId =
        state.accounts.find((a) => a.active)?.id || state.accounts[0].id;
    return render();
  }
  if (cmd === "add-recurring") {
    state.recurring.push(
      sanitizeRecurring({
        name: "新しい支払い",
        kind: "expense",
        accountId: state.defaultAccountId,
        amount: 0,
        day: 1,
        amountMode: "fixed",
      }),
    );
    return render();
  }
  if (cmd === "duplicate-recurring") {
    const e = state.recurring.find((x) => x.id === id);
    state.recurring.push(
      sanitizeRecurring({
        ...deepClone(e),
        id: uid(),
        name: e.name + " コピー",
      }),
    );
    return render();
  }
  if (cmd === "toggle-recurring") {
    const e = state.recurring.find((x) => x.id === id);
    e.active = !e.active;
    showToast(`${e.name}：${e.active ? "再開" : "一時停止"}`);
    return render();
  }
  if (cmd === "skip-recurring") {
    const e = state.recurring.find((x) => x.id === id),
      mk = monthKey(parseISODate(state.asOfDate));
    e.skipMonths = e.skipMonths.includes(mk)
      ? e.skipMonths.filter((x) => x !== mk)
      : [...e.skipMonths, mk];
    showToast(
      `${e.name}：${e.skipMonths.includes(mk) ? "今月除外" : "除外解除"}`,
    );
    return render();
  }
  if (cmd === "delete-recurring") {
    state.recurring = state.recurring.filter((x) => x.id !== id);
    return render();
  }
  if (cmd === "add-financing") {
    const start = parseISODate(state.asOfDate),
      a = sanitizeFinancing({
        name: "新しいリボ・ローン",
        accountId: state.defaultAccountId,
        principal: 100000,
        apr: 15,
        paymentAmount: 10000,
        paymentDay: 27,
        shift: "next",
      });
    a.lastPaymentDate = toISODate(
      previousMonthlyOccurrence(start, { day: a.paymentDay, shift: a.shift }),
    );
    state.financing.push(a);
    return render();
  }
  if (cmd === "toggle-financing") {
    const a = state.financing.find((x) => x.id === id);
    a.active = !a.active;
    return render();
  }
  if (cmd === "delete-financing") {
    state.financing = state.financing.filter((x) => x.id !== id);
    return render();
  }
  if (cmd === "add-oneoff") {
    state.oneOff.push(
      sanitizeOneOff({
        name: "臨時支出",
        accountId: state.defaultAccountId,
        amount: 0,
        date: state.asOfDate,
      }),
    );
    return render();
  }
  if (cmd === "delete-oneoff") {
    state.oneOff = state.oneOff.filter((x) => x.id !== id);
    return render();
  }
  if (cmd === "add-transfer") {
    const to =
      state.accounts.find((x) => x.id !== state.defaultAccountId)?.id ||
      state.defaultAccountId;
    state.transfers.push({
      id: uid(),
      name: "口座間振替",
      fromAccountId: state.defaultAccountId,
      toAccountId: to,
      amount: 0,
      date: state.asOfDate,
    });
    return render();
  }
  if (cmd === "delete-transfer") {
    state.transfers = state.transfers.filter((x) => x.id !== id);
    return render();
  }
  if (cmd === "add-closure") {
    state.calendar.customClosures.push({
      id: uid(),
      name: "独自休業日",
      date: state.asOfDate,
    });
    return render();
  }
  if (cmd === "delete-closure") {
    state.calendar.customClosures = state.calendar.customClosures.filter(
      (x) => x.id !== id,
    );
    return render();
  }
}
function coerceField(type, key, v) {
  if (key === "balance") return intMoney(v);
  if (
    ["buffer", "minAmount", "maxAmount", "principal", "paymentAmount"].includes(
      key,
    )
  )
    return Math.max(0, intMoney(v));
  if (key === "amount")
    return type === "oneoff" ? intMoney(v) : Math.max(0, intMoney(v));
  if (["day", "paymentDay"].includes(key))
    return Math.min(31, Math.max(1, Math.trunc(Number(v)) || 1));
  if (key === "offsetDays")
    return Math.min(31, Math.max(-31, Math.trunc(Number(v)) || 0));
  if (key === "lateDays")
    return Math.min(365, Math.max(0, Math.trunc(Number(v)) || 0));
  if (["apr", "futureApr", "lateRate"].includes(key))
    return Math.min(100, Math.max(0, num(v)));
  if (key === "bufferPercent") return Math.min(500, Math.max(0, num(v)));
  if (key === "lastConfirmedAt")
    return v ? new Date(v + "T00:00:00").toISOString() : "";
  if (key === "date") return isValidISODate(v) ? v : state.asOfDate;
  return v;
}
document.addEventListener("change", (e) => {
  const input = e.target,
    card = input.closest("[data-type][data-id]");
  if (card && input.dataset.field) {
    const type = card.dataset.type,
      id = card.dataset.id,
      collection =
        type === "account"
          ? state.accounts
          : type === "recurring"
            ? state.recurring
            : type === "financing"
              ? state.financing
              : type === "oneoff"
                ? state.oneOff
                : type === "closure"
                  ? state.calendar.customClosures
                  : state.transfers,
      obj = collection.find((x) => x.id === id);
    if (obj) {
      obj[input.dataset.field] = coerceField(
        type,
        input.dataset.field,
        input.value,
      );
      showToast(`${obj.name || "項目"}：保存`);
      render();
      return;
    }
  }
  if (input.id === "asOfDate")
    state.asOfDate = isValidISODate(input.value) ? input.value : todayISO();
  else if (input.id === "horizonDays") state.horizonDays = Number(input.value);
  else if (input.id === "forecastMode") state.forecastMode = input.value;
  else if (input.id === "defaultAccountId")
    state.defaultAccountId = input.value;
  else if (input.id === "scenarioSpend")
    state.scenarioSpend = Math.max(0, intMoney(input.value));
  else if (input.id === "staleDays")
    state.staleDays = Math.max(1, Math.trunc(Number(input.value)) || 30);
  else if (input.id === "householdMonthlyBudget")
    state.household.monthlyBudget = Math.max(0, intMoney(input.value));
  else if (input.id === "householdDefaultPayment")
    state.household.defaultPaymentMethod = input.value;
  else if (input.id === "householdCategoryFilter") {
    state.household.filterCategory = input.value;
    renderHousehold(); saveState(); return;
  }
  else if (input.id === "useWeekends")
    state.calendar.useWeekends = input.checked;
  else if (input.id === "useNationalHolidays")
    state.calendar.useNationalHolidays = input.checked;
  else if (input.id === "useBankYearEnd")
    state.calendar.useBankYearEnd = input.checked;
  else return;
  render();
});
document.addEventListener("click", (e) => {
  const btn = e.target.closest("[data-action]");
  if (btn) handleAction(btn.dataset.action);
});
document
  .querySelectorAll(".tab")
  .forEach((b) => (b.onclick = () => setView(b.dataset.view)));
document.getElementById("prevHouseholdMonth").onclick = () => { const {start}=householdMonthRange(); start.setMonth(start.getMonth()-1); state.household.selectedMonth=monthKey(start); render(); };
document.getElementById("nextHouseholdMonth").onclick = () => { const {start}=householdMonthRange(); start.setMonth(start.getMonth()+1); state.household.selectedMonth=monthKey(start); render(); };
document.getElementById("prevMonth").onclick = () => {
  calendarCursor.setMonth(calendarCursor.getMonth() - 1);
  state.calendarMonth = monthKey(calendarCursor);
  renderCalendar();
};
document.getElementById("nextMonth").onclick = () => {
  calendarCursor.setMonth(calendarCursor.getMonth() + 1);
  state.calendarMonth = monthKey(calendarCursor);
  renderCalendar();
};
document.getElementById("modalClose").onclick = closeModal;
document.getElementById("modal").addEventListener("click", (e) => {
  if (e.target.id === "modal") closeModal();
});
document.addEventListener("keydown", (e) => {
  if (
    e.key === "Escape" &&
    !document.getElementById("modal").classList.contains("hidden")
  )
    closeModal();
});
window.addEventListener("error", (e) => showFatal(e.error || e.message));
window.addEventListener("unhandledrejection", (e) => showFatal(e.reason));
document.getElementById("exportBtn").onclick = exportData;
document.getElementById("exportBtn2").onclick = exportData;
document.getElementById("importBtn").onclick = () =>
  document.getElementById("importFile").click();
document.getElementById("importBtn2").onclick = () =>
  document.getElementById("importFile").click();
document.getElementById("importFile").onchange = async (e) => {
  const f = e.target.files?.[0];
  if (!f) return;
  try {
    const parsed = JSON.parse(await f.text()),
      raw = parsed?.format === "zandaka-yohou-backup" ? parsed.state : parsed;
    if (!raw || typeof raw !== "object") throw new Error("invalid backup");
    state = sanitizeState(raw);
    render();
    showToast("データを復元しました");
  } catch {
    alert("残高予報のバックアップJSONを読み込めませんでした");
  }
  e.target.value = "";
};
document.getElementById("resetBtn").onclick = () => {
  if (confirm("すべて初期化しますか？")) {
    state = blankInitialState();
    storageRemove(STORAGE_KEY);
    for (const key of LEGACY_KEYS) storageRemove(key);
    render();
    openWizard();
  }
};
window.addEventListener("pagehide", () => { if (state.setupComplete || state.accounts.length || state.ledgerEntries.length) saveState(); });
document.getElementById("demoBtn").onclick = () => {
  if (!confirm("現在の入力をデモデータへ置き換えますか？")) return;
  state = demoState();
  render();
  showToast("デモデータを読み込みました");
};
document.getElementById("setupBtn").onclick = () => openWizard(false);
function renderInstallHelp() {
  const help = document.getElementById("installHelp"),
    btn = document.getElementById("installBtn"),
    ios = /iPad|iPhone|iPod/.test(navigator.userAgent),
    standalone =
      window.matchMedia?.("(display-mode: standalone)")?.matches ||
      navigator.standalone === true;
  if (standalone) {
    help.textContent = "ホーム画面からアプリとして起動中です。";
    btn.disabled = true;
    btn.textContent = "インストール済み";
  } else if (ios) {
    help.textContent =
      "Safariの共有ボタンから「ホーム画面に追加」を選択してください。";
    btn.disabled = true;
    btn.textContent = "Safariの共有から追加";
  } else if (!deferredInstall) {
    help.textContent = "通常のChrome等で公開URLを開くとインストールできます。";
    btn.disabled = true;
    btn.textContent = "インストール待機中";
  }
}
let deferredInstall = null;
window.addEventListener("beforeinstallprompt", (e) => {
  e.preventDefault();
  deferredInstall = e;
  const btn = document.getElementById("installBtn");
  btn.disabled = false;
  btn.textContent = "インストール";
  renderInstallHelp();
});
document.getElementById("installBtn").onclick = async () => {
  if (deferredInstall) {
    deferredInstall.prompt();
    await deferredInstall.userChoice;
    deferredInstall = null;
  }
};
if ("serviceWorker" in navigator && location.protocol.startsWith("http"))
  navigator.serviceWorker.register("sw.js").catch(() => {});
window.addEventListener("resize", () =>
  drawChart(
    calculateSummary().main.daily,
    state.accounts.filter((a) => a.active).reduce((q, a) => q + a.buffer, 0),
  ),
);
let wizardStep = 0;
const wizardSteps = ["口座", "給与", "固定費", "カード", "維持残高", "家計簿予算", "確認"];
function openWizard(showStartChoice = false) {
  if (!showStartChoice) ensureWizardSeed();
  wizardStep = showStartChoice ? -1 : 0;
  document.getElementById("wizard").classList.remove("hidden");
  renderWizard();
}
function bindFirstRunChoiceFallback() {
  const wizard = document.getElementById("wizard");
  if (!wizard || wizard.dataset.choiceFallbackBound === "1") return;
  wizard.dataset.choiceFallbackBound = "1";
  wizard.addEventListener("click", (event) => {
    const button = event.target.closest("#startBlank, #startDemo");
    if (!button) return;
    event.preventDefault();
    event.stopPropagation();
    if (button.id === "startBlank") {
      ensureWizardSeed();
      wizardStep = 0;
      renderWizard();
      return;
    }
    state = demoState();
    wizard.classList.add("hidden");
    render();
    showToast("デモデータを読み込みました");
  });
}
bindFirstRunChoiceFallback();
function renderWizard() {
  const progress = document.getElementById("wizardProgress"),
    back = document.getElementById("wizardBack"),
    next = document.getElementById("wizardNext"),
    skip = document.getElementById("wizardSkip"),
    subtitle = document.getElementById("wizardSubtitle");
  if (wizardStep === -1) {
    subtitle.textContent =
      "開始方法を選んでください。後から設定画面でデモと実データを切り替えられます。";
    progress.classList.add("hidden");
    back.classList.add("hidden");
    next.classList.add("hidden");
    skip.classList.add("hidden");
    document.getElementById("wizardBody").innerHTML =
      `<div class="start-choice"><button class="start-option recommended" id="startBlank" type="button"><strong>自分のデータで始める</strong><span>空の状態から口座残高、給与、固定費、カード請求を順に入力します。</span></button><button class="start-option" id="startDemo" type="button"><strong>デモで試す</strong><span>架空の数字を読み込み、画面と計算の動きを先に確認します。</span></button></div><p class="small" style="margin-top:12px">デモの数字は実際の資金管理には使用しないでください。</p>`;
    document.getElementById("startBlank").onclick = () => {
      ensureWizardSeed();
      wizardStep = 0;
      renderWizard();
    };
    document.getElementById("startDemo").onclick = () => {
      state = demoState();
      document.getElementById("wizard").classList.add("hidden");
      render();
      showToast("デモデータを読み込みました");
    };
    return;
  }
  subtitle.textContent = "必要な項目だけ順に設定します。";
  progress.classList.remove("hidden");
  back.classList.remove("hidden");
  next.classList.remove("hidden");
  skip.classList.remove("hidden");
  progress.innerHTML = wizardSteps
    .map((_, i) => `<span class="${i <= wizardStep ? "on" : ""}"></span>`)
    .join("");
  const a = state.accounts[0],
    salary =
      state.recurring.find((x) => x.kind === "income") || state.recurring[0],
    rent = state.recurring.find((x) => x.name.includes("家賃")),
    card = state.recurring.find((x) => x.name.includes("クレジット"));
  let html = "";
  if (wizardStep === 0)
    html = `<div class="form-grid"><label>口座名<input id="wAccountName" value="${esc(a.name)}"/></label><label>現在残高<input id="wBalance" data-money type="number" value="${a.balance}"/><div class="money-preview"></div></label></div>`;
  if (wizardStep === 1)
    html = `<div class="form-grid"><label>給与額<input id="wSalary" data-money type="number" value="${salary.amount}"/><div class="money-preview"></div></label><label>給与日<input id="wSalaryDay" type="number" min="1" max="31" value="${salary.day}"/></label></div>`;
  if (wizardStep === 2)
    html = `<div class="form-grid"><label>家賃・固定費<input id="wRent" data-money type="number" value="${rent.amount}"/><div class="money-preview"></div></label><label>支払日<input id="wRentDay" type="number" min="1" max="31" value="${rent.day}"/></label></div>`;
  if (wizardStep === 3)
    html = `<div class="form-grid"><label>カード予想額<input id="wCard" data-money type="number" value="${card.amount}"/><div class="money-preview"></div></label><label>支払日<input id="wCardDay" type="number" min="1" max="31" value="${card.day}"/></label></div>`;
  if (wizardStep === 4)
    html = `<label>最低限残す金額<input id="wBuffer" data-money type="number" value="${a.buffer}"/><div class="money-preview"></div></label>`;
  if (wizardStep === 5)
    html = `<label>1カ月の生活予算<input id="wHouseholdBudget" data-money type="number" min="0" value="${state.household.monthlyBudget}"/><div class="money-preview"></div></label><p class="small">0円のままでも開始できます。後から家計簿設定で変更できます。</p>`;
  if (wizardStep === 6)
    html = `<div class="alert ok"><strong>${esc(a.name)}</strong><br>残高 ${yen.format(a.balance)} / 給与 ${yen.format(salary.amount)}（${salary.day}日） / 固定費 ${yen.format(rent.amount)} / カード予想 ${yen.format(card.amount)} / 維持残高 ${yen.format(a.buffer)} / 月予算 ${state.household.monthlyBudget?yen.format(state.household.monthlyBudget):"未設定"}</div>`;
  document.getElementById("wizardBody").innerHTML = html;
  back.disabled = wizardStep === 0;
  next.textContent = wizardStep === wizardSteps.length - 1 ? "完了" : "次へ";
  bindMoneyPreviews();
}
function saveWizardStep() {
  const a = state.accounts[0],
    salary =
      state.recurring.find((x) => x.kind === "income") || state.recurring[0],
    rent = state.recurring.find((x) => x.name.includes("家賃")),
    card = state.recurring.find((x) => x.name.includes("クレジット"));
  if (wizardStep === 0) {
    a.name = document.getElementById("wAccountName").value;
    a.balance = intMoney(document.getElementById("wBalance").value);
  }
  if (wizardStep === 1) {
    salary.amount = Math.max(
      0,
      intMoney(document.getElementById("wSalary").value),
    );
    salary.day = Math.min(
      31,
      Math.max(1, Number(document.getElementById("wSalaryDay").value)),
    );
  }
  if (wizardStep === 2) {
    rent.amount = Math.max(0, intMoney(document.getElementById("wRent").value));
    rent.day = Math.min(
      31,
      Math.max(1, Number(document.getElementById("wRentDay").value)),
    );
  }
  if (wizardStep === 3) {
    card.amount = Math.max(0, intMoney(document.getElementById("wCard").value));
    card.day = Math.min(
      31,
      Math.max(1, Number(document.getElementById("wCardDay").value)),
    );
  }
  if (wizardStep === 4)
    a.buffer = Math.max(0, intMoney(document.getElementById("wBuffer").value));
  if (wizardStep === 5)
    state.household.monthlyBudget = Math.max(0, intMoney(document.getElementById("wHouseholdBudget").value));
}
document.getElementById("wizardNext").onclick = () => {
  saveWizardStep();
  if (wizardStep === wizardSteps.length - 1) {
    state.recurring = state.recurring.filter(r => Number(r.amount || 0) > 0);
    state.accounts = state.accounts.filter(a => String(a.name || "").trim() || Number(a.balance || 0) !== 0);
    state.defaultAccountId = state.accounts[0]?.id || "";
    state.setupComplete = true;
    document.getElementById("wizard").classList.add("hidden");
    render();
    showToast("初回設定を保存しました");
  } else {
    wizardStep++;
    renderWizard();
  }
};
document.getElementById("wizardBack").onclick = () => {
  saveWizardStep();
  wizardStep = Math.max(0, wizardStep - 1);
  renderWizard();
};
document.getElementById("wizardSkip").onclick = () => {
  state = blankInitialState();
  document.getElementById("wizard").classList.add("hidden");
  render();
  showToast("未登録の状態で閉じました");
};
function runSelfTests() {
  const results = [],
    ok = (name, cond) => results.push(`${cond ? "PASS" : "FAIL"} ${name}`),
    original = deepClone(state);
  try {
    state = wizardTemplateState();
    state.setupComplete = true;
    const aid = state.accounts[0].id;
    state.accounts[0].balance = 100000;
    state.accounts[0].buffer = 20000;
    state.recurring = [];
    state.oneOff = [
      sanitizeOneOff({
        name: "支出",
        accountId: aid,
        amount: -80000,
        date: toISODate(addDays(parseISODate(state.asOfDate), 1)),
      }),
      sanitizeOneOff({
        name: "後日収入",
        accountId: aid,
        amount: 100000,
        date: toISODate(addDays(parseISODate(state.asOfDate), 10)),
      }),
    ];
    const until = addDays(parseISODate(state.asOfDate), 20);
    ok(
      "後日収入を先取りしない",
      safeSpendForAccount(aid, until, "expected") === 0,
    );
    state.accounts.push(
      sanitizeAccount({ name: "別口座", balance: 5000, buffer: 0 }),
    );
    state.oneOff.push(
      sanitizeOneOff({
        name: "別口座支出",
        accountId: state.accounts[1].id,
        amount: -6000,
        date: toISODate(addDays(parseISODate(state.asOfDate), 2)),
      }),
    );
    ok(
      "口座別不足を検出",
      buildForecast().firstShortage?.accountId === state.accounts[1].id,
    );
    state.accounts[1].balance = -1;
    state.oneOff = [];
    ok(
      "基準日時点の不足を検出",
      sameDate(
        buildForecast().firstShortage?.date,
        parseISODate(state.asOfDate),
      ),
    );
    state.accounts[1].balance = 5000;
    const sat = new Date(2026, 7, 8);
    state.calendar.useWeekends = true;
    ok(
      "翌営業日補正",
      toISODate(adjustBusinessDate(sat, "next")) === "2026-08-10",
    );
    ok("2026祝日", japaneseHolidaySet(2026).has("2026-07-20"));
    const income = sanitizeRecurring({
      kind: "income",
      amount: 100000,
      amountMode: "buffer",
      bufferPercent: 20,
      accountId: aid,
    });
    ok(
      "保守モードで収入を下振れ",
      resolveRecurringAmount(
        income,
        parseISODate(state.asOfDate),
        "conservative",
      ).amount === 80000,
    );
    const f = sanitizeFinancing({
      accountId: aid,
      principal: 100000,
      apr: 15,
      paymentRule: "fixedTotal",
      paymentAmount: 10000,
      paymentDay: 27,
      lastPaymentDate: toISODate(addDays(parseISODate(state.asOfDate), -30)),
    });
    state.financing = [f];
    ok(
      "ローン支払生成",
      buildFinancingSchedule(
        f,
        parseISODate(state.asOfDate),
        addDays(parseISODate(state.asOfDate), 60),
      ).events.length > 0,
    );
    state.financing=[]; state.oneOff=[]; state.recurring=[];
    state.accounts[0].balance=100000; state.accounts[0].buffer=0;
    state.ledgerEntries=[sanitizeLedgerEntry({name:"即時支出",kind:"expense",amount:3000,date:state.asOfDate,accountId:aid,paymentMethod:"debit",affectsBalance:true})];
    ok("家計簿の即時支出を予報へ反映", buildForecast().daily[0].accounts[aid]===97000);
    state.ledgerEntries=[sanitizeLedgerEntry({name:"カード利用",kind:"expense",amount:3000,date:state.asOfDate,accountId:aid,paymentMethod:"credit",affectsBalance:false})];
    ok("カード記録のみは予報へ非反映", buildForecast().daily[0].accounts[aid]===100000);
    const migrated=sanitizeState({...defaultState(),version:6,ledgerEntries:undefined,household:undefined});
    ok("v6・v7保存データをv9へ移行", migrated.version===9&&Array.isArray(migrated.ledgerEntries)&&Array.isArray(migrated.household.categories));
    state.ledgerEntries=[sanitizeLedgerEntry({kind:"expense",amount:5000,date:state.asOfDate,accountId:aid,category:"食費"}),sanitizeLedgerEntry({kind:"income",amount:10000,date:state.asOfDate,accountId:aid,category:"副収入"}),sanitizeLedgerEntry({kind:"settlement",amount:8000,date:state.asOfDate,accountId:aid,category:"決済・返済"})]; state.household.selectedMonth=state.asOfDate.slice(0,7);
    const hs=householdSummary(); ok("家計簿月次集計",hs.expense===5000&&hs.income===10000&&hs.net===5000&&hs.settlement===8000);
    return results;
  } finally {
    state = sanitizeState(original);
  }
}

/* ===== v1.3 integrated asset/liability and household extension ===== */
const V13_PAYMENT_METHODS={cash:"現金",bank:"口座振替・振込",debit:"デビット・即時決済",credit:"クレジットカード",emoney:"電子マネー",other:"その他"};
const V13_STATUS_LABELS={planned:"予定",used:"利用済み",confirmed:"請求確定",paid:"支払済み",received:"入金済み",unconfirmed:"未確認",cancelled:"取消",refunded:"返金済み"};
const V13_CLASS_LABELS={fixed:"固定費",variable:"変動費",special:"特別支出",settlement:"決済・返済",transfer:"資金移動"};
const V13_BUDGET_MODES={reset:"毎月リセット",carry:"残額を繰越",offset:"超過も翌月へ",annual:"年間予算"};
function defaultV13(){return{schema:1,assetMeta:{},cards:[],entryMeta:{},cardTopups:[],categoryBudgets:{},templates:[],merchantRules:{},ui:{query:"",payment:"all",status:"all",spendingClass:"all",linked:"all",sort:"dateDesc",page:1,pageSize:30},snapshots:[],lastSnapshotDate:"",archives:[],largeText:false};}
function sanitizeV13Card(c){return{id:c?.id||uid(),name:String(c?.name||"クレジットカード"),closingDay:Math.min(31,Math.max(1,Math.trunc(Number(c?.closingDay))||31)),paymentDay:Math.min(31,Math.max(1,Math.trunc(Number(c?.paymentDay))||27)),paymentMonthOffset:[0,1,2].includes(Number(c?.paymentMonthOffset))?Number(c.paymentMonthOffset):1,accountId:String(c?.accountId||state?.defaultAccountId||""),shift:["none","previous","next"].includes(c?.shift)?c.shift:"next",mode:["auto","manual"].includes(c?.mode)?c.mode:"auto",linkedRecurringId:String(c?.linkedRecurringId||""),confirmedByMonth:c?.confirmedByMonth&&typeof c.confirmedByMonth==="object"?c.confirmedByMonth:{},active:c?.active!==false,lastConfirmedAt:c?.lastConfirmedAt||""};}
function normalizeV13(raw,s){const b=defaultV13(),v=raw&&typeof raw==="object"?raw:{};const out={...b,...v};out.assetMeta=v.assetMeta&&typeof v.assetMeta==="object"?v.assetMeta:{};for(const a of s.accounts){if(!out.assetMeta[a.id])out.assetMeta[a.id]={type:"bank"};if(!["bank","cash","emoney"].includes(out.assetMeta[a.id].type))out.assetMeta[a.id].type="bank";}out.cards=Array.isArray(v.cards)?v.cards.map(sanitizeV13Card):[];out.entryMeta=v.entryMeta&&typeof v.entryMeta==="object"?v.entryMeta:{};out.cardTopups=Array.isArray(v.cardTopups)?v.cardTopups.map(t=>({id:t?.id||uid(),name:String(t?.name||"カードチャージ"),date:isValidISODate(t?.date)?t.date:s.asOfDate,cardId:String(t?.cardId||""),toAccountId:String(t?.toAccountId||""),amount:Math.max(0,intMoney(t?.amount)),status:["planned","used","confirmed","paid","cancelled","refunded"].includes(t?.status)?t.status:"used",createdAt:t?.createdAt||isoNow()})):[];out.categoryBudgets=v.categoryBudgets&&typeof v.categoryBudgets==="object"?v.categoryBudgets:{};out.templates=Array.isArray(v.templates)?v.templates.map(t=>({...t,id:t?.id||uid(),name:String(t?.name||"定型取引")})):[];out.merchantRules=v.merchantRules&&typeof v.merchantRules==="object"?v.merchantRules:{};out.ui={...b.ui,...(v.ui||{})};out.ui.page=Math.max(1,Math.trunc(Number(out.ui.page))||1);out.ui.pageSize=[20,30,50,100].includes(Number(out.ui.pageSize))?Number(out.ui.pageSize):30;out.snapshots=Array.isArray(v.snapshots)?v.snapshots.slice(0,4):[];out.archives=Array.isArray(v.archives)?v.archives:[];out.largeText=v.largeText===true;return out;}
const defaultStateV12=defaultState;defaultState=function(){const s=defaultStateV12();s.version=9;s.v13=normalizeV13(null,s);return s;};
const sanitizeStateV12=sanitizeState;sanitizeState=function(raw){const s=sanitizeStateV12(raw);s.version=9;s.v13=normalizeV13(raw?.v13||s.v13,s);return s;};
const demoStateV12=demoState;demoState=function(){const s=sanitizeState(demoStateV12());const bank=s.accounts[0].id;const cash=sanitizeAccount({name:"財布",balance:8500,buffer:0,lastConfirmedAt:isoNow()});const em=sanitizeAccount({name:"PayPay残高",balance:4200,buffer:0,lastConfirmedAt:isoNow()});s.accounts.push(cash,em);s.v13.assetMeta[cash.id]={type:"cash"};s.v13.assetMeta[em.id]={type:"emoney"};s.v13.assetMeta[bank]={type:"bank"};const recurring=s.recurring.find(x=>/カード/.test(x.name));const card=sanitizeV13Card({name:"デモカード",closingDay:31,paymentDay:27,paymentMonthOffset:1,accountId:s.accounts[1]?.id||bank,mode:"auto",linkedRecurringId:recurring?.id||""});s.v13.cards=[card];if(recurring)recurring.active=false;for(const e of s.ledgerEntries){const isCredit=e.paymentMethod==="credit";s.v13.entryMeta[e.id]={status:e.kind==="income"?"received":"used",spendingClass:e.kind==="income"?"variable":e.category==="住居"?"fixed":"variable",paymentMethod:e.paymentMethod,cardId:isCredit?card.id:"",splits:[],merchant:e.name,updatedAt:isoNow()};if(e.paymentMethod==="cash")e.accountId=cash.id;}s.v13.categoryBudgets={食費:{amount:45000,mode:"reset"},日用品:{amount:12000,mode:"carry"},娯楽:{amount:15000,mode:"offset"}};return s;};
state=sanitizeState(state);
function ensureV13(){state.v13=normalizeV13(state.v13,state);document.body.classList.toggle("large-text",state.v13.largeText);return state.v13;}
function assetType(id){return ensureV13().assetMeta[id]?.type||"bank"}function assetTypeLabel(id){return({bank:"銀行口座",cash:"現金・財布",emoney:"電子マネー残高"})[assetType(id)]||"保有残高"}function assetName(id){return accountName(id)}function activeAssets(type=""){return state.accounts.filter(a=>a.active&&(!type||assetType(a.id)===type))}function currentAssetBalances(){const balances=Object.fromEntries(activeAssets().map(a=>[a.id,a.balance])),d=parseISODate(state.asOfDate),events=collectEvents(d,d,state.forecastMode,0).filter(e=>e.source==="ledger"||e.source==="transferOut"||e.source==="transferIn"||e.source==="cardTopup"||(e.source==="oneOff"&&e.certainty==="confirmed"));for(const e of events)if(e.accountId in balances)balances[e.accountId]+=e.amount;return balances}function totalAssets(){return Object.values(currentAssetBalances()).reduce((n,x)=>n+x,0)}function financingPrincipal(){return state.financing.filter(x=>x.active).reduce((n,x)=>n+x.principal,0)}
function entryV13(e){const v=ensureV13();if(!v.entryMeta[e.id])v.entryMeta[e.id]={};const m=v.entryMeta[e.id];if(!m.status)m.status=e.kind==="income"?"received":e.kind==="settlement"?"paid":compareDates(parseISODate(e.date),parseISODate(state.asOfDate))>0?"planned":"used";if(!m.spendingClass)m.spendingClass=e.kind==="settlement"?"settlement":/家賃|保険|通信|水道光熱/.test(e.category)?"fixed":"variable";if(!m.paymentMethod)m.paymentMethod=e.paymentMethod;if(!Array.isArray(m.splits))m.splits=[];if(!m.updatedAt)m.updatedAt=e.createdAt||isoNow();return m}function effectivePayment(e){return entryV13(e).paymentMethod||e.paymentMethod}function effectiveStatus(e){return entryV13(e).status}function effectiveClass(e){return entryV13(e).spendingClass}function isEntryActive(e){return !["cancelled","refunded"].includes(effectiveStatus(e))}
function paymentMethodLabelV13(v){return V13_PAYMENT_METHODS[v]||"その他"}paymentMethodLabel=paymentMethodLabelV13;
function cardById(id){return ensureV13().cards.find(c=>c.id===id)}
function cardPaymentInfo(dateValue,card){const d=typeof dateValue==="string"?parseISODate(dateValue):new Date(dateValue);let closeMonth=new Date(d.getFullYear(),d.getMonth(),1);if(d.getDate()>card.closingDay)closeMonth.setMonth(closeMonth.getMonth()+1);const closeDate=new Date(closeMonth.getFullYear(),closeMonth.getMonth(),clampDay(closeMonth.getFullYear(),closeMonth.getMonth(),card.closingDay));const payMonth=new Date(closeMonth.getFullYear(),closeMonth.getMonth()+card.paymentMonthOffset,1);const nominal=new Date(payMonth.getFullYear(),payMonth.getMonth(),clampDay(payMonth.getFullYear(),payMonth.getMonth(),card.paymentDay));const paymentDate=adjustBusinessDate(nominal,card.shift);return{closeDate,paymentDate,paymentMonth:monthKey(paymentDate)};}
function creditItems(cardId="",includeFuture=true){const asOf=parseISODate(state.asOfDate),rows=[];for(const e of state.ledgerEntries||[]){const m=entryV13(e);if(e.kind!=="expense"||effectivePayment(e)!=="credit"||!isEntryActive(e)||m.status==="paid")continue;if(cardId&&m.cardId!==cardId)continue;if(!includeFuture&&compareDates(parseISODate(e.date),asOf)>0)continue;rows.push({type:"entry",id:e.id,date:e.date,amount:e.amount,status:m.status,cardId:m.cardId,name:e.name});}for(const t of ensureV13().cardTopups){if(["cancelled","refunded","paid"].includes(t.status))continue;if(cardId&&t.cardId!==cardId)continue;if(!includeFuture&&compareDates(parseISODate(t.date),asOf)>0)continue;rows.push({type:"topup",id:t.id,date:t.date,amount:t.amount,status:t.status,cardId:t.cardId,name:t.name});}return rows;}
function cardLiabilityData(includeFuture=false){const cards=ensureV13().cards.filter(c=>c.active),byCard=new Map(cards.map(c=>[c.id,{card:c,unpaid:0,nextDate:null,nextAmount:0,items:0}]));let unassigned=0;for(const item of creditItems("",includeFuture)){const row=byCard.get(item.cardId);if(!row){unassigned+=item.amount;continue}row.unpaid+=item.amount;row.items++;const info=cardPaymentInfo(item.date,row.card);const key=toISODate(info.paymentDate);if(!row.nextDate||key<row.nextDate){row.nextDate=key;row.nextAmount=item.amount}else if(key===row.nextDate)row.nextAmount+=item.amount;}return{rows:[...byCard.values()],unassigned,total:[...byCard.values()].reduce((n,r)=>n+r.unpaid,0)+unassigned};}
function cardBillGroups(){const groups=new Map();for(const item of creditItems("",true)){const card=cardById(item.cardId);if(!card||!card.active||card.mode!=="auto")continue;const info=cardPaymentInfo(item.date,card),key=`${card.id}|${toISODate(info.paymentDate)}`;if(!groups.has(key))groups.set(key,{card,date:info.paymentDate,paymentMonth:info.paymentMonth,amount:0,itemIds:[]});const g=groups.get(key);g.amount+=item.amount;g.itemIds.push(item.id);}for(const card of ensureV13().cards.filter(c=>c.active&&c.mode==="auto")){for(const [mk,value] of Object.entries(card.confirmedByMonth||{})){const d=parseISODate(mk+"-01"),nominal=new Date(d.getFullYear(),d.getMonth(),clampDay(d.getFullYear(),d.getMonth(),card.paymentDay)),pay=adjustBusinessDate(nominal,card.shift),key=`${card.id}|${toISODate(pay)}`;if(!groups.has(key))groups.set(key,{card,date:pay,paymentMonth:mk,amount:0,itemIds:[]});groups.get(key).amount=Math.max(0,intMoney(value));groups.get(key).confirmed=true;}}return[...groups.values()].filter(g=>g.amount>0);}
const collectEventsV12=collectEvents;collectEvents=function(start,end,mode=state.forecastMode,scenario=0){ensureV13();let events=collectEventsV12(start,end,mode,scenario).filter(e=>{if(e.source==="ledger"&&e.meta?.ledgerId){const x=state.ledgerEntries.find(v=>v.id===e.meta.ledgerId);return x?isEntryActive(x):true}if(e.meta?.recurringId&&ensureV13().cards.some(c=>c.active&&c.mode==="auto"&&c.linkedRecurringId===e.meta.recurringId))return false;return true});const active=new Set(state.accounts.filter(a=>a.active).map(a=>a.id));for(const t of ensureV13().cardTopups){if(!active.has(t.toAccountId)||["cancelled","refunded"].includes(t.status))continue;const d=parseISODate(t.date);if(d>=start&&d<=end)events.push({date:d,name:t.name+"（チャージ）",amount:t.amount,accountId:t.toAccountId,source:"cardTopup",certainty:t.status==="confirmed"?"confirmed":"estimated",meta:{basis:"カードから電子マネーへチャージ",topupId:t.id,cardId:t.cardId}});}for(const g of cardBillGroups()){let d=g.date;if(d<start)d=new Date(start);if(d>=start&&d<=end&&active.has(g.card.accountId))events.push({date:d,name:g.card.name+" 請求",amount:-g.amount,accountId:g.card.accountId,source:"cardBill",certainty:g.confirmed?"confirmed":"estimated",meta:{basis:g.confirmed?"確定請求額":"カード利用明細集計",cardId:g.card.id,paymentMonth:g.paymentMonth,itemIds:g.itemIds}});}const priority=e=>e.source==="scenario"?0:["expense","financing","cardBill"].includes(e.source)||(["oneOff","ledger"].includes(e.source)&&e.amount<0)?1:e.source==="transferOut"?2:["transferIn","cardTopup"].includes(e.source)?3:4;events.sort((a,b)=>compareDates(a.date,b.date)||priority(a)-priority(b)||a.name.localeCompare(b.name,"ja"));return events;};
function splitCategoryAmounts(e){const m=entryV13(e),valid=m.splits.filter(s=>s&&s.category&&intMoney(s.amount)>0),sum=valid.reduce((n,s)=>n+intMoney(s.amount),0);if(valid.length&&sum===e.amount)return valid.map(s=>({category:s.category,amount:intMoney(s.amount)}));return[{category:e.category,amount:e.amount}]}
function rawMonthEntries(mk){return(state.ledgerEntries||[]).filter(e=>e.date.startsWith(mk))}
function categoryActual(category,mk){return rawMonthEntries(mk).filter(e=>e.kind==="expense"&&isEntryActive(e)).reduce((n,e)=>n+splitCategoryAmounts(e).filter(s=>s.category===category).reduce((a,s)=>a+s.amount,0),0)}
function categoryBudgetAvailable(category,mk){const cfg=ensureV13().categoryBudgets[category];if(!cfg||!cfg.amount)return{amount:0,available:0,mode:"reset"};const amount=Math.max(0,intMoney(cfg.amount)),mode=cfg.mode||"reset",[y,m]=mk.split("-").map(Number);if(mode==="annual"){let spent=0;for(let i=1;i<=m;i++)spent+=categoryActual(category,`${y}-${String(i).padStart(2,"0")}`);return{amount,available:amount-spent+categoryActual(category,mk),mode};}let balance=0;for(let i=1;i<m;i++){const key=`${y}-${String(i).padStart(2,"0")}`,actual=categoryActual(category,key);if(mode==="carry")balance=Math.max(0,balance+amount-actual);else if(mode==="offset")balance=balance+amount-actual;}return{amount,available:amount+balance,mode};}
const householdSummaryV12=householdSummary;householdSummary=function(monthValue=state.household.selectedMonth){ensureV13();const entries=rawMonthEntries(monthValue).sort((a,b)=>b.date.localeCompare(a.date)||String(b.createdAt).localeCompare(String(a.createdAt))),category={},payment={},classes={};let expense=0,income=0,settlement=0,linked=0,recordOnly=0;for(const e of entries){if(!isEntryActive(e))continue;if(e.kind==="expense"){expense+=e.amount;for(const s of splitCategoryAmounts(e))category[s.category]=(category[s.category]||0)+s.amount;const pm=effectivePayment(e);payment[pm]=(payment[pm]||0)+e.amount;const cl=effectiveClass(e);classes[cl]=(classes[cl]||0)+e.amount;}else if(e.kind==="income")income+=e.amount;else settlement+=e.amount;if(e.affectsBalance)linked++;else recordOnly++;}const budget=state.household.monthlyBudget;return{entries,expense,income,settlement,net:income-expense,budget,remaining:budget-expense,category,payment,classes,linked,recordOnly};};
function previousMonthKey(mk,delta=-1){const[y,m]=mk.split("-").map(Number),d=new Date(y,m-1+delta,1);return monthKey(d)}function averagePreviousExpense(mk,count=3){let sum=0;for(let i=1;i<=count;i++)sum+=householdSummary(previousMonthKey(mk,-i)).expense;return Math.round(sum/count)}
function filteredLedgerEntries(){const v=ensureV13(),ui=v.ui,s=householdSummary(),q=String(ui.query||"").trim().toLowerCase();let rows=s.entries.filter(e=>{const m=entryV13(e),pm=effectivePayment(e);if(state.household.filterCategory!=="all"&&!splitCategoryAmounts(e).some(x=>x.category===state.household.filterCategory))return false;if(ui.payment!=="all"&&pm!==ui.payment)return false;if(ui.status!=="all"&&m.status!==ui.status)return false;if(ui.spendingClass!=="all"&&m.spendingClass!==ui.spendingClass)return false;if(ui.linked==="linked"&&!e.affectsBalance)return false;if(ui.linked==="recordOnly"&&e.affectsBalance)return false;if(q&&!`${e.name} ${e.note} ${e.amount} ${e.category}`.toLowerCase().includes(q))return false;return true});if(ui.sort==="dateAsc")rows.sort((a,b)=>a.date.localeCompare(b.date));else if(ui.sort==="amountDesc")rows.sort((a,b)=>b.amount-a.amount);else if(ui.sort==="amountAsc")rows.sort((a,b)=>a.amount-b.amount);else rows.sort((a,b)=>b.date.localeCompare(a.date)||String(b.createdAt).localeCompare(String(a.createdAt)));return rows;}
const renderHouseholdV12=renderHousehold;renderHousehold=function(){renderHouseholdV12();ensureV13();const s=householdSummary(),liab=cardLiabilityData(false),assets=totalAssets(),loans=financingPrincipal(),shortNet=assets-liab.total,netFin=shortNet-loans;for(const[id,val]of[["assetTotal",assets],["cardUnpaidTotal",liab.total],["shortNetBalance",shortNet],["netFinancialBalance",netFin]]){const el=document.getElementById(id);if(el)el.textContent=yen.format(val);}const un=document.getElementById("cardUnpaidNote");if(un)un.textContent=liab.unassigned?`未割当 ${yen.format(liab.unassigned)}を含む`:`${liab.rows.reduce((n,r)=>n+r.items,0)}件の利用`;const mk=state.household.selectedMonth,prev=householdSummary(previousMonthKey(mk)),avg=averagePreviousExpense(mk),delta=s.expense-prev.expense,deltaAvg=s.expense-avg;document.getElementById("householdComparison").innerHTML=`<div class="comparison-item"><span class="small">前月</span><strong>${yen.format(prev.expense)}</strong><span class="${delta>0?"delta-up":"delta-down"}">${delta===0?"同額":`${delta>0?"＋":"－"}${yen.format(Math.abs(delta))}`}</span></div><div class="comparison-item"><span class="small">過去3カ月平均</span><strong>${yen.format(avg)}</strong><span class="${deltaAvg>0?"delta-up":"delta-down"}">${deltaAvg===0?"同額":`${deltaAvg>0?"＋":"－"}${yen.format(Math.abs(deltaAvg))}`}</span></div><div class="comparison-item"><span class="small">今月</span><strong>${yen.format(s.expense)}</strong><span>${s.budget?`予算消化 ${Math.round(s.expense/s.budget*100)}%`:"予算未設定"}</span></div>`;const classEl=document.getElementById("householdClassBreakdown"),classEntries=Object.entries(s.classes).sort((a,b)=>b[1]-a[1]),classMax=Math.max(1,...classEntries.map(x=>x[1]));classEl.innerHTML=classEntries.length?classEntries.map(([k,v])=>`<div class="category-row"><span>${esc(V13_CLASS_LABELS[k]||k)}</span><div class="category-track"><span style="width:${Math.max(2,v/classMax*100)}%"></span></div><strong>${yen.format(v)}</strong></div>`).join(""):"<p class='small'>支出実績はありません。</p>";const cats=Object.entries(s.category).sort((a,b)=>b[1]-a[1]),max=Math.max(1,...cats.map(x=>x[1]));document.getElementById("householdCategoryBreakdown").innerHTML=cats.length?cats.map(([name,value])=>{const b=categoryBudgetAvailable(name,mk),rem=b.available-value;return`<div class="category-row"><span>${esc(name)}${b.amount?`<div class="category-budget-note">${esc(V13_BUDGET_MODES[b.mode])}・残 ${yen.format(rem)}</div>`:""}</span><div class="category-track"><span style="width:${Math.max(2,value/max*100)}%"></span></div><strong>${yen.format(value)}</strong></div>`}).join(""):"<div class='household-empty'>この月の支出実績はありません。</div>";const paymentFilter=document.getElementById("householdPaymentFilter");if(paymentFilter){paymentFilter.innerHTML=`<option value="all">すべて</option>`+Object.entries(V13_PAYMENT_METHODS).map(([k,v])=>`<option value="${k}">${v}</option>`).join("");paymentFilter.value=state.v13.ui.payment;}document.getElementById("householdStatusFilter").value=state.v13.ui.status;document.getElementById("householdClassFilter").value=state.v13.ui.spendingClass;document.getElementById("householdLinkedFilter").value=state.v13.ui.linked;document.getElementById("householdSort").value=state.v13.ui.sort;document.getElementById("householdSearch").value=state.v13.ui.query;const rows=filteredLedgerEntries(),pages=Math.max(1,Math.ceil(rows.length/state.v13.ui.pageSize));state.v13.ui.page=Math.min(pages,state.v13.ui.page);const start=(state.v13.ui.page-1)*state.v13.ui.pageSize,visible=rows.slice(start,start+state.v13.ui.pageSize),list=document.getElementById("householdTransactions");list.innerHTML=visible.length?visible.map(e=>{const m=entryV13(e),pm=effectivePayment(e),split=m.splits.length?`・${m.splits.length}カテゴリに分割`:"",asset=pm==="credit"?(cardById(m.cardId)?.name||"カード未割当"):assetName(e.accountId);return`<div class="household-transaction ${["cancelled","refunded"].includes(m.status)?"muted-row":""}"><div class="transaction-date">${esc(e.date.slice(5).replace("-","/"))}</div><div class="transaction-main"><div class="transaction-title">${esc(e.name)} <span class="status-chip ${m.status}">${esc(V13_STATUS_LABELS[m.status]||m.status)}</span></div><div class="transaction-meta">${esc(e.category)}${split}・${esc(paymentMethodLabelV13(pm))}・${esc(asset)}・${esc(V13_CLASS_LABELS[m.spendingClass]||m.spendingClass)}${e.note?`・${esc(e.note)}`:""}</div></div><div><div class="transaction-amount ${e.kind==="income"?"positive":"negative"}">${e.kind==="income"?"＋":"－"}${yen.format(e.amount)}</div><div class="row-actions" style="justify-content:flex-end;margin-top:4px"><button class="btn btn-small" data-action="edit-ledger:${e.id}" type="button">編集</button><button class="btn btn-small btn-danger" data-action="delete-ledger:${e.id}" type="button">削除</button></div></div></div>`}).join(""):"<div class='household-empty'>該当する取引はありません。</div>";document.getElementById("householdSearchCount").textContent=`${rows.length}件`;document.getElementById("ledgerPageInfo").textContent=`${state.v13.ui.page} / ${pages}`;document.getElementById("cardLiabilitySummary").innerHTML=liab.rows.length?liab.rows.map(r=>`<div class="card-liability-row"><div><strong>${esc(r.card.name)}</strong><div class="list-meta">${r.nextDate?`次回 ${r.nextDate}・${yen.format(r.nextAmount)}`:"未払なし"}</div></div><strong>${yen.format(r.unpaid)}</strong></div>`).join("")+(liab.unassigned?`<div class="alert warn" style="margin-top:8px">カード未割当の利用 ${yen.format(liab.unassigned)}</div>`:""):"<p class='small'>カード利用済み・未引落額はありません。</p>";};
function accountOptionsByType(selected="",types=[]){return state.accounts.filter(a=>a.active&&(!types.length||types.includes(assetType(a.id)))).map(a=>`<option value="${a.id}" ${a.id===selected?"selected":""}>${esc(a.name)}（${assetTypeLabel(a.id)}）</option>`).join("")}
function cardOptions(selected=""){return ensureV13().cards.filter(c=>c.active).map(c=>`<option value="${c.id}" ${c.id===selected?"selected":""}>${esc(c.name)}</option>`).join("")}
function splitRowsHtml(splits){const rows=splits.length?splits:[{category:"食費",amount:0}];return rows.map((s,i)=>`<div class="split-row" data-split-index="${i}"><label>カテゴリ<select class="ledgerSplitCategory">${state.household.categories.map(c=>`<option value="${esc(c)}" ${c===s.category?"selected":""}>${esc(c)}</option>`).join("")}</select></label><label>金額<input class="ledgerSplitAmount" data-money type="number" min="0" value="${intMoney(s.amount)}"/></label><button class="btn btn-small btn-danger ledgerSplitRemove" type="button">削除</button></div>`).join("")}
function applyLedgerSourceUi(){const payment=document.getElementById("ledgerPayment"),source=document.getElementById("ledgerSource"),affects=document.getElementById("ledgerAffects"),note=document.getElementById("ledgerAutoNote");if(!payment||!source)return;const pm=payment.value;if(pm==="credit"){source.innerHTML=cardOptions(source.dataset.selected||"");affects.checked=false;affects.disabled=true;note.textContent="カード利用日には保有残高を減らさず、未払額と将来の引落へ反映します。";}else{const types=pm==="cash"?["cash"]:pm==="emoney"?["emoney"]:pm==="bank"||pm==="debit"?["bank"]:[];source.innerHTML=accountOptionsByType(source.dataset.selected||"",types);affects.checked=true;affects.disabled=false;note.textContent=pm==="cash"?"財布残高を直ちに減らします。":pm==="emoney"?"電子マネー残高を直ちに減らします。":"指定した保有先を直ちに増減します。";}source.dataset.selected="";}
openLedgerModal=function(entryId="",kind="expense",forcePayment=""){ensureV13();const existing=state.ledgerEntries.find(e=>e.id===entryId),e=existing?deepClone(existing):sanitizeLedgerEntry({kind,amount:0,date:state.asOfDate,accountId:state.defaultAccountId,paymentMethod:"debit",affectsBalance:true,category:kind==="income"?"臨時収入":"食費"}),m=existing?deepClone(entryV13(existing)):{status:kind==="income"?"received":compareDates(parseISODate(state.asOfDate),new Date())>0?"planned":"used",spendingClass:"variable",paymentMethod:forcePayment||state.household.defaultPaymentMethod,cardId:"",splits:[],merchant:"",updatedAt:isoNow()};if(forcePayment)m.paymentMethod=forcePayment;const recent=[...new Map((state.ledgerEntries||[]).slice().reverse().map(x=>[x.name,x])).values()].slice(0,12),templates=ensureV13().templates;openModal(existing?"取引を編集":kind==="income"?"収入を追加":m.paymentMethod==="credit"?"カード利用を追加":"支出を追加",`<div class="form-grid"><label>前回・定型<select id="ledgerPreset"><option value="">選択しない</option>${templates.map(t=>`<option value="tpl:${t.id}">定型：${esc(t.name)}</option>`).join("")}${recent.map(x=>`<option value="recent:${x.id}">履歴：${esc(x.name)} ${yen.format(x.amount)}</option>`).join("")}</select></label><div style="align-self:end"><button class="btn" id="ledgerApplyPreset" type="button">適用</button></div><label>金額<input id="ledgerAmount" data-money type="number" min="0" step="1" value="${e.amount}"/><div class="money-preview"></div></label><label>内容・店名<input id="ledgerName" value="${esc(e.name)}"/></label><label>日付<input id="ledgerDate" type="date" value="${e.date}"/></label><label>区分<select id="ledgerKind"><option value="expense" ${e.kind==="expense"?"selected":""}>支出</option><option value="income" ${e.kind==="income"?"selected":""}>収入</option><option value="settlement" ${e.kind==="settlement"?"selected":""}>決済・返済（集計除外）</option></select></label><label>カテゴリ<select id="ledgerCategory">${state.household.categories.map(c=>`<option value="${esc(c)}" ${c===e.category?"selected":""}>${esc(c)}</option>`).join("")}</select></label><label>支払方法<select id="ledgerPayment">${Object.entries(V13_PAYMENT_METHODS).map(([k,v])=>`<option value="${k}" ${k===m.paymentMethod?"selected":""}>${v}</option>`).join("")}</select></label><label>支払元・カード<select id="ledgerSource" data-selected="${m.paymentMethod==="credit"?m.cardId:e.accountId}"></select></label></div><div id="ledgerAutoNote" class="inline-note" style="margin-top:10px"></div><details class="advanced modal-section"><summary>詳細設定・分割</summary><div class="form-grid" style="margin-top:10px"><label>状態<select id="ledgerStatus">${Object.entries(V13_STATUS_LABELS).map(([k,v])=>`<option value="${k}" ${k===m.status?"selected":""}>${v}</option>`).join("")}</select></label><label>費用区分<select id="ledgerClass">${Object.entries(V13_CLASS_LABELS).map(([k,v])=>`<option value="${k}" ${k===m.spendingClass?"selected":""}>${v}</option>`).join("")}</select></label><label style="grid-column:1/-1">メモ<textarea id="ledgerNote" rows="2">${esc(e.note)}</textarea></label></div><label style="margin-top:10px"><input id="ledgerAffects" type="checkbox" style="width:auto;display:inline;margin-right:6px" ${e.affectsBalance?"checked":""}/>残高予報へ即時反映</label><div class="section-head" style="margin-top:12px"><div><h3>カテゴリ分割</h3><p class="small">合計が取引金額と一致した場合のみ使用します。</p></div><button class="btn btn-small" id="ledgerAddSplit" type="button">＋分割</button></div><div id="ledgerSplits">${splitRowsHtml(m.splits)}</div></details><label style="margin-top:12px"><input id="ledgerSaveTemplate" type="checkbox" style="width:auto;display:inline;margin-right:6px"/>この内容を定型入力として保存</label><button class="btn btn-primary" id="ledgerSave" style="margin-top:12px" type="button">保存</button>`);applyLedgerSourceUi();document.getElementById("ledgerPayment").addEventListener("change",applyLedgerSourceUi);document.getElementById("ledgerAddSplit").onclick=()=>{document.getElementById("ledgerSplits").insertAdjacentHTML("beforeend",splitRowsHtml([{category:document.getElementById("ledgerCategory").value,amount:0}]));bindMoneyPreviews()};document.getElementById("ledgerSplits").addEventListener("click",ev=>{if(ev.target.classList.contains("ledgerSplitRemove"))ev.target.closest(".split-row").remove()});document.getElementById("ledgerName").addEventListener("change",()=>{const rule=ensureV13().merchantRules[document.getElementById("ledgerName").value.trim().toLowerCase()];if(rule){document.getElementById("ledgerCategory").value=rule.category||document.getElementById("ledgerCategory").value;document.getElementById("ledgerPayment").value=rule.paymentMethod||document.getElementById("ledgerPayment").value;applyLedgerSourceUi();}});document.getElementById("ledgerApplyPreset").onclick=()=>{const val=document.getElementById("ledgerPreset").value;if(!val)return;let src;if(val.startsWith("tpl:"))src=ensureV13().templates.find(t=>t.id===val.slice(4));else{const x=state.ledgerEntries.find(e=>e.id===val.slice(7));if(x)src={name:x.name,amount:x.amount,category:x.category,paymentMethod:effectivePayment(x),accountId:x.accountId,...entryV13(x)}}if(!src)return;document.getElementById("ledgerName").value=src.name||"";document.getElementById("ledgerAmount").value=src.amount||0;document.getElementById("ledgerCategory").value=src.category||"その他";document.getElementById("ledgerPayment").value=src.paymentMethod||"debit";document.getElementById("ledgerClass").value=src.spendingClass||"variable";document.getElementById("ledgerSource").dataset.selected=src.cardId||src.accountId||"";applyLedgerSourceUi();bindMoneyPreviews()};document.getElementById("ledgerSave").onclick=()=>{const amount=Math.max(0,intMoney(document.getElementById("ledgerAmount").value)),pm=document.getElementById("ledgerPayment").value,source=document.getElementById("ledgerSource").value,k=document.getElementById("ledgerKind").value,splits=[...document.querySelectorAll("#ledgerSplits .split-row")].map(r=>({category:r.querySelector(".ledgerSplitCategory").value,amount:Math.max(0,intMoney(r.querySelector(".ledgerSplitAmount").value))})).filter(x=>x.amount>0),splitSum=splits.reduce((n,x)=>n+x.amount,0);if(splits.length&&splitSum!==amount)return showToast(`分割合計 ${yen.format(splitSum)} が取引金額と一致しません`);const basePm=Object.prototype.hasOwnProperty.call(HOUSEHOLD_PAYMENT_METHODS,pm)?pm:"other",next=sanitizeLedgerEntry({...e,id:existing?.id||uid(),kind:k,amount,date:document.getElementById("ledgerDate").value,name:document.getElementById("ledgerName").value,category:document.getElementById("ledgerCategory").value,paymentMethod:basePm,accountId:pm==="credit"?(cardById(source)?.accountId||state.defaultAccountId):source,affectsBalance:pm==="credit"?false:document.getElementById("ledgerAffects").checked,note:document.getElementById("ledgerNote").value,sourceKey:e.sourceKey,createdAt:e.createdAt});if(existing)state.ledgerEntries=state.ledgerEntries.map(x=>x.id===existing.id?next:x);else state.ledgerEntries.push(next);ensureV13().entryMeta[next.id]={status:document.getElementById("ledgerStatus").value,spendingClass:document.getElementById("ledgerClass").value,paymentMethod:pm,cardId:pm==="credit"?source:"",splits,merchant:next.name,updatedAt:isoNow()};ensureV13().merchantRules[next.name.trim().toLowerCase()]={category:next.category,paymentMethod:pm,cardId:pm==="credit"?source:"",accountId:pm==="credit"?"":source};if(document.getElementById("ledgerSaveTemplate").checked)ensureV13().templates.push({id:uid(),name:next.name,amount:next.amount,category:next.category,paymentMethod:pm,cardId:pm==="credit"?source:"",accountId:pm==="credit"?"":source,spendingClass:effectiveClass(next)});if(!state.household.categories.includes(next.category))state.household.categories.push(next.category);state.household.selectedMonth=next.date.slice(0,7);closeModal();render();showToast(`${next.name}：${yen.format(next.amount)}`);};};
function openTransferModal(){
  ensureV13();
  const first=(rows)=>rows[0]?.id||"";
  const defaultBank=state.accounts.find(a=>a.active&&a.id===state.defaultAccountId&&assetType(a.id)==="bank")?.id||first(activeAssets("bank"));
  const defaultCash=first(activeAssets("cash"));
  const defaultEmoney=first(activeAssets("emoney"));
  openModal("出金・振替・チャージ",`<div class="form-grid">
    <label>用途<select id="moveType">
      <option value="atm">ATM引出（銀行 → 財布）</option>
      <option value="cashTopup">現金チャージ（財布 → 電子マネー）</option>
      <option value="bankTopup">銀行チャージ（銀行 → 電子マネー）</option>
      <option value="asset">その他の残高移動</option>
      <option value="card">カードチャージ（カード → 電子マネー）</option>
    </select></label>
    <label>金額<input id="moveAmount" data-money type="number" min="0" value="10000"/><div class="money-preview"></div></label>
    <label>日付<input id="moveDate" type="date" value="${state.asOfDate}"/></label>
    <label>名称<input id="moveName" value="ATM引出"/></label>
    <label id="moveFromLabel">移動元<select id="moveFrom"></select></label>
    <label id="moveToLabel">移動先<select id="moveTo"></select></label>
  </div>
  <p id="moveHelp" class="small"></p>
  <div id="moveEffect" class="alert ok" style="margin-top:10px"></div>
  <button class="btn btn-primary" id="moveSave" type="button">保存</button>`);
  const type=document.getElementById("moveType"),from=document.getElementById("moveFrom"),to=document.getElementById("moveTo"),help=document.getElementById("moveHelp"),effect=document.getElementById("moveEffect"),name=document.getElementById("moveName"),fromLabel=document.getElementById("moveFromLabel");
  const cfg={
    atm:{from:["bank"],to:["cash"],name:"ATM引出",help:"銀行口座は減り、現金・財布は同額増えます。家計簿支出と総保有残高は変わりません。",effect:"銀行 − / 財布 ＋ / 支出 0"},
    cashTopup:{from:["cash"],to:["emoney"],name:"現金チャージ",help:"現金・財布は減り、ICカード等の電子マネー残高は同額増えます。チャージ時点では支出になりません。",effect:"財布 − / 電子マネー ＋ / 支出 0"},
    bankTopup:{from:["bank"],to:["emoney"],name:"銀行チャージ",help:"銀行口座は減り、電子マネー残高は同額増えます。チャージ時点では支出になりません。",effect:"銀行 − / 電子マネー ＋ / 支出 0"},
    asset:{from:[],to:[],name:"残高移動",help:"銀行・財布・電子マネーの間で残高を移します。移動元は減り、移動先は増え、総保有残高は変わりません。",effect:"移動元 − / 移動先 ＋ / 支出 0"},
    card:{from:null,to:["emoney"],name:"カードチャージ",help:"電子マネー残高とカード利用済み・未引落額が同額増えます。チャージ時点では家計簿支出になりません。",effect:"電子マネー ＋ / カード利用済み・未引落額 ＋ / 支出 0"}
  };
  const update=()=>{
    const c=cfg[type.value];
    name.value=c.name;
    if(type.value==="card"){
      fromLabel.firstChild.textContent="カード";
      from.innerHTML=cardOptions();
      to.innerHTML=accountOptionsByType(defaultEmoney,["emoney"]);
    }else{
      fromLabel.firstChild.textContent="移動元";
      const selectedFrom=type.value==="atm"||type.value==="bankTopup"?defaultBank:type.value==="cashTopup"?defaultCash:state.defaultAccountId;
      const selectedTo=type.value==="atm"?defaultCash:type.value==="cashTopup"||type.value==="bankTopup"?defaultEmoney:"";
      from.innerHTML=accountOptionsByType(selectedFrom,c.from);
      to.innerHTML=accountOptionsByType(selectedTo,c.to);
    }
    help.textContent=c.help;
    effect.textContent=c.effect;
  };
  type.addEventListener("change",update);
  update();
  document.getElementById("moveSave").onclick=()=>{
    const amount=Math.max(0,intMoney(document.getElementById("moveAmount").value));
    const date=document.getElementById("moveDate").value;
    if(!amount)return showToast("金額を入力してください");
    if(!isValidISODate(date))return showToast("日付を確認してください");
    if(type.value==="card"){
      if(!from.value)return showToast("クレジットカードを登録してください");
      if(!to.value)return showToast("電子マネー残高を登録してください");
      ensureV13().cardTopups.push({id:uid(),name:name.value||"カードチャージ",date,cardId:from.value,toAccountId:to.value,amount,status:"used",createdAt:isoNow()});
    }else{
      if(!from.value||!to.value){
        const need=type.value==="atm"?"銀行口座と現金・財布":type.value==="cashTopup"?"現金・財布と電子マネー残高":type.value==="bankTopup"?"銀行口座と電子マネー残高":"移動元と移動先";
        return showToast(`${need}を登録してください`);
      }
      if(from.value===to.value)return showToast("移動元と移動先を変えてください");
      state.transfers.push({id:uid(),name:name.value||cfg[type.value].name,fromAccountId:from.value,toAccountId:to.value,amount,date});
    }
    closeModal();render();showToast(`${cfg[type.value].name}を保存しました`);
  };
}
function openCardModal(cardId=""){ensureV13();const existing=cardById(cardId),c=existing?deepClone(existing):sanitizeV13Card({accountId:state.defaultAccountId});openModal(existing?"カード設定":"カードを追加",`<div class="form-grid"><label>カード名<input id="cardName" value="${esc(c.name)}"/></label><label>引落先<select id="cardAccount">${accountOptionsByType(c.accountId,["bank"])}</select></label><label>締日<input id="cardClosing" type="number" min="1" max="31" value="${c.closingDay}"/></label><label>支払日<input id="cardPaymentDay" type="number" min="1" max="31" value="${c.paymentDay}"/></label><label>支払月<select id="cardOffset"><option value="0" ${c.paymentMonthOffset===0?"selected":""}>締月</option><option value="1" ${c.paymentMonthOffset===1?"selected":""}>翌月</option><option value="2" ${c.paymentMonthOffset===2?"selected":""}>翌々月</option></select></label><label>休業日補正<select id="cardShift"><option value="none" ${c.shift==="none"?"selected":""}>なし</option><option value="previous" ${c.shift==="previous"?"selected":""}>前営業日</option><option value="next" ${c.shift==="next"?"selected":""}>翌営業日</option></select></label><label>予報方式<select id="cardMode"><option value="auto" ${c.mode==="auto"?"selected":""}>利用明細から自動予測</option><option value="manual" ${c.mode==="manual"?"selected":""}>既存の請求予定を使用</option></select></label><label>既存の請求予定<select id="cardRecurring"><option value="">なし</option>${state.recurring.filter(r=>r.kind==="expense").map(r=>`<option value="${r.id}" ${r.id===c.linkedRecurringId?"selected":""}>${esc(r.name)}</option>`).join("")}</select></label></div><p class="small">自動予測ではカード利用明細を締日ごとに集計します。確定請求額は後から上書きできます。</p><button class="btn btn-primary" id="cardSave" type="button">保存</button>`);document.getElementById("cardSave").onclick=()=>{const next=sanitizeV13Card({...c,id:existing?.id||uid(),name:document.getElementById("cardName").value,accountId:document.getElementById("cardAccount").value,closingDay:document.getElementById("cardClosing").value,paymentDay:document.getElementById("cardPaymentDay").value,paymentMonthOffset:Number(document.getElementById("cardOffset").value),shift:document.getElementById("cardShift").value,mode:document.getElementById("cardMode").value,linkedRecurringId:document.getElementById("cardRecurring").value});if(existing)state.v13.cards=state.v13.cards.map(x=>x.id===existing.id?next:x);else state.v13.cards.push(next);closeModal();render();showToast(`${next.name}を保存しました`);};}
function confirmCardBill(cardId){const c=cardById(cardId);if(!c)return;const groups=cardBillGroups().filter(g=>g.card.id===cardId).sort((a,b)=>a.date-b.date),g=groups.find(x=>x.date>=parseISODate(state.asOfDate))||groups[0],mk=g?.paymentMonth||monthKey(addDays(parseISODate(state.asOfDate),32)),amount=g?.amount||0;openModal(`${c.name}の請求額を確定`,`<p class="small">支払月 ${mk}</p><label>確定請求額<input id="cardConfirmedAmount" data-money type="number" min="0" value="${amount}"/><div class="money-preview"></div></label><button class="btn btn-primary" id="cardConfirmSave" type="button">確定</button>`);document.getElementById("cardConfirmSave").onclick=()=>{c.confirmedByMonth[mk]=Math.max(0,intMoney(document.getElementById("cardConfirmedAmount").value));c.lastConfirmedAt=isoNow();closeModal();render();};}
function markCardPaid(cardId){const c=cardById(cardId);if(!c)return;const groups=cardBillGroups().filter(g=>g.card.id===cardId).sort((a,b)=>a.date-b.date),g=groups[0];if(!g)return showToast("未払請求がありません");openModal(`${c.name}を引落済みにする`,`<p>${toISODate(g.date)}・${yen.format(g.amount)}</p><label><input id="paidBalanceReflected" type="checkbox" style="width:auto;display:inline;margin-right:6px" checked/>現在残高に引落が反映済み</label><p class="small">反映済みなら家計簿には決済記録だけ追加します。未反映なら予報へ引落を追加します。</p><button class="btn btn-primary" id="paidSave" type="button">引落済みにする</button>`);document.getElementById("paidSave").onclick=()=>{for(const id of g.itemIds){const e=state.ledgerEntries.find(x=>x.id===id);if(e)entryV13(e).status="paid";const t=state.v13.cardTopups.find(x=>x.id===id);if(t)t.status="paid";}const reflected=document.getElementById("paidBalanceReflected").checked,entry=sanitizeLedgerEntry({name:c.name+" 引落",kind:"settlement",amount:g.amount,category:"決済・返済",date:toISODate(g.date),accountId:c.accountId,paymentMethod:"bank",affectsBalance:!reflected,note:"カード利用日に支出計上済み"});state.ledgerEntries.push(entry);state.v13.entryMeta[entry.id]={status:"paid",spendingClass:"settlement",paymentMethod:"bank",cardId:c.id,splits:[],updatedAt:isoNow()};closeModal();render();showToast("引落済みにしました");};}
function createSnapshot(label="手動保存"){ensureV13();const copy=deepClone(state);if(copy.v13)copy.v13.snapshots=[];state.v13.snapshots.unshift({id:uid(),label,createdAt:isoNow(),summary:`取引 ${state.ledgerEntries.length}件・保有先 ${state.accounts.length}件`,state:copy});state.v13.snapshots=state.v13.snapshots.slice(0,4);state.v13.lastSnapshotDate=todayISO();}
const saveStateV12=saveState;saveState=function(){ensureV13();if(state.setupComplete&&state.v13.lastSnapshotDate!==todayISO()&&!saveState._snapshotting){saveState._snapshotting=true;createSnapshot("本日の開始時");saveState._snapshotting=false;}return saveStateV12();};
const reconcileV12=reconcile;reconcile=function(accountId=state.defaultAccountId){const a=state.accounts.find(x=>x.id===accountId);if(!a)return;openModal(`${a.name}の残高照合`,`<p class="small">予測との差を家計簿へ残すか、残高だけ合わせるか選択できます。</p><label>実際の現在残高<input id="actualBalance" data-money type="number" value="${a.balance}"/><div class="money-preview"></div></label><div id="reconcileDiff" class="range-line">差額 0円</div><label>処理<select id="reconcileMode"><option value="balance">残高だけ合わせる</option><option value="adjustment">未登録支出・収入として記録</option><option value="fee">手数料として記録</option></select></label><button class="btn btn-primary" id="reconcileSave" style="margin-top:12px" type="button">保存</button>`);const inp=document.getElementById("actualBalance"),diff=document.getElementById("reconcileDiff");inp.oninput=()=>diff.textContent=`差額 ${yen.format(intMoney(inp.value)-a.balance)}`;document.getElementById("reconcileSave").onclick=()=>{const old=a.balance,next=intMoney(inp.value),delta=next-old,mode=document.getElementById("reconcileMode").value;a.balance=next;a.lastConfirmedAt=isoNow();if(delta&&mode!=="balance"){const entry=sanitizeLedgerEntry({name:mode==="fee"?"未登録手数料":"残高調整",kind:delta>0?"income":"expense",amount:Math.abs(delta),category:mode==="fee"?"税・社会保険":"その他",date:state.asOfDate,accountId:a.id,paymentMethod:assetType(a.id)==="cash"?"cash":assetType(a.id)==="emoney"?"other":"bank",affectsBalance:false,note:"残高照合で実残高へ更新済み"});state.ledgerEntries.push(entry);state.v13.entryMeta[entry.id]={status:delta>0?"received":"used",spendingClass:mode==="fee"?"special":"variable",paymentMethod:assetType(a.id)==="cash"?"cash":assetType(a.id)==="emoney"?"emoney":"bank",splits:[],updatedAt:isoNow()};}closeModal();render();showToast(`${a.name}：${yen.format(next)}へ更新`);};};
function renderV13Register(){ensureV13();const list=document.getElementById("accountsList");list.innerHTML=state.accounts.map(a=>`<details class="editor-card" data-type="account" data-id="${a.id}"><summary><div class="summary-line"><div><strong>${esc(a.name)}</strong><span class="asset-badge">${assetTypeLabel(a.id)}</span><div class="list-meta">${yen.format(a.balance)}・維持 ${yen.format(a.buffer)}・確認 ${a.lastConfirmedAt?ageDays(a.lastConfirmedAt)+"日前":"未確認"}</div></div><span class="pill ${a.active?"ok":"warn"}">${a.active?"使用中":"停止"}</span></div></summary><div class="editor-body"><div class="editor-grid"><label>表示名<input data-field="name" value="${esc(a.name)}"/></label><label>種類<select data-v13-asset-type="${a.id}"><option value="bank" ${assetType(a.id)==="bank"?"selected":""}>銀行口座</option><option value="cash" ${assetType(a.id)==="cash"?"selected":""}>現金・財布</option><option value="emoney" ${assetType(a.id)==="emoney"?"selected":""}>電子マネー残高</option></select></label>${moneyField("現在残高","balance",a.balance)}${moneyField("維持残高","buffer",a.buffer)}<label>最終確認<input data-field="lastConfirmedAt" type="date" value="${a.lastConfirmedAt?toISODate(new Date(a.lastConfirmedAt)):""}"/></label></div><div class="row-actions" style="margin-top:10px"><button class="btn btn-small" data-action="toggle-account:${a.id}" type="button">${a.active?"一時停止":"再開"}</button><button class="btn btn-small" data-action="reconcile:${a.id}" type="button">残高照合</button>${state.accounts.length>1?`<button class="btn btn-small btn-danger" data-action="delete-account:${a.id}" type="button">削除</button>`:""}</div></div></details>`).join("");document.getElementById("cardsList").innerHTML=state.v13.cards.length?state.v13.cards.map(c=>{const row=cardLiabilityData(false).rows.find(r=>r.card.id===c.id);return`<details class="editor-card"><summary><div class="summary-line"><div><strong>${esc(c.name)}</strong><div class="list-meta">${c.closingDay}日締め・${c.paymentDay}日支払・未引落 ${yen.format(row?.unpaid||0)}・${esc(assetName(c.accountId))}</div></div><span class="pill ${c.active?"ok":"warn"}">${c.mode==="auto"?"自動予測":"手動予定"}</span></div></summary><div class="editor-body"><div class="row-actions" style="margin-top:10px"><button class="btn btn-small" data-action="edit-card:${c.id}" type="button">設定</button><button class="btn btn-small" data-action="confirm-card:${c.id}" type="button">請求確定</button><button class="btn btn-small" data-action="mark-card-paid:${c.id}" type="button">引落済み</button><button class="btn btn-small" data-action="toggle-card:${c.id}" type="button">${c.active?"停止":"再開"}</button><button class="btn btn-small btn-danger" data-action="delete-card:${c.id}" type="button">削除</button></div></div></details>`}).join(""):"<p class='small'>カードは未登録です。</p>";document.getElementById("cardTopupList").innerHTML=state.v13.cardTopups.length?state.v13.cardTopups.map(t=>`<div class="list-row"><div><div class="list-title">${esc(t.name)}</div><div class="list-meta">${t.date}・${esc(cardById(t.cardId)?.name||"カード未設定")} → ${esc(assetName(t.toAccountId))}</div></div><div><strong>${yen.format(t.amount)}</strong><button class="btn btn-small btn-danger" data-action="delete-card-topup:${t.id}" type="button">削除</button></div></div>`).join(""):"<p class='small'>カードチャージはありません。</p>";}
function renderV13Settings(){ensureV13();document.body.classList.toggle("large-text",state.v13.largeText);const budget=document.getElementById("categoryBudgetList");budget.innerHTML=state.household.categories.filter(c=>!["給与","副収入","臨時収入","決済・返済"].includes(c)).map(c=>{const cfg=state.v13.categoryBudgets[c]||{amount:0,mode:"reset"};return`<div class="budget-row"><strong>${esc(c)}</strong><label>予算<input data-v13-budget="${encodeURIComponent(c)}" data-money type="number" min="0" value="${intMoney(cfg.amount)}"/></label><label>方式<select data-v13-budget-mode="${encodeURIComponent(c)}">${Object.entries(V13_BUDGET_MODES).map(([k,v])=>`<option value="${k}" ${cfg.mode===k?"selected":""}>${v}</option>`).join("")}</select></label></div>`}).join("");document.getElementById("ledgerTemplateList").innerHTML=state.v13.templates.length?state.v13.templates.map(t=>`<div class="list-row"><div><div class="list-title">${esc(t.name)}</div><div class="list-meta">${esc(t.category||"その他")}・${yen.format(t.amount||0)}・${esc(paymentMethodLabelV13(t.paymentMethod))}</div></div><button class="btn btn-small btn-danger" data-action="delete-template:${t.id}" type="button">削除</button></div>`).join(""):"<p class='small'>定型入力はありません。取引保存時に追加できます。</p>";document.getElementById("snapshotList").innerHTML=state.v13.snapshots.length?state.v13.snapshots.map(s=>`<div class="snapshot-row"><div><strong>${esc(s.label)}</strong><div class="list-meta">${new Date(s.createdAt).toLocaleString("ja-JP")}・${esc(s.summary||"")}</div></div><button class="btn btn-small" data-action="restore-snapshot:${s.id}" type="button">復元</button></div>`).join(""):"<p class='small'>スナップショットはまだありません。</p>";document.getElementById("largeTextMode").checked=state.v13.largeText;document.getElementById("archiveYear").value=Number(state.household.selectedMonth.slice(0,4));}
const renderRegisterV12=renderRegister;renderRegister=function(){renderRegisterV12();renderV13Register();};const renderSettingsV12=renderSettings;renderSettings=function(){renderSettingsV12();renderV13Settings();};
const handleActionV12=handleAction;handleAction=function(action){const[cmd,id]=String(action).split(":");if(["add-ledger-expense","add-ledger-income","add-card-expense","open-transfer","add-card"].includes(cmd))document.getElementById("quickSheet")?.classList.add("hidden");if(cmd==="add-card-expense")return openLedgerModal("","expense","credit");if(cmd==="open-transfer")return openTransferModal();if(cmd==="add-card")return openCardModal();if(cmd==="edit-card")return openCardModal(id);if(cmd==="confirm-card")return confirmCardBill(id);if(cmd==="mark-card-paid")return markCardPaid(id);if(cmd==="toggle-card"){const c=cardById(id);if(c)c.active=!c.active;return render()}if(cmd==="delete-card"){if(creditItems(id,true).length)return showToast("このカードの利用履歴があるため削除できません");state.v13.cards=state.v13.cards.filter(c=>c.id!==id);return render()}if(cmd==="delete-card-topup"){state.v13.cardTopups=state.v13.cardTopups.filter(t=>t.id!==id);return render()}if(cmd==="add-bank"||cmd==="add-cash"||cmd==="add-emoney"){const type=cmd==="add-cash"?"cash":cmd==="add-emoney"?"emoney":"bank",name=type==="cash"?"財布":type==="emoney"?"電子マネー":"新しい銀行口座",a=sanitizeAccount({name,balance:0,buffer:0,lastConfirmedAt:isoNow()});state.accounts.push(a);ensureV13().assetMeta[a.id]={type};return render()}if(cmd==="ledger-prev-page"){state.v13.ui.page=Math.max(1,state.v13.ui.page-1);return renderHousehold()}if(cmd==="ledger-next-page"){state.v13.ui.page++;return renderHousehold()}if(cmd==="delete-template"){state.v13.templates=state.v13.templates.filter(t=>t.id!==id);return render()}if(cmd==="create-snapshot"){createSnapshot("手動保存");return render()}if(cmd==="restore-snapshot"){const snap=state.v13.snapshots.find(s=>s.id===id);if(!snap)return;state=sanitizeState(deepClone(snap.state));return render()}if(cmd==="archive-year")return archiveYear();if(cmd==="close-quick-sheet"){document.getElementById("quickSheet").classList.add("hidden");return}return handleActionV12(action);};
function archiveYear(){const year=String(document.getElementById("archiveYear").value),mode=document.getElementById("archiveMode").value,rows=state.ledgerEntries.filter(e=>e.date.startsWith(year+"-"));if(!rows.length)return showToast("対象年の取引がありません");const payload={format:"zandaka-yohou-year-archive",year,exportedAt:isoNow(),entries:rows,entryMeta:Object.fromEntries(rows.map(e=>[e.id,entryV13(e)]))},blob=new Blob([JSON.stringify(payload,null,2)],{type:"application/json"}),url=URL.createObjectURL(blob),a=document.createElement("a");a.href=url;a.download=`zandaka-kakeibo-${year}-archive.json`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);if(mode==="remove"&&confirm(`${year}年の${rows.length}件を端末内から削除しますか？`)){const ids=new Set(rows.map(e=>e.id));state.ledgerEntries=state.ledgerEntries.filter(e=>!ids.has(e.id));for(const id of ids)delete state.v13.entryMeta[id];state.v13.archives.push({year,count:rows.length,archivedAt:isoNow()});render();}else showToast("年度アーカイブを書き出しました");}
document.addEventListener("input",e=>{if(e.target.id==="householdSearch"){state.v13.ui.query=e.target.value;state.v13.ui.page=1;renderHousehold();saveState();}});document.addEventListener("change",e=>{const x=e.target;if(x.id==="householdPaymentFilter"){state.v13.ui.payment=x.value;state.v13.ui.page=1;renderHousehold();saveState();return}if(x.id==="householdStatusFilter"){state.v13.ui.status=x.value;state.v13.ui.page=1;renderHousehold();saveState();return}if(x.id==="householdClassFilter"){state.v13.ui.spendingClass=x.value;state.v13.ui.page=1;renderHousehold();saveState();return}if(x.id==="householdLinkedFilter"){state.v13.ui.linked=x.value;state.v13.ui.page=1;renderHousehold();saveState();return}if(x.id==="householdSort"){state.v13.ui.sort=x.value;state.v13.ui.page=1;renderHousehold();saveState();return}if(x.dataset.v13AssetType){state.v13.assetMeta[x.dataset.v13AssetType]={type:x.value};render();return}if(x.dataset.v13Budget){const c=decodeURIComponent(x.dataset.v13Budget);state.v13.categoryBudgets[c]={...(state.v13.categoryBudgets[c]||{mode:"reset"}),amount:Math.max(0,intMoney(x.value))};render();return}if(x.dataset.v13BudgetMode){const c=decodeURIComponent(x.dataset.v13BudgetMode);state.v13.categoryBudgets[c]={...(state.v13.categoryBudgets[c]||{amount:0}),mode:x.value};render();return}if(x.id==="largeTextMode"){state.v13.largeText=x.checked;render();return}});
document.getElementById("quickFab").onclick=()=>document.getElementById("quickSheet").classList.remove("hidden");document.getElementById("quickSheet").addEventListener("click",e=>{if(e.target.id==="quickSheet")e.currentTarget.classList.add("hidden")});
const setViewV12=setView;setView=function(name){setViewV12(name);document.querySelectorAll(".tab").forEach(b=>b.setAttribute("aria-current",b.dataset.view===name?"page":"false"));};
const validationIssuesV12=validationIssues;validationIssues=function(){const issues=validationIssuesV12();for(const e of state.ledgerEntries||[]){const m=entryV13(e);if(e.amount<=0)issues.push({severity:"warning",text:`${e.name}: 金額が0円です。`});if(effectivePayment(e)==="credit"&&!m.cardId)issues.push({severity:"warning",text:`${e.name}: クレジットカードが未割当です。`});if(m.splits.length&&m.splits.reduce((n,s)=>n+intMoney(s.amount),0)!==e.amount)issues.push({severity:"error",text:`${e.name}: カテゴリ分割の合計が取引額と一致しません。`});}for(const c of ensureV13().cards)if(c.mode==="auto"&&c.linkedRecurringId&&state.recurring.find(r=>r.id===c.linkedRecurringId)?.active)issues.push({severity:"warning",text:`${c.name}: 自動予測と既存の請求予定が同時に有効です。自動予測では既存予定を除外します。`});return issues;};
if(!ensureV13().snapshots.some(s=>s.label==="v1.3更新前"))createSnapshot("v1.3更新前");ensureV13();
/* ===== end v1.3 extension ===== */

/* ===== v1.4 quality, import, reconciliation and operations extension ===== */
const V14_DASHBOARD_METRICS={assetTotal:"保有残高",cardUnpaidTotal:"カード利用済み・未引落額",shortNetBalance:"短期実質残高",netFinancialBalance:"純金融残高",householdExpense:"今月の支出",householdIncome:"今月の収入",householdNet:"今月の収支",householdBudgetRemaining:"予算残額",safeNow:"今すぐ使える金額",safeMonth:"今月使える残額",dailyGuide:"1日あたり目安",lowestBalance:"予測期間の最低残高"};
function defaultV14(){return{schema:1,undoStack:[],importedBatches:[],subcategories:{},monthlyCloses:{},subscriptions:[],dashboard:{visible:Object.keys(V14_DASHBOARD_METRICS)},scenario:{expense:0,incomeReduction:0,salaryDelay:0,cardBuffer:0,loanPrepay:0,date:""},matches:{},refunds:[],update:{lastChecked:"",available:false},selectedCalendarDate:""};}
function ensureV14(){const v=ensureV13();if(!v.v14||typeof v.v14!=="object")v.v14=defaultV14();const x=v.v14,b=defaultV14();for(const[k,val]of Object.entries(b))if(x[k]==null)x[k]=deepClone(val);x.undoStack=Array.isArray(x.undoStack)?x.undoStack.slice(0,5):[];x.importedBatches=Array.isArray(x.importedBatches)?x.importedBatches:[];x.subcategories=x.subcategories&&typeof x.subcategories==="object"?x.subcategories:{};x.monthlyCloses=x.monthlyCloses&&typeof x.monthlyCloses==="object"?x.monthlyCloses:{};x.subscriptions=Array.isArray(x.subscriptions)?x.subscriptions:[];x.dashboard=x.dashboard&&typeof x.dashboard==="object"?x.dashboard:{visible:Object.keys(V14_DASHBOARD_METRICS)};x.dashboard.visible=Array.isArray(x.dashboard.visible)?x.dashboard.visible:Object.keys(V14_DASHBOARD_METRICS);x.scenario={...b.scenario,...(x.scenario||{})};x.matches=x.matches&&typeof x.matches==="object"?x.matches:{};x.refunds=Array.isArray(x.refunds)?x.refunds:[];return x;}
function stateForUndo(){const copy=deepClone(state);if(copy.v13?.v14)copy.v13.v14.undoStack=[];return copy;}
function pushUndo(label){const v=ensureV14();v.undoStack.unshift({id:uid(),label:String(label||"操作"),createdAt:isoNow(),state:stateForUndo()});v.undoStack=v.undoStack.slice(0,5);}
function undoLast(){const v=ensureV14(),u=v.undoStack.shift();if(!u)return showToast("元に戻せる操作はありません");const remaining=deepClone(v.undoStack);state=sanitizeState(u.state);ensureV14().undoStack=remaining;render();showToast(`${u.label}を元に戻しました`);}
function downloadBlob(blob,name){const url=URL.createObjectURL(blob),a=document.createElement("a");a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1500);}
function normalizeText(s){return String(s||"").normalize("NFKC").toLowerCase().replace(/[\s　・･\-_/\\]/g,"");}
function daysDiff(a,b){return Math.abs(Math.round((parseISODate(a)-parseISODate(b))/86400000));}
function entrySubcategory(e){return String(entryV13(e).subcategory||"");}
function entrySaleDate(e){return isValidISODate(entryV13(e).saleDate)?entryV13(e).saleDate:e.date;}
function isClosedMonth(mk){return !!ensureV14().monthlyCloses[mk];}
function confirmClosedMonth(mk){return !isClosedMonth(mk)||confirm(`${mk}は締め済みです。編集を続けますか？`);}

/* card sale date + refund adjustments */
creditItems=function(cardId="",includeFuture=true){const asOf=parseISODate(state.asOfDate),rows=[];for(const e of state.ledgerEntries||[]){const m=entryV13(e);if(e.kind!=="expense"||effectivePayment(e)!=="credit"||!isEntryActive(e)||m.status==="paid")continue;if(cardId&&m.cardId!==cardId)continue;const date=entrySaleDate(e);if(!includeFuture&&compareDates(parseISODate(date),asOf)>0)continue;rows.push({type:"entry",id:e.id,date,amount:e.amount,status:m.status,cardId:m.cardId,name:e.name});}for(const t of ensureV13().cardTopups){if(["cancelled","refunded","paid"].includes(t.status))continue;if(cardId&&t.cardId!==cardId)continue;if(!includeFuture&&compareDates(parseISODate(t.date),asOf)>0)continue;rows.push({type:"topup",id:t.id,date:t.date,amount:t.amount,status:t.status,cardId:t.cardId,name:t.name});}for(const r of ensureV14().refunds){if(r.mode!=="card"||r.status==="cancelled")continue;if(cardId&&r.cardId!==cardId)continue;if(!includeFuture&&compareDates(parseISODate(r.date),asOf)>0)continue;rows.push({type:"refund",id:r.id,date:r.date,amount:-Math.abs(r.amount),status:"refunded",cardId:r.cardId,name:r.name||"返金"});}return rows;};

function refundTotals(monthValue){const result={total:0,category:{}};for(const r of ensureV14().refunds){if(r.status==="cancelled"||!String(r.date).startsWith(monthValue))continue;result.total+=r.amount;result.category[r.category]=(result.category[r.category]||0)+r.amount;}return result;}
const householdSummaryV13ForV14=householdSummary;householdSummary=function(monthValue=state.household.selectedMonth){const s=householdSummaryV13ForV14(monthValue),r=refundTotals(monthValue);s.refunds=r.total;s.expense=Math.max(0,s.expense-r.total);s.net=s.income-s.expense;s.remaining=s.budget-s.expense;for(const[k,v]of Object.entries(r.category))s.category[k]=Math.max(0,(s.category[k]||0)-v);return s;};

/* subscriptions participate in forecast */
function subscriptionEvents(start,end){const out=[];for(const sub of ensureV14().subscriptions){if(!sub.active||!isValidISODate(sub.nextDate)||!sub.accountId)continue;let d=parseISODate(sub.nextDate),guard=0;while(d<=end&&guard++<240){if(d>=start){let eventDate=new Date(d),accountId=sub.accountId,name=sub.name,basis=sub.cycle==="annual"?"年間定期購読":"月間定期購読";if(sub.paymentMethod==="credit"&&sub.cardId&&cardById(sub.cardId)){const card=cardById(sub.cardId),info=cardPaymentInfo(toISODate(d),card);eventDate=info.paymentDate;accountId=card.accountId;name=card.name+" 定期購読請求";basis+="・カード引落";}if(eventDate>=start&&eventDate<=end)out.push({date:eventDate,name,amount:-Math.abs(sub.amount),accountId,source:"subscription",certainty:"estimated",meta:{subscriptionId:sub.id,basis}});}if(!sub.autoRenew)break;d=new Date(d);if(sub.cycle==="annual")d.setFullYear(d.getFullYear()+1);else d.setMonth(d.getMonth()+1);}}return out;}
const collectEventsV13ForV14=collectEvents;collectEvents=function(start,end,mode=state.forecastMode,scenario=0){let events=collectEventsV13ForV14(start,end,mode,scenario);events.push(...subscriptionEvents(start,end));for(const r of ensureV14().refunds){if(r.mode!=="bank"||r.status==="cancelled"||!r.accountId)continue;const d=parseISODate(r.date);if(d>=start&&d<=end)events.push({date:d,name:r.name||"返金",amount:Math.abs(r.amount),accountId:r.accountId,source:"refund",certainty:"confirmed",meta:{refundId:r.id,basis:"返金入金"}});}events.sort((a,b)=>compareDates(a.date,b.date)||a.amount-b.amount||a.name.localeCompare(b.name,"ja"));return events;};

const plannedHouseholdCandidatesV13ForV14=plannedHouseholdCandidates;plannedHouseholdCandidates=function(monthValue=state.household.selectedMonth){const base=plannedHouseholdCandidatesV13ForV14(monthValue),{start,end}=householdMonthRange(monthValue),existing=new Set((state.ledgerEntries||[]).map(e=>e.sourceKey).filter(Boolean)),subs=subscriptionEvents(start,end).map(e=>({...e,sourceKey:`subscription|${e.meta.subscriptionId}|${toISODate(e.date)}|${e.amount}`})).filter(e=>!existing.has(e.sourceKey));return [...base,...subs].sort((a,b)=>compareDates(a.date,b.date)||a.name.localeCompare(b.name,"ja"));};
/* planned/actual matching */
function matchSuggestions(){const planned=plannedHouseholdCandidates(),actual=(state.ledgerEntries||[]).filter(e=>isEntryActive(e)&&!e.sourceKey),rows=[];for(const p of planned){for(const e of actual){if((p.amount<0)!==(e.kind==="expense"))continue;const amount=Math.abs(p.amount),delta=Math.abs(amount-e.amount),dateGap=daysDiff(toISODate(p.date),e.date);if(dateGap>5||delta>Math.max(500,amount*.08))continue;const pn=normalizeText(p.name),en=normalizeText(e.name),nameScore=pn&&en&&(pn.includes(en)||en.includes(pn))?2:0,score=5-dateGap+(delta===0?3:delta<=100?2:1)+nameScore;if(score>=5)rows.push({planned:p,entry:e,score,delta,dateGap});}}return rows.sort((a,b)=>b.score-a.score||a.dateGap-b.dateGap).slice(0,30);}
function applyMatch(sourceKey,entryId){const p=plannedHouseholdCandidates().find(x=>x.sourceKey===sourceKey),e=state.ledgerEntries.find(x=>x.id===entryId);if(!p||!e)return showToast("照合候補が見つかりません");pushUndo("予定と実績の照合");e.sourceKey=p.sourceKey;entryV13(e).matchedAt=isoNow();ensureV14().matches[p.sourceKey]=entryId;render();showToast("予定と実績を照合しました");}
function renderMatchSuggestions(){const el=document.getElementById("v14MatchSuggestions");if(!el)return;const rows=matchSuggestions().slice(0,4);el.innerHTML=rows.length?rows.map(x=>`<div class="v14-match"><div><strong>${esc(x.entry.name)} ${yen.format(x.entry.amount)}</strong><div class="list-meta">実績 ${x.entry.date} ↔ 予定 ${toISODate(x.planned.date)} ${esc(x.planned.name)} ${yen.format(Math.abs(x.planned.amount))}</div></div><button class="btn btn-small" data-action="v14-match:${encodeURIComponent(x.planned.sourceKey)}|${x.entry.id}" type="button">同じ取引</button></div>`).join(""):"<p class='small'>照合候補はありません。</p>";}
function openMatchesModal(){const rows=matchSuggestions();openModal("予定と実績の照合",rows.length?rows.map(x=>`<div class="v14-match"><div><strong>${esc(x.entry.name)} ${yen.format(x.entry.amount)}</strong><div class="list-meta">${x.entry.date} ↔ ${toISODate(x.planned.date)}・${esc(x.planned.name)}・差額 ${yen.format(x.delta)}</div></div><button class="btn btn-small" data-action="v14-match:${encodeURIComponent(x.planned.sourceKey)}|${x.entry.id}" type="button">照合</button></div>`).join(""):"<p>候補はありません。</p>");}

/* diagnostics */
function diagnostics(){const issues=[],activeAccounts=new Set(state.accounts.map(a=>a.id)),cards=new Set(ensureV13().cards.map(c=>c.id)),names=new Map();for(const a of state.accounts){const k=normalizeText(a.name);names.set(k,(names.get(k)||0)+1);if(ageDays(a.lastConfirmedAt)>state.staleDays)issues.push({severity:"warning",code:"stale",text:`${a.name}: 残高確認から${ageDays(a.lastConfirmedAt)}日経過`});if(["cash","emoney"].includes(assetType(a.id))&&currentAssetBalances()[a.id]<0)issues.push({severity:"warning",code:"negative",text:`${a.name}: 残高がマイナスです`});}for(const[k,n]of names)if(k&&n>1)issues.push({severity:"warning",code:"duplicateAccount",text:`同名の保有先が${n}件あります`});const seen=new Map();for(const e of state.ledgerEntries||[]){const m=entryV13(e);if(!activeAccounts.has(e.accountId)&&effectivePayment(e)!=="credit")issues.push({severity:"error",code:"orphanAccount",entryId:e.id,text:`${e.name}: 削除済みの保有先を参照`,repairable:true});if(effectivePayment(e)==="credit"&&m.cardId&&!cards.has(m.cardId))issues.push({severity:"error",code:"orphanCard",entryId:e.id,text:`${e.name}: 削除済みカードを参照`,repairable:true});if(m.splits.length&&m.splits.reduce((n,s)=>n+intMoney(s.amount),0)!==e.amount)issues.push({severity:"error",code:"split",entryId:e.id,text:`${e.name}: 分割合計が不一致`,repairable:true});if(m.status==="planned"&&e.date<state.asOfDate)issues.push({severity:"warning",code:"pastPlanned",entryId:e.id,text:`${e.name}: 過去日のまま予定状態`});const key=`${e.date}|${normalizeText(e.name)}|${e.amount}|${e.kind}`;if(seen.has(key))issues.push({severity:"warning",code:"duplicateEntry",entryId:e.id,text:`${e.name}: 重複候補（${e.date}・${yen.format(e.amount)}）`});else seen.set(key,e.id);}for(const c of ensureV13().cards){if(!activeAccounts.has(c.accountId))issues.push({severity:"error",code:"cardAccount",cardId:c.id,text:`${c.name}: 引落先が見つかりません`,repairable:true});}return issues;}
function repairDiagnostics(){const issues=diagnostics().filter(x=>x.repairable);if(!issues.length)return showToast("自動修復できる問題はありません");pushUndo("データ診断の修復");createSnapshot("データ診断の修復前");const fallback=state.accounts.find(a=>a.active)?.id||state.accounts[0]?.id||"";for(const x of issues){if(x.code==="orphanAccount"){const e=state.ledgerEntries.find(v=>v.id===x.entryId);if(e)e.accountId=fallback;}if(x.code==="orphanCard"){const e=state.ledgerEntries.find(v=>v.id===x.entryId);if(e){entryV13(e).cardId="";entryV13(e).paymentMethod="other";entryV13(e).status="unconfirmed";}}if(x.code==="split"){const e=state.ledgerEntries.find(v=>v.id===x.entryId);if(e)entryV13(e).splits=[];}if(x.code==="cardAccount"){const c=cardById(x.cardId);if(c)c.accountId=fallback;}}render();showToast(`${issues.length}件を修復しました`);}
function openDiagnostics(){const rows=diagnostics();openModal("データ整合性診断",`<div class="alert ${rows.some(x=>x.severity==="error")?"danger":"ok"}">${rows.length?`${rows.length}件の確認項目があります。`:"問題は見つかりませんでした。"}</div>${rows.map(x=>`<div class="v14-issue ${x.severity}"><strong>${x.severity==="error"?"エラー":x.severity==="warning"?"要確認":"情報"}</strong><div>${esc(x.text)}</div></div>`).join("")}${rows.some(x=>x.repairable)?'<button class="btn btn-primary" data-action="v14-repair-diagnostics" type="button" style="margin-top:12px">安全に自動修復</button>':""}`);}

/* refunds */
function openRefundModal(entryId){const e=state.ledgerEntries.find(x=>x.id===entryId);if(!e)return;const m=entryV13(e),already=ensureV14().refunds.filter(r=>r.entryId===entryId&&r.status!=="cancelled").reduce((n,r)=>n+r.amount,0),max=Math.max(0,e.amount-already);if(!max)return showToast("全額返金済みです");openModal("取消・返金",`<p><strong>${esc(e.name)}</strong> ${yen.format(e.amount)}</p><div class="form-grid"><label>処理<select id="v14RefundMode"><option value="cancel">元の利用を取消</option>${effectivePayment(e)==="credit"?'<option value="card">次回カード請求から減額</option>':""}<option value="bank">銀行・財布へ返金</option><option value="points">ポイント等で返還</option></select></label><label>金額<input id="v14RefundAmount" data-money type="number" min="1" max="${max}" value="${max}"/><div class="money-preview"></div></label><label>処理日<input id="v14RefundDate" type="date" value="${state.asOfDate}"/></label><label>返金先<select id="v14RefundAccount">${optAccounts(e.accountId)}</select></label></div><p class="small">カード請求減額は未引落額を減らします。銀行返金は残高予報へ入金を追加します。</p><button class="btn btn-primary" id="v14RefundSave" type="button">実行</button>`);bindMoneyPreviews();document.getElementById("v14RefundSave").onclick=()=>{const mode=document.getElementById("v14RefundMode").value,amount=Math.min(max,Math.max(1,intMoney(document.getElementById("v14RefundAmount").value))),date=document.getElementById("v14RefundDate").value;if(!confirmClosedMonth(e.date.slice(0,7)))return;pushUndo("取消・返金");if(mode==="cancel"&&amount===max){m.status="cancelled";}else{ensureV14().refunds.push({id:uid(),entryId:e.id,name:`${e.name} 返金`,date,amount,category:e.category,mode,cardId:m.cardId||"",accountId:document.getElementById("v14RefundAccount").value,status:"active",createdAt:isoNow()});m.refundedAmount=(m.refundedAmount||0)+amount;m.refundComplete=m.refundedAmount>=e.amount;}closeModal();render();showToast("返金処理を登録しました");};}

/* CSV import */
function parseCsv(text){const rows=[];let row=[],cell="",q=false;for(let i=0;i<text.length;i++){const c=text[i],n=text[i+1];if(q){if(c==='"'&&n==='"'){cell+='"';i++;}else if(c==='"')q=false;else cell+=c;}else if(c==='"')q=true;else if(c===','){row.push(cell);cell="";}else if(c==='\n'){row.push(cell.replace(/\r$/,""));rows.push(row);row=[];cell="";}else cell+=c;}if(cell||row.length){row.push(cell.replace(/\r$/,""));rows.push(row);}return rows.filter(r=>r.some(x=>String(x).trim()!==""));}
function parseFlexibleDate(v){const s=String(v||"").trim();if(/^\d{4}[-/]\d{1,2}[-/]\d{1,2}$/.test(s)){const[y,m,d]=s.split(/[-/]/).map(Number);return `${y}-${String(m).padStart(2,"0")}-${String(d).padStart(2,"0")}`;}if(/^\d{1,2}[-/]\d{1,2}$/.test(s)){const[m,d]=s.split(/[-/]/).map(Number),y=parseISODate(state.asOfDate).getFullYear();return `${y}-${String(m).padStart(2,"0")}-${String(d).padStart(2,"0")}`;}return "";}
function csvNumber(v){return Number(String(v||"").replace(/[￥¥,\s]/g,""))||0;}
let v14CsvRows=null;
async function openCsvImport(){const file=document.getElementById("v14CsvFile")?.files?.[0];if(!file)return showToast("CSVファイルを選択してください");const text=await file.text(),rows=parseCsv(text);if(rows.length<2)return showToast("明細行を読み取れません");v14CsvRows=rows;const headers=rows[0],opts=headers.map((h,i)=>`<option value="${i}">${i+1}: ${esc(h||`列${i+1}`)}</option>`).join("");openModal("CSV明細を取り込む",`<div class="form-grid"><label>日付列<select id="v14CsvDate">${opts}</select></label><label>内容・店名列<select id="v14CsvName">${opts}</select></label><label>金額列<select id="v14CsvAmount">${opts}</select></label><label>入出金形式<select id="v14CsvSign"><option value="signed">支出がマイナス・収入がプラス</option><option value="expensePositive">支出を正の金額で記載</option></select></label><label>取込先<select id="v14CsvPayment"><option value="bank">銀行明細</option><option value="credit">カード明細</option><option value="emoney">電子マネー明細</option><option value="cash">現金記録</option></select></label><label>保有先・カード<select id="v14CsvSource"></select></label></div><label><input id="v14CsvSkipDuplicates" type="checkbox" checked style="width:auto;display:inline;margin-right:6px">重複候補を除外</label><div id="v14CsvPreview" class="table-wrap" style="margin-top:10px"></div><button class="btn btn-primary" id="v14CsvCommit" type="button">取り込む</button>`);const dateSel=document.getElementById("v14CsvDate"),nameSel=document.getElementById("v14CsvName"),amountSel=document.getElementById("v14CsvAmount"),payment=document.getElementById("v14CsvPayment"),source=document.getElementById("v14CsvSource");const guess=(re,fallback)=>Math.max(0,headers.findIndex(h=>re.test(String(h))));dateSel.value=guess(/日付|利用日|取引日|date/i,0);nameSel.value=guess(/摘要|内容|店名|利用先|加盟店|description/i,1);amountSel.value=guess(/金額|利用額|支払額|amount/i,Math.min(2,headers.length-1));const updateSource=()=>{source.innerHTML=payment.value==="credit"?cardOptions():accountOptionsByType("",payment.value==="cash"?["cash"]:payment.value==="emoney"?["emoney"]:["bank"]);};const preview=()=>{const di=+dateSel.value,ni=+nameSel.value,ai=+amountSel.value;document.getElementById("v14CsvPreview").innerHTML=`<table class="v14-table"><thead><tr><th>日付</th><th>内容</th><th>金額</th></tr></thead><tbody>${rows.slice(1,11).map(r=>`<tr><td>${esc(r[di]||"")}</td><td>${esc(r[ni]||"")}</td><td>${esc(r[ai]||"")}</td></tr>`).join("")}</tbody></table><p class="small">全${rows.length-1}行・先頭10行を表示</p>`;};payment.onchange=updateSource;[dateSel,nameSel,amountSel].forEach(x=>x.onchange=preview);updateSource();preview();document.getElementById("v14CsvCommit").onclick=()=>commitCsvImport();}
function commitCsvImport(){if(!v14CsvRows)return;const rows=v14CsvRows.slice(1),di=+document.getElementById("v14CsvDate").value,ni=+document.getElementById("v14CsvName").value,ai=+document.getElementById("v14CsvAmount").value,sign=document.getElementById("v14CsvSign").value,pm=document.getElementById("v14CsvPayment").value,source=document.getElementById("v14CsvSource").value,skip=document.getElementById("v14CsvSkipDuplicates").checked,existing=new Set(state.ledgerEntries.map(e=>`${e.date}|${normalizeText(e.name)}|${e.amount}|${e.kind}`));const adds=[];let duplicates=0,invalid=0;for(const r of rows){const date=parseFlexibleDate(r[di]),name=String(r[ni]||"明細").trim(),raw=csvNumber(r[ai]);if(!date||!raw){invalid++;continue;}let kind,amount;if(sign==="expensePositive"){kind="expense";amount=Math.abs(raw);}else{kind=raw<0?"expense":"income";amount=Math.abs(raw);}const key=`${date}|${normalizeText(name)}|${intMoney(amount)}|${kind}`;if(skip&&existing.has(key)){duplicates++;continue;}const e=sanitizeLedgerEntry({id:uid(),name,kind,amount,date,category:kind==="income"?"臨時収入":guessHouseholdCategory(name,-amount),paymentMethod:pm==="credit"?"credit":pm==="emoney"?"emoney":pm==="cash"?"cash":"bank",accountId:pm==="credit"?(cardById(source)?.accountId||state.defaultAccountId):source,affectsBalance:pm!=="credit",createdAt:isoNow()});adds.push(e);existing.add(key);}if(!adds.length)return showToast(`取込対象なし（重複${duplicates}・無効${invalid}）`);pushUndo("CSV明細の取込");for(const e of adds){state.ledgerEntries.push(e);ensureV13().entryMeta[e.id]={status:e.kind==="income"?"received":"used",spendingClass:"variable",paymentMethod:e.paymentMethod,cardId:pm==="credit"?source:"",splits:[],merchant:e.name,updatedAt:isoNow(),imported:true};}ensureV14().importedBatches.unshift({id:uid(),createdAt:isoNow(),count:adds.length,duplicates,invalid});closeModal();render();showToast(`${adds.length}件を取り込みました`);}

/* merchant rules and subcategories */
function openMerchantRuleModal(key=""){const rules=ensureV13().merchantRules,old=key?rules[key]:null;openModal(old?"店名ルールを編集":"店名ルールを追加",`<div class="form-grid"><label>店名キーワード<input id="v14RuleKey" value="${esc(key)}"/></label><label>カテゴリ<select id="v14RuleCategory">${state.household.categories.map(c=>`<option value="${esc(c)}" ${old?.category===c?"selected":""}>${esc(c)}</option>`).join("")}</select></label><label>支払方法<select id="v14RulePayment">${Object.entries(V13_PAYMENT_METHODS).map(([k,v])=>`<option value="${k}" ${old?.paymentMethod===k?"selected":""}>${v}</option>`).join("")}</select></label></div><button class="btn btn-primary" id="v14RuleSave" type="button">保存</button>`);document.getElementById("v14RuleSave").onclick=()=>{const n=normalizeText(document.getElementById("v14RuleKey").value);if(!n)return showToast("キーワードを入力してください");pushUndo("店名ルールの変更");if(key&&key!==n)delete rules[key];rules[n]={category:document.getElementById("v14RuleCategory").value,paymentMethod:document.getElementById("v14RulePayment").value};closeModal();render();};}
function openSubcategoryModal(parent="",value=""){openModal(value?"サブカテゴリを編集":"サブカテゴリを追加",`<div class="form-grid"><label>親カテゴリ<select id="v14SubParent">${state.household.categories.map(c=>`<option value="${esc(c)}" ${parent===c?"selected":""}>${esc(c)}</option>`).join("")}</select></label><label>サブカテゴリ<input id="v14SubName" value="${esc(value)}"/></label></div><button class="btn btn-primary" id="v14SubSave" type="button">保存</button>`);document.getElementById("v14SubSave").onclick=()=>{const p=document.getElementById("v14SubParent").value,n=document.getElementById("v14SubName").value.trim();if(!n)return showToast("名称を入力してください");pushUndo("サブカテゴリの変更");const map=ensureV14().subcategories;map[p]=Array.isArray(map[p])?map[p]:[];if(value)map[p]=map[p].filter(x=>x!==value);if(!map[p].includes(n))map[p].push(n);closeModal();render();};}

/* subscriptions */
function openSubscriptionModal(id=""){const v=ensureV14(),old=v.subscriptions.find(x=>x.id===id)||{id:uid(),name:"",amount:0,cycle:"monthly",nextDate:state.asOfDate,paymentMethod:"credit",accountId:state.defaultAccountId,cardId:"",category:"通信",active:true,freeUntil:"",autoRenew:true};openModal(id?"定期購読を編集":"定期購読を追加",`<div class="form-grid"><label>サービス名<input id="v14SubscrName" value="${esc(old.name)}"/></label><label>金額<input id="v14SubscrAmount" data-money type="number" min="0" value="${old.amount}"/><div class="money-preview"></div></label><label>周期<select id="v14SubscrCycle"><option value="monthly" ${old.cycle==="monthly"?"selected":""}>月額</option><option value="annual" ${old.cycle==="annual"?"selected":""}>年額</option></select></label><label>次回更新日<input id="v14SubscrDate" type="date" value="${old.nextDate}"/></label><label>無料期間終了<input id="v14SubscrFree" type="date" value="${old.freeUntil||""}"/></label><label>カテゴリ<select id="v14SubscrCategory">${state.household.categories.map(c=>`<option value="${esc(c)}" ${old.category===c?"selected":""}>${esc(c)}</option>`).join("")}</select></label><label>支払方法<select id="v14SubscrPayment"><option value="bank" ${old.paymentMethod==="bank"?"selected":""}>銀行</option><option value="credit" ${old.paymentMethod==="credit"?"selected":""}>カード</option><option value="emoney" ${old.paymentMethod==="emoney"?"selected":""}>電子マネー</option></select></label><label>支払元<select id="v14SubscrSource"></select></label></div><label><input id="v14SubscrRenew" type="checkbox" ${old.autoRenew?"checked":""} style="width:auto;display:inline;margin-right:6px">自動更新</label><label style="margin-left:12px"><input id="v14SubscrActive" type="checkbox" ${old.active?"checked":""} style="width:auto;display:inline;margin-right:6px">有効</label><button class="btn btn-primary" id="v14SubscrSave" type="button" style="margin-top:10px">保存</button>`);bindMoneyPreviews();const pay=document.getElementById("v14SubscrPayment"),src=document.getElementById("v14SubscrSource");const update=()=>src.innerHTML=pay.value==="credit"?cardOptions(old.cardId):accountOptionsByType(old.accountId,pay.value==="emoney"?["emoney"]:["bank"]);pay.onchange=update;update();document.getElementById("v14SubscrSave").onclick=()=>{const next={...old,name:document.getElementById("v14SubscrName").value.trim(),amount:Math.max(0,intMoney(document.getElementById("v14SubscrAmount").value)),cycle:document.getElementById("v14SubscrCycle").value,nextDate:document.getElementById("v14SubscrDate").value,freeUntil:document.getElementById("v14SubscrFree").value,category:document.getElementById("v14SubscrCategory").value,paymentMethod:pay.value,accountId:pay.value==="credit"?(cardById(src.value)?.accountId||state.defaultAccountId):src.value,cardId:pay.value==="credit"?src.value:"",autoRenew:document.getElementById("v14SubscrRenew").checked,active:document.getElementById("v14SubscrActive").checked};if(!next.name||!next.amount||!isValidISODate(next.nextDate))return showToast("名称・金額・次回更新日を確認してください");pushUndo("定期購読の変更");v.subscriptions=v.subscriptions.filter(x=>x.id!==id);v.subscriptions.push(next);closeModal();render();};}

/* monthly close */
function closeSelectedMonth(){const mk=state.household.selectedMonth,unconfirmed=rawMonthEntries(mk).filter(e=>effectiveStatus(e)==="unconfirmed"||effectiveStatus(e)==="planned").length,stale=state.accounts.filter(a=>ageDays(a.lastConfirmedAt)>state.staleDays).length;if((unconfirmed||stale)&&!confirm(`未確認取引 ${unconfirmed}件、古い残高 ${stale}件があります。このまま締めますか？`))return;pushUndo("月間締め");createSnapshot(`${mk} 月間締め前`);ensureV14().monthlyCloses[mk]={closedAt:isoNow(),balances:currentAssetBalances(),unconfirmed,stale,backupAt:state.lastBackupAt||""};render();showToast(`${mk}を締めました`);}
function reopenSelectedMonth(){const mk=state.household.selectedMonth;if(!ensureV14().monthlyCloses[mk])return showToast("締め済みではありません");pushUndo("月間締め解除");delete ensureV14().monthlyCloses[mk];render();showToast("締めを解除しました");}

/* dashboard customization */
function applyDashboardVisibility(){const visible=new Set(ensureV14().dashboard.visible);for(const id of Object.keys(V14_DASHBOARD_METRICS)){const el=document.getElementById(id),card=el?.closest("article.metric");if(card)card.classList.toggle("v14-hidden",!visible.has(id));}}

/* scenario and uncertainty */
function scenarioForecast(){const cfg=ensureV14().scenario,original=state;state=sanitizeState(deepClone(state));try{const date=isValidISODate(cfg.date)?cfg.date:state.asOfDate,aid=state.defaultAccountId;if(cfg.expense>0)state.oneOff.push(sanitizeOneOff({name:"シナリオ臨時支出",date,amount:-cfg.expense,accountId:aid,certainty:"confirmed"}));if(cfg.loanPrepay>0)state.oneOff.push(sanitizeOneOff({name:"ローン繰上返済",date,amount:-cfg.loanPrepay,accountId:aid,certainty:"confirmed"}));if(cfg.incomeReduction>0){for(const r of state.recurring.filter(x=>x.active&&x.kind==="income"))r.amount=Math.max(0,r.amount-cfg.incomeReduction);}if(cfg.salaryDelay>0){for(const r of state.recurring.filter(x=>x.active&&x.kind==="income"))r.offsetDays+=cfg.salaryDelay;}if(cfg.cardBuffer>0){for(const c of ensureV13().cards)for(const k of Object.keys(c.confirmedByMonth||{}))c.confirmedByMonth[k]=Math.round(c.confirmedByMonth[k]*(1+cfg.cardBuffer/100));for(const e of state.ledgerEntries.filter(x=>effectivePayment(x)==="credit"&&isEntryActive(x)))e.amount=Math.round(e.amount*(1+cfg.cardBuffer/100));}return buildForecast(state.forecastMode);}finally{state=original;}}
function renderScenario(){const cfg=ensureV14().scenario;for(const[id,key]of [["v14ScenarioExpense","expense"],["v14ScenarioIncomeReduction","incomeReduction"],["v14ScenarioSalaryDelay","salaryDelay"],["v14ScenarioCardBuffer","cardBuffer"],["v14ScenarioLoanPrepay","loanPrepay"],["v14ScenarioDate","date"]]){const el=document.getElementById(id);if(el)el.value=cfg[key]||"";}const el=document.getElementById("v14ScenarioResult");if(!el)return;if(!Object.values(cfg).some(v=>Number(v)>0)){el.innerHTML="<p class='small'>条件を入力して比較してください。</p>";return;}const base=buildForecast(state.forecastMode),sc=scenarioForecast(),bEnd=base.daily.at(-1)?.total||0,sEnd=sc.daily.at(-1)?.total||0;el.innerHTML=`<div class="v14-kpi-grid"><div class="v14-kpi">現在の期末<strong>${yen.format(bEnd)}</strong></div><div class="v14-kpi">シナリオ期末<strong class="${sEnd<0?"negative":""}">${yen.format(sEnd)}</strong></div><div class="v14-kpi">差額<strong class="${sEnd-bEnd<0?"negative":"positive"}">${yen.format(sEnd-bEnd)}</strong></div></div><p class="small">${sc.firstShortage?`不足開始 ${fullDateFmt.format(sc.firstShortage.date)}・${accountName(sc.firstShortage.accountId)}`:"シナリオでも残高不足なし"}</p>`;}
function renderUncertainty(){const el=document.getElementById("v14Uncertainty");if(!el)return;const e=buildForecast("expected"),c=buildForecast("conservative"),ee=e.daily.at(-1)?.total||0,ce=c.daily.at(-1)?.total||0,max=Math.max(1,Math.abs(ee),Math.abs(ce));el.innerHTML=`<div class="list-row"><div><strong>標準</strong><div class="v14-uncertainty-track"><span style="width:${Math.max(2,Math.abs(ee)/max*100)}%"></span></div></div><strong>${yen.format(ee)}</strong></div><div class="list-row"><div><strong>保守</strong><div class="v14-uncertainty-track"><span style="width:${Math.max(2,Math.abs(ce)/max*100)}%;opacity:.55"></span></div></div><strong>${yen.format(ce)}</strong></div><div class="list-row"><span>期末差</span><strong>${yen.format(ee-ce)}</strong></div>`;}
function renderShortageSolver(){const el=document.getElementById("shortageActions");if(!el)return;const f=buildForecast(state.forecastMode),x=f.firstShortage||f.firstBufferBreach;if(!x)return;const a=state.accounts.find(z=>z.id===x.accountId),target=f.firstShortage?0:(a?.buffer||0),need=Math.max(0,target-x.balance),events=f.eventRows.filter(r=>r.date<=x.date&&r.amount<0).sort((a,b)=>a.amount-b.amount),largest=events[0];el.innerHTML=`<strong>${esc(accountName(x.accountId))}</strong>へ${fullDateFmt.format(x.date)}までに必要：<strong>${yen.format(need)}</strong><ul><li>${yen.format(need)}を入金・資金移動</li><li>それまでの追加支出を${yen.format(need)}削減</li>${largest?`<li>${esc(largest.name)}（${yen.format(Math.abs(largest.amount))}）を後ろへ移せる場合は再試算</li>`:""}</ul>`;}

/* encrypted backup */
function bytesToB64(bytes){let s="";for(const b of bytes)s+=String.fromCharCode(b);return btoa(s);}function b64ToBytes(s){return Uint8Array.from(atob(s),c=>c.charCodeAt(0));}
async function deriveBackupKey(pass,salt){const raw=await crypto.subtle.importKey("raw",new TextEncoder().encode(pass),"PBKDF2",false,["deriveKey"]);return crypto.subtle.deriveKey({name:"PBKDF2",salt,iterations:250000,hash:"SHA-256"},raw,{name:"AES-GCM",length:256},false,["encrypt","decrypt"]);}
async function exportEncrypted(){if(!window.crypto?.subtle)return showToast("暗号化バックアップはHTTPS公開環境で利用できます");const p=document.getElementById("v14BackupPass").value,p2=document.getElementById("v14BackupPass2").value;if(p.length<8)return showToast("8文字以上のパスフレーズが必要です");if(p!==p2)return showToast("パスフレーズが一致しません");const salt=crypto.getRandomValues(new Uint8Array(16)),iv=crypto.getRandomValues(new Uint8Array(12)),key=await deriveBackupKey(p,salt),plain=new TextEncoder().encode(JSON.stringify({format:"zandaka-yohou-encrypted",version:APP_VERSION,exportedAt:isoNow(),state})),cipher=new Uint8Array(await crypto.subtle.encrypt({name:"AES-GCM",iv},key,plain)),payload={format:"zandaka-yohou-aes-gcm",kdf:"PBKDF2-SHA256",iterations:250000,salt:bytesToB64(salt),iv:bytesToB64(iv),ciphertext:bytesToB64(cipher)};state.lastBackupAt=isoNow();downloadBlob(new Blob([JSON.stringify(payload)],{type:"application/json"}),`zandaka-yohou-encrypted-${state.asOfDate}.zyenc`);render();showToast("暗号化バックアップを書き出しました");}
async function importEncryptedFile(file){if(!window.crypto?.subtle)return showToast("暗号化バックアップはHTTPS公開環境で利用できます");const pass=prompt("バックアップのパスフレーズを入力してください");if(!pass)return;try{const payload=JSON.parse(await file.text()),salt=b64ToBytes(payload.salt),iv=b64ToBytes(payload.iv),cipher=b64ToBytes(payload.ciphertext),key=await deriveBackupKey(pass,salt),plain=await crypto.subtle.decrypt({name:"AES-GCM",iv},key,cipher),obj=JSON.parse(new TextDecoder().decode(plain));if(!obj.state)throw new Error("保存データなし");pushUndo("暗号化バックアップの復元");state=sanitizeState(obj.state);render();showToast("暗号化バックアップを復元しました");}catch(e){showToast("復号できません。パスフレーズかファイルを確認してください");}}

/* render additions */
const renderHouseholdV13ForV14=renderHousehold;renderHousehold=function(){renderHouseholdV13ForV14();renderMatchSuggestions();const s=householdSummary();const note=document.getElementById("householdExpenseNote");if(note&&s.refunds)note.textContent=`返金 ${yen.format(s.refunds)}を控除`;const list=document.getElementById("householdTransactions");if(list){for(const row of list.querySelectorAll(".household-transaction")){const edit=row.querySelector('[data-action^="edit-ledger:"]');if(!edit)continue;const id=edit.dataset.action.split(":")[1],e=state.ledgerEntries.find(x=>x.id===id);if(!e)continue;const m=entryV13(e),meta=row.querySelector(".transaction-meta");if(meta&&entrySubcategory(e))meta.insertAdjacentHTML("beforeend",`<span class="v14-subcategory">・${esc(entrySubcategory(e))}</span>`);const actions=edit.parentElement;if(e.kind==="expense"&&!['cancelled','refunded'].includes(m.status)&&!actions.querySelector('[data-action^="v14-refund:"]'))actions.insertAdjacentHTML("afterbegin",`<button class="btn btn-small" data-action="v14-refund:${e.id}" type="button">取消・返金</button>`);if(isClosedMonth(e.date.slice(0,7)))row.classList.add("v14-closed");}}const cardEl=document.getElementById("cardLiabilitySummary");if(cardEl){const groups=cardBillGroups().sort((a,b)=>a.date-b.date),byCard=new Map();for(const g of groups){const k=g.card.id;if(!byCard.has(k))byCard.set(k,[]);byCard.get(k).push(g);}cardEl.innerHTML=[...byCard].length?[...byCard].map(([id,gs])=>`<div class="v14-card-group"><strong>${esc(cardById(id)?.name||"カード")}</strong>${gs.map(g=>`<div class="list-row"><div><div class="list-meta">${toISODate(g.date)}・${g.confirmed?"請求確定":"予測"}・${g.itemIds?.length||0}件</div></div><strong>${yen.format(g.amount)}</strong></div>`).join("")}</div>`).join(""):"<p class='small'>未引落のカード利用はありません。</p>";}applyDashboardVisibility();renderCalendarDayDetail();};

const renderHomeV13ForV14=renderHome;renderHome=function(s){renderHomeV13ForV14(s);renderScenario();renderUncertainty();renderShortageSolver();applyDashboardVisibility();};

function calendarDayData(date){const actual=state.ledgerEntries.filter(e=>e.date===date&&isEntryActive(e)),events=collectEvents(parseISODate(date),parseISODate(date),state.forecastMode,0).filter(e=>e.source!=="ledger"),expense=actual.filter(e=>e.kind==="expense").reduce((n,e)=>n+e.amount,0),income=actual.filter(e=>e.kind==="income").reduce((n,e)=>n+e.amount,0),planned=events.reduce((n,e)=>n+e.amount,0);return{actual,events,expense,income,planned};}
function renderCalendarDayDetail(){const el=document.getElementById("v14CalendarDayDetail"),date=ensureV14().selectedCalendarDate;if(!el||!date)return;const d=calendarDayData(date),rows=[...d.actual.map(e=>({name:e.name,amount:e.kind==="income"?e.amount:-e.amount,type:"実績"})),...d.events.map(e=>({name:e.name,amount:e.amount,type:"予定"}))];el.innerHTML=`<h3>${date}</h3><div class="v14-kpi-grid"><div class="v14-kpi">実績支出<strong>${yen.format(d.expense)}</strong></div><div class="v14-kpi">実績収入<strong>${yen.format(d.income)}</strong></div><div class="v14-kpi">予定差引<strong>${yen.format(d.planned)}</strong></div></div><div class="v14-day-modal-list">${rows.length?rows.map(r=>`<div class="v14-day-modal-row"><span>${r.type}・${esc(r.name)}</span><strong class="${r.amount<0?"negative":"positive"}">${r.amount>=0?"＋":"－"}${yen.format(Math.abs(r.amount))}</strong></div>`).join(""):"<p class='small'>取引はありません。</p>"}</div>`;}
const renderCalendarV13ForV14=renderCalendar;renderCalendar=function(){renderCalendarV13ForV14();const y=calendarCursor.getFullYear(),m=calendarCursor.getMonth(),start=new Date(y,m,1),gridStart=addDays(start,-start.getDay()),days=[...document.querySelectorAll("#calendarGrid .day")];days.forEach((el,i)=>{const d=addDays(gridStart,i),date=toISODate(d),x=calendarDayData(date);el.dataset.date=date;const summary=document.createElement("div");summary.className="v14-calendar-total";summary.innerHTML=`${x.expense?`<span class="negative">実績 -${yen.format(x.expense)}</span><br>`:""}${x.planned?`予定 ${x.planned>=0?"+":"-"}${yen.format(Math.abs(x.planned))}`:""}`;el.appendChild(summary);el.tabIndex=0;el.setAttribute("role","button");el.onclick=()=>{ensureV14().selectedCalendarDate=date;renderCalendarDayDetail();};el.onkeydown=e=>{if(e.key==="Enter"||e.key===" "){e.preventDefault();el.click();}};});renderCalendarDayDetail();};

function renderV14Settings(){const v=ensureV14();const undo=document.getElementById("v14UndoStatus");if(undo)undo.textContent=v.undoStack.length?`直前：${v.undoStack[0].label}（${new Date(v.undoStack[0].createdAt).toLocaleString("ja-JP")}）・最大5操作`:`元に戻せる操作はありません。`;const subs=document.getElementById("v14SubcategoryList");if(subs)subs.innerHTML=Object.entries(v.subcategories).flatMap(([p,arr])=>(arr||[]).map(s=>`<div class="list-row"><div><strong>${esc(p)}</strong><div class="list-meta">${esc(s)}</div></div><div><button class="btn btn-small" data-action="v14-edit-subcategory:${encodeURIComponent(p)}|${encodeURIComponent(s)}" type="button">編集</button><button class="btn btn-small btn-danger" data-action="v14-delete-subcategory:${encodeURIComponent(p)}|${encodeURIComponent(s)}" type="button">削除</button></div></div>`)).join("")||"<p class='small'>サブカテゴリはありません。</p>";const rules=document.getElementById("v14MerchantRuleList");if(rules)rules.innerHTML=Object.entries(ensureV13().merchantRules).map(([k,r])=>`<div class="list-row"><div><strong>${esc(k)}</strong><div class="list-meta">${esc(r.category||"未指定")}・${esc(paymentMethodLabelV13(r.paymentMethod))}</div></div><div><button class="btn btn-small" data-action="v14-edit-merchant:${encodeURIComponent(k)}" type="button">編集</button><button class="btn btn-small btn-danger" data-action="v14-delete-merchant:${encodeURIComponent(k)}" type="button">削除</button></div></div>`).join("")||"<p class='small'>ルールはありません。</p>";const subList=document.getElementById("v14SubscriptionList");if(subList)subList.innerHTML=v.subscriptions.length?v.subscriptions.sort((a,b)=>a.nextDate.localeCompare(b.nextDate)).map(s=>`<div class="list-row"><div><strong>${esc(s.name)}</strong><div class="list-meta">${s.cycle==="annual"?"年額":"月額"} ${yen.format(s.amount)}・次回 ${s.nextDate}${s.freeUntil?`・無料終了 ${s.freeUntil}`:""}</div></div><div><button class="btn btn-small" data-action="v14-edit-subscription:${s.id}" type="button">編集</button><button class="btn btn-small btn-danger" data-action="v14-delete-subscription:${s.id}" type="button">削除</button></div></div>`).join(""):"<p class='small'>定期購読はありません。</p>";const close=document.getElementById("v14MonthCloseStatus"),mk=state.household.selectedMonth,c=v.monthlyCloses[mk];if(close)close.innerHTML=c?`<span class="pill ok">締め済み</span> ${new Date(c.closedAt).toLocaleString("ja-JP")}・残高${Object.keys(c.balances||{}).length}件`:`未締めです。`;const dash=document.getElementById("v14DashboardSettings");if(dash)dash.innerHTML=Object.entries(V14_DASHBOARD_METRICS).map(([id,label])=>`<label class="form-check"><input class="form-check-input" data-v14-dashboard="${id}" type="checkbox" ${v.dashboard.visible.includes(id)?"checked":""}><span class="form-check-label">${esc(label)}</span></label>`).join("");const upd=document.getElementById("v14UpdateStatus");if(upd)upd.textContent=v.update.available?"新しいバージョンを適用できます。":"現在のバージョン 0.8.8・更新未検出";}
const renderSettingsV13ForV14=renderSettings;renderSettings=function(){renderSettingsV13ForV14();renderV14Settings();};

/* ledger modal: subcategory + sale date + closed month protection + undo */
const openLedgerModalV13ForV14=openLedgerModal;openLedgerModal=function(entryId="",kind="expense",forcePayment=""){openLedgerModalV13ForV14(entryId,kind,forcePayment);const e=entryId?state.ledgerEntries.find(x=>x.id===entryId):null,m=e?entryV13(e):{},nameInput=document.getElementById("ledgerName"),details=document.querySelector("#modalBody details.advanced .form-grid");if(details){details.insertAdjacentHTML("beforeend",`<label>サブカテゴリ<select id="v14LedgerSubcategory"><option value="">なし</option></select></label><label>カード売上確定日<input id="v14LedgerSaleDate" type="date" value="${esc(m.saleDate||"")}"/></label>`);const cat=document.getElementById("ledgerCategory"),sub=document.getElementById("v14LedgerSubcategory");const update=()=>{const arr=ensureV14().subcategories[cat.value]||[];sub.innerHTML='<option value="">なし</option>'+arr.map(x=>`<option value="${esc(x)}" ${m.subcategory===x?"selected":""}>${esc(x)}</option>`).join("");};cat.addEventListener("change",update);update();}if(nameInput)nameInput.addEventListener("input",()=>{const n=normalizeText(nameInput.value),hit=Object.entries(ensureV13().merchantRules).find(([k])=>n.includes(normalizeText(k)));if(hit){const r=hit[1],cat=document.getElementById("ledgerCategory"),pm=document.getElementById("ledgerPayment");if(cat&&r.category)cat.value=r.category;if(pm&&r.paymentMethod){pm.value=r.paymentMethod;applyLedgerSourceUi();}}});const btn=document.getElementById("ledgerSave"),old=btn?.onclick;if(btn&&old)btn.onclick=()=>{const mk=document.getElementById("ledgerDate").value.slice(0,7);if(!confirmClosedMonth(mk))return;pushUndo(entryId?"取引の編集":"取引の追加");const sub=document.getElementById("v14LedgerSubcategory")?.value||"",sale=document.getElementById("v14LedgerSaleDate")?.value||"";old();const saved=entryId?state.ledgerEntries.find(x=>x.id===entryId):state.ledgerEntries.at(-1);if(saved){entryV13(saved).subcategory=sub;entryV13(saved).saleDate=isValidISODate(sale)?sale:"";}render();};};

/* actions */
const handleActionV13ForV14=handleAction;handleAction=function(action){const raw=String(action),[cmd,arg=""]=raw.split(":");if(cmd==="v14-undo")return undoLast();if(cmd==="v14-open-matches")return openMatchesModal();if(cmd==="v14-match"){const[source,entry]=arg.split("|");applyMatch(decodeURIComponent(source),entry);closeModal();return;}if(cmd==="v14-diagnose")return openDiagnostics();if(cmd==="v14-repair-diagnostics"){repairDiagnostics();closeModal();return;}if(cmd==="v14-import-csv")return openCsvImport();if(cmd==="v14-refund")return openRefundModal(arg);if(cmd==="v14-add-merchant-rule")return openMerchantRuleModal();if(cmd==="v14-edit-merchant")return openMerchantRuleModal(decodeURIComponent(arg));if(cmd==="v14-delete-merchant"){pushUndo("店名ルール削除");delete ensureV13().merchantRules[decodeURIComponent(arg)];return render();}if(cmd==="v14-add-subcategory")return openSubcategoryModal();if(cmd==="v14-edit-subcategory"){const[p,s]=arg.split("|").map(decodeURIComponent);return openSubcategoryModal(p,s);}if(cmd==="v14-delete-subcategory"){const[p,s]=arg.split("|").map(decodeURIComponent);pushUndo("サブカテゴリ削除");ensureV14().subcategories[p]=(ensureV14().subcategories[p]||[]).filter(x=>x!==s);return render();}if(cmd==="v14-add-subscription")return openSubscriptionModal();if(cmd==="v14-edit-subscription")return openSubscriptionModal(arg);if(cmd==="v14-delete-subscription"){pushUndo("定期購読削除");ensureV14().subscriptions=ensureV14().subscriptions.filter(x=>x.id!==arg);return render();}if(cmd==="v14-close-month")return closeSelectedMonth();if(cmd==="v14-reopen-month")return reopenSelectedMonth();if(cmd==="v14-run-scenario"){const v=ensureV14().scenario;v.expense=Math.max(0,intMoney(document.getElementById("v14ScenarioExpense").value));v.incomeReduction=Math.max(0,intMoney(document.getElementById("v14ScenarioIncomeReduction").value));v.salaryDelay=Math.max(0,Math.trunc(Number(document.getElementById("v14ScenarioSalaryDelay").value)||0));v.cardBuffer=Math.max(0,Number(document.getElementById("v14ScenarioCardBuffer").value)||0);v.loanPrepay=Math.max(0,intMoney(document.getElementById("v14ScenarioLoanPrepay").value));v.date=document.getElementById("v14ScenarioDate").value;saveState();return renderScenario();}if(cmd==="v14-reset-scenario"){ensureV14().scenario=defaultV14().scenario;return render();}if(cmd==="v14-export-encrypted")return exportEncrypted();if(cmd==="v14-import-encrypted")return document.getElementById("v14EncryptedFile").click();if(cmd==="v14-check-update")return checkForUpdate();if(["add-ledger-expense","add-ledger-income","add-card-expense"].includes(cmd)){const amount=Math.max(0,intMoney(document.getElementById("v14SheetAmount")?.value||0)),r=handleActionV13ForV14(action),input=document.getElementById("ledgerAmount");if(input&&amount){input.value=amount;input.dispatchEvent(new Event("input",{bubbles:true}));}return r;}if(cmd==="v14-quick-expense"||cmd==="v14-quick-income"||cmd==="v14-quick-card"){const amount=Math.max(0,intMoney(document.getElementById("v14QuickAmount").value));openLedgerModal("",cmd==="v14-quick-income"?"income":"expense",cmd==="v14-quick-card"?"credit":"");const input=document.getElementById("ledgerAmount");if(input){input.value=amount;input.dispatchEvent(new Event("input",{bubbles:true}));}return;}if(["delete-ledger","delete-account","delete-card","delete-card-topup","delete-transfer","delete-recurring","delete-financing","delete-oneoff"].includes(cmd))pushUndo("削除");return handleActionV13ForV14(action);};

/* update flow */
const UPDATE_MANIFEST_URL="./version.json";
let v14WaitingWorker=null,v14TargetVersion="",v14UpdateRequested=false,v14ControllerReloaded=false,v14UpdateCheckPromise=null;

async function fetchUpdateManifest(){
  const separator=UPDATE_MANIFEST_URL.includes("?")?"&":"?";
  const response=await fetch(`${UPDATE_MANIFEST_URL}${separator}t=${Date.now()}`,{cache:"no-store",headers:{"Cache-Control":"no-cache"}});
  if(!response.ok)throw new Error(`version.json ${response.status}`);
  const info=await response.json();
  if(!info||typeof info.version!=="string"||!info.version.trim())throw new Error("version.json invalid");
  return info;
}

function waitForWaitingWorker(reg,timeoutMs=12000){
  if(reg.waiting)return Promise.resolve(reg.waiting);
  return new Promise(resolve=>{
    let settled=false,timer=null;
    const finish=worker=>{if(settled)return;settled=true;if(timer)clearTimeout(timer);resolve(worker||reg.waiting||null);};
    const watch=worker=>{
      if(!worker)return;
      const check=()=>{if(worker.state==="installed")finish(reg.waiting||worker);else if(worker.state==="redundant")finish(null);};
      worker.addEventListener("statechange",check);
      check();
    };
    watch(reg.installing);
    const onUpdate=()=>watch(reg.installing);
    reg.addEventListener("updatefound",onUpdate,{once:true});
    timer=setTimeout(()=>finish(reg.waiting),timeoutMs);
  });
}

async function checkForUpdate(options={}){
  const silent=Boolean(options.silent);
  if(v14UpdateCheckPromise)return v14UpdateCheckPromise;
  v14UpdateCheckPromise=(async()=>{
    if(!("serviceWorker"in navigator)){if(!silent)showToast("この環境では更新確認できません");return false;}
    try{
      const [info,reg]=await Promise.all([fetchUpdateManifest(),navigator.serviceWorker.getRegistration()]);
      ensureV14().update.lastChecked=isoNow();
      v14TargetVersion=info.version;
      if(!reg){if(!silent)showToast("Service Worker未登録です");saveState();render();return false;}
      await reg.update();
      let worker=reg.waiting;
      if(!worker&&info.version!==APP_VERSION)worker=await waitForWaitingWorker(reg);
      if(worker){
        v14WaitingWorker=worker;
        ensureV14().update.available=true;
        showUpdateBanner(info.version);
        saveState();render();
        return true;
      }
      ensureV14().update.available=false;
      saveState();render();
      if(!silent)showToast(info.version===APP_VERSION?"現在のバージョンが最新です":"更新ファイルを準備中です。数秒後に再確認してください");
      return false;
    }catch(error){
      console.error("更新確認失敗",error);
      if(!silent)showToast("更新確認に失敗しました");
      return false;
    }finally{v14UpdateCheckPromise=null;}
  })();
  return v14UpdateCheckPromise;
}

function showUpdateBanner(targetVersion=v14TargetVersion){
  let el=document.getElementById("v14UpdateBanner");
  if(!el){el=document.createElement("div");el.id="v14UpdateBanner";el.className="v14-update-banner";document.body.appendChild(el);}
  const versionText=targetVersion?` ${esc(targetVersion)}`:"";
  el.innerHTML=`<strong>新しいバージョン${versionText}があります</strong><p class="small">今はまだ適用されません。「更新する」を押すと、更新前スナップショットを保存してから切り替えます。</p><div class="row-actions"><button class="btn btn-primary" id="v14ApplyUpdate" type="button">更新する</button><button class="btn" id="v14LaterUpdate" type="button">後で</button></div>`;
  document.getElementById("v14LaterUpdate").onclick=()=>el.remove();
  document.getElementById("v14ApplyUpdate").onclick=async event=>{
    const button=event.currentTarget;
    button.disabled=true;
    button.textContent="更新準備中…";
    createSnapshot(`PWA ${targetVersion||"新版"} 更新前`);
    createUpdateRecoveryPoint(`PWA ${targetVersion||"新版"}`);
    saveState();
    v14UpdateRequested=true;
    const reg=await navigator.serviceWorker.getRegistration();
    v14WaitingWorker=reg?.waiting||v14WaitingWorker;
    if(!v14WaitingWorker){
      await checkForUpdate({silent:false});
      v14WaitingWorker=(await navigator.serviceWorker.getRegistration())?.waiting||v14WaitingWorker;
    }
    if(v14WaitingWorker)v14WaitingWorker.postMessage({type:"SKIP_WAITING"});
    else{
      v14UpdateRequested=false;
      button.disabled=false;
      button.textContent="更新する";
      showToast("更新ファイルをまだ適用できません。再度お試しください");
    }
  };
}

if("serviceWorker"in navigator){
  navigator.serviceWorker.addEventListener("controllerchange",()=>{
    if(!v14UpdateRequested||v14ControllerReloaded)return;
    v14ControllerReloaded=true;
    location.reload();
  });
  navigator.serviceWorker.ready.then(reg=>{
    if(reg.waiting&&navigator.serviceWorker.controller){v14WaitingWorker=reg.waiting;ensureV14().update.available=true;showUpdateBanner(v14TargetVersion);}
    reg.addEventListener("updatefound",()=>{
      const worker=reg.installing;
      worker?.addEventListener("statechange",()=>{
        if(worker.state==="installed"&&navigator.serviceWorker.controller){v14WaitingWorker=reg.waiting||worker;ensureV14().update.available=true;showUpdateBanner(v14TargetVersion);saveState();render();}
      });
    });
    setTimeout(()=>checkForUpdate({silent:true}),1500);
  }).catch(()=>{});
  document.addEventListener("visibilitychange",()=>{
    if(document.visibilityState!=="visible")return;
    const last=ensureV14().update.lastChecked?new Date(ensureV14().update.lastChecked).getTime():0;
    if(!last||Date.now()-last>6*60*60*1000)checkForUpdate({silent:true});
  });
}

/* event bindings */
document.getElementById("v14EncryptedFile")?.addEventListener("change",e=>{const f=e.target.files?.[0];if(f)importEncryptedFile(f);e.target.value="";});
document.addEventListener("change",e=>{const x=e.target;if(x.dataset.v14Dashboard){const v=ensureV14(),id=x.dataset.v14Dashboard;if(x.checked){if(!v.dashboard.visible.includes(id))v.dashboard.visible.push(id);}else v.dashboard.visible=v.dashboard.visible.filter(k=>k!==id);applyDashboardVisibility();saveState();}});

document.addEventListener("change",e=>{if(e.target.matches(".editor-card [data-field]"))pushUndo("登録内容の変更");},true);document.addEventListener("click",e=>{if(["moveSave","cardSave","financingSave","quickSave","oneOffSave"].includes(e.target.id))pushUndo("登録内容の変更");},true);
ensureV14();
/* ===== end v1.4 extension ===== */



/* ===== v1.4.2 audit, reconciliation, import profiles and storage diagnostics ===== */
const V142_DEVICE_CHECKS={iphoneSafari:"iPhone Safariで通常起動",iphonePwa:"iPhoneのホーム画面追加後に起動",iphoneOffline:"iPhone PWAをオフラインで再起動",iphoneUpdate:"iPhoneで更新通知→承認更新",closeSave:"入力直後に閉じても保存維持",androidPwa:"Android PWAで起動・オフライン",osRetention:"OS更新後もデータ維持"};
function ensureV142(){const v=ensureV14();if(!Array.isArray(v.auditLog))v.auditLog=[];if(!Array.isArray(v.importProfiles))v.importProfiles=[];if(!v.cardReconciliations||typeof v.cardReconciliations!=="object")v.cardReconciliations={};if(!v.storageDiagnostic||typeof v.storageDiagnostic!=="object")v.storageDiagnostic={};if(!v.migrationTest||typeof v.migrationTest!=="object")v.migrationTest={};if(!v.deviceChecks||typeof v.deviceChecks!=="object")v.deviceChecks={};v.schema=Math.max(2,Number(v.schema)||1);v.auditLog=v.auditLog.slice(0,500);return v;}

function v142PlanFingerprint(){const v13=ensureV13();return JSON.stringify({recurring:state.recurring.map(x=>[x.id,x.name,x.kind,x.accountId,x.amount,x.day,x.active,x.confirmedByMonth]),oneOff:state.oneOff.map(x=>[x.id,x.name,x.accountId,x.amount,x.date,x.certainty]),financing:state.financing.map(x=>[x.id,x.name,x.accountId,x.principal,x.apr,x.paymentAmount,x.paymentDay,x.active]),cards:v13.cards.map(x=>[x.id,x.accountId,x.closingDay,x.paymentDay,x.paymentMonthOffset,x.mode,x.active,x.confirmedByMonth]),subscriptions:ensureV142().subscriptions.map(x=>[x.id,x.name,x.amount,x.cycle,x.nextDate,x.paymentMethod,x.accountId,x.cardId,x.active])});}
function v142FinancialSnapshot(){let balances={};try{balances=currentAssetBalances();}catch{}let card=0;try{card=cardLiabilityData(false).total;}catch{}return{balances,assets:Object.values(balances).reduce((n,x)=>n+intMoney(x),0),cardUnpaid:intMoney(card),loan:financingPrincipal(),ledgerCount:state.ledgerEntries.length,transferCount:state.transfers.length,topupCount:ensureV13().cardTopups.length,oneOffCount:state.oneOff.length,planFingerprint:v142PlanFingerprint()};}
function v142DiffSnapshot(before,after){const accounts=[];for(const id of new Set([...Object.keys(before.balances||{}),...Object.keys(after.balances||{})])){const a=intMoney(before.balances?.[id]),b=intMoney(after.balances?.[id]);if(a!==b)accounts.push({id,name:accountName(id),before:a,after:b,delta:b-a});}return{accounts,assets:after.assets-before.assets,cardUnpaid:after.cardUnpaid-before.cardUnpaid,loan:after.loan-before.loan,ledgerCount:after.ledgerCount-before.ledgerCount,transferCount:after.transferCount-before.transferCount,topupCount:after.topupCount-before.topupCount,oneOffCount:after.oneOffCount-before.oneOffCount,planChanged:before.planFingerprint!==after.planFingerprint};}
function v142HasFinancialDiff(d){return d.accounts.length||d.assets||d.cardUnpaid||d.loan||d.ledgerCount||d.transferCount||d.topupCount||d.oneOffCount||d.planChanged;}
let v142AuditPending=null,v142FocusedSnapshot=null;
function v142BeginAudit(label){if(!v142AuditPending)v142AuditPending={label:String(label||"操作"),createdAt:isoNow(),before:v142FinancialSnapshot()};}
function v142FinalizeAudit(){if(!v142AuditPending)return;const pending=v142AuditPending;v142AuditPending=null;const after=v142FinancialSnapshot(),diff=v142DiffSnapshot(pending.before,after);if(!v142HasFinancialDiff(diff))return;ensureV142().auditLog.unshift({id:uid(),label:pending.label,createdAt:isoNow(),diff,after});ensureV142().auditLog=ensureV142().auditLog.slice(0,500);}
const pushUndoV14ForV142=pushUndo;pushUndo=function(label){v142BeginAudit(label);return pushUndoV14ForV142(label);};
const undoLastV14ForV142=undoLast;undoLast=function(){const before=v142FinancialSnapshot();const r=undoLastV14ForV142();const after=v142FinancialSnapshot(),diff=v142DiffSnapshot(before,after);if(v142HasFinancialDiff(diff)){ensureV142().auditLog.unshift({id:uid(),label:"元に戻す",createdAt:isoNow(),diff,after});ensureV142().auditLog=ensureV142().auditLog.slice(0,500);}return r;};

document.addEventListener("focusin",e=>{if(e.target.matches?.(".editor-card [data-field],.editor-card [data-money]"))v142FocusedSnapshot=v142FinancialSnapshot();},true);
document.addEventListener("change",e=>{if(v142FocusedSnapshot&&e.target.matches?.(".editor-card [data-field],.editor-card [data-money]")){if(!v142AuditPending)v142AuditPending={label:"登録内容の変更",createdAt:isoNow(),before:v142FocusedSnapshot};v142FocusedSnapshot=null;}},true);
document.addEventListener("click",e=>{const el=e.target.closest?.("button,[data-action]");if(!el)return;const action=el.dataset?.action||"",cmd=action.split(":")[0],id=el.id||"";const ignored=/^(set-view|ledger-prev-page|ledger-next-page|close-|v14-check-update|v142-open-audit|v142-export-audit|v142-storage-diagnostic|v142-migration-test|v142-card-reconcile)$/.test(cmd);if(action&&!ignored)v142BeginAudit(el.textContent?.trim()||cmd);if(["ledgerSave","reconcileSave","cardConfirmSave","paidSave","moveSave","cardSave","financingSave","quickSave","oneOffSave","v14CsvCommit"].includes(id))v142BeginAudit(el.textContent?.trim()||"保存");},true);

function v142AuditDeltaText(diff){const parts=[];if(diff.assets)parts.push(`保有残高 ${diff.assets>0?"＋":"－"}${yen.format(Math.abs(diff.assets))}`);if(diff.cardUnpaid)parts.push(`カード未引落 ${diff.cardUnpaid>0?"＋":"－"}${yen.format(Math.abs(diff.cardUnpaid))}`);if(diff.loan)parts.push(`ローン ${diff.loan>0?"＋":"－"}${yen.format(Math.abs(diff.loan))}`);if(diff.ledgerCount)parts.push(`取引 ${diff.ledgerCount>0?"＋":""}${diff.ledgerCount}件`);if(diff.transferCount)parts.push(`振替 ${diff.transferCount>0?"＋":""}${diff.transferCount}件`);if(diff.topupCount)parts.push(`カードチャージ ${diff.topupCount>0?"＋":""}${diff.topupCount}件`);if(diff.planChanged)parts.push("将来予定・請求条件を変更");return parts.join("・")||"内訳変更";}
function openAuditLog(){const rows=ensureV142().auditLog;openModal("会計ログ",`<p class="small">直近500件まで端末内に保存します。ログは操作理由の追跡用で、残高計算には使いません。</p>${rows.length?rows.map(x=>`<div class="v142-log-row"><div><strong>${esc(x.label)}</strong><div class="list-meta">${new Date(x.createdAt).toLocaleString("ja-JP")}</div><div class="v142-log-detail">${esc(v142AuditDeltaText(x.diff))}</div>${x.diff.accounts?.map(a=>`<div class="v142-audit-account"><span>${esc(a.name)}</span><span>${yen.format(a.before)} → ${yen.format(a.after)}</span></div>`).join("")||""}</div><div class="v142-log-delta ${x.diff.assets<0?"negative":x.diff.assets>0?"positive":""}">${x.diff.assets?`${x.diff.assets>0?"＋":"－"}${yen.format(Math.abs(x.diff.assets))}`:"—"}</div></div>`).join(""):"<p>会計ログはありません。</p>"}`);}
function exportAuditCsv(){const rows=ensureV142().auditLog;if(!rows.length)return showToast("会計ログはありません");const q=v=>`"${String(v??"").replaceAll('"','""')}"`,body=[["日時","操作","保有残高差","カード未引落差","ローン差","取引件数差","保有先内訳"],...rows.map(x=>[x.createdAt,x.label,x.diff.assets,x.diff.cardUnpaid,x.diff.loan,x.diff.ledgerCount,(x.diff.accounts||[]).map(a=>`${a.name}:${a.before}->${a.after}`).join(" / ")])];downloadBlob(new Blob(["\ufeff"+body.map(r=>r.map(q).join(",")).join("\r\n")],{type:"text/csv;charset=utf-8"}),`zandaka-audit-${state.asOfDate}.csv`);}

function v142RawCardGroup(cardId,mk){const card=cardById(cardId);if(!card)return{items:[],amount:0};const items=creditItems(cardId,true).filter(x=>cardPaymentInfo(x.date,card).paymentMonth===mk);return{items,amount:items.reduce((n,x)=>n+intMoney(x.amount),0)};}
function v142CardMonths(card){const months=new Set(Object.keys(card.confirmedByMonth||{}));for(const x of creditItems(card.id,true))months.add(cardPaymentInfo(x.date,card).paymentMonth);for(const key of Object.keys(ensureV142().cardReconciliations))if(key.startsWith(card.id+"|"))months.add(key.split("|")[1]);if(!months.size)months.add(monthKey(addDays(parseISODate(state.asOfDate),32)));return[...months].sort();}
function openCardReconciliation(){const cards=ensureV13().cards.filter(c=>c.active);if(!cards.length)return showToast("カードを登録してください");openModal("カード請求を照合",`<div class="form-grid"><label>カード<select id="v142RecCard">${cards.map(c=>`<option value="${c.id}">${esc(c.name)}</option>`).join("")}</select></label><label>支払月<select id="v142RecMonth"></select></label></div><div id="v142RecBody"></div>`);const cardSel=document.getElementById("v142RecCard"),monthSel=document.getElementById("v142RecMonth");const fillMonths=()=>{const card=cardById(cardSel.value);monthSel.innerHTML=v142CardMonths(card).map(m=>`<option value="${m}">${m}</option>`).join("");renderBody();};const renderBody=()=>{const card=cardById(cardSel.value),mk=monthSel.value;if(!card||!mk)return;const raw=v142RawCardGroup(card.id,mk),key=`${card.id}|${mk}`,old=ensureV142().cardReconciliations[key]||{},confirmed=intMoney(old.confirmed,card.confirmedByMonth?.[mk]??raw.amount),fees=intMoney(old.fees),carry=intMoney(old.carry),points=intMoney(old.points),other=intMoney(old.other);document.getElementById("v142RecBody").innerHTML=`<div class="v142-status-grid" style="margin:12px 0"><div class="v142-status-box">登録明細合計<strong>${yen.format(raw.amount)}</strong></div><div class="v142-status-box">対象明細<strong>${raw.items.length}件</strong></div></div><div class="form-grid"><label>確定請求額<input id="v142RecConfirmed" data-money type="number" min="0" value="${confirmed}"/><div class="money-preview"></div></label><label>手数料<input id="v142RecFees" data-money type="number" value="${fees}"/><div class="money-preview"></div></label><label>前月繰越<input id="v142RecCarry" data-money type="number" value="${carry}"/><div class="money-preview"></div></label><label>ポイント・充当額<input id="v142RecPoints" data-money type="number" min="0" value="${points}"/><div class="money-preview"></div></label><label>その他調整<input id="v142RecOther" data-money type="number" value="${other}"/><div class="money-preview"></div></label><label>メモ<input id="v142RecNote" value="${esc(old.note||"")}" placeholder="未登録利用、返金など"/></label></div><div id="v142RecResult" class="alert" style="margin-top:10px"></div><details style="margin-top:10px"><summary>対象明細を見る</summary>${raw.items.length?raw.items.map(x=>`<div class="list-row"><div><strong>${esc(x.name)}</strong><div class="list-meta">${x.date}・${x.type==="refund"?"返金":x.type==="topup"?"カードチャージ":"利用"}</div></div><strong class="${x.amount<0?"positive":""}">${yen.format(x.amount)}</strong></div>`).join(""):"<p class='small'>対象明細はありません。</p>"}</details><button class="btn btn-primary" id="v142RecSave" type="button" style="margin-top:12px">照合結果を保存</button>`;bindMoneyPreviews();const update=()=>{const c=intMoney(document.getElementById("v142RecConfirmed").value),f=intMoney(document.getElementById("v142RecFees").value),ca=intMoney(document.getElementById("v142RecCarry").value),p=intMoney(document.getElementById("v142RecPoints").value),o=intMoney(document.getElementById("v142RecOther").value),calc=raw.amount+f+ca+o-p,diff=c-calc,el=document.getElementById("v142RecResult");el.className=`alert ${diff===0?"ok":"danger"}`;el.innerHTML=`計算値 <strong>${yen.format(calc)}</strong>／差額 <strong class="${diff===0?"v142-reconcile-ok":"v142-reconcile-diff"}">${yen.format(diff)}</strong>${diff?"<div class='small'>未登録利用、手数料、繰越、返金、ポイント充当を確認してください。</div>":"<div class='small'>登録内訳と確定請求額が一致しています。</div>"}`;};["v142RecConfirmed","v142RecFees","v142RecCarry","v142RecPoints","v142RecOther"].forEach(id=>document.getElementById(id).oninput=update);update();document.getElementById("v142RecSave").onclick=()=>{pushUndo("カード請求照合");const rec={cardId:card.id,paymentMonth:mk,detailAmount:raw.amount,confirmed:Math.max(0,intMoney(document.getElementById("v142RecConfirmed").value)),fees:intMoney(document.getElementById("v142RecFees").value),carry:intMoney(document.getElementById("v142RecCarry").value),points:Math.max(0,intMoney(document.getElementById("v142RecPoints").value)),other:intMoney(document.getElementById("v142RecOther").value),note:document.getElementById("v142RecNote").value.trim(),itemIds:raw.items.map(x=>x.id),updatedAt:isoNow()};rec.calculated=rec.detailAmount+rec.fees+rec.carry+rec.other-rec.points;rec.difference=rec.confirmed-rec.calculated;ensureV142().cardReconciliations[key]=rec;card.confirmedByMonth[mk]=rec.confirmed;card.lastConfirmedAt=isoNow();closeModal();render();showToast(rec.difference===0?"請求額が一致しました":"差額を保存しました");};};cardSel.onchange=fillMonths;monthSel.onchange=renderBody;fillMonths();}

let v142CsvFileMeta=null;
function v142HeaderSignature(headers){return headers.map(x=>normalizeText(x)).join("|");}
function v142ApplyImportProfile(p){if(!p)return;for(const[id,val]of [["v14CsvDate",p.dateIndex],["v14CsvName",p.nameIndex],["v14CsvAmount",p.amountIndex],["v14CsvSign",p.sign],["v14CsvPayment",p.payment]]){const el=document.getElementById(id);if(el&&[...el.options||[]].some(o=>String(o.value)===String(val)))el.value=String(val);}document.getElementById("v14CsvPayment")?.dispatchEvent(new Event("change"));setTimeout(()=>{const s=document.getElementById("v14CsvSource");if(s&&[...s.options].some(o=>o.value===p.sourceId))s.value=p.sourceId;},0);}
function v142SaveImportProfile(){const name=document.getElementById("v142ProfileName")?.value.trim();if(!name)return showToast("形式名を入力してください");const profile={id:uid(),name,headerSignature:v142CsvFileMeta?.signature||"",dateIndex:+document.getElementById("v14CsvDate").value,nameIndex:+document.getElementById("v14CsvName").value,amountIndex:+document.getElementById("v14CsvAmount").value,sign:document.getElementById("v14CsvSign").value,payment:document.getElementById("v14CsvPayment").value,sourceId:document.getElementById("v14CsvSource").value,updatedAt:isoNow()};const v=ensureV142(),old=v.importProfiles.find(x=>normalizeText(x.name)===normalizeText(name));if(old)profile.id=old.id;v.importProfiles=v.importProfiles.filter(x=>x.id!==profile.id);v.importProfiles.push(profile);saveState();const sel=document.getElementById("v142CsvProfile");if(sel){sel.innerHTML='<option value="">自動・未選択</option>'+v.importProfiles.map(x=>`<option value="${x.id}">${esc(x.name)}</option>`).join("");sel.value=profile.id;}showToast("CSV取込形式を保存しました");}
const openCsvImportV14ForV142=openCsvImport;openCsvImport=async function(){const file=document.getElementById("v14CsvFile")?.files?.[0];if(!file)return showToast("CSVファイルを選択してください");const text=await file.text(),rows=parseCsv(text);if(rows.length<2)return showToast("明細行を読み取れません");v14CsvRows=rows;const headers=rows[0],opts=headers.map((h,i)=>`<option value="${i}">${i+1}: ${esc(h||`列${i+1}`)}</option>`).join(""),v=ensureV142(),signature=v142HeaderSignature(headers),auto=v.importProfiles.find(p=>p.headerSignature===signature);v142CsvFileMeta={name:file.name,signature};openModal("CSV明細を取り込む",`<div class="form-grid"><label>保存済み形式<select id="v142CsvProfile"><option value="">自動・未選択</option>${v.importProfiles.map(p=>`<option value="${p.id}" ${auto?.id===p.id?"selected":""}>${esc(p.name)}</option>`).join("")}</select></label><label>形式名<input id="v142ProfileName" value="${esc(auto?.name||file.name.replace(/\.[^.]+$/,""))}"/></label><label>日付列<select id="v14CsvDate">${opts}</select></label><label>内容・店名列<select id="v14CsvName">${opts}</select></label><label>金額列<select id="v14CsvAmount">${opts}</select></label><label>入出金形式<select id="v14CsvSign"><option value="signed">支出がマイナス・収入がプラス</option><option value="expensePositive">支出を正の金額で記載</option></select></label><label>取込先<select id="v14CsvPayment"><option value="bank">銀行明細</option><option value="credit">カード明細</option><option value="emoney">電子マネー明細</option><option value="cash">現金記録</option></select></label><label>保有先・カード<select id="v14CsvSource"></select></label></div><label><input id="v14CsvSkipDuplicates" type="checkbox" checked style="width:auto;display:inline;margin-right:6px">重複候補を除外</label><div class="row-actions" style="margin-top:8px"><button class="btn" id="v142SaveProfile" type="button">この形式を保存</button></div><div id="v14CsvPreview" class="table-wrap" style="margin-top:10px"></div><button class="btn btn-primary" id="v14CsvCommit" type="button">取り込む</button>`);const dateSel=document.getElementById("v14CsvDate"),nameSel=document.getElementById("v14CsvName"),amountSel=document.getElementById("v14CsvAmount"),payment=document.getElementById("v14CsvPayment"),source=document.getElementById("v14CsvSource"),profileSel=document.getElementById("v142CsvProfile");const guess=(re,fallback)=>{const i=headers.findIndex(h=>re.test(String(h)));return i>=0?i:fallback;};dateSel.value=guess(/日付|利用日|取引日|date/i,0);nameSel.value=guess(/摘要|内容|店名|利用先|加盟店|description/i,Math.min(1,headers.length-1));amountSel.value=guess(/金額|利用額|支払額|amount/i,Math.min(2,headers.length-1));const updateSource=()=>{const old=source.value;source.innerHTML=payment.value==="credit"?cardOptions():accountOptionsByType("",payment.value==="cash"?["cash"]:payment.value==="emoney"?["emoney"]:["bank"]);if([...source.options].some(o=>o.value===old))source.value=old;};const preview=()=>{const di=+dateSel.value,ni=+nameSel.value,ai=+amountSel.value;document.getElementById("v14CsvPreview").innerHTML=`<table class="v14-table"><thead><tr><th>日付</th><th>内容</th><th>金額</th></tr></thead><tbody>${rows.slice(1,11).map(r=>`<tr><td>${esc(r[di]||"")}</td><td>${esc(r[ni]||"")}</td><td>${esc(r[ai]||"")}</td></tr>`).join("")}</tbody></table><p class="small">全${rows.length-1}行・先頭10行を表示</p>`;};payment.onchange=()=>{updateSource();preview();};[dateSel,nameSel,amountSel].forEach(x=>x.onchange=preview);profileSel.onchange=()=>{const p=v.importProfiles.find(x=>x.id===profileSel.value);if(p){document.getElementById("v142ProfileName").value=p.name;v142ApplyImportProfile(p);setTimeout(preview,0);}};updateSource();preview();if(auto)v142ApplyImportProfile(auto);document.getElementById("v142SaveProfile").onclick=v142SaveImportProfile;document.getElementById("v14CsvCommit").onclick=()=>commitCsvImport();};

function v142StateBytes(){return new TextEncoder().encode(JSON.stringify(state)).byteLength;}
async function runStorageDiagnostic(){const v=ensureV142(),start=performance.now(),json=JSON.stringify(state),serializeMs=performance.now()-start;let forecastMs=0,summaryMs=0;try{let t=performance.now();calculateSummary();summaryMs=performance.now()-t;t=performance.now();buildForecast();forecastMs=performance.now()-t;}catch{}let originUsage=null,originQuota=null,persisted=null;try{const est=await navigator.storage?.estimate?.();originUsage=est?.usage??null;originQuota=est?.quota??null;persisted=await navigator.storage?.persisted?.();}catch{}let localBytes=0;try{for(let i=0;i<localStorage.length;i++){const k=localStorage.key(i),val=localStorage.getItem(k)||"";localBytes+=new TextEncoder().encode(k+val).byteLength;}}catch{}v.storageDiagnostic={ranAt:isoNow(),stateBytes:new TextEncoder().encode(json).byteLength,localBytes,originUsage,originQuota,persisted,serializeMs,summaryMs,forecastMs,counts:{accounts:state.accounts.length,ledger:state.ledgerEntries.length,cards:ensureV13().cards.length,topups:ensureV13().cardTopups.length,recurring:state.recurring.length,oneOff:state.oneOff.length,snapshots:ensureV13().snapshots.length,audit:v.auditLog.length}};saveState();render();showToast("保存状況を計測しました");return v.storageDiagnostic;}
function v142MigrationFixtureTests(){const original=state,results=[];const check=(name,ok,detail="")=>results.push({name,ok:Boolean(ok),detail});try{let s=sanitizeState({asOfDate:"2026-07-19",currentBalance:123456,minimumBuffer:12000,incomeAmount:200000,incomeDay:25,recurring:[{name:"家賃",amount:60000,day:27}],financing:[{name:"ローン",principal:100000,apr:10,paymentAmount:10000,paymentDay:5}],oneOff:[{name:"臨時",amount:-5000,date:"2026-07-20"}]});state=s;ensureV142();check("旧v3残高",state.accounts[0].balance===123456);check("旧v3維持残高",state.accounts[0].buffer===12000);check("旧v3定期取引",state.recurring.length===2,`${state.recurring.length}件`);check("旧v3ローン・臨時",state.financing.length===1&&state.oneOff.length===1);
const base=wizardTemplateState();const a1=base.accounts[0].id,a2=uid();s=sanitizeState({...base,version:4,accounts:[{id:a1,name:"銀行",balance:50000,buffer:1000,active:true},{id:a2,name:"財布",balance:7000,buffer:0,active:true}],defaultAccountId:a1,ledgerEntries:[{id:"e4",name:"食費",kind:"expense",amount:1200,category:"食費",date:"2026-07-19",accountId:a2,paymentMethod:"cash",affectsBalance:false}]});state=s;ensureV142();check("v4保有先",state.accounts.length===2);check("v4家計簿",state.ledgerEntries.length===1&&state.ledgerEntries[0].amount===1200);check("v4既定保有先",state.defaultAccountId===a1);
const cur=deepClone(original),beforeLedger=cur.ledgerEntries.length,beforeAccounts=cur.accounts.length,beforeAmount=cur.ledgerEntries.reduce((n,e)=>n+intMoney(e.amount),0);s=sanitizeState(cur);state=s;ensureV142();check("現行データ件数",state.ledgerEntries.length===beforeLedger&&state.accounts.length===beforeAccounts);check("現行取引金額合計",state.ledgerEntries.reduce((n,e)=>n+intMoney(e.amount),0)===beforeAmount);check("既存データ互換拡張初期化",Array.isArray(ensureV142().auditLog)&&Array.isArray(ensureV142().importProfiles)&&ensureV142().schema>=2);check("保存JSON再読込",sanitizeState(JSON.parse(JSON.stringify(state))).ledgerEntries.length===state.ledgerEntries.length);
}finally{state=original;}return results;}
function runMigrationTests(){const results=v142MigrationFixtureTests(),pass=results.filter(x=>x.ok).length;ensureV142().migrationTest={ranAt:isoNow(),pass,total:results.length,results};saveState();render();openModal("保存データ移行試験",`<div class="alert ${pass===results.length?"ok":"danger"}">${pass}/${results.length} 合格</div>${results.map(x=>`<div class="list-row"><div><strong class="${x.ok?"v142-test-pass":"v142-test-fail"}">${x.ok?"PASS":"FAIL"} ${esc(x.name)}</strong>${x.detail?`<div class="list-meta">${esc(x.detail)}</div>`:""}</div></div>`).join("")}`);}

function renderV142Settings(){const v=ensureV142(),audit=document.getElementById("v142AuditSummary");if(audit)audit.innerHTML=v.auditLog.length?`記録 ${v.auditLog.length}件・最新 ${new Date(v.auditLog[0].createdAt).toLocaleString("ja-JP")}<br>${esc(v142AuditDeltaText(v.auditLog[0].diff))}`:"会計ログはまだありません。";const rec=document.getElementById("v142CardReconcileList");if(rec){const rows=Object.values(v.cardReconciliations).sort((a,b)=>String(b.updatedAt).localeCompare(String(a.updatedAt))).slice(0,5);rec.innerHTML=rows.length?rows.map(x=>`<div class="list-row"><div><strong>${esc(cardById(x.cardId)?.name||"カード")} ${esc(x.paymentMonth)}</strong><div class="list-meta">確定 ${yen.format(x.confirmed)}・明細 ${yen.format(x.detailAmount)}・差額 <span class="${x.difference===0?"v142-reconcile-ok":"v142-reconcile-diff"}">${yen.format(x.difference)}</span></div></div></div>`).join(""):"照合結果はありません。";}const profiles=document.getElementById("v142ImportProfileList");if(profiles)profiles.innerHTML=v.importProfiles.length?v.importProfiles.map(p=>`<div class="v142-profile-row"><div><strong>${esc(p.name)}</strong><div class="list-meta">${esc(({bank:"銀行",credit:"カード",emoney:"電子マネー",cash:"現金"})[p.payment]||p.payment)}・列 ${p.dateIndex+1}/${p.nameIndex+1}/${p.amountIndex+1}</div></div><button class="btn btn-small btn-danger" data-action="v142-delete-profile:${p.id}" type="button">削除</button></div>`).join(""):"<p class='small'>保存済み形式はありません。CSV取込画面から保存できます。</p>";const st=document.getElementById("v142StorageStatus"),d=v.storageDiagnostic;if(st)st.innerHTML=d.ranAt?`<div class="v142-status-grid"><div class="v142-status-box">アプリデータ<strong>${(d.stateBytes/1024).toFixed(1)} KB</strong></div><div class="v142-status-box">家計簿<strong>${d.counts.ledger}件</strong></div><div class="v142-status-box">保存変換<strong>${d.serializeMs.toFixed(1)} ms</strong></div><div class="v142-status-box">予報計算<strong>${d.forecastMs.toFixed(1)} ms</strong></div></div><p class="small" style="margin-top:8px">計測 ${new Date(d.ranAt).toLocaleString("ja-JP")}${d.originQuota?`・オリジン使用 ${(d.originUsage/1024/1024).toFixed(1)} / ${(d.originQuota/1024/1024).toFixed(1)} MB`:""}${d.persisted===true?"・永続保存許可済み":d.persisted===false?"・永続保存未許可":""}</p>`:"未計測です。";const checklist=document.getElementById("v142DeviceChecklist");if(checklist)checklist.innerHTML=Object.entries(V142_DEVICE_CHECKS).map(([id,label])=>`<label><input type="checkbox" data-v142-device="${id}" ${v.deviceChecks[id]?.checked?"checked":""}><span>${esc(label)}${v.deviceChecks[id]?.checkedAt?`<span class="list-meta" style="display:block">${new Date(v.deviceChecks[id].checkedAt).toLocaleString("ja-JP")}</span>`:""}</span></label>`).join("");}
const renderV14SettingsForV142=renderV14Settings;renderV14Settings=function(){renderV14SettingsForV142();renderV142Settings();};
const renderV14ForV142=render;render=function(){v142FinalizeAudit();const r=renderV14ForV142();return r;};

const handleActionV14ForV142=handleAction;handleAction=function(action){const raw=String(action),[cmd,arg=""]=raw.split(":");if(cmd==="v142-open-audit")return openAuditLog();if(cmd==="v142-export-audit")return exportAuditCsv();if(cmd==="v142-clear-audit"){if(confirm("会計ログを消去しますか？残高や取引は消えません。")){ensureV142().auditLog=[];render();}return;}if(cmd==="v142-card-reconcile")return openCardReconciliation();if(cmd==="v142-delete-profile"){ensureV142().importProfiles=ensureV142().importProfiles.filter(x=>x.id!==arg);return render();}if(cmd==="v142-storage-diagnostic")return runStorageDiagnostic();if(cmd==="v142-migration-test")return runMigrationTests();return handleActionV14ForV142(action);};
document.addEventListener("change",e=>{const id=e.target.dataset?.v142Device;if(!id)return;ensureV142().deviceChecks[id]={checked:e.target.checked,checkedAt:e.target.checked?isoNow():""};saveState();renderV142Settings();});
ensureV142();
/* ===== end v1.4.2 extension ===== */

/* ===== v0.8.2 transaction validation and duplicate prevention ===== */
function zyNormalizeLedgerName(value){return String(value||"").normalize("NFKC").toLowerCase().replace(/[\s\u3000・･,，.。\-ー_\/\\()（）\[\]【】]/g,"");}
function zyDateDistanceDays(a,b){if(!isValidISODate(a)||!isValidISODate(b))return Infinity;return Math.abs(Math.round((parseISODate(a)-parseISODate(b))/86400000));}
function zyLedgerSourceKey(entry){const meta=entryV13(entry);return meta.paymentMethod==="credit"?`card:${meta.cardId||""}`:`account:${entry.accountId||""}`;}
function detectLedgerDuplicates(candidate,excludeId=""){
  const normalized=zyNormalizeLedgerName(candidate.name),source=zyLedgerSourceKey(candidate);
  return state.ledgerEntries.filter(x=>x.id!==excludeId&&isEntryActive(x)&&x.kind===candidate.kind&&intMoney(x.amount)===intMoney(candidate.amount)&&zyDateDistanceDays(x.date,candidate.date)<=1&&zyLedgerSourceKey(x)===source).map(x=>{
    const xn=zyNormalizeLedgerName(x.name),sameName=normalized&&xn===normalized,similarName=normalized&&xn&&(normalized.includes(xn)||xn.includes(normalized));
    return {...x,duplicateScore:(sameName?3:similarName?2:0)+(x.date===candidate.date?2:1)};
  }).filter(x=>x.duplicateScore>=3).sort((a,b)=>b.duplicateScore-a.duplicateScore);
}
function zyValidateLedgerDraft(){
  const amount=Math.max(0,intMoney(document.getElementById("ledgerAmount")?.value)),name=String(document.getElementById("ledgerName")?.value||"").trim(),date=document.getElementById("ledgerDate")?.value||"",kind=document.getElementById("ledgerKind")?.value||"expense",pm=document.getElementById("ledgerPayment")?.value||"debit",source=document.getElementById("ledgerSource")?.value||"";
  const errors=[];
  if(amount<=0)errors.push("金額は1円以上で入力してください。");
  if(!name)errors.push("内容・店名を入力してください。");
  if(!isValidISODate(date))errors.push("正しい日付を入力してください。");
  if(!["expense","income","settlement"].includes(kind))errors.push("取引区分が不正です。");
  if(pm==="credit"&&!cardById(source))errors.push("支払元カードを選択してください。");
  if(pm!=="credit"&&!state.accounts.some(a=>a.id===source&&a.active!==false))errors.push("有効な支払元口座を選択してください。");
  return{errors,amount,name,date,kind,pm,source};
}
const openLedgerModalV082=openLedgerModal;
openLedgerModal=function(entryId="",kind="expense",forcePayment=""){
  openLedgerModalV082(entryId,kind,forcePayment);
  const btn=document.getElementById("ledgerSave"),old=btn?.onclick;
  if(!btn||!old)return;
  const note=document.createElement("div");note.id="zyLedgerQualityNote";note.className="inline-note";note.style.marginTop="10px";note.textContent="金額・日付・内容・支払元を検証し、重複候補がある場合は保存前に確認します。";btn.before(note);
  btn.onclick=()=>{
    const draft=zyValidateLedgerDraft();
    if(draft.errors.length){note.className="alert danger";note.innerHTML=draft.errors.map(esc).join("<br>");return;}
    const basePm=Object.prototype.hasOwnProperty.call(HOUSEHOLD_PAYMENT_METHODS,draft.pm)?draft.pm:"other";
    const candidate=sanitizeLedgerEntry({id:entryId||"preview",kind:draft.kind,amount:draft.amount,date:draft.date,name:draft.name,category:document.getElementById("ledgerCategory")?.value||"その他",paymentMethod:basePm,accountId:draft.pm==="credit"?(cardById(draft.source)?.accountId||state.defaultAccountId):draft.source,affectsBalance:draft.pm!=="credit"&&Boolean(document.getElementById("ledgerAffects")?.checked),note:document.getElementById("ledgerNote")?.value||""});
    ensureV13().entryMeta[candidate.id]={paymentMethod:draft.pm,cardId:draft.pm==="credit"?draft.source:""};
    const hits=detectLedgerDuplicates(candidate,entryId);
    delete ensureV13().entryMeta[candidate.id];
    if(hits.length){
      const details=hits.slice(0,3).map(x=>`${x.date} ${x.name} ${yen.format(x.amount)}`).join("\n");
      if(!confirm(`重複の可能性がある取引が${hits.length}件あります。\n\n${details}\n\nそれでも保存しますか？`))return;
    }
    note.className="inline-note";note.textContent="検証済み。保存します。";
    old();
  };
};
/* ===== end v0.8.2 extension ===== */


window.__ZY_TEST__ = {
  APP_VERSION,
  runSelfTests,
  calculateSummary,
  buildForecast,
  safeSpendForAccount,
  japaneseHolidaySet,
  householdSummary,
  getState: () => deepClone(state),
  setState: (value) => {
    state = sanitizeState(value);
    render();
  },
  evaluateState: (value, fn = "summary") => {
    const original = state;
    state = sanitizeState(value);
    try {
      return deepClone(
        fn === "forecast" ? buildForecast() : fn === "household" ? householdSummary() : calculateSummary(),
      );
    } finally {
      state = original;
    }
  },
  storageAvailable: () => storageAvailable,
  totalAssets,
  cardLiabilityData,
  cardBillGroups,
  cardPaymentInfo,
  categoryBudgetAvailable,
  filteredLedgerEntries,
  getV13: () => deepClone(ensureV13()),
  getV14: () => deepClone(ensureV14()),
  diagnostics, matchSuggestions, parseCsv, subscriptionEvents, scenarioForecast, refundTotals,
  getV142: () => deepClone(ensureV142()), v142MigrationFixtureTests, v142RawCardGroup, v142FinancialSnapshot,
  detectLedgerDuplicates, zyValidateLedgerDraft,
};
if (location.hash === "#selftest") {
  const r = runSelfTests();
  const el = document.getElementById("selfTestOutput");
  el.classList.remove("hidden");
  el.textContent = r.join("\n");
  document.body.dataset.selftest = r.every((x) => x.startsWith("PASS"))
    ? "pass"
    : "fail";
}
bindChartInteraction();
(async function bootstrapApp(){
  await restoreAndroidNativeBackupIfNeeded();
  try { await navigator.storage?.persist?.(); } catch {}
  setView(state.activeView || "household");
  render();
  if (stateLoadStatus.recovered) {
    showToast("保存データを復元コピーから回復しました");
  } else if (automaticSaveBlocked) {
    showFatal(new Error("保存データを読み込めなかったため、空データでの上書きを停止しました。バックアップまたは復元コピーを確認してください。"));
    return;
  }
  if (!state.setupComplete) openWizard(true);
})();
