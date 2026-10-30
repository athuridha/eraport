import { createHash } from 'node:crypto';
import { eq, gt, isNull, getTableColumns, or, sql } from 'drizzle-orm';
import type { AnySQLiteColumn, SQLiteTable } from 'drizzle-orm/sqlite-core';
import db from '$lib/server/db';
import {
	tableAbsensi,
	tableAlamat,
	tableAsesmenEkstrakurikuler,
	tableAsesmenFormatif,
	tableAsesmenKokurikuler,
	tableAsesmenSumatif,
	tableAsesmenSumatifTujuan,
	tableAuthUser,
	tableAuthUserKelas,
	tableAuthUserMataPelajaran,
	tableCatatanWaliKelas,
	tableCloudSyncLogs,
	tableCloudSyncSettings,
	tableEkstrakurikuler,
	tableEkstrakurikulerTujuan,
	tableJadwalPelajaran,
	tableJurnalMengajar,
	tableKehadiranMurid,
	tableKeputusanMurid,
	tableKelas,
	tableKetidakhadiranHarian,
	tableKetidakhadiranRapor,
	tableKokurikuler,
	tableMataPelajaran,
	tableMurid,
	tableMuridEkstrakurikuler,
	tableMuridMataPelajaran,
	tablePegawai,
	tablePresensiGuru,
	tablePresensiSettings,
	tableSekolah,
	tableSemester,
	tableTahunAjaran,
	tableTujuanPembelajaran,
	tableWaliMurid
} from '$lib/server/db/schema';
import { executeD1Query, getD1Config, type D1Config } from '$lib/server/cloudflare-d1';

/** Mode proxy cukup dengan token+URL worker; mode direct butuh accountId juga. */
function d1CredentialsReady(config: D1Config | null): boolean {
	if (!config) return false;
	return Boolean(config.apiToken && (config.apiUrl || config.accountId));
}
import {
	mergeAkademikData,
	mergeMasterData,
	mergeMasterTables,
	type MergeSummary
} from '$lib/server/cloud-master-merge';
import { defaultAdminUsernameNormalized, ensureDefaultAdmin } from '$lib/server/auth';

/**
 * Sinkronisasi master data (data induk) antara instalasi lokal dan Database Pusat.
 *
 * Berbeda dari `cloudflare-d1.ts` yang mengirim nilai/administrasi guru, modul ini
 * mengurus data yang dibutuhkan supaya aplikasi di komputer baru bisa dipakai:
 * identitas sekolah, pegawai, siswa, kelas, mapel, sampai akun pengguna.
 *
 * Akun disalin apa adanya sebagai `password_hash` + `password_salt` (skema scrypt
 * di `src/lib/server/auth.ts`) â€” kata sandi polos tidak pernah ikut dikirim.
 *
 * Urutan tabel mengikuti dependensi: alamat dan wali murid lebih dulu karena
 * `sekolah.alamat_id` dan `murid.alamat_id` mengarah ke sana.
 */
export const MASTER_TABLES: readonly [string, SQLiteTable][] = [
	['alamat', tableAlamat],
	['wali_murid', tableWaliMurid],
	['pegawai', tablePegawai],
	['sekolah', tableSekolah],
	['tahun_ajaran', tableTahunAjaran],
	['semester', tableSemester],
	['kelas', tableKelas],
	['mata_pelajaran', tableMataPelajaran],
	['murid', tableMurid],
	['auth_user', tableAuthUser],
	['auth_user_mata_pelajaran', tableAuthUserMataPelajaran],
	['auth_user_kelas', tableAuthUserKelas],
	['murid_mata_pelajaran', tableMuridMataPelajaran]
];

/** Tabel yang dihitung ulang untuk menampilkan rekap master data lokal. */
const SUMMARY_TABLES: readonly [string, SQLiteTable][] = [
	['sekolah', tableSekolah],
	['pegawai', tablePegawai],
	['kelas', tableKelas],
	['mata_pelajaran', tableMataPelajaran],
	['murid', tableMurid],
	['auth_user', tableAuthUser]
];

const BLOB_MARKER = '__blob';
const INSERT_CHUNK_SIZE = 200;

/** Koneksi biasa atau transaksi â€” keduanya bisa dipakai untuk menghapus/menyisipkan baris. */
type DbExecutor = Parameters<Parameters<typeof db.transaction>[0]>[0];

/**
 * Tabel yang menandakan aplikasi sudah pernah dipakai. Selama semuanya kosong, isi
 * database masih bisa diganti paket master dari pusat tanpa kehilangan pekerjaan guru.
 */
const ACTIVITY_TABLES: readonly SQLiteTable[] = [
	tableAbsensi,
	tableKehadiranMurid,
	tableJadwalPelajaran,
	tableJurnalMengajar,
	tableAsesmenSumatif,
	tableCatatanWaliKelas
];

export interface MasterPayload {
	app: 'erapor-pmk';
	kind: 'master_data';
	schema: 1;
	exported_at: string;
	tables: Record<string, Record<string, unknown>[]>;
}

/** Paket sinkron `all_data`: master penuh + delta akademik (lihat cloud-master-merge). */
export interface AllDataPayload {
	app: 'erapor-pmk';
	kind: 'all_data';
	schema: 1;
	exported_at: string;
	since: string | null;
	tables: Record<string, Record<string, unknown>[]>;
}

export interface MasterCounts {
	[key: string]: number;
}

function toBase64(bytes: Uint8Array) {
	return Buffer.from(bytes).toString('base64');
}

/** BLOB tidak bisa lewat JSON apa adanya; dibungkus penanda agar bisa dipulihkan. */
function serializeValue(value: unknown): unknown {
	if (value instanceof Uint8Array) return { [BLOB_MARKER]: toBase64(value) };
	return value;
}

function deserializeValue(value: unknown): unknown {
	if (value && typeof value === 'object' && BLOB_MARKER in (value as Record<string, unknown>)) {
		const encoded = (value as Record<string, unknown>)[BLOB_MARKER];
		if (typeof encoded === 'string') return new Uint8Array(Buffer.from(encoded, 'base64'));
	}
	return value;
}

function columnKeys(table: SQLiteTable) {
	return new Set(Object.keys(getTableColumns(table)));
}

function normalizeRow(row: Record<string, unknown>, allowed: Set<string>) {
	const out: Record<string, unknown> = {};
	for (const [key, raw] of Object.entries(row)) {
		// Kunci asing (dari versi skema lain) dibuang supaya tidak jadi kolom tak dikenal.
		if (!allowed.has(key)) continue;
		out[key] = deserializeValue(raw);
	}
	return out;
}

export function checksumOf(payload: unknown) {
	return createHash('sha256').update(JSON.stringify(payload)).digest('hex');
}

/** Kumpulkan seluruh baris tabel master untuk dikirim ke pusat. */
export async function exportMasterData(): Promise<MasterPayload> {
	const tables: Record<string, Record<string, unknown>[]> = {};

	// Tanda tangan pegawai (PNG data URL) bisa ratusan KB per orang dan tidak
	// dibutuhkan untuk menyiapkan instalasi baru â€” biarkan ikut lewat backup
	// database, bukan lewat paket master.
	const skippedColumns: Record<string, string[]> = { pegawai: ['tandaTangan'] };

	for (const [name, table] of MASTER_TABLES) {
		const skip = skippedColumns[name] ?? [];
		const rows = (await db.select().from(table)) as unknown as Record<string, unknown>[];
		tables[name] = rows.map((row) => {
			const serialized: Record<string, unknown> = {};
			for (const [key, value] of Object.entries(row)) {
				if (skip.includes(key)) continue;
				serialized[key] = serializeValue(value);
			}
			return serialized;
		});
	}

	return {
		app: 'erapor-pmk',
		kind: 'master_data',
		schema: 1,
		exported_at: new Date().toISOString(),
		tables
	};
}

