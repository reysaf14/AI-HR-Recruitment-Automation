# PRD: Otomatisasi Screening Kandidat untuk Tim HR

## Latar Belakang

Tim HR di bisnis kecil-menengah (SME) yang hanya berisi 1-2 orang sering kewalahan saat membuka lowongan karena bisa menerima 50-150 lamaran dalam 1-2 minggu, padahal recruitment bukan satu-satunya tanggung jawab mereka. Proses screening manual — membuka dan membandingkan CV satu per satu — menghabiskan waktu berhari-hari, menghasilkan keputusan yang tidak konsisten karena dipengaruhi kondisi fisik HR, membuat kandidat berkualitas hilang ke kompetitor karena respons lambat, dan menyulitkan pelacakan status karena data lamaran tersebar antara email dan spreadsheet manual. Proyek ini perlu dibangun karena screening adalah pekerjaan berulang, memakan waktu besar, tapi tetap butuh judgment — kombinasi yang tepat untuk dibantu otomatisasi cerdas agar tim HR bisa lebih cepat, konsisten, dan responsif terhadap kandidat potensial tanpa harus belajar sistem baru yang rumit.

## User Stories

1. **Sebagai HR Generalist**, saya ingin membuka lowongan baru dengan menentukan kriteria dan bobot penilaiannya, agar sistem bisa menyaring kandidat sesuai kebutuhan spesifik posisi itu.
2. **Sebagai kandidat**, saya ingin mengisi form lamaran online dan mengunggah CV, agar lamaran saya langsung masuk ke sistem tanpa perlu mengirim email terpisah.
3. **Sebagai HR Generalist**, saya ingin CV kandidat terbaca otomatis (pengalaman, skill, pendidikan), agar saya tidak perlu membaca dan mengetik ulang isi CV secara manual.
4. **Sebagai HR Generalist**, saya ingin setiap kandidat mendapat skor kecocokan beserta alasan singkat yang jelas, agar keputusan seleksi bisa dipertanggungjawabkan dan konsisten.
5. **Sebagai HR Generalist**, saya ingin kandidat otomatis dikelompokkan ke kategori keputusan (misal: Layak Lanjut, Perlu Ditinjau, Belum Sesuai), agar saya bisa langsung fokus pada kandidat paling relevan.
6. **Sebagai HR Generalist**, saya ingin menerima notifikasi hanya untuk kandidat yang layak lanjut atau perlu ditinjau, agar saya tidak dibanjiri notifikasi untuk semua lamaran.
7. **Sebagai HR Generalist**, saya ingin melihat data semua kandidat beserta statusnya dalam satu tempat yang tersimpan otomatis, agar tidak ada kandidat yang terlewat karena lupa di-follow up.
8. **Sebagai HR Generalist**, saya ingin mengubah kriteria posisi tanpa harus mengubah sistem secara keseluruhan, agar solusi ini bisa dipakai berulang untuk berbagai jenis lowongan di masa depan.
9. **Sebagai kandidat**, saya ingin menerima pemberitahuan otomatis jika lamaran saya tidak lolos, agar saya cepat tahu hasilnya tanpa harus menunggu atau bertanya ke HR.

## Fitur Wajib (Must Have)

1. **Pengelolaan Lowongan**  
   HR dapat membuat lowongan baru dengan menetapkan judul posisi, deskripsi, kriteria penilaian, dan bobot tiap kriteria (skill, pengalaman, pendidikan) yang bisa diubah kapan saja tanpa perlu mengubah seluruh sistem. Setiap lowongan memiliki kriterianya sendiri sehingga bisa dipakai untuk berbagai jenis posisi.

2. **Form Penerimaan Lamaran**  
   Kandidat mengisi data diri dan mengunggah berkas CV melalui form. Setiap lamaran secara otomatis terhubung ke lowongan yang dituju dan tersimpan sebagai data baru dalam sistem.

3. **Pembacaan Otomatis Isi CV**  
   Sistem mengekstrak isi CV secara otomatis — meliputi pengalaman kerja, skill, dan pendidikan — untuk dikenali sebagai data terstruktur. Fase ini mendukung CV berbahasa Indonesia.

4. **Pencocokan terhadap Kriteria Posisi**  
   Sistem membandingkan data kandidat yang sudah terbaca dengan kriteria dan bobot yang ditetapkan untuk lowongan terkait, lalu menghasilkan skor kecocokan.

