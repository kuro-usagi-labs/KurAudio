# KurAudio 0.11.0

Editor audio desktop Windows dengan timeline multi-track. Dibuat untuk alur potong, geser, trim, sambung dan ekspor audio seperti menggunakan editor video. Antarmuka bahasa Indonesia. Pemrosesan lokal tanpa akun, cloud, atau FFmpeg.

## Jalankan aplikasi

- Jalankan `release/KurAudio-0.11.0-windows/KurAudio.exe` untuk versi portabel.
- Atau instal melalui `release/KurAudio-0.11.0-x64-setup.exe`.
- Membutuhkan Windows 10/11 x64 dan Microsoft Edge WebView2 Runtime. Komputer pengembangan sudah memiliki runtime ini. Installer dapat menawarkan pemasangan runtime jika belum tersedia.
- Rilis lokal ini belum ditandatangani sertifikat penerbit.

## Layar awal

**Pengaturan → Umum → Tampilan** menyediakan **Terang**, **Gelap**, dan **Sistem**. Mode terang memakai chrome abu-abu lembut, kanvas putih, aksen biru, dan mikrofon merah. Sistem mengikuti perubahan tema Windows; pilihan manual tetap dipertahankan. Pilihan tersimpan terpisah dari proyek dan diterapkan langsung, termasuk waveform, detail Presisi, preview hening, menu, dialog, dan jendela Windows. Pilihan lama tetap Gelap sampai diubah. Audit dan hasil pengujian ada di `docs/AUDIT-0.11.0.md`.

Topbar tersedia di beranda dan editor. **File** memuat baru/buka/proyek terakhir, impor ke Media, simpan/simpan sebagai, ekspor, tutup proyek dan keluar Windows. **Edit** memakai perintah editor yang sama untuk Undo/Redo, clipboard, cut, grup dan kunci. **Window** menampilkan/menyembunyikan Media, Riwayat dan Properti/Efek, serta memilih layout Editing, Fokus timeline atau Mixing. Layout dan ukuran panel tetap tersimpan per proyek; Fokus timeline tidak dibatalkan ketika klip dipilih.

**Pengaturan** (Ctrl+,) menyimpan preferensi aplikasi terpisah dari audio: animasi mengikuti sistem/minimal, volume pratinjau Media, default snapping/zero crossing/fade aman/follow untuk proyek baru, serta cadangan otomatis setiap 30/60/120 detik setelah edit berhenti. Reset pengaturan tidak mengubah isi proyek atau tampilan proyek yang sudah disimpan. Pengaturan berlaku langsung untuk animasi/preview/cadangan; default editing dipakai saat membuka workspace proyek yang belum pernah disimpan. Jika penyimpanan preferensi ditolak, pilihan tetap berlaku untuk sesi itu dan status menampilkan kegagalannya.

**Bantuan** memuat pintasan dan versi aplikasi. F10 memfokuskan menu, panah dan huruf awal menavigasi; Escape/F10 keluar, Tab berpindah ke kontrol berikutnya. Alt+F/E/W/P/B membuka menu terkait. Ctrl+Q dan File → Keluar memakai pengaman tutup Windows yang sama.

Pilih **Proyek baru** (Ctrl+N) untuk membuka timeline kosong, atau **Buka dari berkas** (Ctrl+O) untuk memuat `.kura` beserta audio tertanam. Jatuhkan satu atau beberapa audio langsung ke beranda untuk membuat proyek baru. Audio langsung disusun berurutan di timeline dan sumbernya tersedia di Media. Berkas `.kura` juga bisa dijatuhkan langsung untuk membuka proyek. Berkas gagal dibaca dilaporkan tanpa membatalkan audio lain yang valid. Klik logo **KurAudio** di editor untuk kembali ke beranda; perubahan belum disimpan melewati dialog simpan terlebih dahulu. Pemulihan sesi setelah crash tetap ditawarkan sebelum memilih proyek.

Beranda menampilkan hingga delapan proyek terakhir yang berhasil dibuka/disimpan. Desktop membuka berkas dari lokasi aslinya; tombol hapus hanya melupakan entri daftar. Zoom, posisi gulir, alat, ukuran panel/track dan opsi mengikuti playhead dipulihkan terpisah untuk setiap proyek. Pada browser, daftar terakhir menyimpan salinan lokal dari berkas yang dibuka/diunduh, dengan batas total 64 MiB; berkas `.kura` tetap menjadi arsip utama.