export function countPayloadRows(payload: MasterPayload | AllDataPayload): MasterCounts {
	const counts: MasterCounts = {};
	for (const [name] of MASTER_TABLES) counts[name] = payload.tables[name]?.length ?? 0;
	return counts;
}

/** Rekap jumlah baris tabel master yang ada di lokal sekarang. */
export async function countLocalMaster(): Promise<MasterCounts> {
	const counts: MasterCounts = {};
	for (const [name, table] of SUMMARY_TABLES) {
		const rows = await db.select({ value: sql<number>`count(*)` }).from(table);
		counts[name] = Number(rows[0]?.value ?? 0);
	}
	return counts;
}

/**
 * Instalasi dianggap masih kosong kalau belum ada siswa, belum ada akun buatan sendiri,
 * dan belum ada aktivitas guru.
 *
 * Catatan: `ensureSmkPratamaMulya` selalu menanam profil sekolah beserta tahun ajaran,
 * semester, dan satu kelas contoh, jadi kondisi "kosong" tidak bisa diukur dari tabel
 * sekolah â€” baris contoh itu memang diganti paket dari pusat.
 */
export async function isLocalMasterEmpty(): Promise<boolean> {
	const counts = await countLocalMaster();
	const accounts = await countNonDefaultAccounts();
	const activity = await countLocalActivity();
	return counts.murid === 0 && accounts === 0 && activity === 0;
}

/** Total baris di tabel aktivitas â€” dipakai hanya sebagai penanda instalasi belum dipakai. */
export async function countLocalActivity(): Promise<number> {
	const results = await Promise.all(
		ACTIVITY_TABLES.map((table) => db.select({ value: sql<number>`count(*)` }).from(table))
	);
	return results.reduce((sum, rows) => sum + Number(rows[0]?.value ?? 0), 0);
}

/**
 * Akun yang dibuat sendiri oleh operator.
 *
 * Dua akun yang muncul otomatis tidak dihitung: akun bawaan `Admin` dan akun
 * `kepala_sekolah` yang dibentuk `ensureKepalaSekolahAccounts` dari pegawai kepala
 * sekolah sekolah tersebut (`pegawai_id` = `sekolah.kepala_sekolah_id`). Keduanya
 * lahir sendiri di instalasi baru, sedangkan akun lain berarti sudah ada pekerjaan
 * yang tidak boleh ditimpa paket master dari pusat.
 */
export async function countNonDefaultAccounts(): Promise<number> {
	const [accounts, sekolahRows] = await Promise.all([
		db
			.select({
				id: tableAuthUser.id,
				usernameNormalized: tableAuthUser.usernameNormalized,
				type: tableAuthUser.type,
				pegawaiId: tableAuthUser.pegawaiId,
				sekolahId: tableAuthUser.sekolahId
			})
			.from(tableAuthUser),
		db
			.select({ id: tableSekolah.id, kepalaSekolahId: tableSekolah.kepalaSekolahId })
			.from(tableSekolah)
	]);

	const autoKepala = new Set(
		sekolahRows.map((row) => `${row.id}:${row.kepalaSekolahId ?? 'null'}`)
	);

	return accounts.filter((row) => {
		if (row.usernameNormalized === defaultAdminUsernameNormalized) return false;
		if (
			row.type === 'kepala_sekolah' &&
			row.pegawaiId !== null &&
			autoKepala.has(`${row.sekolahId ?? 'null'}:${row.pegawaiId}`)
		) {
			return false;
		}
		return true;
	}).length;
}

/**
 * Tulis paket master ke Database Pusat: satu baris `packages` (isi data) plus satu
 * baris `publish_versions` scope `master_data` sebagai penunjuk versi terakhir.
 */
export async function pushMasterDataToCloud(sekolahId: number, userId: number | null) {
	const config = await getD1Config(sekolahId);
	if (!d1CredentialsReady(config)) {
		return {
			success: false,
			message:
				'Kredensial Database Pusat belum siap, jadi master data tidak dikirim ke Database Pusat.'
		};
	}

	const payload = await exportMasterData();
	const counts = countPayloadRows(payload);
	const totalRecords = Object.values(counts).reduce((sum, value) => sum + value, 0);
	const checksum = checksumOf(payload);
	const stamp = new Date().toISOString();
	const packageId = `master-${sekolahId}-${Date.now()}`;

	if (totalRecords === 0) {
		return {
			success: false,
			message: 'Belum ada data induk di komputer ini, jadi tidak ada yang bisa dikirim ke pusat.'
		};
	}

	const packageInsert = await executeD1Query(
		config,
		`INSERT INTO packages (id, school_id, package_type, file_name, version, checksum, payload_json, status, summary_json, created_by, created_at)
		 VALUES (?, ?, 'master_data', 'master.erdata', '1.0', ?, ?, 'PUBLISHED', ?, ?, ?)
		 ON CONFLICT(id) DO UPDATE SET payload_json=excluded.payload_json, checksum=excluded.checksum, summary_json=excluded.summary_json, status='PUBLISHED'`,
		[
			packageId,
			String(sekolahId),
			checksum,
			JSON.stringify(payload),
			JSON.stringify({ counts, total_records: totalRecords }),
			userId ? String(userId) : null,
			stamp
		]
	);

	if (!packageInsert.success) {
		return {
			success: false,
			message: packageInsert.error ?? 'Gagal mengirim master data ke Database Pusat.'
		};
	}

	const versionInsert = await executeD1Query(
		config,
		`INSERT INTO publish_versions (id, school_id, version_code, scope, checksum, metadata_json, total_records, status, published_by, published_at)
		 VALUES (?, ?, ?, 'master_data', ?, ?, ?, 'published', ?, ?)`,
		[
			`pv-master-${Date.now()}`,
			String(sekolahId),
			stamp.replace(/[-:TZ.]/g, '').slice(0, 14),
			checksum,
			JSON.stringify({ package_id: packageId, counts, total_records: totalRecords }),
			totalRecords,
			userId ? String(userId) : null,
			stamp
		]
	);

	if (!versionInsert.success) {
		return {
			success: false,
			message: versionInsert.error ?? 'Paket master tersimpan, tetapi penunjuk versinya gagal.'
		};
	}

	const mirror = await mirrorMasterDataToCloud(sekolahId, userId);
	if (!mirror.success) {
		console.warn('[cloud-master] mirror data pusat gagal:', mirror.message);
	}

	return {
		success: true,
		message: `Master data terkirim ke Database Pusat (${totalRecords} baris).`,
		totalRecords,
		counts,
		checksum
	};
}

/** Endpoint D1 HTTP menolak >100 parameter per statement; chunk per kolom. */
const MIRROR_MAX_PARAMS = 100;

function camelToSnake(name: string): string {
	return name.replace(/([A-Z])/g, '_$1').toLowerCase();
}