5. **Skor Kecocokan dengan Alasan**  
   Setiap kandidat mendapat skor kecocokan yang disertai alasan singkat yang mudah dipahami (misalnya "kuat di pengalaman B2B sales 3 tahun, tapi tidak menyebutkan pengalaman CRM yang menjadi syarat wajib") — bukan sekadar angka tanpa penjelasan.

6. **Pengelompokan Kategori Keputusan**  
   Kandidat otomatis dikelompokkan ke dalam kategori keputusan (minimal: Layak Lanjut, Perlu Ditinjau Manual, Belum Sesuai) berdasarkan hasil skor dan kriteria, sehingga HR dapat memprioritaskan tindakan.

7. **Notifikasi Kandidat Relevan**  
   Sistem mengirim notifikasi ke tim HR hanya untuk kandidat yang masuk kategori Layak Lanjut atau Perlu Ditinjau Manual — bukan untuk semua lamaran. Notifikasi berisi informasi cukup agar HR langsung bisa menindaklanjuti.

8. **Data Kandidat & Status Terpusat**  
   Semua data lamaran, skor, alasan, dan status setiap kandidat tersimpan secara otomatis dan terpusat dalam satu tempat yang dapat dilihat HR kapan saja — disajikan dalam format spreadsheet yang familier — tanpa perlu di-maintain atau di-update manual satu per satu.

9. **Pelacakan Status Kandidat**  
   Status setiap kandidat (misal: baru masuk, layak lanjut, sudah di-follow up) tercatat otomatis sehingga HR selalu tahu posisi tiap kandidat dan tidak ada lamaran yang hilang karena lupa ditindaklanjuti.

10. **Pemberitahuan Otomatis Kandidat Tidak Lolos**  
    Kandidat yang masuk kategori Belum Sesuai / Tidak Lolos secara otomatis menerima pemberitahuan penolakan yang sopan dan jelas, berisi alasan singkat yang bisa dipertanggungjawabkan. Pemberitahuan dikirim otomatis oleh sistem sehingga HR tidak perlu menulis dan mengirim satu per satu, namun tetap menjaga citra profesional perusahaan dan memberikan kepastian kepada kandidat.

## Fitur Tambahan (Nice to Have)

1. **Penyesuaian Ambang Batas Kategori** - HR dapat mengatur ambang skor yang menentukan batas antar kategori keputusan.
2. **Riwayat Perubahan Kriteria** - Pencatatan perubahan kriteria/bobot pada tiap lowongan untuk keperluan audit.
3. **Ekspor Data Kandidat** - Kemudahan mengekspor data kandidat untuk kebutuhan arsip atau pelaporan eksternal.

## Kriteria Sukses

| Metric | Target |
|--------|--------|
| Waktu dari lamaran masuk sampai kandidat terklasifikasi | Di bawah beberapa menit per kandidat |
| Konsistensi penilaian | 100% kandidat dinilai dengan kriteria dan bobot yang sama untuk lowongan yang sama |
| Kandidat yang tidak perlu ditinjau tidak mengganggu HR | HR hanya menerima notifikasi untuk kandidat Layak Lanjut / Perlu Ditinjau, bukan untuk semua lamaran |
| Kelengkapan alasan keputusan | 100% keputusan (lolos/tidak) memiliki alasan yang bisa dijelaskan, bukan hanya angka |
| Data lamaran tersimpan | 100% lamaran tercatat statusnya secara otomatis tanpa input manual HR |
| Penggunaan ulang untuk lowongan baru | Kriteria posisi baru dapat dibuat/diubah tanpa mengubah sistem secara keseluruhan |
| Keterbacaan CV bahasa Indonesia | CV berbahasa Indonesia terbaca dan diekstrak isinya dengan akurat |
| Beban belajar pengguna | HR dapat langsung memakai solusi tanpa perlu mengikuti pelatihan panjang |
| Pemberitahuan kandidat tidak lolos | 100% kandidat kategori Belum Sesuai menerima pemberitahuan otomatis yang berisi alasan, tanpa perlu HR menulis manual |

## Riwayat Revisi

| Versi | Tanggal | Perubahan | Diminta oleh |
|-------|---------|-----------|--------------|
| v1 | 2026-08-30 | Draft awal dari project brief | User |
| v2 | 2026-08-30 | Tambah fitur pemberitahuan otomatis (auto-reply) untuk kandidat yang tidak lolos, plus user story & metrik terkait | User |

---

**Mohon review dan beri persetujuan (Approve) sebelum saya lanjutkan ke tahap desain teknis.**
