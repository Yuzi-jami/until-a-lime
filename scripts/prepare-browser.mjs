import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../', import.meta.url));
// Tauri bundles additional Cargo binaries beside the main executable.
execFileSync('cargo', ['build','-p','until-a-lime','--bin','lime-browser-host','--release','--locked'], {cwd:root,stdio:'inherit'});
