# Kontrak telemetri IoT

Setiap gateway mengirim pesan JSON per perangkat, dikirim sebagai batch lewat `POST /api/v1/ingest`.

## Topik (gaya MQTT)

```
sunpulse/{clusterId}/gateway/{gatewayId}/status
sunpulse/{clusterId}/pv/{houseId}/telemetry
sunpulse/{clusterId}/battery/{batteryId}/telemetry
sunpulse/{clusterId}/meter/{meterId}/telemetry
```

Prototipe mengirim lewat HTTP. Isi pesannya sama, sehingga broker seperti Mosquitto atau EMQX, dan perangkat seperti ESP32, bisa dipasang dengan satu jembatan MQTT ke HTTP yang memanggil endpoint ini.

## Cakupan gateway

| Gateway | Area (simulasi) | Titik PV | Baterai |
|---|---|---|---|
| GW-1 | RT 01 | H01–H10 | B01–B05 |
| GW-2 | RT 02 | H11–H20 | B06–B10 |
| GW-3 | RT 03 | H21–H30 | B11–B15 |

Satu baterai melayani 2 rumah bertetangga: B01 melayani H01 dan H02, B02 melayani H03 dan H04, dan seterusnya.

## Permintaan

Header `x-gateway-key` berisi kunci per gateway (HMAC-SHA256 dari ID gateway dengan `GATEWAY_KEY_SECRET`).

```json
{
  "gatewayId": "GW-3",
  "messages": [
    {
      "type": "pv",
      "deviceId": "PV-H21-01",
      "assetId": "H21",
      "gatewayId": "GW-3",
      "ts": "2026-11-07T10:15:00+07:00",
      "seq": 18234,
      "buffered": false,
      "metrics": { "dcVoltage": 382.4, "dcCurrent": 6.1, "acPowerW": 2240, "panelTempC": 47.2, "irradiance": 812.5 },
      "status": { "inverter": "OK", "rssi": -71 }
    }
  ]
}
```

Jenis `battery` dan `meter` memakai bentuk yang sama. Skema lengkap ada di `src/lib/contracts/telemetry.ts`.

Setiap titik PV punya sensor iradiasi murah sendiri (`irradiance`, W/m², boleh `null` bila sensor tidak melapor). Nilai yang hilang, di luar rentang, macet, atau jauh dari referensi cuaca tidak dipakai, dan titik itu ditandai "Sensor perlu verifikasi".

## Referensi cuaca

Ekspektasi tiap titik dihitung dari iradiasi, suhu panel, kWp, dan PR historis sistem itu sendiri. Antarmuka `WeatherProvider` (`src/lib/weather/`) punya dua implementasi:

| Provider | Dipakai untuk |
|---|---|
| Simulasi | Bawaan. Telemetri simulasi harus dinilai terhadap langit simulasi yang sama. |
| Open-Meteo | Tanpa API key, dicache 15 menit. Di prototipe hanya ditampilkan sebagai konteks cuaca nyata Surakarta. Untuk sensor sungguhan, setel `WEATHER_REFERENCE=open-meteo`. |

## Aturan penerimaan

| Aturan | Perilaku |
|---|---|
| Kunci gateway salah | Ditolak dengan 401 |
| Pesan tidak lolos skema Zod | Dikarantina dan dihitung sebagai ditolak |
| `seq` tidak lebih besar dari yang terakhir untuk `deviceId` | Dihitung sebagai duplikat lalu diabaikan |
| `buffered: true` | Diterima sebagai data sinkronisasi, jumlahnya ditampilkan saat tersambung kembali |

## Batas meter

| Meter | Lokasi | Mengukur |
|---|---|---|
| M1 | Keluaran AC inverter tiap rumah | Produksi PV |
| M2 | Panel beban tiap rumah | Beban rumah |
| M3 | Tiap baterai | Pengisian dan pengosongan |
| M4 | Klaster, sambungan PLN | Impor PLN |

Neraca klaster: `PV + impor PLN + pengosongan = beban + pengisian + curtail`. Rugi-rugi baterai berada di dalam M3. Ekspor tidak dikreditkan, jadi surplus PV yang tidak tertampung tercatat sebagai curtail. Pengujian di `tests/energy.test.ts` memastikan neraca ini menutup.
