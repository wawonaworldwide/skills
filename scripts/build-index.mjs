import { execFileSync } from 'node:child_process';
import {
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from 'node:fs';
import { resolve } from 'node:path';
import {
  allowedFile,
  maxBytes,
  maxFiles,
  validSlug,
  validateSkill,
} from './validate.mjs';

const catalog = [];
for (const dir of readdirSync('skills', { withFileTypes: true })) {
  if (dir.name === '.gitkeep' && dir.isFile()) continue;
  if (!dir.isDirectory() || !validSlug(dir.name))
    throw new Error('Invalid skill directory.');
  const folder = `skills/${dir.name}`;
  const files = {};
  const readFiles = (path, prefix = '') => {
    for (const item of readdirSync(path, { withFileTypes: true })) {
      if (!prefix && item.name === 'examples' && item.isDirectory()) {
        readFiles(path + '/examples', 'examples/');
        continue;
      }
      const name = prefix + item.name;
      if (
        !item.isFile() ||
        !allowedFile(name) ||
        Object.keys(files).length >= maxFiles
      )
        throw new Error('Invalid skill package file.');
      const bytes = readFileSync(`${path}/${item.name}`);
      if (bytes.length > maxBytes)
        throw new Error('Skill file exceeds size limit.');
      files[name] = bytes.toString('utf8');
    }
  };
  readFiles(folder);
  const meta = validateSkill(dir.name, files);
  const reviewed = execFileSync(
    'git',
    ['log', '--first-parent', '-1', '--format=%cs', 'HEAD', '--', folder],
    { encoding: 'utf8' },
  ).trim();
  if (
    !reviewed ||
    execFileSync(
      'git',
      ['status', '--porcelain', '--untracked-files=all', '--', folder],
      { encoding: 'utf8' },
    ).trim()
  )
    throw new Error(
      'Only committed, reviewed main-branch skill folders can be indexed.',
    );
  const type = meta.source_type ?? 'Community';
  catalog.push({
    slug: meta.slug,
    name: meta.name,
    description: meta.description,
    stage: meta.pipeline_stage,
    source_type: type,
    source_url: meta.source_url,
    reviewed_date: reviewed,
    author: meta.author,
    license: meta.license,
    ...(meta.episode && { episode: meta.episode }),
    ...(type !== 'Open source' && { files }),
  });
}
mkdirSync('dist', { recursive: true });
const output = resolve('dist/skills-catalog.json');
writeFileSync(
  output + '.tmp',
  JSON.stringify(
    catalog.sort((a, b) => a.slug.localeCompare(b.slug)),
    null,
    2,
  ) + '\n',
);
renameSync(output + '.tmp', output);
console.log(`Indexed ${catalog.length} reviewed skill entries.`);
