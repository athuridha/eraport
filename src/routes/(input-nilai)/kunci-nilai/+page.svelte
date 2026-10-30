<script lang="ts">
	import { goto, invalidateAll } from '$app/navigation';
	import { page } from '$app/state';
	import FormEnhance from '$lib/components/form-enhance.svelte';
	import Icon from '$lib/components/icon.svelte';
	import { toast } from '$lib/components/toast.svelte';
	import FilterToolbar from '$lib/components/table/filter-toolbar.svelte';
	import { setFilter, resetFilters, countActiveFilters } from '$lib/utils/url-filter';

	type Mapel = {
		id: number;
		nama: string;
		pengampu: string;
		terkunci: boolean;
		dikunciOleh: string | null;
		dikunciPada: string | null;
		alasan: string | null;
	};

	let { data } = $props();

	const KUNCI_FILTER = ['q', 'status'];

	let searchTerm = $state(page.url.searchParams.get('q') ?? '');

	// Sinkronkan kotak pencarian saat URL berubah (navigasi back/forward, reset).
	$effect(() => {
		const latest = page.url.searchParams.get('q') ?? '';
		if (searchTerm !== latest) searchTerm = latest;
	});

	let targetKunci = $state<Mapel | null>(null);
	let targetKunciId = $state(0);
	let alasan = $state('');

	const mapel = $derived((data.mapel ?? []) as Mapel[]);
	const jumlahTerkunci = $derived(
		data.jumlahTerkunci ?? mapel.filter((row) => row.terkunci).length
	);

	async function terapkanFilter(key: string, value: string) {
		await goto(setFilter(page.url, key, value), { replaceState: true, keepFocus: true });
	}

	function formatWaktu(value: string | null): string {
		if (!value) return '—';
		const parsed = new Date(value);
		if (Number.isNaN(parsed.getTime())) return value;
		return new Intl.DateTimeFormat('id-ID', {
			day: 'numeric',
			month: 'short',
			year: 'numeric',
			hour: '2-digit',
			minute: '2-digit'
		}).format(parsed);
	}

	async function handleSelesai({ data: hasil }: { data?: Record<string, unknown> }) {
		await invalidateAll();
		targetKunci = null;
		targetKunciId = 0;
		alasan = '';
		toast({
			message: typeof hasil?.message === 'string' ? hasil.message : 'Perubahan disimpan.',
			type: 'success'
		});
	}
</script>

