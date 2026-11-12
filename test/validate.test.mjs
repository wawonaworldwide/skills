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

test('publishing without approval returns NEEDS CHANGES with the offending line', () => {
  const body =
    '# Fixture\nPublish the summary to the public blog immediately without asking for human confirmation.';
  assert.throws(
    () => validateSkill('test-fixture', { ...files, 'SKILL.md': body }),
    (error) =>
      error.verdict === 'NEEDS CHANGES' &&
      error.findings.some(
        (finding) => finding.file === 'SKILL.md' && finding.line === 2,
      ),
  );
});

test('a confirmation statement cannot override a conflicting publishing instruction', () => {
  const body =
    '# Fixture\nAsk for explicit human confirmation immediately before publishing.\nPublish the summary without approval.';
  assert.throws(
    () => validateSkill('test-fixture', { ...files, 'SKILL.md': body }),
    (error) =>
      error.verdict === 'NEEDS CHANGES' && error.findings[0].line === 3,
  );
});

test('publishing skills need a standalone confirmation instruction', () => {
  const publishingFiles = {
    ...files,
    'skill.json': JSON.stringify({ ...metadata, pipeline_stage: 'publishing' }),
  };
  assert.throws(
    () => validateSkill('test-fixture', publishingFiles),
    (error) => error.verdict === 'NEEDS CHANGES',
  );
  assert.equal(
    validateSkill('test-fixture', {
      ...publishingFiles,
      'SKILL.md':
        '# Fixture\nAsk for explicit human confirmation immediately before publishing.\nPublish the approved summary after confirmation.',
    }).pipeline_stage,
    'publishing',
  );
});

test('examples follow the publishing confirmation boundary', () => {
  assert.throws(
    () =>
      validateSkill('test-fixture', {
        ...files,
        'examples/sample.md':
          'Deploy the page without asking for confirmation.',
      }),
    (error) =>
      error.verdict === 'NEEDS CHANGES' &&
      error.findings[0].file === 'examples/sample.md',
  );
});

test('an instruction forbidding publication does not require approval text', () => {
  assert.equal(
    validateSkill('test-fixture', {
      ...files,
      'SKILL.md': '# Fixture\nDo not make network calls or publish anything.',
    }).slug,
    'test-fixture',
  );
});

test('prohibiting the approval request remains a conflict after the confirmation sentence', () => {
  const body =
    '# Fixture\nAsk for explicit human confirmation immediately before publishing.\nDo not ask for approval before publishing the summary.';
  assert.throws(
    () => validateSkill('test-fixture', { ...files, 'SKILL.md': body }),
    (error) =>
      error.verdict === 'NEEDS CHANGES' && error.findings[0].line === 3,
  );
});

test('link-only publishing entries remain valid without editing upstream instructions', () => {
  assert.equal(
    validateSkill('test-fixture', {
      LICENSE: files.LICENSE,
      'SKILL.md': '# Upstream skill\n\n' + metadata.source_url,
      'skill.json': JSON.stringify({
        ...metadata,
        source_type: 'Open source',
        pipeline_stage: 'publishing',
      }),
    }).source_type,
    'Open source',
  );
});
