<script lang="ts">
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import FormEnhance from '$lib/components/form-enhance.svelte';
	import Icon from '$lib/components/icon.svelte';
	import FilterToolbar from '$lib/components/table/filter-toolbar.svelte';
	import { toast } from '$lib/components/toast.svelte';
	import { countActiveFilters, resetFilters, setFilter } from '$lib/utils/url-filter';

	let { data } = $props();

	type Teknik = {
		id: number;
		nama: string;
		singkatan: string;
		keterangan: string | null;
		urutan: number | null;
		totalTp: number;
	};

	const KUNCI_FILTER = ['q'];

	// svelte-ignore state_referenced_locally
	let searchTerm = $state(data.q ?? '');

	$effect(() => {
		const latestQ = data.q ?? '';
		if (searchTerm !== latestQ) {
			searchTerm = latestQ;
		}
	});

	async function terapkanFilter(key: string, value: string) {
		await goto(setFilter(page.url, key, value), { replaceState: true, keepFocus: true });
	}

	let modalOpen = $state(false);
	let editMode = $state(false);
	let currentItem = $state<Teknik | null>(null);

	let formNama = $state('');
	let formSingkatan = $state('');
	let formKeterangan = $state('');
	let formUrutan = $state(1);

	let hapusItem = $state<Teknik | null>(null);

	function bukaTambah() {
		editMode = false;
		currentItem = null;
		formNama = '';
		formSingkatan = '';
		formKeterangan = '';
		formUrutan =
			(data.daftarTeknik.length ? Math.max(...data.daftarTeknik.map((t) => t.urutan ?? 0)) : 0) + 1;
		modalOpen = true;
	}

	function bukaUbah(item: Teknik) {
		editMode = true;
		currentItem = item;
		formNama = item.nama;
		formSingkatan = item.singkatan;
		formKeterangan = item.keterangan ?? '';
		formUrutan = item.urutan ?? 1;
		modalOpen = true;
	}
</script>

<svelte:head>
	<title>Teknik Penilaian — {data.sekolahNama}</title>
</svelte:head>

