# Saha — Afiş Takip Sistemi

Saha kampanyaları ve afiş kontrol süreçleri için mobil öncelikli PWA projesidir.

## Bu sürümde neler var?

- Yönetici paneli görünümünde genel bakış ve özet kartları
- Kampanya oluşturma, tarih aralığı ve hedef market seçimi
- Müşteri ve şube listesi
- Fotoğraf seçme/kamera ile yükleme akışı ve önizleme
- Bekleyen kayıtları onaylama veya gerekçeyle reddetme
- Kampanya, market, kontrol durumu ve rapor ekranları
- CSV raporu dışa aktarma
- PWA manifesti ve temel çevrimdışı önbellek
- GitHub Actions ile GitHub Pages yayın akışı
- Supabase için başlangıç SQL şeması


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
