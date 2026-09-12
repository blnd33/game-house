import { cp, mkdir, readFile, readdir, rename, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join, resolve, relative } from 'node:path';
import { spawn } from 'node:child_process';

const root = resolve('.');
const version = `0.4.0-dev-${new Date().toISOString().replace(/[^0-9]/g, '')}`;
const target = join(root, 'release', `GamingHouse-${version}`);
const run = (cmd, args) => new Promise((resolve, reject) => { const child = spawn(cmd, args, { stdio: 'inherit', windowsHide: true }); child.on('error', reject); child.on('exit', code => code === 0 ? resolve() : reject(new Error(`${cmd} exited ${code}`))); });
await mkdir(target, { recursive: true });
await run('dotnet', ['publish', 'services/station-agent/GamingHouse.Agent.csproj', '-c', 'Release', '-r', 'win-x64', '--self-contained', 'true', '-p:RuntimeFrameworkVersion=10.0.12', '-o', join(target, 'agent')]);
await cp(join(root, 'node_modules/electron/dist'), join(target, 'desktop'), { recursive: true });
await rename(join(target, 'desktop/electron.exe'), join(target, 'desktop/GamingHouse.exe'));
const app = join(target, 'desktop/resources/app');
await mkdir(join(app, 'apps/desktop/dist-electron'), { recursive: true });
await cp(join(root, 'apps/desktop/dist'), join(app, 'apps/desktop/dist'), { recursive: true });
for (const file of ['main.js', 'preload.cjs', 'native.js', 'agent-client.js', 'launch-spec.js']) await cp(join(root, 'apps/desktop/dist-electron', file), join(app, 'apps/desktop/dist-electron', file));
await writeFile(join(app, 'package.json'), JSON.stringify({ name: 'gaming-house', version: '0.4.0', type: 'module', main: 'apps/desktop/dist-electron/main.js' }, null, 2));
await cp(join(root, 'packaging/Install.ps1'), join(target, 'Install.ps1'));
await cp(join(root, 'docs/operator-setup.md'), join(target, 'README.md'));
const files = [];
async function walk(dir) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) await walk(path);
    else files.push({ path: relative(target, path).replaceAll('\\', '/'), sha256: createHash('sha256').update(await readFile(path)).digest('hex') });
  }
}
await walk(target);
const manifest = { version, schema_version: 1, development_unsigned: true, files };
await writeFile(join(target, 'manifest.ps1'), `# Gaming House package manifest\n@'\n${JSON.stringify(manifest, null, 2)}\n'@\n`);
await writeFile(join(root, 'release/latest-package.json'), JSON.stringify({ path: target, version, file_count: files.length }, null, 2));
console.log(`Unsigned development package: ${target}`);
