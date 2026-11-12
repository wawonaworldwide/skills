import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import {
  allowedFile,
  InvalidSubmission,
  maxBytes,
  maxFiles,
  validSlug,
  validateSkill,
} from './validate.mjs';

const event = JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH, 'utf8'));
const pr = event.pull_request;
const sha = pr.head.sha;
const base = pr.base.sha;
const number = pr.number;
if (
  ![sha, base].every((id) => /^[a-f0-9]{40}$/.test(id)) ||
  !Number.isSafeInteger(number)
)
  throw new Error('Invalid pull request event.');
const repo = process.env.GITHUB_REPOSITORY;
const context = 'AI POD Builder / skill review';
const marker = '<!-- ai-pod-builder-skill-review -->';

async function github(path, method = 'GET', body) {
  const response = await fetch('https://api.github.com/repos/' + repo + path, {
    method,
    headers: {
      Authorization: 'Bearer ' + process.env.GITHUB_TOKEN,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'Content-Type': 'application/json',
    },
    body: body && JSON.stringify(body),
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok)
    throw new Error('GitHub request failed: ' + response.status);
  return response.json();
}

const git = (...args) =>
  execFileSync('git', args, { encoding: 'utf8', maxBuffer: 1024 * 1024 });
const status = (state, description) =>
  github('/statuses/' + sha, 'POST', {
    state,
    description,
    context,
    target_url: `https://github.com/${repo}/actions/runs/${process.env.GITHUB_RUN_ID}`,
  });

function readSubmission() {
  const reject = (reason) => {
    throw new InvalidSubmission(reason);
  };
  // Fetch Git objects only. No PR checkout, execution, dependencies or workflow files.
  git('fetch', '--no-tags', 'origin', `refs/pull/${number}/head`);
  if (git('rev-parse', 'FETCH_HEAD').trim() !== sha)
    throw new Error('PR head changed.');
  const diff = git(
    'diff',
    '--raw',
    '--no-renames',
    '--no-abbrev',
    '-z',
    base + '...' + sha,
  ).split('\0');
  diff.pop();
  if (!diff.length || diff.length > maxFiles * 2)
    reject('Add one new skill folder.');
  const files = {};
  let slug;
  for (let i = 0; i < diff.length; i += 2) {
    const [mode, path] = [diff[i], diff[i + 1]];
    const match = /^skills\/([a-z0-9]+(?:-[a-z0-9]+)*)\/(.+)$/.exec(path);
    if (
      !match ||
      !validSlug(match[1]) ||
      !allowedFile(match[2]) ||
      !/^:000000 100644 [a-f0-9]{40} [a-f0-9]{40} A$/.test(mode) ||
      (slug && slug !== match[1])
    )
      reject(
        'Only regular files added under one new skill folder are allowed.',
      );
    slug = match[1];
    const file = match[2];
    const object = sha + ':' + path;
    if (+git('cat-file', '-s', object) > maxBytes)
      reject('A submission file exceeds the size limit.');
    files[file] = git('cat-file', 'blob', object);
  }
  if (git('ls-tree', '--name-only', base, '--', `skills/${slug}`).trim())
    reject('This slug is already present on main.');
  const isOwner =
    Boolean(process.env.SKILLS_MAINTAINER) &&
    pr.user.login.toLowerCase() === process.env.SKILLS_MAINTAINER.toLowerCase();
  validateSkill(slug, files, { communityOnly: !isOwner });
  return files;
}

async function aiReview(files) {
  if (!process.env.OPENAI_API_KEY || !process.env.SKILL_REVIEW_MODEL)
    throw new Error('AI reviewer is not configured.');
  const instructions = readFileSync('REVIEW_RULES.md', 'utf8');
  const snippets = Object.entries(files)
    .filter(([name]) => name !== 'LICENSE')
    .map(([name, body]) => ({
      name,
      lines: body.split(/\r?\n/).map((line, i) => `${i + 1}: ${line}`),
    }));
  const object = (properties) => ({
    type: 'object',
    properties,
    required: Object.keys(properties),
    additionalProperties: false,
  });
  const string = { type: 'string' };
  const response = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: {
      Authorization: 'Bearer ' + process.env.OPENAI_API_KEY,
      'Content-Type': 'application/json',
    },
    signal: AbortSignal.timeout(90_000),
    body: JSON.stringify({
      model: process.env.SKILL_REVIEW_MODEL,
      instructions,
      input: JSON.stringify(snippets),
      store: false,
      max_output_tokens: 2000,
      text: {
        format: {
          type: 'json_schema',
          name: 'skill_review',
          strict: true,
          schema: object({
            verdict: {
              type: 'string',
              enum: ['PASS', 'NEEDS CHANGES', 'REJECT'],
            },
            reasons: { type: 'array', items: string },
            findings: {
              type: 'array',
              items: object({
                file: string,
                line: { type: 'integer' },
                reason: string,
              }),
            },
          }),
        },
      },
    }),
  });
  if (!response.ok) throw new Error('AI request failed: ' + response.status);
  const result = await response.json();
  const text = result.output
    ?.flatMap((item) => item.content ?? [])
    .find((item) => item.type === 'output_text')?.text;
  if (result.status !== 'completed' || !text)
    throw new Error('AI review incomplete.');
  const review = JSON.parse(text);
  if (
    !['PASS', 'NEEDS CHANGES', 'REJECT'].includes(review.verdict) ||
    !Array.isArray(review.reasons) ||
    !review.reasons.length ||
    !review.reasons.every(
      (reason) => typeof reason === 'string' && reason.trim(),
    ) ||
    !Array.isArray(review.findings) ||
    !review.findings.every(
      ({ file, line, reason }) =>
        Number.isInteger(line) &&
        line >= 1 &&
        snippets.some((s) => s.name === file && s.lines.length >= line) &&
        typeof reason === 'string' &&
        reason.trim(),
    )
  )
    throw new Error('Invalid AI review result.');
  return review;
}

