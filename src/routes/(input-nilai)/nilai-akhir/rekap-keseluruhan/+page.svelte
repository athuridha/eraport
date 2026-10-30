<script lang="ts">
	import { goto, invalidate } from '$app/navigation';
	import { page } from '$app/state';
	import Icon from '$lib/components/icon.svelte';
	import PindahMuridModal from '$lib/components/murid/pindah-murid-modal.svelte';
	import { buildPageNumbers, OPSI_BARIS_PER_HALAMAN } from '$lib/utils/pagination';
	import { selectAll, semuaTerpilih, toggleId } from '$lib/utils/bulk-select';
	import FilterToolbar from '$lib/components/table/filter-toolbar.svelte';
	import { setFilter, resetFilters, countActiveFilters } from '$lib/utils/url-filter';

	let { data } = $props();

	const KUNCI_FILTER = ['q', 'kelas_id', 'mapel', 'pengampu_id'];

	// svelte-ignore state_referenced_locally
	let searchTerm = $state(data.page.q ?? '');
	let selectedIds = $state<number[]>([]);
	let moveModalOpen = $state(false);

	const rekap = $derived(data.rekap);
	const statistik = $derived(data.statistik);
	const semester = $derived(rekap?.semester ?? []);
	const baris = $derived(rekap?.baris ?? []);
	const ringkasan = $derived(rekap?.ringkasan ?? []);
	const daftarKelas = $derived(data.daftarKelas ?? []);
	const daftarMapel = $derived(rekap?.daftarMapel ?? []);
	const daftarGuru = $derived(rekap?.daftarGuru ?? []);
	const filter = $derived(data.filter ?? { kelasId: null, mapel: null, pengampuId: null });
	const rekapMapel = $derived(rekap?.rekapMapel ?? []);
	const rekapGuru = $derived(rekap?.rekapGuru ?? []);

	const currentPage = $derived(data.page.currentPage ?? 1);
	const totalPages = $derived(Math.max(1, data.page.totalPages ?? 1));
	const totalItems = $derived(data.page.totalItems ?? 0);
	const perPage = $derived(data.page.perPage ?? 50);
	const nomorHalaman = $derived(buildPageNumbers(currentPage, totalPages));

	const muridTerpilih = $derived(
		baris
			.filter((row) => selectedIds.includes(row.muridId))
			.map((row) => ({
				id: row.muridId,
				nama: row.nama,
				nis: row.nis
			}))
	);
	const idsHalaman = $derived(baris.map((row) => row.muridId));

	$effect(() => {
		const latestSearchTerm = data.page.q ?? '';
		if (searchTerm !== latestSearchTerm) {
			searchTerm = latestSearchTerm;
		}
	});

	async function terapkanFilter(key: string, value: string) {
		await goto(setFilter(page.url, key, value), { replaceState: true, keepFocus: true });
	}

	async function gotoPage(pageNumber: number) {
		const search = new URLSearchParams(page.url.search);
		search.set('page', String(pageNumber));
		await goto(`${page.url.pathname}?${search.toString()}`, { keepFocus: true });
	}

	async function gotoPerHalaman(jumlah: number) {
		await goto(setFilter(page.url, 'per_page', String(jumlah)), {
			replaceState: true,
			keepFocus: true
		});
	}

	function formatScore(value: number | null | undefined) {
		if (value == null) return '—';
		return value.toLocaleString('id-ID', {
			minimumFractionDigits: 2,
			maximumFractionDigits: 2
		});
	}

	function badgeClass(kriteria: string | null) {
		switch (kriteria) {
			case 'Sangat Baik':
				return 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-200';
			case 'Baik':
				return 'bg-sky-100 text-sky-800 dark:bg-sky-900/40 dark:text-sky-200';
			case 'Cukup':
				return 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200';
			case 'Perlu Bimbingan':
				return 'bg-rose-100 text-rose-800 dark:bg-rose-900/40 dark:text-rose-200';
			default:
				return 'bg-base-200 text-base-content/60 dark:bg-base-300';
		}
	}

	function selKelas(semesterId: number) {
		const kelas = baris
			.map((row) => row.perSemester.find((sel) => sel.semesterId === semesterId)?.kelasNama)
			.filter((value): value is string => Boolean(value));
		if (!kelas.length) return '-';
		const unik = [...new Set(kelas)];
		return unik.length === 1 ? unik[0] : `${unik.length} kelas`;
	}

	const exportUrl = $derived(
		`/api/nilai-akhir/rekap-keseluruhan/export${page.url.search ? page.url.search : ''}`
	);
