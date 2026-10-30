import db from '$lib/server/db';
import {
	tablePklPerusahaan,
	tablePklKelompok,
	tablePklMurid,
	tablePklTujuan,
	tableMurid,
	tableKelas,
	tablePegawai
} from '$lib/server/db/schema';
import { fail, redirect } from '@sveltejs/kit';
import { and, asc, eq, inArray, like, max, or, sql } from 'drizzle-orm';
import { isAuthorizedUser } from '../../pengguna/permissions';

// The PKL tables ship via ensure-ekspansi-modul; pnpm db:push may be pending.
function isTableMissingError(error: unknown) {
	return error instanceof Error && error.message.includes('no such table');
}

function intParam(value: FormDataEntryValue | null) {
	if (typeof value !== 'string' || !value.trim()) return null;
	const n = Number(value);
	return Number.isInteger(n) && n > 0 ? n : null;
}

function textParam(value: FormDataEntryValue | null) {
	if (typeof value !== 'string') return null;
	const trimmed = value.trim();
	return trimmed ? trimmed : null;
}

export async function load({ parent, locals, depends, url }) {
	depends('app:prakerin');

	if (!locals.user) throw redirect(303, '/login');

	const { kelasAktif } = await parent();
	const sekolahId = locals.sekolah?.id ?? null;
	const authorized = isAuthorizedUser(['input_nilai_pkl'], locals.user);

	const q = url.searchParams.get('q')?.trim() ?? '';
	const meta = { title: 'PKL (Prakerin)' } satisfies PageMeta;

	if (!sekolahId || !authorized) {
		return {
			meta,
			authorized,
			kelasId: null as number | null,
			semuaKelasMode: kelasAktif === null,
			q,
			kosongKarenaFilter: false,
			perusahaan: [],
			kelompok: [],
			tujuan: [],
			muridList: [],
			pegawaiList: [],
			daftarKelas: []
		};
	}

	// Admin "Semua Kelas" mode: kelasAktif is null — fall back to the first kelas
	// so member candidate lists keep working.
	let kelasId = kelasAktif?.id ?? null;
	if (!kelasId) {
		const firstKelas = await db.query.tableKelas.findFirst({
			columns: { id: true },
			where: eq(tableKelas.sekolahId, sekolahId),
			orderBy: asc(tableKelas.nama)
		});
		kelasId = firstKelas?.id ?? null;
	}
	const semuaKelasMode = kelasAktif === null;

	const kelompokFilter = semuaKelasMode
		? eq(tablePklKelompok.sekolahId, sekolahId)
		: and(eq(tablePklKelompok.sekolahId, sekolahId), eq(tablePklKelompok.kelasId, kelasId!));

	const basePerusahaanWhere = eq(tablePklPerusahaan.sekolahId, sekolahId);
	const searchCondition = q
		? or(
				like(tablePklPerusahaan.nama, `%${q}%`),
				like(tablePklPerusahaan.alamat, `%${q}%`),
				like(tablePklPerusahaan.pembimbing, `%${q}%`)
			)
		: undefined;
	const perusahaanWhere = searchCondition
		? and(basePerusahaanWhere, searchCondition)
		: basePerusahaanWhere;

	const [countRes, perusahaan, kelompok, tujuan, muridList, pegawaiList, daftarKelas] =
		await Promise.all([
			db
				.select({ count: sql<number>`count(*)` })
				.from(tablePklPerusahaan)
				.where(basePerusahaanWhere),
			db.query.tablePklPerusahaan.findMany({
				columns: {
					id: true,
					nama: true,
					alamat: true,
					bidangUsaha: true,
					pembimbing: true,
					telepon: true
				},
				where: perusahaanWhere,
				orderBy: asc(tablePklPerusahaan.nama)
			}),
			db.query.tablePklKelompok.findMany({
				columns: {
					id: true,
					kelasId: true,
					perusahaanId: true,
					pembimbingPegawaiId: true,
					nama: true,
					skPenugasan: true,
					tanggalMulai: true,
					tanggalSelesai: true,
					lokasi: true,
					catatan: true
				},
				with: {
					kelas: { columns: { nama: true, fase: true } },
					perusahaan: { columns: { nama: true } },
					pembimbing: { columns: { nama: true } },
					anggota: {
						columns: { id: true, muridId: true },
						with: { murid: { columns: { nama: true, nisn: true } } }
					}
				},
				where: kelompokFilter,
				orderBy: asc(tablePklKelompok.id)
			}),
			db.query.tablePklTujuan.findMany({
				columns: { id: true, urutan: true, deskripsi: true },
				where: eq(tablePklTujuan.sekolahId, sekolahId),
				orderBy: asc(tablePklTujuan.urutan)
			}),
			// Candidate murid for the member modal (all scoped kelas in sekolah).
			db
				.select({ id: tableMurid.id, nama: tableMurid.nama, kelasId: tableMurid.kelasId })
				.from(tableMurid)
				.where(eq(tableMurid.sekolahId, sekolahId))
				.orderBy(asc(tableMurid.nama)),
			db
				.select({ id: tablePegawai.id, nama: tablePegawai.nama })
				.from(tablePegawai)
				.where(eq(tablePegawai.sekolahId, sekolahId))
				.orderBy(asc(tablePegawai.nama)),
			db.query.tableKelas.findMany({
				columns: { id: true, nama: true, fase: true },
				where: eq(tableKelas.sekolahId, sekolahId),
				orderBy: asc(tableKelas.nama)
			})
		]);

	const totalPerusahaan = countRes[0]?.count ?? 0;
	const kosongKarenaFilter = totalPerusahaan > 0 && perusahaan.length === 0 && Boolean(q);

	return {
		meta,
		authorized,
		kelasId,
		semuaKelasMode,
		q,
		kosongKarenaFilter,
		perusahaan,
		kelompok,
		tujuan,
		muridList,
		pegawaiList,
		daftarKelas
	};
}

