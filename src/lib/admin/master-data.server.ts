import db from '$lib/server/db';
import {
	tableAlamat,
	tableAsesmenSumatif,
	tableAuthUser,
	tableEkstrakurikuler,
	tableKelas,
	tableMataPelajaran,
	tableMurid,
	tableMuridEkstrakurikuler,
	tablePegawai,
	tableSekolah,
	tableSemester,
	tableTahunAjaran,
	tableWaliMurid
} from '$lib/server/db/schema';
import { and, asc, count, desc, eq, inArray, ne, or, sql } from 'drizzle-orm';
import { MASTER_DATA } from '$lib/admin/master-data';
import { normalisasiBarisPerHalaman } from '$lib/utils/pagination';

export interface OpsiRelasi {
	value: number;
	label: string;
}

export type PetaRelasi = Partial<
	Record<'kelas' | 'mapel' | 'pegawai' | 'tahun_ajaran' | 'semester', OpsiRelasi[]>
>;

/** Daftar pilihan relasi yang dipakai form master data. */
export async function loadOpsiRelasi(sekolahId: number): Promise<PetaRelasi> {
	const [tahunAjaran, semester, kelas, mapel, pegawai] = await Promise.all([
		db
			.select({ id: tableTahunAjaran.id, nama: tableTahunAjaran.nama })
			.from(tableTahunAjaran)
			.where(eq(tableTahunAjaran.sekolahId, sekolahId))
			.orderBy(desc(tableTahunAjaran.nama)),
		db
			.select({
				id: tableSemester.id,
				nama: tableSemester.nama,
				tahunAjaran: tableSemester.tahunAjaranId
			})
			.from(tableSemester)
			.innerJoin(tableTahunAjaran, eq(tableSemester.tahunAjaranId, tableTahunAjaran.id))
			.where(eq(tableTahunAjaran.sekolahId, sekolahId))
			.orderBy(asc(tableTahunAjaran.nama), asc(tableSemester.tipe)),
		db
			.select({ id: tableKelas.id, nama: tableKelas.nama })
			.from(tableKelas)
			.where(eq(tableKelas.sekolahId, sekolahId))
			.orderBy(asc(tableKelas.nama)),
		db
			.select({ id: tableMataPelajaran.id, nama: tableMataPelajaran.nama })
			.from(tableMataPelajaran)
			.innerJoin(tableKelas, eq(tableMataPelajaran.kelasId, tableKelas.id))
			.where(eq(tableKelas.sekolahId, sekolahId))
			.orderBy(asc(tableMataPelajaran.nama)),
		db
			.select({ id: tablePegawai.id, nama: tablePegawai.nama })
			.from(tablePegawai)
			.where(eq(tablePegawai.sekolahId, sekolahId))
			.orderBy(asc(tablePegawai.nama))
	]);

	return {
		tahun_ajaran: tahunAjaran.map((row) => ({ value: row.id, label: row.nama })),
		semester: semester.map((row) => ({
			value: row.id,
			label: `${row.nama} (${row.tahunAjaran})`
		})),
		kelas: kelas.map((row) => ({ value: row.id, label: row.nama })),
		mapel: mapel.map((row) => ({ value: row.id, label: row.nama })),
		pegawai: pegawai.map((row) => ({ value: row.id, label: row.nama }))
	};
}

export interface BarisMaster {
	id: number;
	[key: string]: string | number | null;
}

export interface HasilBarisMaster {
	baris: BarisMaster[];
	total: number;
	totalHalaman: number;
	perHalaman: number;
}

/** Baris tabel master data untuk satu entitas (dengan pagination server-side). */
export async function loadBarisMaster(
	sekolahId: number,
	key: string,
	opsi: { q?: string | null; page?: number; perPage?: number } = {}
): Promise<HasilBarisMaster> {
	const perHalaman = normalisasiBarisPerHalaman(String(opsi.perPage ?? 50), 50);
	const page = Math.max(1, opsi.page ?? 1);
	const q = opsi.q?.trim() ?? '';
	const like = `%${q}%`;

	const semua = await muatSemuaBaris(sekolahId, key, q, like);
	const total = semua.length;
	const totalHalaman = Math.max(1, Math.ceil(total / perHalaman));
	const mulai = (page - 1) * perHalaman;
	return {
		baris: semua.slice(mulai, mulai + perHalaman),
		total,
		totalHalaman,
		perHalaman
	};
}

