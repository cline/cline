<div align="center">
<sub>

[English](../../CONTRIBUTING.md) • [Català](../ca/CONTRIBUTING.md) • [Deutsch](../de/CONTRIBUTING.md) • [Español](../es/CONTRIBUTING.md) • [Français](../fr/CONTRIBUTING.md) • [हिंदी](../hi/CONTRIBUTING.md) • [Bahasa Indonesia](../id/CONTRIBUTING.md) • [Italiano](../it/CONTRIBUTING.md) • [日本語](../ja/CONTRIBUTING.md)

</sub>
<sub>

[한국어](../ko/CONTRIBUTING.md) • [Nederlands](../nl/CONTRIBUTING.md) • [Polski](../pl/CONTRIBUTING.md) • [Português (BR)](../pt-BR/CONTRIBUTING.md) • [Русский](../ru/CONTRIBUTING.md) • <b>Türkçe</b> • [Tiếng Việt](../vi/CONTRIBUTING.md) • [简体中文](../zh-CN/CONTRIBUTING.md) • [繁體中文](../zh-TW/CONTRIBUTING.md)

</sub>
</div>

# Roo Code'a Katkıda Bulunma

Roo Code topluluk tarafından yürütülen bir projedir ve her katkıyı derinden takdir ediyoruz. İşbirliğini kolaylaştırmak için [Önce Sorun Yaklaşımı](#önce-sorun-yaklaşımı) temelinde çalışıyoruz, bu da tüm [Çekme İsteklerinin (PR'ler)](#bir-çekme-isteği-gönderme) önce bir GitHub Sorununa bağlanması gerektiği anlamına gelir. Lütfen bu kılavuzu dikkatlice inceleyin.

## İçindekiler

- [Katkıda Bulunmadan Önce](#katkıda-bulunmadan-önce)
- [Katkınızı Bulma ve Planlama](#katkınızı-bulma-ve-planlama)
- [Geliştirme ve Gönderme Süreci](#geliştirme-ve-gönderme-süreci)
- [Yasal](#yasal)

## Katkıda Bulunmadan Önce

### 1. Davranış Kuralları

Tüm katkıda bulunanlar [Davranış Kurallarımıza](./CODE_OF_CONDUCT.md) uymalıdır.

### 2. Proje Yol Haritası

Yol haritamız projenin yönünü belirler. Katkılarınızı bu temel hedeflerle hizalayın:

### Önce Güvenilirlik

- Fark düzenleme ve komut yürütmenin tutarlı bir şekilde güvenilir olduğundan emin olun.
- Düzenli kullanımı caydıran sürtünme noktalarını azaltın.
- Tüm yerellerde ve platformlarda sorunsuz çalışmayı garanti edin.
- Çok çeşitli yapay zeka sağlayıcıları ve modelleri için sağlam desteği genişletin.

### Geliştirilmiş Kullanıcı Deneyimi

- Netlik ve sezgisellik için kullanıcı arayüzünü/kullanıcı deneyimini kolaylaştırın.
- Geliştiricilerin günlük kullanım araçlarından beklentilerini karşılamak için iş akışını sürekli iyileştirin.

### Ajan Performansında Liderlik

- Gerçek dünya verimliliğini ölçmek için kapsamlı değerlendirme ölçütleri (eval'ler) oluşturun.
- Herkesin bu değerlendirmeleri kolayca çalıştırmasını ve yorumlamasını sağlayın.
- Değerlendirme puanlarında net artışlar gösteren iyileştirmeler gönderin.

PR'lerinizde bu alanlarla uyumu belirtin.

### 3. Roo Code Topluluğuna Katılın

- **Birincil:** [Discord](https://discord.gg/roocode) sunucumuza katılın ve **Hannes Rudolph (`hrudolph`)**'a DM gönderin.
- **Alternatif:** Deneyimli katkıda bulunanlar doğrudan [GitHub Projeleri](https://github.com/orgs/RooCodeInc/projects/1) aracılığıyla etkileşimde bulunabilirler.

## Katkınızı Bulma ve Planlama

### Katkı Türleri

- **Hata Düzeltmeleri:** kod sorunlarını giderme.
- **Yeni Özellikler:** işlevsellik ekleme.
- **Belgelendirme:** kılavuzları ve netliği iyileştirme.

### Önce Sorun Yaklaşımı

Tüm katkılar, basit şablonlarımızı kullanarak bir GitHub Sorunu ile başlar.

- **Mevcut sorunları kontrol edin**: [GitHub Sorunları](https://github.com/RooCodeInc/Roo-Code/issues)nda arama yapın.
- **Bir sorun oluşturun**:
    - **İyileştirmeler:** "İyileştirme İsteği" şablonu (kullanıcı yararına odaklanan sade bir dil).
    - **Hatalar:** "Hata Raporu" şablonu (minimum yeniden oluşturma + beklenen vs gerçek + sürüm).
- **Üzerinde çalışmak ister misiniz?** Soruna "Talep ediyorum" yorumu yapın ve atanmak için [Discord](https://discord.gg/roocode) üzerinden **Hannes Rudolph (`hrudolph`)**'a DM gönderin. Atama, başlıkta teyit edilecektir.
- **PR'ler soruna bağlanmalıdır.** Bağlantısız PR'ler kapatılabilir.

### Ne Üzerinde Çalışılacağına Karar Verme

- "Sorun [Atanmamış]" sorunları için [GitHub Projesi](https://github.com/orgs/RooCodeInc/projects/1)'ni kontrol edin.
- Belgeler için [Roo Code Belgeleri](https://github.com/RooCodeInc/Roo-Code-Docs)ni ziyaret edin.

### Hataları Bildirme

- Önce mevcut raporları kontrol edin.
- Aşağıdakilerle ["Hata Raporu" şablonunu](https://github.com/RooCodeInc/Roo-Code/issues/new/choose) kullanarak yeni bir hata oluşturun:
    - Açık, numaralandırılmış yeniden oluşturma adımları
    - Beklenen vs gerçek sonuç
    - Roo Code sürümü (gerekli); ilgiliyse API sağlayıcısı/modeli
- **Güvenlik sorunları**: [Güvenlik tavsiyeleri](https://github.com/RooCodeInc/Roo-Code/security/advisories/new) aracılığıyla özel olarak bildirin.

## Geliştirme ve Gönderme Süreci

### Geliştirme Kurulumu

1. **Çatallayın ve Klonlayın:**

```
git clone https://github.com/KULLANICI_ADINIZ/Roo-Code.git
```

2. **Bağımlılıkları Yükleyin:**

```
pnpm install
```

3. **Hata Ayıklama:** VS Code (`F5`) ile açın.

### Kod Yazma Yönergeleri

- Her özellik veya düzeltme için odaklanmış bir PR.
- ESLint ve TypeScript en iyi uygulamalarını takip edin.
- Sorunlara atıfta bulunan açık, açıklayıcı taahhütler yazın (ör. `Düzeltmeler #123`).
- Kapsamlı testler sağlayın (`npm test`).
- Göndermeden önce en son `main` dalına yeniden temel alın.

### Bir Çekme İsteği Gönderme

- Erken geri bildirim arıyorsanız **Taslak PR** olarak başlayın.
- Çekme İsteği Şablonunu izleyerek değişikliklerinizi açıkça tanımlayın.
- PR açıklamasında/başlığında sorunu bağlayın (ör. "Düzeltmeler #123").
- Kullanıcı arayüzü değişiklikleri için ekran görüntüleri/videolar sağlayın.
- Belge güncellemelerinin gerekli olup olmadığını belirtin.

### Çekme İsteği Politikası

- Atanmış bir GitHub Sorununa atıfta bulunmalıdır. Atanmak için: soruna "Talep ediyorum" yorumu yapın ve [Discord](https://discord.gg/roocode) üzerinden **Hannes Rudolph (`hrudolph`)**'a DM gönderin. Atama, başlıkta teyit edilecektir.
- Bağlantısız PR'ler kapatılabilir.
- PR'ler CI testlerini geçmeli, yol haritasıyla uyumlu olmalı ve net belgelere sahip olmalıdır.

### İnceleme Süreci

- **Günlük Triyaj:** Sürdürücüler tarafından hızlı kontroller.
- **Haftalık Derinlemesine İnceleme:** Kapsamlı değerlendirme.
- Geri bildirime göre **hızlı bir şekilde yineleyin**.

## Yasal

Katkıda bulunarak, katkılarınızın Roo Code'un lisanslamasıyla tutarlı olan Apache 2.0 Lisansı altında lisanslanacağını kabul etmiş olursunuz.
