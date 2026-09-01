import { describe, expect, it } from 'vitest'
import { judge } from './tool-guard.ts'

describe('tool-guard', () => {
  it('blocks a push to main by any spelling of the target', () => {
    for (const command of [
      'git push origin main',
      'git push origin HEAD:main',
      'git push origin feat/x:refs/heads/main',
      'git push -u origin main',
      'npm run test && git push origin main',
    ]) {
      expect(judge(command, 'feat/x'), command).toMatch(/push to main/)
    }
  })

  it('blocks a bare push only when the current branch is main', () => {
    expect(judge('git push', 'main')).toMatch(/push to main/)
    expect(judge('git push origin', 'main')).toMatch(/push to main/)
    expect(judge('git push', 'feat/x')).toBeNull()
    expect(judge('git push -u origin feat/x', 'main')).toBeNull()
  })

  it('blocks a force push in every form', () => {
    for (const command of [
      'git push -f origin feat/x',
      'git push --force origin feat/x',
      'git push --force-with-lease',
      'git push --force-with-lease=feat/x:abc origin feat/x',
      'git push origin +feat/x',
    ]) {
      expect(judge(command, 'feat/x'), command).toMatch(/force push/)
    }
  })

  it('blocks a dependency add and allows an install from the lockfile', () => {
    for (const command of [
      'npm install lodash',
      'npm i -D vitest@4',
      'npm install --save-dev @types/foo',
      'pnpm add left-pad',
      'yarn add left-pad',
      'bun add left-pad',
      'npm ci; npm install lodash',
    ]) {
      expect(judge(command, 'feat/x'), command).toMatch(/dependency add/)
    }
    for (const command of [
      'npm install',
      'npm ci',
      'npm i',
      'npm install --no-audit',
      'npm run test',
    ]) {
      expect(judge(command, 'feat/x'), command).toBeNull()
    }
  })

  it('reads through quoted strings and heredoc bodies — a mention is not a push', () => {
    expect(judge('gh pr comment 1 --body "never git push origin main"', 'feat/x')).toBeNull()
    expect(judge("echo 'npm install lodash'", 'feat/x')).toBeNull()
    const heredoc = ["gh pr create --body-file - <<'EOF'", 'Run: git push origin main', 'EOF'].join(
      '\n',
    )
    expect(judge(heredoc, 'feat/x')).toBeNull()
    expect(judge(`${heredoc} && git push origin main`, 'feat/x')).toMatch(/push to main/)
  })

  it('lets everything else through', () => {
    for (const command of [
      'git status',
      'git push origin feat/x',
      'git commit -m "add: x"',
      'ls',
    ]) {
      expect(judge(command, 'main'), command).toBeNull()
    }
  })
})