function requireAccess(locals: App.Locals) {
	const sekolahId = locals.sekolah?.id ?? null;
	if (!sekolahId) {
		return { sekolahId: null } as const;
	}
	if (!isAuthorizedUser(['input_nilai_pkl'], locals.user)) {
		return { sekolahId: null } as const;
	}
	return { sekolahId } as const;
}

export const actions = {
	tambahPerusahaan: async ({ request, locals }) => {
		const { sekolahId } = requireAccess(locals);
		if (!sekolahId) return fail(403, { fail: 'Anda tidak memiliki izin.' });

		const formData = await request.formData();
		const nama = textParam(formData.get('nama'));
		if (!nama) return fail(400, { fail: 'Nama perusahaan wajib diisi.' });

		try {
			await db.insert(tablePklPerusahaan).values({
				sekolahId,
				nama,
				alamat: textParam(formData.get('alamat')),
				bidangUsaha: textParam(formData.get('bidangUsaha')),
				pembimbing: textParam(formData.get('pembimbing')),
				telepon: textParam(formData.get('telepon'))
			});
		} catch (error) {
			if (isTableMissingError(error)) {
				return fail(500, { fail: 'Tabel PKL belum tersedia. Jalankan pnpm db:push.' });
			}
			throw error;
		}
		return { message: 'Perusahaan berhasil ditambahkan' };
	},

	hapusPerusahaan: async ({ request, locals }) => {
		const { sekolahId } = requireAccess(locals);
		if (!sekolahId) return fail(403, { fail: 'Anda tidak memiliki izin.' });

		const formData = await request.formData();
		const id = intParam(formData.get('id'));
		if (!id) return fail(400, { fail: 'ID perusahaan tidak valid.' });

		try {
			const dipakai = await db
				.select({ id: tablePklKelompok.id })
				.from(tablePklKelompok)
				.where(
					and(eq(tablePklKelompok.sekolahId, sekolahId), eq(tablePklKelompok.perusahaanId, id))
				);
			if (dipakai.length > 0) {
				return fail(400, {
					fail: 'Perusahaan masih dipakai oleh kelompok PKL. Hapus atau ubah kelompoknya terlebih dahulu.'
				});
			}

			const deleted = await db
				.delete(tablePklPerusahaan)
				.where(and(eq(tablePklPerusahaan.sekolahId, sekolahId), eq(tablePklPerusahaan.id, id)))
				.returning({ id: tablePklPerusahaan.id });
			if (!deleted.length) return fail(404, { fail: 'Perusahaan tidak ditemukan.' });
		} catch (error) {
			if (isTableMissingError(error)) {
				return fail(500, { fail: 'Tabel PKL belum tersedia. Jalankan pnpm db:push.' });
			}
			throw error;
		}
		return { message: 'Perusahaan berhasil dihapus' };
	},

	tambahKelompok: async ({ request, locals }) => {
		const { sekolahId } = requireAccess(locals);
		if (!sekolahId) return fail(403, { fail: 'Anda tidak memiliki izin.' });

		const formData = await request.formData();
		const kelasId = intParam(formData.get('kelasId'));
		if (!kelasId) return fail(400, { fail: 'Kelas wajib dipilih.' });

		const perusahaanId = intParam(formData.get('perusahaanId'));
		const pembimbingPegawaiId = intParam(formData.get('pembimbingPegawaiId'));

		// Validate referenced rows belong to this sekolah.
		const kelasRow = await db.query.tableKelas.findFirst({
			columns: { id: true },
			where: and(eq(tableKelas.id, kelasId), eq(tableKelas.sekolahId, sekolahId))
		});
		if (!kelasRow) return fail(400, { fail: 'Kelas tidak ditemukan.' });

		if (perusahaanId) {
			const perusahaanRow = await db.query.tablePklPerusahaan.findFirst({
				columns: { id: true },
				where: and(
					eq(tablePklPerusahaan.id, perusahaanId),
					eq(tablePklPerusahaan.sekolahId, sekolahId)
				)
			});
			if (!perusahaanRow) return fail(400, { fail: 'Perusahaan tidak ditemukan.' });
		}

		if (pembimbingPegawaiId) {
			const pegawaiRow = await db.query.tablePegawai.findFirst({
				columns: { id: true },
				where: and(eq(tablePegawai.id, pembimbingPegawaiId), eq(tablePegawai.sekolahId, sekolahId))
			});
			if (!pegawaiRow) return fail(400, { fail: 'Pembimbing tidak ditemukan.' });
		}

		try {
			await db.insert(tablePklKelompok).values({
				sekolahId,
				kelasId,
				perusahaanId,
				pembimbingPegawaiId,
				nama: textParam(formData.get('nama')),
				skPenugasan: textParam(formData.get('skPenugasan')),
				tanggalMulai: textParam(formData.get('tanggalMulai')),
				tanggalSelesai: textParam(formData.get('tanggalSelesai')),
				lokasi: textParam(formData.get('lokasi')),
				catatan: textParam(formData.get('catatan'))
			});
		} catch (error) {
			if (isTableMissingError(error)) {
				return fail(500, { fail: 'Tabel PKL belum tersedia. Jalankan pnpm db:push.' });
			}
			throw error;
		}
		return { message: 'Kelompok PKL berhasil ditambahkan' };
	},

	hapusKelompok: async ({ request, locals }) => {
		const { sekolahId } = requireAccess(locals);
		if (!sekolahId) return fail(403, { fail: 'Anda tidak memiliki izin.' });

		const formData = await request.formData();
		const id = intParam(formData.get('id'));
		if (!id) return fail(400, { fail: 'ID kelompok tidak valid.' });

		try {
			const deleted = await db
				.delete(tablePklKelompok)
				.where(and(eq(tablePklKelompok.sekolahId, sekolahId), eq(tablePklKelompok.id, id)))
				.returning({ id: tablePklKelompok.id });
			if (!deleted.length) return fail(404, { fail: 'Kelompok tidak ditemukan.' });
		} catch (error) {
			if (isTableMissingError(error)) {
				return fail(500, { fail: 'Tabel PKL belum tersedia. Jalankan pnpm db:push.' });
			}
			throw error;
		}
		return { message: 'Kelompok PKL berhasil dihapus' };
	},

	aturAnggota: async ({ request, locals }) => {
		const { sekolahId } = requireAccess(locals);
		if (!sekolahId) return fail(403, { fail: 'Anda tidak memiliki izin.' });

		const formData = await request.formData();
		const kelompokId = intParam(formData.get('kelompokId'));
		if (!kelompokId) return fail(400, { fail: 'ID kelompok tidak valid.' });

		const kelompok = await db.query.tablePklKelompok.findFirst({
			columns: { id: true, kelasId: true },
			where: and(eq(tablePklKelompok.id, kelompokId), eq(tablePklKelompok.sekolahId, sekolahId))
		});
		if (!kelompok) return fail(404, { fail: 'Kelompok tidak ditemukan.' });

		const addIds = formData
			.getAll('add')
			.map((v) => intParam(v))
			.filter((v): v is number => v !== null);
		const removeIds = formData
			.getAll('remove')
			.map((v) => intParam(v))
			.filter((v): v is number => v !== null);

		if (!addIds.length && !removeIds.length) {
			return fail(400, { fail: 'Tidak ada perubahan anggota.' });
		}

		try {
			if (addIds.length) {
				const validMurid = await db
					.select({ id: tableMurid.id })
					.from(tableMurid)
					.where(and(eq(tableMurid.sekolahId, sekolahId), inArray(tableMurid.id, addIds)));
				const validIds = new Set(validMurid.map((m) => m.id));
				const toInsert = addIds.filter((id) => validIds.has(id));
				if (toInsert.length) {
					await db
						.insert(tablePklMurid)
						.values(toInsert.map((muridId) => ({ sekolahId, kelompokId, muridId })))
						// Unique (kelompokId, muridId) — silently skip already-member duplicates.
						.onConflictDoNothing();
				}
			}

			if (removeIds.length) {
				await db
					.delete(tablePklMurid)
					.where(
						and(
							eq(tablePklMurid.sekolahId, sekolahId),
							eq(tablePklMurid.kelompokId, kelompokId),
							inArray(tablePklMurid.muridId, removeIds)
						)
					);
			}
		} catch (error) {
			if (isTableMissingError(error)) {
				return fail(500, { fail: 'Tabel PKL belum tersedia. Jalankan pnpm db:push.' });
			}
			throw error;
		}
		return { message: 'Anggota kelompok berhasil diperbarui' };
	},

	tambahTujuan: async ({ request, locals }) => {
		const { sekolahId } = requireAccess(locals);
		if (!sekolahId) return fail(403, { fail: 'Anda tidak memiliki izin.' });

		const formData = await request.formData();
		const deskripsi = textParam(formData.get('deskripsi'));
		if (!deskripsi) return fail(400, { fail: 'Deskripsi tujuan wajib diisi.' });

		try {
			const [{ maxUrutan }] = await db
				.select({ maxUrutan: max(tablePklTujuan.urutan) })
				.from(tablePklTujuan)
				.where(eq(tablePklTujuan.sekolahId, sekolahId));
			const urutan = (maxUrutan ?? 0) + 1;
			await db.insert(tablePklTujuan).values({ sekolahId, urutan, deskripsi });
		} catch (error) {
			if (isTableMissingError(error)) {
				return fail(500, { fail: 'Tabel PKL belum tersedia. Jalankan pnpm db:push.' });
			}
			throw error;
		}
		return { message: 'Tujuan pembelajaran berhasil ditambahkan' };
	},

	hapusTujuan: async ({ request, locals }) => {
		const { sekolahId } = requireAccess(locals);
		if (!sekolahId) return fail(403, { fail: 'Anda tidak memiliki izin.' });

		const formData = await request.formData();
		const id = intParam(formData.get('id'));
		if (!id) return fail(400, { fail: 'ID tujuan tidak valid.' });

		try {
			const deleted = await db
				.delete(tablePklTujuan)
				.where(and(eq(tablePklTujuan.sekolahId, sekolahId), eq(tablePklTujuan.id, id)))
				.returning({ id: tablePklTujuan.id });
			if (!deleted.length) return fail(404, { fail: 'Tujuan tidak ditemukan.' });
		} catch (error) {
			if (isTableMissingError(error)) {
				return fail(500, { fail: 'Tabel PKL belum tersedia. Jalankan pnpm db:push.' });
			}
			throw error;
		}
		return { message: 'Tujuan pembelajaran berhasil dihapus' };
	}
};
