/**
 * retry-helpers.js
 * ================
 * Fungsi retry universal dengan backoff eksponensial.
 * 
 * Catatan desain (architecture.md section 6.6):
 * - Retry count: 3
 * - Backoff: eksponensial (1s → 3s → 7s)
 * - Setelah gagal: fallback / buffer / flag error
 * - Semua retry dicatat di Audit Log (dipanggil oleh caller)
 * 
 * Cara pakai:
 *   const { retryWithBackoff, sleep } = require('./retry-helpers.js');
 *   const result = await retryWithBackoff(async () => {
 *     return await someApiCall();
 *   }, { maxRetries: 3, baseDelayMs: 1000 });
 */

'use strict';

// ============================================================
// UTILITAS: Sleep
// ============================================================
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ============================================================
// FUNGSI UTAMA: Retry dengan Backoff Eksponensial
// ============================================================
/**
 * Jalankan fn dengan retry & backoff eksponensial.
 * @param {Function} fn - Async function yang dipanggil. Harus melempar error jika gagal.
 * @param {object} options
 * @param {number} [options.maxRetries=3] - Jumlah max retry (setelah percobaan pertama)
 * @param {number} [options.baseDelayMs=1000] - Delay dasar sebelum retry (ms)
 * @param {number} [options.multiplier=3] - Faktor pengali tiap retry (eksponensial)
 * @param {number} [options.timeoutMs=0] - Timeout per percobaan (0 = tanpa timeout), opsional
 * @param {Function} [options.onRetry] - Callback dipanggil tiap retry: (error, attempt, delayMs)
 * @returns {Promise<object>} { ok, data, attempts, error, retries }
 */
async function retryWithBackoff(fn, options = {}) {
  const {
    maxRetries = 3,
    baseDelayMs = 1000,
    multiplier = 3,
    timeoutMs = 0,
    onRetry = null,
  } = options;

  let lastError = null;
  let attempt = 0;
  const maxAttempts = maxRetries + 1; // percobaan pertama + retry

  while (attempt < maxAttempts) {
    attempt++;
    try {
      let result;
      if (timeoutMs > 0) {
        result = await withTimeout(fn(), timeoutMs);
      } else {
        result = await fn();
      }
      return {
        ok: true,
        data: result,
        attempts: attempt,
        error: null,
        retries: attempt - 1,
      };
    } catch (err) {
      lastError = err;
      if (attempt >= maxAttempts) break;

      // Hitung delay: baseDelay * multiplier^(attempt-1)
      const delayMs = baseDelayMs * Math.pow(multiplier, attempt - 1);
      if (typeof onRetry === 'function') {
        try { onRetry(lastError, attempt, delayMs); } catch (_e) { /* ignore */ }
      }
      await sleep(delayMs);
    }
  }

  return {
    ok: false,
    data: null,
    attempts: attempt,
    error: lastError,
    retries: attempt - 1,
  };
}

// ============================================================
// UTILITAS: Timeout untuk satu percobaan
// ============================================================
function withTimeout(promise, timeoutMs) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error('Timeout setelah ' + timeoutMs + 'ms'));
    }, timeoutMs);
    promise.then(
      (val) => { clearTimeout(timer); resolve(val); },
      (err) => { clearTimeout(timer); reject(err); }
    );
  });
}

// ============================================================
// DUKUNGAN CLI (untuk testing mandiri)
// ============================================================
if (require.main === module) {
  // Simulasi: fungsi yang gagal 2x lalu sukses
  let callCount = 0;
  const flakyFn = async () => {
    callCount++;
    if (callCount < 3) {
      throw new Error('Simulasi gagal percobaan ke-' + callCount);
    }
    return { success: true, callCount };
  };

  retryWithBackoff(flakyFn, {
    maxRetries: 3,
    baseDelayMs: 50, // kecil-kan untuk testing
    onRetry: (err, attempt, delay) => {
      console.log('Retry #' + attempt + ' setelah ' + delay + 'ms:', err.message);
    },
  }).then((result) => {
    console.log(JSON.stringify(result, null, 2));
  });
}

module.exports = { retryWithBackoff, withTimeout, sleep };