## Efek klip

Pilih klip lalu tekan E. Nyalakan switch efek untuk mengaktifkan dan menampilkan slider; matikan untuk menyembunyikannya. Switch mengikuti referensi macOS: kapsul biru dan knob putih, dengan animasi geser 220 ms serta buka/tutup kontrol yang halus. Animasi mengikuti pengaturan gerakan sistem dan aplikasi. Nilai tetap tersimpan saat efek mati, termasuk intensitas nol yang disengaja. EQ dapat aktif dengan kedua band netral. Tombol Bypass membandingkan hasil tanpa menghapus pilihan efek. Undo, preset pribadi, simpan proyek dan recovery mempertahankan status serta parameter. Preset lama tetap terbaca; preset baru disimpan terpisah agar versi lama tidak menerapkan efek yang telah dimatikan.

## Studio 0.7

Identitas KurAudio memakai monogram K/wave, permukaan graphite, aksen ice blue, amber dan lavender, serta mikrofon merah. Beranda berupa daftar proyek dengan dua aksi utama. Media dan Riwayat berbagi navigasi panel; Properti, Efek dan Presisi berada dalam inspector yang sama. Popup menyesuaikan ruang jendela dan kembali ke pemicunya lewat Escape. Gerakan klip tetap mengikuti pointer tanpa animasi yang menunda trim.

- **Presisi (P):** detail PCM lokal dengan zoom hingga sampel; panah menggeser satu sampel, Shift+panah sepuluh sampel. Klik waveform atau isi titik edit, lalu potong atau jadikan batas trim. Snap zero crossing dan fade aman 3 ms dapat dinyalakan. Fade aman dibentuk pada envelope hasil cut; sumber audio tetap utuh.
- **Grup dan kunci:** tarik area kosong dengan V untuk seleksi kotak, Shift untuk menambah. Ctrl+G mengelompokkan; Ctrl+Shift+G memisahkan. Ctrl+L mengunci/membuka klip. Kunci pada header track melindungi penempatan audio tetapi kontrol mixer tetap bisa dipakai. Grup bergerak bersama; klik kanan satu anggota dapat membuka efek/presisi anggota tersebut, dengan tombol kembali ke pilihan.
- **Automation (G):** klik garis volume pada klip untuk membuat titik, tarik untuk mengubah waktu/level. Titik mendukung keyboard dan hapus; Escape membatalkan gesture dan satu Undo mengembalikan satu drag. Automation terpisah dari fade/crossfade dan ikut dislice saat trim/cut.
- **Ripple:** menu panah horizontal di timeline memilih Mati, Track edit, atau Semua track. Move, trim kanan, insert, paste dan delete memakai cakupan yang sama; trim kiri mempertahankan ujung akhir. Grup/klip/track terkunci tetap menjadi jangkar. Insert terlalu dekat tepi klip ditolak agar tidak membuat potongan di bawah 20 ms, dengan pesan dan seleksi yang tetap utuh.
- **Loudness:** Alat audio → Loudness mengukur LUFS terintegrasi dan true peak, lalu menyamakan level klip dengan target dan batas peak. Penguatan ditempatkan setelah efek. Target yang terbentur headroom ditandai; tidak ada limiter tersembunyi. Analisis memakai hasil stereo 48 kHz beserta ekor efek, tanpa mixer track. Klip di bawah 400 ms atau di bawah gate tidak dipaksa mendapat hasil. Setelah diterapkan, normalisasi peak ekspor dimatikan; pilihan ekspor tetap dapat diubah secara eksplisit.
- **Riwayat (Ctrl+Shift+H):** pilih langkah bernama untuk kembali/maju dalam sesi; maksimal 100 keadaan. Tab Cadangan menyimpan versi manual, saat simpan, dan setelah 30 detik edit berhenti. Audio didedup; batas 12 versi/proyek, 32 total dan 192 MiB audio unik. Pemulihan versi memeriksa integritas dan mendekode audio sebelum mengganti keadaan, serta tetap meminta penanganan perubahan belum disimpan. Cadangan lokal terpisah dari recovery dan berkas `.kura`.

Rekam pada track terkunci membuat track baru. Jika batas track tercapai atau ripple menolak insert, take tetap disimpan di Media. Pemangkasan hening hanya menganalisis audio yang dapat diedit. Proyek dengan status aktivasi efek ditulis dalam format **v4** agar versi lama tidak memainkan efek yang telah dimatikan. Proyek tanpa metadata tersebut tetap v3. KurAudio 0.9 membaca v1/v2/v3/v4; berkas v4 memerlukan KurAudio 0.9 atau lebih baru.