</script>

<div class="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
	<div>
		<h2 class="text-xl font-bold">Rekap Nilai Keseluruhan</h2>
		<p class="text-base-content/80 block text-sm">
			Nilai murid dari semester pertama hingga semester terakhir, lengkap dengan filter kelas,
			mapel, dan guru.
		</p>
	</div>
	<div class="flex flex-col gap-2 sm:flex-row sm:items-center">
		{#if selectedIds.length}
			<button
				type="button"
				class="btn btn-soft btn-primary shadow-none"
				onclick={() => (moveModalOpen = true)}
			>
				<Icon name="move" />
				Pindahkan {selectedIds.length} Murid
			</button>
		{/if}
		<a class="btn btn-outline shadow-none max-sm:w-full" href={exportUrl}>
			<Icon name="download" />
			Unduh Excel
		</a>
	</div>
</div>

<div class="stats dark:bg-base-200 shadow-md">
	<div class="stat">
		<div class="stat-title">Murid</div>
		<div class="stat-value text-lg">{statistik?.totalMurid ?? 0}</div>
		<div class="stat-desc">{statistik?.muridSudahNilai ?? 0} punya nilai</div>
	</div>
	<div class="stat">
		<div class="stat-title">Kelas</div>
		<div class="stat-value text-lg">{statistik?.totalKelas ?? 0}</div>
		<div class="stat-desc text-wrap">{statistik?.totalSemester ?? 0} semester tercatat</div>
	</div>
	<div class="stat">
		<div class="stat-title">Mata Pelajaran</div>
		<div class="stat-value text-lg">{statistik?.totalMapel ?? 0}</div>
		<div class="stat-desc text-wrap">{statistik?.totalGuru ?? 0} guru pengampu</div>
	</div>
	<div class="stat">
		<div class="stat-title">Nilai Terinput</div>
		<div class="stat-value text-lg">{statistik?.jumlahNilai ?? 0}</div>
		<div class="stat-desc">{statistik?.muridBelumNilai ?? 0} murid belum ada nilai</div>
	</div>
	<div class="stat">
		<div class="stat-title">Rata-rata Sekolah</div>
		<div class="stat-value text-lg">{formatScore(statistik?.rataRataKeseluruhan)}</div>
		<div class="stat-desc text-wrap">Semua mapel & semester</div>
	</div>
</div>

<div class="mt-4 mb-4 flex flex-col gap-2 sm:flex-row">
	<FilterToolbar
		bind:q={searchTerm}
		qPlaceholder="Nama / NIS..."
		onSearch={(value) => terapkanFilter('q', value)}
		pilih={[
			{
				name: 'kelas_id',
				label: 'Kelas',
				value: filter.kelasId ? String(filter.kelasId) : '',
				opsis: [
					{ value: '', label: 'Semua Kelas' },
					...daftarKelas.map((kelas) => ({
						value: String(kelas.id),
						label: `${kelas.nama} — ${kelas.semesterLabel}`
					}))
				],
				onChange: (v) => terapkanFilter('kelas_id', v)
			},
			{
				name: 'mapel',
				label: 'Mata Pelajaran',
				value: filter.mapel ?? '',
				opsis: [
					{ value: '', label: 'Semua Mata Pelajaran' },
					...daftarMapel.map((mapel) => ({
						value: mapel.nama,
						label: mapel.nama
					}))
				],
				onChange: (v) => terapkanFilter('mapel', v)
			},
			{
				name: 'pengampu_id',
				label: 'Guru Pengampu',
				value: filter.pengampuId ? String(filter.pengampuId) : '',
				opsis: [
					{ value: '', label: 'Semua Guru' },
					...daftarGuru.map((guru) => ({
						value: String(guru.id),
						label: guru.nama
					}))
				],
				onChange: (v) => terapkanFilter('pengampu_id', v)
			}
		]}
		aktif={countActiveFilters(page.url, KUNCI_FILTER)}
		onReset={() =>
			goto(resetFilters(page.url, KUNCI_FILTER), { replaceState: true, keepFocus: true })}
	>
		<select
			class="select bg-base-200 dark:bg-base-300 w-auto shrink dark:border-none"
			value={perPage}
			title="Baris per halaman"
			onchange={(event) => gotoPerHalaman(Number((event.currentTarget as HTMLSelectElement).value))}
		>
			{#each OPSI_BARIS_PER_HALAMAN as jumlah (jumlah)}
				<option value={jumlah}>{jumlah} / hal</option>
			{/each}
		</select>
	</FilterToolbar>
</div>

<div class="mt-6 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
	<h3 class="text-lg font-bold">Rekap Nilai Murid</h3>
</div>

{#if !semester.length}
	<div class="alert alert-warning alert-soft mt-3 flex items-center gap-3">
		<Icon name="warning" />
		<span
			>Belum ada data nilai. Data muncul setelah semester berjalan dan nilai akhir terinput.</span
		>
	</div>
{:else}
	<div
		class="bg-base-100 dark:bg-base-200 mt-3 overflow-x-auto rounded-md shadow-md dark:shadow-none"
	>
		<table class="border-base-200 table border dark:border-none">
			<thead>
				<tr class="bg-base-200 dark:bg-base-300 text-base-content text-left font-bold">
					<th class="w-10 text-center">
						<input
							type="checkbox"
							class="checkbox checkbox-sm"
							checked={semuaTerpilih(idsHalaman, selectedIds)}
							onchange={(event) =>
								(selectedIds = selectAll(
									idsHalaman,
									(event.currentTarget as HTMLInputElement).checked
								))}
						/>
					</th>
					<th style="min-width: 200px;">Nama Murid</th>
					{#each semester as sem (sem.semesterId)}
						<th class="text-center" style="min-width: 130px;">
							{sem.label}
							<span class="block text-xs font-normal opacity-70">{selKelas(sem.semesterId)}</span>
						</th>
					{/each}
					<th class="text-center" style="min-width: 130px;">Rata-rata Kumulatif</th>
					<th class="text-center" style="min-width: 90px;">Peringkat</th>
				</tr>
			</thead>
			<tbody>
				{#each baris as row (row.key)}
					<tr class={selectedIds.includes(row.muridId) ? 'bg-primary/5' : ''}>
						<td class="text-center">
							<input
								type="checkbox"
								class="checkbox checkbox-sm"
								checked={selectedIds.includes(row.muridId)}
								onchange={(event) =>
									(selectedIds = toggleId(
										selectedIds,
										row.muridId,
										(event.currentTarget as HTMLInputElement).checked
									))}
							/>
						</td>
						<td>
							<div class="font-medium">{row.nama}</div>
							<div class="text-xs opacity-60">
								{row.kelasSekarang ?? '-'} · NIS {row.nis || '-'}
							</div>
						</td>
						{#each row.perSemester as sel (sel.semesterId)}
							<td class="text-center">
								<span
									class={`badge badge-sm ${badgeClass(sel.kriteria)}`}
									title={sel.kelasNama ? `Kelas: ${sel.kelasNama}` : 'Tidak ada data kelas'}
								>
									{formatScore(sel.nilai)}
								</span>
								<span class="block text-xs opacity-60">{sel.dinilai}/{sel.total} mapel</span>
							</td>
						{/each}
						<td class="text-center">
							<span class={`badge badge-sm ${badgeClass(row.kriteriaKumulatif)}`}>
								{formatScore(row.rataKumulatif)}
							</span>
						</td>
						<td class="text-center font-semibold">{row.peringkat}</td>
					</tr>
				{:else}
					<tr>
						<td colspan={semester.length + 5} class="py-6 text-center opacity-70">
							Tidak ada murid yang cocok.
						</td>
					</tr>
				{/each}
			</tbody>
			<tfoot>
				<tr class="bg-base-200 dark:bg-base-300 font-semibold">
					<td></td>
					<td>Rata-rata Kelas</td>
					{#each ringkasan as item (item.semesterId)}
						<td class="text-center">
							{formatScore(item.nilai)}
							<span class="block text-xs font-normal opacity-70">{item.dinilai} nilai</span>
						</td>
					{/each}
					<td colspan="2"></td>
				</tr>
			</tfoot>
		</table>
	</div>

	<div class="mt-3 flex flex-col items-center gap-3 sm:flex-row sm:justify-between">
		<p class="text-base-content/60 text-xs">
			Menampilkan {Math.min(perPage, Math.max(0, totalItems - (currentPage - 1) * perPage))} dari
			{totalItems} murid
		</p>
		<div class="flex flex-col items-center gap-2 sm:flex-row sm:items-center">
			<label class="flex items-center gap-2 text-xs">
				Baris per halaman
				<select
					class="select select-bordered select-sm"
					value={perPage}
					onchange={(event) =>
						gotoPerHalaman(Number((event.currentTarget as HTMLSelectElement).value))}
				>
					{#each OPSI_BARIS_PER_HALAMAN as jumlah (jumlah)}
						<option value={jumlah}>{jumlah}</option>
					{/each}
				</select>
			</label>
			<div class="join">
				<button
					type="button"
					class="btn btn-sm join-item"
					disabled={currentPage <= 1}
					onclick={() => gotoPage(currentPage - 1)}
				>
					&laquo;
				</button>
				{#each nomorHalaman as nomor, index (index)}
					{#if nomor === '…'}
						<button type="button" class="btn btn-sm join-item pointer-events-none">…</button>
					{:else}
						<button
							type="button"
							class="btn btn-sm join-item"
							class:btn-active={nomor === currentPage}
							onclick={() => gotoPage(nomor)}
						>
							{nomor}
						</button>
					{/if}
				{/each}
				<button
					type="button"
					class="btn btn-sm join-item"
					disabled={currentPage >= totalPages}
					onclick={() => gotoPage(currentPage + 1)}
				>
					&raquo;
				</button>
			</div>
		</div>
	</div>
{/if}

<div class="mt-8 grid gap-4 lg:grid-cols-2">
	<div class="bg-base-100 dark:bg-base-200 overflow-x-auto rounded-md shadow-md dark:shadow-none">
		<h3 class="px-4 pt-4 text-lg font-bold">Rekap per Mata Pelajaran</h3>
		<table class="border-base-200 table-sm table border dark:border-none">
			<thead>
				<tr class="bg-base-200 dark:bg-base-300 text-left font-bold">
					<th>Mata Pelajaran</th>
					<th>Guru</th>
					<th class="text-center">Kelas</th>
					<th class="text-center">Nilai</th>
					<th class="text-center">Rata-rata</th>
				</tr>
			</thead>
			<tbody>
				{#each rekapMapel as item (item.nama)}
					<tr>
						<td>{item.nama}</td>
						<td class="text-xs opacity-70">{item.guru.join(', ') || '-'}</td>
						<td class="text-center">{item.kelas}</td>
						<td class="text-center">{item.jumlahNilai}</td>
						<td class="text-center font-semibold">{formatScore(item.rataRata)}</td>
					</tr>
				{:else}
					<tr>
						<td colspan="5" class="py-4 text-center opacity-70">Belum ada nilai.</td>
					</tr>
				{/each}
			</tbody>
		</table>
	</div>

	<div class="bg-base-100 dark:bg-base-200 overflow-x-auto rounded-md shadow-md dark:shadow-none">
		<h3 class="px-4 pt-4 text-lg font-bold">Rekap per Guru</h3>
		<table class="border-base-200 table-sm table border dark:border-none">
			<thead>
				<tr class="bg-base-200 dark:bg-base-300 text-left font-bold">
					<th>Guru Pengampu</th>
					<th>Mata Pelajaran</th>
					<th class="text-center">Murid</th>
					<th class="text-center">Nilai</th>
					<th class="text-center">Rata-rata</th>
				</tr>
			</thead>
			<tbody>
				{#each rekapGuru as item (item.id)}
					<tr>
						<td>{item.nama}</td>
						<td class="text-xs opacity-70">{item.mapel.join(', ')}</td>
						<td class="text-center">{item.jumlahMurid}</td>
						<td class="text-center">{item.jumlahNilai}</td>
						<td class="text-center font-semibold">{formatScore(item.rataRata)}</td>
					</tr>
				{:else}
					<tr>
						<td colspan="5" class="py-4 text-center opacity-70">Belum ada nilai.</td>
					</tr>
				{/each}
			</tbody>
		</table>
	</div>
</div>

<PindahMuridModal
	bind:isOpen={moveModalOpen}
	{muridTerpilih}
	kelasTujuan={daftarKelas.map((kelas) => ({
		id: kelas.id,
		nama: kelas.nama,
		fase: kelas.fase,
		semesterNama: kelas.semesterLabel
	}))}
	action="?/pindahMurid"
	onSuccess={() => {
		selectedIds = [];
		void invalidate('app:rekap-keseluruhan');
	}}
/>
