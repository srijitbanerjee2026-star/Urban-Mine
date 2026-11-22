import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { freshDb } from './helpers.ts';
import { seedDemo } from '../src/demo.ts';
import { LocalPhotoStore } from '../src/photostore.ts';
import { buildApp } from '../src/app.ts';

async function setup() {
  const db = await freshDb({ demo: false });
  const dir = mkdtempSync(join(tmpdir(), 'um-'));
  const photos = new LocalPhotoStore(dir, 'test-secret');
  await seedDemo(db, new Date(), photos);
  const app = await buildApp(db, { photos, uploadsDir: dir, ocr: { read: async () => '' } });
  return { app, db, h: { 'x-user-id': 'u-repairer-1' } };
}

test('repairer dashboard data: history with dates and notes, one job still in progress', async () => {
  const { app, h } = await setup();
  const mine = (await app.inject({ url: '/api/repair/mine', headers: h })).json();
  assert.equal(mine.listing.verified_count, 2);
  const done = mine.jobs.filter((j: any) => j.status === 'completed');
  const open = mine.jobs.filter((j: any) => j.status === 'in_progress');
  assert.equal(done.length, 2);
  assert.equal(open.length, 1);
  assert.ok(done.every((j: any) => j.note && j.created_at && j.completed_at && j.after_photo));
  assert.equal(open[0].after_photo, null);
  await app.close();
});

test('a new job keeps its note; completing it needs an after photo and raises the count once', async () => {
  const { app, h } = await setup();
  const job = (await app.inject({ method: 'POST', url: '/api/repair/jobs', headers: h, payload: { before_photo: 'b1', note: '  Router reset  ', gear: ['glasses', 'gloves', 'unplugged', 'battery_tray'] } })).json();
  let mine = (await app.inject({ url: '/api/repair/mine', headers: h })).json();
  assert.equal(mine.jobs.find((j: any) => j.id === job.id).note, 'Router reset');
  assert.equal((await app.inject({ method: 'POST', url: `/api/repair/jobs/${job.id}/complete`, headers: h, payload: {} })).statusCode, 400);
  assert.equal((await app.inject({ method: 'POST', url: `/api/repair/jobs/${job.id}/complete`, headers: h, payload: { after_photo: 'a1' } })).statusCode, 200);
  mine = (await app.inject({ url: '/api/repair/mine', headers: h })).json();
  assert.equal(mine.listing.verified_count, 3);
  await app.close();
});

test('a job needs the safety checklist, then records during photos, steps and a diary', async () => {
  const { app, db } = await setup();
  const h = { 'x-user-id': 'u-repairer-1' };
  const start = (gear: string[]) => app.inject({ method: 'POST', url: '/api/repair/jobs', headers: h, payload: { before_photo: 'b9', gear, guide_id: 'rg-phone-screen', device_type: 'phone' } });
  assert.equal((await start(['glasses'])).statusCode, 400, 'missing required gear is refused');
  const id = (await start(['glasses', 'gloves', 'unplugged', 'battery_tray', 'esd'])).json().id;
  const P = (payload: object) => app.inject({ method: 'POST', url: `/api/repair/jobs/${id}/progress`, headers: h, payload });
  assert.equal((await P({ during_photo: 'a'.repeat(64) })).statusCode, 200);
  assert.equal((await P({ step: 0 })).statusCode, 200);
  assert.equal((await P({ step: 1 })).statusCode, 200);
  assert.equal((await P({ step: 1, done: false })).statusCode, 200);
  assert.equal((await P({ diary: { problems: 'Glue was very strong', parts: 'Screen', minutes: 45 } })).statusCode, 200);
  assert.equal((await app.inject({ method: 'POST', url: `/api/repair/jobs/${id}/progress`, headers: { 'x-user-id': 'u-worker-1' }, payload: { step: 2 } })).statusCode, 403);
  await app.inject({ method: 'POST', url: `/api/repair/jobs/${id}/complete`, headers: h, payload: { after_photo: 'af9', diary: { outcome: 'fixed' } } });
  const job = (await app.inject({ url: '/api/repair/mine', headers: h })).json().jobs.find((j: { id: string }) => j.id === id);
  assert.deepEqual(job.during_photos, ['a'.repeat(64)]);
  assert.deepEqual(job.steps_done, [0]);
  assert.deepEqual(job.gear_checked, ['glasses', 'gloves', 'unplugged', 'battery_tray', 'esd']);
  assert.deepEqual(job.diary, { problems: 'Glue was very strong', parts: 'Screen', minutes: 45, outcome: 'fixed' });
  assert.equal(job.guide_id, 'rg-phone-screen');
  void db;
});
