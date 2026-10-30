import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

/**
 * Baca file env di cwd. `.env.default` dipakai sebagai pelengkap: nilainya hanya
 * mengisi kunci yang belum ada, jadi `.env` milik pengguna tetap menang.
 * Installer selalu memperbarui `.env.default` supaya kredensial yang ditanam
 * saat packaging tetap sampai ke mesin yang sudah pernah terinstall.
 */

/**
 * Installer menulis DB_URL dengan placeholder Windows (`file:%LOCALAPPDATA%/...`)
 * supaya satu .env berlaku untuk semua pengguna. Saat dijalankan lewat peluncur,
 * env tersebut sudah diganti peluncur; saat skrip ini dijalankan langsung,
 * placeholder mentah membuat @libsql/client gagal (URL_INVALID). Jadi perluas
 * di sini juga.
 */
function expandEnvPlaceholders(value) {
	return value
		.replace(/%([A-Za-z_][A-Za-z0-9_]*)%/g, (_, name) => process.env[name] ?? '')
		.replace(/\$\{([A-Za-z_][A-Za-z0-9_]*)\}/g, (_, name) => process.env[name] ?? '');
}

function loadDotEnv(fileName = '.env') {
	try {
		const envPath = path.resolve(process.cwd(), fileName);
		if (!fs.existsSync(envPath)) return;
		const raw = fs.readFileSync(envPath, 'utf8');
		for (const line of raw.split(/\r?\n/)) {
			const trimmed = line.trim();
			if (!trimmed || trimmed.startsWith('#')) continue;
			const m = trimmed.match(/^([A-Za-z0-9_]+)\s*=\s*(.*)$/);
			if (!m) continue;
			const key = m[1];
			let val = m[2] ?? '';
			if (
				(val.startsWith('"') && val.endsWith('"')) ||
				(val.startsWith("'") && val.endsWith("'"))
			) {
				val = val.slice(1, -1);
			}
			if (process.env[key] === undefined) process.env[key] = expandEnvPlaceholders(val);
		}
	} catch (e) {
		console.warn(`[start-build] failed to read ${fileName} file`, e);
	}
}

/**
 * Kunci yang terdefinisi di sebuah berkas env, dibaca tanpa memengaruhi
 * `process.env` — dipakai untuk memutuskan pasangan URL + token mana yang sah.
 */
function envFileKeys(fileName) {
	const keys = new Set();
	try {
		const envPath = path.resolve(process.cwd(), fileName);
		if (!fs.existsSync(envPath)) return keys;
		for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
			const m = line.trim().match(/^([A-Za-z0-9_]+)\s*=/);
			if (m) keys.add(m[1]);
		}
	} catch {
		// berkas tidak terbaca: anggap tidak punya kunci
	}
	return keys;
}

loadDotEnv();

// `CLOUDFLARE_API_URL` + `CLOUDFLARE_API_TOKEN` adalah satu paket: URL menandakan
// mode proxy worker, dan yang diperiksa worker adalah kunci statis — bukan token
// Cloudflare lama. `.env` peninggalan (era token Cloudflare langsung) sering hanya
// punya token tanpa URL; begitu installer menambahkan URL lewat `.env.default`,
// token lama itu tetap menang karena loadDotEnv hanya mengisi kunci yang kosong,
// lalu worker menolak dengan 401 "API key ditolak". Token yatap seperti itu
// diabaikan supaya kunci statis dari `.env.default` yang dipakai.
const envKeys = envFileKeys('.env');
const defaultKeys = envFileKeys('.env.default');
if (
	!envKeys.has('CLOUDFLARE_API_URL') &&
	envKeys.has('CLOUDFLARE_API_TOKEN') &&
	defaultKeys.has('CLOUDFLARE_API_URL')
) {
	delete process.env.CLOUDFLARE_API_TOKEN;
	console.warn(
		'[start-build] CLOUDFLARE_API_TOKEN lama di .env diabaikan (tidak ada CLOUDFLARE_API_URL); memakai kunci dari .env.default'
	);
}

loadDotEnv('.env.default');

// Helpful debug: show the BODY_SIZE_LIMIT that will be used by the built server
try {
	console.info('[start-build] BODY_SIZE_LIMIT=', process.env.BODY_SIZE_LIMIT);
} catch (e) {
	console.debug('[start-build] failed to read BODY_SIZE_LIMIT from env', e);
}

// Resolve the built server entry (`build/index.js`) from a few likely locations
// so this script works both in-repo (scripts/) and when installed to a
// top-level `e-Rapor SMK Pratama Mulya` folder (where `start-build.mjs` may live alongside `build/`).
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const candidates = [
	path.join(__dirname, 'build', 'index.js'),
	path.join(__dirname, '..', 'build', 'index.js'),
	path.join(process.cwd(), 'build', 'index.js')
];

(async () => {
	for (const cand of candidates) {
		try {
			if (fs.existsSync(cand)) {
				const url = pathToFileURL(cand).href;
				await import(url);
				return;
			}
		} catch (err) {
			console.warn('[start-build] failed to load candidate:', cand, err && (err.message || err));
		}
	}

	// Fallback to the original relative import to preserve previous behavior and error message
	import('../build/index.js').catch((err) => {
		console.error('[start-build] failed to start built server', err);

		// Detect @libsql native addon failure and suggest VC++ Redistributable
		const msg = (err && (err.message || String(err))) || '';
		if (
			msg.includes('@libsql') &&
			(msg.includes('index.node') || msg.includes('ERR_DLOPEN_FAILED'))
		) {
			console.error('');
			console.error('=====================================================================');
			console.error('KESALAHAN: Native addon @libsql/win32-x64-msvc gagal dimuat.');
			console.error('');
			console.error('Kemungkinan penyebab: Microsoft Visual C++ Redistributable');
			console.error('2015-2022 (x64) belum terinstall di komputer ini.');
			console.error('');
			console.error('Solusi: Jalankan ulang installer e-Rapor SMK Pratama Mulya, atau unduh dan');
			console.error('install langsung dari Microsoft:');
			console.error('  https://aka.ms/vs/17/release/vc_redist.x64.exe');
			console.error('=====================================================================');
		}

		process.exit(1);
	});
})();
