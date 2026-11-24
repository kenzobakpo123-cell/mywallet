# Keuangan Pribadi (Next.js + MySQL + React Native)

## Backend + web (folder ini)
1. Nyalakan MySQL (XAMPP), buat database kosong bernama `keuangan`.
2. `copy .env.example .env` lalu isi `DATABASE_URL`, `JWT_SECRET`, dan `ARCJET_KEY`.
   - `JWT_SECRET` **wajib** string acak minimal 32 karakter. Buat dengan:
     `node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"`
   - Gunakan user MySQL khusus (bukan `root`) dengan hak minimum.
   - `ARCJET_KEY` didapat gratis di https://app.arcjet.com. Kalau dikosongkan, aplikasi masih jalan dengan rate limiter in-memory.
   - `RESEND_API_KEY` + `EMAIL_FROM` dipakai untuk verifikasi email & reset password. Di development tanpa key, tautan dicetak di terminal instead of dikirim.
3. `npm install`
4. `npm run db:migrate` (menerapkan file di `prisma/migrations`). Untuk lingkungan lokal saat mengubah skema, pakai `npm run db:migrate:dev`. Cek dengan `npm run db:status`.
   - `npm run db:push` tetap ada sebagai jalan pintas, tapi **tidak disarankan lagi** untuk tim/produksi karena tidak menyimpan riwayat migrasi.
5. `npm run dev` lalu buka http://localhost:3000, daftar dan masuk.

## Aplikasi HP (folder mobile)
1. Di luar folder ini: `npx create-expo-app@latest keuangan-mobile --template blank-typescript`
2. Ganti isi `App.tsx` dengan `mobile/App.tsx`.
3. Pasang penyimpanan aman: `npx expo install expo-secure-store`
4. Buat file `.env` di proyek Expo dan isi `EXPO_PUBLIC_API_URL=https://alamat-api-anda`. URL wajib HTTPS dengan sertifikat yang dipercaya perangkat.
5. Untuk backend lokal, gunakan reverse proxy atau tunnel HTTPS yang tepercaya; jangan gunakan alamat HTTP atau IP laptop tanpa TLS. Aplikasi menolak URL non-HTTPS dan redirect.
6. Jalankan `npx expo start`, lalu scan QR dengan Expo Go.
7. Token akses **dan** refresh token disimpan melalui `expo-secure-store` dan otomatis dimuat saat aplikasi dibuka. Token akses diperbarui otomatis saat kedaluwarsa.
8. Login mobile memakai `POST /api/auth/mobile-login` (mengembalikan token di body). Login web memakai `POST /api/auth/login` dan token hanya disimpan di cookie httpOnly.
9. Transaksi bisa **ditambah, diubah, dan dihapus** langsung dari HP. Pilih jenis (masuk/keluar), kategori, catatan, tanggal, dan dompet. Navigasi bulan memakai tombol `‹` / `›`.
10. Sinkron dua arah dengan web: data dimuat ulang otomatis saat aplikasi kembali ke foreground, bisa di-*pull to refresh*, dan setiap perubahan langsung menarik data terbaru. Web juga menarik perubahan HP lewat `BroadcastChannel` + refresh tiap 30 detik.
11. Keluar dari aplikasi memanggil `POST /api/auth/logout` untuk mencabut sesi perangkat ini di server, bukan hanya menghapus token lokal.
12. Menu **Lupa password?** dan **Kirim ulang verifikasi** juga tersedia di layar login HP.
13. Aplikasi HP memuat profil dari server: mata uang, tanggal "hari ini", dan format angka mengikuti preferensi yang sama dengan web.
14. Menu **Perangkat aktif** di HP menampilkan sesi dan menyediakan tombol cabut perangkat lain.