async function muatSemuaBaris(
	sekolahId: number,
	key: string,
	q: string,
	like: string
): Promise<BarisMaster[]> {
	switch (key) {
		case 'tahun_ajaran': {
			const rows = await db
				.select({
					id: tableTahunAjaran.id,
					nama: tableTahunAjaran.nama,
					tanggal_mulai: tableTahunAjaran.tanggalMulai,
					tanggal_selesai: tableTahunAjaran.tanggalSelesai,
					is_aktif: tableTahunAjaran.isAktif
				})
				.from(tableTahunAjaran)
				.where(
					q
						? and(eq(tableTahunAjaran.sekolahId, sekolahId), sql`tahun_ajaran.nama like ${like}`)
						: eq(tableTahunAjaran.sekolahId, sekolahId)
				)
				.orderBy(desc(tableTahunAjaran.nama));
			return rows.map((row) => ({ ...row, is_aktif: row.is_aktif ? 'Ya' : 'Tidak' }));
		}
		case 'semester': {
			const rows = await db
				.select({
					id: tableSemester.id,
					nama: tableSemester.nama,
					tahun_ajaran: sql<string>`(select ta.nama from tahun_ajaran ta where ta.id = semester.tahun_ajaran_id)`,
					tipe: tableSemester.tipe,
					tanggal_mulai: tableSemester.tanggalMulai,
					tanggal_selesai: tableSemester.tanggalSelesai,
					tanggal_bagi_raport: tableSemester.tanggalBagiRaport,
					tanggal_masuk: tableSemester.tanggalMasuk,
					is_aktif: tableSemester.isAktif
				})
				.from(tableSemester)
				.innerJoin(tableTahunAjaran, eq(tableSemester.tahunAjaranId, tableTahunAjaran.id))
				.where(eq(tableTahunAjaran.sekolahId, sekolahId))
				.orderBy(desc(tableTahunAjaran.nama), asc(tableSemester.tipe));
			return rows.map((row) => ({ ...row, is_aktif: row.is_aktif ? 'Ya' : 'Tidak' }));
		}
		case 'kelas': {
			const rows = await db
				.select({
					id: tableKelas.id,
					nama: tableKelas.nama,
					fase: tableKelas.fase,
					semester: sql<
						string | null
					>`(select s.nama from semester s where s.id = kelas.semester_id)`,
					wali_kelas: sql<
						string | null
					>`(select p.nama from pegawai p where p.id = kelas.wali_kelas_id)`,
					jumlah_murid: sql<number>`(select count(*) from murid m where m.kelas_id = kelas.id)`
				})
				.from(tableKelas)
				.where(
					q
						? and(eq(tableKelas.sekolahId, sekolahId), sql`kelas.nama like ${like}`)
						: eq(tableKelas.sekolahId, sekolahId)
				)
				.orderBy(asc(tableKelas.nama));
			return rows;
		}
		case 'mata_pelajaran': {
			const totalKelasSekolah =
				(
					await db
						.select({ count: count() })
						.from(tableKelas)
						.where(eq(tableKelas.sekolahId, sekolahId))
				)[0]?.count ?? 0;

			const rows = await db
				.select({
					id: sql<number>`min(${tableMataPelajaran.id})`,
					nama: tableMataPelajaran.nama,
					jenis: sql<string>`max(${tableMataPelajaran.jenis})`,
					kode: sql<string | null>`max(${tableMataPelajaran.kode})`,
					kkm: sql<number>`max(${tableMataPelajaran.kkm})`,
					urutan: sql<number | null>`min(${tableMataPelajaran.urutan})`,
					total_kelas: sql<number>`count(distinct ${tableKelas.id})`,
					kelas: sql<string | null>`case
						when count(distinct ${tableKelas.id}) >= ${totalKelasSekolah} and ${totalKelasSekolah} > 0
						then 'Semua Kelas (' || count(distinct ${tableKelas.id}) || ')'
						else group_concat(distinct ${tableKelas.nama})
					end`,
					pengampu: sql<string | null>`group_concat(distinct ${tablePegawai.nama})`
				})
				.from(tableMataPelajaran)
				.innerJoin(tableKelas, eq(tableMataPelajaran.kelasId, tableKelas.id))
				.leftJoin(tablePegawai, eq(tableMataPelajaran.pengampuId, tablePegawai.id))
				.where(
					q
						? and(
								eq(tableKelas.sekolahId, sekolahId),
								sql`(${tableMataPelajaran.nama} like ${like} or coalesce(${tableMataPelajaran.kode}, '') like ${like})`
							)
						: eq(tableKelas.sekolahId, sekolahId)
				)
				.groupBy(tableMataPelajaran.nama)
				.orderBy(
					sql`coalesce(min(${tableMataPelajaran.urutan}), 999)`,
					asc(tableMataPelajaran.nama)
				);

			return rows.map((r) => ({
				...r,
				kode: r.kode ?? '—',
				pengampu: r.pengampu || '—',
				kelas: r.kelas || '—'
			}));
		}
		case 'ekstrakurikuler': {
			const rows = await db
				.select({
					id: tableEkstrakurikuler.id,
					nama: tableEkstrakurikuler.nama,
					kelas_id: sql<
						string | number
					>`case when ekstrakurikuler.semua_kelas = 1 then '' else ekstrakurikuler.kelas_id end`,
					semua_kelas: tableEkstrakurikuler.semuaKelas,
					kelas: sql<
						string | null
					>`case when ekstrakurikuler.semua_kelas = 1 then 'Semua kelas' else (select k.nama from kelas k where k.id = ekstrakurikuler.kelas_id) end`,
					jumlah_anggota: sql<number>`(select count(*) from murid_ekstrakurikuler me where me.ekstrakurikuler_id = ekstrakurikuler.id)`
				})
				.from(tableEkstrakurikuler)
				.innerJoin(tableKelas, eq(tableEkstrakurikuler.kelasId, tableKelas.id))
				.where(
					q
						? and(eq(tableKelas.sekolahId, sekolahId), sql`ekstrakurikuler.nama like ${like}`)
						: eq(tableKelas.sekolahId, sekolahId)
				)
				.orderBy(asc(tableEkstrakurikuler.nama));
			return rows;
		}
		case 'pegawai': {
			const rows = await db
				.select({
					id: tablePegawai.id,
					nama: tablePegawai.nama,
					nip: tablePegawai.nip,
					nik: tablePegawai.nik,
					nuptk: tablePegawai.nuptk,
					dapodik_ptk_id: tablePegawai.dapodikPtkId
				})
				.from(tablePegawai)
				.where(
					q
						? and(eq(tablePegawai.sekolahId, sekolahId), sql`pegawai.nama like ${like}`)
						: eq(tablePegawai.sekolahId, sekolahId)
				)
				.orderBy(asc(tablePegawai.nama));
			return rows;
		}
		case 'pengguna': {
			const rows = await db
				.select({
					id: tableAuthUser.id,
					username: tableAuthUser.username,
					namaLengkap: tableAuthUser.namaLengkap,
					role: tableAuthUser.type,
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
				.where(
					q
						? sql`(lower(auth_user.username) like ${like} or lower(coalesce(auth_user.nama_lengkap, '')) like ${like})`
						: undefined
				)
				.orderBy(asc(tableAuthUser.username))
				.limit(2000);
			return rows.map((row) => ({
				...row,
				nama: row.namaLengkap ?? row.pegawaiNama ?? row.username,
				role: labelRole(row.role),
				nik_username: row.nik || row.username
			}));
		}
		case 'murid': {
			const rows = await db
				.select({
					id: tableMurid.id,
					nis: tableMurid.nis,
					nisn: tableMurid.nisn,
					nama: tableMurid.nama,
					kelas: sql<string | null>`(select k.nama from kelas k where k.id = murid.kelas_id)`,
					jk: tableMurid.jenisKelamin,
					agama: tableMurid.agama,
					tempat_lahir: tableMurid.tempatLahir,
					tanggal_lahir: tableMurid.tanggalLahir,
					tanggal_masuk: tableMurid.tanggalMasuk,
					pendidikan_sebelumnya: tableMurid.pendidikanSebelumnya,
					alamat_id: tableMurid.alamatId,
					alamat: sql<string | null>`(select a.jalan from alamat a where a.id = murid.alamat_id)`,
					ayah_nama: sql<
						string | null
					>`(select w.nama from wali_murid w where w.id = murid.ayah_id)`,
					ibu_nama: sql<string | null>`(select w.nama from wali_murid w where w.id = murid.ibu_id)`,
					wali_nama: sql<
						string | null
					>`(select w.nama from wali_murid w where w.id = murid.wali_id)`,
					wali_asuh_nama: tableMurid.waliAsuhNama,
					nik: tableMurid.nik,
					anak_ke: tableMurid.anakKe,
					status: tableMurid.status,
					tanggal_lulus: tableMurid.tanggalLulus
				})
				.from(tableMurid)
				.where(
					q
						? and(
								eq(tableMurid.sekolahId, sekolahId),
								sql`(murid.nama like ${like} or murid.nis like ${like} or murid.nisn like ${like})`
							)
						: eq(tableMurid.sekolahId, sekolahId)
				)
				.orderBy(asc(tableMurid.nama))
				.limit(2000);
			return rows.map((row) => ({
				...row,
				ayah: row.ayah_nama,
				ibu: row.ibu_nama,
				wali: row.wali_nama
			}));
		}
		case 'ortu': {
			const rows = await db
				.select({
					id: tableWaliMurid.id,
					nama: tableWaliMurid.nama,
					pekerjaan: tableWaliMurid.pekerjaan,
					kontak: tableWaliMurid.kontak,
					alamat: tableWaliMurid.alamat
				})
				.from(tableWaliMurid)
				.where(q ? sql`wali_murid.nama like ${like}` : sql`1 = 1`)
				.orderBy(asc(tableWaliMurid.nama))
				.limit(2000);
			return rows;
		}
		case 'sekolah': {
			const rows = await db
				.select({
					id: tableSekolah.id,
					nama: tableSekolah.nama,
					npsn: tableSekolah.npsn,
					email: tableSekolah.email,
					website: tableSekolah.website,
					jenjang_pendidikan: tableSekolah.jenjangPendidikan,
					jenjang_variant: tableSekolah.jenjangVariant,
					sumatif_bobot_lingkup: tableSekolah.sumatifBobotLingkup,
					sumatif_bobot_sts: tableSekolah.sumatifBobotSts,
					sumatif_bobot_sas: tableSekolah.sumatifBobotSas,
					sumatif_bobot_rts_lingkup: tableSekolah.sumatifBobotRtsLingkup,
					sumatif_bobot_rts_sts: tableSekolah.sumatifBobotRtsSts,
					rapor_kriteria_cukup: tableSekolah.raporKriteriaCukup,
					rapor_kriteria_baik: tableSekolah.raporKriteriaBaik,
					status_kepala_sekolah: tableSekolah.statusKepalaSekolah
				})
				.from(tableSekolah)
				.where(eq(tableSekolah.id, sekolahId));
			return rows;
		}
		default:
			return [];
	}
}

export interface HasilSimpan {
	message?: string;
	fail?: string;
}

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
		default:
			return 'Guru';
	}
}

