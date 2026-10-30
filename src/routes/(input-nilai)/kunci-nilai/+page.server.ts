import { error, fail } from '@sveltejs/kit';
import { and, asc, count, eq, isNotNull, isNull, or, sql, type SQLWrapper } from 'drizzle-orm';
import db from '$lib/server/db';
import {
	tableAuthUser,
	tableKelas,
	tableKunciNilai,
	tableMataPelajaran,
	tablePegawai
} from '$lib/server/db/schema';
import { authority } from '../../pengguna/utils.server';
import { ensureKunciNilaiSchema } from '$lib/server/db/ensure-kunci-nilai';
import { bukaKunciNilaiMapel, kunciNilaiMapel } from '$lib/server/nilai-kunci';

import type { PageServerLoad, Actions } from './$types';

const LABEL_STATUS: Record<string, string> = {
	terkunci: 'Terkunci',
	bebas: 'Bebas'
};

async function listMapelKelas(kelasId: number) {
	return db
		.select({
			id: tableMataPelajaran.id,
			nama: tableMataPelajaran.nama,
			pengampuId: tableMataPelajaran.pengampuId
		})
		.from(tableMataPelajaran)
		.where(eq(tableMataPelajaran.kelasId, kelasId))
		.orderBy(asc(tableMataPelajaran.nama));
}

export const load: PageServerLoad = async ({ parent, locals, url }) => {
	authority('input_nilai_kunci_nilai');
	await ensureKunciNilaiSchema();

	const sekolahId = locals.sekolah?.id ?? null;
	if (!sekolahId) {
		throw error(401, 'Sekolah aktif tidak ditemukan.');
	}

	const { kelasAktif } = await parent();
	const kelasId = kelasAktif?.id ?? null;

	const q = url.searchParams.get('q')?.trim() || null;
	const statusParam = url.searchParams.get('status')?.trim() || null;

	if (!kelasId) {
		return {
			meta: { title: 'Kunci Nilai' },
			kelasId: null,
			kelasNama: '',
			mapel: [],
			jumlahTerkunci: 0,
			totalSemua: 0,
			totalFiltered: 0,
			opsiStatus: []
		};
	}

	const baseFilter = and(
		eq(tableMataPelajaran.kelasId, kelasId),
		eq(tableKelas.sekolahId, sekolahId)
	)!;

	const whereConditions: SQLWrapper[] = [baseFilter];

	if (q) {
		const like = `%${q.toLowerCase()}%`;
		whereConditions.push(
			or(
				sql`lower(${tableMataPelajaran.nama}) like ${like}`,
				sql`lower(coalesce(${tablePegawai.nama}, '')) like ${like}`
			)!
		);
	}

	if (statusParam === 'terkunci') {
		whereConditions.push(isNotNull(tableKunciNilai.id));
	} else if (statusParam === 'bebas') {
		whereConditions.push(isNull(tableKunciNilai.id));
	}

	const filterWhere = and(...whereConditions);

	const [[{ totalSemua }], [{ totalFiltered }], rawDistinctStatus, rows] = await Promise.all([
		db
			.select({ totalSemua: count() })
			.from(tableMataPelajaran)
			.innerJoin(tableKelas, eq(tableMataPelajaran.kelasId, tableKelas.id))
			.where(baseFilter),
		db
			.select({ totalFiltered: count() })
			.from(tableMataPelajaran)
			.innerJoin(tableKelas, eq(tableMataPelajaran.kelasId, tableKelas.id))
			.leftJoin(tablePegawai, eq(tableMataPelajaran.pengampuId, tablePegawai.id))
			.leftJoin(tableKunciNilai, eq(tableMataPelajaran.id, tableKunciNilai.mataPelajaranId))
			.where(filterWhere),
		db
			.selectDistinct({
				status: sql<string>`case when ${tableKunciNilai.id} is not null then 'terkunci' else 'bebas' end`
			})
			.from(tableMataPelajaran)
			.innerJoin(tableKelas, eq(tableMataPelajaran.kelasId, tableKelas.id))
			.leftJoin(tableKunciNilai, eq(tableMataPelajaran.id, tableKunciNilai.mataPelajaranId))
			.where(baseFilter),
		db
			.select({
				id: tableMataPelajaran.id,
				nama: tableMataPelajaran.nama,
				pengampu: tablePegawai.nama,
				kunciId: tableKunciNilai.id,
				dikunciOleh: tableAuthUser.username,
				dikunciPada: tableKunciNilai.dikunciPada,
				alasan: tableKunciNilai.alasan
			})
			.from(tableMataPelajaran)
			.innerJoin(tableKelas, eq(tableMataPelajaran.kelasId, tableKelas.id))
			.leftJoin(tablePegawai, eq(tableMataPelajaran.pengampuId, tablePegawai.id))
			.leftJoin(tableKunciNilai, eq(tableMataPelajaran.id, tableKunciNilai.mataPelajaranId))
			.leftJoin(tableAuthUser, eq(tableKunciNilai.dikunciOleh, tableAuthUser.id))
			.where(filterWhere)
			.orderBy(asc(tableMataPelajaran.nama))
	]);

	const opsiStatus: { value: string; label: string }[] = rawDistinctStatus
		.map((r) => r.status)
		.filter((s): s is string => Boolean(s))
		.map((s) => ({ value: s, label: LABEL_STATUS[s] ?? s }));

	const mapel = rows.map((row) => ({
		id: row.id,
		nama: row.nama,
		pengampu: row.pengampu ?? '—',
		terkunci: Boolean(row.kunciId),
		dikunciOleh: row.dikunciOleh ?? null,
		dikunciPada: row.dikunciPada ?? null,
		alasan: row.alasan ?? null
	}));

	return {
		meta: { title: 'Kunci Nilai' },
		kelasId,
		kelasNama: kelasAktif?.nama ?? '',
		mapel,
		jumlahTerkunci: mapel.filter((row) => row.terkunci).length,
		totalSemua,
		totalFiltered,
		opsiStatus
	};
};

