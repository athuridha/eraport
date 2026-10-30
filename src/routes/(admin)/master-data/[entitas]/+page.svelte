<script lang="ts">
	import { goto, invalidate } from '$app/navigation';
	import { page } from '$app/state';
	import Icon from '$lib/components/icon.svelte';
	import FormEnhance from '$lib/components/form-enhance.svelte';
	import { toast } from '$lib/components/toast.svelte';
	import { buildPageNumbers, OPSI_BARIS_PER_HALAMAN } from '$lib/utils/pagination';
	import PindahMuridModal from '$lib/components/murid/pindah-murid-modal.svelte';
	import AnggotaEkstrakurikulerModal from '$lib/components/ekstrakurikuler/anggota-modal.svelte';
	import { selectAll, semuaTerpilih, toggleId } from '$lib/utils/bulk-select';
	import FilterToolbar from '$lib/components/table/filter-toolbar.svelte';
	import { setFilter, resetFilters, countActiveFilters } from '$lib/utils/url-filter';

	let { data } = $props();

	const KUNCI_FILTER = ['q'];

	// svelte-ignore state_referenced_locally
	let searchTerm = $state(data.filter?.q ?? '');
	let formTerbuka = $state(false);
	let bulkTerbuka = $state(false);
	let ubahKelasTerbuka = $state(false);
	let kelasTerpilihUbah = $state<number[]>([]);
	let modeUbah = $state<'tambah' | 'ganti'>('tambah');
	let pindahMuridTerbuka = $state(false);
	let anggotaEkstra = $state<{ id: number; nama: string } | null>(null);
	let kelasTerpilihMassal = $state<number[]>([]);
	let barisEdit = $state<Record<string, string | number | null> | null>(null);
	let hapusId = $state<number | null>(null);
	let terpilih = $state<number[]>([]);

	const entitas = $derived(data.entitas ?? null);
	const baris = $derived(data.baris ?? []);
	const relasi = $derived(data.relasi ?? {});
	const total = $derived(data.total ?? 0);
	const totalHalaman = $derived(data.totalHalaman ?? 1);
	const perHalaman = $derived(data.perHalaman ?? 50);
	const halamanSekarang = $derived(data.filter?.page ?? 1);
	const nomorHalaman = $derived(buildPageNumbers(halamanSekarang, totalHalaman));
	const idsHalaman = $derived(baris.map((row) => Number(row.id ?? 0)).filter((id) => id > 0));
	const barisTampil = $derived(baris.length);

	function nilaiField(key: string): string {
		// Mode tambah: form kosong. Isi field dari baris yang sedang diubah.
		if (!barisEdit) return '';
		const nilai = barisEdit[key];
		return nilai == null ? '' : String(nilai);
	}

	let mapelKelasTerpilih = $state<number[]>([]);

	function bukaTambah() {
		barisEdit = null;
		mapelKelasTerpilih = (relasi.kelas ?? []).map((k) => Number(k.value));
		formTerbuka = true;
	}

	function bukaUbah(row: Record<string, string | number | null>) {
		barisEdit = row;
		if (entitas?.key === 'mata_pelajaran') {
			const kelasStr = String(row.kelas ?? '');
			const isSemua = kelasStr.startsWith('Semua Kelas');
			if (isSemua) {
				mapelKelasTerpilih = (relasi.kelas ?? []).map((k) => Number(k.value));
			} else {
				const namaKelasList = kelasStr.split(',').map((s) => s.trim().toLowerCase());
				mapelKelasTerpilih = (relasi.kelas ?? [])
					.filter((k) => namaKelasList.includes(k.label.trim().toLowerCase()))
					.map((k) => Number(k.value));
			}
		}
		formTerbuka = true;
	}

	function tutupForm() {
		formTerbuka = false;
		barisEdit = null;
	}

	async function terapkanFilter(key: string, value: string) {
		await goto(setFilter(page.url, key, value), { replaceState: true, keepFocus: true });
	}

	async function gotoPage(pageNumber: number) {
		const params = new URLSearchParams(page.url.search);
		params.set('page', String(pageNumber));
		await goto(`${page.url.pathname}?${params.toString()}`, { keepFocus: true });
	}

	async function gotoPerHalaman(jumlah: number) {
		const params = new URLSearchParams(page.url.search);
		params.set('per_page', String(jumlah));
		params.delete('page');
		await goto(`${page.url.pathname}?${params.toString()}`, { keepFocus: true });
	}

	function toggleKelasMassal(id: number, checked: boolean) {
		kelasTerpilihMassal = checked
			? [...new Set([...kelasTerpilihMassal, id])]
			: kelasTerpilihMassal.filter((value) => value !== id);
	}

	function bukaUbahKelas() {
		kelasTerpilihUbah = [];
		modeUbah = 'tambah';
		ubahKelasTerbuka = true;
	}

	async function handleUbahKelas({ data: hasil }: { data?: Record<string, unknown> }) {
		await invalidate('app:master-data');
		ubahKelasTerbuka = false;
		terpilih = [];
		toast({
			message: typeof hasil?.message === 'string' ? hasil.message : 'Kelas diperbarui',
			type: 'success'
		});
	}

	async function handleSimpan({ data: hasil }: { data?: Record<string, unknown> }) {
		await invalidate('app:master-data');
		tutupForm();
		bulkTerbuka = false;
		toast({
			message: typeof hasil?.message === 'string' ? hasil.message : 'Tersimpan',
			type: 'success'
		});
	}

	async function handleHapus({ data: hasil }: { data?: Record<string, unknown> }) {
		await invalidate('app:master-data');
		hapusId = null;
		terpilih = [];
		toast({
			message: typeof hasil?.message === 'string' ? hasil.message : 'Data dihapus',
			type: 'success'
		});
	}
