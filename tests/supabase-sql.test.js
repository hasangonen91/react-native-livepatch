'use strict';
// End-to-end check of the provider against supabase/livepatch.sql on a real
// Postgres. Runs only when LIVEPATCH_TEST_PSQL is set, e.g.
//   LIVEPATCH_TEST_PSQL="psql -h /tmp/pg -p 5499 -U postgres" npm test
const test = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('child_process');
const path = require('path');
const { supabaseProvider } = require('./.build/providers');

const PSQL = process.env.LIVEPATCH_TEST_PSQL;

function sql(query, role) {
  const [bin, ...args] = PSQL.split(' ');
  const full = role ? `set role ${role}; ${query}` : query;
  return execFileSync(bin, [...args, '-v', 'ON_ERROR_STOP=1', '-qtAc', full], { encoding: 'utf8' }).trim();
}

const q = (v) => (v === null || v === undefined ? 'null' : `'${String(v).replace(/'/g, "''")}'`);

// Minimal PostgREST stand-in: POST /rest/v1/rpc/<fn> with JSON args, executed as anon.
const fetch = async (url, init) => {
  const fn = url.match(/\/rpc\/(\w+)$/)[1];
  const a = JSON.parse(init.body);
  const args = Object.entries(a).map(([k, v]) => `${k} => ${q(v)}`).join(', ');
  const out = sql(`select coalesce(public.${fn}(${args})::text, 'null')`, 'anon').split('\n').pop();
  return { ok: true, status: 200, json: async () => JSON.parse(out), text: async () => out };
};

test('provider + SQL end to end', { skip: !PSQL && 'LIVEPATCH_TEST_PSQL not set' }, async () => {
  sql(`do $$ begin
         if not exists (select from pg_roles where rolname='anon') then create role anon; end if;
         if not exists (select from pg_roles where rolname='authenticated') then create role authenticated; end if;
         if not exists (select from pg_roles where rolname='service_role') then create role service_role; end if;
       end $$;
       create schema if not exists storage;
       create table if not exists storage.buckets(id text primary key, name text, public boolean);`);
  const [bin, ...args] = PSQL.split(' ');
  execFileSync(bin, [...args, '-q', '-v', 'ON_ERROR_STOP=1', '-f', path.join(__dirname, '..', 'supabase', 'livepatch.sql')], { stdio: 'pipe' });
  sql(`delete from livepatch_events; delete from livepatch_releases where app_version = '7.7.7';`);

  const p = supabaseProvider({ url: 'https://local', anonKey: 'k', fetch });
  const base = { platform: 'ios', appVersion: '7.7.7', channel: 'production', deviceId: 'dev' };
  assert.deepEqual(await p.check({ ...base, bundleId: null }), { status: 'up_to_date' });

  const id = '11111111-1111-1111-1111-111111111111';
  sql(`insert into livepatch_releases (id, platform, app_version, bundle_path, files, total_size, message)
       values ('${id}', 'ios', '7.7.7', 'main.jsbundle', '[{"path":"main.jsbundle","sha256":"ff","size":5}]', 5, 'hello')`);
  const r = await p.check({ ...base, bundleId: null });
  assert.equal(r.status, 'update');
  assert.equal(r.release.id, id);
  assert.equal(r.release.message, 'hello');
  assert.equal(r.release.files[0].url, 'https://local/storage/v1/object/public/livepatch/files/ff');

  assert.deepEqual(await p.check({ ...base, bundleId: id }), { status: 'up_to_date' });
  await p.report({ type: 'installed', releaseId: id, platform: 'ios', appVersion: '7.7.7', channel: 'production', deviceId: 'dev' });
  assert.equal(sql(`select installs from livepatch_release_stats where id='${id}'`), '1');

  sql(`update livepatch_releases set enabled = false where id='${id}'`);
  assert.deepEqual(await p.check({ ...base, bundleId: id }), { status: 'rollback' });
  assert.throws(() => sql('select count(*) from livepatch_releases', 'anon'), /permission denied/);
});
