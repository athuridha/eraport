import db from '$lib/server/db';
import {
	tableKelas,
	tableMurid,
	tablePegawai,
	tablePoinPelanggaran,
	tablePoinSiswa
} from '$lib/server/db/schema';
import { fail, redirect } from '@sveltejs/kit';
import { and, asc, desc, eq, like, sql } from 'drizzle-orm';
import { isAuthorizedUser } from '../../pengguna/permissions';

const REQUIRED_PERMISSION = 'administrasi_poin_siswa';

type PelanggaranRow = {
	id: number;
	nama: string;
	poin: number;
	kategori: string | null;
	dipakai: number;
};

type MuridRekap = {
	id: number;
	nama: string;
	nisn: string | null;
	kelasNama: string | null;
	totalPoin: number;
	jumlahRiwayat: number;
};

type RiwayatRow = {
	id: number;
	tanggal: string;
	catatan: string | null;
	muridNama: string;
	pelanggaranNama: string;
	poin: number;
	pelaporNama: string | null;
};

function isDuplicateNamaError(error: unknown) {
	return (
		error instanceof Error &&
		error.message.includes('UNIQUE constraint failed') &&
		error.message.includes('poin_pelanggaran')
	);
}

/** Murid scope: kelas aktif bila ada, semua kelas sekolah bila mode admin (kelasAktif null). */
function muridScope(sekolahId: number, kelasAktifId: number | null) {
	return kelasAktifId
		? and(eq(tableMurid.sekolahId, sekolahId), eq(tableMurid.kelasId, kelasAktifId))
		: eq(tableMurid.sekolahId, sekolahId);
}

async function ambilPelanggaran(sekolahId: number): Promise<PelanggaranRow[]> {
	const pelanggaranList = await db.query.tablePoinPelanggaran.findMany({
		columns: { id: true, nama: true, poin: true, kategori: true },
		where: eq(tablePoinPelanggaran.sekolahId, sekolahId),
		orderBy: [asc(tablePoinPelanggaran.kategori), asc(tablePoinPelanggaran.nama)]
	});

	const pemakaian = await db
		.select({
			pelanggaranId: tablePoinSiswa.pelanggaranId,
			jumlah: sql<number>`count(*)`
		})
		.from(tablePoinSiswa)
		.where(eq(tablePoinSiswa.sekolahId, sekolahId))
		.groupBy(tablePoinSiswa.pelanggaranId);
	const pemakaianMap = new Map(pemakaian.map((row) => [row.pelanggaranId, row.jumlah ?? 0]));

	return pelanggaranList.map((row) => ({
		...row,
		dipakai: pemakaianMap.get(row.id) ?? 0
	}));
}

async function ambilRekap(
	sekolahId: number,
	kelasAktifId: number | null,
	q: string,
	status: 'ada_poin' | 'bersih' | 'semua'
): Promise<{ rows: MuridRekap[]; totalSemua: number; totalCocok: number }> {
	const baseScope = muridScope(sekolahId, kelasAktifId);
	const conditions = [baseScope];

	if (q) {
		conditions.push(like(tableMurid.nama, `%${q}%`));
	}

	const poinSubquery = sql`exists (
		select 1 from ${tablePoinSiswa}
		inner join ${tablePoinPelanggaran} on ${tablePoinPelanggaran.id} = ${tablePoinSiswa.pelanggaranId}
		where ${tablePoinSiswa.muridId} = ${tableMurid.id}
		and ${tablePoinSiswa.sekolahId} = ${sekolahId}
		and ${tablePoinPelanggaran.poin} > 0
	)`;

	if (status === 'ada_poin') {
		conditions.push(poinSubquery);
	} else if (status === 'bersih') {
		conditions.push(sql`not ${poinSubquery}`);
	}

	const filter = and(...conditions);

	const [[{ totalSemua }], [{ totalCocok }], rawRows] = await Promise.all([
		db
			.select({ totalSemua: sql<number>`count(*)` })
			.from(tableMurid)
			.where(baseScope),
		db
			.select({ totalCocok: sql<number>`count(*)` })
			.from(tableMurid)
			.where(filter),
		db
			.select({
				id: tableMurid.id,
				nama: tableMurid.nama,
				nisn: tableMurid.nisn,
				kelasNama: tableKelas.nama,
				totalPoin: sql<number>`coalesce(sum(${tablePoinPelanggaran.poin}), 0)`,
				jumlahRiwayat: sql<number>`count(${tablePoinSiswa.id})`
			})
			.from(tableMurid)
			.leftJoin(tableKelas, eq(tableMurid.kelasId, tableKelas.id))
			.leftJoin(
				tablePoinSiswa,
				and(eq(tablePoinSiswa.muridId, tableMurid.id), eq(tablePoinSiswa.sekolahId, sekolahId))
			)
			.leftJoin(tablePoinPelanggaran, eq(tablePoinSiswa.pelanggaranId, tablePoinPelanggaran.id))
			.where(filter)
			.groupBy(tableMurid.id, tableMurid.nama, tableMurid.nisn, tableKelas.nama)
			.orderBy(asc(tableMurid.nama))
	]);

	const rows = rawRows.map((row) => ({
		id: row.id,
		nama: row.nama,
		nisn: row.nisn,
		kelasNama: row.kelasNama,
		totalPoin: row.totalPoin ?? 0,
		jumlahRiwayat: row.jumlahRiwayat ?? 0
	}));

	return {
		rows,
		totalSemua: totalSemua ?? 0,
		totalCocok: totalCocok ?? 0
	};
}

