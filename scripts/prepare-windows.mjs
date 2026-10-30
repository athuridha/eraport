#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '..');

function run(cmd, args = [], opts = {}) {
	console.info(`\n> ${[cmd, ...args].join(' ')}`);
	const isWin = process.platform === 'win32';
	const noExt = !path.extname(cmd);
	const useShell = opts.shell ?? (isWin && noExt);
	const res = spawnSync(cmd, args, { stdio: 'inherit', shell: useShell, ...opts });
	if (res.error) {
		console.error('Failed to run:', res.error);
		throw res.error;
	}
	if (res.status !== 0) throw new Error(`Command failed: ${cmd} ${args.join(' ')}`);
}

function hasCommand(cmd) {
	try {
		const isWin = process.platform === 'win32';
		const r = spawnSync(cmd, ['--version'], { stdio: 'ignore', shell: isWin });
		return !r.error && r.status === 0;
	} catch {
		return false;
	}
}

/**
 * Baca `.env` proyek tanpa dependensi tambahan, supaya kredensial cloud tidak
 * perlu ikut ter-commit dan tidak perlu diketik ulang setiap kali packaging.
 */
function readProjectEnv() {
	const values = {};
	const envPath = path.join(projectRoot, '.env');
	if (!fs.existsSync(envPath)) return values;
	try {
		for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
			const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
			if (!m) continue;
			values[m[1]] = m[2].replace(/^["']|["']$/g, '');
		}
	} catch (e) {
		console.warn('Gagal membaca .env:', e);
	}
	return values;
}

/**
 * Verifikasi kredensial proxy worker sebelum dipaket: kirim SELECT 1 dan lihat
 * apakah diterima. Gagal jaringan hanya jadi peringatan.
 */
async function verifyProxyApi(url, apiKey) {
	try {
		const res = await fetch(url, {
			method: 'POST',
			headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
			body: JSON.stringify({ sql: 'SELECT 1 AS ok', params: [] })
		});
		const data = await res.json().catch(() => null);
		if (res.ok && data?.success) {
			console.info('API proxy Database Pusat merespons kueri uji dengan baik.');
		} else {
			console.warn(
				'API proxy Database Pusat menolak kueri uji:',
				data?.errors?.[0]?.message ?? `HTTP ${res.status}`,
				'- sinkronisasi cloud pada hasil build ini akan gagal.'
			);
		}
	} catch (e) {
		console.warn('API proxy tidak bisa diverifikasi (jaringan):', e.message);
	}
}

/**
 * Verifikasi token sebelum dipaket, supaya installer tidak terkirim dengan
 * kredensial yang sudah mati. Gagal jaringan hanya jadi peringatan.
 */
async function verifyCloudToken(token) {
	try {
		const res = await fetch('https://api.cloudflare.com/client/v4/user/tokens/verify', {
			headers: { Authorization: `Bearer ${token}` }
		});
		const data = await res.json().catch(() => null);
		if (res.ok && data?.success) {
			console.info('CLOUDFLARE_API_TOKEN valid, status:', data.result?.status ?? 'active');
		} else {
			console.warn(
				'CLOUDFLARE_API_TOKEN ditolak Cloudflare:',
				data?.errors?.[0]?.message ?? `HTTP ${res.status}`,
				'- sinkronisasi cloud pada hasil build ini akan gagal.'
			);
		}
	} catch (e) {
		console.warn('Token cloud tidak bisa diverifikasi (jaringan):', e.message);
	}
}

async function main() {
	const args = process.argv.slice(2);
	const skipBuild = args.includes('--skip-build');
	const outputDir = 'dist/windows';

	const absOutput = path.resolve(projectRoot, outputDir);
	const stageRoot = path.join(absOutput, 'stage');
	const appStage = path.join(stageRoot, 'erapor-pmk');

	const hasPnpm = hasCommand('pnpm');

	// 0) Sync installer version with package.json so Inno Setup AppVersion matches the app.
	//    Inno Setup requires a numeric version, so any semver prerelease suffix is stripped.
	const pkgJson = JSON.parse(fs.readFileSync(path.join(projectRoot, 'package.json'), 'utf-8'));
	const appVersion = typeof pkgJson.version === 'string' ? pkgJson.version.trim() : '';
	const installerVersion = appVersion.replace(/-[0-9A-Za-z.-]+$/, '');
	if (appVersion) {
		const issPath = path.join(projectRoot, 'installer', 'erapor-pmk.iss');
		const issContent = fs.readFileSync(issPath, 'utf-8');
		if (/#define\s+AppVersion\s+"[^"]*"/.test(issContent)) {
			const updated = issContent.replace(
				/#define\s+AppVersion\s+"[^"]*"/,
				`#define AppVersion "${installerVersion}"`
			);
			if (updated !== issContent) {
				fs.writeFileSync(issPath, updated, 'utf-8');
				console.info(`Synced installer AppVersion to ${installerVersion} in ${issPath}`);
			} else {
				console.info(`Installer AppVersion already matches ${installerVersion}`);
			}
		} else {
			console.warn(
				`Skipping installer version sync: no "#define AppVersion" line found in ${issPath}`
			);
		}
	}

	// 1) Build
	if (!skipBuild) {
		if (hasPnpm) {
			run('pnpm', ['build'], { cwd: projectRoot });
		} else {
			if (!hasCommand('npm')) throw new Error('Neither pnpm nor npm found on PATH');
			run('npm', ['install'], { cwd: projectRoot });
			run('npm', ['run', 'build'], { cwd: projectRoot });
		}
	} else {
		console.info('Skipping build step as requested.');
	}

	// 2) Clean & create staging
	if (fs.existsSync(stageRoot)) {
		fs.rmSync(stageRoot, { recursive: true, force: true });
	}
	fs.mkdirSync(appStage, { recursive: true });

	// 3) Copy build artifacts
	console.info('Copying build artifacts...');
	const buildDir = path.join(projectRoot, 'build');
	if (fs.existsSync(buildDir)) {
		fs.cpSync(buildDir, path.join(appStage, 'build'), { recursive: true, force: true });
	} else {
		console.warn('build/ not found; skipping.');
	}

	// 4) Copy static assets
	console.info('Copying static assets...');
	const staticDir = path.join(projectRoot, 'static');
	if (fs.existsSync(staticDir)) {
		fs.cpSync(staticDir, path.join(appStage, 'static'), { recursive: true, force: true });
	}

	// 5) Copy icon
	const icoPath = path.join(projectRoot, 'static', 'logo.ico');
	if (fs.existsSync(icoPath)) {
		fs.copyFileSync(icoPath, path.join(appStage, 'erapor-pmk.ico'));
	} else {
		console.warn('File static/logo.ico tidak ditemukan; ikon installer tidak akan diperbarui.');
	}

	// 6) DB migration
	console.info('Running database migration (db:push)...');
	if (hasPnpm) {
		run('pnpm', ['db:push'], { cwd: projectRoot });
	} else {
		if (!hasCommand('npm')) {
			console.warn('npm not found; skipping db:push.');
		} else {
			run('npm', ['install'], { cwd: projectRoot });
			run('npm', ['run', 'db:push'], { cwd: projectRoot });
		}
	}

	// 7) Basis data TIDAK dibundel. Instalasi mulai dengan DB kosong: skema dibuat
	// migrate-installed-db.mjs saat instalasi, akun Admin oleh ensureDefaultAdmin()
	// saat start pertama, lalu data diambil dari Database Pusat lewat halaman
	// Sinkronisasi (?/tarikPusat) memakai kredensial cloud di .env.
	// (Sebelumnya data/database.sqlite3 ikut dibundel; kredensial lokal/akun uji
	// jangan sampai ikut ke mesin penerima.)
	console.info('Skipping database bundling (data comes from cloud pull).');

	// 8) Generate runtime package.json
	console.info('Generating runtime package manifest...');
	const runtimePkg = {
		name: pkgJson.name,
		version: pkgJson.version,
		private: true,
		type: 'module',
		scripts: { start: 'node build/index.js' },
		dependencies: pkgJson.dependencies
	};
	fs.writeFileSync(path.join(appStage, 'package.json'), JSON.stringify(runtimePkg, null, 2));

	// 9) Copy helper scripts
	console.info('Copying runtime helper scripts...');
	const installerDir = path.join(projectRoot, 'installer');

	const startMjs = path.join(installerDir, 'files', 'start-erapor-pmk.mjs');
	if (fs.existsSync(startMjs))
		fs.copyFileSync(startMjs, path.join(appStage, 'start-erapor-pmk.mjs'));

	const startBuildSrc = path.join(projectRoot, 'scripts', 'start-build.mjs');
	if (fs.existsSync(startBuildSrc))
		fs.copyFileSync(startBuildSrc, path.join(appStage, 'start-build.mjs'));

	const batSrc = path.join(installerDir, 'run-migrations.bat');
	if (fs.existsSync(batSrc)) fs.copyFileSync(batSrc, path.join(appStage, 'run-migrations.bat'));

	// migrate-installed-db.mjs
	const migrateSrc = path.join(projectRoot, 'scripts', 'migrate-installed-db.mjs');
	if (fs.existsSync(migrateSrc)) {
		const sDir = path.join(appStage, 'scripts');
		fs.mkdirSync(sDir, { recursive: true });
		fs.copyFileSync(migrateSrc, path.join(sDir, 'migrate-installed-db.mjs'));
	}

	// Required scripts
	const requiredScripts = [
		'auto-update.mjs',
		'ensure-columns.mjs',
		'fix-drizzle-indexes.mjs',
		'seed-default-admin.mjs',
		'grant-admin-permissions.mjs',
		'notify-server-reload.mjs',
		'start-build.mjs',
		'playmp3.exe'
	];
	for (const s of requiredScripts) {
		const src = path.join(projectRoot, 'scripts', s);
		if (fs.existsSync(src)) {
			const sDir = path.join(appStage, 'scripts');
			if (!fs.existsSync(sDir)) fs.mkdirSync(sDir, { recursive: true });
			fs.copyFileSync(src, path.join(sDir, s));
		} else {
			console.warn(`Required script ${s} not found; migrator on target may fail.`);
		}
	}

	// 10) Drizzle config, migrations, schema
	console.info('Copying drizzle configuration...');
	const drizzleConfig = path.join(projectRoot, 'drizzle.config.js');
	if (fs.existsSync(drizzleConfig))
		fs.copyFileSync(drizzleConfig, path.join(appStage, 'drizzle.config.js'));

	const drizzleDir = path.join(projectRoot, 'drizzle');
	if (fs.existsSync(drizzleDir))
		fs.cpSync(drizzleDir, path.join(appStage, 'drizzle'), { recursive: true, force: true });

	const schemaSrc = path.join(projectRoot, 'src', 'lib', 'server', 'db', 'schema.ts');
	if (fs.existsSync(schemaSrc)) {
		const schemaDestDir = path.join(appStage, 'src', 'lib', 'server', 'db');
		fs.mkdirSync(schemaDestDir, { recursive: true });
		fs.copyFileSync(schemaSrc, path.join(schemaDestDir, 'schema.ts'));
	}

	// 11) .env.example and .env
	const envExample = path.join(projectRoot, '.env.example');
	if (fs.existsSync(envExample)) fs.copyFileSync(envExample, path.join(appStage, '.env.example'));

	// Token Cloudflare ditanam ke installer supaya sekolah tidak perlu mengisi
	// kredensial cloud sendiri (nilai di DB tetap menang, jadi rotasi bisa lewat
	// halaman /sinkronisasi). Set ERAPOR_PACKAGE_CLOUD_TOKEN=0 untuk build tanpa
	// token (mis. uji coba lokal).
	const projectEnv = readProjectEnv();
	const envValue = (key) => (process.env[key] ?? projectEnv[key] ?? '').trim();
	const flagToken = (process.env.ERAPOR_PACKAGE_CLOUD_TOKEN ?? '').trim().toLowerCase();
	const bolehTanamToken = !['0', 'false', 'n', 'tidak', 'off', 'no'].includes(flagToken);
	const cloudToken = bolehTanamToken ? envValue('CLOUDFLARE_API_TOKEN') : '';
	const cloudApiUrl = bolehTanamToken ? envValue('CLOUDFLARE_API_URL') : '';
	const cloudAccountId = envValue('CLOUDFLARE_ACCOUNT_ID');
	const cloudDatabaseId = envValue('CLOUDFLARE_DATABASE_ID');
	const modeProxy = Boolean(cloudApiUrl);

	const envLines = [
		'DB_URL=file:%LOCALAPPDATA%/erapor-pmk-data/database.sqlite3',
		'BODY_SIZE_LIMIT=5M'
	];
	if (cloudToken) {
		if (modeProxy && cloudApiUrl) {
			envLines.push(`CLOUDFLARE_API_URL=${cloudApiUrl}`);
			envLines.push(`CLOUDFLARE_API_TOKEN=${cloudToken}`);
		} else {
			envLines.push(`CLOUDFLARE_API_TOKEN=${cloudToken}`);
			if (cloudAccountId) envLines.push(`CLOUDFLARE_ACCOUNT_ID=${cloudAccountId}`);
			if (cloudDatabaseId) envLines.push(`CLOUDFLARE_DATABASE_ID=${cloudDatabaseId}`);
		}
	}

	const envTarget = path.join(appStage, '.env');
	fs.writeFileSync(envTarget, envLines.join('\n') + '\n');
	console.info(
		'Wrote installer .env to',
		envTarget,
		cloudToken ? '(dengan kredensial cloud)' : '(tanpa kredensial cloud)'
	);

	if (cloudToken && modeProxy) {
		await verifyProxyApi(cloudApiUrl, cloudToken);
	} else if (cloudToken) {
		await verifyCloudToken(cloudToken);
	} else {
		console.warn(
			'CLOUDFLARE_API_TOKEN tidak ditanam di installer. Isi token lewat halaman /sinkronisasi.'
		);
	}

	// 12) Install production dependencies (targeting Windows platform so native
	//     bindings like @libsql/win32-x64-msvc are bundled instead of Linux ones)
	console.info('Installing production dependencies with npm (omit dev, platform=win32)...');
	const nodeModules = path.join(appStage, 'node_modules');
	if (fs.existsSync(nodeModules)) fs.rmSync(nodeModules, { recursive: true, force: true });
	const pkgLock = path.join(appStage, 'package-lock.json');
	if (fs.existsSync(pkgLock)) fs.unlinkSync(pkgLock);
	const winEnv = {
		...process.env,
		npm_config_platform: 'win32',
		npm_config_arch: 'x64',
		PUPPETEER_SKIP_DOWNLOAD: 'true',
		PUPPETEER_SKIP_BROWSER_DOWNLOAD: 'true'
	};
	run('npm', ['install', '--omit=dev', '--no-package-lock'], {
		cwd: appStage,
		env: winEnv
	});

	// 13) Install drizzle-kit
	console.info('Installing drizzle-kit into staged app...');
	try {
		run('npm', ['install', '--no-package-lock', '--no-save', 'drizzle-kit'], {
			cwd: appStage,
			env: winEnv
		});
	} catch {
		console.warn(
			'Failed to install drizzle-kit into staged app; migrations on target may not be possible.'
		);
	}

	// 14) Explicitly install Windows native binding for libsql.
	//     Doing this after all npm operations because npm may prune the package
	//     when it doesn't match the current Linux platform.
	console.info('Installing Windows native binding @libsql/win32-x64-msvc...');
	// NOTE: deliberately omit winEnv here — passing npm_config_platform=win32 makes
	// npm think the package is "up to date" when it really isn't. We use --force to
	// bypass the OS check instead.
	try {
		run('npm', ['install', '--no-save', '--no-package-lock', '--force', '@libsql/win32-x64-msvc'], {
			cwd: appStage
		});
	} catch {
		console.warn('Failed to install @libsql/win32-x64-msvc; server may fail on Windows.');
	}

	// Remove Linux-specific bindings to reduce installer size
	for (const pkg of ['@libsql/linux-x64-gnu', '@libsql/linux-x64-musl']) {
		const p = path.join(appStage, 'node_modules', '@libsql', pkg.replace('@libsql/', ''));
		if (fs.existsSync(p)) {
			fs.rmSync(p, { recursive: true, force: true });
			console.info('Removed', p);
		}
	}

	// 14b) Compile the desktop shell (e-Rapor.exe): a WebView2 host window so the
	//      installed app opens as a real desktop app — single window with the
	//      school logo, no terminal and no browser tab. Compiled with the .NET
	//      Framework C# compiler (csc.exe) that ships with every Windows 10/11;
	//      the official Microsoft.Web.WebView2 interop comes from NuGet. When the
	//      compiler or download is unavailable the installer simply stays
	//      browser-mode (shortcuts open the default browser), never broken.
	console.info('Compiling desktop shell (e-Rapor.exe)...');
	const interopDir = path.resolve(projectRoot, 'dist', 'windows', 'webview2-interop');
	const interopCore = path.join(interopDir, 'Microsoft.Web.WebView2.Core.dll');
	const interopWinForms = path.join(interopDir, 'Microsoft.Web.WebView2.WinForms.dll');
	const interopLoader = path.join(interopDir, 'WebView2Loader.dll');
	const interopNupkg = path.resolve(projectRoot, 'dist', 'windows', 'wv2.nupkg');
	const INTEROP_VERSION = '1.0.2903.40';
	if (
		!fs.existsSync(interopCore) ||
		!fs.existsSync(interopWinForms) ||
		!fs.existsSync(interopLoader)
	) {
		fs.mkdirSync(interopDir, { recursive: true });
		try {
			if (!fs.existsSync(interopNupkg)) {
				run('curl', [
					'-sL',
					'--max-time',
					'300',
					'-o',
					interopNupkg,
					`https://api.nuget.org/v3-flatcontainer/microsoft.web.webview2/${INTEROP_VERSION}/microsoft.web.webview2.${INTEROP_VERSION}.nupkg`
				]);
			}
			// bsdtar (bawaan Windows 10+) bisa mengekstrak anggota tertentu dari zip.
			// lib/net462 → 2 komponen di atas; build/native/x64/… → 3 komponen.
			run('tar', [
				'-xf',
				interopNupkg,
				'-C',
				interopDir,
				'--strip-components=2',
				'--include=lib/net462/*'
			]);
			run('tar', [
				'-xf',
				interopNupkg,
				'-C',
				interopDir,
				'--strip-components=3',
				'--include=build/native/x64/WebView2Loader.dll'
			]);
		} catch (err) {
			console.warn('Gagal menyiapkan interop WebView2:', err && (err.message || err));
		}
	}
	const cscPath = [
		'C:\\Windows\\Microsoft.NET\\Framework64\\v4.0.30319\\csc.exe',
		'C:\\Windows\\Microsoft.NET\\Framework\\v4.0.30319\\csc.exe'
	].find((p) => fs.existsSync(p));
	if (!cscPath) console.warn('csc.exe (.NET Framework) tidak ditemukan; shell desktop dilewati.');
	if (cscPath && fs.existsSync(interopCore) && fs.existsSync(interopWinForms)) {
		const shellSource = path.join(projectRoot, 'installer', 'files', 'erapor-shell.cs');
		const shellOut = path.resolve(projectRoot, 'dist', 'windows', 'erapor-shell.exe');
		try {
			run(cscPath, [
				'/nologo',
				'/target:winexe',
				'/platform:x64',
				'/langversion:5',
				'/warn:0',
				'/win32icon:' + path.join(projectRoot, 'static', 'logo.ico'),
				'/out:' + shellOut,
				'/r:System.Drawing.dll',
				'/r:System.Windows.Forms.dll',
				'/r:' + interopCore,
				'/r:' + interopWinForms,
				shellSource
			]);
			fs.copyFileSync(shellOut, path.join(appStage, 'e-Rapor.exe'));
			// Assembly interop managed (Core/WinForms) harus ada di samping exe:
			// .NET Framework tidak memuatnya dari folder lain, dan bila hilang
			// JIT method OnShownAsync melempar FileNotFoundException sebelum shell
			// sempat menyalakan server (gejala: jendela kosong + dialog error).
			fs.copyFileSync(interopCore, path.join(appStage, 'Microsoft.Web.WebView2.Core.dll'));
			fs.copyFileSync(interopWinForms, path.join(appStage, 'Microsoft.Web.WebView2.WinForms.dll'));
			// Loader native dibutuhkan oleh interop saat runtime (disematkan sebagai
			// resource di dalam e-Rapor.exe, tapi tetap disertakan di samping exe).
			if (fs.existsSync(interopLoader)) {
				fs.copyFileSync(interopLoader, path.join(appStage, 'WebView2Loader.dll'));
			}
			console.info('Desktop shell dikompilasi →', path.join(appStage, 'e-Rapor.exe'));
		} catch (err) {
			console.warn(
				'Gagal mengompilasi shell desktop (installer tetap browser-mode):',
				err && (err.message || err)
			);
		}
	}

	// 14c) Unduh bootstrapper WebView2 Runtime (dipasang installer hanya bila
	//      mesin target belum punya runtime Edge WebView2). Unt mesin tanpa
	//      runtime, shell otomatis jatuh ke mode browser.
	const wv2Bootstrapper = path.resolve(
		projectRoot,
		'dist',
		'windows',
		'MicrosoftEdgeWebview2Setup.exe'
	);
	if (!fs.existsSync(wv2Bootstrapper)) {
		console.info('Downloading WebView2 Runtime bootstrapper...');
		try {
			run('curl', [
				'-sL',
				'--max-time',
				'300',
				'-o',
				wv2Bootstrapper,
				'https://go.microsoft.com/fwlink/?linkid=2124703'
			]);
		} catch (err) {
			console.warn('Gagal mengunduh bootstrapper WebView2:', err && (err.message || err));
		}
	}

	// 15) Download VC++ 2015-2022 Redistributable (x64) for InnoSetup to bundle
	//     This is required by @libsql/win32-x64-msvc native addon on Windows.
	console.info('Downloading VC++ 2015-2022 Redistributable (x64)...');
	const redistDest = path.resolve(projectRoot, 'dist', 'windows', 'vc_redist.x64.exe');
	if (fs.existsSync(redistDest)) {
		console.info('VC++ redistributable already exists at', redistDest);
	} else {
		const redistUrl = 'https://aka.ms/vs/17/release/vc_redist.x64.exe';
		if (hasCommand('curl')) {
			run('curl', ['-#Lo', redistDest, redistUrl]);
		} else if (hasCommand('wget')) {
			run('wget', ['-O', redistDest, redistUrl]);
		} else {
			console.error(
				'Neither curl nor wget is available; cannot download VC++ redistributable.\n' +
					'Download manually from ' +
					redistUrl +
					' to ' +
					redistDest
			);
			throw new Error('Missing curl/wget for VC++ redist download');
		}
		const stat = fs.statSync(redistDest);
		console.info('Downloaded VC++ redistributable:', (stat.size / 1024 / 1024).toFixed(1), 'MB');
	}

	// 16) Bundle standalone Node.js runtime so target machines never need Node installed
	console.info('Bundling Node.js runtime for full-offline installer...');
	const runtimeNodeDir = path.join(appStage, 'runtime', 'node');
	fs.mkdirSync(runtimeNodeDir, { recursive: true });
	const targetNodeExe = path.join(runtimeNodeDir, 'node.exe');

	const cachedNodeExe = path.resolve(projectRoot, 'dist', 'windows', 'node.exe');
	if (fs.existsSync(cachedNodeExe)) {
		console.info('Using cached Node.js binary from', cachedNodeExe);
		fs.copyFileSync(cachedNodeExe, targetNodeExe);
	} else if (process.platform === 'win32' && fs.existsSync(process.execPath)) {
		console.info('Copying host Node.js binary from', process.execPath);
		fs.copyFileSync(process.execPath, targetNodeExe);
		try {
			fs.copyFileSync(process.execPath, cachedNodeExe);
		} catch {
			/* ignore cache write error */
		}
	} else {
		console.info('Downloading official Node.js win-x64 binary...');
		const nodeUrl = 'https://nodejs.org/dist/v22.14.0/win-x64/node.exe';
		if (hasCommand('curl')) {
			run('curl', ['-#Lo', targetNodeExe, nodeUrl]);
		} else if (hasCommand('wget')) {
			run('wget', ['-O', targetNodeExe, nodeUrl]);
		} else {
			throw new Error('Neither curl nor wget available to download Node.js runtime.');
		}
		try {
			fs.copyFileSync(targetNodeExe, cachedNodeExe);
		} catch {
			/* ignore cache write error */
		}
	}
	const nodeStat = fs.statSync(targetNodeExe);
	console.info('Bundled Node.js binary size:', (nodeStat.size / 1024 / 1024).toFixed(1), 'MB');

	console.info('\nStaging complete. Contents available at', appStage);
}

main().catch((err) => {
	console.error(err);
	process.exit(1);
});
