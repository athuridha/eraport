import { error, fail } from '@sveltejs/kit';
import { and, asc, count, eq, inArray, isNotNull, or, sql, type SQLWrapper } from 'drizzle-orm';
import db from '$lib/server/db';
import { tableAuthUser, tableKelas, tableMataPelajaran, tablePegawai } from '$lib/server/db/schema';
import { normalisasiBarisPerHalaman } from '$lib/utils/pagination';
import { hapusMasterData } from '$lib/admin/master-data.server';
import { hashPassword } from '$lib/server/auth';
import { validatePasswordStrength } from '$lib/server/password-policy';
import { defaultPermissionsByType } from '../../../../pengguna/permissions';
import { readBufferToAoA } from '$lib/utils/excel.js';
import { isAdminUser } from '../../../../pengguna/permissions';

const MAKS_UPLOAD_DAFTAR = 2_000_000; // 2 MB

/** Header kolom yang dikenali untuk import daftar guru. */
const HEADER_USERNAME = [
	'pengguna/password',
	'pengguna / password',
	'pengguna',
	'username',
	'user',
	'login',
	'akun',
	'nip',
	'nis'
];
const HEADER_NAMA = ['nama', 'nama lengkap', 'nama guru', 'nama pengguna', 'name'];

function parseCsv(teks: string): string[][] {
	const barisPertama = teks.split(/\r?\n/).find((baris) => baris.trim().length > 0) ?? '';
	const pemisah = barisPertama.includes(';') && !barisPertama.includes(',') ? ';' : ',';

	const rows: string[][] = [];
	let row: string[] = [];
	let sel = '';
	let dalamKutip = false;

	for (let i = 0; i < teks.length; i += 1) {
		const ch = teks[i];
		if (dalamKutip) {
			if (ch === '"') {
				if (teks[i + 1] === '"') {
					sel += '"';
					i += 1;
				} else {
					dalamKutip = false;
				}
			} else {
				sel += ch;
			}
			continue;
		}
		if (ch === '"') {
			dalamKutip = true;
			continue;
		}
		if (ch === pemisah) {
			row.push(sel.trim());
			sel = '';
			continue;
		}
		if (ch === '\n') {
			row.push(sel.trim());
			rows.push(row);
			row = [];
			sel = '';
			continue;
		}
		if (ch === '\r') continue;
		sel += ch;
	}
	if (sel.length || row.length) {
		row.push(sel.trim());
		rows.push(row);
	}
	return rows.filter((item) => item.some((value) => value !== ''));
}

/** Baca baris tabel dari file .xlsx atau .csv. */
async function bacaBarisFile(file: File): Promise<string[][]> {
	const nama = file.name.toLowerCase();
	if (nama.endsWith('.csv') || file.type === 'text/csv') {
		return parseCsv(await file.text());
	}
	return (await readBufferToAoA(await file.arrayBuffer())) as string[][];
}

/** Cari indeks kolom username & nama dari baris header. */
function cariKolom(header: string[]): { kolomUsername: number; kolomNama: number } {
	const normal = (value: string) =>
		(value ?? '').toString().toLowerCase().replace(/[_.]+/g, ' ').trim();
	let kolomUsername = -1;
	let kolomNama = -1;
	header.forEach((value, index) => {
		const v = normal(value);
		if (kolomUsername === -1 && HEADER_USERNAME.some((h) => v === h || v.startsWith(h))) {
			kolomUsername = index;
		}
		if (kolomNama === -1 && HEADER_NAMA.some((h) => v === h || v.startsWith(h))) {
			kolomNama = index;
		}
	});
	return { kolomUsername, kolomNama };
}

const KELOMPOK = {
	guru: {
		judul: 'Guru',
		deskripsi:
			'Akun guru pengajar, wali kelas, dan wali asuh. Akun guru dibuat dari halaman Tambah Akun.',
		types: ['user', 'wali_kelas', 'wali_asuh']
	},
	operator: {
		judul: 'Operator',
		deskripsi: 'Akun operator sekolah: admin dan kepala sekolah (termasuk guru multi-role).',
		types: ['admin', 'kepala_sekolah']
	}
} as const;

const GURU_TYPES = ['user', 'wali_kelas', 'wali_asuh'] as const;

type KunciKelompok = keyof typeof KELOMPOK;

function labelRole(role: string): string {
	switch (role) {
		case 'admin':
			return 'Admin';
		case 'kepala_sekolah':
			return 'Kepala Sekolah';
		case 'wali_kelas':
			return 'Wali Kelas';
		case 'wali_asuh':
			return 'Wali Asuh';
		case 'operator':
			return 'Operator';
		default:
			return 'Guru';
	}
}

