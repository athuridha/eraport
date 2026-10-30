<script lang="ts">
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import Icon from '$lib/components/icon.svelte';
	import FormEnhance from '$lib/components/form-enhance.svelte';
	import { showModal } from '$lib/components/global-modal.svelte';
	import FilterToolbar from '$lib/components/table/filter-toolbar.svelte';
	import { setFilter, resetFilters, countActiveFilters } from '$lib/utils/url-filter';

	type Pelanggaran = {
		id: number;
		nama: string;
		poin: number;
		kategori: string | null;
		dipakai: number;
	};

	type MuridRekap = {
		id: number;
		nama: string;
		nisn: string | null;
		kelasNama: string | null;
		totalPoin: number;
		jumlahRiwayat: number;
	};

	type Riwayat = {
		id: number;
		tanggal: string;
		catatan: string | null;
		muridNama: string;
		pelanggaranNama: string;
		poin: number;
		pelaporNama: string | null;
	};

	type PageData = {
		kelasAktif: { id: number; nama: string } | null;
		daftarPelanggaran: Pelanggaran[];
		rekap: MuridRekap[];
		riwayat: Riwayat[];
		filter?: { q: string; status: 'ada_poin' | 'bersih' | 'semua' };
		kosongKarenaFilter: boolean;
	};

	let { data }: { data: PageData } = $props();

	const KUNCI_FILTER = ['q', 'status'];

	// svelte-ignore state_referenced_locally
	let searchTerm = $state(data.filter?.q ?? '');

	$effect(() => {
		const latest = data.filter?.q ?? '';
		if (searchTerm !== latest) {
			searchTerm = latest;
		}
	});

	async function terapkanFilter(key: string, value: string) {
		await goto(setFilter(page.url, key, value), { replaceState: true, keepFocus: true });
	}

	const today = $derived(new Date().toISOString().slice(0, 10));

	let tambahTerbuka = $state(false);
	let beriPoinTerbuka = $state(false);
	let targetMuridNama = $state('');
	let targetMuridId = $state<number | null>(null);

	// Shared delete form: value is set right before requestSubmit() from the
	// confirmation modal.
	let hapusPelanggaranId = $state<number | null>(null);
	let hapusPoinId = $state<number | null>(null);

	let formBeriTanggal = $state('');
	let formBeriPelanggaranId = $state('');
	let formBeriCatatan = $state('');

	function bukaTambah() {
		tambahTerbuka = true;
	}

	function bukaBeriPoin(murid: MuridRekap) {
		targetMuridId = murid.id;
		targetMuridNama = murid.nama;
		formBeriTanggal = new Date().toISOString().slice(0, 10);
		formBeriPelanggaranId = '';
		formBeriCatatan = '';
		beriPoinTerbuka = true;
	}

	function tutupBeriPoin() {
		beriPoinTerbuka = false;
		targetMuridId = null;
		targetMuridNama = '';
	}

	function konfirmasiHapusPelanggaran(pelanggaran: Pelanggaran) {
		hapusPelanggaranId = null;
		hapusPoinId = null;
		showModal({
			title: 'Hapus Pelanggaran',
			body: `Hapus pelanggaran <strong>${pelanggaran.nama}</strong> (${
				pelanggaran.dipakai
			} riwayat ${pelanggaran.dipakai > 0 ? 'akan ikut terhapus' : 'belum ada'})?`,
			dismissible: false,
			onPositive: {
				label: 'Hapus',
				class: 'btn-error',
				action: async ({ close }) => {
					hapusPelanggaranId = pelanggaran.id;
					close();
					const form = document.getElementById('form-hapus-pelanggaran') as HTMLFormElement | null;
					form?.requestSubmit();
				}
			},
			onNegative: { label: 'Batal' }
		});
	}

	function konfirmasiHapusPoin(riwayat: Riwayat) {
		hapusPelanggaranId = null;
		hapusPoinId = null;
		showModal({
			title: 'Hapus Riwayat Poin',
			body: `Hapus riwayat <strong>${riwayat.pelanggaranNama}</strong> atas <strong>${riwayat.muridNama}</strong>?`,
			dismissible: false,
			onPositive: {
				label: 'Hapus',
				class: 'btn-error',
				action: async ({ close }) => {
					hapusPoinId = riwayat.id;
					close();
					const form = document.getElementById('form-hapus-poin') as HTMLFormElement | null;
					form?.requestSubmit();
				}
			},
			onNegative: { label: 'Batal' }
		});
	}

	function badgePoin(total: number) {
		if (total >= 30) return { cls: 'bg-error text-error-content', label: 'Panggil Ortu' };
		if (total >= 15) return { cls: 'bg-warning text-warning-content', label: 'Pemantauan' };
		if (total > 0) return { cls: 'bg-success text-success-content', label: 'Aman' };
		return { cls: 'bg-base-300 text-base-content', label: 'Bersih' };
	}

	function formatTanggal(iso: string) {
		try {
			return new Date(iso).toLocaleDateString('id-ID', {
				day: 'numeric',
				month: 'short',
				year: 'numeric'
			});
		} catch {
			return iso;
		}
	}

	const adaKelasAktif = $derived(!!data.kelasAktif);
	const statusPoin = $derived(page.url.searchParams.get('status') ?? 'semua');

	// Group students per class when browsing all classes (admin mode),
	// otherwise they already belong to the active class.
	const rekapGrup = $derived.by(() => {
		if (adaKelasAktif) return [{ kelasNama: data.kelasAktif!.nama, murid: data.rekap }];
		const map = new Map<string, MuridRekap[]>();
		for (const murid of data.rekap) {
			const key = murid.kelasNama ?? '(Tanpa Kelas)';
			const list = map.get(key);
			if (list) list.push(murid);
			else map.set(key, [murid]);
		}
		return [...map.entries()].map(([kelasNama, murid]) => ({ kelasNama, murid }));
	});