</script>

<div class="card bg-base-100 rounded-lg border border-none p-4 shadow-md">
	<div class="mb-4 flex items-start justify-between gap-2 max-sm:flex-col sm:flex-row">
		<div>
			<h2 class="text-xl font-bold">{entitas?.judul ?? 'Master Data'}</h2>
			{#if entitas}
				<p class="text-base-content/80 block text-sm">{entitas.deskripsi}</p>
			{/if}
		</div>
		{#if entitas}
			<div class="flex flex-wrap items-center gap-2 max-sm:w-full">
				{#if terpilih.length}
					{#if entitas.key === 'mata_pelajaran'}
						<button type="button" class="btn btn-soft shadow-none" onclick={bukaUbahKelas}>
							<Icon name="move" />
							Ubah Kelas {terpilih.length} Terpilih
						</button>
					{/if}
					<FormEnhance action="?/hapusMassal" showToast={false} onsuccess={handleHapus}>
						{#snippet children({ submitting })}
							<input type="hidden" name="ids" value={JSON.stringify(terpilih)} />
							<button
								type="submit"
								class="btn btn-error btn-soft shadow-none"
								disabled={submitting}
							>
								<Icon name="del" />
								Hapus {terpilih.length} Terpilih
							</button>
						{/snippet}
					</FormEnhance>
				{/if}
				{#if entitas.formPengguna}
					<a
						class="btn btn-primary btn-soft shadow-none max-sm:w-full"
						href={entitas.tambahPath ?? '/pengguna/form'}
					>
						<Icon name="plus" />
						Tambah Akun
					</a>
				{:else}
					<button
						type="button"
						class="btn btn-primary btn-soft shadow-none max-sm:w-full"
						onclick={bukaTambah}
					>
						<Icon name="plus" />
						Tambah
					</button>
				{/if}
				{#if entitas.key === 'mata_pelajaran'}
					<button
						type="button"
						class="btn btn-soft shadow-none max-sm:w-full"
						onclick={() => {
							kelasTerpilihMassal = [];
							bulkTerbuka = true;
						}}
					>
						<Icon name="layers" />
						Tambah Massal
					</button>
				{/if}
				{#if entitas.key === 'kelas'}
					<button
						type="button"
						class="btn btn-soft shadow-none max-sm:w-full"
						onclick={() => (pindahMuridTerbuka = true)}
					>
						<Icon name="move" />
						Pindah Murid
					</button>
				{/if}
			</div>
		{/if}
	</div>

	<div class="mb-4 flex flex-col gap-2 sm:flex-row">
		<FilterToolbar
			bind:q={searchTerm}
			qPlaceholder={`Cari ${entitas?.judul.toLowerCase() ?? 'data'}...`}
			onSearch={(value) => terapkanFilter('q', value)}
			aktif={countActiveFilters(page.url, KUNCI_FILTER)}
			onReset={() =>
				goto(resetFilters(page.url, KUNCI_FILTER), { replaceState: true, keepFocus: true })}
		>
			<select
				class="select bg-base-200 dark:bg-base-300 w-auto shrink dark:border-none"
				value={perHalaman}
				title="Baris per halaman"
				onchange={(event) =>
					gotoPerHalaman(Number((event.currentTarget as HTMLSelectElement).value))}
			>
				{#each OPSI_BARIS_PER_HALAMAN as jumlah (jumlah)}
					<option value={jumlah}>{jumlah} / hal</option>
				{/each}
			</select>
		</FilterToolbar>
	</div>

	<div class="bg-base-100 dark:bg-base-200 overflow-x-auto rounded-md shadow-md dark:shadow-none">
		<table class="border-base-200 table border dark:border-none">
			<thead>
				<tr class="bg-base-200 dark:bg-base-300 text-base-content text-left font-bold">
					<th style="width: 50px; min-width: 40px;" class="text-center">
						<input
							type="checkbox"
							class="checkbox checkbox-sm"
							checked={semuaTerpilih(idsHalaman, terpilih)}
							onchange={(event) =>
								(terpilih = selectAll(
									idsHalaman,
									(event.currentTarget as HTMLInputElement).checked
								))}
						/>
					</th>
					{#each entitas?.kolom ?? [] as kolom (kolom.key)}
						<th style="min-width: 140px;">{kolom.label}</th>
					{/each}
					<th class="text-center" style="width: 150px;">Aksi</th>
				</tr>
			</thead>
			<tbody>
				{#each baris as row (row.id)}
					<tr class={terpilih.includes(Number(row.id)) ? 'bg-base-200/40' : undefined}>
						<td class="text-center">
							<input
								type="checkbox"
								class="checkbox checkbox-sm"
								checked={terpilih.includes(Number(row.id))}
								onchange={(event) =>
									(terpilih = toggleId(
										terpilih,
										Number(row.id),
										(event.currentTarget as HTMLInputElement).checked
									))}
							/>
						</td>
						{#each entitas?.kolom ?? [] as kolom (kolom.key)}
							<td>{row[kolom.key] ?? '—'}</td>
						{/each}
						<td>
							<div class="flex items-center justify-center gap-1">
								{#if hapusId === row.id}
									<FormEnhance action="?/hapus" showToast={false} onsuccess={handleHapus}>
										{#snippet children({ submitting })}
											<input type="hidden" name="id" value={row.id} />
											<div class="flex items-center justify-center gap-1">
												<button
													type="submit"
													class="btn btn-error btn-soft btn-sm shadow-none"
													disabled={submitting}
												>
													Ya
												</button>
												<button
													type="button"
													class="btn btn-soft btn-sm shadow-none"
													onclick={() => (hapusId = null)}
												>
													Batal
												</button>
											</div>
										{/snippet}
									</FormEnhance>
								{:else}
									{#if entitas?.key === 'ekstrakurikuler'}
										<button
											type="button"
											class="btn btn-soft btn-sm shadow-none"
											title="Kelola anggota ekstrakurikuler"
											onclick={() =>
												(anggotaEkstra = { id: Number(row.id), nama: String(row.nama ?? '') })}
										>
											<Icon name="users" />
											Anggota
										</button>
									{/if}
									{#if entitas?.formPengguna}
										<a class="btn btn-soft btn-sm shadow-none" href={`/pengguna/form/${row.id}`}>
											<Icon name="edit" />
											Ubah
										</a>
									{:else}
										<button
											type="button"
											class="btn btn-soft btn-sm shadow-none"
											onclick={() => bukaUbah(row)}
										>
											<Icon name="edit" />
											Ubah
										</button>
									{/if}
									<button
										type="button"
										class="btn btn-soft btn-error btn-sm shadow-none"
										onclick={() => (hapusId = row.id)}
									>
										<Icon name="del" />
									</button>
								{/if}
							</div>
						</td>
					</tr>
				{:else}
					<tr>
						<td class="p-6 text-center" colspan={(entitas?.kolom.length ?? 0) + 2}>
							<em class="opacity-60">
								{data.filter.q
									? 'Tidak ada data yang cocok dengan pencarian.'
									: 'Belum ada data untuk ditampilkan.'}
							</em>
						</td>
					</tr>
				{/each}
			</tbody>
		</table>
	</div>

	{#if totalHalaman > 1}
		<div class="mt-4 flex justify-center">
			<div class="join">
				<button
					type="button"
					class="join-item btn"
					disabled={halamanSekarang <= 1}
					onclick={() => gotoPage(halamanSekarang - 1)}
				>
					«
				</button>
				{#each nomorHalaman as nomor, index (index)}
					{#if nomor === '…'}
						<button type="button" class="join-item btn" disabled>…</button>
					{:else}
						<button
							type="button"
							class="join-item btn"
							class:btn-active={nomor === halamanSekarang}
							onclick={() => gotoPage(nomor)}
						>
							{nomor}
						</button>
					{/if}
				{/each}
				<button
					type="button"
					class="join-item btn"
					disabled={halamanSekarang >= totalHalaman}
					onclick={() => gotoPage(halamanSekarang + 1)}
				>
					»
				</button>
			</div>
		</div>
	{/if}

	<p class="mt-3 text-center text-sm opacity-70">
		Menampilkan {barisTampil} dari {total} data
	</p>
</div>

{#if entitas && formTerbuka}
	<dialog class="modal" open>
		<div class="modal-box max-w-2xl">
			<h3 class="mb-4 text-lg font-bold">
				{barisEdit ? 'Ubah' : 'Tambah'}
				{entitas.judul}
			</h3>

			<FormEnhance action="?/simpan" showToast={false} onsuccess={handleSimpan}>
				{#snippet children({ submitting, invalid })}
					{#if barisEdit}
						<input type="hidden" name="id" value={barisEdit.id} />
					{/if}

					<div class="grid gap-3 sm:grid-cols-2">
						{#each entitas.fields as field (field.key)}
							<div
								class="form-control {entitas.key === 'mata_pelajaran' && field.key === 'kelas_id'
									? 'sm:col-span-2'
									: ''}"
							>
								<span class="label-text mb-1 text-sm font-medium">
									{field.label}
									{#if field.wajib}<span class="text-error">*</span>{/if}
								</span>
								{#if field.tipe === 'toggle'}
									<input
										type="checkbox"
										name={field.key}
										class="toggle toggle-primary rounded-full"
										checked={nilaiField(field.key) === 'Ya' || nilaiField(field.key) === 'true'}
										disabled={submitting}
									/>
								{:else if field.tipe === 'pilihan'}
									<select
										name={field.key}
										class="select select-bordered w-full rounded-xl"
										required={field.wajib}
										disabled={submitting}
									>
										{#if !field.wajib}<option value="">—</option>{/if}
										{#each field.opsi ?? [] as opsi (opsi.value)}
											<option value={opsi.value} selected={nilaiField(field.key) === opsi.value}>
												{opsi.label}
											</option>
										{/each}
									</select>
								{:else if field.tipe === 'relasi'}
									{#if entitas.key === 'mata_pelajaran' && field.key === 'kelas_id'}
										{@const semuaOpsiKelas = relasi[field.relasi ?? 'kelas'] ?? []}
										<div
											class="border-base-300 dark:border-base-200 bg-base-200/50 space-y-2 rounded-xl border p-3"
										>
											<div class="flex items-center justify-between border-b pb-2">
												<label class="flex cursor-pointer items-center gap-2 text-xs font-semibold">
													<input
														type="checkbox"
														name="semua_kelas"
														value="1"
														class="checkbox checkbox-xs checkbox-primary"
														checked={semuaOpsiKelas.length > 0 &&
															mapelKelasTerpilih.length === semuaOpsiKelas.length}
														onchange={(e) => {
															if ((e.currentTarget as HTMLInputElement).checked) {
																mapelKelasTerpilih = semuaOpsiKelas.map((k) => Number(k.value));
															} else {
																mapelKelasTerpilih = [];
															}
														}}
													/>
													<span>Pilih Semua Kelas ({semuaOpsiKelas.length} kelas)</span>
												</label>
												<div class="flex items-center gap-1.5">
													<button
														type="button"
														class="btn btn-ghost btn-xs text-primary text-xs"
														onclick={() =>
															(mapelKelasTerpilih = semuaOpsiKelas.map((k) => Number(k.value)))}
													>
														Pilih Semua
													</button>
													<span class="opacity-30">•</span>
													<button
														type="button"
														class="btn btn-ghost btn-xs text-xs text-error"
														onclick={() => (mapelKelasTerpilih = [])}
													>
														Kosongkan
													</button>
												</div>
											</div>

											<!-- Daftar Pilihan Kelas Selalu Ditampilkan -->
											<div
												class="border-base-300 bg-base-100 grid max-h-48 grid-cols-2 gap-1.5 overflow-y-auto rounded-lg border p-2 sm:grid-cols-4"
											>
												{#each semuaOpsiKelas as k (k.value)}
													<label
														class="hover:bg-base-200 flex cursor-pointer items-center gap-1.5 rounded p-1 text-xs"
													>
														<input
															type="checkbox"
															name="kelas_ids"
															value={k.value}
															class="checkbox checkbox-xs"
															checked={mapelKelasTerpilih.includes(Number(k.value))}
															onchange={(e) => {
																const val = Number(k.value);
																if ((e.currentTarget as HTMLInputElement).checked) {
																	mapelKelasTerpilih = [...mapelKelasTerpilih, val];
																} else {
																	mapelKelasTerpilih = mapelKelasTerpilih.filter(
																		(id) => id !== val
																	);
																}
															}}
														/>
														<span class="truncate">{k.label}</span>
													</label>
												{/each}
											</div>
											<div class="flex items-center justify-between text-xs opacity-70">
												<span
													>Terpilih: <strong>{mapelKelasTerpilih.length}</strong> dari {semuaOpsiKelas.length}
													kelas</span
												>
												{#if semuaOpsiKelas.length > 0 && mapelKelasTerpilih.length === semuaOpsiKelas.length}
													<span class="badge badge-success badge-xs font-semibold"
														>Semua Kelas Terpilih</span
													>
												{:else if mapelKelasTerpilih.length === 0}
													<span class="badge badge-error badge-xs font-semibold"
														>Wajib pilih minimal 1 kelas</span
													>
												{/if}
											</div>
										</div>
									{:else}
										<select
											name={field.key}
											class="select select-bordered w-full rounded-xl"
											required={field.wajib}
											disabled={submitting}
										>
											{#if field.opsiTambahan}
												{#each field.opsiTambahan as opsi (opsi.value)}
													<option
														value={opsi.value}
														selected={nilaiField(field.key) === opsi.value}
													>
														{opsi.label}
													</option>
												{/each}
											{:else if !field.wajib}<option value="">—</option>{/if}
											{#each relasi[field.relasi ?? 'kelas'] ?? [] as opsi (opsi.value)}
												<option
													value={opsi.value}
													selected={nilaiField(field.key) === String(opsi.value)}
												>
													{opsi.label}
												</option>
											{/each}
										</select>
									{/if}
								{:else if field.tipe === 'textarea'}
									<textarea
										name={field.key}
										class="textarea textarea-bordered w-full rounded-xl"
										rows="3"
										required={field.wajib}
										placeholder={field.placeholder ?? ''}
										disabled={submitting}>{nilaiField(field.key)}</textarea
									>
								{:else}
									<input
										name={field.key}
										type={field.tipe === 'tanggal'
											? 'date'
											: field.tipe === 'angka' || field.tipe === 'desimal'
												? 'number'
												: 'text'}
										class="input input-bordered w-full rounded-xl"
										value={nilaiField(field.key)}
										required={field.wajib}
										placeholder={field.placeholder ?? ''}
										disabled={submitting}
									/>
								{/if}
								{#if field.bantu}
									<span class="label-text-alt mt-1 text-xs opacity-70">{field.bantu}</span>
								{/if}
							</div>
						{/each}
					</div>

					<div class="modal-action">
						<button
							type="button"
							class="btn btn-ghost rounded-xl"
							onclick={tutupForm}
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
								<Icon name="save" />
							{/if}
							Simpan
						</button>
					</div>
				{/snippet}
			</FormEnhance>
		</div>
		<form method="dialog" class="modal-backdrop">
			<button>close</button>
		</form>
	</dialog>
{/if}

{#if entitas && bulkTerbuka}
	<dialog class="modal" open>
		<div class="modal-box max-w-3xl">
			<h3 class="mb-1 text-lg font-bold">Tambah {entitas.judul} Massal</h3>
			<p class="mb-4 text-sm opacity-70">
				Satu mata pelajaran ditambahkan ke beberapa kelas sekaligus. Kelas yang sudah punya mapel
				dengan nama sama otomatis dilewati.
			</p>

			<FormEnhance action="?/simpanMassal" showToast={false} onsuccess={handleSimpan}>
				{#snippet children({ submitting, invalid })}
					<div class="grid gap-3 sm:grid-cols-2">
						<label class="form-control">
							<span class="label-text mb-1 text-sm">
								Nama Mata Pelajaran <span class="text-error">*</span>
							</span>
							<input
								name="nama"
								type="text"
								class="input input-bordered w-full rounded-xl"
								required
								placeholder="Matematika"
								disabled={submitting}
							/>
						</label>
						<label class="form-control">
							<span class="label-text mb-1 text-sm">Jenis</span>
							<select
								name="jenis"
								class="select select-bordered w-full rounded-xl"
								disabled={submitting}
							>
								<option value="wajib">Wajib</option>
								<option value="pilihan">Pilihan</option>
								<option value="mulok">Mulok</option>
								<option value="kejuruan">Kejuruan</option>
								<option value="pemberdayaan">Pemberdayaan</option>
							</select>
						</label>
						<label class="form-control">
							<span class="label-text mb-1 text-sm">Kode</span>
							<input
								name="kode"
								type="text"
								class="input input-bordered w-full rounded-xl"
								disabled={submitting}
							/>
						</label>
						<label class="form-control">
							<span class="label-text mb-1 text-sm">KKM</span>
							<input
								name="kkm"
								type="number"
								class="input input-bordered w-full rounded-xl"
								value="0"
								disabled={submitting}
							/>
						</label>
						<label class="form-control">
							<span class="label-text mb-1 text-sm">Guru Pengampu</span>
							<select
								name="pengampu_id"
								class="select select-bordered w-full rounded-xl"
								disabled={submitting}
							>
								<option value="">—</option>
								{#each relasi.pegawai ?? [] as opsi (opsi.value)}
									<option value={opsi.value}>{opsi.label}</option>
								{/each}
							</select>
						</label>
					</div>

					<div class="mt-4">
						<div class="mb-1 flex items-center justify-between">
							<span class="label-text text-sm">
								Pilih Kelas ({kelasTerpilihMassal.length} dipilih)
							</span>
							<button
								type="button"
								class="btn btn-ghost btn-xs rounded-lg"
								onclick={() =>
									(kelasTerpilihMassal = (relasi.kelas ?? []).map((opsi) => opsi.value))}
							>
								Pilih semua
							</button>
						</div>
						<div class="bg-base-200 max-h-56 overflow-y-auto rounded-box p-2">
							{#each relasi.kelas ?? [] as opsi (opsi.value)}
								<label
									class="hover:bg-base-300 flex cursor-pointer items-center gap-2 rounded px-2 py-1"
								>
									<input
										type="checkbox"
										name="kelas_ids"
										value={opsi.value}
										class="checkbox checkbox-primary checkbox-sm rounded-md"
										checked={kelasTerpilihMassal.includes(opsi.value)}
										onchange={(event) =>
											toggleKelasMassal(
												opsi.value,
												(event.currentTarget as HTMLInputElement).checked
											)}
									/>
									<span class="text-sm">{opsi.label}</span>
								</label>
							{/each}
						</div>
					</div>

					<div class="modal-action">
						<button
							type="button"
							class="btn btn-ghost rounded-xl"
							onclick={() => (bulkTerbuka = false)}
							disabled={submitting}
						>
							<Icon name="close" />
							Batal
						</button>
						<button
							type="submit"
							class="btn btn-primary btn-soft rounded-xl shadow-none"
							disabled={submitting || invalid || kelasTerpilihMassal.length === 0}
						>
							{#if submitting}
								<span class="loading loading-spinner loading-sm"></span>
							{:else}
								<Icon name="save" />
							{/if}
							Tambah ke {kelasTerpilihMassal.length} Kelas
						</button>
					</div>
				{/snippet}
			</FormEnhance>
		</div>
		<form method="dialog" class="modal-backdrop">
			<button>close</button>
		</form>
	</dialog>
{/if}

{#if entitas && entitas.key === 'mata_pelajaran'}
	{@const daftarKelasUbah = relasi.kelas ?? []}
	<dialog class="modal" class:modal-open={ubahKelasTerbuka} open={ubahKelasTerbuka}>
		<div class="modal-box max-w-3xl">
			<h3 class="mb-1 text-lg font-bold">Ubah Kelas {terpilih.length} Mata Pelajaran</h3>
			<p class="mb-4 text-sm opacity-70">
				Pilih tindakan pemindahan atau penambahan kelas untuk mata pelajaran yang dipilih.
			</p>

			<FormEnhance action="?/ubahKelasMassal" showToast={false} onsuccess={handleUbahKelas}>
				{#snippet children({ submitting, invalid })}
					<input type="hidden" name="ids" value={JSON.stringify(terpilih)} />

					<div class="space-y-4">
						<fieldset class="fieldset bg-base-200/50 rounded-box border-base-300 border p-3">
							<legend class="fieldset-legend text-sm font-semibold">Mode Perubahan</legend>
							<div class="space-y-2">
								<label
									class="hover:bg-base-200/60 flex cursor-pointer items-start gap-3 rounded-lg p-2"
								>
									<input
										type="radio"
										name="mode"
										value="tambah"
										class="radio radio-primary radio-sm mt-0.5"
										bind:group={modeUbah}
										disabled={submitting}
									/>
									<div>
										<span class="block text-sm font-medium">Tambahkan ke kelas terpilih</span>
										<span class="text-base-content/70 block text-xs"
											>Mapel yang dipilih juga tampil di kelas baru; kelas lama tetap ada.</span
										>
									</div>
								</label>
								<label
									class="hover:bg-base-200/60 flex cursor-pointer items-start gap-3 rounded-lg p-2"
								>
									<input
										type="radio"
										name="mode"
										value="ganti"
										class="radio radio-primary radio-sm mt-0.5"
										bind:group={modeUbah}
										disabled={submitting}
									/>
									<div>
										<span class="block text-sm font-medium">Ganti menjadi kelas terpilih</span>
										<span class="text-base-content/70 block text-xs"
											>Mapel dipindahkan hanya ke kelas terpilih; kelas lain dikosongkan (yang sudah
											punya nilai tidak dihapus).</span
										>
									</div>
								</label>
							</div>
						</fieldset>

						<div
							class="border-base-300 dark:border-base-200 bg-base-200/50 space-y-2 rounded-xl border p-3"
						>
							<div class="flex items-center justify-between border-b pb-2">
								<label class="flex cursor-pointer items-center gap-2 text-xs font-semibold">
									<input
										type="checkbox"
										class="checkbox checkbox-xs checkbox-primary"
										checked={daftarKelasUbah.length > 0 &&
											kelasTerpilihUbah.length === daftarKelasUbah.length}
										onchange={(e) => {
											if ((e.currentTarget as HTMLInputElement).checked) {
												kelasTerpilihUbah = daftarKelasUbah.map((k) => Number(k.value));
											} else {
												kelasTerpilihUbah = [];
											}
										}}
										disabled={submitting}
									/>
									<span>Pilih Semua Kelas ({daftarKelasUbah.length} kelas)</span>
								</label>
								<div class="flex items-center gap-1.5">
									<button
										type="button"
										class="btn btn-ghost btn-xs text-primary text-xs"
										onclick={() =>
											(kelasTerpilihUbah = daftarKelasUbah.map((k) => Number(k.value)))}
										disabled={submitting}
									>
										Pilih Semua
									</button>
									<span class="opacity-30">•</span>
									<button
										type="button"
										class="btn btn-ghost btn-xs text-xs text-error"
										onclick={() => (kelasTerpilihUbah = [])}
										disabled={submitting}
									>
										Kosongkan
									</button>
								</div>
							</div>

							<div
								class="border-base-300 bg-base-100 grid max-h-48 grid-cols-2 gap-1.5 overflow-y-auto rounded-lg border p-2 sm:grid-cols-4"
							>
								{#each daftarKelasUbah as opsi (opsi.value)}
									<label
										class="hover:bg-base-200 flex cursor-pointer items-center gap-1.5 rounded p-1 text-xs"
									>
										<input
											type="checkbox"
											name="kelas_ids"
											value={opsi.value}
											class="checkbox checkbox-xs"
											checked={kelasTerpilihUbah.includes(Number(opsi.value))}
											onchange={(e) => {
												const val = Number(opsi.value);
												if ((e.currentTarget as HTMLInputElement).checked) {
													kelasTerpilihUbah = [...kelasTerpilihUbah, val];
												} else {
													kelasTerpilihUbah = kelasTerpilihUbah.filter((id) => id !== val);
												}
											}}
											disabled={submitting}
										/>
										<span class="truncate">{opsi.label}</span>
									</label>
								{/each}
							</div>
							<div class="flex items-center justify-between text-xs opacity-70">
								<span>
									Terpilih: <strong>{kelasTerpilihUbah.length}</strong> dari {daftarKelasUbah.length}
									kelas
								</span>
								{#if daftarKelasUbah.length > 0 && kelasTerpilihUbah.length === daftarKelasUbah.length}
									<span class="badge badge-success badge-xs font-semibold"
										>Semua Kelas Terpilih</span
									>
								{:else if kelasTerpilihUbah.length === 0}
									<span class="badge badge-error badge-xs font-semibold"
										>Wajib pilih minimal 1 kelas</span
									>
								{/if}
							</div>
						</div>
					</div>

					<div class="modal-action">
						<button
							type="button"
							class="btn btn-ghost rounded-xl"
							onclick={() => (ubahKelasTerbuka = false)}
							disabled={submitting}
						>
							<Icon name="close" />
							Batal
						</button>
						<button
							type="submit"
							class="btn btn-primary btn-soft rounded-xl shadow-none"
							disabled={submitting || invalid || kelasTerpilihUbah.length === 0}
						>
							{#if submitting}
								<span class="loading loading-spinner loading-sm"></span>
							{:else}
								<Icon name="save" />
							{/if}
							Simpan Perubahan
						</button>
					</div>
				{/snippet}
			</FormEnhance>
		</div>
		<form method="dialog" class="modal-backdrop">
			<button onclick={() => (ubahKelasTerbuka = false)}>close</button>
		</form>
	</dialog>
{/if}

{#if entitas?.key === 'kelas'}
	<PindahMuridModal bind:isOpen={pindahMuridTerbuka} daftarKelas={data.daftarKelasMurid ?? []} />
{/if}

{#if anggotaEkstra && data.anggotaEkstrakurikuler}
	<AnggotaEkstrakurikulerModal
		ekstra={anggotaEkstra}
		murid={data.anggotaEkstrakurikuler.murid}
		kelas={data.anggotaEkstrakurikuler.kelas}
		anggotaAwal={data.anggotaEkstrakurikuler.anggota?.[anggotaEkstra.id] ?? []}
		onClose={() => (anggotaEkstra = null)}
	/>
{/if}
