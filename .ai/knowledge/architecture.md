# ARSITEKTUR TEKNIS - Otomatisasi Screening Kandidat untuk Tim HR

## 1. Pendekatan Utama

- [x] n8n Orchestration (single instance, single mode)
- [x] Custom Script (JavaScript/Node di dalam n8n Code Node)
- [x] Kombinasi: n8n sebagai orkestrator utama + LLM API untuk enrichment/scoring + Google Workspace sebagai storage

**Alasan:** Flow-nya linear (form → rule check → LLM → kategori → notifikasi) dengan banyak integrasi Google Services (Forms, Sheets, Drive, Gmail). n8n paling cepat dibangun untuk integrasi SaaS semacam ini tanpa perlu menulis boilerplate API connection manual. Custom logic (rule check, parsing CV, scoring) dijalankan di dalam Code Node n8n.

**Constraints:**
- Single instance n8n (bukan queue mode)
- Tanpa Docker (n8n dijalankan langsung dari source/npm)
- Satu workflow utama + satu cron harian kecil (auto-reply 3 hari)

## 2. Aliran Data (Data Flow)

### Alur Utama (1 Workflow)

```
Google Form (kandidat submit)
    │
    ▼
[Node 1] Trigger: Google Forms Trigger
    │
    ▼
[Node 2] Download CV dari Google Drive
    │
    ▼
[Node 3] Parse CV (PDF/DOCX → teks)
    │
    ├── Parse gagal → flag "error_parse", skor 0, kategori Low, auto-reply tolak
    │
    ▼
[Node 4] Rule Check — Syarat Wajib
    │  (Code Node: baca kriteria dari Sheet "Kriteria Lowongan",
    │   cek apakah semua syarat wajib ditemukan di teks CV)
    │
    ├── Tidak Memenuhi → skor 0, kategori Low → langsung ke Node 7 (Tulis Sheets)
    └── Memenuhi → lanjut ke Node 5
    │
    ▼
[Node 5] LLM Enrichment + Scoring
    │  (HTTP Request ke LLM API, dengan retry 3x)
    │  Input: teks CV + kriteria + bobot
    │  Output: skor, skill_terdeteksi, alasan_llm
    │
    ├── LLM gagal setelah retry → fallback ke rule-based scoring → lanjut ke Node 6
    └── LLM berhasil → lanjut ke Node 6
    │
    ▼
[Node 6] Rule Kategori
    │  (Code Node: kategori berdasarkan ambang skor)
    │  High ≥ 80 | Medium 40-79 | Low < 40
    │
    ▼
[Node 7] Tulis ke Google Sheets
    │  (Google Sheets Node: Append 1 baris ke Sheet "Data Kandidat")
    │
    ├── Sheets gagal → simpan ke buffer file JSON lokal → retry setiap 5 menit (max 10x)
    └── Sheets berhasil → lanjut ke Node 8
    │
    ▼
[Node 8] Routing Kategori
    │
    ├── High/Medium → Node 9 (Notifikasi HR)
    ├── Low         → Node 10 (Tulis flag auto_reply = "Pending")
    └── Semua       → Node 11 (Tulis Audit Log)
```

### Alur Auto-Reply (Cron Harian Terpisah)

```
[Node A] Cron Trigger: setiap hari jam 09:00
    │
    ▼
[Node B] Baca Google Sheets → filter Kategori = Low AND Status Auto-Reply = "Pending"
    │
    ▼
[Node C] Filter: apakah timestamp ≤ 3 hari yang lalu?
    │
    ├── Ya, sudah ≤ 3 hari → Node D
    └── Belum, skip
    │
    ▼
[Node D] Kirim Auto-Reply Email Tolak
    │
    ├── Kirim gagal → retry 3x, update status = "Gagal", flag untuk retry manual
    ├── Kirim berhasil → update Status Auto-Reply = "Terkirim"
    └── Tulis Audit Log
```

## 3. Struktur Folder

