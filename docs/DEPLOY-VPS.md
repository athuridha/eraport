# Deploy e-Rapor SMK Pratama Mulya ke VPS (Ubuntu 24.04)

Panduan lengkap: dari VPS baru (IP + password root) sampai aplikasi jalan dengan
HTTPS, proses tetap hidup setelah reboot, dan backup otomatis.

Spek minimum yang diuji: **2 vCPU / 2 GB RAM / 40 GB SSD / Ubuntu 24.04 LTS**.

| Simbol                  | Arti                                  |
| ----------------------- | ------------------------------------- |
| `IP_VPS`                | IP publik VPS                         |
| `erapor`                | user non-root khusus aplikasi         |
| `/home/erapor/erapor`   | folder aplikasi                       |
| `erapor.sekolah.sch.id` | domain (opsional; bisa pakai IP dulu) |

---

## 1. Persiapan server

```sh
ssh root@IP_VPS

# user khusus app
adduser erapor
usermod -aG sudo erapor

# update + dasar
apt update && apt upgrade -y
apt install -y curl git ufw

# firewall: hanya SSH, HTTP, HTTPS
ufw allow OpenSSH
ufw allow 80/tcp
ufw allow 443/tcp
ufw enable
```

### 1.1 Swap (disarankan untuk RAM 2GB)

Build Vite + render PDF bisa memuncak; swap mencegah OOM-kill.

```sh
fallocate -l 2G /swapfile
chmod 600 /swapfile
mkswap /swapfile
swapon /swapfile
echo '/swapfile none swap sw 0 0' >> /etc/fstab
```

### 1.2 Node.js 22 LTS

```sh
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
apt install -y nodejs
node -v   # v22.x
```

### 1.3 pnpm + pm2

```sh
npm i -g pnpm pm2
```

### 1.4 Chrome untuk cetak PDF

`src/lib/server/pdf/pagedpdf.ts` mencari Chrome/Chromium di
`/usr/bin/google-chrome-stable`, `/usr/bin/chromium`, dst., atau lewat env
`PUPPETEER_EXECUTABLE_PATH`. Cara paling mulus di 24.04: repo resmi Google
(semua dependency ikut terpasang).

```sh
wget -qO- https://dl.google.com/linux/linux_signing_key.pub \
  | gpg --dearmor -o /usr/share/keyrings/google-chrome.gpg
echo "deb [arch=amd64 signed-by=/usr/share/keyrings/google-chrome.gpg] http://dl.google.com/linux/chrome/deb/ stable main" \
  > /etc/apt/sources.list.d/google-chrome.list
apt update && apt install -y google-chrome-stable
which google-chrome-stable   # /usr/bin/google-chrome-stable
```

Alternatif: `apt install -y chromium-browser` (wrapper snap). App launch Chrome
dengan `--no-sandbox`, jadi aman dijalankan sebagai user non-root.

---

## 2. Deploy aplikasi

```sh
su - erapor
git clone <URL_REPO> ~/erapor
cd ~/erapor
pnpm install
pnpm build          # vite build → build/index.js (adapter-node)
mkdir -p data backup
```

### .env

```sh
cat > .env <<'EOF'
NODE_ENV=production
HOST=127.0.0.1
PORT=3000
DB_URL="file:/home/erapor/erapor/data/database.sqlite3"
BODY_SIZE_LIMIT=5M
PUPPETEER_EXECUTABLE_PATH=/usr/bin/google-chrome-stable
EOF
```

- `BODY_SIZE_LIMIT=5M` — default 512K akan menggagalkan upload arsip murid 4MB
  (diparse di `src/hooks.server.ts`).
- `HOST=127.0.0.1` — app hanya melayani lewat reverse proxy, tidak telanjang di port 3000.
- Jangan komit `.env` ke git.

Saat start pertama, `runStartupEnsures()` membuat/menambahkan skema DB dan
`ensureDefaultAdmin()` membuat akun `Admin / Admin123` — **ganti passwordnya segera**.

---

## 3. pm2 (proses tetap hidup + auto-start saat reboot)

```sh
cd ~/erapor
pm2 start scripts/start-build.mjs --name erapor --time
pm2 save
pm2 startup systemd -u erapor --hp /home/erapor
# → jalankan perintah sudo yang dicetaknya, lalu:
pm2 save
```

