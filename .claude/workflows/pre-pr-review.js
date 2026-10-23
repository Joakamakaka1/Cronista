// Reviews the branch with the Cronista reviewers that match the diff, then tries to refute each finding.
// Run it as /pre-pr-review [base-branch]; the default base is master.

export const meta = {
  name: 'pre-pr-review',
  description:
    'Review the branch diff with the matching Cronista reviewers and verify each finding',
  whenToUse: 'Before opening a PR with a large or multi-area diff (step 5 of /pre-pr)',
  phases: [{ title: 'Scope' }, { title: 'Review' }, { title: 'Verify' }],
};

// -----------------------------------------------------------------------------
// Schemas
// -----------------------------------------------------------------------------

const SCOPE = {
  type: 'object',
  properties: { files: { type: 'array', items: { type: 'string' } } },
  required: ['files'],
};

const FINDINGS = {
  type: 'object',
  properties: {
    findings: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          severity: { type: 'string', enum: ['critical', 'high', 'medium', 'low'] },
          file: { type: 'string' },
          line: { type: 'integer' },
          problem: { type: 'string' },
          scenario: { type: 'string' },
          fix: { type: 'string' },
        },
        required: ['severity', 'file', 'problem', 'scenario', 'fix'],
      },
    },
    unverified: { type: 'array', items: { type: 'string' } },
  },
  required: ['findings', 'unverified'],
};

const VERDICT = {
  type: 'object',
  properties: { refuted: { type: 'boolean' }, reason: { type: 'string' } },
  required: ['refuted', 'reason'],
};

// -----------------------------------------------------------------------------
// Review
// -----------------------------------------------------------------------------

const REVIEWERS = [
  {
    agentType: 'db-reviewer',
    matches: (file) => file.startsWith('packages/db/') || file.endsWith('.sql'),
  },
  { agentType: 'narrator-reviewer', matches: (file) => /^(packages\/narrator|evals)\//.test(file) },
  { agentType: 'infra-reviewer', matches: (file) => /^(infra|services)\//.test(file) },
  { agentType: 'security-reviewer', matches: () => true },
];
const SEVERITY_ORDER = ['critical', 'high', 'medium', 'low'];
const base = typeof args === 'string' && args.trim() !== '' ? args.trim() : 'master';

phase('Scope');
const scope = await agent(
  `In the current git repository, list every file changed on this branch against ${base}: ` +
    `the output of \`git diff --name-only ${base}...HEAD\` plus uncommitted and untracked files from ` +
    '`git status --porcelain`. Return repo-relative paths with forward slashes. Do not modify anything.',
  { label: 'scope', model: 'haiku', schema: SCOPE },
);
if (!scope) {
  log('The scope agent failed: nothing was reviewed. Run the workflow again.');
  return { base, error: 'scope agent failed', reviewers: [], confirmed: [], refuted: 0 };
}
const files = scope.files;
const selected = REVIEWERS.map((reviewer) => ({
  ...reviewer,
  files: files.filter((file) => reviewer.matches(file)),
})).filter((reviewer) => reviewer.files.length > 0);

if (selected.length === 0) {
  log(`No changes against ${base}: nothing to review.`);
  return { base, reviewers: [], confirmed: [], refuted: 0 };
}
log(
  `${files.length} files changed; reviewers: ${selected.map((reviewer) => reviewer.agentType).join(', ')}`,
);

const results = await pipeline(
  selected,
  (reviewer) =>
    agent(
      `Review the changes on this branch against ${base} in your area. Files in scope:\n` +
        `${reviewer.files.join('\n')}\n\nUse \`git diff ${base}...HEAD -- <file>\` and the working tree. ` +
        'Report only real problems; list in `unverified` the checks you could not complete.',
      {
        agentType: reviewer.agentType,
        phase: 'Review',
        label: `review:${reviewer.agentType}`,
        schema: FINDINGS,
      },
    ),
  (review, reviewer) =>
    parallel(
      (review?.findings ?? []).map(
        (finding) => () =>
          agent(
            `A ${reviewer.agentType} reported this problem on the branch (base ${base}):\n` +
              `${JSON.stringify(finding, null, 2)}\n\nRead the code and try to refute it: is the problem real, ` +
              'reachable and correctly described? Set refuted=true if it is wrong or you cannot confirm it. ' +
              'Do not modify anything.',
            {
              phase: 'Verify',
              label: `verify:${finding.file}`,
              model: 'opus',
              effort: 'high',
              schema: VERDICT,
            },
          ).then((verdict) => ({ ...finding, reviewer: reviewer.agentType, verdict })),
      ),
    ).then((verified) => ({
      verified,
      unverified: review?.unverified ?? [],
      reviewer: reviewer.agentType,
    })),
);

const reviews = results.filter(Boolean);
const verified = reviews.flatMap((review) => review.verified.filter(Boolean));
const confirmed = verified
  .filter((finding) => finding.verdict && !finding.verdict.refuted)
  .sort((a, b) => SEVERITY_ORDER.indexOf(a.severity) - SEVERITY_ORDER.indexOf(b.severity));

return {
  base,
  reviewers: selected.map((reviewer) => reviewer.agentType),
  confirmed,
  refuted: verified.length - confirmed.length,
  unverified: reviews.flatMap((review) =>
    review.unverified.map((check) => `${review.reviewer}: ${check}`),
  ),
};
