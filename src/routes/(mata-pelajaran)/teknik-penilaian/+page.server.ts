import db from '$lib/server/db';
import { tableSekolah, tableTeknikPenilaian, tableTujuanPembelajaran } from '$lib/server/db/schema';
import {
	ensureTeknikPenilaianSchema,
	seedDefaultTeknikPenilaian
} from '$lib/server/db/ensure-teknik-penilaian';
import { fail, redirect } from '@sveltejs/kit';
import { and, asc, eq, like, or, sql } from 'drizzle-orm';
import { isAuthorizedUser } from '../../pengguna/permissions';

export async function load({ locals, url }) {
	if (!locals.user) throw redirect(303, '/login');
	if (!isAuthorizedUser(['mata_pelajaran_intrakurikuler'], locals.user)) {
		throw redirect(303, '/forbidden?required=mata_pelajaran_intrakurikuler');
	}

	await ensureTeknikPenilaianSchema();

	const sekolahId = locals.sekolah?.id;
	if (!sekolahId) throw redirect(303, '/');

	const q = url.searchParams.get('q')?.trim() ?? '';
	const searchCondition = q
		? or(
				like(tableTeknikPenilaian.nama, `%${q}%`),
				like(tableTeknikPenilaian.singkatan, `%${q}%`),
				like(tableTeknikPenilaian.keterangan, `%${q}%`)
			)
		: undefined;

	// Auto-seed if empty
	const countRows = await db
		.select({ count: sql<number>`count(*)` })
		.from(tableTeknikPenilaian)
		.where(eq(tableTeknikPenilaian.sekolahId, sekolahId));

	const totalSemua = countRows[0]?.count ?? 0;
	if (totalSemua === 0) {
		await seedDefaultTeknikPenilaian(sekolahId);
	}

	const whereCondition = searchCondition
		? and(eq(tableTeknikPenilaian.sekolahId, sekolahId), searchCondition)
		: eq(tableTeknikPenilaian.sekolahId, sekolahId);

	const rows = await db
		.select({
			id: tableTeknikPenilaian.id,
			nama: tableTeknikPenilaian.nama,
			singkatan: tableTeknikPenilaian.singkatan,
			keterangan: tableTeknikPenilaian.keterangan,
			urutan: tableTeknikPenilaian.urutan,
			totalTp: sql<number>`count(${tableTujuanPembelajaran.id})`
		})
		.from(tableTeknikPenilaian)
		.leftJoin(
			tableTujuanPembelajaran,
			eq(tableTujuanPembelajaran.teknikPenilaianId, tableTeknikPenilaian.id)
		)
		.where(whereCondition)
		.groupBy(tableTeknikPenilaian.id)
		.orderBy(asc(tableTeknikPenilaian.urutan), asc(tableTeknikPenilaian.nama));

	const sekolah = await db.query.tableSekolah.findFirst({
		where: eq(tableSekolah.id, sekolahId),
		columns: { nama: true }
	});

	return {
		sekolahNama: sekolah?.nama ?? 'Sekolah',
		daftarTeknik: rows,
		q,
		kosongKarenaFilter: totalSemua > 0 && rows.length === 0 && Boolean(q)
	};
}