async function ambilRiwayat(sekolahId: number, kelasAktifId: number | null): Promise<RiwayatRow[]> {
	const filter = kelasAktifId
		? and(eq(tablePoinSiswa.sekolahId, sekolahId), eq(tableMurid.kelasId, kelasAktifId))
		: eq(tablePoinSiswa.sekolahId, sekolahId);

	const rows = await db
		.select({
			id: tablePoinSiswa.id,
			tanggal: tablePoinSiswa.tanggal,
			catatan: tablePoinSiswa.catatan,
			muridNama: tableMurid.nama,
			pelanggaranNama: tablePoinPelanggaran.nama,
			poin: tablePoinPelanggaran.poin,
			pelaporNama: tablePegawai.nama
		})
		.from(tablePoinSiswa)
		.innerJoin(tableMurid, eq(tablePoinSiswa.muridId, tableMurid.id))
		.innerJoin(tablePoinPelanggaran, eq(tablePoinSiswa.pelanggaranId, tablePoinPelanggaran.id))
		.leftJoin(tablePegawai, eq(tablePoinSiswa.pelaporPegawaiId, tablePegawai.id))
		.where(filter)
		.orderBy(desc(tablePoinSiswa.id))
		.limit(10);

	return rows;
}

export async function load({ locals, depends, parent, url }) {
	depends('app:poin-siswa');

	if (!isAuthorizedUser([REQUIRED_PERMISSION], locals.user)) {
		redirect(303, `/forbidden?required=${REQUIRED_PERMISSION}`);
	}

	const parentData = await parent();
	const kelasAktif = parentData.kelasAktif as { id: number; nama: string } | null;
	const sekolahId = locals.sekolah?.id ?? null;

	const q = (url.searchParams.get('q') ?? '').trim();
	const rawStatus = url.searchParams.get('status') ?? 'semua';
	const status: 'ada_poin' | 'bersih' | 'semua' =
		rawStatus === 'ada_poin' || rawStatus === 'bersih' ? rawStatus : 'semua';

	if (!sekolahId) {
		return {
			meta: { title: 'Poin Siswa' } satisfies PageMeta,
			kelasAktif: null,
			daftarPelanggaran: [] as PelanggaranRow[],
			rekap: [] as MuridRekap[],
			riwayat: [] as RiwayatRow[],
			filter: { q, status },
			totalSemua: 0,
			totalCocok: 0,
			kosongKarenaFilter: false
		};
	}

	const kelasAktifId = kelasAktif?.id ?? null;
	const [daftarPelanggaran, rekapResult, riwayat] = await Promise.all([
		ambilPelanggaran(sekolahId),
		ambilRekap(sekolahId, kelasAktifId, q, status),
		ambilRiwayat(sekolahId, kelasAktifId)
	]);

	const adaFilter = Boolean(q || status !== 'semua');
	const kosongKarenaFilter =
		rekapResult.totalSemua > 0 && rekapResult.totalCocok === 0 && adaFilter;

	return {
		meta: { title: 'Poin Siswa' } satisfies PageMeta,
		kelasAktif: kelasAktif ?? null,
		daftarPelanggaran,
		rekap: rekapResult.rows,
		riwayat,
		filter: { q, status },
		totalSemua: rekapResult.totalSemua,
		totalCocok: rekapResult.totalCocok,
		kosongKarenaFilter
	};
}

