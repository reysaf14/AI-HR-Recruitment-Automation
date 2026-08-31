/**
 * email-templates.js
 * ==================
 * Template email untuk notifikasi HR & auto-reply kandidat.
 * 
 * Catatan desain (architecture.md section 7.5 & 7.6):
 * - Notifikasi HR: email ke 1 alamat tetap, hanya untuk High/Medium.
 *   Isi: nama kandidat, lowongan, kategori, skor, alasan, skill terdeteksi.
 * - Auto-reply: email ke kandidat Low, dikirim 3 hari setelah terskor (cron).
 *   Pesan penolakan sopan. Template bisa di-Sheet atau .env.
 * 
 * Cara pakai:
 *   const { hrNotificationEmail, autoReplyRejectEmail } = require('./email-templates.js');
 */

'use strict';

// ============================================================
// UTILITAS: Interpolasi placeholder {key} dalam template
// ============================================================
function fillTemplate(template, data) {
  if (!template) return '';
  return String(template).replace(/\{(\w+)\}/g, (match, key) => {
    const val = data[key];
    return val !== undefined && val !== null ? String(val) : match;
  });
}

// ============================================================
// TEMPLATE: Notifikasi HR (High / Medium)
// ============================================================
/**
 * Bangun email notifikasi HR untuk kandidat High/Medium.
 * @param {object} data - { nama, lowongan, kategori, label, skor, alasan, skill, emailKandidat }
 * @returns {object} - { subject, bodyHtml, bodyText, to }
 */
function hrNotificationEmail(data = {}) {
  const {
    nama = '',
    lowongan = '',
    kategori = '',
    label = '',
    skor = '',
    alasan = '',
    skill = [],
    emailKandidat = '',
    hrEmail = '',
  } = data;

  const skillList = Array.isArray(skill) && skill.length > 0
    ? skill.join(', ')
    : '(tidak terdeteksi)';

  const subject = '[Lamaran ' + kategori + '] ' + nama + ' - ' + lowongan;

  const bodyText = [
    'Kandidat ' + kategori + ' (Layak Lanjut/Perlu Ditinjau):',
    '',
    'Nama: ' + nama,
    'Email: ' + emailKandidat,
    'Lowongan: ' + lowongan,
    'Kategori: ' + kategori + ' (' + label + ')',
    'Skor: ' + skor + '/100',
    'Skill Terdeteksi: ' + skillList,
    '',
    'Alasan:',
    alasan || '(tidak ada alasan)',
    '',
    'Buka Google Sheets untuk melihat detail lengkap dan CV kandidat.',
  ].join('\n');

  const bodyHtml = [
    '<h3>Kandidat ' + kategori + ' (' + label + ')</h3>',
    '<table>',
    '<tr><td><b>Nama</b></td><td>' + nama + '</td></tr>',
    '<tr><td><b>Email</b></td><td>' + emailKandidat + '</td></tr>',
    '<tr><td><b>Lowongan</b></td><td>' + lowongan + '</td></tr>',
    '<tr><td><b>Kategori</b></td><td>' + kategori + ' (' + label + ')</td></tr>',
    '<tr><td><b>Skor</b></td><td>' + skor + '/100</td></tr>',
    '<tr><td><b>Skill</b></td><td>' + skillList + '</td></tr>',
    '</table>',
    '<p><b>Alasan:</b><br>' + (alasan || '(tidak ada alasan)') + '</p>',
    '<p><i>Buka Google Sheets untuk detail lengkap dan CV kandidat.</i></p>',
  ].join('');

  return {
    subject,
    bodyHtml,
    bodyText,
    to: hrEmail,
  };
}

// ============================================================
// TEMPLATE: Auto-Reply Tolak (kandidat Low, 3 hari)
// ============================================================
/**
 * Bangun email auto-reply penolakan untuk kandidat Low.
 * @param {object} data - { nama, lowongan, perusahaan }
 * @returns {object} - { subject, bodyText, to }
 */
function autoReplyRejectEmail(data = {}) {
  const {
    nama = '',
    lowongan = '',
    perusahaan = '',
    emailKandidat = '',
  } = data;

  const subject = fillTemplate(
    process.env.EMAIL_SUBJECT_REJECT || 'Informasi Lamaran - {lowongan}',
    { lowongan }
  );

  const bodyText = [
    'Halo ' + (nama || 'Calon Kandidat') + ',',
    '',
    'Terima kasih telah melamar posisi ' + lowongan +
      (perusahaan ? ' di ' + perusahaan : '') + '.',
    '',
    'Kami telah meninjau lamaran Anda dengan saksama. Pada tahap seleksi ini,',
    'kami menilai profil Anda belum sesuai dengan kriteria yang dibutuhkan',
    'untuk posisi tersebut.',
    '',
    'Kami sangat menghargai waktu dan minat Anda untuk bergabung dengan kami.',
    'Kami berharap Anda sukses dalam perjalanan karier dan semoga kita dapat',
    'bekerja sama di kesempatan lain.',
    '',
    'Salam hangat,',
    (perusahaan || 'Tim Rekrutmen'),
  ].join('\n');

  return {
    subject,
    bodyText,
    bodyHtml: bodyText.replace(/\n/g, '<br>'),
    to: emailKandidat,
  };
}

// ============================================================
// DUKUNGAN CLI (untuk testing mandiri)
// ============================================================
if (require.main === module) {
  const tipe = process.argv[2] || 'hr';

  if (tipe === 'hr') {
    const email = hrNotificationEmail({
      nama: 'Budi Santoso',
      lowongan: 'Sales Executive',
      kategori: 'High',
      label: 'Layak Lanjut',
      skor: 85,
      alasan: 'Pengalaman 3 tahun B2B sales, menguasai CRM.',
      skill: ['B2B Sales', 'CRM', 'Negosiasi'],
      emailKandidat: 'budi@example.com',
      hrEmail: 'hr@example.com',
    });
    console.log('SUBJECT:', email.subject);
    console.log('TO:', email.to);
    console.log('--- TEXT ---');
    console.log(email.bodyText);
  } else {
    const email = autoReplyRejectEmail({
      nama: 'Siti Aminah',
      lowongan: 'Video Editor',
      perusahaan: 'PT Kreatif Nusantara',
      emailKandidat: 'siti@example.com',
    });
    console.log('SUBJECT:', email.subject);
    console.log('TO:', email.to);
    console.log('--- TEXT ---');
    console.log(email.bodyText);
  }
}

module.exports = { hrNotificationEmail, autoReplyRejectEmail, fillTemplate };