/** Nilai lokal (bentuk drizzle/libsql) → parameter yang bisa di-bind worker D1. */
function toD1Param(value: unknown): unknown {
	if (value === null || value === undefined) return null;
	if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'string') {
		return value;
	}
	if (Buffer.isBuffer(value) || value instanceof Uint8Array) {
		return Array.from(new Uint8Array(value));
	}
	return String(value);
}

/**
 * Mirror satu daftar tabel lokal langsung ke tabel DATA di Database Pusat (bukan
 * ke tabel `packages`). ID baris lokal installer sama dengan ID di D1 pusat,
 * jadi baris ditulis apa adanya berdasarkan PK: `ON CONFLICT(id) DO UPDATE`.
 * Kolom yang ditulis = irisan kolom D1 nyata dengan skema lokal (via
 * `PRAGMA table_info`), sehingga beda nama/sisa kolom lama tidak merusak insert.
 *
 * Tabel penghubung tanpa constraint unik selain PK dibersihkan dulu supaya
 * baris yang dihapus lokal ikut hilang di pusat.
 */
async function mirrorTablesToCloud(
	config: D1Config,
	tables: readonly [string, SQLiteTable][]
): Promise<{ mirrored: number; skipped: string[] }> {
	const JOINT_TABLES = new Set(['auth_user_mata_pelajaran', 'auth_user_kelas', 'murid_mata_pelajaran']);
	let mirrored = 0;
	const skipped: string[] = [];

	for (const [name, table] of tables) {
		const camelColumns = Object.keys(getTableColumns(table));
		const localSnake = new Map(camelColumns.map((c) => [camelToSnake(c), c] as const));
		const rows = (await db.select().from(table)) as unknown as Record<string, unknown>[];
		if (rows.length === 0) continue;

		try {
			// Ambil kolom yang BENAR-BENAR ada di D1 pusat; tulis hanya irisan
			// dengan skema lokal agar beda nama/sisa kolom lama tidak merusak insert.
			const info = await executeD1Query(config, `PRAGMA table_info(${name})`);
			if (!info.success) throw new Error(info.error ?? `baca skema ${name} gagal`);
			const infoRows = extractRows(info.result);
			const d1Columns = infoRows
				.map((r) => String(r.name))
				.filter((col) => localSnake.has(col));
			if (d1Columns.length === 0) {
				skipped.push(name);
				continue;
			}

			if (JOINT_TABLES.has(name)) {
				const del = await executeD1Query(config, `DELETE FROM ${name}`);
				if (!del.success) throw new Error(del.error ?? `hapus ${name} gagal`);
			}

			const maxRows = Math.max(1, Math.floor(MIRROR_MAX_PARAMS / d1Columns.length));
			for (let start = 0; start < rows.length; start += maxRows) {
				const chunk = rows.slice(start, start + maxRows);
				const valuesParts: string[] = [];
				const params: unknown[] = [];
				for (const row of chunk) {
					params.push(
						...d1Columns.map((col) => toD1Param(row[localSnake.get(col) as string]))
					);
					valuesParts.push(`(${d1Columns.map(() => '?').join(', ')})`);
				}
				const updates = d1Columns
					.filter((c) => c !== 'id')
					.map((c) => `${c} = excluded.${c}`)
					.join(', ');
				const sql = `INSERT INTO ${name} (${d1Columns.join(', ')}) VALUES ${valuesParts.join(', ')}
				 ON CONFLICT(id) DO UPDATE SET ${updates}`;
				const res = await executeD1Query(config, sql, params);
				if (!res.success) throw new Error(res.error ?? `insert ${name} gagal`);
			}
			mirrored += rows.length;
		} catch (err: unknown) {
			skipped.push(name);
			console.warn(`[cloud-master] mirror tabel ${name} gagal:`, err);
		}
	}

	return { mirrored, skipped };
}

/**
 * Mirror seluruh tabel master lokal ke Database Pusat. Panggil setelah paket
 * master berhasil ditulis ke `packages`.
 */
export async function mirrorMasterDataToCloud(
	sekolahId: number,
	userId: number | null
): Promise<{ success: boolean; message: string; mirrored: number; skipped: string[] }> {
	const config = await getD1Config(sekolahId);
	if (!d1CredentialsReady(config)) {
		return {
			success: false,
			message: 'Kredensial Database Pusat belum siap, data tidak dimirror.',
			mirrored: 0,
			skipped: []
		};
	}

	const { mirrored, skipped } = await mirrorTablesToCloud(config, MASTER_TABLES);
	const message =
		skipped.length === 0
			? `Data dimirror ke Database Pusat (${mirrored} baris).`
			: `Mirror sebagian: ${mirrored} baris, tabel gagal: ${skipped.join(', ')}.`;
	return { success: skipped.length === 0, message, mirrored, skipped };
}

/** Sisipkan baris ke tabel lokal lewat koneksi/transaksi yang diberikan. */
async function insertRows(
	executor: DbExecutor,
	table: SQLiteTable,
	rows: Record<string, unknown>[]
) {
	if (rows.length === 0) return;
	const allowed = columnKeys(table);
	for (let index = 0; index < rows.length; index += INSERT_CHUNK_SIZE) {
		const chunk = rows
			.slice(index, index + INSERT_CHUNK_SIZE)
			.map((row) => normalizeRow(row, allowed));
		// Nilai sudah dipetakan ke nama kolom oleh schema lokal; Drizzle yang menyusun SQL.
		await executor.insert(table).values(chunk as never);
	}
}

/**
 * Impor paket master ke database lokal. Pemanggil wajib memastikan database masih
 * kosong (lihat `isLocalMasterEmpty`) supaya tidak ada baris pengguna yang tertimpa.
 */
export async function importMasterData(payload: MasterPayload) {
	if (payload?.app !== 'erapor-pmk' || payload?.kind !== 'master_data') {
		throw new Error('Paket dari pusat bukan paket master data e-Rapor PMK.');
	}

	// Pemanggil sudah memastikan instalasi masih kosong (`isLocalMasterEmpty`). Baris yang
	// ada sekarang hanyalah profil contoh dari `ensureSmkPratamaMulya` plus akun bawaan
	// Admin, dan baris contoh itu pasti bentrok dengan batas unik data asli (npsn sekolah,
	// nama tahun ajaran). Jadi tabel master dibersihkan dulu, baru diisi paket pusat.
	//
	// Semuanya dalam satu transaksi dengan kunci asing ditunda: relasi sekolah â†” pegawai
	// saling menunjuk, jadi urutan hapus murni "anak dulu" tidak mungkin. Pemeriksaan FK
	// baru dijalankan saat commit, ketika seluruh paket sudah terpasang.
	const imported: MasterCounts = {};
	await db.transaction(async (tx) => {
		await tx.run(sql`PRAGMA defer_foreign_keys = ON`);
		for (const [, table] of MASTER_TABLES) {
			await tx.delete(table);
		}
		for (const [name, table] of MASTER_TABLES) {
			const rows = payload.tables?.[name] ?? [];
			await insertRows(tx, table, rows);
			imported[name] = rows.length;
		}
	});

	// Kalau paket pusat ternyata tidak memuat akun administrator, instalasi ini tidak boleh
	// terkunci tanpa jalan masuk. Akun bawaan dibuat ulang sebagai pintu darurat.
	const admins = await db
		.select({ id: tableAuthUser.id })
		.from(tableAuthUser)
		.where(eq(tableAuthUser.type, 'admin'));
	if (admins.length === 0) {
		await ensureDefaultAdmin();
	}

	const sekolahRows = await db.select({ id: tableSekolah.id }).from(tableSekolah);
	return { imported, sekolahId: sekolahRows[0]?.id ?? null };
}