## Dengar, rapikan, ulangi

- Klik ikon putar pada media atau fokuskan barisnya lalu **Space** untuk preview sebelum ditempatkan. Panel preview memiliki posisi dan volume sendiri. **Enter** tetap menambahkan media ke timeline.
- **Shift+Space** mendengarkan rentang atau klip terpilih satu kali. **Alt+Space** mendengarkan satu detik sebelum/sesudah playhead. **Shift+Enter** kembali ke awal playback terakhir. Pilihan yang sama tersedia pada menu **Dengar ulang** di transport.
- Klik kanan klip atau tekan **Shift+F10** untuk split, cut/copy/paste, duplikat, hapus, sambung, efek dan ekspor pilihan. Seleksi beberapa klip tetap dipertahankan.
- Tarik pegangan fade pada klip; waveform dan envelope berubah langsung, satu Undo membatalkan gesture. Escape membatalkan drag. Klip yang terlalu sempit memakai kontrol fade di Properti.
- Tarik batas Media/Properti atau buka **Tampilan workspace** untuk mengatur lebar panel, tinggi track dan follow playhead. **Shift+F** memperbesar seleksi, **F** menampilkan keseluruhan timeline. Pengaturan tampilan tidak mengubah isi proyek atau Undo.
- Footer memisahkan status berkas `.kura` dari pemulihan otomatis. Dialog ekspor menampilkan nama akhir, cakupan dan durasi yang dipakai renderer; perkiraan ukuran MP3 bersifat pendekatan.

## Mulai mengedit

1. Klik **Impor audio**, atau jatuhkan audio ke **Media**. Impor menyimpan audio di pustaka dan tidak membuat klip.
2. Tarik audio dari **Media** ke posisi yang diinginkan di timeline. Alternatif keyboard: fokuskan media lalu tekan **Enter** untuk menempatkannya di playhead pada track aktif. Drop berkas langsung pada lane timeline juga menempatkannya di sana.
3. Geser badan klip untuk mengubah posisi. Tarik ujung kiri/kanan untuk trim; waveform, durasi dan fade diperbarui selama drag. Klip tunggal bisa digeser ke track lain. Tarik audio dari Media atau klip ke area kosong di bawah track terakhir untuk membuat track baru saat dilepas.
4. Klik ruler untuk memindahkan playhead. Tekan **Ctrl+B** atau **S** untuk memotong klip terpilih di playhead; tanpa seleksi, semua klip yang dilintasi playhead dipotong. Alat **C** memotong tepat di posisi klik.
5. Tahan **Shift** saat memilih beberapa klip. Klik **Sambungkan** untuk merender seleksi pada track sama menjadi satu klip. Jeda dan overlap dipertahankan. Undo mengembalikan klip asal.
6. Pilih satu klip untuk mengatur posisi, offset, durasi, gain, dan fade di panel **Properti**. Pada jendela 900–1199 piksel, buka panel dari tombol **Properti** di atas timeline. Panel berdampingan dengan timeline dan menyembunyikan Media sementara. Escape menutup panel ringkas tanpa membuang seleksi.
7. Klik **Simpan** untuk menyimpan `.kura` beserta semua audionya. Klik **Ekspor audio** untuk menghasilkan WAV atau MP3 stereo.
8. Pilih klip, lalu tab **Efek** atau **E**. Atur Denoise, Reverb/Decay, Room/ukuran ruangan, Echo/jeda, Bass, Treble, dan Compressor. Setiap efek memiliki kontrol intensitas sendiri. **Bypass** membandingkan dengan audio asli; **Reset efek** mengembalikan nilai awal. Pengaturan disimpan per klip dan ikut ekspor.

Denoise memakai pengurangan noise spektral lokal dengan profil dari bagian paling tenang di sumber. Cocok untuk hiss dan noise konstan, bukan pemisahan vokal atau penghapusan semua suara latar. Intensitas tinggi dapat menipiskan suara. Pemrosesan berjalan di worker setelah slider dilepas; perubahan efek lainnya dapat didengar selama playback.

