# Proaktif IoT Sistemi — RepoCloud Deploy Rehberi

## Klasör Yapısı

```
proactive-system/
├── timescaledb/
│   └── schema.sql              ← Veritabanı şeması
├── iot-collector/              ← MQTT veri toplayıcı
│   ├── src/
│   │   ├── index.js
│   │   ├── tenant-manager.js
│   │   ├── parser.js
│   │   ├── supabase.js
│   │   └── db.js
│   ├── Dockerfile
│   └── package.json
├── iot-analyzer/               ← Kural motoru + LLM analiz
│   ├── src/
│   │   ├── index.js
│   │   ├── analyzer.js
│   │   ├── rules.js
│   │   ├── llm.js
│   │   └── db.js
│   ├── Dockerfile
│   └── package.json
├── notification-service/       ← APNs (iOS) + FCM (Android)
│   ├── src/
│   │   ├── index.js
│   │   ├── apns.js
│   │   ├── fcm.js
│   │   └── filter.js
│   ├── Dockerfile
│   └── package.json
├── docker-compose.yml          ← Lokal test için
└── .env.example                ← Gerekli environment variables
```

---

## Adım 1 — Ön Hazırlık

### Firebase Projesi Oluştur (Android FCM)
1. [console.firebase.google.com](https://console.firebase.google.com) → Yeni proje
2. Android uygulaması ekle → `google-services.json` indir
3. iOS uygulaması ekle → `GoogleService-Info.plist` indir
4. Proje Ayarları → Hizmet Hesapları → **JSON key oluştur ve indir**
5. İndirilen JSON'un içeriğini `FIREBASE_SERVICE_ACCOUNT` env var'ına koy

### Apple APNs Key Oluştur (iOS)
1. [developer.apple.com](https://developer.apple.com) → Certificates, IDs & Profiles
2. Keys → + → APNs seç → Key oluştur
3. `.p8` dosyasını indir (bir kez indirilir, kaybet!)
4. Key ID ve Team ID'yi not al
5. `.p8` dosyasının içeriğini `APNS_KEY_P8` env var'ına koy

### Critical Alert İzni (Opsiyonel ama önerilir)
- App ID → Capabilities → Critical Alerts → Enable
- Apple'a başvuru formu doldur (1-3 gün onay süresi)

---

## Adım 2 — TimescaleDB Kurulumu (RepoCloud)

1. RepoCloud → New Service → **Docker Image**
2. Image: `timescale/timescaledb:latest-pg16`
3. Port: `5432`
4. Environment Variables:
   ```
   POSTGRES_DB=iot_db
   POSTGRES_USER=iot_user
   POSTGRES_PASSWORD=<güçlü_şifre>
   ```
5. Volume: `/var/lib/postgresql/data` → Persistent olarak işaretle
6. Deploy et, servis ayağa kalktıktan sonra:
7. RepoCloud terminal veya dışarıdan bağlanarak şemayı uygula:
   ```bash
   psql postgresql://iot_user:<şifre>@<host>:5432/iot_db -f timescaledb/schema.sql
   ```

---

## Adım 3 — iot-collector Kurulumu (RepoCloud)

1. RepoCloud → New Service → **GitHub / Git Repo**
2. Root directory: `proactive-system/iot-collector`
3. Build command: `npm install`
4. Start command: `node src/index.js`
5. Environment Variables:
   ```
   TIMESCALE_URL=postgresql://iot_user:<şifre>@<timescaledb-host>:5432/iot_db
   TIMESCALE_SSL=false
   SUPABASE_URL=https://xxxx.supabase.co
   SUPABASE_SERVICE_KEY=eyJ...
   ```
6. Restart Policy: **Always**
7. Deploy et

---

## Adım 4 — notification-service Kurulumu (RepoCloud)

> ⚠️ iot-collector'dan ÖNCE kur, çünkü iot-analyzer buna bağlı.

1. RepoCloud → New Service → **GitHub / Git Repo**
2. Root directory: `proactive-system/notification-service`
3. Build command: `npm install`
4. Start command: `node src/index.js`
5. Port: `3001`
6. Environment Variables:
   ```
   PORT=3001
   TIMESCALE_URL=postgresql://iot_user:<şifre>@<timescaledb-host>:5432/iot_db
   TIMESCALE_SSL=false
   FIREBASE_SERVICE_ACCOUNT={"type":"service_account",...}
   APNS_KEY_P8=-----BEGIN PRIVATE KEY-----\nMIGH...
   APNS_KEY_ID=ABC1234DEF
   APNS_TEAM_ID=TEAM123456
   APNS_BUNDLE_ID=com.yourcompany.iotkontrol
   APNS_PRODUCTION=false
   ```
7. Deploy et → Internal URL'i not al (örn: `http://notification-service:3001`)

---

## Adım 5 — iot-analyzer Kurulumu (RepoCloud)

1. RepoCloud → New Service → **GitHub / Git Repo**
2. Root directory: `proactive-system/iot-analyzer`
3. Build command: `npm install`
4. Start command: `node src/index.js`
5. Environment Variables:
   ```
   TIMESCALE_URL=postgresql://iot_user:<şifre>@<timescaledb-host>:5432/iot_db
   TIMESCALE_SSL=false
   ANYTHINGLLM_URL=https://03wsdxq7.rcld.app
   ANYTHINGLLM_API_KEY=VW79AQJ-5FDMTPP-G43KRC7-49VF8RC
   ANYTHINGLLM_WORKSPACE=karavantekne
   NOTIFICATION_SERVICE_URL=http://<notification-service-internal-url>:3001
   ```
6. Deploy et

---

## Adım 6 — React Native Uygulaması Güncellemesi

### Firebase paketlerini kur
```bash
cd iot-kontrol-paneli
npm install @react-native-firebase/app @react-native-firebase/messaging
```

### iOS için ek adımlar
```bash
cd ios && pod install
```

### `services/notifications.js` içinde token alma kodunu aktif et
Dosyada yorum satırı olarak bırakılan Firebase kodunu aktif hale getir:
```javascript
import messaging from '@react-native-firebase/messaging';
const token = await messaging().getToken();
```

### `app.json`'a notification-service URL ekle
```json
{
  "expo": {
    "extra": {
      "notificationApiUrl": "https://<notification-service-repocloud-url>"
    }
  }
}
```

### `App.js`'e token kaydını ekle
Kullanıcı giriş yaptıktan sonra:
```javascript
import { registerPushToken } from './services/notifications';
// ...
await registerPushToken(userId);
```

### Bildirim Ayarları ekranını mevcut ayarlar ekranına ekle
```javascript
import NotificationSettings from './components/NotificationSettings';
// Ayarlar ekranında:
<NotificationSettings userId={userId} onClose={() => setShowNotifSettings(false)} />
```

---

## Adım 7 — Yeni Müşteri Ekleme

Supabase'de mevcut işlemlere ek olarak TimescaleDB'ye kayıt:
```sql
-- Yeni müşteri eklendiğinde (trigger otomatik notification_settings oluşturur)
INSERT INTO tenants (user_id, username)
VALUES ('<supabase-user-uuid>', '<kullanici_adi>');
```

iot-collector Supabase Realtime sayesinde yeni müşteriyi otomatik algılar
ve MQTT bağlantısını kurar.

---

## Lokal Test

```bash
cd proactive-system
cp .env.example .env
# .env dosyasını düzenle

docker-compose up --build
```

---

## Servis Özeti

| Servis | RAM | Çalışma |
|--------|-----|---------|
| TimescaleDB | 1 GB | 7/24 |
| iot-collector | 512 MB | 7/24 |
| iot-analyzer | 256 MB | 7/24 (cron: 5 dk) |
| notification-service | 128 MB | On-demand |

**Tahmini maliyet (10 müşteri): ~$15-20/ay**
