-- =====================================================
-- Proaktif IoT Sistemi — TimescaleDB Şeması
-- =====================================================

-- TimescaleDB eklentisini aktif et
CREATE EXTENSION IF NOT EXISTS timescaledb;

-- =====================================================
-- 1. TENANTS — Aktif müşteri listesi
-- =====================================================
CREATE TABLE IF NOT EXISTS tenants (
    user_id     UUID        PRIMARY KEY,  -- Supabase users.id ile eşleşir
    username    TEXT        UNIQUE NOT NULL,
    is_active   BOOLEAN     DEFAULT true,
    plan        TEXT        DEFAULT 'basic',  -- 'basic' | 'pro' (ileride)
    created_at  TIMESTAMPTZ DEFAULT NOW()
);

-- =====================================================
-- 2. SENSOR_LOGS — Ham sensör verisi (Hypertable)
-- =====================================================
CREATE TABLE IF NOT EXISTS sensor_logs (
    time        TIMESTAMPTZ NOT NULL,
    user_id     UUID        NOT NULL REFERENCES tenants(user_id) ON DELETE CASCADE,
    temperature NUMERIC(5,2),
    humidity    NUMERIC(5,2),
    battery     NUMERIC(5,2),
    clean_water NUMERIC(5,2),
    grey_water  NUMERIC(5,2),
    rssi        SMALLINT,
    raw_payload JSONB
);

-- Hypertable: zaman bazlı otomatik partitioning + user_id space partitioning
SELECT create_hypertable(
    'sensor_logs',
    'time',
    partitioning_column  => 'user_id',
    number_partitions    => 4,
    if_not_exists        => TRUE
);

-- Kritik index: tüm sorgular user_id + time ile gelecek
CREATE INDEX IF NOT EXISTS idx_sensor_logs_user_time
    ON sensor_logs (user_id, time DESC);

-- =====================================================
-- 3. SENSOR_HOURLY — Saatlik ortalama (Continuous Aggregate)
-- =====================================================
CREATE MATERIALIZED VIEW IF NOT EXISTS sensor_hourly
WITH (timescaledb.continuous) AS
SELECT
    time_bucket('1 hour', time)  AS bucket,
    user_id,
    AVG(temperature)             AS avg_temp,
    MAX(temperature)             AS max_temp,
    MIN(temperature)             AS min_temp,
    AVG(humidity)                AS avg_humidity,
    MIN(battery)                 AS min_battery,
    AVG(battery)                 AS avg_battery,
    AVG(clean_water)             AS avg_clean_water,
    MIN(clean_water)             AS min_clean_water,
    MAX(grey_water)              AS max_grey_water,
    COUNT(*)                     AS reading_count
FROM sensor_logs
GROUP BY bucket, user_id
WITH NO DATA;

-- Continuous aggregate otomatik yenileme politikası
SELECT add_continuous_aggregate_policy('sensor_hourly',
    start_offset      => INTERVAL '2 hours',
    end_offset        => INTERVAL '5 minutes',
    schedule_interval => INTERVAL '5 minutes',
    if_not_exists     => TRUE
);