Versi 0.5 menggunakan workspace charcoal dengan inspirasi macOS. Biru, amber dan lavender membedakan track, klip, waveform serta fader; modul efek memiliki aksen biru, lavender, amber dan coral. Tidak ada hijau. Fader bulat, thumbnail waveform pada Media, dan toolbar memisahkan alat edit dari pengaturan timeline. Panel efek memakai switch on/off: nyalakan untuk aktif dan tampilkan kontrol, matikan untuk menyembunyikan kontrol. Nilai tidak dihapus saat efek dimatikan. Tombol **Rekam** di transport langsung membuka persiapan input. Judul dan close dialog tetap terlihat saat isinya digulir.

Tombol **Buka sesi demo** membuat contoh bunyi sintetis lokal untuk mencoba editor.

Versi 0.6.0 memakai ikon mikrofon merah. Panel Rekam menampilkan track tujuan, waktu mulai dan status; **Ganti mikrofon** melepaskan input sebelum pemilihan ulang. Impor berhasil membuka Media dan membersihkan pencarian lama agar audio baru terlihat. Enter mengembalikan layar sempit ke timeline; fokus tidak mengambil alih kontrol yang baru dipilih pengguna.

## Rentang, crossfade, dan hening

- Tekan **R**, lalu blok waveform untuk memilih rentang pada satu track. **Shift + tarik** memilih waktu yang sama di semua track. Seleksi tidak mengubah sumber. Gunakan **Pisahkan rentang**, **Hapus rentang**, Ctrl+C/X, atau **Ekspor rentang**. Tarik pegangan panah di dalam seleksi untuk memindahkan bagian tersebut langsung; satu Undo mengembalikan operasi penuh. **V** kembali ke alat geser biasa.
- Geser klip hingga bertumpuk dengan klip lain pada track yang sama. Jika keduanya menyambung secara berurutan, crossfade dibuat otomatis. Tarik garis tepi kiri transisi untuk mengatur panjangnya; klik dua kali untuk memenuhi overlap. Fokuskan pegangan lalu Delete untuk menghapus transisi. Crossfade memakai kurva equal-power pada playback, sambung, dan ekspor. Klip yang sepenuhnya berada di dalam klip lain tidak otomatis mendapat crossfade.
- Pilih klip, rentang, atau track aktif, lalu **Alat audio → Pangkas hening**. Atur batas dB, durasi hening minimum, dan jeda yang disisakan. **Analisis hening** menampilkan bagian yang akan dipangkas; **Putar preview** mendengarkan hasil sebelum menerapkan. Opsi **Tutup celah** menggeser audio berikutnya pada track yang dianalisis. Pemangkasan bekerja pada interval track, termasuk klip lain yang overlap di interval tersebut. Undo mengembalikan seluruh pemangkasan sekaligus.

## Marker, loop, preset, dan rekam

**M** menambah marker di playhead; **[ / ]** menuju marker sebelumnya/berikutnya. Nama, waktu, dan penghapusan ada di **Alat audio → Marker & loop**. Marker bisa ditarik pada ruler. **L** mengulang rentang terpilih atau batas loop yang sudah disetel. Batas loop dapat ditarik atau diisi angkanya. Loop maksimal 15 menit dan dirender sebelum mulai agar pengulangan mengikuti clock audio; setelah perubahan efek, hasil loop diperbarui ketika pengaturan dikomit.

Pilih klip, tekan **E**, buka **Preset pribadi**, lalu beri nama dan simpan. Klik nama preset untuk menerapkan seluruh kombinasi denoise, reverb, room, echo, EQ dan compressor. Maksimal 32 preset tersimpan lokal di komputer ini; parameter efek klip tetap ikut proyek `.kura`.

Untuk merekam, pilih track dan playhead tujuan, lalu **Alat audio → Rekam**. Pilih input, klik **Siapkan mikrofon** untuk memberi izin dan melihat meter, lalu **Mulai rekam**. **Stop & tambahkan** menghasilkan klip WAV mono langsung pada track. **Batalkan rekaman** membuang take tersebut. Input tidak dimonitor ke speaker. Menutup jendela saat merekam memfinalisasi take sebelum dialog simpan. Batas rekam adalah 15 menit atau sisa memori audio. Pengujian otomatis memakai input simulasi; perangkat dan izin Windows pada hardware pengguna belum diverifikasi manual.

Ekspor menyediakan cakupan **Seluruh proyek**, **Klip terpilih**, atau **Rentang**, nama berkas, sample rate 44,1/48kHz, normalisasi peak, WAV 16/24-bit, dan MP3 CBR 128/192/256/320kbps. Rentang menghasilkan waktu persis yang dipilih; ekspor klip dimulai dari awal klip dan menyertakan ekor efek. Kurva crossfade tetap dipertahankan ketika mengekspor satu klip.

