# KurAudio 0.11.0 untuk Windows

Rilis publik pertama KurAudio: editor audio desktop berbahasa Indonesia dengan timeline multi-track. Audio diproses lokal, tanpa akun atau unggah ke cloud.

## Unduh

- **KurAudio-0.11.0-x64-setup.exe** — installer Windows 10/11 x64.
- **KurAudio-0.11.0-windows.zip** — versi portable; ekstrak seluruh folder sebelum menjalankan `KurAudio.exe`.
- **KurAudio-0.11.0-source.zip** — source pendamping build asli, termasuk petunjuk dan lisensi dependency.
- **SHA256SUMS.txt** — checksum SHA-256 untuk ketiga berkas di atas.

WebView2 Runtime diperlukan. Installer dapat mengunduhnya jika belum tersedia. Rilis belum ditandatangani sertifikat penerbit; Windows mungkin menampilkan SmartScreen.

## Fitur utama

- Timeline multi-track dengan cut, trim, ripple, grouping, fade, dan crossfade.
- Denoise, EQ, compressor, reverb, room, echo, dan preset per klip.
- Pangkas hening, loudness LUFS/true peak, automation volume, marker, dan loop.
- Rekam mikrofon, simpan proyek `.kura` beserta media, dan cadangan lokal.
- Ekspor WAV 16/24-bit dan MP3 128–320 kbps pada 44,1/48 kHz.
- Tema terang, gelap, atau mengikuti Windows.

Versi 0.11.0 juga merapikan simpan dari field input, transaksi Undo/Redo, perubahan mixer saat playback, seek, toolbar, dan keterbacaan interface.

## Validasi dan batas

Artefak ini adalah build Windows 30 Oktober 2026. Pada persiapan publikasi, 153 tes unit dan 7 pemeriksaan langsung executable Windows lulus; checksum artefak cocok dengan manifest build asli. Audit build sebelumnya mencatat 95 pemeriksaan native QA. Installer belum diuji melalui instalasi ulang pada Windows bersih.

Batas impor 100 MB per berkas, total PCM decoded 256 MB, proyek 400 MB, serta ekspor/loop/rekam maksimal 15 menit. Pengujian mikrofon otomatis menggunakan input sintetis; kualitas dan pergantian perangkat fisik belum disertifikasi untuk semua hardware.

Arsip source yang dilampirkan mempertahankan snapshot build asli. Branch `main` menambahkan dokumentasi publikasi dan screenshot; aplikasi tidak dibangun ulang hanya untuk mengganti dokumentasi.

Panduan penggunaan dan pelaporan masalah ada di [README](https://github.com/kuro-usagi-labs/KurAudio#readme).
