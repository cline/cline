<div align="center">
<sub>

[English](../../CONTRIBUTING.md) • [Català](../ca/CONTRIBUTING.md) • [Deutsch](../de/CONTRIBUTING.md) • [Español](../es/CONTRIBUTING.md) • [Français](../fr/CONTRIBUTING.md) • [हिंदी](../hi/CONTRIBUTING.md) • <b>Bahasa Indonesia</b> • [Italiano](../it/CONTRIBUTING.md) • [日本語](../ja/CONTRIBUTING.md)

</sub>
<sub>

[한국어](../ko/CONTRIBUTING.md) • [Nederlands](../nl/CONTRIBUTING.md) • [Polski](../pl/CONTRIBUTING.md) • [Português (BR)](../pt-BR/CONTRIBUTING.md) • [Русский](../ru/CONTRIBUTING.md) • [Türkçe](../tr/CONTRIBUTING.md) • [Tiếng Việt](../vi/CONTRIBUTING.md) • [简体中文](../zh-CN/CONTRIBUTING.md) • [繁體中文](../zh-TW/CONTRIBUTING.md)

</sub>
</div>

# Berkontribusi pada Roo Code

Roo Code adalah proyek yang didorong oleh komunitas, dan kami sangat menghargai setiap kontribusi. Untuk memperlancar kolaborasi, kami beroperasi berdasarkan pendekatan [Issue-First](#issue-first-approach), yang berarti semua [Pull Request (PR)](#submitting-a-pull-request) harus terlebih dahulu ditautkan ke GitHub Issue. Harap tinjau panduan ini dengan cermat.

## Daftar Isi

- [Sebelum Kamu Berkontribusi](#before-you-contribute)
- [Mencari & Merencanakan Kontribusi Kamu](#finding--planning-your-contribution)
- [Proses Pengembangan & Pengiriman](#development--submission-process)
- [Legal](#legal)

## Sebelum Kamu Berkontribusi

### 1. Kode Etik

Semua kontributor harus mematuhi [Kode Etik](./CODE_OF_CONDUCT.md) kami.

### 2. Peta Jalan Proyek

Peta jalan kami memandu arah proyek. Selaraskan kontribusi kamu dengan tujuan utama ini:

### Keandalan Utama

- Pastikan pengeditan diff dan eksekusi perintah secara konsisten dapat diandalkan.
- Kurangi titik gesekan yang menghalangi penggunaan rutin.
- Jamin operasi yang lancar di semua lokal dan platform.
- Perluas dukungan yang kuat untuk berbagai penyedia dan model AI.

### Pengalaman Pengguna yang Ditingkatkan

- Sederhanakan UI/UX untuk kejelasan dan intuitivitas.
- Terus tingkatkan alur kerja untuk memenuhi ekspektasi tinggi yang dimiliki developer terhadap tools penggunaan sehari-hari.

### Memimpin dalam Performa Agen

- Tetapkan benchmark evaluasi komprehensif (evals) untuk mengukur produktivitas dunia nyata.
- Permudah semua orang untuk menjalankan dan menafsirkan evals ini.
- Kirimkan perbaikan yang menunjukkan peningkatan jelas dalam skor eval.

Sebutkan keselarasan dengan area ini di PR kamu.

### 3. Bergabung dengan Komunitas Roo Code

- **Utama:** Bergabunglah dengan [Discord](https://discord.gg/roocode) kami dan DM **Hannes Rudolph (`hrudolph`)**.
- **Alternatif:** Kontributor berpengalaman dapat berinteraksi langsung melalui [GitHub Projects](https://github.com/orgs/RooCodeInc/projects/1).

## Mencari & Merencanakan Kontribusi Kamu

### Jenis Kontribusi

- **Perbaikan Bug:** Mengatasi masalah kode.
- **Fitur Baru:** Menambahkan fungsionalitas.
- **Dokumentasi:** Meningkatkan panduan dan kejelasan.

### Pendekatan Issue-First

Semua kontribusi harus dimulai dengan GitHub Issue.

- **Periksa isu yang ada**: Cari di [GitHub Issues](https://github.com/RooCodeInc/Roo-Code/issues).
- **Buat isu**: Gunakan template yang sesuai:
    - **Bug:** Template "Bug Report".
    - **Fitur:** Template "Detailed Feature Proposal". Persetujuan diperlukan sebelum memulai.
- **Klaim isu**: Beri komentar dan tunggu penugasan resmi.

**PR tanpa isu yang disetujui dapat ditutup.**

### Memutuskan Apa yang Akan Dikerjakan

- Periksa [GitHub Project](https://github.com/orgs/RooCodeInc/projects/1) untuk "Good First Issues" yang belum ditugaskan.
- Untuk dokumen, kunjungi [Roo Code Docs](https://github.com/RooCodeInc/Roo-Code-Docs).

### Melaporkan Bug

- Periksa laporan yang ada terlebih dahulu.
- Buat bug baru menggunakan ["Bug Report" template](https://github.com/RooCodeInc/Roo-Code/issues/new/choose).
- **Masalah keamanan**: Laporkan secara pribadi melalui [security advisories](https://github.com/RooCodeInc/Roo-Code/security/advisories/new).

## Proses Pengembangan & Pengiriman

### Setup Pengembangan

1. **Fork & Clone:**

```
git clone https://github.com/YOUR_USERNAME/Roo-Code.git
```

2. **Install Dependencies:**

```
pnpm install
```

3. **Debugging:** Buka dengan VS Code (`F5`).

### Panduan Menulis Kode

- Satu PR yang fokus per fitur atau perbaikan.
- Ikuti praktik terbaik ESLint dan TypeScript.
- Tulis commit yang jelas dan deskriptif yang merujuk pada isu (misalnya, `Fixes #123`).
- Sediakan pengujian menyeluruh (`npm test`).
- Rebase ke branch `main` terbaru sebelum pengiriman.

### Mengirimkan Pull Request

- Mulai sebagai **Draft PR** jika mencari feedback awal.
- Jelaskan perubahan kamu dengan jelas mengikuti Template Pull Request.
- Sediakan screenshot/video untuk perubahan UI.
- Tunjukkan jika pembaruan dokumentasi diperlukan.

### Kebijakan Pull Request

- Harus merujuk pada isu yang telah disetujui dan ditugaskan sebelumnya.
- PR tanpa kepatuhan terhadap kebijakan dapat ditutup.
- PR harus lulus tes CI, selaras dengan peta jalan, dan memiliki dokumentasi yang jelas.

### Proses Review

- **Triage Harian:** Pemeriksaan cepat oleh maintainer.
- **Review Mendalam Mingguan:** Penilaian komprehensif.
- **Iterasi segera** berdasarkan feedback.

## Legal

Dengan berkontribusi, kamu setuju kontribusi kamu akan dilisensikan di bawah Lisensi Apache 2.0, konsisten dengan lisensi Roo Code.