## Shortcut

| Aksi | Tombol |
|---|---|
| Proyek baru | Ctrl+N |
| Putar / jeda | Space |
| Putar seleksi / dengar sekitar playhead | Shift+Space / Alt+Space |
| Kembali ke awal playback terakhir | Shift+Enter |
| Potong di playhead | Ctrl+B atau S |
| Alat geser / potong / rentang | V / C / R |
| Pilih rentang semua track | Shift + tarik dengan R |
| Tambah marker / loop | M / L |
| Marker sebelumnya / berikutnya | [ / ] |
| Simpan / simpan sebagai | Ctrl+S / Ctrl+Shift+S |
| Buka proyek / impor audio | Ctrl+O / Ctrl+I |
| Undo / redo | Ctrl+Z / Ctrl+Shift+Z atau Ctrl+Y |
| Duplikat / sambung | Ctrl+D / Ctrl+J |
| Copy / cut / paste klip | Ctrl+C / Ctrl+X / Ctrl+V |
| Ekspor audio | Ctrl+E |
| Efek klip terpilih | E |
| Hapus / hapus dan tutup jeda | Delete / Shift+Delete |
| Pilih semua | Ctrl+A |
| Zoom / sesuaikan seluruh timeline | + dan − / F |
| Zoom di posisi kursor | Ctrl + scroll pada timeline |
| Zoom ke seleksi | Shift+F |
| Menu aksi klip | Klik kanan / Shift+F10 |
| Tempatkan media terfokus pada playhead | Enter |
| Preview media terfokus | Space |
| Snapping / abaikan saat drag | N / tahan Alt |
| Awal / akhir timeline | Home / End |
| Geser klip yang mendapat fokus | Panah kiri/kanan, 0,01 s; tambah Shift untuk 1 s |
| Batal mengedit angka | Escape |
| Bantuan | ? |

## Format dan batas

- Impor WAV, MP3, M4A/AAC, FLAC, OGG dan AIFF. Web Audio menjadi decoder pertama; desktop memakai Symphonia sebagai fallback. Dukungan bergantung pada codec dalam kontainer; berkas rusak atau codec yang tidak didukung menghasilkan pesan kesalahan.
- Ekspor WAV PCM16/24-bit atau MP3 CBR 128/192/256/320kbps stereo, 44,1/48kHz. Normalisasi default menyesuaikan peak ke −1dBFS. Track mute/solo, gain, trim, posisi, fade, crossfade dan efek mengikuti preview. Ekor room/reverb/echo disertakan pada ekspor proyek/klip; rentang dibatasi tepat pada waktu terpilih.
- Batas impor 100 MB per berkas; audio yang didekode dibatasi total 256 MB. Ekspor dibatasi 15 menit. Versi ini menyimpan audio dalam RAM dan belum dirancang untuk sesi berjam-jam.
- Proyek `.kura` portabel menyertakan media, termasuk media hasil sambung/rekam. Berkas sumber tidak ditimpa. Proyek dibatasi 400 MB. KurAudio 0.9 membaca format 1, 2, 3 dan 4; format 4 menyimpan aktivasi efek terpisah dari nilainya dan memerlukan versi 0.9 atau lebih baru. Proyek tanpa status aktivasi efek tetap disimpan sebagai v3.
- Pemulihan otomatis disimpan di IndexedDB lokal. Saat aplikasi dibuka kembali, pilih **Pulihkan sesi** atau **Mulai baru**. Untuk penyimpanan jangka panjang, tetap simpan berkas `.kura`.
- Menutup proyek yang berubah menawarkan **Batal**, **Lanjut tanpa simpan**, atau **Simpan & lanjut**. Pembuangan perubahan yang disetujui menghapus sesi pemulihan proyek tersebut. Penutupan tak terduga tetap dapat dipulihkan. Hanya satu instance versi baru yang berjalan agar penulisan pemulihan tidak saling menimpa.
- Belum tersedia: time stretching, plugin VST, automation, dan streaming audio panjang.

## Pengembangan

Stack: Tauri 2/Rust, Symphonia, Hound, React 19, TypeScript, Vite, Canvas, Web Audio API. Lockfile npm dan Cargo disertakan.

