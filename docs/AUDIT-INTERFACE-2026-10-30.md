# Audit dan perbaikan interface KurAudio

## Arah desain

Editor audio desktop untuk editing cepat: graphite netral, chrome tenang, timeline sebagai area kerja utama, biru untuk aksi dan seleksi, amber/violet untuk membedakan track, merah untuk mikrofon. Referensi macOS dipakai pada hierarki jendela, pemisahan sidebar, grouped controls, dan feedback. Tidak menambahkan dekorasi, hero pemasaran, atau copy promosi.

Referensi primer: [Designing for macOS](https://developer.apple.com/design/human-interface-guidelines/designing-for-macos/), [Toolbars](https://developer.apple.com/design/human-interface-guidelines/toolbars), [Sidebars](https://developer.apple.com/design/human-interface-guidelines/sidebars).

## Temuan dan implementasi

| Prioritas | Temuan | Perbaikan |
| --- | --- | --- |
| Major | Banyak label penting 9–11 px; hierarki nama, metadata, dan heading sulit dibedakan. | Nama media/track/klip serta heading panel dinaikkan ke 12–13 px; judul bagian properti diperjelas; footer 11 px. Metadata sekunder tetap lebih kecil untuk editor yang padat. |
| Major | Alat yang terpilih melebar sendiri; alat tetangga bergeser ketika mengganti mode. | Lebar setiap mode tetap. Semua label tampil jika editor cukup lebar; semua menjadi ikon pada ruang sempit. Container query mengikuti lebar editor aktual setelah resize sidebar. |
| Major | Header track 152 px membatasi nama dan panjang fader. | Diperlebar ke 176 px. Token CSS dan konstanta pointer/zoom/playhead disinkronkan, diuji terhadap ukuran elemen sebenarnya. Lock dipisahkan ke kanan dari M/S. |
| Major | Panel bertumpuk secara visual seperti kartu terpisah; terlalu banyak pill dan garis dengan bobot sama. | Sidebar menyatu dengan jendela; celah antar panel dihapus, batas area dibuat hairline, search dan tombol memakai radius yang lebih kecil. Transport mendapat display waktu yang jelas. |
| Major | Beranda kosong kurang menjelaskan area drop yang sudah didukung. | Jendela proyek terstruktur dengan new/open, area drop audio/.kura yang terlihat, serta daftar proyek terakhir. Drop seluruh jendela tetap berfungsi. |
| Minor | Efek tampil seperti kumpulan section terpisah dengan banyak garis dan jarak. | Satu daftar efek dengan radius luar bersama, baris ringkas, status aktif lebih tegas, kontrol hanya terbuka saat switch aktif. Room menjadi grouped control. |
| Minor | Dark theme condong ke hijau/teal dan sulit memisahkan canvas dari chrome. | Token graphite netral, canvas lebih gelap, track tetap memakai warna semantik. Light theme mempertahankan permukaan terang dan warna track yang memenuhi kontras. |
| Minor | Toolbar bisa kekurangan ruang ketika kedua sidebar diperlebar. | Label sekunder menyesuaikan ruang, kontrol timeline membungkus ke baris berikutnya pada editor sempit; tidak dibuang atau ditutup panel lain. |

## Batas perubahan

Tidak mengubah DSP, import, save/close, focus routing, shortcut Space, undo/redo, model clip, atau algoritme trim. `contain: layout paint` pada header track dan `content-visibility` pada klip dipertahankan. Efek tetap memakai switch dan animasi reveal yang sudah mendukung reduced motion. Tidak menambahkan motion pada posisi waveform, playhead, atau trim.

Sumber tema tetap `design-tokens.json`; `src/theme.css` dihasilkan `scripts/theme.mjs`. CSS bersama diperbaiki di `studio7.css` dan menu di `app-menus.css`, tanpa memasang UI framework baru. Warna awal jendela native dan metadata HTML disamakan dengan warna halaman agar tidak memakai graphite lama saat startup.

## Bukti pemeriksaan

- `npm run build`: berhasil (TypeScript dan Vite). Peringatan bundle utama >500 kB tetap ada, sekitar 605 kB; bukan kegagalan build.
- `npm run test:interface`: 16 kasus layout/aksesibilitas berhasil pada run final. Home dark/light, editor 900/1024/1280/1440, kedua sidebar maksimum, efek off/on dark/light, dan settings. Tidak ada exception aplikasi atau pelanggaran axe A/AA yang terdeteksi pada state yang diperiksa. Ini bukan sertifikasi aksesibilitas seluruh aplikasi.
- Tool modes tidak bergeser saat diganti; header CSS, pointer geometry, dan ukuran aktual sama; popover workspace berada dalam batas jendela.
- Run awal `npm run test:polish` berhenti karena browser crash pada suite focus; sesudah itu PowerShell juga sempat gagal memulai proses (exit -1073741502). Uji focus secara terpisah kemudian berhasil seluruh 12 pemeriksaan, termasuk Space setelah menutup settings/popover dan ketika fokus di fade handle. Run penuh diulang; hasil akhir dicatat di bawah.
- Capture sebelum/sesudah: `test-results/interface-audit/before/` dan `after/`. Capture final memicu event perubahan appearance agar canvas waveform ikut menggambar ulang. Snapshot sebelum source: `test-results/interface-audit/before-source.zip`.

## Status distribusi

Perubahan disertakan dalam build Windows 0.11.0 pada 30 Oktober 2026. Native QA lulus 95 pemeriksaan pada lima suite, termasuk appearance, simpan, ekspor, dan close/discard. Hash frontend native QA disimpan untuk dibandingkan dengan build distribusi. Hasil verifikasi artefak ada di `test-results/polish-native/release-verification.json`; instalasi pengguna tidak diganti otomatis.

## Pemeriksaan akhir

- Run ulang `npm run test:polish`: exit 0, 153 unit test pada 14 file dan seluruh 18 suite browser lulus. Suite mencakup Home transport, focus, seleksi, trim, drop/efek, workflow, review, history, live mix, kontinuitas playback, visual, editing effects, review playback, loudness, timeline scroll, motion, advanced editing, dan recording.
- Pemeriksaan akhir interface menambahkan ukuran minimum jendela Windows (900×620) dan memilih tema settings melalui kontrol aplikasi agar state radio sesuai screenshot.
- `node tests/appearance.mjs`: 38 pemeriksaan lulus, termasuk pemulihan tema sebelum frame pertama, pergantian tema sistem tanpa menghentikan playback, repaint canvas timeline/presisi/hening, radio keyboard, increased contrast, menu/ekspor/efek dengan axe, dan settings pada lebar 280–900 px dengan teks diperbesar. Tidak ada renderer error. Kasus increased contrast diuji dengan separator yang lebih kuat; tidak ada klaim seluruh aplikasi sudah tersertifikasi WCAG.
