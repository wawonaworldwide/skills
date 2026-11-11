import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { validateSkill } from '../scripts/validate.mjs';

const metadata = {
  name: 'Validation fixture',
  slug: 'test-fixture',
  description: 'Used only by validation tests.',
  pipeline_stage: 'ops',
  author: 'example',
  source_url: 'https://github.com/example/fixture',
  license: 'MIT',
  version: '1.0.0',
  tags: ['test'],
  created: '2026-10-01',
  updated: '2026-10-01',
};
const files = {
  'skill.json': JSON.stringify(metadata),
  'SKILL.md': '# Validation fixture\nSummarize the supplied notes.',
  LICENSE: readFileSync(new URL('../LICENSE', import.meta.url), 'utf8'),
};
test('validates a Community submission against the schema and full license', () => {
  assert.deepEqual(
    validateSkill('test-fixture', files, { communityOnly: true }),
    metadata,
  );
  assert.throws(() => validateSkill('wrong-slug', files), /folder slug/);
  assert.throws(
    () => validateSkill('test-fixture', { ...files, LICENSE: 'MIT' }),
    /full MIT/,
  );
  assert.throws(
    () => validateSkill('test-fixture', { ...files, 'skill.json': '{}' }),
    /schema/,
  );
  assert.throws(
    () => validateSkill('test-fixture', { ...files, 'SKILL.md': '' }),
    /text files/,
  );
});
test('withholds sensitive values and identifies prohibited lines', () => {
  for (const line of [
    'Use https://build.internal/job',
    'Scrape a marketplace for listings.',
    'password = ' + 'fixture-only-value',
  ]) {
    assert.throws(
      () =>
        validateSkill('test-fixture', {
          ...files,
          'SKILL.md': '# Instructions\n' + line,
        }),
      (error) =>
        error.findings[0].line === 2 &&
        !JSON.stringify(error.findings).includes(line),
    );
  }
});
test('external entries link out without packaging source instructions', () => {
  const external = {
    LICENSE: files.LICENSE,
    'SKILL.md': '# Upstream skill\n\n' + metadata.source_url,
    'skill.json': JSON.stringify({ ...metadata, source_type: 'Open source' }),
  };
  assert.equal(
    validateSkill('test-fixture', external).source_type,
    'Open source',
  );
  assert.throws(
    () => validateSkill('test-fixture', external, { communityOnly: true }),
    /Community/,
  );
  assert.throws(
    () =>
      validateSkill('test-fixture', {
        ...external,
        'SKILL.md': files['SKILL.md'],
      }),
    /External entries/,
  );
});