function teks(formData: FormData, key: string) {
	const nilai = formData.get(key);
	return typeof nilai === 'string' ? nilai.trim() : '';
}

function angkaAtau(formData: FormData, key: string, fallback: number | null) {
	const mentah = teks(formData, key);
	if (mentah === '') return fallback;
	const nilai = Number(mentah);
	return Number.isFinite(nilai) ? nilai : fallback;
}

/**
 * Simpan data master data (tambah atau ubah).
 *
 * Validasi wajib dicek di sini; kolom yang tidak ada di form tetap utuh.
 */
export async function simpanMasterData(
	sekolahId: number,
	key: string,
	id: number | null,
	formData: FormData
): Promise<HasilSimpan> {
	const definisi = MASTER_DATA.find((item) => item.key === key);
	if (!definisi) return { fail: 'Jenis master data tidak dikenal.' };

	for (const field of definisi.fields) {
		if (field.wajib && teks(formData, field.key) === '' && field.tipe !== 'toggle') {
			return { fail: `${field.label} wajib diisi.` };
		}
	}

	const now = new Date().toISOString();

	if (definisi.formPengguna) {
		return {
			fail: 'Tambah/ubah akun pengguna dilakukan lewat form (/pengguna/form), bukan form master data.'
		};
	}

	switch (key) {
		case 'tahun_ajaran': {
			const values = {
				nama: teks(formData, 'nama'),
				tanggalMulai: teks(formData, 'tanggal_mulai') || null,
				tanggalSelesai: teks(formData, 'tanggal_selesai') || null,
				isAktif: formData.get('is_aktif') === 'on' || formData.get('is_aktif') === 'true',
				updatedAt: now
			};
			if (id) {
				await db
					.update(tableTahunAjaran)
					.set(values)
					.where(and(eq(tableTahunAjaran.id, id), eq(tableTahunAjaran.sekolahId, sekolahId)));
				return { message: 'Tahun ajaran diperbarui.' };
			}
			await db.insert(tableTahunAjaran).values({ ...values, sekolahId, createdAt: now });
			return { message: 'Tahun ajaran ditambahkan.' };
		}
		case 'semester': {
			const tahunAjaranId = Number(teks(formData, 'tahun_ajaran_id'));
			if (!tahunAjaranId) return { fail: 'Tahun ajaran wajib dipilih.' };
			const [tahunAjaran] = await db
				.select({ id: tableTahunAjaran.id })
				.from(tableTahunAjaran)
				.where(
					and(eq(tableTahunAjaran.id, tahunAjaranId), eq(tableTahunAjaran.sekolahId, sekolahId))
				);
			if (!tahunAjaran) return { fail: 'Tahun ajaran tidak valid.' };
			const values = {
				tahunAjaranId,
				tipe: (teks(formData, 'tipe') || 'ganjil') as 'ganjil' | 'genap',
				nama: teks(formData, 'nama'),
				tanggalMulai: teks(formData, 'tanggal_mulai') || null,
				tanggalSelesai: teks(formData, 'tanggal_selesai') || null,
				tanggalBagiRapor: teks(formData, 'tanggal_bagi_raport') || null,
				tanggalMasuk: teks(formData, 'tanggal_masuk') || null,
				isAktif: formData.get('is_aktif') === 'on' || formData.get('is_aktif') === 'true',
				updatedAt: now
			};
			if (id) {
				const tahunAjaranIds = (
					await db
						.select({ id: tableTahunAjaran.id })
						.from(tableTahunAjaran)
						.where(eq(tableTahunAjaran.sekolahId, sekolahId))
				).map((row) => row.id);
				if (!tahunAjaranIds.length) return { fail: 'Data tidak ditemukan di sekolah ini.' };
				await db
					.update(tableSemester)
					.set(values)
					.where(
						and(eq(tableSemester.id, id), inArray(tableSemester.tahunAjaranId, tahunAjaranIds))
					);
				return { message: 'Semester diperbarui.' };
			}
			await db.insert(tableSemester).values({ ...values, createdAt: now });
			return { message: 'Semester ditambahkan.' };
		}
		case 'kelas': {
			const tahunAjaranId = Number(teks(formData, 'tahun_ajaran_id'));
			const semesterId = Number(teks(formData, 'semester_id'));
			if (!tahunAjaranId || !semesterId) {
				return { fail: 'Tahun ajaran dan semester wajib dipilih.' };
			}
			const waliKelasId = Number(teks(formData, 'wali_kelas_id')) || null;
			const waliAsuhId = Number(teks(formData, 'wali_asuh_id')) || null;
			const values = {
				nama: teks(formData, 'nama'),
				tahunAjaranId,
				semesterId,
				fase: teks(formData, 'fase') || null,
				waliKelasId,
				waliAsuhId,
				updatedAt: now
			};
			if (id) {
				await db
					.update(tableKelas)
					.set(values)
					.where(and(eq(tableKelas.id, id), eq(tableKelas.sekolahId, sekolahId)));
				return { message: 'Kelas diperbarui.' };
			}
			await db.insert(tableKelas).values({ ...values, sekolahId, createdAt: now });
			return { message: 'Kelas ditambahkan.' };
		}
		case 'mata_pelajaran': {
			const nama = teks(formData, 'nama');
			if (!nama) return { fail: 'Nama mata pelajaran wajib diisi.' };

			const pengampuId = Number(teks(formData, 'pengampu_id')) || null;
			const jenis = (teks(formData, 'jenis') || 'wajib') as
				'belum_dipetakan' | 'wajib' | 'pilihan' | 'mulok' | 'kejuruan' | 'pemberdayaan';
			const kode = teks(formData, 'kode') || null;
			const kkm = angkaAtau(formData, 'kkm', 0) ?? 0;
			const urutan = angkaAtau(formData, 'urutan', null);

			const allSchoolKelasIds = (
				await db
					.select({ id: tableKelas.id })
					.from(tableKelas)
					.where(eq(tableKelas.sekolahId, sekolahId))
			).map((row) => row.id);

			if (!allSchoolKelasIds.length) return { fail: 'Belum ada kelas terdaftar di sekolah ini.' };

			// Modal multi-kelas mengirim `kelas_ids` berulang dan tidak lagi me-render
			// input `kelas_id`. Karena itu "semua kelas" tidak boleh ditebak dari
			// `kelas_id` kosong — kalau begitu pilihan sebagian selalu melebar ke
			// seluruh kelas sekolah dan pembersihan mapel yatap tidak pernah jalan.
			const rawSelectedIds = [
				...new Set(
					formData
						.getAll('kelas_ids')
						.map((kId) => Number(kId))
						.filter((kId) => Number.isInteger(kId) && allSchoolKelasIds.includes(kId))
				)
			];
			const semuaKelasToggle =
				formData.get('semua_kelas') === '1' || formData.get('semua_kelas') === 'on';
			const kelasIdLegacy = teks(formData, 'kelas_id');
			const kelasIdTunggal = Number(kelasIdLegacy) || 0;

			let targetKelasIds: number[] = [];
			if (rawSelectedIds.length > 0) {
				targetKelasIds = rawSelectedIds;
			} else if (semuaKelasToggle || kelasIdLegacy === 'semua') {
				targetKelasIds = allSchoolKelasIds;
			} else if (kelasIdTunggal) {
				targetKelasIds = [kelasIdTunggal];
			}

			if (!targetKelasIds.length) {
				return { fail: 'Pilih minimal satu kelas tujuan untuk mata pelajaran ini.' };
			}

			const semuaKelas = targetKelasIds.length === allSchoolKelasIds.length;

			for (const kId of targetKelasIds) {
				const existing = await db.query.tableMataPelajaran.findFirst({
					where: and(eq(tableMataPelajaran.kelasId, kId), eq(tableMataPelajaran.nama, nama))
				});
				if (existing) {
					await db
						.update(tableMataPelajaran)
						.set({ jenis, kode, kkm, urutan, pengampuId, updatedAt: now })
						.where(eq(tableMataPelajaran.id, existing.id));
				} else {
					await db.insert(tableMataPelajaran).values({
						kelasId: kId,
						nama,
						jenis,
						kode,
						kkm,
						urutan,
						pengampuId,
						createdAt: now
					});
				}
			}

			if (id && !semuaKelas) {
				const unselectedKelasIds = allSchoolKelasIds.filter((kId) => !targetKelasIds.includes(kId));
				if (unselectedKelasIds.length > 0) {
					const orphanedMapels = await db
						.select({ id: tableMataPelajaran.id })
						.from(tableMataPelajaran)
						.where(
							and(
								eq(tableMataPelajaran.nama, nama),
								inArray(tableMataPelajaran.kelasId, unselectedKelasIds)
							)
						);
					const orphanIds = orphanedMapels.map((m) => m.id);
					if (orphanIds.length > 0) {
						const [{ nScores }] = await db
							.select({ nScores: count() })
							.from(tableAsesmenSumatif)
							.where(inArray(tableAsesmenSumatif.mataPelajaranId, orphanIds));
						if (nScores === 0) {
							await db.delete(tableMataPelajaran).where(inArray(tableMataPelajaran.id, orphanIds));
						}
					}
				}
			}

			const ketKelas =
				targetKelasIds.length === allSchoolKelasIds.length
					? 'semua kelas'
					: `${targetKelasIds.length} kelas terpilih`;
			return { message: `Mata pelajaran "${nama}" berhasil disimpan untuk ${ketKelas}.` };
		}
		case 'ekstrakurikuler': {
			const kelasRaw = teks(formData, 'kelas_id');
			const semuaKelas = kelasRaw === '' ? 1 : 0;
			const nama = teks(formData, 'nama');
			if (!nama) return { fail: 'Nama ekstrakurikuler wajib diisi.' };

			// Kelas acuan: kelas yang dipilih, atau kelas pertama sekolah untuk ekstra umum.
			let kelasId = Number(kelasRaw) || null;
			if (kelasId) {
				const kelas = await db.query.tableKelas.findFirst({
					columns: { id: true },
					where: and(eq(tableKelas.id, kelasId), eq(tableKelas.sekolahId, sekolahId))
				});
				if (!kelas) return { fail: 'Kelas tidak valid.' };
			} else {
				const [pertama] = await db
					.select({ id: tableKelas.id })
					.from(tableKelas)
					.where(eq(tableKelas.sekolahId, sekolahId))
					.orderBy(asc(tableKelas.nama))
					.limit(1);
				if (!pertama) return { fail: 'Belum ada kelas di sekolah ini.' };
				kelasId = pertama.id;
			}

			const bentrok = await db
				.select({ id: tableEkstrakurikuler.id })
				.from(tableEkstrakurikuler)
				.innerJoin(tableKelas, eq(tableEkstrakurikuler.kelasId, tableKelas.id))
				.where(
					and(
						eq(tableKelas.sekolahId, sekolahId),
						semuaKelas
							? eq(tableEkstrakurikuler.semuaKelas, 1)
							: and(
									eq(tableEkstrakurikuler.semuaKelas, 0),
									eq(tableEkstrakurikuler.kelasId, kelasId)
								),
						sql`lower(trim(ekstrakurikuler.nama)) = ${nama.toLowerCase()}`,
						id ? sql`ekstrakurikuler.id <> ${id}` : undefined
					)
				)
				.limit(1);
			if (bentrok.length) {
				return {
					fail: semuaKelas
						? 'Nama ekstrakurikuler sudah dipakai ekstrakurikuler umum lain.'
						: 'Nama ekstrakurikuler sudah ada di kelas ini.'
				};
			}

			const values = { nama, kelasId, semuaKelas, updatedAt: now };
			if (id) {
				const kelasIds = (
					await db
						.select({ id: tableKelas.id })
						.from(tableKelas)
						.where(eq(tableKelas.sekolahId, sekolahId))
				).map((row) => row.id);
				if (!kelasIds.length) return { fail: 'Data tidak ditemukan di sekolah ini.' };
				await db
					.update(tableEkstrakurikuler)
					.set(values)
					.where(
						and(eq(tableEkstrakurikuler.id, id), inArray(tableEkstrakurikuler.kelasId, kelasIds))
					);
				return { message: 'Ekstrakurikuler diperbarui.' };
			}
			await db.insert(tableEkstrakurikuler).values({ ...values, createdAt: now });
			return { message: 'Ekstrakurikuler ditambahkan.' };
		}
		case 'pegawai': {
			const values = {
				nama: teks(formData, 'nama'),
				nip: teks(formData, 'nip'),
				nik: teks(formData, 'nik') || null,
				nuptk: teks(formData, 'nuptk') || null,
				dapodikPtkId: teks(formData, 'dapodik_ptk_id') || null,
				updatedAt: now
			};
			if (id) {
				await db
					.update(tablePegawai)
					.set(values)
					.where(and(eq(tablePegawai.id, id), eq(tablePegawai.sekolahId, sekolahId)));
				return { message: 'Data pegawai diperbarui.' };
			}
			await db.insert(tablePegawai).values({ ...values, sekolahId, createdAt: now });
			return { message: 'Data pegawai ditambahkan.' };
		}
		case 'murid': {
			const kelasId = Number(teks(formData, 'kelas_id'));
			if (!kelasId) return { fail: 'Kelas wajib dipilih.' };
			const kelas = await db.query.tableKelas.findFirst({
				columns: { id: true, semesterId: true },
				where: and(eq(tableKelas.id, kelasId), eq(tableKelas.sekolahId, sekolahId))
			});
			if (!kelas) return { fail: 'Kelas tidak valid.' };

			// Alamat: pakai baris yang sudah ada, atau buat baru bila diisi.
			const alamatIdLama = Number(teks(formData, 'alamat_id')) || null;
			const alamatTeks = teks(formData, 'alamat');
			let alamatId = alamatIdLama;
			if (alamatTeks) {
				if (alamatIdLama) {
					await db
						.update(tableAlamat)
						.set({ jalan: alamatTeks, updatedAt: now })
						.where(eq(tableAlamat.id, alamatIdLama));
				} else {
					const [alamatBaru] = await db
						.insert(tableAlamat)
						.values({
							jalan: alamatTeks,
							desa: '-',
							kecamatan: '-',
							kabupaten: '-',
							createdAt: now,
							updatedAt: now
						})
						.returning({ id: tableAlamat.id });
					alamatId = alamatBaru?.id ?? null;
				}
			}

			// Ayah/ibu/wali: pakai baris yang ada dengan nama sama, atau buat baru.
			const resolusiWali = async (nama: string) => {
				if (!nama) return null;
				const [ada] = await db
					.select({ id: tableWaliMurid.id })
					.from(tableWaliMurid)
					.where(sql`lower(trim(wali_murid.nama)) = ${nama.toLowerCase()}`)
					.limit(1);
				if (ada) return ada.id;
				const [baru] = await db
					.insert(tableWaliMurid)
					.values({ nama, pekerjaan: '-', createdAt: now, updatedAt: now })
					.returning({ id: tableWaliMurid.id });
				return baru?.id ?? null;
			};
			const ayahId = await resolusiWali(teks(formData, 'ayah_nama'));
			const ibuId = await resolusiWali(teks(formData, 'ibu_nama'));
			const waliId = await resolusiWali(teks(formData, 'wali_nama'));

			const values = {
				nis: teks(formData, 'nis'),
				nisn: teks(formData, 'nisn'),
				nama: teks(formData, 'nama'),
				kelasId,
				semesterId: kelas.semesterId,
				jenisKelamin: (teks(formData, 'jenis_kelamin') || 'L') as 'L' | 'P',
				agama: teks(formData, 'agama') || '-',
				tempatLahir: teks(formData, 'tempat_lahir') || '-',
				tanggalLahir: teks(formData, 'tanggal_lahir'),
				tanggalMasuk: teks(formData, 'tanggal_masuk'),
				pendidikanSebelumnya: teks(formData, 'pendidikan_sebelumnya') || '-',
				alamatId: alamatId ?? alamatIdLama ?? 0,
				ayahId,
				ibuId,
				waliId,
				waliAsuhNama: teks(formData, 'wali_asuh_nama') || null,
				nik: teks(formData, 'nik') || null,
				anakKe: angkaAtau(formData, 'anak_ke', null),
				status: (teks(formData, 'status') || 'aktif') as 'aktif' | 'lulus' | 'pindah' | 'keluar',
				tanggalLulus: teks(formData, 'tanggal_lulus') || null,
				updatedAt: now
			};

			if (id) {
				await db
					.update(tableMurid)
					.set(values)
					.where(and(eq(tableMurid.id, id), eq(tableMurid.sekolahId, sekolahId)));
				return { message: 'Data murid diperbarui.' };
			}
			await db.insert(tableMurid).values({ ...values, sekolahId, createdAt: now });
			return { message: 'Data murid ditambahkan.' };
		}
		case 'ortu': {
			const values = {
				nama: teks(formData, 'nama'),
				pekerjaan: teks(formData, 'pekerjaan') || '-',
				kontak: teks(formData, 'kontak') || null,
				alamat: teks(formData, 'alamat') || null,
				updatedAt: now
			};
			if (id) {
				await db.update(tableWaliMurid).set(values).where(eq(tableWaliMurid.id, id));
				return { message: 'Data orang tua/wali diperbarui.' };
			}
			await db.insert(tableWaliMurid).values({ ...values, createdAt: now });
			return { message: 'Data orang tua/wali ditambahkan.' };
		}
		case 'sekolah': {
			const values = {
				nama: teks(formData, 'nama'),
				npsn: teks(formData, 'npsn'),
				email: teks(formData, 'email') || '-',
				website: teks(formData, 'website') || null,
				jenjangPendidikan: (teks(formData, 'jenjang_pendidikan') || 'sma') as
					'sd' | 'smp' | 'sma' | 'slb' | 'pkbm' | 'srt',
				jenjangVariant: teks(formData, 'jenjang_variant') || null,
				raporKriteriaCukup: angkaAtau(formData, 'rapor_kriteria_cukup', 85) ?? 85,
				raporKriteriaBaik: angkaAtau(formData, 'rapor_kriteria_baik', 95) ?? 95,
				statusKepalaSekolah: (teks(formData, 'status_kepala_sekolah') || 'definitif') as
					'definitif' | 'plt',
				updatedAt: now
			};
			await db.update(tableSekolah).set(values).where(eq(tableSekolah.id, sekolahId));
			return { message: 'Profil & konfigurasi sekolah diperbarui.' };
		}
		default:
			return { fail: 'Jenis master data belum mendukung penyimpanan.' };
	}
}