## Catatan
- Gunakan `Ekspor CSV` pada dashboard untuk mengunduh transaksi bulan aktif (maks. 10.000 baris per ekspor).
- Riwayat web menampilkan 200 transaksi per halaman; tombol **Muat lebih banyak** mengambil halaman berikutnya dan filter tetap dipakai.
- Dashboard sinkron antartab lewat `BroadcastChannel` dan refresh otomatis tiap 30 detik saat tab aktif.
- Anggaran menampilkan penanda **Hampir habis** (≥80%) dan **Melewati batas** (≥100%).
- Panel **Profil** (menu ⚙) mengubah nama, zona waktu, dan mata uang. Semua tampilan uang memakai mata uang pilihan; "hari ini" dan bulan default mengikuti zona waktu pengguna, bukan UTC server.
- Tanggal transaksi disimpan sebagai kunci kalender `dateKey` (`YYYY-MM-DD`) sejak migrasi `20261120000100_profile_timezone`. Migrasi mengisi `dateKey` dari data lama, sehingga mengganti zona waktu **tidak menggeser** transaksi yang sudah tercatat.
- "Saldo saat ini" = total saldo awal dompet + seluruh pemasukan − seluruh pengeluaran (tidak hanya bulan berjalan).
- Setiap login membuat **sesi per perangkat**. Token akses berlaku 15 menit dan diperbarui otomatis lewat refresh token (30 hari) yang disimpan sebagai hash di tabel `Session`.
- Menu **Perangkat** menampilkan perangkat aktif, IP, dan waktu terakhir dipakai. Kamu bisa mencabut satu perangkat atau semua perangkat lain. Login dari perangkat baru memicu notifikasi email.
- **Keluar** hanya mencabut perangkat yang sedang dipakai. Reset password tetap mencabut semua sesi sekaligus.
- Pendaftaran baru wajib verifikasi email sebelum bisa masuk. Akun lama otomatis dianggap terverifikasi oleh migrasi `20261119000100_auth_email`.
- Lupa password dan kirim ulang verifikasi tersedia di halaman masuk. Reset password juga menaikkan `tokenVersion`.
- Rate limit, Shield/WAF, dan validasi email memakai **Arcjet** (`ARCJET_KEY`). Tanpa key, sistem jatuh ke rate limiter in-memory untuk lokal.
- MySQL bisa dijalankan via Docker: `docker compose up -d` (port `3307` agar tidak bentrok dengan XAMPP). `.env` lalu pakai `mysql://finwise:finwise-rahasia@localhost:3307/keuangan`.
- Jangan commit file `.env` dengan secret asli. Rotasi `JWT_SECRET` jika pernah terekspos.

## Produksi
1. `copy .env.production.example .env.production` lalu isi **semua** nilai. Validasi akan menolak startup kalau `JWT_SECRET`, `ARCJET_KEY`, `RESEND_API_KEY`, atau `EMAIL_FROM` tidak valid.
2. `docker compose -f docker-compose.prod.yml up -d --build` — menjalankan MySQL + aplikasi, dan migrasi dijalankan otomatis saat container app mulai.
3. Health check: `GET /api/health` mengembalikan `200` kalau database terhubung.
4. Backup: `npm run db:backup` (memakai `mysqldump` lokal, atau fallback ke container MySQL Docker). Hasil ada di folder `backups/`.
5. CI GitHub Actions menjalankan `lint`, `test`, `migrate`, dan `build` pada setiap push/PR.

### Deploy ke Vercel + MySQL cloud
1. Pakai MySQL cloud yang **mendukung foreign key** (mis. Aiven for MySQL atau Railway MySQL). PlanetScale bisa, tapi perlu mengubah schema ke `relationMode = "prisma"` dan menyesuaikan migrasi karena tidak mendukung FK.
2. Import repo ke Vercel. `vercel.json` sudah mengatur build command menjadi `npm run build:vercel`, yaitu `prisma migrate deploy && next build`.
3. Isi Environment Variables di Vercel: `DATABASE_URL`, `JWT_SECRET`, `ARCJET_KEY`, `RESEND_API_KEY`, dan `EMAIL_FROM`.
4. **Tanpa beli domain (cukup untuk mulai):** Vercel otomatis memberi `https://<nama-project>.vercel.app` — gratis, HTTPS, dan SSL otomatis. Pakai URL itu untuk web dan untuk `EXPO_PUBLIC_API_URL` di Expo. Tidak perlu mengubah DNS di IDwebhost.
5. **Domain sendiri (opsional, berbayar):** di Vercel → **Settings → Domains → Add**, lalu di DNS registrar arahkan `A @` ke `76.76.21.21` dan `CNAME www` ke `cname.vercel-dns.com`.
6. Resend: untuk mulai, pakai `EMAIL_FROM="Finwise <onboarding@resend.dev>"`. Domain `resend.dev` hanya bisa mengirim ke **email akun Resend kamu sendiri**. Agar bisa mengirim ke email orang lain, tambahkan domain di Resend → **Domains** dan pasang record SPF/DKIM/DMARC di DNS.
7. Di Arcjet, buat site untuk hostname yang dipakai (boleh `*.vercel.app`) dan salin Site Key ke `ARCJET_KEY`.
8. Di project Expo, isi `EXPO_PUBLIC_API_URL="https://<nama-project>.vercel.app"` bila belum punya domain sendiri.
9. Cek `https://<nama-project>.vercel.app/api/health` sebelum dipakai HP.

> Railway: `mysql.railway.internal` hanya bisa diakses dari dalam jaringan Railway. Untuk Vercel, buat **TCP proxy** pada service MySQL dan pakai endpoint publiknya di `DATABASE_URL`, misalnya `mysql://root:PASSWORD@hopper.proxy.rlwy.net:15197/railway`.

Deploy saat ini: `https://mywallet-virid-eight.vercel.app`.

Audit log tersimpan di tabel `AuditLog` (login, logout, register, verifikasi, reset password, sesi, dan perubahan data). Audit memakai kunci klien; tabel `Session` menyimpan IP hanya untuk ditampilkan pengguna pada daftar perangkat. Refresh token disimpan sebagai hash SHA-256.
