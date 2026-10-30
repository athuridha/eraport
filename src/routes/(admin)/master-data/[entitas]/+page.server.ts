import { MASTER_DATA, cariMasterData } from '$lib/admin/master-data';
import {
	hapusMasterData,
	loadAnggotaEkstrakurikuler,
	loadBarisMaster,
	loadDaftarKelasMurid,
	loadOpsiRelasi,
	simpanAnggotaEkstrakurikuler,
	simpanMasterData,
	simpanMasterDataMassal,
	ubahKelasMasterMassal
} from '$lib/admin/master-data.server';
import { pindahkanMuridKelas } from '$lib/server/murid-pindah-kelas';
import { error, fail, redirect } from '@sveltejs/kit';
import { normalisasiBarisPerHalaman } from '$lib/utils/pagination';
import { isAdminUser } from '../../../pengguna/permissions';

export const load = async ({ params, locals, url, depends }) => {
	depends('app:master-data');
	const meta: PageMeta = { title: 'Master Data' };
	const sekolahId = locals.sekolah?.id ?? null;
	const user = locals.user;

	if (!sekolahId) {
		throw error(401, 'Sekolah aktif tidak ditemukan');
	}
	if (!user || !isAdminUser(user)) {
		throw error(403, 'Master data hanya bisa dikelola admin dan kepala sekolah.');
	}

	const entitas = cariMasterData(params.entitas ?? '');
	if (!entitas) {
		throw error(404, 'Jenis master data tidak ditemukan');
	}

	// Akun pengguna dikelola lewat Data Pengguna (Guru/Operator).
	if (entitas.key === 'pengguna') {
		throw redirect(303, '/master-data/pengguna/guru');
	}

	const q = url.searchParams.get('q')?.trim() || null;
	const perHalaman = normalisasiBarisPerHalaman(url.searchParams.get('per_page'), 50);
	const page = Math.max(1, Number(url.searchParams.get('page')) || 1);
	const [daftarBaris, relasi] = await Promise.all([
		loadBarisMaster(sekolahId, entitas.key, { q, page, perPage: perHalaman }),
		loadOpsiRelasi(sekolahId)
	]);
	const daftarKelasMurid = entitas.key === 'kelas' ? await loadDaftarKelasMurid(sekolahId) : [];
	const anggotaEkstrakurikuler =
		entitas.key === 'ekstrakurikuler' ? await loadAnggotaEkstrakurikuler(sekolahId) : null;

	return {
		meta: { ...meta, title: `Master Data — ${entitas.judul}` },
		daftar: MASTER_DATA,
		entitas,
		baris: daftarBaris.baris,
		total: daftarBaris.total,
		totalHalaman: daftarBaris.totalHalaman,
		perHalaman: daftarBaris.perHalaman,
		relasi,
		daftarKelasMurid,
		anggotaEkstrakurikuler,
		filter: { q, page, perHalaman }
	};
};