export interface PullMasterResult {
	success: boolean;
	message: string;
	counts: MasterCounts;
	totalRecords: number;
	/** Ringkasan perubahan saat data master digabung ke instalasi yang sudah terisi. */
	merge?: MergeSummary;
	/** Mode sinkronisasi: ganti total (instalasi baru) atau gabung (data sudah ada). */
	mode?: 'replace' | 'merge';
}

/**
 * Sinkronisasi master dari tombol di /sinkronisasi.
 *
 * Dua mode:
 * - **ganti** (`replace`): instalasi baru â€” tabel master dikosongkan lalu diisi paket pusat.
 * - **gabung** (`merge`): instalasi sudah terisi â€” paket pusat digabung baris per baris
 *   (baris baru disisipkan, baris yang berubah diperbarui, data lokal tidak dihapus).
 *
 * Mode lama selalu berhenti di instalasi yang sudah terisi, padahal operator sering
 * menambah rombel/siswa baru di komputer pusat. Mode gabung menutup kebutuhan itu
 * tanpa risiko menimpa pekerjaan guru (nilai, absensi, jadwal tidak ikut tersentuh).
 */
export async function syncMasterFromCloud(
	sekolahId: number,
	userId: number | null
): Promise<PullMasterResult> {
	const mode: 'replace' | 'merge' = (await isLocalMasterEmpty()) ? 'replace' : 'merge';
	return pullMasterDataFromCloud(sekolahId, userId, mode);
}

/**
 * PULL master: baca penunjuk versi terakhir di `publish_versions`, ambil isinya dari
 * `packages`, lalu tulis ke database lokal.
 *
 * Penunjuk diseleksi per `school_id` bila identitas sekolahnya sudah diketahui
 * (`sekolahId > 0`, mis. PULL dari /sinkronisasi setelah login). Pada halaman /siapkan
 * database lokal masih kosong sehingga belum ada identitas sekolah (`sekolahId = 0`);
 * penunjuk tanpa filter hanya aman di pengeclosean internal satu sekolah.
 */
export async function pullMasterDataFromCloud(
	sekolahId: number,
	userId: number | null,
	mode: 'replace' | 'merge' = 'replace'
): Promise<PullMasterResult> {
	const config = await getD1Config(sekolahId);

	if (!d1CredentialsReady(config)) {
		return {
			success: false,
			message: config?.wranglerTokenExpired
				? 'Sesi wrangler di komputer ini sudah kedaluwarsa, jadi data tidak ditarik dari Database Pusat.'
				: 'Kredensial Database Pusat belum siap, jadi data tidak disinkronkan dari Database Pusat.',
			counts: {},
			totalRecords: 0
		};
	}

	const schoolFilter = sekolahId > 0 ? `AND school_id = ?` : '';
	const pointer = await executeD1Query(
		config,
		`SELECT metadata_json, checksum FROM publish_versions WHERE scope IN ('master_data', 'all_data') ${schoolFilter} ORDER BY published_at DESC LIMIT 1`,
		sekolahId > 0 ? [String(sekolahId)] : []
	);

	if (!pointer.success) {
		return {
			success: false,
			message: pointer.error ?? 'Gagal membaca penunjuk versi master dari Database Pusat.',
			counts: {},
			totalRecords: 0
		};
	}

	const pointerRows = extractRows(pointer.result);
	if (pointerRows.length === 0) {
		return {
			success: false,
			message:
				'Database Pusat belum punya paket master data. Kirim dulu dari komputer sekolah lewat menu Sinkronisasi.',
			counts: {},
			totalRecords: 0
		};
	}

	const metadata = parseJsonObject(pointerRows[0]?.metadata_json);
	const pointerChecksum = toNonEmptyString(pointerRows[0]?.checksum);
	const packageId = typeof metadata?.package_id === 'string' ? metadata.package_id : '';
	if (!packageId) {
		return {
			success: false,
			message: 'Penunjuk versi master di pusat tidak memuat ID paket.',
			counts: {},
			totalRecords: 0
		};
	}

	const packageRes = await executeD1Query(
		config,
		`SELECT payload_json, checksum FROM packages WHERE id = ? LIMIT 1`,
		[packageId]
	);

	if (!packageRes.success) {
		return {
			success: false,
			message: packageRes.error ?? 'Gagal mengambil isi paket master dari Database Pusat.',
			counts: {},
			totalRecords: 0
		};
	}

	const packageRows = extractRows(packageRes.result);
	const rawPayload = packageRows[0]?.payload_json;
	if (typeof rawPayload !== 'string') {
		return {
			success: false,
			message: 'Paket master di pusat tidak ditemukan atau isinya kosong.',
			counts: {},
			totalRecords: 0
		};
	}

	const packageChecksum = toNonEmptyString(packageRows[0]?.checksum);
	if (pointerChecksum && packageChecksum && pointerChecksum !== packageChecksum) {
		return {
			success: false,
			message:
				'Penunjuk versi master tidak cocok dengan paketnya di Database Pusat. Kirim ulang master data dari komputer sekolah.',
			counts: {},
			totalRecords: 0
		};
	}

	const payload = parseJsonObject(rawPayload) as MasterPayload | null;
	if (!payload) {
		return {
			success: false,
			message: 'Isi paket master di pusat tidak bisa dibaca.',
			counts: {},
			totalRecords: 0
		};
	}

	// Integritas paket: isi yang turun di Wajib identik dengan checksum saat dikirim,
	// supaya paket yang rusak / diganti parameternya tidak dipasang ke database lokal.
	if (packageChecksum && checksumOf(payload) !== packageChecksum) {
		return {
			success: false,
			message:
				'Checksum paket master tidak cocok. Isi paket di Database Pusat berubah sejak dikirim; kirim ulang master data dari komputer sekolah.',
			counts: {},
			totalRecords: 0
		};
	}

	let imported: MasterCounts;
	let localSekolahId: number | null;
	let mergeSummary: MergeSummary | undefined;

	if (mode === 'merge') {
		const merged = await mergeMasterData(payload);
		imported = Object.fromEntries(
			Object.entries(merged.summary.perTable).map(([name, value]) => [name, value.inserted])
		);
		mergeSummary = merged.summary;
		localSekolahId = merged.sekolahId;
	} else {
		const replaced = await importMasterData(payload);
		imported = replaced.imported;
		localSekolahId = replaced.sekolahId;
	}

	const totalRecords = Object.values(imported).reduce((sum, value) => sum + value, 0);
	const nowIso = new Date().toISOString();
	const targetSekolahId = localSekolahId ?? sekolahId;

	// Identitas sekolah dari paket disebut ke operator supaya salah sasaran terlihat
	// langsung di layar, terutama pada /siapkan di mana belum ada pemeriksaan school_id.
	const importedSekolah = (payload.tables?.sekolah?.[0] ?? null) as Record<string, unknown> | null;
	const namaSekolah = toNonEmptyString(importedSekolah?.nama);

	await db.insert(tableCloudSyncLogs).values({
		sekolahId: targetSekolahId,
		userId,
		action: 'PULL',
		status: 'SUCCESS',
		totalRecords,
		summary: JSON.stringify({ kind: 'master_data', counts: imported }),
		createdAt: nowIso
	});

	const stored = await db.query.tableCloudSyncSettings.findFirst({
		where: eq(tableCloudSyncSettings.sekolahId, targetSekolahId)
	});
	if (stored) {
		await db
			.update(tableCloudSyncSettings)
			.set({ lastPulledAt: nowIso, updatedAt: nowIso })
			.where(eq(tableCloudSyncSettings.id, stored.id));
	} else {
		await db.insert(tableCloudSyncSettings).values({
			sekolahId: targetSekolahId,
			lastPulledAt: nowIso,
			createdAt: nowIso
		});
	}

	return {
		success: true,
		message:
			mode === 'merge' && mergeSummary
				? `Data master dari pusat berhasil digabung: ${mergeSummary.inserted} baris baru, ${mergeSummary.updated} baris diperbarui${namaSekolah ? ` (sekolah ${namaSekolah})` : ''}.`
				: `Master data${namaSekolah ? ` sekolah ${namaSekolah}` : ''} dari pusat berhasil dipasang (${totalRecords} baris).`,
		counts: imported,
		totalRecords,
		merge: mergeSummary,
		mode
	};
}