export interface KelasDenganMurid {
	id: number;
	nama: string;
	semesterId: number;
	semesterNama: string;
	murid: Array<{ id: number; nama: string; nis: string }>;
}

/** Daftar kelas beserta muridnya (untuk fitur pindah murid antar kelas). */
export async function loadDaftarKelasMurid(sekolahId: number): Promise<KelasDenganMurid[]> {
	const kelas = await db
		.select({
			id: tableKelas.id,
			nama: tableKelas.nama,
			semesterId: tableKelas.semesterId,
			semesterNama: tableSemester.nama
		})
		.from(tableKelas)
		.innerJoin(tableSemester, eq(tableKelas.semesterId, tableSemester.id))
		.where(eq(tableKelas.sekolahId, sekolahId))
		.orderBy(asc(tableKelas.nama));

	const murid = await db
		.select({
			id: tableMurid.id,
			nama: tableMurid.nama,
			nis: tableMurid.nis,
			kelasId: tableMurid.kelasId
		})
		.from(tableMurid)
		.where(eq(tableMurid.sekolahId, sekolahId))
		.orderBy(asc(tableMurid.nama));

	const perKelas = new Map<number, Array<{ id: number; nama: string; nis: string }>>();
	for (const row of murid) {
		const list = perKelas.get(row.kelasId) ?? [];
		list.push({ id: row.id, nama: row.nama, nis: row.nis });
		perKelas.set(row.kelasId, list);
	}

	return kelas.map((row) => ({
		id: row.id,
		nama: row.nama,
		semesterId: row.semesterId,
		semesterNama: row.semesterNama,
		murid: perKelas.get(row.id) ?? []
	}));
}

