<script lang="ts">
	import Icon from '$lib/components/icon.svelte';
	import FilterToolbar from '$lib/components/table/filter-toolbar.svelte';
	import { page } from '$app/state';
	import { goto } from '$app/navigation';
	import { setFilter, resetFilters, countActiveFilters } from '$lib/utils/url-filter';

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

	type PageData = {
		kelas: KelasRekap[];
		daftarKelas: OpsiKelas[];
		filters: {
			q: string;
			kelasId: string;
		};
		kosongKarenaFilter: boolean;
	};

	let { data }: { data: PageData } = $props();

	const KUNCI_FILTER = ['q', 'kelas_id'];

	// svelte-ignore state_referenced_locally
	let searchTerm = $state(data.filters.q);

	$effect(() => {
		const latestQ = data.filters.q;
		if (searchTerm !== latestQ) {
			searchTerm = latestQ;
		}
	});

	async function terapkanFilter(key: string, value: string) {
		await goto(setFilter(page.url, key, value), { replaceState: true, keepFocus: true });
	}

	// Badge color by total points: >=30 needs parent summons, >=15 needs
	// monitoring, >0 is fine, 0 is neutral.
	function badgePoin(total: number) {
		if (total >= 30) return { cls: 'badge-error', label: 'Panggil Orang Tua' };
		if (total >= 15) return { cls: 'badge-warning', label: 'Pemantauan' };
		if (total > 0) return { cls: 'badge-success', label: 'Aman' };
		return { cls: 'badge-ghost', label: 'Bersih' };
	}

	function cetak() {
		window.print();
	}
</script>

<div class="card bg-base-100 rounded-lg border border-none p-4 shadow-md">
	<div class="mb-4 flex flex-wrap items-start justify-between gap-2 no-print">
		<div>
			<h2 class="flex items-center gap-2 text-xl font-bold">
				<Icon name="warning" />
				Rekap Poin Siswa
			</h2>
			<p class="text-base-content/80 text-sm">Seluruh kelas · Rekap poin tata tertib</p>
		</div>
		<div class="flex gap-2">
			<a href="/poin-siswa" class="btn btn-ghost btn-sm">
				<Icon name="users" />
				Kembali
			</a>
			<button type="button" class="btn btn-primary btn-sm" onclick={cetak} title="Cetak rekap">
				<Icon name="print" />
				Cetak
			</button>
		</div>
	</div>

	<div class="mb-4 no-print">
		<FilterToolbar
			bind:q={searchTerm}
			qPlaceholder="Cari nama murid..."
			onSearch={(value) => terapkanFilter('q', value)}
			pilih={[
				{
					name: 'kelas_id',
					label: 'Kelas',
					value: data.filters.kelasId,
					opsis: [
						{ value: '', label: 'Semua Kelas' },
						...data.daftarKelas.map((k) => ({
							value: String(k.id),
							label: `Kelas ${k.nama}`
						}))
					],
					onChange: (value) => terapkanFilter('kelas_id', value)
				}
			]}
			aktif={countActiveFilters(page.url, KUNCI_FILTER)}
			onReset={() =>
				goto(resetFilters(page.url, KUNCI_FILTER), { replaceState: true, keepFocus: true })}
		/>
	</div>

	{#if !data.kelas.length}
		<div class="alert alert-soft alert-info">
			<Icon name="info" />
			<span>
				{data.kosongKarenaFilter
					? 'Tidak ada murid yang cocok dengan filter.'
					: 'Belum ada data murid pada sekolah ini.'}
			</span>
		</div>
	{:else}
		{#each data.kelas as kelas (kelas.namaKelas)}
			<div class="card bg-base-200/50 rounded-md p-3">
				<h3 class="mb-2 font-bold">
					Kelas {kelas.namaKelas}
					<span class="text-base-content/60 text-sm font-normal">({kelas.murids.length} murid)</span
					>
				</h3>
				<div class="overflow-x-auto rounded-md">
					<table class="table table-sm">
						<thead>
							<tr class="text-base-content text-left font-bold">
								<th style="min-width: 120px;">NISN</th>
								<th style="min-width: 160px;">Nama</th>
								<th class="text-center" style="min-width: 80px;">Kasus</th>
								<th class="text-center" style="min-width: 90px;">Total Poin</th>
								<th class="text-center" style="min-width: 150px;">Status</th>
							</tr>
						</thead>
						<tbody>
							{#each kelas.murids as murid (murid.nama + murid.nisn)}
								{@const badge = badgePoin(murid.totalPoin)}
								<tr>
									<td class="text-base-content/70">{murid.nisn ?? '—'}</td>
									<td class="font-medium">{murid.nama}</td>
									<td class="text-center">{murid.count}</td>
									<td class="text-center">
										<span class={`badge ${badge.cls}`}>{murid.totalPoin}</span>
									</td>
									<td class="text-center">
										<span class={`badge badge-soft ${badge.cls}`}>{badge.label}</span>
									</td>
								</tr>
							{/each}
						</tbody>
					</table>
				</div>
			</div>
		{/each}
	{/if}
</div>

<style>
	/* Hide action buttons on printed output; keep tables fully visible. */
	@media print {
		.no-print {
			display: none;
		}
	}
</style>
