import { spawnSync } from 'node:child_process';

const isGitWorktree =
  spawnSync('git', ['rev-parse', '--is-inside-work-tree'], {
    stdio: 'ignore',
  }).status === 0;

if (process.env.CI === 'true' || process.env.NODE_ENV === 'production' || !isGitWorktree) {
  process.exit(0);
}

const husky = (await import('husky')).default;
const message = husky();

if (message) {
  console.log(message);
}
