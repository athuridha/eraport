import db from '$lib/server/db';
import {
	tableKelas,
	tableMurid,
	tablePoinPelanggaran,
	tablePoinSiswa
} from '$lib/server/db/schema';
import { redirect } from '@sveltejs/kit';
import { and, asc, eq, like, sql } from 'drizzle-orm';
import type { PageServerLoad } from './$types';
import { isAuthorizedUser } from '../../../pengguna/permissions';

const REQUIRED_PERMISSION = 'administrasi_poin_siswa';

type MuridRekap = {
	nama: string;
	nisn: string | null;
	totalPoin: number;
	count: number;
};

type KelasRekap = {
	namaKelas: string;
	murids: MuridRekap[];
};

type OpsiKelas = {
	id: number;
	nama: string;
};

async function ambilRekapSemuaKelas(
	sekolahId: number,
	q: string | null,
	kelasId: number | null
): Promise<{ kelas: KelasRekap[]; totalSemua: number }> {
	const baseConditions = [eq(tableMurid.sekolahId, sekolahId), eq(tableKelas.sekolahId, sekolahId)];

	const conditions = [...baseConditions];

	if (q) {
		conditions.push(like(tableMurid.nama, `%${q}%`));
	}

	if (kelasId) {
		conditions.push(eq(tableKelas.id, kelasId));
	}

	const [[{ totalSemua }], rows] = await Promise.all([
		db
			.select({ totalSemua: sql<number>`count(*)` })
			.from(tableMurid)
			.innerJoin(tableKelas, eq(tableMurid.kelasId, tableKelas.id))
			.where(and(...baseConditions)),
		db
			.select({
				muridId: tableMurid.id,
				nama: tableMurid.nama,
				nisn: tableMurid.nisn,
				kelasNama: tableKelas.nama,
				totalPoin: sql<number>`coalesce(sum(${tablePoinPelanggaran.poin}), 0)`,
				count: sql<number>`count(${tablePoinSiswa.id})`
			})
			.from(tableMurid)
			.innerJoin(tableKelas, eq(tableMurid.kelasId, tableKelas.id))
			.leftJoin(
				tablePoinSiswa,
				and(eq(tablePoinSiswa.muridId, tableMurid.id), eq(tablePoinSiswa.sekolahId, sekolahId))
			)
			.leftJoin(tablePoinPelanggaran, eq(tablePoinSiswa.pelanggaranId, tablePoinPelanggaran.id))
			.where(and(...conditions))
			.groupBy(tableMurid.id, tableMurid.nama, tableMurid.nisn, tableKelas.nama)
			.orderBy(asc(tableKelas.nama), asc(tableMurid.nama))
	]);

	const byKelas = new Map<string, MuridRekap[]>();
	for (const row of rows) {
		const mapped: MuridRekap = {
			nama: row.nama,
			nisn: row.nisn,
			totalPoin: row.totalPoin ?? 0,
			count: row.count ?? 0
		};
		const list = byKelas.get(row.kelasNama);
		if (list) list.push(mapped);
		else byKelas.set(row.kelasNama, [mapped]);
	}

	// Sort students inside each class by total points descending.
	const kelas = [...byKelas.entries()]
		.map(([namaKelas, murids]) => ({
			namaKelas,
			murids: murids.sort((a, b) => b.totalPoin - a.totalPoin || a.nama.localeCompare(b.nama))
		}))
		.sort((a, b) => a.namaKelas.localeCompare(b.namaKelas));

	return { kelas, totalSemua };
}

async function ambilDaftarKelas(sekolahId: number): Promise<OpsiKelas[]> {
	return db
		.select({
			id: tableKelas.id,
			nama: tableKelas.nama
		})
		.from(tableKelas)
		.where(eq(tableKelas.sekolahId, sekolahId))
		.orderBy(asc(tableKelas.nama));
}

export const load: PageServerLoad = async ({ locals, url }) => {
	if (!isAuthorizedUser([REQUIRED_PERMISSION], locals.user)) {
		redirect(303, `/forbidden?required=${REQUIRED_PERMISSION}`);
	}

	const sekolahId = locals.sekolah?.id ?? null;

	if (!sekolahId) {
		return {
			meta: { title: 'Rekap Poin Siswa' } satisfies PageMeta,
			kelas: [] as KelasRekap[],
			daftarKelas: [] as OpsiKelas[],
			filters: { q: '', kelasId: '' },
			kosongKarenaFilter: false
		};
	}

	const q = url.searchParams.get('q')?.trim() || null;
	const paramKelasId = Number(url.searchParams.get('kelas_id') ?? '');
	const kelasId = Number.isInteger(paramKelasId) && paramKelasId > 0 ? paramKelasId : null;

	const [{ kelas, totalSemua }, daftarKelas] = await Promise.all([
		ambilRekapSemuaKelas(sekolahId, q, kelasId),
		ambilDaftarKelas(sekolahId)
	]);

	const adaFilter = Boolean(q || kelasId);
	const kosongKarenaFilter = totalSemua > 0 && kelas.length === 0 && adaFilter;

	return {
		meta: { title: 'Rekap Poin Siswa' } satisfies PageMeta,
		kelas,
		daftarKelas,
		filters: {
			q: q ?? '',
			kelasId: kelasId ? String(kelasId) : ''
		},
		kosongKarenaFilter
	};
};