/**
 * Tambah banyak baris sekaligus untuk satu entitas (mis. satu mata pelajaran
 * untuk beberapa kelas). Baris yang sudah ada dilewati.
 */
export async function simpanMasterDataMassal(
	sekolahId: number,
	key: string,
	formData: FormData
): Promise<HasilSimpan> {
	if (key !== 'mata_pelajaran') {
		return { fail: 'Tambah massal baru tersedia untuk mata pelajaran.' };
	}
	const nama = teks(formData, 'nama');
	if (!nama) return { fail: 'Nama mata pelajaran wajib diisi.' };
	const kelasIds = [
		...new Set(
			formData
				.getAll('kelas_ids')
				.map((value) => Number(value))
				.filter((value) => Number.isInteger(value) && value > 0)
		)
	];
	if (!kelasIds.length) return { fail: 'Pilih minimal satu kelas.' };

	const kelasValid = (
		await db
			.select({ id: tableKelas.id })
			.from(tableKelas)
			.where(and(eq(tableKelas.sekolahId, sekolahId), inArray(tableKelas.id, kelasIds)))
	).map((row) => row.id);
	if (!kelasValid.length) return { fail: 'Kelas yang dipilih tidak valid.' };

	const sudahAda = new Set(
		(
			await db
				.select({ kelasId: tableMataPelajaran.kelasId })
				.from(tableMataPelajaran)
				.where(
					and(
						inArray(tableMataPelajaran.kelasId, kelasValid),
						sql`lower(mata_pelajaran.nama) = ${nama.toLowerCase()}`
					)
				)
		).map((row) => row.kelasId)
	);

	const now = new Date().toISOString();
	const pengampuId = Number(teks(formData, 'pengampu_id')) || null;
	const jenis = (teks(formData, 'jenis') || 'wajib') as
		'belum_dipetakan' | 'wajib' | 'pilihan' | 'mulok' | 'kejuruan' | 'pemberdayaan';
	const kode = teks(formData, 'kode') || null;
	const kkm = angkaAtau(formData, 'kkm', 0) ?? 0;
	const urutan = angkaAtau(formData, 'urutan', null);

	let dibuat = 0;
	let dilewati = 0;
	for (const kelasId of kelasValid) {
		if (sudahAda.has(kelasId)) {
			dilewati += 1;
			continue;
		}
		await db.insert(tableMataPelajaran).values({
			kelasId,
			nama,
			jenis,
			kode,
			kkm,
			urutan,
			pengampuId,
			createdAt: now,
			updatedAt: now
		});
		dibuat += 1;
	}

	return {
		message: `${dibuat} mata pelajaran ditambahkan${dilewati ? `, ${dilewati} kelas sudah punya mapel ini` : ''}.`
	};
}

