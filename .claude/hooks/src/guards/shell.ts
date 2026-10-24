/**
 * Reading shell command text the way the guards need it.
 */

const HEREDOC_BODY = /<<-?\s*(['"]?)(\w+)\1[^\n]*\n[\s\S]*?\n\s*\2(?=\s|$)/g;
const HERE_STRING = /@(['"])\r?\n[\s\S]*?\r?\n\1@/g;
const QUOTED = /"(?:[^"\\]|\\.)*"|'[^']*'/g;

/**
 * Removes quoted strings, heredoc bodies and PowerShell here-strings, keeping the commands around them.
 *
 * @remarks
 * Text inside quotes is data (commit messages, search patterns), so a guard that looks for commands
 * should not react to it. Guards that look for secrets in arguments must still read the full text.
 */
export function stripQuoted(command: string): string {
  return command.replace(HEREDOC_BODY, ' ').replace(HERE_STRING, ' ').replace(QUOTED, ' ');
}

/** Splits a command line into the simple commands joined by `;`, `&&`, `||`, `|` or newlines. */
export function splitCommands(command: string): string[] {
  return command.split(/&&|\|\||[;|\n]/);
}