const clean = (text) =>
  text
    .slice(0, 360)
    .replace(/[^\p{L}\p{N} .,;:!?()'"/_-]/gu, ' ')
    .replace(/https?:\/\/\S+/gi, '[link withheld]');
async function postReview(review) {
  const body = [
    marker,
    `### Skill review · ${review.verdict}`,
    `Commit: \`${sha}\``,
    ...review.reasons.slice(0, 12).map((reason) => '- ' + clean(reason)),
    ...review.findings
      .slice(0, 20)
      .map(
        ({ file, line, reason }) => `- \`${file}:${line}\` · ${clean(reason)}`,
      ),
    'The maintainer makes the merge decision.',
  ].join('\n\n');
  for (let page = 1; ; page++) {
    const comments = await github(
      `/issues/${number}/comments?per_page=100&page=${page}`,
    );
    const existing = comments.find(
      (c) =>
        c.user?.login === 'github-actions[bot]' && c.body.startsWith(marker),
    );
    if (existing)
      return github(`/issues/comments/${existing.id}`, 'PATCH', { body });
    if (comments.length < 100)
      return github(`/issues/${number}/comments`, 'POST', { body });
  }
}

await status('pending', 'Review in progress.');
let review;
try {
  review = await aiReview(readSubmission());
} catch (error) {
  review =
    error instanceof InvalidSubmission
      ? {
          verdict: error.verdict,
          reasons: [error.message],
          findings: error.findings,
        }
      : {
          verdict: 'NEEDS CHANGES',
          reasons: [
            'The automated review could not finish. A maintainer must check the run and retry.',
          ],
          findings: [],
        };
}
const current = await github('/pulls/' + number);
if (
  current.state === 'open' &&
  current.head.sha === sha &&
  current.base.ref === 'main'
) {
  await postReview(review);
  await status(
    review.verdict === 'PASS' ? 'success' : 'failure',
    review.verdict,
  );
}
if (review.verdict !== 'PASS') process.exitCode = 1;