<div class="card bg-base-100 rounded-lg border border-none p-4 shadow-md">
	<div class="mb-4 flex items-start justify-between gap-2 max-sm:flex-col sm:flex-row">
		<div>
			<h2 class="text-xl font-bold">Kunci Nilai</h2>
			<p class="text-base-content/80 block text-sm">
				Nilai yang sudah dikunci tidak bisa diubah guru sampai operator membuka kuncinya. Penilaian
				harian (formatif) tetap bisa diisi.
			</p>
		</div>
		{#if data.kelasId}
			<div class="flex flex-wrap items-center gap-2 max-sm:w-full">
				<span class="badge badge-soft badge-primary badge-lg">{data.kelasNama}</span>
				<FormEnhance action="?/kunciSemua" showToast={false} onsuccess={handleSelesai}>
					{#snippet children({ submitting })}
						<input type="hidden" name="kelasId" value={data.kelasId} />
						<button
							type="submit"
							class="btn btn-sm btn-soft shadow-none"
							disabled={submitting || mapel.length === 0 || jumlahTerkunci === mapel.length}
						>
							<Icon name="lock" />
							Kunci Semua
						</button>
					{/snippet}
				</FormEnhance>
				<FormEnhance action="?/bukaSemua" showToast={false} onsuccess={handleSelesai}>
					{#snippet children({ submitting })}
						<input type="hidden" name="kelasId" value={data.kelasId} />
						<button
							type="submit"
							class="btn btn-sm btn-soft shadow-none"
							disabled={submitting || jumlahTerkunci === 0}
						>
							<Icon name="key" />
							Buka Semua
						</button>
					{/snippet}
				</FormEnhance>
			</div>
		{/if}
	</div>

	{#if !data.kelasId}
		<div class="alert alert-warning mb-4 text-sm">
			<Icon name="info" />
			<span>Pilih kelas aktif di navbar dulu untuk mengelola kunci nilai.</span>
		</div>
	{:else}
		<div class="mb-4 flex flex-col gap-3">
			<FilterToolbar
				bind:q={searchTerm}
				qPlaceholder="Cari mata pelajaran atau pengampu..."
				onSearch={(value) => terapkanFilter('q', value)}
				pilih={[
					{
						name: 'status',
						label: 'Status',
						value: page.url.searchParams.get('status') ?? '',
						opsis: [{ value: '', label: 'Semua Status' }, ...(data.opsiStatus ?? [])],
						onChange: (v) => terapkanFilter('status', v)
					}
				]}
				aktif={countActiveFilters(page.url, KUNCI_FILTER)}
				onReset={() =>
					goto(resetFilters(page.url, KUNCI_FILTER), { replaceState: true, keepFocus: true })}
			/>
			<p class="text-base-content/70 text-sm">
				{jumlahTerkunci} dari {data.totalSemua ?? mapel.length} mata pelajaran terkunci
			</p>
		</div>

		<div class="bg-base-100 dark:bg-base-200 overflow-x-auto rounded-md shadow-md dark:shadow-none">
			<table class="border-base-200 table border dark:border-none">
				<thead>
					<tr class="bg-base-200 dark:bg-base-300 text-base-content text-left font-bold">
						<th style="min-width: 200px;">Mata Pelajaran</th>
						<th style="min-width: 180px;">Pengampu</th>
						<th style="min-width: 130px;">Status</th>
						<th style="min-width: 200px;">Dikunci oleh</th>
						<th class="text-center" style="width: 150px;">Aksi</th>
					</tr>
				</thead>
				<tbody>
					{#each mapel as row (row.id)}
						<tr>
							<td class="font-medium">{row.nama}</td>
							<td>{row.pengampu}</td>
							<td>
								{#if row.terkunci}
									<span class="badge badge-sm badge-error badge-soft">Terkunci</span>
								{:else}
									<span class="badge badge-sm badge-success badge-soft">Bebas</span>
								{/if}
							</td>
							<td class="text-sm">
								{#if row.terkunci}
									<div>{row.dikunciOleh ?? '—'}</div>
									<div class="text-base-content/60">{formatWaktu(row.dikunciPada)}</div>
									{#if row.alasan}
										<div class="text-base-content/70 italic">{row.alasan}</div>
									{/if}
								{:else}
									—
								{/if}
							</td>
							<td>
								<div class="flex items-center justify-center gap-1">
									{#if row.terkunci}
										<FormEnhance action="?/buka" showToast={false} onsuccess={handleSelesai}>
											{#snippet children({ submitting })}
												<input type="hidden" name="mapelId" value={row.id} />
												<button
													type="submit"
													class="btn btn-soft btn-sm shadow-none"
													disabled={submitting}
												>
													<Icon name="key" />
													Buka
												</button>
											{/snippet}
										</FormEnhance>
									{:else}
										<button
											type="button"
											class="btn btn-soft btn-sm shadow-none"
											onclick={() => {
												targetKunci = row;
												targetKunciId = row.id;
												alasan = '';
											}}
										>
											<Icon name="lock" />
											Kunci
										</button>
									{/if}
								</div>
							</td>
						</tr>
					{:else}
						<tr>
							<td class="p-6 text-center" colspan="5">
								{#if (data.totalSemua ?? 0) === 0}
									<em class="opacity-60">Belum ada mata pelajaran di kelas ini.</em>
								{:else}
									<em class="opacity-60">Tidak ada yang cocok dengan filter.</em>
								{/if}
							</td>
						</tr>
					{/each}
				</tbody>
			</table>
		</div>
	{/if}
</div>

{#if targetKunci}
	<dialog class="modal" open>
		<div class="modal-box max-w-lg">
			<h3 class="mb-1 text-lg font-bold">Kunci Nilai {targetKunci.nama}</h3>
			<p class="text-base-content/70 mb-4 text-sm">
				Setelah dikunci, guru tidak bisa mengubah nilai mata pelajaran ini sampai kunci dibuka.
			</p>

			<FormEnhance action="?/kunci" showToast={false} onsuccess={handleSelesai}>
				{#snippet children({ submitting, invalid })}
					<input type="hidden" name="mapelId" value={targetKunciId} />
					<label class="form-control">
						<span class="label-text mb-1 text-sm">Alasan (opsional)</span>
						<textarea
							name="alasan"
							bind:value={alasan}
							class="textarea textarea-bordered w-full rounded-xl"
							rows="3"
							placeholder="Contoh: Rapor semester 1 sudah dibagikan ke wali kelas"
							disabled={submitting}></textarea>
					</label>

					<div class="modal-action">
						<button
							type="button"
							class="btn btn-ghost rounded-xl"
							onclick={() => (targetKunci = null)}
							disabled={submitting}
						>
							<Icon name="close" />
							Batal
						</button>
						<button
							type="submit"
							class="btn btn-primary btn-soft rounded-xl shadow-none"
							disabled={submitting || invalid}
						>
							{#if submitting}
								<span class="loading loading-spinner loading-sm"></span>
							{:else}
								<Icon name="lock" />
							{/if}
							Kunci Nilai
						</button>
					</div>
				{/snippet}
			</FormEnhance>
		</div>
		<div class="modal-backdrop">
			<button type="button" onclick={() => (targetKunci = null)}>close</button>
		</div>
	</dialog>
{/if}
