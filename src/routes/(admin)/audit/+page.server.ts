import { error } from '@sveltejs/kit';
import { and, asc, desc, eq, like, or, sql } from 'drizzle-orm';
import db from '$lib/server/db';
import { tableAuditLog } from '$lib/server/db/schema';
import { isAdminUser } from '../../pengguna/permissions';

export const load = async ({ locals, url, depends }) => {
	depends('app:audit-log');
	const meta: PageMeta = { title: 'Jejak Audit' };
	const sekolahId = locals.sekolah?.id ?? null;
	const user = locals.user;

	if (!sekolahId) {
		throw error(401, 'Sekolah aktif tidak ditemukan');
	}
	if (!user || !isAdminUser(user)) {
		throw error(403, 'Jejak audit hanya bisa dilihat admin dan kepala sekolah.');
	}

	const q = url.searchParams.get('q')?.trim() || null;
	const aksi = url.searchParams.get('aksi')?.trim() || null;
	const dari = url.searchParams.get('dari')?.trim() || null;
	const sampai = url.searchParams.get('sampai')?.trim() || null;

	const filterKondisi = [
		eq(tableAuditLog.sekolahId, sekolahId),
		aksi ? eq(tableAuditLog.aksi, aksi) : undefined,
		q
			? or(
					like(tableAuditLog.aktor, `%${q}%`),
					like(tableAuditLog.ringkasan, `%${q}%`),
					like(tableAuditLog.aksi, `%${q}%`)
				)
			: undefined,
		dari ? sql`date(${tableAuditLog.createdAt}) >= date(${dari})` : undefined,
		sampai ? sql`date(${tableAuditLog.createdAt}) <= date(${sampai})` : undefined
	].filter(Boolean);

	const whereFilter = and(...filterKondisi);

	const [totalSemuaResult, totalCocokResult, rows, aksiRows] = await Promise.all([
		db
			.select({ total: sql<number>`count(*)` })
			.from(tableAuditLog)
			.where(eq(tableAuditLog.sekolahId, sekolahId)),
		db
			.select({ total: sql<number>`count(*)` })
			.from(tableAuditLog)
			.where(whereFilter),
		db
			.select({
				id: tableAuditLog.id,
				aksi: tableAuditLog.aksi,
				entitas: tableAuditLog.entitas,
				entitasId: tableAuditLog.entitasId,
				ringkasan: tableAuditLog.ringkasan,
				detail: tableAuditLog.detail,
				aktor: tableAuditLog.aktor,
				createdAt: tableAuditLog.createdAt
			})
			.from(tableAuditLog)
			.where(whereFilter)
			.orderBy(desc(tableAuditLog.id))
			.limit(200),
		db
			.selectDistinct({ aksi: tableAuditLog.aksi })
			.from(tableAuditLog)
			.where(eq(tableAuditLog.sekolahId, sekolahId))
			.orderBy(asc(tableAuditLog.aksi))
	]);

	const totalSemua = Number(totalSemuaResult[0]?.total ?? 0);
	const totalCocok = Number(totalCocokResult[0]?.total ?? 0);
	const adaFilter = Boolean(q || aksi || dari || sampai);
	const kosongKarenaFilter = totalSemua > 0 && totalCocok === 0 && adaFilter;

	const labelAksiDefault: Record<string, string> = {
		import_nilai: 'Impor Nilai',
		update_nilai: 'Ubah Nilai'
	};

	const opsiAksi = aksiRows
		.map((row) => row.aksi)
		.filter((a): a is string => Boolean(a && a.trim() !== ''))
		.map((nilaiAksi) => ({
			value: nilaiAksi,
			label: labelAksiDefault[nilaiAksi] ?? nilaiAksi
		}));

	return {
		meta,
		daftar: rows,
		filter: { q, aksi, dari, sampai },
		opsiAksi,
		kosongKarenaFilter
	};
};