export const load = async ({ params, locals, url }) => {
	const key = (params.kelompok ?? '') as KunciKelompok;
	const kelompok = KELOMPOK[key];
	if (!kelompok) {
		throw error(404, 'Kelompok pengguna tidak ditemukan');
	}

	const sekolahId = locals.sekolah?.id ?? null;
	if (!sekolahId) {
		throw error(401, 'Sekolah aktif tidak ditemukan');
	}
	const user = locals.user;
	if (!user || !isAdminUser(user)) {
		throw error(403, 'Data pengguna hanya bisa dikelola admin dan kepala sekolah.');
	}

	const q = url.searchParams.get('q')?.trim() || null;
	const role = url.searchParams.get('role')?.trim() || null;
	const like = `%${q ?? ''}%`;
	const perHalaman = normalisasiBarisPerHalaman(url.searchParams.get('per_page'), 50);
	const page = Math.max(1, Number(url.searchParams.get('page')) || 1);

	// Mode multi-role: kelompok operator juga menampilkan akun guru yang diberi
	// `operatorLevel` (admin/kepala_sekolah) tanpa mengubah peran utamanya,
	// sedangkan kelompok guru juga memuat akun admin/kepala yang merangkap guru.
	const rolesAda = (role: string) =>
		sql`exists (select 1 from json_each(coalesce(${tableAuthUser.roles}, '[]')) where value = ${role})`;
	const kondisiOperatorGuru = and(
		isNotNull(tableAuthUser.operatorLevel),
		inArray(tableAuthUser.type, [...GURU_TYPES])
	);
	const grupKondisi: (SQLWrapper | undefined)[] =
		key === 'operator'
			? [
					inArray(tableAuthUser.type, [...kelompok.types]),
					kondisiOperatorGuru,
					rolesAda('operator'),
					rolesAda('kepala_sekolah')
				]
			: [inArray(tableAuthUser.type, [...kelompok.types]), rolesAda('guru')];
	const kondisiKelompok = or(...grupKondisi);
	const kondisi = [kondisiKelompok];
	if (role) {
		kondisi.push(eq(tableAuthUser.type, role as typeof tableAuthUser.$inferSelect.type));
	}
	if (q) {
		kondisi.push(
			sql`(lower(auth_user.username) like ${like} or lower(coalesce(auth_user.nama_lengkap, '')) like ${like} or lower(coalesce(pegawai.nik, '')) like ${like})`
		);
	}

	const [[{ total }], [{ totalAwal }], rawRoles] = await Promise.all([
		db
			.select({ total: count() })
			.from(tableAuthUser)
			.leftJoin(tablePegawai, eq(tableAuthUser.pegawaiId, tablePegawai.id))
			.where(and(...kondisi)),
		db.select({ totalAwal: count() }).from(tableAuthUser).where(kondisiKelompok),
		db
			.selectDistinct({ type: tableAuthUser.type })
			.from(tableAuthUser)
			.where(kondisiKelompok)
			.orderBy(asc(tableAuthUser.type))
	]);

	const opsiRole = rawRoles
		.map((r) => r.type)
		.filter((t): t is NonNullable<typeof t> => Boolean(t))
		.map((t) => ({ value: String(t), label: labelRole(t) }));

	const totalHalaman = Math.max(1, Math.ceil(total / perHalaman));
	const halamanSekarang = Math.min(page, totalHalaman);
	const offset = (halamanSekarang - 1) * perHalaman;

	const rows = await db
		.select({
			id: tableAuthUser.id,
			username: tableAuthUser.username,
			namaLengkap: tableAuthUser.namaLengkap,
			role: tableAuthUser.type,
			operatorLevel: tableAuthUser.operatorLevel,
			roles: tableAuthUser.roles,
			pegawaiNama: tablePegawai.nama,
			nik: tablePegawai.nik,
			kelas: sql<string | null>`(select k.nama from kelas k where k.id = auth_user.kelas_id)`,
			mapel: sql<
				string | null
			>`(select mp.nama from mata_pelajaran mp where mp.id = auth_user.mata_pelajaran_id)`,
			izin: sql<number>`(select count(*) from json_each(auth_user.permissions))`,
			dibuat: tableAuthUser.createdAt
		})
		.from(tableAuthUser)
		.leftJoin(tablePegawai, eq(tableAuthUser.pegawaiId, tablePegawai.id))
		.where(and(...kondisi))
		.orderBy(asc(tableAuthUser.username))
		.limit(perHalaman)
		.offset(offset);

	const baris = rows.map((row) => {
		// Role gabungan dari daftar roles tersimpan (mis. Guru + Admin).
		const savedRoles = Array.isArray(row.roles)
			? row.roles.filter((r) => typeof r === 'string')
			: [];
		const roleLabel = savedRoles.length
			? savedRoles.map((r) => labelRole(r) ?? r).join(' + ')
			: labelRole(row.role);
		return {
			id: row.id,
			nama: row.namaLengkap ?? row.pegawaiNama ?? row.username,
			role: roleLabel,
			operatorLevel: row.operatorLevel,
			username: row.username,
			bisaHapus: row.id !== 1 && row.username.trim().toLowerCase() !== 'admin',
			nik_username: row.nik || row.username,
			kelas: row.kelas,
			mapel: row.mapel,
			izin: row.izin,
			dibuat: row.dibuat
		};
	});

	const [daftarKelas, daftarMapel] = await Promise.all([
		db
			.select({ id: tableKelas.id, nama: tableKelas.nama, fase: tableKelas.fase })
			.from(tableKelas)
			.where(eq(tableKelas.sekolahId, sekolahId))
			.orderBy(asc(tableKelas.nama)),
		db
			.select({
				id: tableMataPelajaran.id,
				nama: tableMataPelajaran.nama,
				kelasId: tableMataPelajaran.kelasId
			})
			.from(tableMataPelajaran)
			.innerJoin(tableKelas, eq(tableMataPelajaran.kelasId, tableKelas.id))
			.where(eq(tableKelas.sekolahId, sekolahId))
			.orderBy(asc(tableMataPelajaran.nama))
	]);

	return {
		meta: { title: `Data Pengguna — ${kelompok.judul}` },
		kelompok: { key, judul: kelompok.judul, deskripsi: kelompok.deskripsi },
		baris,
		total,
		adaDataAwal: totalAwal > 0,
		opsiRole,
		totalHalaman,
		perHalaman,
		daftarKelas,
		daftarMapel,
		filter: { q, role, page: halamanSekarang, perHalaman }
	};
};

