#!/usr/bin/env node
/**
 * Pushes cards and scenarios from the repo into Firestore.
 *
 *   GOOGLE_CLOUD_PROJECT=my-project node tools/seed-firestore.mjs
 *   node tools/seed-firestore.mjs --dry-run
 *   node tools/seed-firestore.mjs --prune        # also delete docs no longer in the repo
 *
 * Git is the source of truth for content; Firestore is a read cache the deployed engine
 * can serve without a redeploy. Run this after editing cards, and run `npm run validate`
 * first — this script will refuse to seed a roster that does not validate.
 */
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2);
const dryRun = argv.includes('--dry-run');
const prune = argv.includes('--prune');

// Refuse to publish content that does not pass its own validator.
try {
  execFileSync(process.execPath, [join(ROOT, 'tools/validate.mjs')], { stdio: 'pipe' });
} catch (err) {
  console.error('Validation failed — fix the errors before seeding:\n');
  console.error(err.stdout?.toString() ?? '', err.stderr?.toString() ?? '');
  process.exit(1);
}

const load = (dir) =>
  existsSync(join(ROOT, dir))
    ? readdirSync(join(ROOT, dir))
        .filter((f) => f.endsWith('.json'))
        .map((f) => JSON.parse(readFileSync(join(ROOT, dir, f), 'utf8')))
    : [];

const cards = load('cards');
const scenarios = load('scenarios');
console.log(`${cards.length} cards, ${scenarios.length} scenarios`);

if (dryRun) {
  console.log('\n--dry-run: nothing written.');
  console.log('cards:', cards.map((c) => c.id).join(', '));
  console.log('scenarios:', scenarios.map((s) => s.id).join(', '));
  process.exit(0);
}

const { Firestore } = await import('@google-cloud/firestore');
const db = new Firestore();

async function seed(collection, docs) {
  // Firestore batches cap at 500 writes; our content is far smaller, but chunk anyway.
  for (let i = 0; i < docs.length; i += 400) {
    const batch = db.batch();
    for (const doc of docs.slice(i, i + 400)) {
      batch.set(db.collection(collection).doc(doc.id), { ...doc, seededAt: new Date().toISOString() });
    }
    await batch.commit();
  }
  console.log(`  wrote ${docs.length} -> ${collection}`);

  if (prune) {
    const keep = new Set(docs.map((d) => d.id));
    const snap = await db.collection(collection).get();
    const stale = snap.docs.filter((d) => !keep.has(d.id));
    if (stale.length) {
      const batch = db.batch();
      for (const d of stale) batch.delete(d.ref);
      await batch.commit();
      console.log(`  pruned ${stale.length} stale -> ${collection} (${stale.map((d) => d.id).join(', ')})`);
    }
  }
}

await seed('cards', cards);
await seed('scenarios', scenarios);
console.log('\nDone.');