export const actions = {
	async tambah({ request, locals }) {
		if (!locals.user || !isAuthorizedUser(['mata_pelajaran_intrakurikuler'], locals.user)) {
			return fail(403, { fail: 'Anda tidak memiliki hak akses.' });
		}
		const sekolahId = locals.sekolah?.id;
		if (!sekolahId) return fail(401, { fail: 'Sekolah tidak ditemukan.' });

		const formData = await request.formData();
		const nama = formData.get('nama')?.toString()?.trim();
		const singkatan = formData.get('singkatan')?.toString()?.trim().toUpperCase();
		const keterangan = formData.get('keterangan')?.toString()?.trim() || null;
		const urutan = Number(formData.get('urutan')) || 0;

		if (!nama) return fail(400, { fail: 'Nama teknik penilaian wajib diisi.' });
		if (!singkatan) return fail(400, { fail: 'Singkatan teknik penilaian wajib diisi.' });

		// Check duplicate
		const existing = await db.query.tableTeknikPenilaian.findFirst({
			where: and(
				eq(tableTeknikPenilaian.sekolahId, sekolahId),
				sql`(lower(${tableTeknikPenilaian.nama}) = ${nama.toLowerCase()} or upper(${tableTeknikPenilaian.singkatan}) = ${singkatan})`
			)
		});

		if (existing) {
			return fail(400, { fail: `Teknik penilaian dengan nama/singkatan tersebut sudah ada.` });
		}

		await db.insert(tableTeknikPenilaian).values({
			sekolahId,
			nama,
			singkatan,
			keterangan,
			urutan,
			createdAt: new Date().toISOString()
		});

		return { message: `Teknik penilaian "${nama}" (${singkatan}) berhasil ditambahkan.` };
	},

	async ubah({ request, locals }) {
		if (!locals.user || !isAuthorizedUser(['mata_pelajaran_intrakurikuler'], locals.user)) {
			return fail(403, { fail: 'Anda tidak memiliki hak akses.' });
		}
		const sekolahId = locals.sekolah?.id;
		if (!sekolahId) return fail(401, { fail: 'Sekolah tidak ditemukan.' });

		const formData = await request.formData();
		const id = Number(formData.get('id'));
		const nama = formData.get('nama')?.toString()?.trim();
		const singkatan = formData.get('singkatan')?.toString()?.trim().toUpperCase();
		const keterangan = formData.get('keterangan')?.toString()?.trim() || null;
		const urutan = Number(formData.get('urutan')) || 0;

		if (!Number.isInteger(id) || id <= 0) return fail(400, { fail: 'ID teknik tidak valid.' });
		if (!nama) return fail(400, { fail: 'Nama teknik penilaian wajib diisi.' });
		if (!singkatan) return fail(400, { fail: 'Singkatan teknik penilaian wajib diisi.' });

		await db
			.update(tableTeknikPenilaian)
			.set({
				nama,
				singkatan,
				keterangan,
				urutan,
				updatedAt: new Date().toISOString()
			})
			.where(and(eq(tableTeknikPenilaian.id, id), eq(tableTeknikPenilaian.sekolahId, sekolahId)));

		return { message: `Teknik penilaian berhasil diperbarui.` };
	},

	async hapus({ request, locals }) {
		if (!locals.user || !isAuthorizedUser(['mata_pelajaran_intrakurikuler'], locals.user)) {
			return fail(403, { fail: 'Anda tidak memiliki hak akses.' });
		}
		const sekolahId = locals.sekolah?.id;
		if (!sekolahId) return fail(401, { fail: 'Sekolah tidak ditemukan.' });

		const formData = await request.formData();
		const id = Number(formData.get('id'));

		if (!Number.isInteger(id) || id <= 0) return fail(400, { fail: 'ID teknik tidak valid.' });

		// Set linked TP teknikPenilaianId to null before deletion
		await db
			.update(tableTujuanPembelajaran)
			.set({ teknikPenilaianId: null })
			.where(eq(tableTujuanPembelajaran.teknikPenilaianId, id));

		await db
			.delete(tableTeknikPenilaian)
			.where(and(eq(tableTeknikPenilaian.id, id), eq(tableTeknikPenilaian.sekolahId, sekolahId)));

		return { message: 'Teknik penilaian berhasil dihapus.' };
	},

	async resetDefault({ locals }) {
		if (!locals.user || !isAuthorizedUser(['mata_pelajaran_intrakurikuler'], locals.user)) {
			return fail(403, { fail: 'Anda tidak memiliki hak akses.' });
		}
		const sekolahId = locals.sekolah?.id;
		if (!sekolahId) return fail(401, { fail: 'Sekolah tidak ditemukan.' });

		await seedDefaultTeknikPenilaian(sekolahId);
		return { message: 'Teknik penilaian standar berhasil diperbarui.' };
	}
};
