// macOS Seatbelt profile for agent turns. Agent tool permissions only govern
// opencode's own tools; a shell command runs with the user's full rights. The
// sandbox closes that gap for the whole process tree (opencode and every shell
// command it starts):
//
// * nothing under $HOME is readable or writable, except the toolchain's own
//   directories;
// * nothing in the runs directory is, except this run's project directory;
// * so the main repository (blueprints, acceptance tests, .env), the harness
//   records, other runs and the user's other files are out of reach;
// * stat() stays allowed everywhere so path resolution and getcwd() work.
//
// Not covered: the network is open, and opencode's own config/credentials must
// stay readable for opencode to run, so an agent could read the provider key it
// is running on.

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const quote = (p) => JSON.stringify(p); // SBPL strings use the same escaping

export function sandboxProfile(projectDir) {
  const home = os.homedir();
  const h = (rel) => quote(`${home}/${rel}`);
  const runDir = path.dirname(projectDir);
  const runsRoot = path.dirname(runDir);
  return `(version 1)
(allow default)

; Nothing under the home directory by default ...
(deny file-read* file-write* (subpath ${quote(home)}))

; ... except what the toolchain needs to read ...
(allow file-read*
  (subpath ${h(".nvm")})
  (subpath ${h(".npm")})
  (literal ${h(".npmrc")})
  (subpath ${h(".opencode")})
  (subpath ${h(".config/opencode")})
  (subpath ${h(".local/share/opencode")})
  (subpath ${h(".local/state/opencode")})
  (subpath ${h(".cache")})
  (subpath ${h("Library/Caches")})
  (literal ${h(".gitconfig")})
  (subpath ${h(".pyenv")}))

; ... and to write (caches and opencode's own data, never its config).
(allow file-write*
  (subpath ${h(".npm")})
  (subpath ${h(".local/share/opencode")})
  (subpath ${h(".local/state/opencode")})
  (subpath ${h(".cache")})
  (subpath ${h("Library/Caches")}))

; opencode resolves these at startup (realpath); only the directory entries
; themselves are readable (names), never the files inside them.
(allow file-read* (literal ${quote(home)}) (literal ${h(".claude")}) (literal ${h(".agents")}))

; Other runs and every run's records are off limits ...
(deny file-read* file-write* (subpath ${quote(runsRoot)}))
(allow file-read* (literal ${quote(runsRoot)}) (literal ${quote(runDir)}))

; ... except this run's project directory.
(allow file-read* file-write* (subpath ${quote(projectDir)}))

; stat() anywhere, so path resolution and getcwd() work. Contents stay denied.
(allow file-read-metadata)
`;
}

export function assertSandboxAvailable() {
  if (process.platform !== "darwin") throw new Error("the harness sandbox needs macOS (sandbox-exec)");
  try {
    execFileSync("/usr/bin/sandbox-exec", ["-p", "(version 1)(allow default)", "/usr/bin/true"]);
  } catch (e) {
    throw new Error(`sandbox-exec is not usable: ${e.message}`);
  }
}

export function writeProfile(file, projectDir) {
  fs.writeFileSync(file, sandboxProfile(projectDir));
  return file;
}
