import db from '$lib/server/db';
import { isWaliOfKelas, isWaliKelasAccount, ownedKelasIdSet } from '$lib/server/kelas-akses';
import {
	tableEkstrakurikuler,
	tableEkstrakurikulerTujuan,
	tableKelas
} from '$lib/server/db/schema';
import { fail } from '@sveltejs/kit';
import { and, asc, eq, inArray, like, or, sql } from 'drizzle-orm';
import { readBufferToAoA } from '$lib/utils/excel.js';
import { cookieNames } from '$lib/utils';
import { isAdminUser } from '../../pengguna/permissions';

const TABLE_MISSING_MESSAGE =
	'Tabel ekstrakurikuler belum tersedia. Jalankan "pnpm db:push" untuk menerapkan migrasi terbaru.';

function isDuplicateNameError(error: unknown) {
	return (
		error instanceof Error &&
		error.message.includes('UNIQUE constraint failed') &&
		error.message.includes('ekstrakurikuler') &&
		error.message.includes('kelas_id')
	);
}

function isTableMissingError(error: unknown) {
	return (
		error instanceof Error &&
		error.message.includes('no such table') &&
		error.message.includes('ekstrakurikuler')
	);
}

/**
 * Baca cookie kelas aktif dengan fallback nilai `semua`: pada mode Semua Kelas
 * cookie bernilai `semua` (bukan angka) sehingga dianggap null oleh Number().
 */
