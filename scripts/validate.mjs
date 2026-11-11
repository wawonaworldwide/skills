import Ajv from 'ajv';
import { readFileSync } from 'node:fs';

const read = (name) =>
  readFileSync(new URL('../' + name, import.meta.url), 'utf8');
const schema = new Ajv().compile(JSON.parse(read('skill.schema.json')));
const license = read('LICENSE');
const normalize = (text) => text.replace(/\s+/g, ' ').trim();
const mitText = normalize(
  license
    .split(/\r?\n\r?\n/)
    .slice(2)
    .join('\n\n'),
);
const credential =
  /-----BEGIN [A-Z ]*PRIVATE KEY-----|\b(?:sk-(?:proj-)?[\w-]{20,}|(?:gh[pousr]_|github_pat_|xox[baprs]-|AKIA|ASIA|AIza|sk_live_|rk_live_|sk_test_|whsec_)[\w-]{16,})\b|\b(?:api[ _-]?key|access[ _-]?token|password|secret|authorization)["']?\s*[:=]\s*["']?[\w./+=-]{8,}/i;
const privateUrl =
  /(?:https?|ssh|git):\/\/(?:[^/\s@]+@|(?:localhost|127(?:\.\d+){3}|10(?:\.\d+){3}|192\.168(?:\.\d+){2}|172\.(?:1[6-9]|2\d|3[01])(?:\.\d+){2}|169\.254(?:\.\d+){2}|\[::1\]|[\w.-]+\.(?:internal|local|localhost|lan|corp))(?=[/:\s\])]|$))|https?:\/\/[^\s]*[?&](?:token|key|secret|password|signature|auth)=[^\s&#]+/i;
const prohibitedBrand = /\bmy[\s_-]*designs\b/i;
const policy = [
  /\b(?:scrape|scraping|crawl|crawling)\b.{0,70}\b(?:website|marketplace|social|feed|search results)\b/i,
  /\b(?:bypass|evade|circumvent)\b.{0,70}\b(?:login|sign-in|captcha|rate limits?)\b/i,
  /\b(?:copy|clone|recreate)\b.{0,70}\b(?:another|other) sellers?['’]?\s+designs?\b/i,
  /\b(?:hide|conceal|obfuscate)\b.{0,70}\b(?:network|requests?|calls?)\b/i,
];

export class InvalidSubmission extends Error {
  constructor(message, findings = []) {
    super(message);
    this.findings = findings;
  }
}

export const validSlug = (slug) =>
  slug !== 'submit' && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug);
export const allowedFile = (name) =>
  /^(?:SKILL\.md|skill\.json|LICENSE|examples\/[a-zA-Z0-9_-]+\.(?:md|txt|json))$/.test(
    name,
  );
export const maxBytes = 24_000;
export const maxFiles = 13;
const validDate = (date) => {
  const value = new Date(date);
  return Number.isFinite(+value) && value.toISOString().slice(0, 10) === date;
};

export function validateSkill(slug, files, { communityOnly = false } = {}) {
  const fail = (message, findings) => {
    throw new InvalidSubmission(message, findings);
  };
  if (!validSlug(slug)) fail('Invalid or reserved skill slug.');
  const entries = Object.entries(files);
  if (
    entries.length > maxFiles ||
    entries.some(
      ([name, value]) =>
        !allowedFile(name) ||
        !value.trim() ||
        Buffer.byteLength(value) > maxBytes ||
        /[\0\uFFFD]/.test(value),
    ) ||
    entries.reduce((size, [, value]) => size + Buffer.byteLength(value), 0) >
      48_000
  ) {
    fail('Use the required text files and small, flat text examples only.');
  }
  for (const [file, text] of entries) {
    const lines = text.split(/\r?\n/);
    const findings = lines.flatMap((line, index) =>
      credential.test(line) ||
      privateUrl.test(line) ||
      prohibitedBrand.test(line) ||
      (!/^\s*(?:[-*]\s+)?(?:do not|never|don.t)\b/i.test(line) &&
        policy.some((rule) => rule.test(line)))
        ? [
            {
              file,
              line: index + 1,
              reason:
                'Sensitive content or prohibited behavior pattern. Value withheld.',
            },
          ]
        : [],
    );
    if (findings.length)
      fail(
        'A secret, private link or prohibited behavior pattern was detected.',
        findings,
      );
  }
  if (!files['skill.json'] || !files.LICENSE)
    fail('skill.json and LICENSE are required.');
  let meta;
  try {
    meta = JSON.parse(files['skill.json']);
  } catch {
    fail('skill.json must be valid JSON.');
  }
  if (!schema(meta)) {
    const findings = schema.errors.map(({ instancePath, keyword }) => ({
      file: 'skill.json',
      line: 1,
      reason: `Schema check failed at ${/^\/[a-z_]+$/i.test(instancePath) ? instancePath : 'the root or a nested value'} (${keyword}).`,
    }));
    fail('skill.json failed schema validation.', findings);
  }
  const type = meta.source_type ?? 'Community';
  if (meta.slug !== slug || (communityOnly && type !== 'Community'))
    fail(
      'Metadata must match the folder slug. Submitted skills use the Community source type.',
    );
  if (
    !validDate(meta.created) ||
    !validDate(meta.updated) ||
    meta.updated < meta.created
  )
    fail('Use real dates, with updated on or after created.');
  const [title, copyright, ...body] = files.LICENSE.trim().split(/\r?\n\r?\n/);
  if (
    title !== 'MIT License' ||
    !/^Copyright \(c\) \d{4} \S[^\r\n]*$/i.test(copyright ?? '') ||
    normalize(body.join('\n\n')) !== mitText
  )
    fail('LICENSE must contain the full MIT text and a copyright line.');
  if (!files['SKILL.md']) fail('SKILL.md is required.');
  if (
    type === 'Open source' &&
    (entries.length !== 3 ||
      files['SKILL.md'].replace(/\r\n/g, '\n').trim() !==
        `# Upstream skill\n\n${meta.source_url}`)
  )
    fail('External entries use a link-only SKILL.md and contain no examples.');
  return meta;
}
