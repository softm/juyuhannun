import test from 'node:test';
import assert from 'node:assert/strict';
import {favoriteIds,mergeFavoriteSnapshots,normalizeFavoriteSnapshot,toggleFavoriteSnapshot} from '../public/js/favorite-sync.js';

test('legacy favorite ids migrate into a versioned snapshot',()=>{
 const value=normalizeFavoriteSnapshot(null,['A','B','bad id'],'2026-11-17T00:00:00.000Z');
 assert.deepEqual(favoriteIds(value),['A','B']);
});

test('newer deletion wins while newer favorite restores a station',()=>{
 const first={version:1,items:[{id:'A',updatedAt:'2026-11-17T01:00:00.000Z'}],tombstones:[]};
 const deleted=toggleFavoriteSnapshot(first,'A','2026-11-17T02:00:00.000Z');
 assert.deepEqual(favoriteIds(mergeFavoriteSnapshots(first,deleted)),[]);
 const restored=toggleFavoriteSnapshot(deleted,'A','2026-11-17T03:00:00.000Z');
 assert.deepEqual(favoriteIds(mergeFavoriteSnapshots(deleted,restored)),['A']);
});

test('merge keeps favorites from both devices',()=>{
 const left=normalizeFavoriteSnapshot(null,['A'],'2026-11-17T01:00:00.000Z');
 const right=normalizeFavoriteSnapshot(null,['B'],'2026-11-17T01:00:01.000Z');
 assert.deepEqual(new Set(favoriteIds(mergeFavoriteSnapshots(left,right))),new Set(['A','B']));
});
