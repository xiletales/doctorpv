# Naskah demo 5 menit

**Persiapan**
- Jalankan `npm run demo`, lalu buka http://localhost:3000.
- Masuk sebagai Super Admin DLH. Pastikan penanda waktu menunjukkan 10.15 WIB dan titik hijau "Langsung".
- Jika Wi-Fi tempat acara bermasalah, peta otomatis memakai tampilan Skematik.

| Menit | Halaman | Lakukan | Sampaikan |
|---|---|---|---|
| 0:00 | Ringkasan | Tunjukkan daya surya, arus energi, dan status 5 gang | "Satu RT: 100 atap surya, 50 baterai, 5 gateway. Gang 3 Kritis, dan kita langsung tahu kenapa." |
| 0:45 | Ringkasan | Klik Gang 3 | "Seluruh halaman mengikuti gang yang dipilih." |
| 1:00 | Peta | Tunjukkan marker rumah dan baterai, klik marker merah | "Rumah dan baterai punya lokasi sendiri. Satu klik membuka kondisi aset." |
| 1:45 | Peta | Tekan **Shift+D**, klik **Picu gangguan** pada H021 | "Inverter H021 mati sekarang. Datanya melewati jalur yang sama dengan gateway sungguhan." |
| 2:00 | Peta | Tunggu notifikasi, marker H021 menjadi merah | "Dalam beberapa detik sistem mendeteksinya." |
| 2:15 | Diagnosis AI | Pilih H021 | "Bukan sekadar alarm: ada kemungkinan penyebab, buktinya, dan tindakan. Ini estimasi, teknisi tetap memverifikasi." |
| 3:00 | Shift+D, lalu baterai B025 | Klik **Picu kepanasan**, klik **Detail** | "Suhu naik, alert meningkat dari Tinggi ke Kritis." |
| 3:30 | Pusat Alert | Klik **Terima** | "Setiap alert punya prioritas, tindakan, dan status penanganan." |
| 3:50 | Shift+D, lalu Peta | **Putuskan GW-3**, tunggu marker abu-abu, lalu **Sambungkan dan sinkronkan** | "Internet putus, data tidak hilang. Gateway menampung lalu menyinkronkan." |
| 4:30 | Baterai B043 | Tunjukkan prediksi SoH | "Pemeliharaan prediktif, dengan rentang ketidakpastian." |
| 4:50 | Shift+D | **Kembalikan ke kondisi awal** | Tutup dengan alur: Pantau, Analisis, Tindak lanjuti, Evaluasi. |

**Jawaban jujur bila ditanya**
- Data: seluruhnya simulasi, dan tiap layar melabelinya.
- AI: mesin statistik dan aturan yang dapat dijelaskan, bukan model terlatih. Pengujian memakai gangguan dari simulator sendiri, jadi akurasi di lapangan belum diukur. Langkah berikutnya: data lapangan.
- Penyimpanan bersama per gang dan kredit ekspor: asumsi model yang perlu dikonfirmasi dengan regulasi dan PLN.
- Koordinat: placeholder, sehingga tata letak rumah tidak mengikuti jalan sebenarnya.

**Bila ada masalah**
- Penanda "Simulator tidak berjalan": jalankan `npm run simulate` di terminal kedua.
- Banner "Data simulasi berasal dari hari lain": hentikan aplikasi, lalu jalankan `npm run demo`.
- Siapkan video rekaman demo sebagai cadangan terakhir.