/**
 * Ubah kelas massal untuk beberapa mata pelajaran sekaligus.
 * Bisa menambah kelas tujuan atau mengganti seluruh set kelas.
 */
export async function ubahKelasMasterMassal(
	sekolahId: number,
	formData: FormData
): Promise<HasilSimpan> {
	const mentahIds = String(formData.get('ids') ?? '[]');
	let ids: number[] = [];
	try {
		const parsed = JSON.parse(mentahIds);
		if (Array.isArray(parsed)) {
			ids = [
				...new Set(
					parsed.map((val) => Number(val)).filter((val) => Number.isInteger(val) && val > 0)
				)
			];
		}
	} catch {
		return { fail: 'Data pilihan tidak valid.' };
	}

	if (!ids.length) {
		return { fail: 'Tidak ada data yang dipilih.' };
	}

	const mode = formData.get('mode');
	if (mode !== 'tambah' && mode !== 'ganti') {
		return { fail: 'Mode ubah kelas tidak valid.' };
	}

	const rawKelasIds = [
		...new Set(
			formData
				.getAll('kelas_ids')
				.map((val) => Number(val))
				.filter((val) => Number.isInteger(val) && val > 0)
		)
	];

	if (!rawKelasIds.length) {
		return { fail: 'Pilih minimal satu kelas tujuan.' };
	}

	const validKelasIds = (
		await db
			.select({ id: tableKelas.id })
			.from(tableKelas)
			.where(and(eq(tableKelas.sekolahId, sekolahId), inArray(tableKelas.id, rawKelasIds)))
	).map((row) => row.id);

	if (!validKelasIds.length) {
		return { fail: 'Pilih minimal satu kelas tujuan.' };
	}

	// Resolve selected IDs to distinct names belonging to this school
	const resolvedMapel = await db
		.select({
			id: tableMataPelajaran.id,
			nama: tableMataPelajaran.nama
		})
		.from(tableMataPelajaran)
		.innerJoin(tableKelas, eq(tableMataPelajaran.kelasId, tableKelas.id))
		.where(and(eq(tableKelas.sekolahId, sekolahId), inArray(tableMataPelajaran.id, ids)));

	const distinctNama = [...new Set(resolvedMapel.map((m) => m.nama))];
	if (!distinctNama.length) {
		return { fail: 'Tidak ada data yang dipilih.' };
	}

	const now = new Date().toISOString();
	let totalDitambahkan = 0;
	let totalDikeluarkan = 0;
	let totalDiperbarui = 0;

	for (const nama of distinctNama) {
		// Existing rows for this mapel name across this school
		const existingRows = await db
			.select({
				id: tableMataPelajaran.id,
				kelasId: tableMataPelajaran.kelasId,
				jenis: tableMataPelajaran.jenis,
				kode: tableMataPelajaran.kode,
				kkm: tableMataPelajaran.kkm,
				urutan: tableMataPelajaran.urutan,
				pengampuId: tableMataPelajaran.pengampuId
			})
			.from(tableMataPelajaran)
			.innerJoin(tableKelas, eq(tableMataPelajaran.kelasId, tableKelas.id))
			.where(and(eq(tableKelas.sekolahId, sekolahId), eq(tableMataPelajaran.nama, nama)));

		if (!existingRows.length) continue;

		const templateRow = existingRows[0];
		const currentKelasIds = new Set(existingRows.map((r) => r.kelasId));
		let perMapelInserted = 0;
		let perMapelDeleted = 0;

		if (mode === 'tambah') {
			for (const targetKelasId of validKelasIds) {
				if (!currentKelasIds.has(targetKelasId)) {
					await db.insert(tableMataPelajaran).values({
						kelasId: targetKelasId,
						nama,
						jenis: templateRow.jenis,
						kode: templateRow.kode,
						kkm: templateRow.kkm,
						urutan: templateRow.urutan,
						pengampuId: templateRow.pengampuId,
						createdAt: now,
						updatedAt: now
					});
					perMapelInserted += 1;
				}
			}
		} else {
			// mode === 'ganti'
			const chosenSet = new Set(validKelasIds);

			// Insert missing
			for (const targetKelasId of validKelasIds) {
				if (!currentKelasIds.has(targetKelasId)) {
					await db.insert(tableMataPelajaran).values({
						kelasId: targetKelasId,
						nama,
						jenis: templateRow.jenis,
						kode: templateRow.kode,
						kkm: templateRow.kkm,
						urutan: templateRow.urutan,
						pengampuId: templateRow.pengampuId,
						createdAt: now,
						updatedAt: now
					});
					perMapelInserted += 1;
				}
			}

			// Delete rows in kelas not chosen, guarded by asesmen_sumatif count
			const orphanRows = existingRows.filter((r) => !chosenSet.has(r.kelasId));
			for (const orphan of orphanRows) {
				const [{ nScores } = { nScores: 0 }] = await db
					.select({ nScores: count() })
					.from(tableAsesmenSumatif)
					.where(eq(tableAsesmenSumatif.mataPelajaranId, orphan.id));

				if (nScores === 0) {
					await db.delete(tableMataPelajaran).where(eq(tableMataPelajaran.id, orphan.id));
					perMapelDeleted += 1;
				}
			}
		}

		totalDitambahkan += perMapelInserted;
		totalDikeluarkan += perMapelDeleted;
		totalDiperbarui += 1;
	}

	const detail: string[] = [];
	if (totalDitambahkan > 0) detail.push(`+${totalDitambahkan} kelas ditambahkan`);
	if (totalDikeluarkan > 0) detail.push(`${totalDikeluarkan} dikeluarkan`);
	const detailStr = detail.length > 0 ? ` (${detail.join(', ')})` : '';

	return {
		message: `${totalDiperbarui} mata pelajaran diperbarui${detailStr}.`
	};
}

