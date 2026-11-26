# Runbook keamanan Finwise

Dokumen ini berisi prosedur singkat untuk menjaga akses dan memulihkan kondisi darurat. Jangan menyimpan secret di repository atau file yang bisa di-commit.

## Rotasi secret

Lakukan rotasi setiap 90 hari, atau segera kalau ada indikasi kebocoran.

1. `JWT_SECRET`: buat nilai acak minimal 32 karakter, update di Vercel (Production + Preview), lalu deploy ulang. Semua sesi lama akan otomatis tidak valid.
2. Password database Railway: ganti lewat Railway Dashboard, lalu update `DATABASE_URL` di Vercel. Deploy ulang.
3. `ARCJET_KEY` dan `RESEND_API_KEY`: buat key baru di dashboard masing-masing, update di Vercel, deploy ulang, lalu cabut key lama.
4. `BACKUP_PASSPHRASE`: simpan di password manager. Kalau diganti, enkripsi ulang arsip backup lama.

## Backup database

- Backup manual terenkripsi: `npm run db:backup:secure` dengan `DATABASE_URL` dan `BACKUP_PASSPHRASE` (minimal 16 karakter) tersedia di environment.
- Hasil backup berada di folder `backups/` yang sudah di-gitignore.
- Jadwalkan backup harian dari mesin/admin yang terpercaya, lalu salin file `.enc` ke penyimpanan terpisah.
- Format file: `v1.<iv>.<authTag>` di baris pertama, diikuti data SQL gzip + AES-256-GCM.

## Respons insiden

- Jika ada email peringatan login gagal/lockout: buka **Pengaturan → Lihat aktivitas** dan **Kelola perangkat**.
- Jika 2FA dinonaktifkan atau password diubah tanpa sepengetahuan pemilik: ganti password, aktifkan kembali 2FA, cabut semua sesi, dan rotasi `JWT_SECRET`.
- Jika kode pemulihan dipakai: buat kode pemulihan baru dari **Pengaturan → Verifikasi dua faktor**.

## Pemeliharaan

- Jalankan `npm audit` secara berkala dan update dependency minor/patch.
- Pastikan `ALLOWED_EMAILS` dan `REQUIRE_2FA_EMAILS` berisi akun yang benar-benar dipakai.
- Verifikasi `APP_URL` selalu HTTPS canonical, bukan URL deployment sementara.
