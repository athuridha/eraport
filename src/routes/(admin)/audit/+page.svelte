<script lang="ts">
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import Icon from '$lib/components/icon.svelte';
	import FilterToolbar from '$lib/components/table/filter-toolbar.svelte';
	import { countActiveFilters, resetFilters, setFilter } from '$lib/utils/url-filter';

	let { data } = $props();

	const KUNCI_FILTER = ['q', 'aksi', 'dari', 'sampai'];

	// svelte-ignore state_referenced_locally
	let searchTerm = $state(data.filter?.q ?? '');

	$effect(() => {
		const latest = data.filter?.q ?? '';
		if (searchTerm !== latest) {
			searchTerm = latest;
		}
	});

	const daftar = $derived(data.daftar ?? []);
	const aksi = $derived(data.filter?.aksi ?? '');
	const dari = $derived(data.filter?.dari ?? '');
	const sampai = $derived(data.filter?.sampai ?? '');
	const opsiAksi = $derived(data.opsiAksi ?? []);
	const kosongKarenaFilter = $derived(Boolean(data.kosongKarenaFilter));

	const labelAksi: Record<string, string> = {
		import_nilai: 'Impor Nilai',
		update_nilai: 'Ubah Nilai'
	};

	async function terapkanFilter(key: string, value: string) {
		await goto(setFilter(page.url, key, value), { replaceState: true, keepFocus: true });
	}

	async function terapkanTanggal(nilaiDari: string, nilaiSampai: string) {
		const next = new URL(page.url);
		if (nilaiDari) {
			next.searchParams.set('dari', nilaiDari);
		} else {
			next.searchParams.delete('dari');
		}
		if (nilaiSampai) {
			next.searchParams.set('sampai', nilaiSampai);
		} else {
			next.searchParams.delete('sampai');
		}
		next.searchParams.delete('page');
		await goto(next, { replaceState: true, keepFocus: true });
	}

	function formatWaktu(iso: unknown) {
		if (!iso) return '-';
		const date = new Date(String(iso));
		if (Number.isNaN(date.getTime())) return String(iso);
		return date.toLocaleString('id-ID', {
			dateStyle: 'medium',
			timeStyle: 'short'
		});
	}

	function detailTeks(detail: unknown) {
		if (!detail || typeof detail !== 'object') return '-';
		const parsed = detail as Record<string, unknown>;
		if (parsed.nilaiLama != null || parsed.nilaiBaru != null) {
			return `${parsed.nilaiLama ?? '—'} → ${parsed.nilaiBaru ?? '—'}`;
		}
		if (parsed.tersimpan != null) return `${parsed.tersimpan} nilai tersimpan`;
		return '-';
	}
</script>

<div class="card bg-base-100 rounded-lg border border-none p-4 shadow-md">
	<div class="mb-4 flex items-start justify-between gap-2 max-sm:flex-col sm:flex-row">
		<div>
			<h2 class="text-xl font-bold">Jejak Audit</h2>
			<p class="text-base-content/80 block text-sm">
				Riwayat perubahan nilai (impor Excel maupun ubah manual) beserta pelaku dan waktunya.
			</p>
		</div>
		<div class="flex items-center gap-2 max-sm:w-full">
			<a class="btn btn-soft shadow-none max-sm:w-full" href="/nilai-akhir/impor-nilai">
				<Icon name="import" />
				Impor Nilai
			</a>
		</div>
	</div>

	<div class="mb-4">
		<FilterToolbar
			bind:q={searchTerm}
			qPlaceholder="Cari aktor/aksi..."
			onSearch={(value) => terapkanFilter('q', value)}
			pilih={[
				{
					name: 'aksi',
					label: 'Aksi',
					value: aksi,
					opsis: [{ value: '', label: 'Semua Aksi' }, ...opsiAksi],
					onChange: (v) => terapkanFilter('aksi', v)
				}
			]}
			tanggal={{
				dari,
				sampai,
				onChange: (v) => terapkanTanggal(v.dari, v.sampai)
			}}
			aktif={countActiveFilters(page.url, KUNCI_FILTER)}
			onReset={() =>
				goto(resetFilters(page.url, KUNCI_FILTER), { replaceState: true, keepFocus: true })}
		/>
	</div>

	<div class="bg-base-100 dark:bg-base-200 overflow-x-auto rounded-md shadow-md dark:shadow-none">
		<table class="border-base-200 table border dark:border-none">
			<thead>
				<tr class="bg-base-200 dark:bg-base-300 text-base-content text-left font-bold">
					<th style="min-width: 160px;">Waktu</th>
					<th style="min-width: 140px;">Aktor</th>
					<th style="min-width: 140px;">Jenis</th>
					<th>Keterangan</th>
					<th style="min-width: 140px;">Perubahan</th>
				</tr>
			</thead>
			<tbody>
				{#each daftar as item (item.id)}
					<tr>
						<td class="text-sm whitespace-nowrap">{formatWaktu(item.createdAt)}</td>
						<td class="text-sm">{item.aktor ?? '-'}</td>
						<td>
							<span class="badge badge-soft badge-sm">
								{labelAksi[String(item.aksi)] ?? item.aksi}
							</span>
						</td>
						<td class="text-sm">{item.ringkasan ?? '-'}</td>
						<td class="text-sm opacity-80">{detailTeks(item.detail)}</td>
					</tr>
				{:else}
					<tr>
						<td class="p-6 text-center" colspan="5">
							<em class="opacity-60">
								{kosongKarenaFilter
									? 'Tidak ada jejak audit yang cocok dengan filter.'
									: 'Belum ada jejak audit.'}
							</em>
						</td>
					</tr>
				{/each}
			</tbody>
		</table>
	</div>

	<p class="mt-3 text-center text-sm opacity-70">{daftar.length} entri terakhir</p>
</div>
