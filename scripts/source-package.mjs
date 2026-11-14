import fs from 'node:fs/promises';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
const root = path.resolve('.'), version = JSON.parse(await fs.readFile('package.json', 'utf8')).version;
await fs.mkdir(path.join(root, 'release'), { recursive: true });
const folder = await fs.mkdtemp(path.join(root, 'release', `KurAudio-${version}-source-`));
for (const name of ['src', 'public', 'scripts', 'tests', 'src-tauri/src', 'src-tauri/capabilities', 'src-tauri/icons']) await fs.cp(path.join(root, name), path.join(folder, name), { recursive: true, filter: source => path.resolve(source) !== path.join(root, 'scripts', 'build-env.ps1') });
for (const name of ['GUIDE.md', 'PUBLISHING.md', 'RELEASE-0.11.0.md', 'AUDIT-0.11.0.md', 'AUDIT-INTERFACE-2026-10-30.md', 'images']) await fs.cp(path.join(root, 'docs', name), path.join(folder, 'docs', name), { recursive: true });
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
await fs.rm(destination, { force: true });
execFileSync('powershell.exe', ['-NoProfile', '-Command', `Add-Type -AssemblyName System.IO.Compression.FileSystem; [IO.Compression.ZipFile]::CreateFromDirectory(${quote(folder)}, ${quote(destination)})`], { windowsHide: true, stdio: 'inherit' });
await fs.copyFile(destination, path.join(root, 'release', `KurAudio-${version}-source.zip`));
console.log(`Application source archive: ${destination}`);