export const actions = {
	tambahPelanggaran: async ({ request, locals }) => {
		const sekolahId = locals.sekolah?.id;
		if (!sekolahId) {
			return fail(401, { fail: 'Sekolah tidak ditemukan' });
		}
		if (!isAuthorizedUser([REQUIRED_PERMISSION], locals.user)) {
			return fail(403, { fail: 'Anda tidak memiliki izin mengelola poin siswa.' });
		}

		const formData = await request.formData();
		const nama = formData.get('nama')?.toString().trim() ?? '';
		const kategori = formData.get('kategori')?.toString().trim() ?? '';
		const poinRaw = formData.get('poin');

		if (!nama) {
			return fail(400, { fail: 'Nama pelanggaran wajib diisi' });
		}

		const poin = Number(poinRaw);
		if (!poinRaw || poinRaw === '' || !Number.isInteger(poin) || poin < 0) {
			return fail(400, { fail: 'Poin wajib berupa bilangan bulat >= 0' });
		}

		// The (sekolah_id, nama) unique index rejects duplicates; surface a
		// friendly message instead of a raw DB error.
		try {
			await db.insert(tablePoinPelanggaran).values({
				sekolahId,
				nama,
				poin,
				kategori: kategori || null
			});
			return { message: 'Pelanggaran berhasil ditambahkan' };
		} catch (error) {
			if (isDuplicateNamaError(error)) {
				return fail(400, { fail: 'Pelanggaran dengan nama itu sudah ada.' });
			}
			throw error;
		}
	},

	hapusPelanggaran: async ({ request, locals }) => {
		const sekolahId = locals.sekolah?.id;
		if (!sekolahId) {
			return fail(401, { fail: 'Sekolah tidak ditemukan' });
		}
		if (!isAuthorizedUser([REQUIRED_PERMISSION], locals.user)) {
			return fail(403, { fail: 'Anda tidak memiliki izin mengelola poin siswa.' });
		}

		const formData = await request.formData();
		const id = Number(formData.get('id'));
		if (!Number.isInteger(id) || id <= 0) {
			return fail(400, { fail: 'Pelanggaran tidak valid' });
		}

		const pelanggaran = await db.query.tablePoinPelanggaran.findFirst({
			columns: { id: true },
			where: and(eq(tablePoinPelanggaran.id, id), eq(tablePoinPelanggaran.sekolahId, sekolahId))
		});
		if (!pelanggaran) {
			return fail(404, { fail: 'Pelanggaran tidak ditemukan' });
		}

		// Deleting cascades into poin_siswa (FK onDelete cascade); report impact.
		const [{ jumlah }] = await db
			.select({ jumlah: sql<number>`count(*)` })
			.from(tablePoinSiswa)
			.where(eq(tablePoinSiswa.pelanggaranId, id));

		await db.delete(tablePoinPelanggaran).where(eq(tablePoinPelanggaran.id, id));

		const riwayat = jumlah ?? 0;
		return {
			message: riwayat > 0 ? `${riwayat} riwayat ikut terhapus.` : 'Pelanggaran berhasil dihapus'
		};
	},

	beriPoin: async ({ request, locals }) => {
		const sekolahId = locals.sekolah?.id;
		if (!sekolahId) {
			return fail(401, { fail: 'Sekolah tidak ditemukan' });
		}
		if (!isAuthorizedUser([REQUIRED_PERMISSION], locals.user)) {
			return fail(403, { fail: 'Anda tidak memiliki izin mengelola poin siswa.' });
		}

		const formData = await request.formData();
		const muridId = Number(formData.get('muridId'));
		const pelanggaranId = Number(formData.get('pelanggaranId'));
		const tanggalRaw = formData.get('tanggal')?.toString().trim() ?? '';
		const catatan = formData.get('catatan')?.toString().trim() ?? '';

		if (!Number.isInteger(muridId) || muridId <= 0) {
			return fail(400, { fail: 'Murid tidak valid' });
		}
		if (!Number.isInteger(pelanggaranId) || pelanggaranId <= 0) {
			return fail(400, { fail: 'Pilih pelanggaran terlebih dahulu' });
		}

		const murid = await db.query.tableMurid.findFirst({
			columns: { id: true },
			where: and(eq(tableMurid.id, muridId), eq(tableMurid.sekolahId, sekolahId))
		});
		if (!murid) {
			return fail(404, { fail: 'Murid tidak ditemukan' });
		}

		const pelanggaran = await db.query.tablePoinPelanggaran.findFirst({
			columns: { id: true },
			where: and(
				eq(tablePoinPelanggaran.id, pelanggaranId),
				eq(tablePoinPelanggaran.sekolahId, sekolahId)
			)
		});
		if (!pelanggaran) {
			return fail(404, { fail: 'Pelanggaran tidak ditemukan' });
		}

		const tanggal = tanggalRaw || new Date().toISOString().slice(0, 10);

		// Reporter = pegawai linked to the logged-in account; admins without a
		// pegawai record are saved as null (column is nullable).
		const pelaporPegawaiId =
			(locals.user as { pegawaiId?: number | null } | null)?.pegawaiId ?? null;

		await db.insert(tablePoinSiswa).values({
			sekolahId,
			muridId,
			pelanggaranId,
			tanggal,
			pelaporPegawaiId: pelaporPegawaiId ? Number(pelaporPegawaiId) : null,
			catatan: catatan || null
		});

		return { message: 'Poin berhasil diberikan' };
	},

	hapusPoin: async ({ request, locals }) => {
		const sekolahId = locals.sekolah?.id;
		if (!sekolahId) {
			return fail(401, { fail: 'Sekolah tidak ditemukan' });
		}
		if (!isAuthorizedUser([REQUIRED_PERMISSION], locals.user)) {
			return fail(403, { fail: 'Anda tidak memiliki izin mengelola poin siswa.' });
		}

		const formData = await request.formData();
		const id = Number(formData.get('id'));
		if (!Number.isInteger(id) || id <= 0) {
			return fail(400, { fail: 'Riwayat tidak valid' });
		}

		const deleted = await db
			.delete(tablePoinSiswa)
			.where(and(eq(tablePoinSiswa.id, id), eq(tablePoinSiswa.sekolahId, sekolahId)))
			.returning({ id: tablePoinSiswa.id });

		if (!deleted.length) {
			return fail(404, { fail: 'Riwayat tidak ditemukan' });
		}

		return { message: 'Riwayat poin berhasil dihapus' };
	}
};