-- =====================================================
-- 4. ALERT_LOGS — Uyarı geçmişi
-- =====================================================
CREATE TABLE IF NOT EXISTS alert_logs (
    id           BIGSERIAL    PRIMARY KEY,
    user_id      UUID         NOT NULL REFERENCES tenants(user_id) ON DELETE CASCADE,
    alert_type   TEXT         NOT NULL,
    severity     TEXT         NOT NULL CHECK (severity IN ('info', 'warning', 'critical')),
    message      TEXT         NOT NULL,
    sensor_data  JSONB,
    is_sent      BOOLEAN      DEFAULT false,
    sent_at      TIMESTAMPTZ,
    created_at   TIMESTAMPTZ  DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_alert_logs_user_time
    ON alert_logs (user_id, created_at DESC);

-- Gönderilmemiş alertleri hızlı bulmak için partial index
CREATE INDEX IF NOT EXISTS idx_alert_logs_unsent
    ON alert_logs (user_id) WHERE is_sent = false;

-- =====================================================
-- 5. ALERT_COOLDOWNS — Spam önleme
-- =====================================================
CREATE TABLE IF NOT EXISTS alert_cooldowns (
    user_id     UUID  NOT NULL REFERENCES tenants(user_id) ON DELETE CASCADE,
    alert_type  TEXT  NOT NULL,
    last_sent   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (user_id, alert_type)
);

-- =====================================================
-- 6. NOTIFICATION_SETTINGS — Token + eşikler + filtreler
-- =====================================================
CREATE TABLE IF NOT EXISTS notification_settings (
    user_id                    UUID        PRIMARY KEY REFERENCES tenants(user_id) ON DELETE CASCADE,

    -- Platform & Token
    expo_push_token            TEXT,                           -- Expo Push Token (iOS + Android)
    platform                   TEXT CHECK (platform IN ('ios', 'android')),
    token_updated_at           TIMESTAMPTZ DEFAULT NOW(),

    -- Bildirim Filtreleri
    notifications_enabled      BOOLEAN     DEFAULT true,
    notify_critical            BOOLEAN     DEFAULT true,       -- kapatılamaz (UI'da disabled)
    notify_warning             BOOLEAN     DEFAULT true,
    notify_info                BOOLEAN     DEFAULT false,
    quiet_hours_start          TIME,                           -- örn: 23:00
    quiet_hours_end            TIME,                           -- örn: 07:00
    alert_cooldown_minutes     INTEGER     DEFAULT 30,

    -- Kişisel Eşikler
    low_battery_critical       NUMERIC     DEFAULT 10.5,
    low_battery_warning        NUMERIC     DEFAULT 11.5,
    high_temp_warning          NUMERIC     DEFAULT 40,
    high_temp_critical         NUMERIC     DEFAULT 50,
    low_clean_water_warning    NUMERIC     DEFAULT 20,
    low_clean_water_critical   NUMERIC     DEFAULT 10,
    high_grey_water_warning    NUMERIC     DEFAULT 80,
    high_grey_water_critical   NUMERIC     DEFAULT 90,

    updated_at                 TIMESTAMPTZ DEFAULT NOW()
);

-- =====================================================
-- 7. VERİ SAKLAMA POLİTİKALARI
-- =====================================================

-- Ham sensör verisi: 30 gün sakla
SELECT add_retention_policy('sensor_logs',
    INTERVAL '30 days',
    if_not_exists => TRUE
);

-- Saatlik özet: 365 gün sakla
SELECT add_retention_policy('sensor_hourly',
    INTERVAL '365 days',
    if_not_exists => TRUE
);

-- =====================================================
-- 8. SIKIŞTIRMA POLİTİKASI (Disk tasarrufu)
-- =====================================================
ALTER TABLE sensor_logs SET (
    timescaledb.compress,
    timescaledb.compress_segmentby = 'user_id',
    timescaledb.compress_orderby   = 'time DESC'
);

SELECT add_compression_policy('sensor_logs',
    INTERVAL '7 days',
    if_not_exists => TRUE
);

-- =====================================================
-- 9. YARDIMCI FONKSİYONLAR
-- =====================================================

-- Tenant eklendiğinde notification_settings'e otomatik default kayıt ekle
CREATE OR REPLACE FUNCTION create_default_notification_settings()
RETURNS TRIGGER AS $$
BEGIN
    INSERT INTO notification_settings (user_id)
    VALUES (NEW.user_id)
    ON CONFLICT (user_id) DO NOTHING;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_create_notification_settings
    AFTER INSERT ON tenants
    FOR EACH ROW
    EXECUTE FUNCTION create_default_notification_settings();

-- updated_at otomatik güncelleme
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_notification_settings_updated_at
    BEFORE UPDATE ON notification_settings
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at();

-- =====================================================
-- COMMENTS
-- =====================================================
COMMENT ON TABLE tenants              IS 'Aktif müşteri listesi — Supabase user_id ile eşleşir';
COMMENT ON TABLE sensor_logs          IS 'Ham sensör verisi hypertable — 30 gün saklanır';
COMMENT ON TABLE alert_logs           IS 'Uyarı geçmişi — kalıcı';
COMMENT ON TABLE alert_cooldowns      IS 'Aynı uyarının spam yapmasını önler';
COMMENT ON TABLE notification_settings IS 'FCM/APNs token + bildirim filtreleri + kişisel eşikler';