/** D1 membalas `result` sebagai array hasil per-statement atau objek { results }; ambil barisnya. */
function extractRows(result: unknown): Record<string, unknown>[] {
	if (!result) return [];
	if (Array.isArray(result)) {
		const first = result[0] as { results?: unknown } | undefined;
		if (first && Array.isArray(first.results)) {
			return first.results as Record<string, unknown>[];
		}
		return result as Record<string, unknown>[];
	}
	if (typeof result === 'object' && result !== null) {
		const obj = result as { results?: unknown };
		if (Array.isArray(obj.results)) {
			return obj.results as Record<string, unknown>[];
		}
	}
	return [];
}

function parseJsonObject(raw: unknown): Record<string, unknown> | null {
	if (typeof raw !== 'string') {
		return raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : null;
	}
	try {
		const parsed = JSON.parse(raw) as unknown;
		return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : null;
	} catch {
		return null;
	}
}

function toNonEmptyString(value: unknown): string {
	return typeof value === 'string' && value.length > 0 ? value : '';
}

/**
 * ==========================================================================
 * SINKRON DELTA "SEMUA" â€” master penuh + baris akademik yang berubah.
 *
 * Tiap paket `all_data` memuat SALINAN MASTER PENUH (supaya komputer lain
 * bisa memetakan id: murid/mapel/kelas/akun) ditambah DELTA â€” baris akademik
 * (nilai, absensi, jurnal, presensi) yang `updatedAt`-nya lebih baru daripada
 * pemeriksaan sebelumnya. Konflik ditangani LWW per baris di cloud-master-merge
 * (lokal yang lebih baru menang), dan sinkron delta TIDAK PERNAH MENGHAPUS.
 * ==========================================================================
 */

/** Tabel akademik referensi; dikirim penuh tiap push, dipakai juga sebagai peta id. */
const AKADEMIK_FULL_TABLES: readonly [string, SQLiteTable][] = [
	['tujuan_pembelajaran', tableTujuanPembelajaran],
	['ekstrakurikuler', tableEkstrakurikuler],
	['ekstrakurikuler_tujuan', tableEkstrakurikulerTujuan],
	['kokurikuler', tableKokurikuler]
];

/** Tabel akademik yang hanya mengirim baris yang berubah sejak pemeriksaan lalu. */
const AKADEMIK_DELTA_TABLES: readonly [string, SQLiteTable][] = [
	['asesmen_sumatif', tableAsesmenSumatif],
	['asesmen_sumatif_tujuan', tableAsesmenSumatifTujuan],
	['asesmen_formatif', tableAsesmenFormatif],
	['murid_ekstrakurikuler', tableMuridEkstrakurikuler],
	['asesmen_ekstrakurikuler', tableAsesmenEkstrakurikuler],
	['asesmen_kokurikuler', tableAsesmenKokurikuler],
	['catatan_wali_kelas', tableCatatanWaliKelas],
	['kehadiran_murid', tableKehadiranMurid],
	['keputusan_murid', tableKeputusanMurid],
	['ketidakhadiran_harian', tableKetidakhadiranHarian],
	['ketidakhadiran_rapor', tableKetidakhadiranRapor],
	['absensi', tableAbsensi],
	['jadwal_pelajaran', tableJadwalPelajaran],
	['jurnal_mengajar', tableJurnalMengajar],
	['presensi_guru', tablePresensiGuru],
	['presensi_settings', tablePresensiSettings]
];

/**
 * Kelompok pilihan scope sinkron (UI checkbox). Nama kelompok â†’ daftar nama
 * tabel akademik. Tabel master dipilih per sub-kelompok lewat prefix `master:`.
 */
export const SYNC_AKADEMIK_GROUPS: Record<string, string[]> = {
	nilai: ['asesmen_sumatif', 'asesmen_sumatif_tujuan', 'asesmen_formatif'],
	presensi: [
		'kehadiran_murid',
		'ketidakhadiran_harian',
		'ketidakhadiran_rapor',
		'absensi',
		'presensi_guru',
		'presensi_settings'
	],
	jadwal: ['jadwal_pelajaran', 'jurnal_mengajar', 'tujuan_pembelajaran'],
	ekstra: [
		'ekstrakurikuler',
		'ekstrakurikuler_tujuan',
		'kokurikuler',
		'murid_ekstrakurikuler',
		'asesmen_ekstrakurikuler',
		'asesmen_kokurikuler'
	],
	catatan: ['catatan_wali_kelas', 'keputusan_murid']
};

/** Sub-kelompok data induk (prefix `master:` di UI). */
export const SYNC_MASTER_GROUPS: Record<string, string[]> = {
	sekolah: ['sekolah', 'tahun_ajaran', 'semester', 'alamat'],
	guru: ['pegawai'],
	kelas: ['kelas'],
	mapel: ['mata_pelajaran'],
	murid: ['murid', 'wali_murid', 'murid_mata_pelajaran', 'alamat'],
	akun: ['auth_user', 'auth_user_mata_pelajaran', 'auth_user_kelas']
};

/**
 * Terjemahkan daftar pilihan (UI checkbox) menjadi daftar nama tabel yang
 * unik. `master:sekolah` dsb. memilih tabel induk; sisanya kelompok akademik.
 * `alamat` selalu menyertai pilihan induk mana pun (identitas sekolah & murid).
 * Kosong â†’ null = semua tabel ikut.
 */
export function syncGroupsToTables(groups: string[]): string[] | null {
	const picked = new Set<string>();
	for (const group of groups) {
		if (group.startsWith('master:')) {
			for (const name of SYNC_MASTER_GROUPS[group.slice('master:'.length)] ?? []) picked.add(name);
		} else {
			for (const name of SYNC_AKADEMIK_GROUPS[group] ?? []) picked.add(name);
		}
	}
	return picked.size === 0 ? null : Array.from(picked);
}

