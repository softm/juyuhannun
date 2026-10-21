import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizePriceDate,planNationwideCollection} from '../server/nationwide-policy.mjs';

const plan=(at,extra={})=>planNationwideCollection({now:Date.parse(at),hasPrices:true,sourceDate:'2026-10-20',fetchedAt:'2026-10-21T00:49:00+09:00',lastDownloadAttemptAt:'2026-10-21T00:49:00+09:00',lastDownloadStatus:'fallback',...extra});
test('the daily window compares the source date even when the collection day matches',()=>{
 const before=plan('2026-10-21T19:17:00+09:00');assert.equal(before.due,false);assert.equal(before.expectedDate,'2026-10-20');assert.equal(before.nextRetryAt,'2026-10-21T11:37:00.000Z');
 const evening=plan('2026-10-21T20:37:00+09:00');assert.equal(evening.due,true);assert.equal(evening.reason,'source_date_behind');assert.equal(evening.expectedDate,'2026-10-21');
});
test('midnight invalidates two-day-old prices and opens a new attempt despite a recent previous-day fallback',()=>{
 const current=plan('2026-10-22T00:37:00+09:00',{fetchedAt:'2026-10-21T23:40:00+09:00',lastDownloadAttemptAt:'2026-10-21T23:40:00+09:00'});
 assert.equal(current.due,true);assert.equal(current.eligible,false);assert.equal(current.expectedDate,'2026-10-21');assert.equal(current.reason,'expired_prices');
});
test('failed refreshes respect two-hour retry spacing and explicit force overrides it',()=>{
 const extra={lastDownloadAttemptAt:'2026-10-21T20:40:00+09:00',lastDownloadStatus:'error'};
 const waiting=plan('2026-10-21T21:00:00+09:00',extra);assert.equal(waiting.due,false);assert.equal(waiting.reason,'retry_backoff');assert.equal(waiting.nextRetryAt,'2026-10-21T13:40:00.000Z');
 assert.equal(plan('2026-10-21T22:40:00+09:00',extra).due,true);
 assert.equal(plan('2026-10-21T21:00:00+09:00',{...extra,forceRefresh:true}).due,true);
});
test('the evening window can retry an earlier failure without waiting until tomorrow',()=>{
 const current=plan('2026-10-21T20:37:00+09:00',{lastDownloadAttemptAt:'2026-10-21T19:17:00+09:00',lastDownloadStatus:'error'});
 assert.equal(current.due,true);
});
test('a previous-day source with a recent genuine download remains valid before the next window',()=>{
 const current=plan('2026-10-22T00:37:00+09:00',{sourceDate:'2026-10-21',fetchedAt:'2026-10-21T22:00:00+09:00',lastDownloadAttemptAt:'2026-10-21T22:00:00+09:00',lastDownloadStatus:'ready'});
 assert.equal(current.due,false);assert.equal(current.eligible,true);assert.equal(current.usedPreviousDate,true);
 assert.equal(current.nextRetryAt,'2026-10-22T11:37:00.000Z');
});
test('age and date validation prevent malformed, future, or indefinitely cached observations',()=>{
 assert.equal(normalizePriceDate('20260230'),null);assert.equal(normalizePriceDate('20261021'),'2026-10-21');
 assert.equal(plan('2026-10-21T12:00:00+09:00',{sourceDate:'2026-10-22'}).due,true);
 assert.equal(plan('2026-10-21T12:00:00+09:00',{fetchedAt:null}).due,true);
 const old=plan('2026-10-21T12:00:00+09:00',{fetchedAt:'2026-10-20T10:00:00+09:00',lastDownloadAttemptAt:'2026-10-20T10:00:00+09:00'});
 assert.equal(old.due,true);assert.equal(old.reason,'refresh_age_reached');
});