```
ai-hr-recruitment-automation/
├── .ai/
│   ├── knowledge/
│   │   ├── prd.md (sudah ada - v2 approved)
│   │   ├── project-brief-ai-hr-recruitment-automation.md (sudah ada)
│   │   └── architecture.md (dokumen ini)
│   └── decisions/ (tempat ADR nanti)
├── n8n-workflows/
│   ├── screening-pipeline.json      ← workflow utama
│   └── auto-reply-cron.json         ← cron harian auto-reply
├── config/
│   └── .env.template                ← template environment variables
├── scripts/
│   ├── parse-cv.js                  ← fungsi parse PDF/DOCX di Code Node
│   ├── rule-check.js                ← fungsi rule check syarat wajib
│   ├── llm-scoring.js               ← fungsi panggil LLM + parse response
│   └── rule-kategori.js             ← fungsi mapping skor → kategori
├── tests/                           ← kosong, Engineer/QA isi nanti
└── docs/
    └── ARCHITECTURE.md              ← symlink ke .ai/knowledge/architecture.md
```

## 4. Dependency & Environment Variables

### Google Services (via n8n Credentials)
- `GOOGLE_FORMS_CREDENTIALS` — OAuth2 Google untuk Trigger Form
- `GOOGLE_DRIVE_CREDENTIALS` — OAuth2 Google untuk Download CV
- `GOOGLE_SHEETS_CREDENTIALS` — OAuth2 Google untuk baca/tulis Sheets
- `GMAIL_CREDENTIALS` — OAuth2 Google untuk kirim email (notifikasi + auto-reply)

### LLM API
- `LLM_API_KEY` — API key provider LLM pilihan
- `LLM_API_URL` — Endpoint API LLM
- `LLM_MODEL` — Nama model (misal: gpt-4o-mini, claude-haiku, dll)

### n8n Configuration
- `N8N_PORT` — Port n8n berjalan (default: 5678)
- `N8N_WEBHOOK_URL` — URL publik n8n (jika perlu akses dari luar)
- `N8N_TIMEZONE` — Timezone untuk cron (Asia/Jakarta)

### HR Notification
- `HR_EMAIL` — Alamat email HR tetap (1 alamat, untuk notifikasi)

### Buffer & Fallback
- `BUFFER_DIR` — Lokasi file buffer JSON lokal (jika Google Sheets gagal)

## 5. Database

- [x] Google Sheets (bukan SQLite/PostgreSQL)

**Struktur Sheets:**

### Sheet 1: `Data Kandidat` (per lowongan)

| Kolom | Tipe | Sumber | Keterangan |
|-------|------|--------|------------|
| Timestamp | datetime | Google Form otomatis | Waktu submit |
| Nama | text | Form | Nama lengkap |
| Email | email | Form | Alamat email kandidat |
| No HP | text | Form | Nomor HP |
| Lowongan | text | Form | Posisi yang dilamar |
| URL CV | url | Google Form → Drive | Link file CV di Drive |
| Rule Check | text | Tahap 1 (rule) | "Memenuhi" / "Tidak Memenuhi" |
| Alasan Rule Check | text | Tahap 1 | Alasan jika tidak memenuhi |
| Skill Terdeteksi | text | Tahap 2 (LLM) | Skill yang diekstrak LLM |
| Skor LLM | number | Tahap 2 (LLM) | Skor 0-100 |
| Alasan Skor | text | Tahap 2 (LLM) | Narasi alasan LLM |
| Enrichment Notes | text | Tahap 2 (LLM) | Catatan skill ekuivalen |
| Kategori | text | Tahap 3 (rule) | "High" / "Medium" / "Low" |
| Alasan Kategori | text | Tahap 3 (rule) | Ringkasan keputusan |
| Kategori Label | text | Tahap 3 (rule) | "Layak Lanjut" / "Perlu Ditinjau" / "Belum Sesuai" |
| Status Notifikasi HR | text | n8n | "Terkirim" / "Gagal" / "N/A" |
| Status Auto-Reply | text | n8n (cron) | "Terkirim" / "Pending" / "Gagal" / "N/A" |
| Waktu Auto-Reply | datetime | n8n (cron) | Timestamp pengiriman |
| Error Flag | text | n8n | "parse_error" / "llm_error" / "" (kosong jika sukses) |

