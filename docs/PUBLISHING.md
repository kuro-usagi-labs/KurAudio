# Source dan rilis Windows

Repository menyimpan bahan yang dibutuhkan untuk memahami, menguji, dan membangun KurAudio. Berkas aplikasi untuk pengguna tersedia di GitHub Releases.

## Isi repository

| Disertakan | Alasan |
| --- | --- |
| `src/`, `public/`, `src-tauri/src/` | Source frontend dan desktop |
| Konfigurasi npm, TypeScript, Vite, dan Tauri | Build dan konfigurasi aplikasi |
| Lockfile npm dan Cargo | Versi dependency yang dapat dilacak |
| `tests/`, skrip pengujian dan packaging | Verifikasi dan pembuatan distribusi |
| Ikon, design tokens, panduan, screenshot, audit versi terkini | Aset aplikasi dan dokumentasi |
| `third-party/lamejs/` termasuk ZIP source upstream | Lisensi dan source encoder untuk relinking |

## Tetap lokal

| Dikecualikan | Alasan |
| --- | --- |
| `node_modules/`, `dist/`, `src-tauri/target/`, `src-tauri/gen/` | Dependency, build, dan skema yang dihasilkan |
| `release/`, `third-party/relink/` | Binary/arsip hasil packaging; unggah sebagai release assets |
| Source upstream yang sudah diekstrak | Salinan ZIP upstream sudah tersedia |
| `test-results/`, laporan Playwright, log | Output tes, profil WebView2, dan fixture yang dihasilkan |
| `.kura` dan berkas audio | Proyek dan rekaman pengguna |
| `.env*`, kunci privat, sertifikat | Kredensial dan konfigurasi pribadi |
| `.superpowers/`, rencana dan review kerja lama | Catatan pengembangan internal |
| `scripts/build-env.ps1` | Helper lokal dengan fallback SDK khusus mesin pengembangan |
| Konfigurasi IDE dan cache TypeScript | Preferensi mesin dan output sementara |

Pengecualian ini tidak menghapus berkas lokal. Nama berkas fixture audio yang sengaja dibagikan harus ditinjau dan ditambahkan secara eksplisit bila kelak diperlukan.

## Pemeriksaan sebelum publikasi

1. Jalankan `npm ci`, `npm test`, dan `npm run build`.
2. Periksa perubahan dan daftar staging; cari kredensial, path pribadi, audio, serta berkas besar yang tidak diperlukan.
3. Untuk binary baru, buat source pendamping dengan `npm run package:source`, lalu build Tauri dari Developer PowerShell Windows x64.
4. Jalankan QA native pada profil terpisah, lalu uji executable yang benar-benar akan dikirim.
5. Pertahankan lisensi dan source/relinking bersama distribusi. Buat checksum SHA-256 untuk installer, portable ZIP, dan source ZIP.
6. Publikasikan tag versi dan release assets. Periksa nama, ukuran, checksum remote, dan tautan unduhan README.

`scripts/verify-release.ps1` memerlukan hasil native QA lokal dan artefak NSIS. Script itu bukan pengganti smoke test atau validasi instalasi bersih.

## Publikasi 0.11.0

Source dan binary Windows sudah ada sebelum repository Git dibuat. Karena itu, histori dimulai dari snapshot aplikasi yang tersedia; tidak ada rekonstruksi commit lama atau tanggal pengerjaan buatan. Identitas commit memakai akun pemilik repository.

Rilis memakai artefak build asli 30 Oktober 2026. Arsip source build asli dipertahankan agar tetap sesuai dengan source pendamping dalam binary; dokumentasi GitHub ditambahkan terpisah. Source aplikasi diperiksa terhadap arsip build sebelum publikasi.

Pemeriksaan publikasi: 153 tes unit dan 7 smoke check pada executable Windows lulus. Checksum installer, portable ZIP, source ZIP, dan executable portable cocok dengan manifest asli. Audit native lama tetap merupakan bukti historis; pengujian installer pada Windows bersih belum dilakukan.

Belum ada lisensi untuk kode aplikasi yang ditetapkan. Jangan menambahkan label MIT, GPL, atau lisensi lain ke KurAudio tanpa keputusan pemilik; lisensi dependency tetap harus dipenuhi.

Pemeriksaan dependency npm pada persiapan publikasi melaporkan 0 kerentanan; build frontend produksi lulus. Vite memberi peringatan ukuran chunk utama di atas 500 kB, yang tidak menggagalkan build. Ini bukan audit keamanan lengkap atas dependency Rust atau seluruh aplikasi.