```powershell
npm ci
npm run dev              # editor di http://127.0.0.1:1422
npm run tauri -- dev     # desktop development
npm test                # model timeline, fade, riwayat, encoder
npm run test:ui          # membutuhkan dev server dan Chromium Playwright
npm run test:effects     # drop, zoom, live trim, shortcut dan pengukuran efek audio
npm run test:motion      # animasi, focus, Reduce Motion
npm run test:native      # membutuhkan build release; jalankan saat aplikasi ditutup
npm run test:lifecycle   # proses Windows harus benar-benar keluar; profil uji terpisah
npm run test:audit       # storage, file rusak, undo track, waveform panjang, denoise
npm run test:timeline    # clipping playhead, scroll dua arah, Home/End, DPI dan ruler
npm run test:home        # beranda, proyek baru, load file, navigasi, penyimpanan
npm run test:workflow    # track otomatis, pause, potong di playhead dan geser
npm run test:trim        # crop waveform stasioner, grip, cancel, undo dan autoscroll
npm run test:advanced    # rentang, crossfade/DSP, silence preview, MP3, preset, fake mic
npm run test:advanced-native # build QA terpisah; fake mic, CSP, Rust MP3 dan close
npm run test:comfort     # preview/review, workspace, recent, status dan ekspor nyata
npm run test:preview     # clock audio, pembatalan sumber dan volume preview
npm run test:clip-actions # context menu dan gesture/keyboard fade
npm run test:recents     # storage MRU, batas, kegagalan dan reopen
npm run test:review      # endpoint review dan perubahan efek saat review
npm run test:studio      # UI 0.5, keyboard, modul efek, dialog dan responsive
npm run test:flow        # layout ringkas, impor, fokus dan alur rekam
```

Build Windows membutuhkan Rust MSVC, Visual C++ Build Tools dan Windows SDK:

```powershell
# Jalankan dari Developer PowerShell (Visual Studio Build Tools + Windows SDK).
npm run package:source   # sumber & lisensi MP3 yang disertakan dalam rilis
npm run tauri -- build --bundles nsis -- --jobs 2 --locked
```

Pasang Visual Studio Build Tools (Desktop development with C++) dan Windows SDK standar. Helper SDK lokal tidak disertakan dalam repository. Node/Python/FFmpeg tidak diperlukan untuk menjalankan hasil build.

Tema berasal dari `design-tokens.json`; `scripts/theme.mjs` menghasilkan `src/theme.css` saat build. Timeline geometry menggunakan detik dan piksel, audio scheduling menggunakan clock AudioContext. Preview dan offline export memakai fungsi `scheduleProject` yang sama.

Lihat [audit dan referensi redesign](docs/REDESIGN-0.2.md), [validasi 0.2](docs/QA-0.2.md), [review desain 0.2](docs/DESIGN-REVIEW-0.2.md), dan [rencana awal](docs/PLAN.md).

Perubahan alur media, shortcut, live trim, efek dan hasil pengujiannya ada di [catatan 0.3](docs/EDITOR-0.3.md).

Perbaikan fatal penutupan Windows dan audit lanjutan ada di [audit 0.3.1](docs/AUDIT-0.3.1.md).

Perbaikan playhead yang masuk ke panel track dan scroll playback ada di [catatan 0.3.2](docs/AUDIT-0.3.2.md).

Interaksi trim dengan waveform yang tetap di tempat, pegangan tepi dan autoscroll diperbaiki di [catatan 0.3.3](docs/AUDIT-0.3.3.md). Simpan proyek dan tutup versi lama sebelum membuka executable baru.

Track otomatis dari drag dan shortcut Ctrl+B dijelaskan di [catatan 0.3.4](docs/AUDIT-0.3.4.md). Space tetap bekerja saat klip mendapat fokus.

Layar awal dan navigasi proyek dijelaskan di [catatan 0.3.5](docs/AUDIT-0.3.5.md).

Tujuh fitur pengeditan 0.4 serta hasil pengujiannya ada di [audit 0.4.0](docs/AUDIT-0.4.0.md). Encoder MP3 menggunakan @breezystack/lamejs 1.2.7/LAME(LGPL-3.0), tanpa modifikasi. Lisensi, sumber upstream yang tepat, dan petunjuk membangun ulang dengan library modifikasi disertakan dalam `third-party/`. Arsip kode aplikasi juga tersedia pada rilis dan installer.

Redesign antarmuka 0.5 dijelaskan pada [rencana dan audit desain](docs/REDESIGN-0.5.md) serta [verifikasi rilis](docs/AUDIT-0.9.1.md).
