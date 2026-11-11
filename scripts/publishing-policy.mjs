export const publishingConfirmation =
  'Ask for explicit human confirmation immediately before publishing.';

export function publishingFindings(metadata, files) {
  const findings = [];
  let publishingLine;
  for (const [file, body] of Object.entries(files)) {
    if (file !== 'SKILL.md' && !file.startsWith('examples/')) continue;
    for (const [index, line] of body.split(/\r?\n/).entries()) {
      const action =
        /\b(?:publish(?:es|ing)?|post(?:s|ing)?|deploy(?:s|ing)?|upload(?:s|ing)?)\b/i.exec(
          line,
        );
      if (
        !action ||
        /\b(?:do not|never|don't|must not|cannot)\b[^.!?]*$/i.test(
          line.slice(0, action.index),
        )
      )
        continue;
      publishingLine ??= { file, line: index + 1 };
      if (
        /\bwithout\b.{0,100}\b(?:asking|confirmation|approval)\b|\b(?:skip|bypass|ignore)\b.{0,100}\b(?:confirmation|approval)\b|\b(?:do not|don't|never)\s+(?:ask|request|require)\b/i.test(
          line,
        )
      ) {
        findings.push({
          file,
          line: index + 1,
          reason:
            'Publishing instructions must require human confirmation. Remove the conflicting instruction.',
        });
      }
    }
  }
  const hasConfirmation = (files['SKILL.md'] ?? '')
    .split(/\r?\n/)
    .some(
      (line) => line.trim().replace(/^[-*]\s+/, '') === publishingConfirmation,
    );
  if (
    (publishingLine || metadata.pipeline_stage === 'publishing') &&
    !hasConfirmation
  ) {
    findings.push({
      ...(publishingLine ?? { file: 'skill.json', line: 1 }),
      reason:
        'Add this approval boundary to SKILL.md as a standalone instruction: ' +
        publishingConfirmation,
    });
  }
  return findings;
}