/** Hapus data master data dengan pengaman terhadap data yang masih dipakai. */
export async function hapusMasterData(
	sekolahId: number,
	key: string,
	id: number
): Promise<HasilSimpan> {
	switch (key) {
		case 'tahun_ajaran': {
			const [{ n } = { n: 0 }] = await db
				.select({ n: count() })
				.from(tableKelas)
				.where(eq(tableKelas.tahunAjaranId, id));
			if (n > 0) {
				return { fail: `Tahun ajaran masih dipakai ${n} kelas. Hapus kelasnya lebih dulu.` };
			}
			await db
				.delete(tableTahunAjaran)
				.where(and(eq(tableTahunAjaran.id, id), eq(tableTahunAjaran.sekolahId, sekolahId)));
			return { message: 'Tahun ajaran dihapus.' };
		}
		case 'semester': {
			const [{ n } = { n: 0 }] = await db
				.select({ n: count() })
				.from(tableKelas)
				.where(eq(tableKelas.semesterId, id));
			if (n > 0) {
				return { fail: `Semester masih dipakai ${n} kelas. Hapus kelasnya lebih dulu.` };
			}
			await db.delete(tableSemester).where(eq(tableSemester.id, id));
			return { message: 'Semester dihapus.' };
		}
		case 'kelas': {
			const [{ n } = { n: 0 }] = await db
				.select({ n: count() })
				.from(tableMurid)
				.where(eq(tableMurid.kelasId, id));
			if (n > 0) {
				return { fail: `Kelas masih memiliki ${n} murid. Pindahkan muridnya lebih dulu.` };
			}
			const [{ n: nMapel } = { n: 0 }] = await db
				.select({ n: count() })
				.from(tableMataPelajaran)
				.where(eq(tableMataPelajaran.kelasId, id));
			if (nMapel > 0) {
				return {
					fail: `Kelas masih memiliki ${nMapel} mata pelajaran. Hapus mapelnya lebih dulu.`
				};
			}
			// Ekstrakurikuler khusus kelas diblokir; ekstrakurikuler umum dipindah ke kelas lain.
			const [{ n: nEkstraKhusus } = { n: 0 }] = await db
				.select({ n: count() })
				.from(tableEkstrakurikuler)
				.where(and(eq(tableEkstrakurikuler.kelasId, id), eq(tableEkstrakurikuler.semuaKelas, 0)));
			if (nEkstraKhusus > 0) {
				return {
					fail: `Kelas masih memiliki ${nEkstraKhusus} ekstrakurikuler. Hapus ekstrakurikulernya lebih dulu.`
				};
			}
			const [{ n: nEkstraUmum } = { n: 0 }] = await db
				.select({ n: count() })
				.from(tableEkstrakurikuler)
				.where(and(eq(tableEkstrakurikuler.kelasId, id), eq(tableEkstrakurikuler.semuaKelas, 1)));
			if (nEkstraUmum > 0) {
				const [pengganti] = await db
					.select({ id: tableKelas.id })
					.from(tableKelas)
					.where(and(eq(tableKelas.sekolahId, sekolahId), ne(tableKelas.id, id)))
					.orderBy(asc(tableKelas.nama))
					.limit(1);
				if (!pengganti) {
					return { fail: 'Kelas tidak bisa dihapus karena dipakai ekstrakurikuler umum.' };
				}
				await db
					.update(tableEkstrakurikuler)
					.set({ kelasId: pengganti.id })
					.where(and(eq(tableEkstrakurikuler.kelasId, id), eq(tableEkstrakurikuler.semuaKelas, 1)));
			}
			await db
				.delete(tableKelas)
				.where(and(eq(tableKelas.id, id), eq(tableKelas.sekolahId, sekolahId)));
			return { message: 'Kelas dihapus.' };
		}
		case 'mata_pelajaran': {
			const target = await db.query.tableMataPelajaran.findFirst({
				where: eq(tableMataPelajaran.id, id),
				columns: { id: true, nama: true }
			});
			if (!target) return { fail: 'Mata pelajaran tidak ditemukan.' };

			const kelasIds = (
				await db
					.select({ id: tableKelas.id })
					.from(tableKelas)
					.where(eq(tableKelas.sekolahId, sekolahId))
			).map((r) => r.id);

			const matchingMapels = await db
				.select({ id: tableMataPelajaran.id })
				.from(tableMataPelajaran)
				.where(
					and(
						eq(tableMataPelajaran.nama, target.nama),
						inArray(tableMataPelajaran.kelasId, kelasIds)
					)
				);
			const matchingIds = matchingMapels.map((m) => m.id);

			const [{ n } = { n: 0 }] = await db
				.select({ n: count() })
				.from(tableAsesmenSumatif)
				.where(inArray(tableAsesmenSumatif.mataPelajaranId, matchingIds));

			if (n > 0) {
				return {
					fail: `Mata pelajaran "${target.nama}" sudah memiliki ${n} data nilai. Hapus nilainya lebih dulu.`
				};
			}

			await db.delete(tableMataPelajaran).where(inArray(tableMataPelajaran.id, matchingIds));
			return { message: `Mata pelajaran "${target.nama}" berhasil dihapus.` };
		}
		case 'ekstrakurikuler': {
			const ekstra = await db
				.select({ id: tableEkstrakurikuler.id })
				.from(tableEkstrakurikuler)
				.innerJoin(tableKelas, eq(tableEkstrakurikuler.kelasId, tableKelas.id))
				.where(and(eq(tableEkstrakurikuler.id, id), eq(tableKelas.sekolahId, sekolahId)))
				.limit(1);
			if (!ekstra.length) return { fail: 'Ekstrakurikuler tidak ditemukan.' };
			await db.delete(tableEkstrakurikuler).where(eq(tableEkstrakurikuler.id, id));
			return { message: 'Ekstrakurikuler dihapus.' };
		}
		case 'pengguna': {
			const akun = await db.query.tableAuthUser.findFirst({
				columns: { id: true, username: true, type: true, pegawaiId: true },
				where: eq(tableAuthUser.id, id)
			});
			if (!akun) return { fail: 'Akun pengguna tidak ditemukan.' };
			if (akun.id === 1 || akun.username.trim().toLowerCase() === 'admin') {
				return { fail: 'Akun Admin utama tidak dapat dihapus.' };
			}
			if (akun.pegawaiId) {
				const kepalaSekolah = await db
					.select({ id: tableSekolah.id })
					.from(tableSekolah)
					.where(eq(tableSekolah.kepalaSekolahId, akun.pegawaiId))
					.limit(1);
				if (kepalaSekolah.length) {
					return {
						fail: 'Akun ini adalah kepala sekolah. Ganti kepala sekolahnya lebih dulu.'
					};
				}
				const waliKelas = await db
					.select({ id: tableKelas.id })
					.from(tableKelas)
					.where(eq(tableKelas.waliKelasId, akun.pegawaiId))
					.limit(1);
				if (waliKelas.length) {
					return {
						fail: 'Akun masih menjadi wali kelas. Ganti wali kelasnya lebih dulu.'
					};
				}
			}
			await db.delete(tableAuthUser).where(eq(tableAuthUser.id, id));
			return { message: `Akun ${akun.username} dihapus.` };
		}
		case 'pegawai': {
			const dipakaiKepala = await db
				.select({ id: tableSekolah.id })
				.from(tableSekolah)
				.where(eq(tableSekolah.kepalaSekolahId, id))
				.limit(1);
			if (dipakaiKepala.length) {
				return { fail: 'Guru ini adalah kepala sekolah. Ganti kepala sekolahnya lebih dulu.' };
			}
			const dipakaiKelas = await db
				.select({ id: tableKelas.id })
				.from(tableKelas)
				.where(eq(tableKelas.waliKelasId, id))
				.limit(1);
			if (dipakaiKelas.length) {
				return { fail: 'Guru masih menjadi wali kelas. Ganti wali kelasnya lebih dulu.' };
			}
			const dipakaiAsuh = await db
				.select({ id: tableKelas.id })
				.from(tableKelas)
				.where(eq(tableKelas.waliAsuhId, id))
				.limit(1);
			if (dipakaiAsuh.length) {
				return { fail: 'Guru masih menjadi wali asuh. Ganti wali asuhnya lebih dulu.' };
			}
			const dipakaiMapel = await db
				.select({ id: tableMataPelajaran.id })
				.from(tableMataPelajaran)
				.where(eq(tableMataPelajaran.pengampuId, id))
				.limit(1);
			if (dipakaiMapel.length) {
				return { fail: 'Guru masih mengampu mata pelajaran. Ganti pengampunya lebih dulu.' };
			}
			const dipakaiAkun = await db
				.select({ id: tableAuthUser.id })
				.from(tableAuthUser)
				.where(eq(tableAuthUser.pegawaiId, id))
				.limit(1);
			if (dipakaiAkun.length) {
				return { fail: 'Guru ini punya akun pengguna. Hapus atau ganti akunnya lebih dulu.' };
			}
			await db
				.delete(tablePegawai)
				.where(and(eq(tablePegawai.id, id), eq(tablePegawai.sekolahId, sekolahId)));
			return { message: 'Data pegawai dihapus.' };
		}
		case 'murid': {
			await db
				.delete(tableMurid)
				.where(and(eq(tableMurid.id, id), eq(tableMurid.sekolahId, sekolahId)));
			return { message: 'Data murid dihapus (nilai & absensinya ikut terhapus).' };
		}
		case 'ortu': {
			const dipakai = await db
				.select({ id: tableMurid.id })
				.from(tableMurid)
				.where(or(eq(tableMurid.ayahId, id), eq(tableMurid.ibuId, id), eq(tableMurid.waliId, id)))
				.limit(1);
			if (dipakai.length) {
				return { fail: 'Data ini masih dipakai murid. Ganti orang tuanya lebih dulu.' };
			}
			await db.delete(tableWaliMurid).where(eq(tableWaliMurid.id, id));
			return { message: 'Data orang tua/wali dihapus.' };
		}
		case 'sekolah':
			return { fail: 'Data sekolah tidak bisa dihapus dari sini.' };
		default:
			return { fail: 'Jenis master data ini belum mendukung penghapusan.' };
	}
}