/** Kolom updatedAt sebuah tabel, mis. untuk predikat delta `updatedAt > since`. */
function updatedAtColumn(table: SQLiteTable) {
	return getTableColumns(table).updatedAt as unknown as AnySQLiteColumn;
}

/** Baris yang berubah sejak `since` (`updatedAt` kosong ikut sekali lalu distempel). */
async function selectDeltaRows(table: SQLiteTable, since: string | null) {
	const col = updatedAtColumn(table);
	const rows = (await db
		.select()
		.from(table)
		.where(since ? or(isNull(col), gt(col, since)) : undefined)) as unknown as Record<
		string,
		unknown
	>[];
	return rows.map((row) => {
		const serialized: Record<string, unknown> = {};
		for (const [key, value] of Object.entries(row)) serialized[key] = serializeValue(value);
		return serialized;
	});
}

/** Rekap baris delta akademik + master sejak `since` â€” dipakai agar push kosong bisa dilewati. */
export async function countDeltaRows(
	since: string | null,
	tablesFilter: readonly string[] | null = null
): Promise<MasterCounts> {
	const counts: MasterCounts = {};
	for (const [name, table] of MASTER_TABLES) {
		if (name === 'auth_user') continue; // akun: ikut master penuh, delta tak dibedakan
		const col = updatedAtColumn(table);
		const [row] = await db
			.select({ value: sql<number>`count(*)` })
			.from(table)
			.where(since ? or(isNull(col), gt(col, since)) : undefined);
		counts[name] = Number(row?.value ?? 0);
	}
	for (const [name, table] of AKADEMIK_DELTA_TABLES) {
		if (tablesFilter && !tablesFilter.includes(name)) continue;
		const col = updatedAtColumn(table);
		const [row] = await db
			.select({ value: sql<number>`count(*)` })
			.from(table)
			.where(since ? or(isNull(col), gt(col, since)) : undefined);
		counts[name] = Number(row?.value ?? 0);
	}
	return counts;
}

export interface AllDataPayloadResult {
	payload: AllDataPayload;
	deltaCounts: MasterCounts;
	totalDeltaRows: number;
}

/**
 * Susun paket ALL: master penuh + delta akademik sejak `since`.
 * `tablesFilter` (hasil `syncGroupsToTables`) membatasi tabel akademik yang
 * ikut; null = semua.
 */
export async function buildAllDataPayload(
	since: string | null,
	tablesFilter: readonly string[] | null = null,
	includeMaster = true
): Promise<AllDataPayloadResult> {
	const masterPayload = await exportMasterData();
	// Master penuh selalu tertanam (bisi pemetaan id); `tablesFilter` hanya
	// membatasi tabel akademik yang ikut, bukan data induk.
	const tables: Record<string, Record<string, unknown>[]> = !includeMaster
		? {}
		: { ...masterPayload.tables };

	const deltaCounts = await countDeltaRows(since, tablesFilter);
	const deltaTables = tablesFilter
		? AKADEMIK_DELTA_TABLES.filter(([name]) => tablesFilter.includes(name))
		: [...AKADEMIK_DELTA_TABLES];
	// Delta master tabel besar (murid dsb.) ikut mendorong perubahan struktur induk.
	// Master penuh sudah tertanam, jadi baris delta master hanya untuk hitungan rekap.
	//
	// Penting: perubahan HANYA pada data induk (guru/murid/akun baru) tetap harus
	// memicu pengiriman. Sebelumnya hitungan delta cuma tabel akademik, sehingga
	// paket master tidak pernah terkirim selama belum ada aktivitas nilai/presensi.
	const masterDeltaRows = includeMaster
		? MASTER_TABLES.reduce(
				(sum, [name]) => (name === 'auth_user' ? sum : sum + (deltaCounts[name] ?? 0)),
				0
			)
		: 0;

	let totalDeltaRows = masterDeltaRows;
	for (const [name, table] of deltaTables) {
		const rows = await selectDeltaRows(table, since);
		totalDeltaRows += rows.length;
		tables[name] = rows;
	}
	const fullTables = tablesFilter
		? AKADEMIK_FULL_TABLES.filter(([name]) => tablesFilter.includes(name))
		: AKADEMIK_FULL_TABLES;
	for (const [name, table] of fullTables) {
		const rows = (await db.select().from(table)) as unknown as Record<string, unknown>[];
		tables[name] = rows.map((row) => {
			const serialized: Record<string, unknown> = {};
			for (const [key, value] of Object.entries(row)) serialized[key] = serializeValue(value);
			return serialized;
		});
	}

	const payload: AllDataPayload = {
		app: 'erapor-pmk',
		kind: 'all_data',
		schema: 1,
		exported_at: masterPayload.exported_at,
		since: since ?? null,
		tables
	};

	return { payload, deltaCounts, totalDeltaRows };
}

export interface AllDataResult {
	success: boolean;
	message: string;
	totalDeltaRecords: number;
	counts: MasterCounts;
	lwwSummary?: { master?: MergeSummary; akademik?: MergeSummary };
}

const NOT_READY = 'Kredensial Database Pusat belum siap, jadi sinkronisasi tidak dijalankan.';

export interface AllDataPushOptions {
	/** Daftar nama tabel akademik yang ikut (hasil `syncGroupsToTables`). null = semua. */
	tablesFilter?: readonly string[] | null;
	/** Master penuh babarblas (peta id) â€” sikolahkeun sok kaserna bisi id anyar. */
	includeMaster?: boolean;
}

/**
 * PUSH delta: kirim master penuh + baris yang berubah ke Database Pusat.
 * `since` berasal dari app_meta key `sync.manual.lastPushAt` (sinkron manual di
 * halaman sinkronisasi).
 */
