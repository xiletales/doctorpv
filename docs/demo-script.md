# Naskah demo 5 menit

**Persiapan**
- Jalankan `nvm use && npm run demo`, lalu buka http://localhost:3000.
- Masuk sebagai Super Admin DLH. Pastikan penanda waktu menunjukkan 10.15 WIB dan garis denyut "Langsung" bergerak.
- Aplikasi membutuhkan internet untuk login dan data. Uji koneksi di lokasi, dan siapkan hotspot ponsel.
- Buka dashboard Supabase sehari sebelumnya, karena project free tier berhenti setelah 1 minggu tanpa aktivitas.

| Menit | Halaman | Lakukan | Sampaikan |
|---|---|---|---|
| 0:00 | Landing | Tunjukkan ilustrasi klaster, lalu masuk | "Satu klaster permukiman: 30 rumah, 15 baterai bersama, 3 gateway." |
| 0:20 | Dasbor | Tunjukkan Pulse Score dan aliran energi | "Satu angka untuk kesehatan seluruh klaster. Saat ini 4 aset perlu perhatian." |
| 0:50 | Dasbor | Geser **Jelajah waktu** ke pukul 19.00, lalu kembali ke langsung | "Lewat waktu sekarang, sistem menampilkan prakiraan model: baterai menggantikan surya pada malam hari." |
| 1:20 | Peta | Tunjukkan rumah, baterai, gateway, dan garis pasangan | "Satu baterai melayani dua rumah bertetangga, tercatat eksplisit." |
| 1:45 | Peta | Tekan **Shift+D**, klik **Picu gangguan** pada H21 | "Inverter H21 mati sekarang. Datanya melewati jalur yang sama dengan gateway sungguhan." |
| 2:00 | Peta | Tunggu notifikasi dan marker merah | "Dalam beberapa detik sistem mendeteksinya, dan Pulse Score turun." |
| 2:15 | Diagnosis AI | Pilih H21 | "Bukan sekadar alarm: ada kemungkinan penyebab, buktinya, dan tindakan. Ini estimasi, teknisi tetap memverifikasi." |
| 3:00 | Pusat Notifikasi | **Buat perintah kerja** untuk H21 | "Alert langsung menjadi pekerjaan." |
| 3:20 | Pemeliharaan | **Mulai kerjakan**, lalu **Tandai selesai** | "Setelah diperbaiki, sistem membandingkan kinerja sebelum dan sesudah." |
| 3:50 | Shift+D, lalu Peta | **Putuskan GW-3**, tunggu marker abu-abu di Zona C, lalu **Sambungkan dan sinkronkan** | "Internet putus di satu zona, zona lain tetap berjalan, dan data tidak hilang." |
| 4:30 | Baterai B12 | Klik **Percepat degradasi 30 hari** di Shift+D | "SoH menembus 80% dan sistem meminta uji kapasitas." |
| 4:50 | Shift+D | **Kembalikan ke kondisi awal** | Tutup dengan alur: Pantau, Analisis, Tindak lanjuti, Evaluasi. |

**Opsional:** masuk sebagai Warga H01 untuk menunjukkan tampilan warga. Warga hanya melihat rumahnya dan status baterai bersamanya.

**Jawaban jujur bila ditanya**
- Data: seluruhnya simulasi, dan layar melabelinya.
- AI: mesin statistik dan aturan yang dapat dijelaskan, bukan model terlatih. Pengujian memakai gangguan dari simulator sendiri, jadi akurasi di lapangan belum diukur. Langkah berikutnya: data lapangan.
- Jelajah waktu: bagian mendatang memakai prakiraan dari model simulasi yang sama, bukan prakiraan cuaca sungguhan.
- Berbagi surplus antarrumah, penyimpanan bersama, dan kredit ekspor: asumsi model yang perlu dikonfirmasi dengan regulasi dan PLN.
- Koordinat: placeholder, sehingga tata letak rumah tidak mengikuti jalan sebenarnya.

**Bila ada masalah**
- Penanda "Simulator tidak berjalan": jalankan `npm run simulate` di terminal kedua.
- Banner "Data simulasi berasal dari hari lain": hentikan aplikasi, lalu jalankan `npm run demo`.
- Internet gagal total: pakai versi SQLite di branch `sunpulse`, yang berjalan tanpa internet, atau video rekaman demo sebagai cadangan terakhir.
