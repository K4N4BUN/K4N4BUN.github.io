"use strict";
(function initZYCore(global) {
  function deepClone(value) {
    return typeof structuredClone === "function"
      ? structuredClone(value)
      : JSON.parse(JSON.stringify(value));
  }
  const yen = new Intl.NumberFormat("ja-JP", {
    style: "currency", currency: "JPY", maximumFractionDigits: 0,
  });
  const dateFmt = new Intl.DateTimeFormat("ja-JP", {
    month: "numeric", day: "numeric", weekday: "short",
  });
  const fullDateFmt = new Intl.DateTimeFormat("ja-JP", {
    year: "numeric", month: "long", day: "numeric", weekday: "short",
  });
  function uid() {
    return global.crypto?.randomUUID
      ? global.crypto.randomUUID()
      : Math.random().toString(36).slice(2) + Date.now().toString(36);
  }
  function toISODate(d) {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  }
  function todayISO() {
    const d = new Date();
    return toISODate(new Date(d.getFullYear(), d.getMonth(), d.getDate()));
  }
  function parseISODate(v) {
    const [y, m, d] = String(v).split("-").map(Number);
    return new Date(y, m - 1, d);
  }
  function isValidISODate(v) {
    if (typeof v !== "string" || !/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(v)) return false;
    const d = parseISODate(v);
    return Number.isFinite(d.getTime()) && toISODate(d) === v;
  }
  function addDays(d, n) {
    const x = new Date(d);
    x.setDate(x.getDate() + Number(n || 0));
    return x;
  }
  const compareDates = (a, b) => a.getTime() - b.getTime();
  const sameDate = (a, b) => toISODate(a) === toISODate(b);
  const monthKey = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
  const daysBetween = (a, b) => Math.max(0, Math.round((b - a) / 86400000));
  function intMoney(v, f = 0) { const n = Number(v); return Number.isFinite(n) ? Math.round(n) : f; }
  function num(v, f = 0) { const n = Number(v); return Number.isFinite(n) ? n : f; }
  function clampDay(y, m, d) {
    return Math.max(1, Math.min(Math.trunc(Number(d)) || 1, new Date(y, m + 1, 0).getDate()));
  }
  function esc(v) {
    return String(v ?? "").replace(/[&<>'"]/g, (c) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;",
    })[c]);
  }
  const isoNow = () => new Date().toISOString();
  function ageDays(iso) {
    if (!iso) return 9999;
    return Math.floor((Date.now() - new Date(iso).getTime()) / 86400000);
  }
  global.ZYCore = Object.freeze({
    deepClone, yen, dateFmt, fullDateFmt, uid, toISODate, todayISO, parseISODate,
    isValidISODate, addDays, compareDates, sameDate, monthKey, daysBetween,
    intMoney, num, clampDay, esc, isoNow, ageDays,
  });
})(window);