function pastikanBolehKelola(locals: App.Locals): number {
	const sekolahId = locals.sekolah?.id;
	if (!sekolahId) throw error(401, 'Sekolah aktif tidak ditemukan');
	const user = locals.user;
	if (!user || !isAdminUser(user)) {
		throw error(403, 'Data pengguna hanya bisa dikelola admin dan kepala sekolah.');
	}
	return sekolahId;
}

export const actions = {
	async imporGuru({ request, locals, params }) {
		const sekolahId = pastikanBolehKelola(locals);

		if ((params.kelompok ?? '') !== 'guru') {
			return fail(400, { fail: 'Impor daftar hanya tersedia untuk akun guru.' });
		}

		const formData = await request.formData();
		const file = formData.get('file');
		if (!(file instanceof File) || file.size === 0) {
			return fail(400, { fail: 'Pilih file daftar guru (.xlsx atau .csv).' });
		}
		if (file.size > MAKS_UPLOAD_DAFTAR) {
			return fail(400, { fail: 'Ukuran file maksimal 2 MB.' });
		}

		const pakaiSandiUsername = formData.get('sandi') !== 'tetap';
		const sandiTetap = String(formData.get('sandi_tetap') ?? '').trim();
		const wajibGantiSandi = formData.get('wajib_ganti') !== 'tidak';
		const perbaruiNama = formData.get('perbarui_nama') === 'ya';

		if (!pakaiSandiUsername) {
			if (!sandiTetap) return fail(400, { fail: 'Kata sandi tetap wajib diisi.' });
			const passwordError = validatePasswordStrength(sandiTetap);
			if (passwordError) return fail(400, { fail: passwordError });
		}

		let baris: string[][];
		try {
			baris = await bacaBarisFile(file);
		} catch (error) {
			console.error('[master-data-pengguna] gagal membaca file daftar guru:', error);
			return fail(400, { fail: 'File tidak bisa dibaca. Pastikan format .xlsx atau .csv.' });
		}
		if (baris.length < 2) {
			return fail(400, { fail: 'File kosong atau tidak punya baris data.' });
		}

		const { kolomUsername, kolomNama } = cariKolom(baris[0]);
		if (kolomUsername === -1 || kolomNama === -1) {
			return fail(400, {
				fail: 'Header kolom tidak dikenali. Kolom pertama harus "Pengguna/Password" dan kolom kedua "Nama".'
			});
		}

		let dibuat = 0;
		let diperbarui = 0;
		const dilewati: string[] = [];

		for (const row of baris.slice(1)) {
			const username = String(row[kolomUsername] ?? '').trim();
			const nama = String(row[kolomNama] ?? '').trim();
			if (!username && !nama) continue;
			if (!username) {
				dilewati.push(`${nama || '(tanpa nama)'}: username kosong`);
				continue;
			}
			if (!nama) {
				dilewati.push(`${username}: nama kosong`);
				continue;
			}

			const normalized = username.toLowerCase();
			const [ada] = await db
				.select({ id: tableAuthUser.id, pegawaiId: tableAuthUser.pegawaiId })
				.from(tableAuthUser)
				.where(eq(tableAuthUser.usernameNormalized, normalized))
				.limit(1);

			if (ada) {
				// Akun sudah ada: perbarui nama bila diminta, selain itu lewati.
				const [pegawai] = ada.pegawaiId
					? await db
							.select({ id: tablePegawai.id })
							.from(tablePegawai)
							.where(eq(tablePegawai.id, ada.pegawaiId))
							.limit(1)
					: [];
				if (perbaruiNama && pegawai) {
					await db.update(tablePegawai).set({ nama }).where(eq(tablePegawai.id, pegawai.id));
					diperbarui += 1;
				} else {
					dilewati.push(`${username}: akun sudah ada`);
				}
				continue;
			}

			// Orang yang sama sudah punya akun (mis. kepala sekolah) dilewati.
			const [orang] = await db
				.select({ id: tablePegawai.id })
				.from(tablePegawai)
				.where(eq(tablePegawai.nama, nama))
				.limit(1);
			if (orang) {
				const [terpakai] = await db
					.select({ id: tableAuthUser.id })
					.from(tableAuthUser)
					.where(eq(tableAuthUser.pegawaiId, orang.id))
					.limit(1);
				if (terpakai) {
					dilewati.push(`${username}: ${nama} sudah punya akun`);
					continue;
				}
			}

			const sandi = pakaiSandiUsername ? username : sandiTetap;
			const { hash, salt } = hashPassword(sandi);
			const timestamp = new Date().toISOString();

			let pegawaiId = orang?.id ?? null;
			if (!pegawaiId) {
				const [pegawai] = await db
					.insert(tablePegawai)
					// sekolahId WAJIB: dropdown relasi (wali kelas dll.) filter pegawai per
					// sekolah — tanpa ini guru hilang dari form kelas/mapel.
					.values({ nama, nip: username, sekolahId })
					.returning({ id: tablePegawai.id });
				pegawaiId = pegawai?.id ?? null;
			}

			await db.insert(tableAuthUser).values({
				username,
				usernameNormalized: normalized,
				passwordHash: hash,
				passwordSalt: salt,
				mustChangePassword: wajibGantiSandi,
				permissions: defaultPermissionsByType.user,
				type: 'user',
				sekolahId,
				pegawaiId: pegawaiId ?? undefined,
				createdAt: timestamp,
				updatedAt: timestamp
			});
			dibuat += 1;
		}

		const bagian = [`${dibuat} akun guru dibuat`];
		if (diperbarui) bagian.push(`${diperbarui} nama diperbarui`);
		if (dilewati.length) bagian.push(`${dilewati.length} dilewati`);
		const pesan =
			bagian.join(', ') + (dilewati.length ? ` — contoh: ${dilewati.slice(0, 3).join('; ')}` : '');

		return { message: pesan, dibuat, diperbarui, dilewati: dilewati.length };
	},

	async tambah({ request, locals, params }) {
		const sekolahId = pastikanBolehKelola(locals);

		const key = (params.kelompok ?? '') as KunciKelompok;
		const kelompok = KELOMPOK[key];
		if (!kelompok) return fail(404, { fail: 'Kelompok pengguna tidak ditemukan.' });

		const formData = await request.formData();
		const username = String(formData.get('username') ?? '').trim();
		const password = String(formData.get('password') ?? '').trim();
		const nama = String(formData.get('nama') ?? '').trim();
		const nik = String(formData.get('nik') ?? '').trim();
		const role = String(formData.get('type') ?? (key === 'operator' ? 'admin' : 'user'));
		const kelasId = Number(formData.get('kelas_id') ?? 0) || null;
		const mapelId = Number(formData.get('mata_pelajaran_id') ?? 0) || null;

		if (!username) return fail(400, { fail: 'Nama pengguna wajib diisi.' });
		if (!nama) return fail(400, { fail: 'Nama lengkap wajib diisi.' });
		if (!password) return fail(400, { fail: 'Kata sandi wajib diisi.' });

		const passwordError = validatePasswordStrength(password);
		if (passwordError) return fail(400, { fail: passwordError });
		if (nik && !/^\d{16}$/.test(nik)) {
			return fail(400, { fail: 'NIK harus 16 digit angka.' });
		}

		// Role harus sesuai kelompok halaman.
		const roleBoleh = key === 'operator' ? ['admin', 'kepala_sekolah'] : ['user', 'wali_kelas'];
		if (!roleBoleh.includes(role)) {
			return fail(400, { fail: 'Role tidak sesuai kelompok pengguna ini.' });
		}

		// Level operator opsional (multi-role guru): hanya relevan untuk kelompok guru.
		const opsiLevel = ['', 'admin', 'kepala_sekolah'];
		const opLevelRaw = String(formData.get('operator_level') ?? '');
		const operatorLevel =
			key !== 'operator' && opsiLevel.includes(opLevelRaw) && opLevelRaw
				? (opLevelRaw as 'admin' | 'kepala_sekolah')
				: null;
		const permissionsAwal = operatorLevel
			? Array.from(
					new Set([
						...(defaultPermissionsByType[role as keyof typeof defaultPermissionsByType] ?? []),
						...(defaultPermissionsByType[operatorLevel] ?? [])
					])
				)
			: (defaultPermissionsByType[role as keyof typeof defaultPermissionsByType] ?? []);

		const [bentrok] = await db
			.select({ id: tableAuthUser.id })
			.from(tableAuthUser)
			.where(eq(tableAuthUser.usernameNormalized, username.toLowerCase()))
			.limit(1);
		if (bentrok) {
			return fail(400, { fail: 'Nama pengguna sudah dipakai.' });
		}

		try {
			const { hash, salt } = hashPassword(password);
			const timestamp = new Date().toISOString();

			const [pegawai] = await db
				.insert(tablePegawai)
				.values({ nama, nip: '', nik: nik || null, sekolahId })
				.returning({ id: tablePegawai.id });

			await db.insert(tableAuthUser).values({
				username,
				usernameNormalized: username.toLowerCase(),
				passwordHash: hash,
				passwordSalt: salt,
				passwordUpdatedAt: timestamp,
				permissions: permissionsAwal,
				type: role as 'admin' | 'kepala_sekolah' | 'wali_kelas' | 'user',
				operatorLevel,
				mataPelajaranId: mapelId ?? undefined,
				kelasId: kelasId ?? undefined,
				sekolahId,
				pegawaiId: pegawai?.id ?? undefined,
				createdAt: timestamp,
				updatedAt: timestamp
			});
		} catch (error) {
			console.error('[master-data-pengguna] gagal menambah akun:', error);
			return fail(500, { fail: 'Gagal membuat akun pengguna.' });
		}

		return { message: `Akun ${nama} berhasil dibuat.` };
	},

	async hapus({ request, locals }) {
		const sekolahId = pastikanBolehKelola(locals);
		const formData = await request.formData();
		const id = Number(formData.get('id') ?? 0);
		if (!Number.isInteger(id) || id <= 0) {
			return fail(400, { fail: 'Akun pengguna tidak valid.' });
		}
		const hasil = await hapusMasterData(sekolahId, 'pengguna', id);
		if (hasil.fail) return fail(400, { fail: hasil.fail });
		return { message: hasil.message };
	},

	async hapusMassal({ request, locals }) {
		const sekolahId = pastikanBolehKelola(locals);
		const formData = await request.formData();
		let ids: number[] = [];
		try {
			const parsed = JSON.parse(String(formData.get('ids') ?? '[]'));
			if (Array.isArray(parsed)) {
				ids = parsed
					.map((value) => Number(value))
					.filter((value) => Number.isInteger(value) && value > 0);
			}
		} catch {
			return fail(400, { fail: 'Data pilihan tidak valid.' });
		}
		if (!ids.length) {
			return fail(400, { fail: 'Tidak ada akun yang dipilih.' });
		}

		let terhapus = 0;
		const gagal: string[] = [];
		for (const id of ids) {
			const hasil = await hapusMasterData(sekolahId, 'pengguna', id);
			if (hasil.fail) gagal.push(hasil.fail);
			else terhapus += 1;
		}
		return {
			message: `${terhapus} akun dihapus${gagal.length ? `, ${gagal.length} gagal: ${gagal[0]}` : ''}.`
		};
	}
};
