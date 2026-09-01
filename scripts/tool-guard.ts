/**
 * PreToolUse hook (CLAUDE.md, "Enforced, not written"): blocks a shell command that would push to
 * `main`, force-push, or add a dependency — the three rules the prose used to carry. Wired by
 * `.claude/settings.json` for the Bash and PowerShell tools; Claude Code feeds the tool call as
 * JSON on stdin, and an exit code of 2 blocks the call and hands stderr back as the reason.
 *
 * The judgement is a pure function of the command text and the current branch, so the test can
 * drive it directly. Quoted strings and heredoc bodies are stripped first: a PR description that
 * *mentions* `git push origin main` is not a push.
 */
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { basename } from 'node:path'

/** Why a command is blocked, or null when it may run. */
export function judge(command: string, currentBranch: string): string | null {
  for (const segment of segments(command)) {
    const words = segment.split(/\s+/).filter(Boolean)
    const reason = judgePush(words, currentBranch) ?? judgeDependencyAdd(words)
    if (reason) return reason
  }
  return null
}

/** The command with heredoc bodies and quoted strings removed, split at the shell separators. */
function segments(command: string): string[] {
  const noHeredocs = command.replace(
    /<<-?\s*['"]?([A-Za-z_][A-Za-z0-9_]*)['"]?[^\n]*\n[\s\S]*?\n\1(?=\n|$)/g,
    '',
  )
  const noStrings = noHeredocs.replace(/"(?:[^"\\]|\\.)*"|'[^']*'/g, '""')
  return noStrings.split(/\|\||&&|;|\||\n/)
}

function judgePush(words: string[], currentBranch: string): string | null {
  const at = words.indexOf('git')
  if (at < 0 || words[at + 1] !== 'push') return null
  const args = words.slice(at + 2)
  const flags = args.filter((word) => word.startsWith('-'))
  const positional = args.filter((word) => !word.startsWith('-'))
  if (
    flags.some((flag) => /^(-f|--force|--force-with-lease(=.*)?|--force-if-includes)$/.test(flag))
  )
    return 'Blocked: force push. History on a shared branch is not rewritten.'
  if (positional.some((word) => word.startsWith('+')))
    return 'Blocked: force push (a + refspec). History on a shared branch is not rewritten.'
  const refspecs = positional.slice(1)
  const targetsMain = (refspec: string) => {
    const destination = refspec.includes(':') ? refspec.slice(refspec.indexOf(':') + 1) : refspec
    return destination === 'main' || destination === 'refs/heads/main'
  }
  if (refspecs.some(targetsMain) || (refspecs.length === 0 && currentBranch === 'main'))
    return 'Blocked: push to main. Work on a branch and open a PR; main is merged only through one.'
  return null
}

/** Package managers and the subcommands that add a dependency when given a package name. */
const ADDERS: Record<string, string[]> = {
  npm: ['install', 'i', 'add', 'in', 'ins', 'inst', 'insta', 'instal', 'isntall'],
  pnpm: ['add', 'install', 'i'],
  yarn: ['add'],
  bun: ['add', 'install', 'i'],
}

function judgeDependencyAdd(words: string[]): string | null {
  const at = words.findIndex((word) => word in ADDERS)
  if (at < 0 || !ADDERS[words[at]].includes(words[at + 1])) return null
  const packages = words.slice(at + 2).filter((word) => !word.startsWith('-'))
  if (packages.length === 0) return null // a bare install from the lockfile is fine
  return `Blocked: dependency add (${packages.join(' ')}). A dependency is asked for on the adjudication queue, #36, with what it is for and what it costs.`
}

function main(): void {
  const input = JSON.parse(readFileSync(0, 'utf8')) as {
    tool_name?: string
    tool_input?: { command?: string }
  }
  const command = input.tool_input?.command
  if (!command || !['Bash', 'PowerShell'].includes(input.tool_name ?? '')) return
  let branch = ''
  try {
    branch = execFileSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { encoding: 'utf8' }).trim()
  } catch {
    // Not in a repository: nothing to protect.
  }
  const reason = judge(command, branch)
  if (reason) {
    process.stderr.write(`${reason}\n`)
    process.exit(2)
  }
}

if (process.argv[1] && basename(process.argv[1]) === 'tool-guard.ts') main()
