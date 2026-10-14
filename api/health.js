// Deployment check: reports which Git commit this Vercel build came from.
// Vercel sets the VERCEL_GIT_* variables automatically for Git-connected projects.
module.exports = (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.status(200).json({
    status: 'ok',
    deployedFromGit: Boolean(process.env.VERCEL_GIT_COMMIT_SHA),
    repo: process.env.VERCEL_GIT_REPO_SLUG || null,
    branch: process.env.VERCEL_GIT_COMMIT_REF || null,
    commit: (process.env.VERCEL_GIT_COMMIT_SHA || '').slice(0, 7) || null,
    commitMessage: process.env.VERCEL_GIT_COMMIT_MESSAGE || null,
    environment: process.env.VERCEL_ENV || null,
    serverTime: new Date().toISOString(),
  });
};
