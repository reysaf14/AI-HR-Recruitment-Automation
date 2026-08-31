# IMPLEMENTATION PLAN — Otomatisasi Screening Kandidat untuk Tim HR

**Status:** Draft — menunggu approval sebelum eksekusi
**Arsitektur:** n8n (single instance) + Custom Script (JS) + Google Workspace + LLM API

---

## Ringkasan File yang Akan Dibuat

| # | File | Fungsi |
|---|------|--------|
| 1 | `config/.env.template` | Template environment variables |
| 2 | `scripts/parse-cv.js` | Fungsi parse PDF/DOCX → teks plain |
| 3 | `scripts/rule-check.js` | Rule check syarat wajib dari job desc |
| 4 | `scripts/llm-scoring.js` | Panggil LLM API + parse response JSON |
| 5 | `scripts/rule-kategori.js` | Mapping skor → kategori (High/Medium/Low) |
| 6 | `scripts/buffer-manager.js` | Tulis/baca file buffer JSON lokal (fallback Sheets) |
| 7 | `scripts/dedup-check.js` | Cek duplikat email+lowongan sebelum tulis |
| 8 | `scripts/retry-helpers.js` | Fungsi retry universal (backoff eksponensial) |
| 9 | `scripts/audit-logger.js` | Tulis event ke Audit Log (Sheet 3) |
| 10 | `scripts/email-templates.js` | Template email notifikasi HR + auto-reply tolak |
| 11 | `n8n-workflows/screening-pipeline.json` | Workflow utama (importable ke n8n) |
| 12 | `n8n-workflows/auto-reply-cron.json` | Workflow cron harian auto-reply 3 hari |

---

## Milestone

### M0: Project Scaffolding
**Goal:** Struktur folder & config siap, semua dependency teridentifikasi.

| Task | File | Keterangan |
|------|------|------------|
| Buat struktur folder sesuai architecture.md | - | `n8n-workflows/`, `scripts/`, `config/`, `tests/`, `docs/` |
| Buat `.env.template` | `config/.env.template` | Semua env var dari architecture.md section 4 |
| Buat `docs/ARCHITECTURE.md` | `docs/ARCHITECTURE.md` | Referensi ke `.ai/knowledge/architecture.md` |

**Deliverable:** Struktur folder lengkap + .env.template

---

### M1: Core Scripts — Parsing & Rule Check
**Goal:** Script-script inti yang berinteraksi dengan data mentah.

| Task | File | Keterangan |
|------|------|------------|
| Fungsi parse CV | `scripts/parse-cv.js` | Parse PDF/DOCX → teks plain; handle error & timeout 60s |
| Fungsi rule check | `scripts/rule-check.js` | Baca kriteria wajib, cek di teks CV; output: Memenuhi/Tidak Memenuhi + alasan |
| Fungsi dedup check | `scripts/dedup-check.js` | Cek email+lowongan di Sheet "Data Kandidat" dalam 24 jam terakhir |

**Deliverable:** 3 script JS yang bisa dijalankan mandiri dengan data contoh

**Verifikasi:** Jalankan `node --check` untuk syntax + jalankan dengan data contoh

---

### M2: Core Scripts — LLM & Kategori
**Goal:** Script yang berinteraksi dengan LLM API dan logic kategori.

| Task | File | Keterangan |
|------|------|------------|
| Fungsi LLM scoring | `scripts/llm-scoring.js` | Panggil LLM API (HTTP), retry 3x (backoff 1s→3s→7s), parse JSON response, fallback rule-based |
| Fungsi rule kategori | `scripts/rule-kategori.js` | Mapping skor → kategori: High≥80, Medium 40-79, Low<40; ambang dari Sheet "Kriteria Lowongan" |
| Fungsi retry | `scripts/retry-helpers.js` | Retry universal: 3x, backoff eksponensial, callback-based |

**Deliverable:** 3 script JS yang bisa dijalankan mandiri dengan data contoh

**Verifikasi:** Jalankan `node --check` untuk syntax + jalankan dengan data contoh (termasuk simulasi LLM error untuk test retry)

---

### M3: Core Scripts — Buffer, Audit & Email
**Goal:** Support system untuk error handling, logging, dan notifikasi.

| Task | File | Keterangan |
|------|------|------------|
| Fungsi buffer manager | `scripts/buffer-manager.js` | Tulis/baca file buffer JSON lokal; max 10 retry; cron recovery |
| Fungsi audit logger | `scripts/audit-logger.js` | Tulis event ke Sheet "Audit Log" (append-only); handle Sheets gagal → buffer |
| Template email | `scripts/email-templates.js` | Template: notifikasi HR (High/Medium) + auto-reply tolak (Low) |

**Deliverable:** 3 script JS yang bisa dijalankan mandiri

**Verifikasi:** Jalankan `node --check` untuk syntax + jalankan dengan data contoh

---

### M4: n8n Workflow — Screening Pipeline (Utama)
**Goal:** Workflow utama yang mengorkestrasi semua proses.

