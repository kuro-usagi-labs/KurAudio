# KurAudio 0.11.0 — konsistensi editing

Status: build Windows dan native QA 0.11.0 lulus pada 30 Oktober 2026. Baseline audit: `AUDIT-POLISH-2026-10-29.md`. Rencana: `superpowers/plans/2026-10-29-kuraudio-polish.md`. Perbaikan interface: `AUDIT-INTERFACE-2026-10-30.md`.

## Perubahan

- Ctrl+S/Save As bekerja dari field teks/angka/slider. Draft valid dikomit sebelum snapshot; nilai invalid memblokir simpan. Pengetikan, IME, switch keyboard, menu dan dialog mempertahankan konteks lokal.
- Rename dan volume memakai satu transaksi per interaksi; Escape/cancel mengembalikan draft, termasuk nilai gain linear asli. Gerakan mouse setelah Escape tidak boleh memulai transaksi baru sampai tombol dilepas.
- Undo/Redo mempertahankan pilihan klip yang masih ada. Rentang dipertahankan hanya jika susunan audio tidak berubah; navigasi snapshot eksplisit mereset konteks.
- Mute/Solo/gain diperbarui pada graph audio dengan ramp pendek. Track muted sejak awal tetap dapat di-unmute. Loop memakai stem per track pada clock yang sama; pembaruan efek mengganti stem dengan crossfade pendek.
- Seek mempertahankan status putar/jeda. Pause membatalkan persiapan dan seek tertunda; klik kanan ruler tidak memindahkan playhead. Perubahan struktural, termasuk crossfade, menghentikan graph lama.
- Draft nama dilindungi ketika menutup aplikasi. Scope/batas audisi dipertahankan saat efek berubah selama persiapan; penyelesaian denoise mempertahankan mix terbaru.
- Nilai gain dipisahkan dari baris M/S/lock dan tidak membungkus. Preview fader hanya memperbarui header track. Konten klip di luar viewport memakai rendering otomatis browser untuk mengurangi biaya paint tanpa menghapus elemen dari navigasi keyboard.
- Interface memakai graphite netral, label lebih terbaca, sidebar menyatu dengan jendela, mode alat dengan posisi tetap, header track 176 px, daftar efek ringkas, serta area drop yang jelas di beranda. Layout beradaptasi terhadap lebar editor aktual ketika panel di-resize; tema terang dan gelap tetap tersedia.

## Bukti dan batas

Gate browser `npm run test:polish` lulus: 153 tes unit (14 file), Home/transport, fokus, selection comfort, trim (35), drop/efek (33), polish workflow, review regressions, history (11), live mix, transport continuity, visual light/dark, editing/efek (33), review playback, loudness, timeline scroll, motion (25), advanced editing/export, dan recording sintetis. Hasil tersimpan di `test-results/polish-gate`, `polish-workflow`, `polish-visual`, dan `polish-performance`. Review independen menemukan enam kasus tepi yang diperbaiki dengan tes regresi.

Build frontend produksi dan build Windows Rust lulus. Kendala memori virtual pada percobaan sebelumnya sudah teratasi pada build 30 Oktober. Native QA memakai identifier dan profil WebView2 terisolasi: 95 pemeriksaan lulus dalam lima suite (drop/efek 14, lifecycle 22, Studio7 26, advanced 16, appearance 17). Termasuk simpan Rust, ekspor WAV/MP3, draft rename saat tutup, Cancel/Discard/Save, restart proses, rekam sintetis, dan tema Windows. Tidak ada aplikasi/proses pengguna yang dihentikan.

Artefak distribusi diverifikasi oleh `scripts/verify-release.ps1`: versi/identifier produksi, hash frontend yang sama dengan native QA, source yang cocok dengan workspace, executable portable/ZIP yang identik, serta resource lisensi installer. Hasil tercatat di `test-results/polish-native/release-verification.json` dan `release/SHA256SUMS-0.11.0.txt`. Native installer tidak dijalankan untuk mengganti instalasi pengguna secara otomatis.

Benchmark produksi sintetis 100/500/1000 klip: p95 preview fader sekitar 16.7–16.8 ms pada mesin uji. Commit 1000 klip masih sekitar 200 ms; ini bukan klaim seluruh operasi bebas latensi. Ukuran heap, hardware, durasi Undo/commit, dan sampel frame dicatat dalam JSON. Angka baseline dev dan produksi tidak dibandingkan sebagai benchmark setara.

Buffer stem loop dibatasi 256 MB sebelum alokasi (di luar batas media decoded). Loop dengan banyak track/panjang dapat meminta pengguna memperpendek rentang; format proyek dan batas ekspor tidak berubah. Pembatalan preparation diperiksa sebelum merender track berikutnya.

Pengujian mikrofon otomatis memakai input sintetis. Pencabutan perangkat fisik, kualitas suara subjektif pada perangkat pengguna, touch/pen nyata, dan seluruh kombinasi scaling Windows belum dapat disertifikasi oleh tes browser.