<div class="space-y-6">
	<!-- Header Card -->
	<div class="card bg-base-100 p-6 shadow-md dark:border-none">
		<div class="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
			<div>
				<h1 class="text-2xl font-bold">Teknik Penilaian</h1>
				<p class="text-base-content/70 mt-1 text-sm">
					Daftar metode / instrumen asesmen yang digunakan guru dalam menilai capaian Tujuan
					Pembelajaran (TP) pada penilaian formatif dan sumatif.
				</p>
			</div>
			<div class="flex flex-wrap items-center gap-2">
				<FormEnhance
					action="?/resetDefault"
					onsuccess={() => {
						toast('Teknik penilaian standar berhasil dimuat ulang.', 'success');
					}}
				>
					{#snippet children({ submitting })}
						<button
							type="submit"
							class="btn btn-soft btn-sm shadow-none"
							disabled={submitting}
							title="Kembalikan atau tambahkan teknik standar Kurikulum Merdeka"
						>
							<Icon name="repeat" />
							Reset Standar
						</button>
					{/snippet}
				</FormEnhance>
				<button type="button" class="btn btn-primary btn-sm shadow-none" onclick={bukaTambah}>
					<Icon name="plus" />
					Tambah Teknik
				</button>
			</div>
		</div>
	</div>

	<!-- Tabel Teknik Penilaian -->
	<div class="card bg-base-100 p-4 shadow-md dark:border-none">
		<div class="mb-4">
			<FilterToolbar
				bind:q={searchTerm}
				qPlaceholder="Cari teknik penilaian..."
				onSearch={(value) => terapkanFilter('q', value)}
				aktif={countActiveFilters(page.url, KUNCI_FILTER)}
				onReset={() =>
					goto(resetFilters(page.url, KUNCI_FILTER), { replaceState: true, keepFocus: true })}
			/>
		</div>
		<div class="overflow-x-auto">
			<table class="border-base-200 table border dark:border-none">
				<thead>
					<tr class="bg-base-200 dark:bg-base-300 text-base-content text-left font-bold">
						<th style="width: 50px;">No</th>
						<th style="min-width: 180px;">Nama Teknik Penilaian</th>
						<th class="text-center" style="width: 100px;">Singkatan</th>
						<th style="min-width: 250px;">Keterangan & Instrumen</th>
						<th class="text-center" style="width: 120px;">Dipakai di TP</th>
						<th class="text-center" style="width: 130px;">Aksi</th>
					</tr>
				</thead>
				<tbody>
					{#each data.daftarTeknik as item, index (item.id)}
						<tr>
							<td>{index + 1}</td>
							<td>
								<span class="font-bold">{item.nama}</span>
							</td>
							<td class="text-center">
								<span class="badge badge-primary font-mono font-bold">{item.singkatan}</span>
							</td>
							<td class="text-base-content/80 text-sm">
								{item.keterangan ?? '—'}
							</td>
							<td class="text-center">
								{#if item.totalTp > 0}
									<span class="badge badge-soft badge-info font-medium">{item.totalTp} TP</span>
								{:else}
									<span class="badge badge-soft badge-ghost text-xs">Belum dipakai</span>
								{/if}
							</td>
							<td>
								<div class="flex items-center justify-center gap-1">
									<button
										type="button"
										class="btn btn-ghost btn-xs btn-primary shadow-none"
										onclick={() => bukaUbah(item)}
										title="Ubah teknik penilaian"
									>
										<Icon name="edit" />
										Ubah
									</button>
									<button
										type="button"
										class="btn btn-ghost btn-xs btn-error shadow-none"
										onclick={() => (hapusItem = item)}
										title="Hapus teknik penilaian"
									>
										<Icon name="del" />
									</button>
								</div>
							</td>
						</tr>
					{:else}
						<tr>
							<td class="p-6 text-center opacity-60" colspan="6">
								{data.kosongKarenaFilter
									? 'Tidak ada teknik penilaian yang cocok dengan filter.'
									: 'Belum ada teknik penilaian. Klik "Reset Standar" untuk memuat teknik bawaan.'}
							</td>
						</tr>
					{/each}
				</tbody>
			</table>
		</div>
	</div>

	<!-- Info Box -->
	<div class="alert alert-info alert-soft text-xs">
		<Icon name="info" />
		<div>
			<p class="font-bold">Keterkaitan dengan Penilaian:</p>
			<p>
				Teknik penilaian yang terdaftar di sini dapat langsung dipilih oleh guru saat merumuskan <strong
					>Tujuan Pembelajaran (TP)</strong
				>
				di menu <em>Mata Pelajaran &gt; Intrakurikuler &gt; TP &amp; Lingkup Materi</em>. Pilihan
				teknik akan otomatis muncul di formulir asesmen sumatif dan formatif sebagai panduan
				instrumen penilaian murid.
			</p>
		</div>
	</div>
</div>

<!-- Modal Tambah / Ubah -->
{#if modalOpen}
	<dialog class="modal modal-open">
		<div class="modal-box max-w-md">
			<h3 class="text-lg font-bold">
				{editMode ? 'Ubah Teknik Penilaian' : 'Tambah Teknik Penilaian Baru'}
			</h3>

			<FormEnhance
				action={editMode ? '?/ubah' : '?/tambah'}
				onsuccess={() => {
					modalOpen = false;
					toast(
						editMode
							? 'Teknik penilaian berhasil diperbarui.'
							: 'Teknik penilaian berhasil ditambahkan.',
						'success'
					);
				}}
			>
				{#snippet children({ submitting })}
					{#if editMode && currentItem}
						<input type="hidden" name="id" value={currentItem.id} />
					{/if}

					<div class="mt-4 space-y-4">
						<fieldset class="fieldset">
							<legend class="fieldset-legend font-medium">Nama Teknik Penilaian</legend>
							<input
								type="text"
								name="nama"
								class="input bg-base-200 dark:bg-base-300 w-full"
								placeholder="Mis: Tes Tulis, Kinerja, Penugasan..."
								bind:value={formNama}
								required
							/>
						</fieldset>

						<div class="grid grid-cols-2 gap-4">
							<fieldset class="fieldset">
								<legend class="fieldset-legend font-medium">Singkatan</legend>
								<input
									type="text"
									name="singkatan"
									class="input bg-base-200 dark:bg-base-300 w-full uppercase font-mono"
									placeholder="Mis: TT, KJ"
									maxlength="8"
									bind:value={formSingkatan}
									required
								/>
							</fieldset>

							<fieldset class="fieldset">
								<legend class="fieldset-legend font-medium">Urutan Tampil</legend>
								<input
									type="number"
									name="urutan"
									class="input bg-base-200 dark:bg-base-300 w-full"
									min="0"
									bind:value={formUrutan}
								/>
							</fieldset>
						</div>

						<fieldset class="fieldset">
							<legend class="fieldset-legend font-medium">Keterangan / Contoh Instrumen</legend>
							<textarea
								name="keterangan"
								class="textarea bg-base-200 dark:bg-base-300 w-full text-sm"
								rows="2"
								placeholder="Mis: Ujian pilihan ganda, rubrik unjuk kerja, laporan tugas..."
								bind:value={formKeterangan}></textarea>
						</fieldset>
					</div>

					<div class="modal-action mt-6">
						<button
							type="button"
							class="btn btn-ghost shadow-none"
							onclick={() => (modalOpen = false)}
							disabled={submitting}
						>
							Batal
						</button>
						<button type="submit" class="btn btn-primary shadow-none" disabled={submitting}>
							{#if submitting}
								<span class="loading loading-spinner loading-sm"></span>
							{/if}
							Simpan
						</button>
					</div>
				{/snippet}
			</FormEnhance>
		</div>
		<button
			type="button"
			class="modal-backdrop"
			onclick={() => (modalOpen = false)}
			aria-label="Tutup"
		></button>
	</dialog>
{/if}

<!-- Modal Konfirmasi Hapus -->
{#if hapusItem}
	<dialog class="modal modal-open">
		<div class="modal-box max-w-sm">
			<h3 class="text-error flex items-center gap-2 text-lg font-bold">
				<Icon name="warning" />
				Hapus Teknik Penilaian
			</h3>
			<p class="py-3 text-sm">
				Hapus teknik <strong>{hapusItem.nama}</strong> ({hapusItem.singkatan})?
				{#if hapusItem.totalTp > 0}
					<span class="text-warning block mt-2 font-medium">
						⚠ Teknik ini sedang digunakan pada {hapusItem.totalTp} Tujuan Pembelajaran. Kaitan pada TP
						tersebut akan dikosongkan.
					</span>
				{/if}
			</p>

			<FormEnhance
				action="?/hapus"
				onsuccess={() => {
					hapusItem = null;
					toast('Teknik penilaian berhasil dihapus.', 'success');
				}}
			>
				{#snippet children({ submitting })}
					<input type="hidden" name="id" value={hapusItem?.id} />

					<div class="modal-action">
						<button
							type="button"
							class="btn btn-ghost shadow-none"
							onclick={() => (hapusItem = null)}
							disabled={submitting}
						>
							Batal
						</button>
						<button type="submit" class="btn btn-error shadow-none" disabled={submitting}>
							{#if submitting}
								<span class="loading loading-spinner loading-sm"></span>
							{/if}
							Hapus
						</button>
					</div>
				{/snippet}
			</FormEnhance>
		</div>
		<button
			type="button"
			class="modal-backdrop"
			onclick={() => (hapusItem = null)}
			aria-label="Tutup"
		></button>
	</dialog>
{/if}
