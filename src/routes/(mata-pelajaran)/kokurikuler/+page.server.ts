import db from '$lib/server/db';
import { isWaliOfKelas, isWaliKelasAccount, ownedKelasIdSet } from '$lib/server/kelas-akses';
import { tableKelas, tableKokurikuler } from '$lib/server/db/schema';
import {
	profilPelajarPancasilaDimensions,
	profilPelajarPancasilaDimensionLabelByKey,
	type DimensiProfilLulusanKey
} from '$lib/statics';
import { fail } from '@sveltejs/kit';
import { and, asc, count, eq, inArray, or, sql } from 'drizzle-orm';
import { readBufferToAoA } from '$lib/utils/excel.js';
import { cookieNames } from '$lib/utils';

const DIMENSION_KEY_SET = new Set<DimensiProfilLulusanKey>(
	profilPelajarPancasilaDimensions.map((dimension) => dimension.key)
);

const TABLE_MISSING_MESSAGE =
	'Tabel kokurikuler belum tersedia. Jalankan "pnpm db:push" untuk menerapkan migrasi terbaru.';

function sanitizeDimensions(values: string[]): DimensiProfilLulusanKey[] {
	const unique = new Set<DimensiProfilLulusanKey>();
	for (const value of values) {
		if (DIMENSION_KEY_SET.has(value as DimensiProfilLulusanKey)) {
			unique.add(value as DimensiProfilLulusanKey);
		}
	}
	return Array.from(unique);
}

function isTableMissingError(error: unknown) {
	return (
		error instanceof Error &&
		error.message.includes('no such table') &&
		error.message.includes('kokurikuler')
	);
}

export async function load({ depends, parent, url, locals }) {
	depends('app:kokurikuler');
	const { kelasAktif } = await parent();
	const kelasId = kelasAktif?.id ?? null;
	const sekolahId = locals?.sekolah?.id ?? null;

	const q = url.searchParams.get('q')?.trim() ?? '';
	const dimensiParam = url.searchParams.get('dimensi')?.trim() ?? '';

	let kokurikulerRaw: Awaited<ReturnType<typeof db.query.tableKokurikuler.findMany>> = [];
	let tableReady = true;
	let totalSemua = 0;
	let totalFiltered = 0;
	let opsiDimensi: Array<{ value: string; label: string }> = [];

	if (kelasId) {
		try {
			const conditions = [eq(tableKokurikuler.kelasId, kelasId)];

			if (q) {
				const likePattern = `%${q}%`;
				conditions.push(
					or(
						sql`${tableKokurikuler.kode} LIKE ${likePattern} COLLATE NOCASE`,
						sql`${tableKokurikuler.tujuan} LIKE ${likePattern} COLLATE NOCASE`
					)!
				);
			}

			if (dimensiParam) {
				conditions.push(
					sql`EXISTS (SELECT 1 FROM json_each(${tableKokurikuler.dimensi}) WHERE json_each.value = ${dimensiParam})`
				);
			}

			const whereCondition = and(...conditions);

			const [[{ countSemua }], [{ countFiltered }], rows, rawDimensiRows] = await Promise.all([
				db
					.select({ countSemua: count() })
					.from(tableKokurikuler)
					.where(eq(tableKokurikuler.kelasId, kelasId)),
				db.select({ countFiltered: count() }).from(tableKokurikuler).where(whereCondition),
				db.query.tableKokurikuler.findMany({
					where: whereCondition,
					orderBy: asc(tableKokurikuler.createdAt)
				}),
				db
					.selectDistinct({
						dimensiKey: sql<string>`json_each.value`
					})
					.from(tableKokurikuler)
					.innerJoin(
						tableKelas,
						sekolahId
							? and(
									eq(tableKokurikuler.kelasId, tableKelas.id),
									eq(tableKelas.sekolahId, sekolahId)
								)
							: eq(tableKokurikuler.kelasId, tableKelas.id)
					)
					.innerJoin(sql`json_each(${tableKokurikuler.dimensi})`, sql`1=1`)
					.where(eq(tableKokurikuler.kelasId, kelasId))
					.orderBy(sql`json_each.value ASC`)
			]);

			kokurikulerRaw = rows;
			totalSemua = countSemua;
			totalFiltered = countFiltered;
			opsiDimensi = rawDimensiRows
				.map((r) => r.dimensiKey)
				.filter((k): k is string => Boolean(k))
				.map((key) => ({
					value: key,
					label: profilPelajarPancasilaDimensionLabelByKey[key as DimensiProfilLulusanKey] ?? key
				}));
		} catch (error) {
			if (isTableMissingError(error)) {
				tableReady = false;
				kokurikulerRaw = [];
				totalSemua = 0;
				totalFiltered = 0;
				opsiDimensi = [];
			} else {
				throw error;
			}
		}
	}

	return {
		kelasId,
		tableReady,
		totalSemua,
		totalFiltered,
		opsiDimensi,
		filters: {
			q,
			dimensi: dimensiParam
		},
		kokurikuler: kokurikulerRaw.map((item) => ({
			...item,
			dimensi: Array.isArray(item.dimensi)
				? (item.dimensi as DimensiProfilLulusanKey[])
				: sanitizeDimensions(
						typeof item.dimensi === 'string'
							? (() => {
									try {
										return JSON.parse(item.dimensi) as string[];
									} catch (error) {
										console.error('Gagal mengurai dimensi kokurikuler', error);
										return [];
									}
								})()
							: []
					)
		})),
		dimensiPilihan: profilPelajarPancasilaDimensions
	};
}