export const actions = {
	async simpan({ request, locals, params }) {
		const sekolahId = locals.sekolah?.id;
		if (!sekolahId) {
			return fail(401, { fail: 'Sekolah tidak ditemukan' });
		}
		const user = locals.user;
		if (!user || !isAdminUser(user)) {
			return fail(403, { fail: 'Hanya admin/kepala sekolah yang bisa mengubah master data.' });
		}

		const formData = await request.formData();
		const idRaw = Number(formData.get('id') ?? 0);
		const id = Number.isInteger(idRaw) && idRaw > 0 ? idRaw : null;

		const hasil = await simpanMasterData(sekolahId, params.entitas ?? '', id, formData);
		if (hasil.fail) {
			return fail(400, { fail: hasil.fail });
		}
		return { message: hasil.message };
	},

	async simpanMassal({ request, locals, params }) {
		const sekolahId = locals.sekolah?.id;
		if (!sekolahId) {
			return fail(401, { fail: 'Sekolah tidak ditemukan' });
		}
		const user = locals.user;
		if (!user || !isAdminUser(user)) {
			return fail(403, { fail: 'Hanya admin/kepala sekolah yang bisa mengubah master data.' });
		}

		const formData = await request.formData();
		const hasil = await simpanMasterDataMassal(sekolahId, params.entitas ?? '', formData);
		if (hasil.fail) {
			return fail(400, { fail: hasil.fail });
		}
		return { message: hasil.message };
	},

	async hapusMassal({ request, locals, params }) {
		const sekolahId = locals.sekolah?.id;
		if (!sekolahId) {
			return fail(401, { fail: 'Sekolah tidak ditemukan' });
		}
		const user = locals.user;
		if (!user || !isAdminUser(user)) {
			return fail(403, { fail: 'Hanya admin/kepala sekolah yang bisa menghapus master data.' });
		}

		const formData = await request.formData();
		const mentah = String(formData.get('ids') ?? '[]');
		let ids: number[] = [];
		try {
			const parsed = JSON.parse(mentah);
			if (Array.isArray(parsed)) {
				ids = parsed
					.map((value) => Number(value))
					.filter((value) => Number.isInteger(value) && value > 0);
			}
		} catch {
			return fail(400, { fail: 'Data pilihan tidak valid.' });
		}
		if (!ids.length) {
			return fail(400, { fail: 'Tidak ada data yang dipilih.' });
		}

		let terhapus = 0;
		const gagal: string[] = [];
		for (const id of ids) {
			const hasil = await hapusMasterData(sekolahId, params.entitas ?? '', id);
			if (hasil.fail) gagal.push(hasil.fail);
			else terhapus += 1;
		}
		return {
			message: `${terhapus} data dihapus${gagal.length ? `, ${gagal.length} gagal: ${gagal[0]}` : ''}.`
		};
	},

	async ubahKelasMassal({ request, locals, params }) {
		const sekolahId = locals.sekolah?.id;
		if (!sekolahId) {
			return fail(401, { fail: 'Sekolah tidak ditemukan' });
		}
		const user = locals.user;
		if (!user || !isAdminUser(user)) {
			return fail(403, { fail: 'Hanya admin/kepala sekolah yang bisa mengubah master data.' });
		}
		if (params.entitas !== 'mata_pelajaran') {
			return fail(400, { fail: 'Ubah kelas massal hanya tersedia untuk mata pelajaran.' });
		}

		const formData = await request.formData();
		const hasil = await ubahKelasMasterMassal(sekolahId, formData);
		if (hasil.fail) return fail(400, { fail: hasil.fail });
		return { message: hasil.message };
	},

	async pindahMurid({ request, locals }) {
		const sekolahId = locals.sekolah?.id;
		if (!sekolahId) {
			return fail(401, { fail: 'Sekolah tidak ditemukan' });
		}
		const user = locals.user;
		if (!user || !isAdminUser(user)) {
			return fail(403, { fail: 'Hanya admin/kepala sekolah yang bisa memindahkan murid.' });
		}

		const formData = await request.formData();
		const mentah = String(formData.get('pindah') ?? '[]');
		let daftar: Array<{ muridId: number; kelasId: number }> = [];
		try {
			const parsed = JSON.parse(mentah);
			if (Array.isArray(parsed)) {
				daftar = parsed
					.map((item) => ({
						muridId: Number(item?.muridId),
						kelasId: Number(item?.kelasId)
					}))
					.filter((item) => Number.isInteger(item.muridId) && Number.isInteger(item.kelasId));
			}
		} catch {
			return fail(400, { fail: 'Data perpindahan tidak valid.' });
		}
		if (!daftar.length) {
			return fail(400, { fail: 'Tidak ada murid yang dipindahkan.' });
		}

		for (const item of daftar) {
			const hasil = await pindahkanMuridKelas({
				sekolahId,
				muridIds: [item.muridId],
				kelasId: item.kelasId
			});
			if (hasil.fail) {
				return fail(400, { fail: hasil.fail });
			}
		}
		return { message: `${daftar.length} murid dipindahkan.` };
	},

	async hapus({ request, locals, params }) {
		const sekolahId = locals.sekolah?.id;
		if (!sekolahId) {
			return fail(401, { fail: 'Sekolah tidak ditemukan' });
		}
		const user = locals.user;
		if (!user || !isAdminUser(user)) {
			return fail(403, { fail: 'Hanya admin/kepala sekolah yang bisa menghapus master data.' });
		}

		const formData = await request.formData();
		const id = Number(formData.get('id') ?? 0);
		const hasil = await hapusMasterData(sekolahId, params.entitas ?? '', id);
		if (hasil.fail) {
			return fail(400, { fail: hasil.fail });
		}
		return { message: hasil.message };
	},

	async simpanAnggota({ request, locals }) {
		const sekolahId = locals.sekolah?.id;
		if (!sekolahId) {
			return fail(401, { fail: 'Sekolah tidak ditemukan' });
		}
		const user = locals.user;
		if (!user || !isAdminUser(user)) {
			return fail(403, { fail: 'Hanya admin/kepala sekolah yang bisa mengubah anggota.' });
		}

		const formData = await request.formData();
		const ekstrakurikulerId = Number(formData.get('ekstrakurikulerId') ?? 0);
		if (!Number.isInteger(ekstrakurikulerId) || ekstrakurikulerId <= 0) {
			return fail(400, { fail: 'Ekstrakurikuler tidak valid.' });
		}

		let ids: number[] = [];
		try {
			const parsed = JSON.parse(String(formData.get('anggota') ?? '[]'));
			if (Array.isArray(parsed)) {
				ids = [
					...new Set(parsed.map(Number).filter((value) => Number.isInteger(value) && value > 0))
				];
			}
		} catch {
			return fail(400, { fail: 'Data anggota tidak valid.' });
		}

		const hasil = await simpanAnggotaEkstrakurikuler(sekolahId, ekstrakurikulerId, ids);
		if (hasil.fail) {
			return fail(400, { fail: hasil.fail });
		}
		return { message: hasil.message };
	}
};
