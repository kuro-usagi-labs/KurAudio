import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
const root=path.resolve('.'),version=JSON.parse(await fs.readFile(path.join(root,'package.json'),'utf8')).version,release=path.join(root,'release'),portable=path.join(release,`KurAudio-${version}-windows`);
await fs.mkdir(portable,{recursive:true});
await fs.copyFile(path.join(root,'src-tauri/target/release/kuraudio.exe'),path.join(portable,'KurAudio.exe'));
await fs.copyFile(path.join(root,'docs',`AUDIT-${version}.md`),path.join(portable,'AUDIT.md'));
await fs.copyFile(path.join(root,'docs','AUDIT-INTERFACE-2026-10-30.md'),path.join(portable,'INTERFACE.md'));
await fs.copyFile(path.join(root,`src-tauri/target/release/bundle/nsis/KurAudio_${version}_x64-setup.exe`),path.join(release,`KurAudio-${version}-x64-setup.exe`));
await fs.writeFile(path.join(portable,'MULAI-DI-SINI.txt'),`KurAudio ${version} | Editor audio lokal

Jalankan KurAudio.exe. Windows 10/11 x64 + Edge WebView2 diperlukan.
Simpan proyek dan tutup versi lama sebelum membuka versi ini.

1. Jatuhkan audio di beranda untuk proyek baru dengan audio langsung di timeline.
2. Impor audio ke Media, lalu tarik ke timeline. Drop di bawah membuat track baru.
3. Tarik badan klip untuk geser; ujungnya untuk trim waveform secara langsung.
4. Space: putar/jeda. Ctrl+B atau S: potong pada playhead.
5. R: blok rentang waveform. Shift+tarik: semua track. Hapus, cut/copy,
   geser dengan pegangan rentang, atau ekspor tanpa split dua kali.
6. Tumpuk dua klip pada track yang sama dengan menggeser klip untuk crossfade
   otomatis. Tarik garis tepi kiri transisi untuk mengatur panjangnya.
7. Alat audio > Pangkas hening: atur batas, jeda minimum dan jeda sisa,
   Analisis, Putar preview, lalu Terapkan. Undo membatalkan satu operasi penuh.
8. M: marker. L: loop rentang. Alat audio > Marker & loop untuk batas/nama.
9. Pilih klip, E untuk efek. Nyalakan switch modul untuk mengaktifkan dan membuka kontrol.
   Matikan switch untuk menonaktifkan; nilainya disimpan. Preset menyimpan status dan nilai.
10. Rekam pada transport, atau Alat audio > Rekam: periksa track dan waktu tujuan,
    pilih input, Siapkan mikrofon, lalu Mulai rekam. Ganti mikrofon tersedia sebelum
    merekam. Stop & tambahkan menempatkan hasil pada track dan waktu yang ditampilkan.
11. Ctrl+E: ekspor proyek, klip, atau rentang; WAV 16/24-bit atau MP3
    128/192/256/320 kbps; 44.1/48 kHz; nama berkas dan normalisasi tersedia.
12. Ctrl+S menyimpan .kura portabel beserta media, marker, loop, dan crossfade.
13. Ikon putar pada Media / Space pada baris media: preview dengan seek dan volume sendiri.
14. Shift+Space: dengar seleksi. Alt+Space: sekitar playhead. Shift+Enter: kembali
    ke awal playback. Menu Dengar ulang tersedia di transport.
15. Klik kanan / Shift+F10 pada klip: aksi kontekstual. Tarik pegangan fade untuk
    mengatur envelope langsung. Escape membatalkan; satu Undo mengembalikan drag.
16. Tampilan workspace: tinggi track dan follow playhead. Tarik batas panel untuk
    mengatur lebarnya. Shift+F: zoom seleksi. Proyek terakhir dan tampilan lokalnya
    tersedia di beranda; menghapus entri tidak menghapus berkas.

17. File: baru/buka/proyek terakhir, impor, simpan/simpan sebagai, ekspor, tutup dan keluar.
18. Window: Media, Riwayat, Properti/Efek; layout Editing/Fokus timeline/Mixing.
19. Pengaturan (Ctrl+,) > Umum > Tampilan: Terang, Gelap, atau Sistem.
    Pilihan tersimpan di aplikasi, terpisah dari proyek. Tema Sistem mengikuti Windows.
    Pengaturan juga memuat animasi, preview, default edit dan cadangan otomatis.
    F10: menu; panah/huruf awal: navigasi; Escape: kembali; Ctrl+Q: keluar.

Ctrl+N: baru | Ctrl+O: buka | Klik logo: beranda | Ctrl+Z: undo
Ctrl+Shift+Z: redo | Ctrl+D: duplikat | Ctrl+J: sambung | Delete: hapus
Ctrl+C/X/V: copy/cut/paste | Ctrl+scroll: zoom pada kursor | F: muat timeline
V/C/R: alat geser/potong/rentang | [ / ]: marker sebelumnya/berikutnya
G: automation | P: presisi | Ctrl+G: grup | Ctrl+Shift+G: pisah grup
Ctrl+L: kunci klip | Ctrl+Shift+H: riwayat dan cadangan versi
Menu Ripple: mati / track edit / semua track | N: snap | ?: shortcut lengkap

Batas: impor 100 MB/berkas, total PCM 256 MB, proyek 400 MB,
ekspor dan loop 15 menit. Rekam mono maksimal 15 menit atau sisa memori.
Proyek lama tetap dapat dibuka. Proyek dengan status aktivasi efek memakai
format v4 dan memerlukan KurAudio 0.9 atau lebih baru; proyek lainnya tetap v3.
Preset pribadi tersimpan di komputer ini; simpan .kura untuk arsip proyek.
Semua audio diproses lokal. Rilis ini belum ditandatangani sertifikat penerbit.

Encoder MP3: LAME / @breezystack/lamejs, LGPL-3.0.
Lisensi, sumber library, serta kode aplikasi untuk membangun ulang tersedia
di folder third-party. Lihat THIRD-PARTY.txt dan third-party/lamejs/SOURCE.txt.
`,'utf8');
const thirdParty=path.join(portable,'third-party');
await fs.mkdir(path.join(thirdParty,'lamejs'),{recursive:true});
for(const name of ['SOURCE.txt','LICENSE-upstream.txt','LGPL-3.0.txt','GPL-3.0.txt','lamejs.js','upstream-source-1.2.7.zip'])await fs.copyFile(path.join(root,'third-party/lamejs',name),path.join(thirdParty,'lamejs',name));
await fs.cp(path.join(root,'third-party/relink'),path.join(thirdParty,'relink'),{recursive:true});
let notices='KurAudio uses third-party open source components.\n\nDirect runtime components:\nTauri / Tauri Dialog / Tauri Single Instance: MIT OR Apache-2.0, https://github.com/tauri-apps/tauri\nSymphonia 0.5.5: MPL-2.0, unmodified upstream source at https://crates.io/crates/symphonia/0.5.5\nHound 3.5.1: Apache-2.0, https://github.com/ruuda/hound\nBase64, serde, serde_json, tempfile: MIT OR Apache-2.0\nReact, React DOM, Scheduler and Phosphor Icons: MIT\n\nThe source project includes package-lock.json and Cargo.lock for exact versions.\nMicrosoft Edge WebView2 is a system runtime governed by Microsoft terms.\n\n';
notices+='MP3 encoder: @breezystack/lamejs 1.2.7 / LAME, LGPL-3.0. https://lame.sourceforge.net/\nUnmodified library source, license texts, application source and relinking instructions are in third-party/.\n';
for(const pkg of ['react','react-dom','scheduler','@phosphor-icons/react','@breezystack/lamejs']){
  try{const license=await fs.readFile(path.join(root,'node_modules',pkg,'LICENSE'),'utf8');notices+=`\n=== ${pkg} ===\n${license}\n`;}catch{}
}
const registry=path.join(os.homedir(),'.cargo/registry/src');
for(const index of await fs.readdir(registry))for(const pkg of ['symphonia-0.5.5','hound-3.5.1','tauri-2.12.5','tauri-plugin-dialog-2.8.3','tauri-plugin-single-instance-2.5.4']){
  const folder=path.join(registry,index,pkg);
  try{for(const file of await fs.readdir(folder)){if(/^LICENSE|^COPYING/i.test(file)){const filePath=path.join(folder,file);if((await fs.stat(filePath)).isFile())notices+=`\n=== ${pkg} / ${file} ===\n${await fs.readFile(filePath,'utf8')}\n`;}}}catch{}
}
await fs.writeFile(path.join(portable,'THIRD-PARTY.txt'),notices,'utf8');
for(const file of [path.join(portable,'KurAudio.exe'),path.join(release,`KurAudio-${version}-x64-setup.exe`)])console.log(`${file} | ${((await fs.stat(file)).size/1048576).toFixed(2)} MiB`);