function mapelMilikSekolah(mapelId: number, sekolahId: number) {
	return db.query.tableMataPelajaran
		.findFirst({
			columns: { id: true, nama: true, kelasId: true },
			with: { kelas: { columns: { sekolahId: true } } },
			where: eq(tableMataPelajaran.id, mapelId)
		})
		.then((row) => {
			if (!row || row.kelas?.sekolahId !== sekolahId) return null;
			return row;
		});
}

export const actions: Actions = {
	async kunci({ request, locals }) {
		authority('input_nilai_kunci_nilai');
		const sekolahId = locals.sekolah?.id ?? null;
		if (!sekolahId) return fail(401, { fail: 'Sekolah aktif tidak ditemukan.' });

		const formData = await request.formData();
		const mapelId = Number(formData.get('mapelId') ?? 0);
		const alasan = String(formData.get('alasan') ?? '').trim();
		if (!Number.isInteger(mapelId) || mapelId <= 0) {
			return fail(400, { fail: 'Mata pelajaran tidak valid.' });
		}

		const mapel = await mapelMilikSekolah(mapelId, sekolahId);
		if (!mapel) return fail(404, { fail: 'Mata pelajaran tidak ditemukan.' });

		await kunciNilaiMapel({
			mapelId: mapel.id,
			namaMapel: mapel.nama,
			sekolahId,
			userId: locals.user?.id ?? null,
			aktor: locals.user?.username ?? null,
			alasan: alasan || null
		});

		return { message: `Nilai ${mapel.nama} dikunci.` };
	},

	async buka({ request, locals }) {
		authority('input_nilai_kunci_nilai');
		const sekolahId = locals.sekolah?.id ?? null;
		if (!sekolahId) return fail(401, { fail: 'Sekolah aktif tidak ditemukan.' });

		const formData = await request.formData();
		const mapelId = Number(formData.get('mapelId') ?? 0);
		if (!Number.isInteger(mapelId) || mapelId <= 0) {
			return fail(400, { fail: 'Mata pelajaran tidak valid.' });
		}

		const mapel = await mapelMilikSekolah(mapelId, sekolahId);
		if (!mapel) return fail(404, { fail: 'Mata pelajaran tidak ditemukan.' });

		await bukaKunciNilaiMapel({
			mapelId: mapel.id,
			namaMapel: mapel.nama,
			sekolahId,
			userId: locals.user?.id ?? null,
			aktor: locals.user?.username ?? null
		});

		return { message: `Nilai ${mapel.nama} dibuka.` };
	},

	async kunciSemua({ request, locals }) {
		authority('input_nilai_kunci_nilai');
		const sekolahId = locals.sekolah?.id ?? null;
		if (!sekolahId) return fail(401, { fail: 'Sekolah aktif tidak ditemukan.' });

		const formData = await request.formData();
		const kelasId = Number(formData.get('kelasId') ?? 0);
		const kelas = await db.query.tableKelas.findFirst({
			columns: { id: true },
			where: eq(tableKelas.id, kelasId)
		});
		if (!kelas) return fail(404, { fail: 'Kelas tidak ditemukan.' });

		const mapelRows = await listMapelKelas(kelasId);
		for (const mapel of mapelRows) {
			await kunciNilaiMapel({
				mapelId: mapel.id,
				namaMapel: mapel.nama,
				sekolahId,
				userId: locals.user?.id ?? null,
				aktor: locals.user?.username ?? null,
				alasan: 'Dikunci massal oleh operator sekolah'
			});
		}

		return { message: `${mapelRows.length} mata pelajaran dikunci.` };
	},

	async bukaSemua({ request, locals }) {
		authority('input_nilai_kunci_nilai');
		const sekolahId = locals.sekolah?.id ?? null;
		if (!sekolahId) return fail(401, { fail: 'Sekolah aktif tidak ditemukan.' });

		const formData = await request.formData();
		const kelasId = Number(formData.get('kelasId') ?? 0);
		const kelas = await db.query.tableKelas.findFirst({
			columns: { id: true },
			where: eq(tableKelas.id, kelasId)
		});
		if (!kelas) return fail(404, { fail: 'Kelas tidak ditemukan.' });

		const mapelRows = await listMapelKelas(kelasId);
		for (const mapel of mapelRows) {
			await bukaKunciNilaiMapel({
				mapelId: mapel.id,
				namaMapel: mapel.nama,
				sekolahId,
				userId: locals.user?.id ?? null,
				aktor: locals.user?.username ?? null
			});
		}

		return { message: `Kunci nilai dibuka untuk ${mapelRows.length} mata pelajaran.` };
	}
};