### Sheet 2: `Kriteria Lowongan` (1 baris per lowongan)

| Kolom | Tipe | Keterangan |
|-------|------|------------|
| Lowongan | text | Nama posisi (harus sama dengan opsi di Form) |
| Kriteria Wajib | text | Skill/pengalaman/pendidikan minimum (pisah dengan koma atau newline) |
| Bobot Skill | number | Default 0.40 |
| Bobot Pengalaman | number | Default 0.35 |
| Bobot Pendidikan | number | Default 0.25 |
| Ambang High | number | Default 80 |
| Ambang Low | number | Default 40 |
| HR Email | email | Alamat email HR untuk notifikasi |

### Sheet 3: `Audit Log` (append-only, tidak pernah diedit)

| Kolom | Tipe | Keterangan |
|-------|------|------------|
| Timestamp | datetime | Waktu event |
| Event Type | text | "rule_check" / "llm_scoring" / "kategori" / "write_sheets" / "notif_hr" / "auto_reply" / "error" / "retry" |
| Email Kandidat | email | Email kandidat |
| Lowongan | text | Nama posisi |
| Detail | text | Deskripsi event / error message |
| Status | text | "Success" / "Failed" / "Retry" |

## 6. Catatan Keamanan & Robustness (Desain Level)

### 6.1 Error Handling Pipeline

| Error Skenario | Penanganan | Action |
|----------------|-------------|--------|
| CV tidak terbaca (PDF corrupt/terenkripsi) | Flag "error_parse", skip LLM | Skor 0, kategori Low, auto-reply tolak 3 hari |
| LLM API timeout / error | Retry 3x dengan backoff (1s, 3s, 7s) | Jika gagal setelah 3x → fallback rule-based scoring (tanpa enrichment) |
| Google Sheets API gagal tulis | Retry 3x dengan backoff (2s, 5s, 10s) | Jika gagal setelah 3x → simpan ke buffer file JSON lokal |
| Google Sheets API gagal baca | Retry 3x | Jika gagal → gunakan default kriteria dari .env |
| Email notifikasi HR gagal | Retry 3x | Jika gagal → update status "Gagal" + tulis audit log |
| Email auto-reply gagal | Retry 3x | Jika gagal → status "Gagal", cron harian akan coba lagi di hari berikutnya (selama ≤ 3 hari) |
| Google Form trigger error | n8n auto-retry | Nanti cek log n8n |
| Duplikat kandidat (email + lowongan sama) | Cek duplikat sebelum tulis | Skip tulis + tulis audit log "duplicate_skipped" |

### 6.2 Buffer / Fallback System

**File Buffer (JSON Lokal):**
- Lokasi: `{BUFFER_DIR}/buffer-{timestamp}.json`
- Trigger: Google Sheets gagal setelah 3x retry
- Format:
  ```json
  {
    "timestamp": "...",
    "kandidat_email": "...",
    "lowongan": "...",
    "data": { ... semua kolom Data Kandidat ... },
    "retry_count": 0,
    "max_retry": 10,
    "next_retry": "ISO timestamp"
  }
  ```
- Recovery: n8n cron harian (bisa gabung dengan cron auto-reply) akan mengecek buffer folder, coba tulis ulang ke Sheets, max 10 retry dengan interval 5 menit
- Monitoring: setiap buffer write → tulis ke Audit Log sebagai event "buffer_written"

### 6.3 Deduplication

- Kunci dedup: `Email` + `Lowongan`
- Cek sebelum tulis: baca Sheet "Data Kandidat", cari baris dengan Email + Lowongan yang sama
- Jika ditemukan dalam 24 jam terakhir → skip tulis + audit log "duplicate_skipped"
- Alasan: Google Form bisa dikirim 2x oleh kandidat yang sama (double-click)