</script>

<div class="card bg-base-100 rounded-lg border border-none p-4 shadow-md">
	<div class="mb-4 flex flex-wrap items-start justify-between gap-2">
		<div>
			<h2 class="text-xl font-bold">Poin Siswa</h2>
			<p class="text-base-content/80 text-sm">
				{adaKelasAktif ? `Kelas ${data.kelasAktif!.nama}` : 'Semua Kelas'} · Rekap poin tata tertib
			</p>
		</div>
		<a href="/poin-siswa/rekap" class="btn btn-soft btn-sm">
			<Icon name="users" />
			Rekap Poin
		</a>
	</div>

	<div class="grid gap-4 lg:grid-cols-2">
		<!-- Master pelanggaran -->
		<div class="card bg-base-200/50 rounded-md p-3">
			<div class="mb-2 flex items-center justify-between">
				<h3 class="font-bold">Master Pelanggaran</h3>
				<button type="button" class="btn btn-primary btn-soft btn-sm" onclick={bukaTambah}>
					<Icon name="plus" />
					Tambah
				</button>
			</div>
			{#if !data.daftarPelanggaran.length}
				<div class="alert alert-soft alert-info">
					<Icon name="info" />
					<span>Belum ada daftar pelanggaran. Tambahkan lewat tombol Tambah.</span>
				</div>
			{:else}
				<div class="overflow-x-auto rounded-md">
					<table class="table table-sm">
						<thead>
							<tr class="text-base-content text-left font-bold">
								<th style="min-width: 160px;">Nama</th>
								<th style="min-width: 60px;">Poin</th>
								<th style="min-width: 90px;">Kategori</th>
								<th class="text-center" style="min-width: 70px;">Pakai</th>
								<th class="text-center" style="min-width: 70px;">Aksi</th>
							</tr>
						</thead>
						<tbody>
							{#each data.daftarPelanggaran as pelanggaran (pelanggaran.id)}
								<tr>
									<td class="font-medium">{pelanggaran.nama}</td>
									<td>
										<span class="badge badge-primary badge-lg">{pelanggaran.poin}</span>
									</td>
									<td>{pelanggaran.kategori ?? '—'}</td>
									<td class="text-center">{pelanggaran.dipakai}</td>
									<td class="text-center">
										<button
											type="button"
											class="btn btn-error btn-soft btn-sm shadow-none"
											onclick={() => konfirmasiHapusPelanggaran(pelanggaran)}
											title="Hapus"
										>
											<Icon name="del" />
										</button>
									</td>
								</tr>
							{/each}
						</tbody>
					</table>
				</div>
			{/if}
		</div>

		<!-- Rekap murid + riwayat -->
		<div class="flex flex-col gap-4">
			<div class="card bg-base-200/50 rounded-md p-3">
				<div class="mb-3 flex flex-col gap-2">
					<h3 class="font-bold">Rekap Murid</h3>

					<FilterToolbar
						bind:q={searchTerm}
						qPlaceholder="Cari nama murid..."
						onSearch={(value) => terapkanFilter('q', value)}
						aktif={countActiveFilters(page.url, KUNCI_FILTER)}
						onReset={() =>
							goto(resetFilters(page.url, KUNCI_FILTER), { replaceState: true, keepFocus: true })}
					>
						<!-- Filter Status Poin -->
						<div class="join">
							<button
								type="button"
								class="btn btn-xs join-item"
								class:btn-active={statusPoin === 'semua'}
								onclick={() => terapkanFilter('status', 'semua')}
							>
								Semua
							</button>
							<button
								type="button"
								class="btn btn-xs join-item"
								class:btn-active={statusPoin === 'ada_poin'}
								onclick={() => terapkanFilter('status', 'ada_poin')}
							>
								Ada Poin
							</button>
							<button
								type="button"
								class="btn btn-xs join-item"
								class:btn-active={statusPoin === 'bersih'}
								onclick={() => terapkanFilter('status', 'bersih')}
							>
								Bersih (0)
							</button>
						</div>
					</FilterToolbar>
				</div>

				{#if !data.rekap.length}
					<div class="alert alert-soft alert-info">
						<Icon name="info" />
						<span>
							{data.kosongKarenaFilter
								? 'Tidak ada murid yang cocok dengan filter.'
								: 'Belum ada murid pada cakupan ini.'}
						</span>
					</div>
				{:else}
					{#each rekapGrup as grup, index (grup.kelasNama)}
						{#if !adaKelasAktif}
							<h4
								class="text-base-content/70 mt-2 mb-1 text-sm font-semibold uppercase tracking-wide"
							>
								{grup.kelasNama}
							</h4>
						{/if}
						<div class="overflow-x-auto rounded-md" class:mt-2={adaKelasAktif || index > 0}>
							<table class="table table-sm">
								<thead>
									<tr class="text-base-content text-left font-bold">
										<th style="min-width: 140px;">Nama</th>
										<th style="min-width: 60px;">Total</th>
										<th class="text-center" style="min-width: 110px;">Status</th>
										<th class="text-center" style="min-width: 80px;">Aksi</th>
									</tr>
								</thead>
								<tbody>
									{#each grup.murid as murid (murid.id)}
										{@const badge = badgePoin(murid.totalPoin)}
										<tr>
											<td>
												<span class="font-medium">{murid.nama}</span>
												{#if murid.jumlahRiwayat > 0}
													<p class="text-base-content/60 text-xs">
														{murid.jumlahRiwayat} riwayat
													</p>
												{/if}
											</td>
											<td>
												<span class="badge {badge.cls}">{murid.totalPoin}</span>
											</td>
											<td class="text-center">
												<span class="badge badge-soft {badge.cls}">{badge.label}</span>
											</td>
											<td class="text-center">
												<button
													type="button"
													class="btn btn-primary btn-soft btn-sm shadow-none"
													onclick={() => bukaBeriPoin(murid)}
													title="Beri poin"
												>
													<Icon name="plus" />
													Beri Poin
												</button>
											</td>
										</tr>
									{/each}
								</tbody>
							</table>
						</div>
					{/each}
				{/if}
			</div>

			<div class="card bg-base-200/50 rounded-md p-3">
				<h3 class="mb-2 font-bold">Riwayat Terakhir</h3>
				{#if !data.riwayat.length}
					<div class="alert alert-soft alert-info">
						<Icon name="info" />
						<span>Belum ada riwayat poin.</span>
					</div>
				{:else}
					<ul class="space-y-2">
						{#each data.riwayat as riwayat (riwayat.id)}
							<li
								class="border-base-300 bg-base-100 flex items-start justify-between gap-2 rounded-md border p-2"
							>
								<div class="min-w-0">
									<p class="text-sm">
										<span class="font-medium">{riwayat.muridNama}</span>
										<span class="text-base-content/70">— {riwayat.pelanggaranNama}</span>
									</p>
									<p class="text-base-content/60 text-xs">
										{formatTanggal(riwayat.tanggal)}
										{#if riwayat.pelaporNama}
											· pelapor {riwayat.pelaporNama}
										{/if}
									</p>
									{#if riwayat.catatan}
										<p class="text-base-content/70 mt-1 text-xs italic">{riwayat.catatan}</p>
									{/if}
								</div>
								<div class="flex shrink-0 items-center gap-1">
									<span class="badge badge-primary">+{riwayat.poin}</span>
									<button
										type="button"
										class="btn btn-error btn-soft btn-xs shadow-none"
										onclick={() => konfirmasiHapusPoin(riwayat)}
										title="Hapus riwayat"
									>
										<Icon name="del" />
									</button>
								</div>
							</li>
						{/each}
					</ul>
				{/if}
			</div>
		</div>
	</div>
</div>

{#if tambahTerbuka}
	<dialog class="modal" open onclose={() => (tambahTerbuka = false)}>
		<div class="modal-box max-w-md p-4">
			<h3 class="mb-2 text-lg font-bold">Tambah Pelanggaran</h3>
			<FormEnhance
				id="form-tambah-pelanggaran"
				action="?/tambahPelanggaran"
				onsuccess={() => (tambahTerbuka = false)}
			>
				{#snippet children({ submitting })}
					<fieldset class="fieldset">
						<legend class="fieldset-legend font-semibold">Nama pelanggaran</legend>
						<input
							name="nama"
							type="text"
							class="input bg-base-200 dark:bg-base-300 w-full dark:border-none"
							placeholder="Contoh: Terlambat masuk kelas"
							required
							disabled={submitting}
						/>
					</fieldset>
					<fieldset class="fieldset">
						<legend class="fieldset-legend font-semibold">Poin</legend>
						<input
							name="poin"
							type="number"
							min="0"
							step="1"
							class="input bg-base-200 dark:bg-base-300 w-full dark:border-none"
							required
							disabled={submitting}
						/>
					</fieldset>
					<fieldset class="fieldset">
						<legend class="fieldset-legend font-semibold">Kategori (opsional)</legend>
						<input
							name="kategori"
							type="text"
							class="input bg-base-200 dark:bg-base-300 w-full dark:border-none"
							placeholder="Contoh: Kedisiplinan"
							disabled={submitting}
						/>
					</fieldset>
					<div class="modal-action">
						<button
							type="button"
							class="btn btn-ghost"
							onclick={() => (tambahTerbuka = false)}
							disabled={submitting}
						>
							Batal
						</button>
						<button type="submit" class="btn btn-primary" disabled={submitting}>
							<Icon name="save" />
							Simpan
						</button>
					</div>
				{/snippet}
			</FormEnhance>
		</div>
		<button
			type="button"
			aria-label="Tutup"
			class="modal-backdrop"
			onclick={() => (tambahTerbuka = false)}
		></button>
	</dialog>
{/if}

{#if beriPoinTerbuka && targetMuridId !== null}
	<dialog class="modal" open onclose={tutupBeriPoin}>
		<div class="modal-box max-w-md p-4">
			<h3 class="mb-2 text-lg font-bold">Beri Poin</h3>
			<p class="text-base-content/70 mb-3 text-sm">Murid: <strong>{targetMuridNama}</strong></p>
			<FormEnhance id="form-beri-poin" action="?/beriPoin" onsuccess={() => tutupBeriPoin()}>
				{#snippet children({ submitting })}
					<input type="hidden" name="muridId" value={targetMuridId} />
					<fieldset class="fieldset">
						<legend class="fieldset-legend font-semibold">Pelanggaran</legend>
						<select
							name="pelanggaranId"
							class="select bg-base-200 dark:bg-base-300 w-full dark:border-none"
							required
							disabled={submitting}
							onchange={(event) => (formBeriPelanggaranId = event.currentTarget.value)}
						>
							<option value="" disabled selected={!formBeriPelanggaranId}>Pilih pelanggaran</option>
							{#each data.daftarPelanggaran as pelanggaran (pelanggaran.id)}
								<option
									value={pelanggaran.id}
									selected={formBeriPelanggaranId === String(pelanggaran.id)}
								>
									{pelanggaran.nama} ({pelanggaran.poin} poin)
								</option>
							{/each}
						</select>
					</fieldset>
					<fieldset class="fieldset">
						<legend class="fieldset-legend font-semibold">Tanggal</legend>
						<input
							type="date"
							name="tanggal"
							max={today}
							value={formBeriTanggal}
							onchange={(event) => (formBeriTanggal = event.currentTarget.value)}
							class="input bg-base-200 dark:bg-base-300 w-full dark:border-none"
							required
							disabled={submitting}
						/>
					</fieldset>
					<fieldset class="fieldset">
						<legend class="fieldset-legend font-semibold">Catatan (opsional)</legend>
						<textarea
							name="catatan"
							class="textarea bg-base-200 dark:bg-base-300 w-full dark:border-none"
							rows="2"
							placeholder="Keterangan tambahan"
							disabled={submitting}
							oninput={(event) => (formBeriCatatan = event.currentTarget.value)}
							>{formBeriCatatan}</textarea
						>
					</fieldset>
					<div class="modal-action">
						<button
							type="button"
							class="btn btn-ghost"
							onclick={tutupBeriPoin}
							disabled={submitting}
						>
							Batal
						</button>
						<button type="submit" class="btn btn-primary" disabled={submitting}>
							<Icon name="check" />
							Simpan
						</button>
					</div>
				{/snippet}
			</FormEnhance>
		</div>
		<button type="button" aria-label="Tutup" class="modal-backdrop" onclick={tutupBeriPoin}
		></button>
	</dialog>
{/if}

<FormEnhance id="form-hapus-pelanggaran" action="?/hapusPelanggaran" class="hidden">
	<input type="hidden" name="id" value={hapusPelanggaranId ?? ''} />
</FormEnhance>

<FormEnhance id="form-hapus-poin" action="?/hapusPoin" class="hidden">
	<input type="hidden" name="id" value={hapusPoinId ?? ''} />
</FormEnhance>
