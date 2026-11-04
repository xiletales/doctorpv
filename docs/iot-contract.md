# Kontrak telemetri IoT

Setiap gateway mengirim pesan JSON per perangkat, dikirim sebagai batch lewat `POST /api/v1/ingest`.

## Topik (gaya MQTT)

```
doctorpv/{rtId}/gang/{gangId}/gateway/{gatewayId}/status
doctorpv/{rtId}/gang/{gangId}/pv/{houseId}/telemetry
doctorpv/{rtId}/gang/{gangId}/battery/{batteryId}/telemetry
doctorpv/{rtId}/gang/{gangId}/meter/{meterId}/telemetry
```

Prototipe mengirim lewat HTTP. Isi pesannya sama, sehingga broker seperti Mosquitto atau EMQX bisa dipasang dengan satu jembatan MQTT ke HTTP yang memanggil endpoint ini.

## Permintaan

Header `x-gateway-key` berisi kunci per gateway (HMAC-SHA256 dari ID gateway dengan `GATEWAY_KEY_SECRET`).

```json
{
  "gatewayId": "GW-2",
  "messages": [
    {
      "type": "pv",
      "deviceId": "PV-H021-01",
      "assetId": "H021",
      "gatewayId": "GW-2",
      "ts": "2026-11-07T10:15:00+07:00",
      "seq": 18234,
      "buffered": false,
      "metrics": { "dcVoltage": 382.4, "dcCurrent": 6.1, "acPowerW": 2240, "panelTempC": 47.2 },
      "status": { "inverter": "OK", "rssi": -71 }
    }
  ]
}
```

Jenis `battery` dan `meter` memakai bentuk yang sama. Skema lengkap ada di `src/lib/contracts/telemetry.ts`.

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
| M3 | Bus gang, bank baterai | Pengisian dan pengosongan |
| M4 | Bus gang, sambungan PLN | Impor PLN |

Neraca per gang: `PV + impor PLN + pengosongan = beban + pengisian + curtail`. Rugi-rugi baterai berada di dalam M3. Ekspor tidak dikreditkan, jadi surplus PV yang tidak tertampung tercatat sebagai curtail.
