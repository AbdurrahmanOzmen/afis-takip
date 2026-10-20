# Algida Saha — Afiş Takip Sistemi

Algida saha kampanyaları ve afiş kontrol süreçleri için mobil öncelikli PWA prototipi. **Real Life RPG'den tamamen bağımsız ayrı projedir.**

## Bu sürümde neler var?

- Yönetici paneli görünümünde genel bakış ve özet kartları
- Kampanya oluşturma, tarih aralığı ve hedef market seçimi
- BİM, A101, ŞOK, CarrefourSA, Migros, Hakmar, Seç Market ve Bizim Toptan listesi
- Fotoğraf seçme/kamera ile yükleme akışı ve önizleme
- Bekleyen kayıtları onaylama veya gerekçeyle reddetme
- Kampanya, market, kontrol durumu ve rapor ekranları
- CSV raporu dışa aktarma
- PWA manifesti ve temel çevrimdışı önbellek
- GitHub Actions ile GitHub Pages yayın akışı
- Supabase için başlangıç SQL şeması

## Önemli sınır

Bu paket **çalışan bir arayüz demosudur**. Şu anda kayıtlar tarayıcının `localStorage` alanında tutulur; dolayısıyla başka cihazlarla/personelle paylaşılmaz, oturum açma ve gerçek rol doğrulaması yoktur. Fotoğraf kayıtları da tarayıcıda tutulur ve 4 MB ile sınırlandırılmıştır. Gerçek saha kullanımından önce Supabase Auth, veritabanı, özel Storage bucket ve RLS/storage politikaları bağlanmalı ve test edilmelidir. `supabase/schema.sql` başlangıç taslağıdır; üretim için güvenlik incelemesi gerekir.

## Yerelde çalıştırma

Bu proje statik dosyalardan oluşur. `index.html` dosyasını açmak bazı tarayıcı özelliklerini kısıtlayabilir; bir yerel web sunucusu kullanmak daha uygundur:

```bash
python -m http.server 8000
```

Ardından `http://localhost:8000` adresini açın.

## GitHub'da yayınlama

1. GitHub'da **yeni ve ayrı** bir repository oluşturun: `algida-afis-takip`.
2. Bu klasördeki dosyaları repository'nin kök dizinine yükleyin veya Git ile push edin.
3. Repository → **Settings → Pages** bölümünü açın.
4. **Build and deployment → Source** kısmında **GitHub Actions** seçin.
5. `main` dalına push edildiğinde `.github/workflows/deploy.yml` otomatik yayın yapar. İlk dağıtım tamamlandığında Pages ekranında site adresi görünür.
6. Repo adınız farklıysa adres genellikle `https://KULLANICI_ADI.github.io/REPO_ADI/` biçimindedir.

## iPhone ana ekranına ekleme

1. Yayınlanan siteyi Safari'de açın.
2. Paylaş simgesine dokunun.
3. **Ana Ekrana Ekle** seçeneğini seçin.

Android'de Chrome menüsünden **Ana ekrana ekle / Uygulamayı yükle** kullanılabilir.

## Supabase ile gerçek çok kullanıcılı sisteme geçiş

1. Supabase projesi oluşturun ve `supabase/schema.sql` dosyasını SQL Editor'da dikkatle inceleyip çalıştırın.
2. Kimlik doğrulama, profil/rol oluşturma akışı ve `poster-photos` adlı private Storage bucket kurun.
3. Fotoğraf bucket'ı için erişim politikalarını tanımlayın; SQL'deki notlar tek başına Storage güvenliğini kurmaz.
4. Uygulamanın demo `localStorage` işlemlerini Supabase sorguları ve güvenli fotoğraf yüklemeleriyle değiştirin.
5. En az iki farklı kullanıcı ve rol ile erişim testleri yapmadan gerçek saha verisi kullanmayın.

## Dosyalar

- `index.html`, `styles.css`, `app.js`: uygulama arayüzü ve demo iş akışı
- `manifest.webmanifest`, `sw.js`, `assets/icon.svg`: PWA dosyaları
- `.github/workflows/deploy.yml`: Pages dağıtımı
- `supabase/schema.sql`: backend için başlangıç şeması
