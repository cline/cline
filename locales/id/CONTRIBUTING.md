<div align="center">
<sub>

[English](../../CONTRIBUTING.md) • [Català](../ca/CONTRIBUTING.md) • [Deutsch](../de/CONTRIBUTING.md) • [Español](../es/CONTRIBUTING.md) • [Français](../fr/CONTRIBUTING.md) • [हिंदी](../hi/CONTRIBUTING.md) • <b>Bahasa Indonesia</b> • [Italiano](../it/CONTRIBUTING.md) • [日本語](../ja/CONTRIBUTING.md)

</sub>
<sub>

[한국어](../ko/CONTRIBUTING.md) • [Nederlands](../nl/CONTRIBUTING.md) • [Polski](../pl/CONTRIBUTING.md) • [Português (BR)](../pt-BR/CONTRIBUTING.md) • [Русский](../ru/CONTRIBUTING.md) • [Türkçe](../tr/CONTRIBUTING.md) • [Tiếng Việt](../vi/CONTRIBUTING.md) • [简体中文](../zh-CN/CONTRIBUTING.md) • [繁體中文](../zh-TW/CONTRIBUTING.md)

</sub>
</div>

# Berkontribusi pada Roo Code

Roo Code adalah proyek yang digerakkan oleh komunitas, dan kami sangat menghargai setiap kontribusi. Untuk menyederhanakan kolaborasi, kami beroperasi dengan dasar [Pendekatan Masalah-Dulu](#pendekatan-masalah-dulu), yang berarti semua [Pull Request (PR)](#mengajukan-pull-request) harus terlebih dahulu ditautkan ke Masalah GitHub. Harap tinjau panduan ini dengan cermat.

## Daftar Isi

- [Sebelum Anda Berkontribusi](#sebelum-anda-berkontribusi)
- [Menemukan & Merencanakan Kontribusi Anda](#menemukan--merencanakan-kontribusi-anda)
- [Proses Pengembangan & Pengajuan](#proses-pengembangan--pengajuan)
- [Hukum](#hukum)

## Sebelum Anda Berkontribusi

### 1. Kode Etik

Semua kontributor harus mematuhi [Kode Etik](./CODE_OF_CONDUCT.md) kami.

### 2. Peta Jalan Proyek

Peta jalan kami memandu arah proyek. Sejajarkan kontribusi Anda dengan tujuan-tujuan utama ini:

### Keandalan Utama

- Pastikan pengeditan diff dan eksekusi perintah secara konsisten andal.
- Kurangi titik gesekan yang menghalangi penggunaan rutin.
- Jamin kelancaran operasi di semua lokal dan platform.
- Perluas dukungan yang kuat untuk berbagai penyedia dan model AI.

### Pengalaman Pengguna yang Ditingkatkan

- Sederhanakan UI/UX untuk kejelasan dan intuitivitas.
- Terus tingkatkan alur kerja untuk memenuhi harapan tinggi yang dimiliki pengembang untuk alat yang digunakan sehari-hari.

### Memimpin dalam Kinerja Agen

- Tetapkan tolok ukur evaluasi (eval) yang komprehensif untuk mengukur produktivitas dunia nyata.
- Permudah semua orang untuk menjalankan dan menafsirkan eval ini dengan mudah.
- Kirimkan perbaikan yang menunjukkan peningkatan yang jelas dalam skor eval.

Sebutkan keselarasan dengan area-area ini di PR Anda.

### 3. Bergabunglah dengan Komunitas Roo Code

- **Utama:** Bergabunglah dengan [Discord](https://discord.gg/roocode) kami dan kirim DM ke **Hannes Rudolph (`hrudolph`)**.
- **Alternatif:** Kontributor berpengalaman dapat terlibat langsung melalui [Proyek GitHub](https://github.com/orgs/RooCodeInc/projects/1).

## Menemukan & Merencanakan Kontribusi Anda

### Jenis Kontribusi

- **Perbaikan Bug:** Mengatasi masalah kode.
- **Fitur Baru:** Menambahkan fungsionalitas.
- **Dokumentasi:** Meningkatkan panduan dan kejelasan.

### Pendekatan Masalah-Dulu

Semua kontribusi dimulai dengan Masalah GitHub menggunakan template ramping kami.

- **Periksa masalah yang ada**: Cari di [Masalah GitHub](https://github.com/RooCodeInc/Roo-Code/issues).
- **Buat masalah** menggunakan:
    - **Penyempurnaan:** Template "Permintaan Penyempurnaan" (bahasa sederhana yang berfokus pada manfaat pengguna).
    - **Bug:** Template "Laporan Bug" (repro minimal + yang diharapkan vs aktual + versi).
- **Ingin mengerjakannya?** Beri komentar "Mengklaim" pada masalah tersebut dan kirim DM ke **Hannes Rudolph (`hrudolph`)** di [Discord](https://discord.gg/roocode) untuk ditugaskan. Penugasan akan dikonfirmasi di utas.
- **PR harus menautkan ke masalah.** PR yang tidak tertaut dapat ditutup.

### Memutuskan Apa yang Akan Dikerjakan

- Periksa [Proyek GitHub](https://github.com/orgs/RooCodeInc/projects/1) untuk masalah "Masalah [Belum Ditugaskan]".
- Untuk dokumentasi, kunjungi [Dokumentasi Roo Code](https://github.com/RooCodeInc/Roo-Code-Docs).

### Melaporkan Bug

- Periksa laporan yang ada terlebih dahulu.
- Buat bug baru menggunakan [template "Laporan Bug"](https://github.com/RooCodeInc/Roo-Code/issues/new/choose) dengan:
    - Langkah-langkah reproduksi yang jelas dan bernomor
    - Hasil yang diharapkan vs aktual
    - Versi Roo Code (wajib); penyedia/model API jika relevan
- **Masalah keamanan**: Laporkan secara pribadi melalui [saran keamanan](https://github.com/RooCodeInc/Roo-Code/security/advisories/new).

## Proses Pengembangan & Pengajuan

### Pengaturan Pengembangan

1. **Fork & Klon:**

```
git clone https://github.com/NAMA_PENGGUNA_ANDA/Roo-Code.git
```

2. **Instal Ketergantungan:**

```
pnpm install
```

3. **Debugging:** Buka dengan VS Code (`F5`).

### Pedoman Menulis Kode

- Satu PR terfokus per fitur atau perbaikan.
- Ikuti praktik terbaik ESLint dan TypeScript.
- Tulis komitmen yang jelas dan deskriptif yang merujuk pada masalah (mis., `Memperbaiki #123`).
- Sediakan pengujian menyeluruh (`npm test`).
- Rebase ke cabang `main` terbaru sebelum pengajuan.

### Mengajukan Pull Request

- Mulailah sebagai **PR Draf** jika mencari umpan balik awal.
- Jelaskan perubahan Anda dengan jelas mengikuti Templat Pull Request.
- Tautkan masalah di deskripsi/judul PR (mis., "Memperbaiki #123").
- Sediakan tangkapan layar/video untuk perubahan UI.
- Tunjukkan jika pembaruan dokumentasi diperlukan.

### Kebijakan Pull Request

- Harus merujuk pada Masalah GitHub yang ditugaskan. Untuk ditugaskan: beri komentar "Mengklaim" pada masalah tersebut dan kirim DM ke **Hannes Rudolph (`hrudolph`)** di [Discord](https://discord.gg/roocode). Penugasan akan dikonfirmasi di utas.
- PR yang tidak tertaut dapat ditutup.
- PR harus lulus tes CI, selaras dengan peta jalan, dan memiliki dokumentasi yang jelas.

### Proses Peninjauan

- **Triase Harian:** Pemeriksaan cepat oleh pengelola.
- **Tinjauan Mendalam Mingguan:** Penilaian komprehensif.
- **Iterasi dengan cepat** berdasarkan umpan balik.

## Hukum

Dengan berkontribusi, Anda setuju bahwa kontribusi Anda akan dilisensikan di bawah Lisensi Apache 2.0, sesuai dengan lisensi Roo Code.
