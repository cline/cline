[English](../../CONTRIBUTING.md) • [Català](../ca/CONTRIBUTING.md) • [Deutsch](../de/CONTRIBUTING.md) • [Español](../es/CONTRIBUTING.md) • [Français](../fr/CONTRIBUTING.md) • [हिंदी](../hi/CONTRIBUTING.md) • [Italiano](../it/CONTRIBUTING.md) • [Nederlands](../nl/CONTRIBUTING.md) • [Русский](../ru/CONTRIBUTING.md)

[日本語](../ja/CONTRIBUTING.md) • [한국어](../ko/CONTRIBUTING.md) • [Polski](../pl/CONTRIBUTING.md) • [Português (BR)](../pt-BR/CONTRIBUTING.md) • <b>Türkçe</b> • [Tiếng Việt](../vi/CONTRIBUTING.md) • [简体中文](../zh-CN/CONTRIBUTING.md) • [繁體中文](../zh-TW/CONTRIBUTING.md)

# Roo Code'a Katkıda Bulunma

Roo Code, topluluk odaklı bir projedir ve her katkıyı çok önemsiyoruz. İşbirliğini kolaylaştırmak için [Issue-First](#issue-first-yaklaşımı) yaklaşımıyla çalışıyoruz; bu, tüm [Pull Request'lerin (PR'lar)](#pull-request-gönderme) önce bir GitHub Issue'ya bağlanması gerektiği anlamına gelir. Lütfen bu rehberi dikkatlice incele.

## İçindekiler

- [Katkıdan Önce](#katkıdan-önce)
- [Katkı Bulma & Planlama](#katkı-bulma--planlama)
- [Geliştirme & Gönderim Süreci](#geliştirme--gönderim-süreci)
- [Yasal](#yasal)

## Katkıdan Önce

### 1. Davranış Kuralları

Tüm katkı sağlayanlar [Davranış Kuralları](./CODE_OF_CONDUCT.md)'na uymalıdır.

### 2. Proje Yol Haritası

Yol haritamız projenin yönünü belirler. Katkılarını bu temel hedeflerle uyumlu hale getir:

### Güvenilirlik Öncelikli

- Diff düzenleme ve komut yürütme işlemlerinin sürekli olarak güvenilir olmasını sağlamak
- Düzenli kullanımı engelleyen sürtünme noktalarını azaltmak
- Tüm dillerde ve platformlarda sorunsuz çalışmayı garanti etmek
- Çok çeşitli yapay zeka sağlayıcıları ve modelleri için güçlü desteği genişletmek

### Geliştirilmiş Kullanıcı Deneyimi

- Daha fazla netlik ve sezgisellik için kullanıcı arayüzünü basitleştirmek
- Geliştiricilerin yüksek beklentilerini karşılamak üzere iş akışını sürekli iyileştirmek

### Ajan Performansında Liderlik

- Gerçek dünyadaki üretkenliği ölçmek için kapsamlı değerlendirme kriterleri (evals) oluşturmak
- Herkesin bu değerlendirmeleri kolayca çalıştırıp yorumlamasını sağlamak
- Değerlendirme puanlarında net artışlar gösteren iyileştirmeler sunmak

PR'larında bu alanlarla olan bağlantıyı belirt.

### 3. Roo Code Topluluğuna Katıl

- **Ana yöntem:** [Discord](https://discord.gg/roocode)'umuza katıl ve **Hannes Rudolph (`hrudolph`)**'a DM gönder.
- **Alternatif:** Deneyimli katkı sağlayanlar [GitHub Projects](https://github.com/orgs/RooCodeInc/projects/1) üzerinden doğrudan katılabilir.

## Katkı Bulma & Planlama

### Katkı Türleri

- **Hata düzeltmeleri:** Koddaki sorunları çözmek.
- **Yeni özellikler:** Yeni işlevsellik eklemek.
- **Dokümantasyon:** Rehberleri geliştirmek ve netleştirmek.

### Issue-First Yaklaşımı

Tüm katkılar bir GitHub Issue ile başlamalıdır.

- **Mevcut issue'ları kontrol et:** [GitHub Issues](https://github.com/RooCodeInc/Roo-Code/issues)'da ara.
- **Issue oluştur:** Uygun şablonları kullan:
    - **Hatalar:** "Bug Report" şablonu.
    - **Özellikler:** "Detailed Feature Proposal" şablonu. Başlamadan önce onay gerekir.
- **Issue'ları sahiplen:** Yorum yap ve resmi atamayı bekle.

**Onaylanmış issue'lara bağlı olmayan PR'lar kapatılabilir.**

### Ne Üzerinde Çalışacağına Karar Verme

- [GitHub Projesi](https://github.com/orgs/RooCodeInc/projects/1)'nde atanmamış "Good First Issues" bak.
- Dokümantasyon için [Roo Code Docs](https://github.com/RooCodeInc/Roo-Code-Docs)'u ziyaret et.

### Hata veya Sorun Bildirme

- Önce mevcut raporları kontrol et.
- ["Bug Report" şablonu](https://github.com/RooCodeInc/Roo-Code/issues/new/choose) kullanarak yeni hata raporları oluştur.
- **Güvenlik açıkları:** [security advisories](https://github.com/RooCodeInc/Roo-Code/security/advisories/new) aracılığıyla özel olarak bildir.

## Geliştirme & Gönderim Süreci

### Geliştirme Ortamı Kurulumu

1. **Fork & Clone:**

```
git clone https://github.com/KULLANICI_ADIN/Roo-Code.git
```

2. **Bağımlılıkları yükle:**

```
npm run install:all
```

3. **Hata ayıklama:** VS Code'da `F5` ile aç.

### Kod Yazma Rehberi

- Her özellik veya düzeltme için odaklı bir PR.
- ESLint ve TypeScript en iyi uygulamalarını takip et.
- Issue'lara referans veren açık, açıklayıcı commit mesajları yaz (örn. `Fixes #123`).
- Kapsamlı testler sağla (`npm test`).
- Göndermeden önce en son `main` branch'i üzerine rebase yap.

### Pull Request Gönderme

- Erken geri bildirim istiyorsan **taslak PR** olarak başla.
- Pull Request Şablonunu takip ederek değişikliklerini açıkça tanımla.
- UI değişiklikleri için ekran görüntüleri/videolar sağla.
- Dokümantasyon güncellemeleri gerekip gerekmediğini belirt.

### Pull Request Politikası

- Önceden onaylanmış ve atanmış issue'lara referans vermelidir.
- Politikaya uymayan PR'lar kapatılabilir.
- PR'lar CI testlerini geçmeli, yol haritasıyla uyumlu olmalı ve net dokümantasyona sahip olmalıdır.

### İnceleme Süreci

- **Günlük triyaj:** Maintainer'lar tarafından hızlı kontroller.
- **Haftalık detaylı inceleme:** Kapsamlı değerlendirme.
- **Geri bildirim temelinde hızla yinele.**

## Yasal

Pull request göndererek, katkılarının Roo Code'un lisanslamasıyla tutarlı olarak Apache 2.0 Lisansı altında lisanslanacağını kabul etmiş olursun.