export async function pushAllDataToCloud(
	sekolahId: number,
	userId: number | null,
	since: string | null,
	options: AllDataPushOptions = {}
): Promise<AllDataResult> {
	const tablesFilter = options.tablesFilter ?? null;
	const includeMaster = options.includeMaster !== false;
	const config = await getD1Config(sekolahId);
	if (!d1CredentialsReady(config)) {
		return { success: false, message: NOT_READY, totalDeltaRecords: 0, counts: {} };
	}

	const { payload, totalDeltaRows } = await buildAllDataPayload(since, tablesFilter, includeMaster);
	if (totalDeltaRows === 0) {
		return {
			success: true,
			message: 'Tidak ada perubahan baru yang perlu dikirim.',
			totalDeltaRecords: 0,
			counts: {}
		};
	}

	// Penting: stamp dilakukan SETELAH payload disusun, supaya baris `updatedAt`
	// NULL sempat ikut di dalam delta sekali (predikat `isNull`) sebelum distempel.
	await stampNullUpdatedAt(since ?? null, tablesFilter, includeMaster);

	const counts = countPayloadRows(payload);
	const totalRecords = Object.values(counts).reduce((sum, value) => sum + value, 0);
	const checksum = checksumOf(payload);
	const stamp = new Date().toISOString();
	const packageId = `all-${sekolahId}-${Date.now()}`;

	const packageInsert = await executeD1Query(
		config,
		`INSERT INTO packages (id, school_id, package_type, file_name, version, checksum, payload_json, status, summary_json, created_by, created_at)
		 VALUES (?, ?, 'all_data', 'all.erdata', '1.0', ?, ?, 'PUBLISHED', ?, ?, ?)
		 ON CONFLICT(id) DO UPDATE SET payload_json=excluded.payload_json, checksum=excluded.checksum, summary_json=excluded.summary_json, status='PUBLISHED'`,
		[
			packageId,
			String(sekolahId),
			checksum,
			JSON.stringify(payload),
			JSON.stringify({
				delta_rows: totalDeltaRows,
				since: since ?? null,
				pushed_at: stamp
			}),
			userId ? String(userId) : null,
			stamp
		]
	);

	if (!packageInsert.success) {
		const message = packageInsert.error ?? 'Gagal mengirim paket sinkron ke Database Pusat.';
		await db.insert(tableCloudSyncLogs).values({
			sekolahId,
			userId,
			action: 'PUSH',
			status: 'FAILED',
			totalRecords: totalRecords,
			summary: JSON.stringify({
				kind: 'all_data',
				delta_rows: totalDeltaRows,
				since: since ?? null
			}),
			errorMessage: message,
			createdAt: stamp
		});
		return {
			success: false,
			message,
			totalDeltaRecords: totalDeltaRows,
			counts: {}
		};
	}

	await executeD1Query(
		config,
		`INSERT INTO publish_versions (id, school_id, version_code, scope, checksum, metadata_json, total_records, status, published_by, published_at)
		 VALUES (?, ?, ?, 'all_data', ?, ?, ?, 'published', ?, ?)`,
		[
			`pv-all-${Date.now()}`,
			String(sekolahId),
			stamp.replace(/[-:TZ.]/g, '').slice(0, 14),
			checksum,
			JSON.stringify({ package_id: packageId, delta_rows: totalDeltaRows, pushed_at: stamp }),
			totalRecords,
			userId ? String(userId) : null,
			stamp
		]
	);

	await executeD1Query(
		config,
		`INSERT INTO publish_versions (id, school_id, version_code, scope, checksum, metadata_json, total_records, status, published_by, published_at)
		 VALUES (?, ?, ?, 'master_data', ?, ?, ?, 'published', ?, ?)`,
		[
			`pv-master-${Date.now()}`,
			String(sekolahId),
			stamp.replace(/[-:TZ.]/g, '').slice(0, 14),
			checksum,
			JSON.stringify({ package_id: packageId, counts, total_records: totalRecords }),
			totalRecords,
			userId ? String(userId) : null,
			stamp
		]
	);

	await db.insert(tableCloudSyncLogs).values({
		sekolahId,
		userId,
		action: 'PUSH',
		status: 'SUCCESS',
		totalRecords,
		summary: JSON.stringify({
			kind: 'all_data',
			delta_rows: totalDeltaRows,
			since: since ?? null,
			package_id: packageId
		}),
		createdAt: stamp
	});

	const stored = await db.query.tableCloudSyncSettings.findFirst({
		where: eq(tableCloudSyncSettings.sekolahId, sekolahId)
	});
	if (stored) {
		await db
			.update(tableCloudSyncSettings)
			.set({ lastPushedAt: stamp, lastChecksum: checksum, updatedAt: stamp })
			.where(eq(tableCloudSyncSettings.id, stored.id));
	} else {
		await db.insert(tableCloudSyncSettings).values({
			sekolahId,
			lastPushedAt: stamp,
			lastChecksum: checksum,
			createdAt: stamp
		});
	}

	// Mirror data langsung ke tabel DATA D1 supaya aplikasi web (yang memakai
	// D1 sebagai database) langsung melihat perubahan ini — paket di `packages`
	// saja tidak dibaca web. Hanya tabel yang ikut push; gagal parsial tidak
	// membatalkan push paket.
	const academicTables = [...AKADEMIK_FULL_TABLES, ...AKADEMIK_DELTA_TABLES];
	const mirrorTables: [string, SQLiteTable][] = [];
	if (includeMaster) mirrorTables.push(...MASTER_TABLES);
	for (const [name, table] of academicTables) {
		if (!tablesFilter || tablesFilter.includes(name)) mirrorTables.push([name, table]);
	}
	const mirror = await mirrorTablesToCloud(config, mirrorTables);
	if (mirror.skipped.length > 0) {
		console.warn(
			'[cloud-master] mirror web sebagian gagal, tabel:',
			mirror.skipped.join(', ')
		);
	}

	return {
		success: true,
		message: `Sinkron terkirim: ${totalDeltaRows} baris berubah (total paket ${totalRecords} baris). Mirror web: ${mirror.mirrored} baris.`,
		totalDeltaRecords: totalDeltaRows,
		counts
	};
}

/** Baris tanpa `updatedAt` distempel sekali supaya tidak ikut di seluruh delta berikutnya. */
async function stampNullUpdatedAt(
	_since: string | null,
	tablesFilter: readonly string[] | null = null,
	includeMaster = true
) {
	// Tabel delta akademik + master; stamp memakai waktu lampau agar delta berikutnya
	// (`updatedAt > since`) tetap memuatnya untuk semua sisi tapi tidak berulang.
	// Hanya menstempel tabel yang BENAR-BENAR ikut paket â€” tabel di luar scope
	// tetap `updatedAt` NULL agar delta berikutnya (saat dipilih) memuatnya.
	const deep = '1970-01-01T00:00:01.000Z';
	if (includeMaster) {
		for (const [, table] of MASTER_TABLES) {
			const col = updatedAtColumn(table);
			await db
				.update(table)
				.set({ updatedAt: deep } as never)
				.where(isNull(col));
		}
	}
	for (const [name, table] of AKADEMIK_DELTA_TABLES) {
		if (tablesFilter && !tablesFilter.includes(name)) continue;
		const col = updatedAtColumn(table);
		await db
			.update(table)
			.set({ updatedAt: deep } as never)
			.where(isNull(col));
	}
}

/**
 * PULL delta: baca penunjuk pembaruan `all_data` terakhir di pusat, lalu gabungkan:
 * master penuh dipetakan dulu (peta id), kemudian baris akademik barunya LWW.
 */