function kelasIdDariCookie(nilai: string | undefined | null) {
	if (!nilai || nilai === 'semua') return null;
	const parsed = Number(nilai);
	return Number.isFinite(parsed) && Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

export async function load({ depends, parent, locals, url }) {
	depends('app:ekstrakurikuler');
	const { kelasAktif } = await parent();
	const kelasId = kelasAktif?.id ?? null;

	// Mode "Semua Kelas" (admin/kepala sekolah): kelola ekstrakurikuler umum
	// yang berlaku untuk semua kelas tanpa memilih kelas tertentu.
	const umumMode = !kelasId && isAdminUser(locals.user ?? undefined);

	const q = url.searchParams.get('q')?.trim() ?? '';
	const searchCondition = q ? like(tableEkstrakurikuler.nama, `%${q}%`) : undefined;

	let ekstrakurikulerRaw: Awaited<ReturnType<typeof db.query.tableEkstrakurikuler.findMany>> = [];
	let tableReady = true;
	let totalAll = 0;

	if (kelasId) {
		const baseScope = or(
			eq(tableEkstrakurikuler.kelasId, kelasId),
			eq(tableEkstrakurikuler.semuaKelas, 1)
		);
		try {
			const [countRes] = await db
				.select({ count: sql<number>`count(*)` })
				.from(tableEkstrakurikuler)
				.where(baseScope);
			totalAll = countRes?.count ?? 0;

			const rowCondition = searchCondition ? and(baseScope, searchCondition) : baseScope;
			ekstrakurikulerRaw = await db.query.tableEkstrakurikuler.findMany({
				where: rowCondition,
				orderBy: asc(tableEkstrakurikuler.createdAt)
			});
		} catch (error) {
			if (isTableMissingError(error)) {
				tableReady = false;
				ekstrakurikulerRaw = [];
			} else {
				throw error;
			}
		}
	} else if (umumMode) {
		const sekolahId = locals.sekolah?.id ?? null;
		if (sekolahId) {
			try {
				const kelasIds = (
					await db
						.select({ id: tableKelas.id })
						.from(tableKelas)
						.where(eq(tableKelas.sekolahId, sekolahId))
				).map((row) => row.id);
				if (kelasIds.length) {
					const baseScope = and(
						inArray(tableEkstrakurikuler.kelasId, kelasIds),
						eq(tableEkstrakurikuler.semuaKelas, 1)
					);
					const [countRes] = await db
						.select({ count: sql<number>`count(*)` })
						.from(tableEkstrakurikuler)
						.where(baseScope);
					totalAll = countRes?.count ?? 0;

					const rowCondition = searchCondition ? and(baseScope, searchCondition) : baseScope;
					ekstrakurikulerRaw = await db.query.tableEkstrakurikuler.findMany({
						where: rowCondition,
						orderBy: asc(tableEkstrakurikuler.createdAt)
					});
				}
			} catch (error) {
				if (isTableMissingError(error)) {
					tableReady = false;
					ekstrakurikulerRaw = [];
				} else {
					throw error;
				}
			}
		}
	}

	return {
		kelasId,
		tableReady,
		lingkupUmum: umumMode,
		ekstrakurikuler: ekstrakurikulerRaw,
		q,
		totalAll,
		kosongKarenaFilter: totalAll > 0 && ekstrakurikulerRaw.length === 0 && Boolean(q)
	};
}

export const actions = {
	add: async ({ request, locals }) => {
		const formData = await request.formData();
		const kelasIdRaw = formData.get('kelasId');
		const lingkupUmum = formData.get('lingkup')?.toString() === 'umum';
		const nama = formData.get('nama')?.toString().trim() ?? '';

		if (!nama) {
			return fail(400, { fail: 'Nama ekstrakurikuler wajib diisi' });
		}

		// Lingkup umum: berlaku untuk semua kelas, hanya admin/kepala sekolah.
		if (lingkupUmum) {
			if (!isAdminUser(locals.user ?? undefined)) {
				return fail(403, {
					fail: 'Hanya admin/kepala sekolah yang bisa menambah ekstrakurikuler umum.'
				});
			}
			const sekolahId = locals.sekolah?.id;
			if (!sekolahId) {
				return fail(400, { fail: 'Sekolah aktif tidak ditemukan' });
			}
			try {
				const bentrok = await db
					.select({ id: tableEkstrakurikuler.id })
					.from(tableEkstrakurikuler)
					.innerJoin(tableKelas, eq(tableEkstrakurikuler.kelasId, tableKelas.id))
					.where(
						and(
							eq(tableKelas.sekolahId, sekolahId),
							eq(tableEkstrakurikuler.semuaKelas, 1),
							sql`lower(trim(${tableEkstrakurikuler.nama})) = ${nama.toLowerCase()}`
						)
					)
					.limit(1);
				if (bentrok.length) {
					return fail(400, { fail: 'Ekstrakurikuler umum dengan nama itu sudah ada.' });
				}
				// Kelas acuan: kelas pertama sekolah (ekskul umum tetap butuh kelas_id).
				const [pertama] = await db
					.select({ id: tableKelas.id })
					.from(tableKelas)
					.where(eq(tableKelas.sekolahId, sekolahId))
					.orderBy(asc(tableKelas.nama))
					.limit(1);
				if (!pertama) {
					return fail(400, { fail: 'Belum ada kelas di sekolah ini.' });
				}
				await db.insert(tableEkstrakurikuler).values({ kelasId: pertama.id, nama, semuaKelas: 1 });
				return { message: 'Ekstrakurikuler umum ditambahkan (berlaku untuk semua kelas)' };
			} catch (error) {
				if (isTableMissingError(error)) {
					return fail(500, { fail: TABLE_MISSING_MESSAGE });
				}
				if (isDuplicateNameError(error)) {
					return fail(400, { fail: 'Nama ekstrakurikuler sudah digunakan' });
				}
				throw error;
			}
		}

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
					fail: 'Anda tidak memiliki izin untuk menambah ekstrakurikuler di kelas ini.'
				});
			}
		}

		try {
			const bentrok = await db
				.select({ id: tableEkstrakurikuler.id })
				.from(tableEkstrakurikuler)
				.where(
					and(
						eq(tableEkstrakurikuler.kelasId, kelasId),
						eq(tableEkstrakurikuler.semuaKelas, 0),
						sql`lower(trim(${tableEkstrakurikuler.nama})) = ${nama.toLowerCase()}`
					)
				)
				.limit(1);
			if (bentrok.length) {
				return fail(400, { fail: 'Nama ekstrakurikuler sudah digunakan di kelas ini' });
			}
			await db.insert(tableEkstrakurikuler).values({ kelasId, nama, semuaKelas: 0 });
			return { message: 'Ekstrakurikuler berhasil ditambahkan' };
		} catch (error) {
			if (isTableMissingError(error)) {
				return fail(500, { fail: TABLE_MISSING_MESSAGE });
			}
			if (isDuplicateNameError(error)) {
				return fail(400, { fail: 'Nama ekstrakurikuler sudah digunakan di kelas ini' });
			}
			throw error;
		}
	},

	update: async ({ request, locals }) => {
		const formData = await request.formData();
		const idRaw = formData.get('id');
		const kelasIdRaw = formData.get('kelasId');
		const nama = formData.get('nama')?.toString().trim() ?? '';

		if (!idRaw) {
			return fail(400, { fail: 'ID ekstrakurikuler tidak ditemukan' });
		}

		const id = Number(idRaw);
		if (!Number.isInteger(id) || id <= 0) {
			return fail(400, { fail: 'ID ekstrakurikuler tidak valid' });
		}

		// Tanpa kelasId (mode Semua Kelas): hanya admin/kepala sekolah, dan hanya
		// baris ekstrakurikuler umum yang boleh diubah.
		if (!kelasIdRaw) {
			if (!isAdminUser(locals.user ?? undefined)) {
				return fail(403, { fail: 'Pilih kelas terlebih dahulu.' });
			}
			if (!nama) {
				return fail(400, { fail: 'Nama ekstrakurikuler wajib diisi' });
			}
			try {
				const updated = await db
					.update(tableEkstrakurikuler)
					.set({ nama, updatedAt: new Date().toISOString() })
					.where(and(eq(tableEkstrakurikuler.id, id), eq(tableEkstrakurikuler.semuaKelas, 1)))
					.returning({ id: tableEkstrakurikuler.id });
				if (!updated.length) {
					return fail(404, { fail: 'Ekstrakurikuler tidak ditemukan atau sudah dihapus' });
				}
				return { message: 'Ekstrakurikuler berhasil diperbarui', id: updated[0].id };
			} catch (error) {
				if (isTableMissingError(error)) {
					return fail(500, { fail: TABLE_MISSING_MESSAGE });
				}
				if (isDuplicateNameError(error)) {
					return fail(400, { fail: 'Nama ekstrakurikuler sudah digunakan' });
				}
				throw error;
			}
		}

		const kelasId = Number(kelasIdRaw);
		if (!Number.isInteger(kelasId)) {
			return fail(400, { fail: 'Kelas tidak valid' });
		}

		// Server-side permission: wali_kelas (termasuk guru merangkap wali)
		// may only update for their own kelas
		const updateUser = locals.user as { type?: string; pegawaiId?: number | null } | null;
		if ((await isWaliKelasAccount(updateUser)) && !(await isWaliOfKelas(updateUser, kelasId))) {
			return fail(403, { fail: 'Anda tidak memiliki izin untuk mengubah di kelas ini.' });
		}

		if (!nama) {
			return fail(400, { fail: 'Nama ekstrakurikuler wajib diisi' });
		}

		try {
			const updated = await db
				.update(tableEkstrakurikuler)
				.set({ nama, updatedAt: new Date().toISOString() })
				.where(
					or(
						and(eq(tableEkstrakurikuler.id, id), eq(tableEkstrakurikuler.kelasId, kelasId)),
						and(eq(tableEkstrakurikuler.id, id), eq(tableEkstrakurikuler.semuaKelas, 1))
					)
				)
				.returning({ id: tableEkstrakurikuler.id });

			if (!updated.length) {
				return fail(404, { fail: 'Ekstrakurikuler tidak ditemukan atau sudah dihapus' });
			}

			return { message: 'Ekstrakurikuler berhasil diperbarui', id: updated[0].id };
		} catch (error) {
			if (isTableMissingError(error)) {
				return fail(500, { fail: TABLE_MISSING_MESSAGE });
			}
			if (isDuplicateNameError(error)) {
				return fail(400, { fail: 'Nama ekstrakurikuler sudah digunakan di kelas ini' });
			}
			throw error;
		}
	},

	delete: async ({ request, locals }) => {
		const formData = await request.formData();
		const rawIds = formData.getAll('ids');
		const fallbackId = formData.get('id');

		const ids = Array.from(
			new Set(
				[
					...rawIds
						.map((value) => Number(value))
						.filter((id): id is number => Number.isInteger(id) && id > 0),
					...(fallbackId ? [Number(fallbackId)] : [])
				].filter((id): id is number => Number.isInteger(id) && id > 0)
			)
		);

		if (!ids.length) {
			return fail(400, { fail: 'Pilih data ekstrakurikuler yang akan dihapus' });
		}

		try {
			const rows = await db.query.tableEkstrakurikuler.findMany({
				columns: { id: true, kelasId: true, semuaKelas: true },
				where: inArray(tableEkstrakurikuler.id, ids)
			});

			// Scope sekolah: semua baris harus milik kelas di sekolah aktif.
			const sekolahId = locals.sekolah?.id;
			const kelasSekolah = sekolahId
				? await db
						.select({ id: tableKelas.id })
						.from(tableKelas)
						.where(eq(tableKelas.sekolahId, sekolahId))
				: [];
			const kelasSekolahIds = new Set(kelasSekolah.map((row) => row.id));

			const admin = isAdminUser(locals.user ?? undefined);
			// Ekstrakurikuler umum hanya bisa dihapus admin/kepala sekolah;
			// ekstrakurikuler khusus kelas tetap boleh lewat sini.
			const bolehHapus = rows
				.filter((row) => (row.semuaKelas ? admin : true))
				.filter((row) => kelasSekolahIds.has(row.kelasId))
				.map((row) => row.id);
			const dilewati = rows.length - bolehHapus.length;
			if (!bolehHapus.length) {
				return fail(400, {
					fail: admin
						? 'Data tidak ditemukan di sekolah ini.'
						: 'Ekstrakurikuler umum hanya bisa dihapus admin/kepala sekolah.'
				});
			}

			// wali kelas (termasuk guru merangkap wali) hanya boleh menghapus
			// data di kelas yang dia wali
			const deleteUser = locals.user as { type?: string; pegawaiId?: number | null } | null;
			if (!admin && (await isWaliKelasAccount(deleteUser))) {
				const ownedIds = await ownedKelasIdSet(deleteUser);
				const rowsOwned = rows.filter((row) => bolehHapus.includes(row.id));
				if (rowsOwned.some((r) => !ownedIds.has(r.kelasId))) {
					return fail(403, {
						fail: 'Anda tidak memiliki izin untuk menghapus di kelas ini.'
					});
				}
			}
			await db.delete(tableEkstrakurikuler).where(inArray(tableEkstrakurikuler.id, bolehHapus));
			return {
				message: `${bolehHapus.length} ekstrakurikuler berhasil dihapus${dilewati ? `, ${dilewati} dilewati karena tidak berhak` : ''}`
			};
		} catch (error) {
			if (isTableMissingError(error)) {
				return fail(500, { fail: TABLE_MISSING_MESSAGE });
			}
			throw error;
		}
	},

	import_ekstra: async ({ request, cookies, locals }) => {
		// Mode Semua Kelas: cookie bernilai `semua` dianggap tanpa kelas. Admin/
		// kepala sekolah boleh mengimpor sebagai ekstrakurikuler umum.
		const kelasId = kelasIdDariCookie(cookies.get(cookieNames.ACTIVE_KELAS_ID));
		const importUser = locals.user as { type?: string; pegawaiId?: number | null } | null;
		const admin = isAdminUser(importUser);
		// Mode Semua Kelas (tanpa kelas aktif): hanya admin/kepala sekolah; hasil
		// impor menjadi ekstrakurikuler umum.
		const lingkupUmum = !kelasId;
		if (lingkupUmum && !admin) {
			return fail(400, { fail: 'Pilih kelas aktif terlebih dahulu.' });
		}
		if (
			kelasId &&
			(await isWaliKelasAccount(importUser)) &&
			!(await isWaliOfKelas(importUser, kelasId))
		) {
			return fail(403, { fail: 'Anda tidak memiliki izin untuk mengimpor di kelas ini.' });
		}

		const sekolahId = locals.sekolah?.id ?? null;
		if (!sekolahId) {
			return fail(400, { fail: 'Sekolah aktif tidak ditemukan' });
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

		// Expect header row containing: Ekstrakurikuler, Tujuan
		const headerIndex = rawRows.findIndex((row) => {
			const cols = (row ?? []).map((c) => normalizeCell(c).toLowerCase());
			return (
				cols.some((c) => c.includes('ekstrakurikuler') || c === 'ekstrakurikuler') &&
				cols.some((c) => c.includes('tujuan'))
			);
		});

		if (headerIndex === -1) {
			return fail(400, {
				fail: 'Template tidak valid. Pastikan kolom Ekstrakurikuler dan Tujuan tersedia.'
			});
		}

		const dataRows = rawRows.slice(headerIndex + 1).filter(Boolean);
		if (!dataRows.length) return fail(400, { fail: 'Tidak ada data pada file.' });

		// Parse rows into ekstrakurikuler -> array of tujuan
		type ParsedEntry = { deskripsi: string };
		const parsed = new Map<string, ParsedEntry[]>();
		let currentEkstra = '';

		for (const row of dataRows as (string | number | null | undefined)[][]) {
			const col0 = normalizeCell(row?.[0] ?? ''); // Ekstrakurikuler
			const col1 = normalizeCell(row?.[1] ?? ''); // Tujuan

			if (col0) {
				currentEkstra = col0;
			}
			if (!currentEkstra) {
				// skip rows before first ekstrakurikuler name
				continue;
			}
			if (!col1) continue; // no tujuan

			const key = currentEkstra;
			let entries = parsed.get(key);
			if (!entries) {
				entries = [];
				parsed.set(key, entries);
			}

			entries.push({ deskripsi: col1 });
		}

		if (parsed.size === 0) return fail(400, { fail: 'Tidak ada tujuan yang ditemukan.' });

		// Persist into DB: create new ekstrakurikuler when not found, otherwise insert tujuan
		// for existing ekstrakurikuler. Avoid duplicate tujuan entries.
		let insertedEkstra = 0;
		let insertedTujuan = 0;
		let skippedTujuan = 0;

		// Kelas milik sekolah: kandidat ekstra umum untuk cek duplikat.
		const kelasSekolahIds = lingkupUmum
			? (
					await db
						.select({ id: tableKelas.id })
						.from(tableKelas)
						.where(eq(tableKelas.sekolahId, sekolahId))
						.orderBy(asc(tableKelas.nama))
				).map((row) => row.id)
			: [];
		// Kelas acuan penyimpanan: ekstra umum memakai kelas pertama sekolah
		// (semuaKelas=1 tetap butuh kelas_id), lingkup kelas memakai kelas aktif.
		const kelasAcuan = lingkupUmum ? (kelasSekolahIds[0] ?? null) : kelasId;
		if (kelasAcuan == null) {
			return fail(400, { fail: 'Belum ada kelas di sekolah ini.' });
		}

		try {
			await db.transaction(async (tx) => {
				// Kandidat ekstra yang sudah ada: lingkup umum mencakup seluruh ekstra
				// umum sekolah, lingkup kelas hanya ekstra kelas aktif.
				const existingEkstra = await tx.query.tableEkstrakurikuler.findMany({
					where: lingkupUmum
						? and(
								inArray(tableEkstrakurikuler.kelasId, kelasSekolahIds),
								eq(tableEkstrakurikuler.semuaKelas, 1)
							)
						: eq(tableEkstrakurikuler.kelasId, kelasAcuan),
					columns: { id: true, nama: true }
				});

				const ekstraByName = new Map<string, number>();
				for (const e of existingEkstra) ekstraByName.set((e.nama ?? '').toLowerCase(), e.id);

				for (const [ekstraName, tujuanEntries] of parsed.entries()) {
					const lower = ekstraName.toLowerCase();
					let ekstraId = ekstraByName.get(lower) ?? null;
					if (!ekstraId) {
						// create the ekstrakurikuler automatically
						const insertRes = await tx
							.insert(tableEkstrakurikuler)
							.values({
								nama: ekstraName,
								kelasId: kelasAcuan,
								semuaKelas: lingkupUmum ? 1 : 0
							})
							.returning({ id: tableEkstrakurikuler.id });
						ekstraId = insertRes?.[0]?.id ?? null;
						if (ekstraId) {
							insertedEkstra += 1;
							ekstraByName.set(lower, ekstraId);
						}
					}
					if (!ekstraId) continue; // defensive

					// fetch existing tujuan for this ekstrakurikuler
					const existingTujuan = await tx.query.tableEkstrakurikulerTujuan.findMany({
						columns: { deskripsi: true },
						where: eq(tableEkstrakurikulerTujuan.ekstrakurikulerId, ekstraId)
					});
					const existingKeys = new Set(
						existingTujuan.map((t) => normalizeCell(t.deskripsi).toLowerCase())
					);

					const toInsertTujuan: Array<{
						deskripsi: string;
						ekstrakurikulerId: number;
					}> = [];
					for (const entry of tujuanEntries) {
						const key = normalizeCell(entry.deskripsi).toLowerCase();
						if (existingKeys.has(key)) {
							skippedTujuan += 1;
							continue;
						}
						existingKeys.add(key);
						toInsertTujuan.push({
							deskripsi: entry.deskripsi,
							ekstrakurikulerId: ekstraId
						});
					}

					if (toInsertTujuan.length) {
						await tx.insert(tableEkstrakurikulerTujuan).values(toInsertTujuan);
						insertedTujuan += toInsertTujuan.length;
					}
				}
			});
		} catch (error) {
			if (isTableMissingError(error)) {
				return fail(500, { fail: TABLE_MISSING_MESSAGE });
			}
			if (isDuplicateNameError(error)) {
				return fail(400, {
					fail: lingkupUmum
						? 'Nama ekstrakurikuler sudah digunakan sebagai ekstra umum. Periksa data yang diimpor.'
						: 'Nama ekstrakurikuler sudah digunakan di kelas ini. Periksa data yang diimpor.'
				});
			}
			throw error;
		}

		const parts = [
			`Impor selesai: ${insertedEkstra} ekstrakurikuler baru, ${insertedTujuan} tujuan ditambahkan.`
		];
		if (skippedTujuan > 0) parts.push(`${skippedTujuan} tujuan diabaikan karena sudah ada.`);
		return { message: parts.join(' ') };
	}
};