| Task | Node | Keterangan |
|------|------|------------|
| Trigger | Google Forms Trigger | Trigger saat kandidat submit form |
| Download CV | Google Drive | Download file CV dari URL |
| Parse CV | Code Node | Panggil parse-cv.js logic |
| Rule Check | Code Node | Panggil rule-check.js logic + baca Kriteria Lowongan dari Sheets |
| IF Routing | IF Node | Memenuhi → lanjut LLM; Tidak Memenuhi → skip ke Tulis Sheets |
| LLM Scoring | HTTP Request + Code Node | Panggil LLM API; retry 3x; fallback rule-based |
| Rule Kategori | Code Node | Panggil rule-kategori.js logic |
| Dedup Check | Code Node | Panggil dedup-check.js; skip jika duplikat |
| Tulis Sheets | Google Sheets | Append baris ke Sheet "Data Kandidat" |
| Buffer Fallback | Code Node + Write File | Jika Sheets gagal → tulis buffer JSON |
| Routing Kategori | IF Node | High/Medium → Notifikasi HR; Low → set flag Pending |
| Notifikasi HR | Gmail | Email ke HR_EMAIL (hanya High/Medium) |
| Audit Log | Google Sheets | Tulis ke Sheet "Audit Log" |
| Error Handler | Error Trigger | Log semua error yang tidak ter-handle |

**Deliverable:** `n8n-workflows/screening-pipeline.json` (importable ke n8n)

**Verifikasi:** `node --check` pada semua functionCode dalam JSON; validasi JSON syntax

---

### M5: n8n Workflow — Auto-Reply Cron
**Goal:** Workflow cron harian untuk kirim auto-reply tolak + recovery buffer.

| Task | Node | Keterangan |
|------|------|------------|
| Cron Trigger | Cron Trigger | Jam 09:00 setiap hari |
| Baca Sheets | Google Sheets | Baca Sheet "Data Kandidat" dari semua lowongan aktif |
| Filter Low+Pending | Code Node | Filter: Kategori=Low AND Status Auto-Reply=Pending |
| Cek 3 Hari | Code Node | Filter: Timestamp ≤ 3 hari yang lalu |
| Loop | Split In Batches | Proses 1 per 1 kandidat |
| Kirim Email | Gmail | Email tolak ke kandidat |
| Update Status | Google Sheets | Update Status Auto-Reply = "Terkirim" |
| Buffer Recovery | Code Node | Baca folder buffer → coba tulis ulang ke Sheets |
| Audit Log | Google Sheets | Tulis ke Sheet "Audit Log" |
| Error Handler | Error Trigger | Log error |

**Deliverable:** `n8n-workflows/auto-reply-cron.json` (importable ke n8n)

**Verifikasi:** `node --check` pada semua functionCode; validasi JSON syntax

---

### M6: Integrasi & End-to-End Verification
**Goal:** Semua script & workflow terintegrasi, error handling jalan.

| Task | Keterangan |
|------|------------|
| Test pipeline utama dengan data contoh | Simulasi submit form → cek output di semua node |
| Test error handling | Simulasi: CV corrupt, LLM timeout, Sheets gagal → cek fallback ke buffer |
| Test auto-reply cron | Simulasi: kandidat Low sudah 3 hari → cek email terkirim |
| Test dedup | Simulasi: submit 2x email sama → cek skip + audit log |
| Test retry | Simulasi: LLM error 3x → cek fallback rule-based |

**Deliverable:** Laporan hasil test dengan output nyata

---

### M7: Documentation & Handoff
**Goal:** Dokumentasi lengkap untuk QA, DevOps, dan user.

| Task | File | Keterangan |
|------|------|------------|
| Setup guide | `docs/SETUP.md` | Cara install n8n, setup Google credentials, import workflow |
| HR guide | `docs/HR-GUIDE.md` | Cara HR membuat lowongan baru + isi kriteria di Sheets |
| Engineer report | `docs/ENGINEER_REPORT.md` | Laporan koding: file dibuat, verifikasi, catatan khusus |

**Deliverable:** 3 dokumen + repo bersih (tanpa artifact dev)

---

## Urutan Eksekusi

```
M0 → M1 → M2 → M3 → M4 → M5 → M6 → M7
 │    │    │    │    │    │    │    │
 └────┴────┴────┴────┴────┴────┴────┘
   Semua milestone berurutan, tidak paralel
   (setiap M bergantung pada M sebelumnya)
```

## Catatan Penting

1. **Semua functionCode di n8n JSON harus diverifikasi** dengan `node --check` sebelum dianggap selesai
2. **Tidak ada hardcoded secret** — semua pakai `$env.VARIABLE_NAME` di n8n
3. **Error handling di semua layer** — script, workflow, dan fallback buffer
4. **Nanti saat QA:** setiap script akan dijalankan dengan data contoh dan output asli dilampirkan
5. **Nanti saat DevOps:** repo akan dibersihkan (tidak ada .env asli, hanya .env.template)