export async function pullAllDataFromCloud(
	sekolahId: number,
	userId: number | null,
	options: {
		tablesFilter?: readonly string[] | null;
		includeMaster?: boolean;
		mode?: 'replace' | 'merge';
	} = {}
): Promise<AllDataResult & { pointerCreatedAt?: string | null }> {
	const config = await getD1Config(sekolahId);
	if (!d1CredentialsReady(config)) {
		return { success: false, message: NOT_READY, totalDeltaRecords: 0, counts: {} };
	}

	const pointer = await executeD1Query(
		config,
		`SELECT metadata_json, checksum, published_at FROM publish_versions WHERE scope = 'all_data' ${sekolahId > 0 ? 'AND school_id = ?' : ''} ORDER BY published_at DESC LIMIT 1`,
		sekolahId > 0 ? [String(sekolahId)] : []
	);
	if (!pointer.success) {
		return {
			success: false,
			message: pointer.error ?? 'Gagal membaca penunjuk sinkron dari Database Pusat.',
			totalDeltaRecords: 0,
			counts: {}
		};
	}
	const pointerRows = extractRows(pointer.result);
	if (pointerRows.length === 0) {
		return {
			success: false,
			message: 'Database Pusat belum punya paket sinkron. Tunggu operator lain mengirim.',
			totalDeltaRecords: 0,
			counts: {}
		};
	}
	const pointerChecksum = toNonEmptyString(pointerRows[0]?.checksum);
	const pointerCreatedAt = toNonEmptyString(pointerRows[0]?.published_at) || null;
	const metadata = parseJsonObject(pointerRows[0]?.metadata_json);
	const packageId = typeof metadata?.package_id === 'string' ? metadata.package_id : '';
	if (!packageId) {
		return {
			success: false,
			message: 'Penunjuk sinkron di pusat tidak memuat ID paket.',
			totalDeltaRecords: 0,
			counts: {}
		};
	}

	const packageRes = await executeD1Query(
		config,
		`SELECT payload_json, checksum FROM packages WHERE id = ? LIMIT 1`,
		[packageId]
	);
	if (!packageRes.success) {
		return {
			success: false,
			message: packageRes.error ?? 'Gagal mengambil isi paket sinkron.',
			totalDeltaRecords: 0,
			counts: {}
		};
	}
	const packageRows = extractRows(packageRes.result);
	const rawPayload = packageRows[0]?.payload_json;
	if (typeof rawPayload !== 'string') {
		return {
			success: false,
			message: 'Paket sinkron di pusat tidak ditemukan atau isinya kosong.',
			totalDeltaRecords: 0,
			counts: {}
		};
	}
	const packageChecksum = toNonEmptyString(packageRows[0]?.checksum);
	if (pointerChecksum && packageChecksum && pointerChecksum !== packageChecksum) {
		return {
			success: false,
			message: 'Penunjuk sinkron tidak cocok dengan paketnya di Database Pusat.',
			totalDeltaRecords: 0,
			counts: {}
		};
	}
	const payload = parseJsonObject(rawPayload) as unknown as AllDataPayload | null;
	if (!payload || payload?.kind !== 'all_data') {
		return {
			success: false,
			message: 'Isi paket sinkron di pusat tidak bisa dibaca.',
			totalDeltaRecords: 0,
			counts: {}
		};
	}
	if (packageChecksum && checksumOf(payload) !== packageChecksum) {
		return {
			success: false,
			message: 'Checksum paket sinkron tidak cocok. Paket di pusat berubah sejak dikirim.',
			totalDeltaRecords: 0,
			counts: {}
		};
	}

	// Scope pilihan UI: saring tabel dalam paket sebelum digabung.
	const tablesFilter = options.tablesFilter ?? null;
	const includeMaster = options.includeMaster !== false;
	if (tablesFilter || !includeMaster) {
		const masterNames = new Set(MASTER_TABLES.map(([name]) => name));
		const filtered: Record<string, Record<string, unknown>[]> = {};
		for (const [name, rows] of Object.entries(payload.tables)) {
			if (masterNames.has(name)) {
				// Master ikut jika dipilih eksplisit di tablesFilter, atau bila
				// filter tidak dipakai dan includeMaster tetap menyala.
				if (tablesFilter?.includes(name) || (!tablesFilter && includeMaster)) {
					filtered[name] = rows;
				}
			} else if (tablesFilter?.includes(name) ?? true) {
				filtered[name] = rows;
			}
		}
		payload.tables = filtered;
	}

	// Mode Timpa Penuh / Reset DB dari Pusat: bersihkan tabel lokal lalu pasang baris paket.
	if (options.mode === 'replace') {
		const counts: Record<string, number> = {};
		let totalInserted = 0;
		await db.transaction(async (tx) => {
			await tx.run(sql`PRAGMA defer_foreign_keys = ON`);
			if (includeMaster) {
				for (const [, table] of MASTER_TABLES) {
					await tx.delete(table);
				}
				for (const [name, table] of MASTER_TABLES) {
					const rows = payload.tables?.[name] ?? [];
					await insertRows(tx, table, rows);
					counts[name] = rows.length;
					totalInserted += rows.length;
				}
			}
			for (const [name, table] of AKADEMIK_DELTA_TABLES) {
				if (payload.tables?.[name]) {
					await tx.delete(table);
					const rows = payload.tables[name];
					await insertRows(tx, table, rows);
					counts[name] = rows.length;
					totalInserted += rows.length;
				}
			}
		});

		const admins = await db
			.select({ id: tableAuthUser.id })
			.from(tableAuthUser)
			.where(eq(tableAuthUser.type, 'admin'));
		if (admins.length === 0) {
			await ensureDefaultAdmin();
		}

		const sekolahRows = await db.select({ id: tableSekolah.id }).from(tableSekolah);
		const targetSekolahId = sekolahRows[0]?.id ?? sekolahId;
		const nowIso = new Date().toISOString();

		await db.insert(tableCloudSyncLogs).values({
			sekolahId: targetSekolahId,
			userId,
			action: 'PULL',
			status: 'SUCCESS',
			totalRecords: totalInserted,
			summary: JSON.stringify({ kind: 'all_data', mode: 'replace', counts }),
			createdAt: nowIso
		});

		const stored = await db.query.tableCloudSyncSettings.findFirst({
			where: eq(tableCloudSyncSettings.sekolahId, targetSekolahId)
		});
		if (stored) {
			await db
				.update(tableCloudSyncSettings)
				.set({ lastPulledAt: nowIso, updatedAt: nowIso })
				.where(eq(tableCloudSyncSettings.id, stored.id));
		} else {
			await db.insert(tableCloudSyncSettings).values({
				sekolahId: targetSekolahId,
				lastPulledAt: nowIso,
				createdAt: nowIso
			});
		}

		return {
			success: true,
			message: `Database berhasil di-reset dan ditimpa penuh dari pusat (${totalInserted} baris terpasang).`,
			totalDeltaRecords: totalInserted,
			counts
		};
	}

	// Merge master secara penuh dan baris akademik dari payload ini.
	const masterMerged = await mergeMasterTables(payload, null);
	const akademikSummary = await mergeAkademikData(payload, masterMerged.maps);

	const nowIso = new Date().toISOString();
	const targetSekolahId = masterMerged.sekolahId ?? sekolahId;

	await db.insert(tableCloudSyncLogs).values({
		sekolahId: targetSekolahId,
		userId,
		action: 'PULL',
		status: 'SUCCESS',
		totalRecords:
			masterMerged.summary.inserted +
			masterMerged.summary.updated +
			akademikSummary.inserted +
			akademikSummary.updated,
		summary: JSON.stringify({
			kind: 'all_data',
			master: masterMerged.summary,
			akademik: akademikSummary
		}),
		createdAt: nowIso
	});

	const stored = await db.query.tableCloudSyncSettings.findFirst({
		where: eq(tableCloudSyncSettings.sekolahId, targetSekolahId)
	});
	if (stored) {
		await db
			.update(tableCloudSyncSettings)
			.set({ lastPulledAt: nowIso, updatedAt: nowIso })
			.where(eq(tableCloudSyncSettings.id, stored.id));
	} else {
		await db.insert(tableCloudSyncSettings).values({
			sekolahId: targetSekolahId,
			lastPulledAt: nowIso,
			createdAt: nowIso
		});
	}

	return {
		success: true,
		message: `Sinkron dari pusat diterima: ${akademikSummary.inserted + masterMerged.summary.inserted} baris baru, ${akademikSummary.updated + masterMerged.summary.updated} baris diperbarui.`,
		totalDeltaRecords: 0,
		counts: {},
		lwwSummary: { master: masterMerged.summary, akademik: akademikSummary },
		pointerCreatedAt
	};
}
