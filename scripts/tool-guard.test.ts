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
      'git push origin "main"',
      "git push origin 'HEAD:main'",
      'git push --all origin',
      'git push --branches origin',
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
      'git push -fu origin feat/x',
      'git push -uf origin feat/x',
      'git push --force origin feat/x',
      'git push --force-with-lease',
      'git push --force-with-lease=feat/x:abc origin feat/x',
      'git push origin +feat/x',
      'git push --mirror origin',
    ]) {
      expect(judge(command, 'feat/x'), command).toMatch(/force push/)
    }
  })

  it("sees past git's global options and into command substitution", () => {
    for (const command of [
      'git -C ../vigil push origin main',
      'git -c push.default=current push origin main',
      'git --no-pager push origin main',
      'git --git-dir=.git push origin main',
      'echo $(git push origin main)',
      'echo `git push -f origin feat/x`',
    ]) {
      expect(judge(command, 'feat/x'), command).toMatch(/push/)
    }
    expect(judge('git -C ../vigil push -u origin feat/x', 'main')).toBeNull()
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

  it('reads through quoted prose and heredoc bodies — a mention is not a push', () => {
    expect(judge('gh pr comment 1 --body "never git push origin main"', 'feat/x')).toBeNull()
    expect(judge("echo 'npm install lodash'", 'feat/x')).toBeNull()
    const heredoc = ["gh pr create --body-file - <<'EOF'", 'Run: git push origin main', 'EOF'].join(
      '\n',
    )
    expect(judge(heredoc, 'feat/x')).toBeNull()
    expect(judge(`${heredoc} && git push origin main`, 'feat/x')).toMatch(/push to main/)
    const indented = ["cat <<-'EOF'", '\tnever npm install lodash', '\tEOF'].join('\n')
    expect(judge(indented, 'feat/x')).toBeNull()
  })

  it('never throws on words that are properties of every object', () => {
    for (const command of [
      'grep -rn constructor src',
      'rg toString src && git push origin main',
      'echo __proto__ hasOwnProperty valueOf',
    ]) {
      expect(() => judge(command, 'feat/x'), command).not.toThrow()
    }
    expect(judge('rg toString src && git push origin main', 'feat/x')).toMatch(/push to main/)
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
