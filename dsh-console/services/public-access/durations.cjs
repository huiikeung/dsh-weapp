'use strict';
const DAY = 86400000;
// Explicit fixed-day semantics shared by the server, connector and gateway extension.
const DURATIONS = Object.freeze([{ days: 3, label: '3 天' }, { days: 7, label: '7 天' }, { days: 30, label: '30 天' }, { days: 180, label: '半年（180 天）' }, { days: 365, label: '1 年（365 天）' }]);
const validDays = value => Number.isSafeInteger(value) && DURATIONS.some(item => item.days === value);
module.exports = { DAY, DURATIONS, validDays };