- `scripts/start-build.mjs` = entri point resmi: load `.env` lalu import `build/index.js`.
- **1 instance saja** (jangan `-i max`/cluster): scheduler bel sekolah dan
  auto-update hidup di dalam proses; dobel proses = bel bunyi dua kali.
- Cek: `pm2 logs erapor` → harus muncul `[db] creating libsql client; DB_URL=file:...`.
- Setelah mengubah `.env`: `pm2 restart erapor`.

---

## 4. Caddy (reverse proxy + SSL otomatis)

Jalankan sebagai root:

```sh
apt install -y debian-keyring debian-archive-keyring apt-transport-https curl
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' \
  | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' \
  > /etc/apt/sources.list.d/caddy-stable.list
apt update && apt install -y caddy
```

`/etc/caddy/Caddyfile`:

```
erapor.sekolah.sch.id {
	encode zstd gzip
	reverse_proxy 127.0.0.1:3000
	request_body {
		max_size 10MB
	}
}
```

```sh
systemctl reload caddy
```

Caddy menerbitkan sertifikat Let's Encrypt otomatis begitu DNS mengarah ke VPS.
Tanpa domain: ganti baris pertama dengan `:80` (HTTP saja, tanpa SSL).

---

## 5. DNS

A record: `erapor.sekolah.sch.id` → `IP_VPS`. Setelah propagasi, buka
`https://erapor.sekolah.sch.id`, login `Admin / Admin123`, ganti password.

---

## 6. Backup otomatis (cron)

`data/` memuat semuanya: DB SQLite (WAL), uploads (foto murid), `ttd/`
(paraf harian guru), `arsip/` (KK/akta/ijazah), sounds.

```sh
crontab -e   # sebagai user erapor
```

```
# harian 23:00, simpan 14 hari
0 23 * * * tar -czf /home/erapor/backup/erapor-$(date +\%F).tar.gz -C /home/erapor/erapor data && find /home/erapor/backup -name 'erapor-*.tar.gz' -mtime +14 -delete
```

> Backup `data/` saat jam sepi (23:00) cukup aman untuk WAL SQLite. Kalau mau
> 100% konsisten, jalankan `.backup` sqlite3 dulu sebelum tar.
> Copy juga hasil backup ke luar VPS (R2/S3/Google Drive) — snapshot VPS saja
> tidak menyelamatkan data kalau akun provider bermasalah.

---

## 7. Hardening ringkas

- SSH: pakai key, `PasswordAuthentication no` di `/etc/ssh/sshd_config`
- `apt install -y fail2ban`
- App jalan sebagai user `erapor`, bukan root (pm2 di atas sudah begitu)
- Cron bulanan: `apt update && apt upgrade -y`

---

## 8. Update aplikasi

```sh
cd ~/erapor
git pull
pnpm install
pnpm build
pm2 restart erapor
```

`.env` dan `data/` tidak tersentuh. Fitur auto-update bawaan app
(`src/lib/server/update-auto.ts`) mengunduh installer Windows — tidak relevan di
VPS; update manual lewat langkah di atas.

---

## 9. Troubleshooting

| Gejala                                            | Cek                                                                      |
| ------------------------------------------------- | ------------------------------------------------------------------------ |
| 502 / halaman blank                               | `pm2 logs erapor`; `pm2 restart erapor`                                  |
| PDF gagal: "Chromium/Chrome/Edge tidak ditemukan" | `PUPPETEER_EXECUTABLE_PATH` di `.env`, lalu `pm2 restart erapor`         |
| Upload 4MB gagal (413)                            | `BODY_SIZE_LIMIT` di `.env` **dan** `request_body max_size` di Caddyfile |
| Bel tidak bunyi / bunyi dobel                     | pastikan 1 instance pm2 (bukan cluster)                                  |
| Build OOM / ter-kill                              | pastikan swap aktif (`free -h`)                                          |
| DB error saat start                               | `DB_URL` salah path — lihat `[db] creating libsql client` di `pm2 logs`  |

---

_Referensi internal: `AGENTS.md` (env vars), `src/lib/server/data-dirs.ts` (dataRoot
→ `<cwd>/data` di Linux), `src/lib/server/pdf/pagedpdf.ts` (findChromeExecutable),
`scripts/start-build.mjs` (entri point), `src/hooks.server.ts` (BODY_SIZE_LIMIT)._
