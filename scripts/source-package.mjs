import fs from 'node:fs/promises';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
const root = path.resolve('.'), version = JSON.parse(await fs.readFile('package.json', 'utf8')).version;
const folder = path.join(root, 'release', `KurAudio-${version}-source`);
await fs.mkdir(folder, { recursive: true });
for (const name of ['src', 'public', 'scripts', 'docs', 'tests', 'src-tauri/src', 'src-tauri/capabilities', 'src-tauri/icons']) await fs.cp(path.join(root, name), path.join(folder, name), { recursive: true });
for (const name of ['package.json', 'package-lock.json', 'app-icon.svg', 'index.html', 'vite.config.ts', 'tsconfig.json', 'design-tokens.json', 'README.md', 'LICENSE', 'src-tauri/Cargo.toml', 'src-tauri/Cargo.lock', 'src-tauri/build.rs', 'src-tauri/tauri.conf.json']) {
  await fs.mkdir(path.dirname(path.join(folder, name)), { recursive: true });
  await fs.copyFile(path.join(root, name), path.join(folder, name));
}
const licenseFiles = ['SOURCE.txt', 'LICENSE-upstream.txt', 'LGPL-3.0.txt', 'GPL-3.0.txt', 'lamejs.js', 'upstream-source-1.2.7.zip'];
for (const name of licenseFiles) {
  const destination = path.join(folder, 'third-party/lamejs', name); await fs.mkdir(path.dirname(destination), { recursive: true });
  await fs.copyFile(path.join(root, 'third-party/lamejs', name), destination);
}
await fs.mkdir(path.join(root, 'third-party/relink'), { recursive: true });
const destination = path.join(root, 'third-party/relink/KurAudio-source.zip');
const quote = value => "'" + value.replaceAll("'", "''") + "'";
execFileSync('powershell.exe', ['-NoProfile', '-Command', `Compress-Archive -Path ${quote(path.join(folder, '*'))} -DestinationPath ${quote(destination)} -Force`], { windowsHide: true, stdio: 'inherit' });
await fs.copyFile(destination, path.join(root, 'release', `KurAudio-${version}-source.zip`));
console.log(`Application source archive: ${destination}`);