export const actions = {
	add: async ({ request, locals }) => {
		const formData = await request.formData();
		const kelasIdRaw = formData.get('kelasId');
		const kode = formData.get('kode')?.toString().trim().toUpperCase() ?? '';
		const tujuan = formData.get('kokurikuler')?.toString().trim() ?? '';
		const dimensi = sanitizeDimensions(
			formData.getAll('dimensi').map((value) => value?.toString() ?? '')
		);

		if (!kelasIdRaw) {
			return fail(400, { fail: 'Kelas aktif tidak ditemukan' });
		}

		const kelasId = Number(kelasIdRaw);
		if (!Number.isInteger(kelasId)) {
			return fail(400, { fail: 'Kelas tidak valid' });
		}

		// Server-side permission: wali kelas (termasuk guru merangkap wali)
		// may only add for their own kelas
		if (locals?.user && (await isWaliKelasAccount(locals.user))) {
			const u = locals.user as { pegawaiId?: number | null };

			const owned = u.pegawaiId
				? await db.query.tableKelas.findFirst({
						columns: { id: true },
						where: and(eq(tableKelas.id, kelasId), eq(tableKelas.waliKelasId, u.pegawaiId))
					})
				: null;
			if (!owned) {
				return fail(403, {
					fail: 'Anda tidak memiliki izin untuk menambah kokurikuler di kelas ini.'
				});
			}
		}

		if (!dimensi.length) {
			return fail(400, { fail: 'Pilih minimal satu dimensi profil lulusan' });
		}

		if (!kode) {
			return fail(400, { fail: 'Kode kokurikuler wajib diisi' });
		}

		if (!tujuan) {
			return fail(400, { fail: 'Kegiatan kokurikuler wajib diisi' });
		}

		try {
			const existing = await db.query.tableKokurikuler.findFirst({
				columns: { id: true },
				where: eq(tableKokurikuler.kode, kode)
			});
			if (existing) {
				return fail(400, { fail: 'Kode sudah digunakan' });
			}

			await db.insert(tableKokurikuler).values({
				kelasId,
				kode,
				dimensi,
				tujuan
			});

			return { message: 'Kokurikuler berhasil ditambahkan', kode };
		} catch (error) {
			if (isTableMissingError(error)) {
				return fail(500, { fail: TABLE_MISSING_MESSAGE });
			}
			throw error;
		}
	},

	delete: async ({ request, locals }) => {
		const formData = await request.formData();
		const ids = Array.from(
			new Set(
				formData
					.getAll('ids')
					.map((id) => Number(id))
					.filter((id): id is number => Number.isInteger(id) && id > 0)
			)
		);

		if (ids.length === 0) {
			return fail(400, { fail: 'Pilih data kokurikuler yang akan dihapus' });
		}

		try {
			// wali kelas (termasuk guru merangkap wali) hanya boleh menghapus
			// data di kelas yang dia wali
			const deleteUser = locals.user as { type?: string; pegawaiId?: number | null } | null;
			if (await isWaliKelasAccount(deleteUser)) {
				const ownedIds = await ownedKelasIdSet(deleteUser);
				const rows = await db.query.tableKokurikuler.findMany({
					columns: { id: true, kelasId: true },
					where: inArray(tableKokurikuler.id, ids)
				});
				if (rows.some((r) => !ownedIds.has(r.kelasId))) {
					return fail(403, {
						fail: 'Anda tidak memiliki izin untuk menghapus di kelas ini.'
					});
				}
			}
			await db.delete(tableKokurikuler).where(inArray(tableKokurikuler.id, ids));
		} catch (error) {
			if (isTableMissingError(error)) {
				return fail(500, { fail: TABLE_MISSING_MESSAGE });
			}
			throw error;
		}

		return { message: `${ids.length} kokurikuler berhasil dihapus` };
	},
	update: async ({ request, locals }) => {
		const formData = await request.formData();
		const idRaw = formData.get('id');
		const kelasIdRaw = formData.get('kelasId');
		const kode = formData.get('kode')?.toString().trim().toUpperCase() ?? '';
		const tujuan = formData.get('kokurikuler')?.toString().trim() ?? '';
		const dimensi = sanitizeDimensions(
			formData.getAll('dimensi').map((value) => value?.toString() ?? '')
		);

		if (!idRaw) {
			return fail(400, { fail: 'ID kokurikuler tidak ditemukan' });
		}

		const id = Number(idRaw);
		if (!Number.isInteger(id) || id <= 0) {
			return fail(400, { fail: 'ID kokurikuler tidak valid' });
		}

		if (!kelasIdRaw) {
			return fail(400, { fail: 'Kelas aktif tidak ditemukan' });
		}

		const kelasId = Number(kelasIdRaw);
		if (!Number.isInteger(kelasId)) {
			return fail(400, { fail: 'Kelas tidak valid' });
		}

		// Server-side permission: wali_kelas (termasuk guru merangkap wali)
		// may only update for their own kelas
		const updateUser = locals.user as { type?: string; pegawaiId?: number | null } | null;
		if ((await isWaliKelasAccount(updateUser)) && !(await isWaliOfKelas(updateUser, kelasId))) {
			return fail(403, {
				fail: 'Anda tidak memiliki izin untuk mengubah di kelas ini.'
			});
		}

		if (!dimensi.length) {
			return fail(400, { fail: 'Pilih minimal satu dimensi profil lulusan' });
		}

		if (!kode) {
			return fail(400, { fail: 'Kode kokurikuler wajib diisi' });
		}

		if (!tujuan) {
			return fail(400, { fail: 'Kegiatan kokurikuler wajib diisi' });
		}

		try {
			const existing = await db.query.tableKokurikuler.findFirst({
				columns: { id: true },
				where: eq(tableKokurikuler.kode, kode)
			});
			if (existing && existing.id !== id) {
				return fail(400, { fail: 'Kode sudah digunakan' });
			}

			const updated = await db
				.update(tableKokurikuler)
				.set({ kode, dimensi, tujuan, updatedAt: new Date().toISOString() })
				.where(and(eq(tableKokurikuler.id, id), eq(tableKokurikuler.kelasId, kelasId)))
				.returning({ id: tableKokurikuler.id });

			if (!updated.length) {
				return fail(404, { fail: 'Kokurikuler tidak ditemukan atau sudah dihapus' });
			}

			return { message: 'Kokurikuler berhasil diperbarui', id };
		} catch (error) {
			if (isTableMissingError(error)) {
				return fail(500, { fail: TABLE_MISSING_MESSAGE });
			}
			throw error;
		}
	},

	import_kokurikuler: async ({ request, cookies, locals }) => {
		const kelasIdCookie = cookies.get(cookieNames.ACTIVE_KELAS_ID) || null;
		const kelasId = kelasIdCookie ? Number(kelasIdCookie) : null;
		if (!kelasId || !Number.isFinite(kelasId)) {
			return fail(400, { fail: 'Pilih kelas aktif terlebih dahulu.' });
		}

		// Server-side permission: wali_kelas (termasuk guru merangkap wali)
		// may only import for their own kelas
		const importUser = locals.user as { type?: string; pegawaiId?: number | null } | null;
		if ((await isWaliKelasAccount(importUser)) && !(await isWaliOfKelas(importUser, kelasId))) {
			return fail(403, { fail: 'Anda tidak memiliki izin untuk mengimpor di kelas ini.' });
		}

		const MAX_IMPORT_FILE_SIZE = 2 * 1024 * 1024; // 2MB

		function normalizeCell(value: unknown) {
			if (value == null) return '';
			if (typeof value === 'string') return value.trim();
			if (typeof value === 'number') return value.toString().trim();
			return String(value).trim();
		}

		function isXlsxMime(type: string | null | undefined) {
			if (!type) return false;
			return type === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
		}

		const formData = await request.formData();
		const file = formData.get('file');
		if (!(file instanceof File) || file.size === 0) {
			return fail(400, { fail: 'File Excel belum dipilih.' });
		}

		if (file.size > MAX_IMPORT_FILE_SIZE) {
			return fail(400, { fail: 'Ukuran file melebihi 2MB.' });
		}

		const filename = (file.name ?? '').toLowerCase();
		if (!filename.endsWith('.xlsx') && !isXlsxMime(file.type)) {
			return fail(400, { fail: 'Format file harus .xlsx.' });
		}

		let rawRows;
		try {
			const buffer = Buffer.from(await file.arrayBuffer());
			rawRows = await readBufferToAoA(buffer);
		} catch (error) {
			console.error('Gagal membaca file Excel', error);
			return fail(400, { fail: 'Gagal membaca file Excel. Pastikan format sesuai.' });
		}

		if (!Array.isArray(rawRows) || rawRows.length === 0) {
			return fail(400, { fail: 'File Excel tidak berisi data.' });
		}

		// Expect header row containing: Kode, Dimensi, Kegiatan
		const headerIndex = rawRows.findIndex((row) => {
			const cols = (row ?? []).map((c) => normalizeCell(c).toLowerCase());
			return cols.some((c) => c.includes('kode')) && cols.some((c) => c.includes('kegiatan'));
		});

		if (headerIndex === -1) {
			return fail(400, {
				fail: 'Template tidak valid. Pastikan kolom Kode dan Kegiatan tersedia.'
			});
		}

		const dataRows = rawRows.slice(headerIndex + 1).filter(Boolean);
		if (!dataRows.length) return fail(400, { fail: 'Tidak ada data pada file.' });

		const dimensionKeyByLabel = new Map<string, DimensiProfilLulusanKey>();
		for (const dimension of profilPelajarPancasilaDimensions) {
			dimensionKeyByLabel.set(dimension.key.toLowerCase(), dimension.key);
			dimensionKeyByLabel.set(dimension.label.toLowerCase(), dimension.key);
		}

		function parseDimensions(value: string): DimensiProfilLulusanKey[] {
			const result: DimensiProfilLulusanKey[] = [];
			for (const part of value.split(',')) {
				const key = dimensionKeyByLabel.get(normalizeCell(part).toLowerCase());
				if (key && !result.includes(key)) result.push(key);
			}
			return result;
		}

		type ParsedEntry = { kode: string; dimensi: DimensiProfilLulusanKey[]; tujuan: string };
		const parsed: ParsedEntry[] = [];

		for (const row of dataRows as (string | number | null | undefined)[][]) {
			const rawKode = normalizeCell(row?.[0] ?? '');
			const rawDimensi = normalizeCell(row?.[1] ?? '');
			const rawTujuan = normalizeCell(row?.[2] ?? '');

			if (!rawKode) continue; // skip rows without kode
			const dimensi = parseDimensions(rawDimensi || '');
			if (dimensi.length === 0) continue; // skip rows without valid dimensi
			parsed.push({
				kode: rawKode.toUpperCase(),
				dimensi,
				tujuan: rawTujuan
			});
		}

		if (parsed.length === 0) return fail(400, { fail: 'Tidak ada data yang valid pada file.' });

		// Persist: insert new kokurikuler, skip existing kode (unique constraint prevents dups).
		let inserted = 0;
		let skipped = 0;

		try {
			// kode is globally unique across all classes, so dedup against all rows,
			// not just the current kelas.
			const existing = await db.query.tableKokurikuler.findMany({
				columns: { kode: true }
			});
			const existingCodes = new Set(existing.map((row) => row.kode.toLowerCase()));

			const unique = new Map<string, ParsedEntry>();
			for (const entry of parsed) {
				const key = entry.kode.toLowerCase();
				if (existingCodes.has(key) || unique.has(key)) {
					skipped += 1;
					continue;
				}
				unique.set(key, entry);
			}

			if (unique.size > 0) {
				await db.insert(tableKokurikuler).values(
					Array.from(unique.values()).map((entry) => ({
						kelasId,
						kode: entry.kode,
						dimensi: entry.dimensi,
						tujuan: entry.tujuan
					}))
				);
				inserted = unique.size;
			}
		} catch (error) {
			if (isTableMissingError(error)) {
				return fail(500, { fail: TABLE_MISSING_MESSAGE });
			}
			throw error;
		}

		const parts = [`Impor selesai: ${inserted} kokurikuler baru ditambahkan.`];
		if (skipped > 0) {
			parts.push(`${skipped} diabaikan karena kode sudah ada.`);
		}
		return { message: parts.join(' ') };
	}
};
