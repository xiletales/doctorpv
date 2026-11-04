import { ArrowDown, ArrowRight } from "lucide-react";
import { DisclaimerNote, PageTitle } from "@/components/domain/status";
import { Card } from "@/components/ui/card";
import { PROJECT_TITLE } from "@/lib/site";

const PIPELINE = [
  { title: "Sensor dan BMS", body: "PV, baterai, dan meter energi di tiap rumah" },
  { title: "Gateway", body: "Satu per area RT, menampung data saat internet putus" },
  { title: "Ingest", body: "Kunci per gateway, validasi skema, dan buang duplikat" },
  { title: "Mesin analisis", body: "Alert, deteksi anomali, diagnosis, dan skor kesehatan" },
  { title: "Dasbor", body: "Pembaruan langsung lewat SSE, dibatasi menurut peran" },
];

const LOOP = [
  { title: "Melihat", body: "Lokasi setiap atap surya dan baterai pada peta." },
  { title: "Memantau", body: "Produksi, beban, SoC, SoH, dan suhu secara langsung." },
  { title: "Menganalisis", body: "Anomali, kemungkinan penyebab beserta bukti, dan prediksi." },
  { title: "Menindaklanjuti", body: "Alert menjadi perintah kerja untuk teknisi." },
  { title: "Mengevaluasi", body: "Kinerja sebelum dan sesudah perbaikan." },
];

export default function AboutPage() {
  return (
    <div className="mx-auto max-w-5xl space-y-6 p-4 md:p-6">
      <p className="text-sm font-medium text-ink-2">{PROJECT_TITLE}</p>
      <PageTitle title="Arsitektur sistem" description="Dokter jaga AI-IoT untuk PLTS Kampung Iklim. Mitra: DLH Kota Surakarta. Satu klaster dengan 30 titik PV, 15 baterai bersama, dan 3 gateway IoT." />

      <section aria-labelledby="flow-title">
        <h2 id="flow-title" className="text-sm font-semibold text-ink">Perjalanan data</h2>
        <ol className="mt-3 flex flex-col gap-1 lg:flex-row lg:items-stretch">
          {PIPELINE.map((p, i) => (
            <li key={p.title} className="flex flex-col items-center gap-1 lg:flex-1 lg:flex-row">
              <Card className="h-full w-full p-4">
                <p className="text-sm font-semibold text-ink">{p.title}</p>
                <p className="mt-1 text-xs leading-relaxed text-ink-3">{p.body}</p>
              </Card>
              {i < PIPELINE.length - 1 ? (
                <>
                  <ArrowDown className="h-4 w-4 shrink-0 text-ink-3 lg:hidden" aria-hidden />
                  <ArrowRight className="hidden h-4 w-4 shrink-0 text-ink-3 lg:block" aria-hidden />
                </>
              ) : null}
            </li>
          ))}
        </ol>
      </section>

      <section aria-labelledby="loop-title">
        <h2 id="loop-title" className="text-sm font-semibold text-ink">Siklus kerja</h2>
        <p className="mt-1 text-sm text-ink-3">Hasil evaluasi kembali menjadi data pemantauan, sehingga siklusnya berulang.</p>
        <ol className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          {LOOP.map((s, i) => (
            <li key={s.title} className="rounded-2xl bg-rail p-4 text-white">
              <p className="num text-xs text-emerald-400">{i + 1}</p>
              <p className="mt-1 text-sm font-semibold">{s.title}</p>
              <p className="mt-1 text-xs leading-relaxed text-slate-300">{s.body}</p>
            </li>
          ))}
        </ol>
      </section>

      <section aria-labelledby="honest-title" className="grid gap-4 md:grid-cols-2">
        <Card className="p-5">
          <h2 id="honest-title" className="text-sm font-semibold text-ink">Yang nyata pada prototipe ini</h2>
          <ul className="mt-2 list-disc space-y-1 pl-4 text-sm text-ink-2">
            <li>Jalur data lengkap, dari kontrak telemetri sampai dasbor langsung.</li>
            <li>Deteksi dan diagnosis dihitung dari data, bukan teks tetap.</li>
            <li>Hak akses diterapkan di server untuk tiap peran.</li>
            <li>Penyangga offline dan sinkronisasi gateway dengan pembuangan duplikat.</li>
          </ul>
        </Card>
        <Card className="p-5">
          <h2 className="text-sm font-semibold text-ink">Yang masih simulasi atau asumsi</h2>
          <ul className="mt-2 list-disc space-y-1 pl-4 text-sm text-ink-2">
            <li>Seluruh data berasal dari simulator fisika, belum dari lapangan.</li>
            <li>Mesin AI memakai statistik dan aturan, dan akurasi lapangannya belum diukur.</li>
            <li>Lokasi mendekati Panularan, tetapi posisi rumah dan pembagian RT hasil generator, bukan survei.</li>
            <li>Tarif, faktor emisi, dan tidak adanya kredit ekspor adalah asumsi.</li>
          </ul>
        </Card>
      </section>
      <DisclaimerNote>Prototipe hackathon dengan data simulasi.</DisclaimerNote>
    </div>
  );
}
