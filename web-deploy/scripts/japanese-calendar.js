"use strict";
(function initZYCalendar(global) {
  const { toISODate, parseISODate, addDays } = global.ZYCore;
  function nthWeekday(y, m, w, n) {
    const first = new Date(y, m, 1);
    const delta = (w - first.getDay() + 7) % 7;
    return new Date(y, m, 1 + delta + 7 * (n - 1));
  }
  function springEquinoxDay(y) {
    return Math.floor(20.8431 + 0.242194 * (y - 1980) - Math.floor((y - 1980) / 4));
  }
  function autumnEquinoxDay(y) {
    return Math.floor(23.2488 + 0.242194 * (y - 1980) - Math.floor((y - 1980) / 4));
  }
  const holidayCache = new Map();
  function japaneseHolidaySet(y) {
    if (holidayCache.has(y)) return holidayCache.get(y);
    const set = new Set();
    const add = (m, d) => set.add(toISODate(new Date(y, m - 1, d)));
    if (y === 2020) {
      [[1,1],[1,13],[2,11],[2,23],[3,20],[4,29],[5,3],[5,4],[5,5],[7,23],[7,24],[8,10],[9,21],[9,22],[11,3],[11,23]].forEach((x)=>add(...x));
    } else if (y === 2021) {
      [[1,1],[1,11],[2,11],[2,23],[3,20],[4,29],[5,3],[5,4],[5,5],[7,22],[7,23],[8,8],[9,20],[9,23],[11,3],[11,23]].forEach((x)=>add(...x));
    } else {
      add(1,1); set.add(toISODate(nthWeekday(y,0,1,2))); add(2,11);
      if (y >= 2020) add(2,23);
      add(3,springEquinoxDay(y)); add(4,29); add(5,3); add(5,4); add(5,5);
      set.add(toISODate(nthWeekday(y,6,1,3)));
      if (y >= 2016) add(8,11);
      set.add(toISODate(nthWeekday(y,8,1,3))); add(9,autumnEquinoxDay(y));
      set.add(toISODate(nthWeekday(y,9,1,2))); add(11,3); add(11,23);
      if (y >= 1989 && y <= 2018) add(12,23);
    }
    if (y === 2019) { add(4,30); add(5,1); add(5,2); add(10,22); }
    for (let i=1; i<=366; i++) {
      const d=new Date(y,0,i); if (d.getFullYear()!==y) break;
      const k=toISODate(d); if (set.has(k)||d.getDay()===0) continue;
      if (set.has(toISODate(addDays(d,-1))) && set.has(toISODate(addDays(d,1)))) set.add(k);
    }
    for (const k of [...set].sort()) {
      const d=parseISODate(k); if (d.getDay()!==0) continue;
      let c=addDays(d,1); while (set.has(toISODate(c))) c=addDays(c,1); set.add(toISODate(c));
    }
    holidayCache.set(y,set);
    return set;
  }
  global.ZYCalendar = Object.freeze({ japaneseHolidaySet });
})(window);