### 6.4 Timeout Protection

| Komponen | Timeout | Action saat timeout |
|----------|---------|-------------------|
| Download CV dari Drive | 30 detik | Flag error, lanjut tanpa CV (parse error) |
| Parse CV (PDF/DOCX) | 60 detik | Flag "error_parse", skip LLM |
| LLM API call | 120 detik | Retry 3x, fallback ke rule-based |
| Tulis Google Sheets | 30 detik | Retry 3x, fallback ke buffer |
| Kirim Email (HR / auto-reply) | 30 detik | Retry 3x, update status "Gagal" |

### 6.5 Rate Limiting & Throttling

- **LLM API**: Jika provider punya rate limit, tambahkan delay 1 detik antar request (Code Node)
- **Google Sheets API**: Maks 60 request/menit (Google default), cukup untuk 1000 kandidat/hari
- **Gmail API**: Maks 500 email/hari (Google free tier), cukup untuk notifikasi HR + auto-reply

### 6.6 Retry Strategy (Universal)

```
Retry count: 3
Backoff: eksponensial (1s → 3s → 7s)
Setelah gagal: fallback / buffer / flag error
Semua retry dicatat di Audit Log
```

## 7. Catatan Khusus

### 7.1 Parsing CV
- File CV berformat PDF dan/atau DOCX
- Parser perlu menangani kedua format
- Output: teks plain (hasil ekstraksi)
- Jika CV berformat lain (JPG, PNG, ZIP) → flag "format_unsupported" → kategori Low

### 7.2 LLM Prompt Design
- Input: teks CV + job deskripsi + kriteria wajib + bobot
- Output: JSON dengan field `skor`, `skill_terdeteksi`, `alasan_llm`, `enrichment_notes`
- Instruksi ke LLM harus memasukkan logika "skill ekuivalen/superior" (contoh: Adobe Premiere > Capcut)
- Bahasa output LLM: Indonesia

### 7.3 Google Form Setup
- Form harus punya field: Nama, Email, No HP, Lowongan (dropdown), Upload CV
- Dropdown "Lowongan" harus sesuai dengan nama di Sheet "Kriteria Lowongan"
- Upload CV otomatis masuk Google Drive → URL-nya tercatat di response form

### 7.4 Google Sheets sebagai Database
- Tidak ada relational integrity → handling di Code Node
- Sheet per lowongan: jika 3 lowongan aktif → 3 file Sheets terpisah
- HR membuat Sheets baru untuk lowongan baru, lalu isi Sheet "Kriteria Lowongan" dengan kriteria posisi itu
- File CV tetap di Google Drive, Sheets hanya menyimpan URL-nya

### 7.5 Notifikasi HR
- Email dikirim hanya untuk kategori High dan Medium
- Email berisi: nama kandidat, lowongan, kategori, skor, alasan, skill terdeteksi
- Tidak ada link ke CV langsung → HR buka Sheets, cari kandidat, buka URL CV dari sana

### 7.6 Auto-Reply Kandidat
- Hanya untuk kategori Low (termasuk yang gugur di rule check awal)
- Dikirim 3 hari setelah kandidat terskor (delay 3 hari)
- Cron harian cek kandidat Low dengan status "Pending" + timestamp sudah ≤ 3 hari
- Email berisi pesan penolakan yang sopan (template bisa di-Sheet atau .env)
- Jika email gagal dikirim → cron akan coba lagi di hari berikutnya (selama masih ≤ 3 hari dari timestamp)

### 7.7 n8n Setup (Tanpa Docker)
- n8n diinstal langsung via npm atau download binary
- Dijalankan sebagai background process atau service
- Tidak perlu containerisasi
- Data n8n (history, credentials) tersimpan lokal di folder n8n

## 8. Riwayat Perubahan

| Versi | Tanggal | Perubahan | ADR terkait |
|---|---|---|---|
| v1 | 2026-08-30 | Desain awal — semua keputusan dari diskusi D1-D10 + X2 | - |