export interface DataAnggotaEkstrakurikuler {
	murid: Array<{ id: number; nama: string; nis: string; kelasId: number; kelasNama: string }>;
	kelas: Array<{ id: number; nama: string }>;
	anggota: Record<number, number[]>;
}

/** Data pendukung modal anggota ekstrakurikuler: murid, kelas, dan peta anggota. */
export async function loadAnggotaEkstrakurikuler(
	sekolahId: number
): Promise<DataAnggotaEkstrakurikuler> {
	const [muridRows, kelasRows, ekstraRows] = await Promise.all([
		db
			.select({
				id: tableMurid.id,
				nama: tableMurid.nama,
				nis: tableMurid.nis,
				kelasId: tableMurid.kelasId,
				kelasNama: tableKelas.nama
			})
			.from(tableMurid)
			.innerJoin(tableKelas, eq(tableMurid.kelasId, tableKelas.id))
			.where(eq(tableMurid.sekolahId, sekolahId))
			.orderBy(asc(tableMurid.nama)),
		db
			.select({ id: tableKelas.id, nama: tableKelas.nama })
			.from(tableKelas)
			.where(eq(tableKelas.sekolahId, sekolahId))
			.orderBy(asc(tableKelas.nama)),
		db
			.select({ id: tableEkstrakurikuler.id })
			.from(tableEkstrakurikuler)
			.innerJoin(tableKelas, eq(tableEkstrakurikuler.kelasId, tableKelas.id))
			.where(eq(tableKelas.sekolahId, sekolahId))
	]);

	const ekstraIds = ekstraRows.map((row) => row.id);
	const anggotaRows = ekstraIds.length
		? await db
				.select({
					muridId: tableMuridEkstrakurikuler.muridId,
					ekstrakurikulerId: tableMuridEkstrakurikuler.ekstrakurikulerId
				})
				.from(tableMuridEkstrakurikuler)
				.where(inArray(tableMuridEkstrakurikuler.ekstrakurikulerId, ekstraIds))
		: [];

	const anggota: Record<number, number[]> = {};
	for (const ekstraId of ekstraIds) anggota[ekstraId] = [];
	for (const row of anggotaRows) anggota[row.ekstrakurikulerId]?.push(row.muridId);

	return { murid: muridRows, kelas: kelasRows, anggota };
}

/** Ganti daftar anggota satu ekstrakurikuler. Murid harus dari sekolah yang sama. */
export async function simpanAnggotaEkstrakurikuler(
	sekolahId: number,
	ekstrakurikulerId: number,
	muridIds: number[]
): Promise<HasilSimpan> {
	const ekstra = await db
		.select({ id: tableEkstrakurikuler.id, nama: tableEkstrakurikuler.nama })
		.from(tableEkstrakurikuler)
		.innerJoin(tableKelas, eq(tableEkstrakurikuler.kelasId, tableKelas.id))
		.where(and(eq(tableEkstrakurikuler.id, ekstrakurikulerId), eq(tableKelas.sekolahId, sekolahId)))
		.limit(1);
	if (!ekstra.length) return { fail: 'Ekstrakurikuler tidak ditemukan.' };

	const validIds = muridIds.length
		? (
				await db
					.select({ id: tableMurid.id })
					.from(tableMurid)
					.where(and(eq(tableMurid.sekolahId, sekolahId), inArray(tableMurid.id, muridIds)))
			).map((row) => row.id)
		: [];

	try {
		await db.transaction(async (tx) => {
			const lama = await tx
				.select({ muridId: tableMuridEkstrakurikuler.muridId })
				.from(tableMuridEkstrakurikuler)
				.where(eq(tableMuridEkstrakurikuler.ekstrakurikulerId, ekstrakurikulerId));
			const lamaSet = new Set(lama.map((row) => row.muridId));
			const baruSet = new Set(validIds);
			const hapus = [...lamaSet].filter((muridId) => !baruSet.has(muridId));
			const tambah = validIds.filter((muridId) => !lamaSet.has(muridId));

			if (hapus.length) {
				await tx
					.delete(tableMuridEkstrakurikuler)
					.where(
						and(
							eq(tableMuridEkstrakurikuler.ekstrakurikulerId, ekstrakurikulerId),
							inArray(tableMuridEkstrakurikuler.muridId, hapus)
						)
					);
			}
			if (tambah.length) {
				await tx
					.insert(tableMuridEkstrakurikuler)
					.values(tambah.map((muridId) => ({ muridId, ekstrakurikulerId })));
			}
		});
	} catch (error) {
		return { fail: error instanceof Error ? error.message : 'Gagal menyimpan anggota.' };
	}

	return { message: `Anggota ${ekstra[0].nama} disimpan (${validIds.length} murid).` };
}
