<script lang="ts">
	import { goto, invalidate } from '$app/navigation';
	import { page } from '$app/state';
	import FormEnhance from '$lib/components/form-enhance.svelte';
	import Icon from '$lib/components/icon.svelte';
	import FilterToolbar from '$lib/components/table/filter-toolbar.svelte';
	import { countActiveFilters, resetFilters, setFilter } from '$lib/utils/url-filter';

	type Perusahaan = {
		id: number;
		nama: string;
		alamat: string | null;
		bidangUsaha: string | null;
		pembimbing: string | null;
		telepon: string | null;
	};

	type Anggota = {
		id: number;
		muridId: number;
		murid: { nama: string; nisn: string } | null;
	};

	type Kelompok = {
		id: number;
		kelasId: number;
		perusahaanId: number | null;
		pembimbingPegawaiId: number | null;
		nama: string | null;
		skPenugasan: string | null;
		tanggalMulai: string | null;
		tanggalSelesai: string | null;
		lokasi: string | null;
		catatan: string | null;
		kelas: { nama: string; fase: string | null } | null;
		perusahaan: { nama: string } | null;
		pembimbing: { nama: string } | null;
		anggota: Anggota[];
	};

	type Tujuan = {
		id: number;
		urutan: number | null;
		deskripsi: string;
	};

	type MuridLite = { id: number; nama: string; kelasId: number };
	type PegawaiLite = { id: number; nama: string };
	type KelasLite = { id: number; nama: string; fase: string | null };

	interface PageData {
		authorized: boolean;
		kelasId: number | null;
		semuaKelasMode: boolean;
		q?: string;
		kosongKarenaFilter?: boolean;
		perusahaan: Perusahaan[];
		kelompok: Kelompok[];
		tujuan: Tujuan[];
		muridList: MuridLite[];
		pegawaiList: PegawaiLite[];
		daftarKelas: KelasLite[];
	}

	let { data }: { data: PageData } = $props();

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

	const canManage = $derived(data.authorized);

	/* ===== modal states ===== */
	let anggotaModalKelompok = $state<Kelompok | null>(null);
	let memberToggle = $state<Record<number, boolean>>({});
	let kelompokModalOpen = $state(false);
	let perusahaanModalOpen = $state(false);
	let confirmDelete = $state<{
		title: string;
		message: string;
		action: string;
		id: number;
	} | null>(null);

	// submit state for modals whose action button sits outside the enhanced form
	let anggotaSubmitting = $state(false);
	let kelompokSubmitting = $state(false);
	let perusahaanSubmitting = $state(false);
	let hapusSubmitting = $state(false);

	const anggotaInitial = $derived.by(() => {
		if (!anggotaModalKelompok) return new Set<number>();
		return new Set(anggotaModalKelompok.anggota.map((a) => a.muridId));
	});
	const anggotaCandidates = $derived.by(() => {
		if (!anggotaModalKelompok) return [] as MuridLite[];
		return data.muridList.filter((m) => m.kelasId === (anggotaModalKelompok as Kelompok).kelasId);
	});

	function bukaAnggotaModal(item: Kelompok) {
		anggotaModalKelompok = item;
		memberToggle = {};
	}

	function tutupAnggotaModal() {
		anggotaModalKelompok = null;
		memberToggle = {};
	}

	function toggleAnggota(muridId: number) {
		const checked = memberToggle[muridId] ?? anggotaInitial.has(muridId);
		memberToggle = { ...memberToggle, [muridId]: !checked };
	}

	function isAnggotaChecked(muridId: number) {
		return memberToggle[muridId] ?? anggotaInitial.has(muridId);
	}

	function bukaConfirm(title: string, message: string, action: string, id: number) {
		confirmDelete = { title, message, action, id };
	}

	function tutupConfirm() {
		confirmDelete = null;
	}

	function suksesTutupModal() {
		kelompokModalOpen = false;
		perusahaanModalOpen = false;
		tutupConfirm();
		invalidate('app:prakerin');
	}

	// Non-null snapshots for use inside lazy snippets (Svelte narrows only in the
	// immediate {#if} block, not inside default snippets).
	const modalKelompokId = $derived(anggotaModalKelompok?.id ?? 0);
	const confirmDeleteAction = $derived(confirmDelete?.action ?? '?');
	const confirmDeleteId = $derived(confirmDelete?.id ?? 0);
</script>

{#if !data.authorized}
	<div class="alert border-warning/60 bg-warning/10 text-warning-content mt-4 border border-dashed">
		<Icon name="lock" />
		<span>Anda tidak memiliki izin untuk mengelola PKL (Prakerin).</span>
	</div>
{/if}

<!-- ==================== Bagian 1: kelompok PKL ==================== -->
<div class="card bg-base-100 rounded-lg border border-none p-4 shadow-md">
	<div class="mb-4 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
		<div class="flex items-center gap-2">
			<Icon name="users" class="text-primary" />
			<h2 class="text-xl font-bold">Kelompok PKL</h2>
			{#if data.semuaKelasMode}
				<span class="badge badge-info badge-soft badge-sm">Semua Kelas</span>
			{/if}
		</div>
		<button
			type="button"
			class="btn btn-soft btn-sm shadow-none"
			disabled={!canManage}
			onclick={() => (kelompokModalOpen = true)}
			title={!canManage ? 'Anda tidak memiliki izin untuk menambah' : ''}
		>
			<Icon name="plus" />
			Tambah Kelompok
		</button>
	</div>

	{#if data.kelompok.length === 0}
		<div class="alert alert-soft alert-info">
			<Icon name="info" />
			<span>Belum ada kelompok PKL. Tambahkan kelompok terlebih dahulu.</span>
		</div>
	{:else}
		<div class="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
			{#each data.kelompok as item (item.id)}
				<div class="bg-base-200/40 dark:bg-base-300/40 rounded-md border border-base-300/60 p-3">
					<div class="flex items-start justify-between gap-2">
						<div>
							<h3 class="font-bold">{item.nama ?? `Kelompok ${item.id}`}</h3>
							<p class="text-base-content/70 text-sm">
								{item.kelas?.fase
									? `${item.kelas.nama} - ${item.kelas.fase}`
									: (item.kelas?.nama ?? '-')}
							</p>
						</div>
						<div class="flex items-center gap-1">
							<button
								type="button"
								class="btn btn-ghost btn-xs btn-error shadow-none"
								disabled={!canManage}
								aria-label="Hapus kelompok"
								title={!canManage ? 'Anda tidak memiliki izin untuk menghapus' : 'Hapus kelompok'}
								onclick={() =>
									bukaConfirm(
										'Hapus Kelompok PKL',
										`Yakin ingin menghapus kelompok "${item.nama ?? `Kelompok ${item.id}`}"? Semua anggota ikut terhapus.`,
										'?/hapusKelompok',
										item.id
									)}
							>
								<Icon name="del" />
							</button>
						</div>
					</div>

					<dl class="text-base-content/80 mt-2 space-y-1 text-sm">
						<div class="flex gap-2">
							<dt class="w-24 shrink-0 font-medium">Perusahaan</dt>
							<dd>{item.perusahaan?.nama ?? '-'}</dd>
						</div>
						<div class="flex gap-2">
							<dt class="w-24 shrink-0 font-medium">Pembimbing</dt>
							<dd>{item.pembimbing?.nama ?? '-'}</dd>
						</div>
						<div class="flex gap-2">
							<dt class="w-24 shrink-0 font-medium">Lokasi</dt>
							<dd>{item.lokasi ?? '-'}</dd>
						</div>
						<div class="flex gap-2">
							<dt class="w-24 shrink-0 font-medium">Periode</dt>
							<dd>
								{item.tanggalMulai ?? '-'} s/d {item.tanggalSelesai ?? '-'}
							</dd>
						</div>
					</dl>

					<div class="mt-3">
						<p class="text-base-content/60 mb-1 text-xs font-semibold uppercase">
							Anggota ({item.anggota.length})
						</p>
						<ul class="space-y-1">
							{#each item.anggota as anggota (anggota.id)}
								<li class="text-sm">
									<span class="font-medium"
										>{anggota.murid?.nama ?? `Murid #${anggota.muridId}`}</span
									>
									<span class="text-base-content/60"> · {anggota.murid?.nisn ?? '-'}</span>
								</li>
							{:else}
								<li class="text-base-content/60 text-sm italic">Belum ada anggota</li>
							{/each}
						</ul>
					</div>

					<div class="mt-3 flex items-center justify-end gap-2">
						<button
							type="button"
							class="btn btn-soft btn-sm shadow-none"
							disabled={!canManage}
							onclick={() => bukaAnggotaModal(item)}
							title={!canManage ? 'Anda tidak memiliki izin' : 'Kelola anggota kelompok'}
						>
							<Icon name="users" />
							Kelola Anggota
						</button>
						<a
							href={`/prakerin/nilais?kelompok=${item.id}`}
							class="btn btn-primary btn-sm shadow-none"
							title="Input nilai PKL kelompok ini"
						>
							<Icon name="book" />
							Input Nilai
						</a>
					</div>
				</div>
			{/each}
		</div>
	{/if}
</div>

<!-- ==================== Bagian 2: perusahaan ==================== -->
<div class="card bg-base-100 mt-6 rounded-lg border border-none p-4 shadow-md">
	<div class="mb-4 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
		<div class="flex items-center gap-2">
			<Icon name="briefcase" class="text-primary" />
			<h2 class="text-xl font-bold">Perusahaan Mitra</h2>
		</div>
	</div>

	<div class="mb-4">
		<FilterToolbar
			bind:q={searchTerm}
			qPlaceholder="Cari perusahaan/prakerin..."
			onSearch={(value) => terapkanFilter('q', value)}
			aktif={countActiveFilters(page.url, KUNCI_FILTER)}
			onReset={() =>
				goto(resetFilters(page.url, KUNCI_FILTER), { replaceState: true, keepFocus: true })}
		>
			<button
				type="button"
				class="btn btn-soft btn-sm shadow-none"
				disabled={!canManage}
				onclick={() => (perusahaanModalOpen = true)}
				title={!canManage ? 'Anda tidak memiliki izin untuk menambah' : ''}
			>
				<Icon name="plus" />
				Tambah Perusahaan
			</button>
		</FilterToolbar>
	</div>

	{#if data.perusahaan.length === 0}
		<div class="alert alert-soft alert-info">
			<Icon name="info" />
			<span
				>{data.kosongKarenaFilter
					? 'Tidak ada yang cocok dengan filter.'
					: 'Belum ada data perusahaan mitra.'}</span
			>
		</div>
	{:else}
		<div class="bg-base-100 dark:bg-base-200 overflow-x-auto rounded-md shadow-md dark:shadow-none">
			<table class="border-base-200 table min-w-[640px] border dark:border-none">
				<thead>
					<tr class="bg-base-200 dark:bg-base-300 text-left font-bold">
						<th style="width: 50px;">No</th>
						<th class="w-full">Nama</th>
						<th>Alamat</th>
						<th>Bidang Usaha</th>
						<th>Pembimbing</th>
						<th>Telepon</th>
						<th style="width: 80px;">Aksi</th>
					</tr>
				</thead>
				<tbody>
					{#each data.perusahaan as item, index (item.id)}
						<tr>
							<td>{index + 1}</td>
							<td class="font-medium">{item.nama}</td>
							<td>{item.alamat ?? '-'}</td>
							<td>{item.bidangUsaha ?? '-'}</td>
							<td>{item.pembimbing ?? '-'}</td>
							<td>{item.telepon ?? '-'}</td>
							<td class="text-right">
								<button
									type="button"
									class="btn btn-ghost btn-xs btn-error shadow-none"
									disabled={!canManage}
									aria-label="Hapus perusahaan"
									title={!canManage
										? 'Anda tidak memiliki izin untuk menghapus'
										: 'Hapus perusahaan'}
									onclick={() =>
										bukaConfirm(
											'Hapus Perusahaan',
											`Yakin ingin menghapus perusahaan "${item.nama}"?`,
											'?/hapusPerusahaan',
											item.id
										)}
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

<!-- ==================== Bagian 3: tujuan pembelajaran ==================== -->
<div class="card bg-base-100 mt-6 rounded-lg border border-none p-4 shadow-md">
	<div class="mb-4 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
		<div class="flex items-center gap-2">
			<Icon name="check-square" class="text-primary" />
			<h2 class="text-xl font-bold">Tujuan Pembelajaran PKL</h2>
		</div>
	</div>

	<FormEnhance
		id="form-tambah-tujuan"
		action="?/tambahTujuan"
		onsuccess={({ form }) => {
			form.reset();
			invalidate('app:prakerin');
		}}
	>
		{#snippet children({ submitting, invalid })}
			<div class="mb-4 flex flex-col gap-2 sm:flex-row">
				<input
					class="input bg-base-200 dark:bg-base-300 w-full dark:border-none"
					placeholder="Deskripsi tujuan pembelajaran PKL"
					name="deskripsi"
					required
					autocomplete="off"
					aria-invalid={invalid}
					disabled={!canManage}
				/>
				<button
					type="submit"
					class="btn btn-primary shadow-none"
					disabled={submitting || !canManage}
					title={!canManage ? 'Anda tidak memiliki izin untuk menambah' : ''}
				>
					{#if submitting}
						<span class="loading loading-spinner loading-xs" aria-hidden="true"></span>
					{/if}
					<Icon name="plus" />
					Tambah
				</button>
			</div>
		{/snippet}
	</FormEnhance>

	{#if data.tujuan.length === 0}
		<div class="alert alert-soft alert-info">
			<Icon name="info" />
			<span>Belum ada tujuan pembelajaran PKL.</span>
		</div>
	{:else}
		<div class="bg-base-100 dark:bg-base-200 overflow-x-auto rounded-md shadow-md dark:shadow-none">
			<table class="border-base-200 table min-w-[480px] border dark:border-none">
				<thead>
					<tr class="bg-base-200 dark:bg-base-300 text-left font-bold">
						<th style="width: 70px;">Urutan</th>
						<th class="w-full">Deskripsi</th>
						<th style="width: 80px;">Aksi</th>
					</tr>
				</thead>
				<tbody>
					{#each data.tujuan as item (item.id)}
						<tr>
							<td>
								<span class="badge badge-primary badge-soft badge-sm">
									{item.urutan ?? '-'}
								</span>
							</td>
							<td>{item.deskripsi}</td>
							<td class="text-right">
								<button
									type="button"
									class="btn btn-ghost btn-xs btn-error shadow-none"
									disabled={!canManage}
									aria-label="Hapus tujuan"
									title={!canManage ? 'Anda tidak memiliki izin untuk menghapus' : 'Hapus tujuan'}
									onclick={() =>
										bukaConfirm(
											'Hapus Tujuan',
											`Yakin ingin menghapus tujuan "${item.deskripsi}"?`,
											'?/hapusTujuan',
											item.id
										)}
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

<!-- ==================== Kelola Anggota Modal ==================== -->
{#if anggotaModalKelompok}
	<div
		class="modal modal-open"
		tabindex="-1"
		role="dialog"
		aria-modal="true"
		onkeydown={(event) => {
			if (event.key === 'Escape') tutupAnggotaModal();
		}}
	>
		<dialog class="modal-box relative z-10" open aria-modal="true">
			<h3 class="text-lg font-bold">Kelola Anggota</h3>
			<p class="text-base-content/70 text-sm">
				{anggotaModalKelompok.nama ?? `Kelompok ${anggotaModalKelompok.id}`} ·
				{anggotaModalKelompok.kelas?.nama ?? '-'}
			</p>

			<FormEnhance
				id="form-atur-anggota"
				action="?/aturAnggota"
				submitStateChange={(v) => (anggotaSubmitting = v)}
				onsuccess={() => {
					suksesTutupModal();
				}}
			>
				<input name="kelompokId" value={modalKelompokId} hidden />
				{#if anggotaCandidates.length === 0}
					<div class="alert alert-soft alert-warning mt-4">
						<Icon name="warning" />
						<span>Belum ada murid di kelas ini.</span>
					</div>
				{:else}
					<div class="mt-4 max-h-72 space-y-1 overflow-y-auto pr-1">
						{#each anggotaCandidates as murid (murid.id)}
							<label
								class="flex cursor-pointer items-center gap-3 rounded px-2 py-1 hover:bg-base-200/60"
							>
								<input
									type="checkbox"
									class="checkbox checkbox-sm"
									checked={isAnggotaChecked(murid.id)}
									onchange={() => toggleAnggota(murid.id)}
								/>
								<span class="text-sm">
									<span class="font-medium">{murid.nama}</span>
								</span>
								{#if anggotaInitial.has(murid.id)}
									<span class="badge badge-success badge-soft badge-sm">Anggota</span>
								{/if}
							</label>
						{/each}
					</div>

					{#each Object.entries(memberToggle) as [muridId, checked] (muridId)}
						{@const muridIdNum = Number(muridId)}
						{@const wasMember = anggotaInitial.has(muridIdNum)}
						{#if checked && !wasMember}
							<input name="add" value={muridIdNum} hidden />
						{:else if !checked && wasMember}
							<input name="remove" value={muridIdNum} hidden />
						{/if}
					{/each}
				{/if}
			</FormEnhance>

			<div class="modal-action mt-6">
				<button type="button" class="btn btn-soft shadow-none" onclick={tutupAnggotaModal}>
					<Icon name="close" />
					Batal
				</button>
				<button
					type="submit"
					form="form-atur-anggota"
					class="btn btn-primary shadow-none"
					disabled={anggotaSubmitting}
				>
					<Icon name="save" />
					Simpan Anggota
				</button>
			</div>
		</dialog>
		<form method="dialog" class="modal-backdrop">
			<button
				type="submit"
				onclick={(event) => {
					event.preventDefault();
					tutupAnggotaModal();
				}}
			>
				tutup
			</button>
		</form>
	</div>
{/if}

<!-- ==================== Tambah Kelompok Modal ==================== -->
{#if kelompokModalOpen}
	<div
		class="modal modal-open"
		tabindex="-1"
		role="dialog"
		aria-modal="true"
		onkeydown={(event) => {
			if (event.key === 'Escape') kelompokModalOpen = false;
		}}
	>
		<dialog class="modal-box relative z-10" open aria-modal="true">
			<h3 class="text-lg font-bold">Tambah Kelompok PKL</h3>

			<FormEnhance
				id="form-tambah-kelompok"
				action="?/tambahKelompok"
				submitStateChange={(v) => (kelompokSubmitting = v)}
				onsuccess={({ form }) => {
					form.reset();
					suksesTutupModal();
				}}
			>
				<div class="mt-4 space-y-3">
					<label class="form-control w-full">
						<span class="label-text mb-1 block text-sm font-medium">Kelas *</span>
						<select name="kelasId" class="select select-bordered w-full" required>
							{#each data.daftarKelas as kelas (kelas.id)}
								<option value={kelas.id} selected={kelas.id === data.kelasId}>
									{kelas.fase ? `${kelas.nama} - ${kelas.fase}` : kelas.nama}
								</option>
							{/each}
						</select>
					</label>

					<label class="form-control w-full">
						<span class="label-text mb-1 block text-sm font-medium">Nama Kelompok</span>
						<input type="text" name="nama" class="input input-bordered w-full" autocomplete="off" />
					</label>

					<label class="form-control w-full">
						<span class="label-text mb-1 block text-sm font-medium">Perusahaan</span>
						<select name="perusahaanId" class="select select-bordered w-full">
							<option value="">- Pilih perusahaan -</option>
							{#each data.perusahaan as item (item.id)}
								<option value={item.id}>{item.nama}</option>
							{/each}
						</select>
					</label>

					<label class="form-control w-full">
						<span class="label-text mb-1 block text-sm font-medium">Pembimbing (Guru)</span>
						<select name="pembimbingPegawaiId" class="select select-bordered w-full">
							<option value="">- Pilih pembimbing -</option>
							{#each data.pegawaiList as item (item.id)}
								<option value={item.id}>{item.nama}</option>
							{/each}
						</select>
					</label>

					<label class="form-control w-full">
						<span class="label-text mb-1 block text-sm font-medium">Nomor SK Penugasan</span>
						<input
							type="text"
							name="skPenugasan"
							class="input input-bordered w-full"
							autocomplete="off"
						/>
					</label>

					<div class="grid grid-cols-2 gap-3">
						<label class="form-control w-full">
							<span class="label-text mb-1 block text-sm font-medium">Tanggal Mulai</span>
							<input type="date" name="tanggalMulai" class="input input-bordered w-full" />
						</label>
						<label class="form-control w-full">
							<span class="label-text mb-1 block text-sm font-medium">Tanggal Selesai</span>
							<input type="date" name="tanggalSelesai" class="input input-bordered w-full" />
						</label>
					</div>

					<label class="form-control w-full">
						<span class="label-text mb-1 block text-sm font-medium">Lokasi</span>
						<input
							type="text"
							name="lokasi"
							class="input input-bordered w-full"
							autocomplete="off"
						/>
					</label>

					<label class="form-control w-full">
						<span class="label-text mb-1 block text-sm font-medium">Catatan</span>
						<textarea name="catatan" class="textarea textarea-bordered w-full" rows="2"></textarea>
					</label>
				</div>
			</FormEnhance>

			<div class="modal-action mt-6">
				<button
					type="button"
					class="btn btn-soft shadow-none"
					onclick={() => (kelompokModalOpen = false)}
				>
					<Icon name="close" />
					Batal
				</button>
				<button
					type="submit"
					form="form-tambah-kelompok"
					class="btn btn-primary shadow-none"
					disabled={kelompokSubmitting}
				>
					<Icon name="save" />
					Simpan
				</button>
			</div>
		</dialog>
		<form method="dialog" class="modal-backdrop">
			<button
				type="submit"
				onclick={(event) => {
					event.preventDefault();
					kelompokModalOpen = false;
				}}
			>
				tutup
			</button>
		</form>
	</div>
{/if}

<!-- ==================== Tambah Perusahaan Modal ==================== -->
{#if perusahaanModalOpen}
	<div
		class="modal modal-open"
		tabindex="-1"
		role="dialog"
		aria-modal="true"
		onkeydown={(event) => {
			if (event.key === 'Escape') perusahaanModalOpen = false;
		}}
	>
		<dialog class="modal-box relative z-10 max-w-lg" open aria-modal="true">
			<h3 class="text-lg font-bold">Tambah Perusahaan</h3>

			<FormEnhance
				id="form-tambah-perusahaan"
				action="?/tambahPerusahaan"
				submitStateChange={(v) => (perusahaanSubmitting = v)}
				onsuccess={({ form }) => {
					form.reset();
					suksesTutupModal();
				}}
			>
				{#snippet children({ invalid })}
					<div class="mt-4 space-y-3">
						<label class="form-control w-full">
							<span class="label-text mb-1 block text-sm font-medium">Nama Perusahaan *</span>
							<input
								type="text"
								name="nama"
								class="input input-bordered w-full"
								required
								autocomplete="off"
								aria-invalid={invalid}
							/>
						</label>
						<label class="form-control w-full">
							<span class="label-text mb-1 block text-sm font-medium">Alamat</span>
							<input
								type="text"
								name="alamat"
								class="input input-bordered w-full"
								autocomplete="off"
							/>
						</label>
						<label class="form-control w-full">
							<span class="label-text mb-1 block text-sm font-medium">Bidang Usaha</span>
							<input
								type="text"
								name="bidangUsaha"
								class="input input-bordered w-full"
								autocomplete="off"
							/>
						</label>
						<div class="grid grid-cols-2 gap-3">
							<label class="form-control w-full">
								<span class="label-text mb-1 block text-sm font-medium">Pembimbing</span>
								<input
									type="text"
									name="pembimbing"
									class="input input-bordered w-full"
									autocomplete="off"
								/>
							</label>
							<label class="form-control w-full">
								<span class="label-text mb-1 block text-sm font-medium">Telepon</span>
								<input type="tel" name="telepon" class="input input-bordered w-full" />
							</label>
						</div>
					</div>
				{/snippet}
			</FormEnhance>

			<div class="modal-action mt-6">
				<button
					type="button"
					class="btn btn-soft shadow-none"
					onclick={() => (perusahaanModalOpen = false)}
				>
					<Icon name="close" />
					Batal
				</button>
				<button
					type="submit"
					form="form-tambah-perusahaan"
					class="btn btn-primary shadow-none"
					disabled={perusahaanSubmitting}
				>
					<Icon name="save" />
					Simpan
				</button>
			</div>
		</dialog>
		<form method="dialog" class="modal-backdrop">
			<button
				type="submit"
				onclick={(event) => {
					event.preventDefault();
					perusahaanModalOpen = false;
				}}
			>
				tutup
			</button>
		</form>
	</div>
{/if}

<!-- ==================== Hapus Confirm Modal ==================== -->
{#if confirmDelete}
	<div
		class="modal modal-open"
		tabindex="-1"
		role="dialog"
		aria-modal="true"
		onkeydown={(event) => {
			if (event.key === 'Escape') tutupConfirm();
		}}
	>
		<dialog class="modal-box relative z-10 max-w-md" open aria-modal="true">
			<Icon name="warning" class="text-warning" />
			<h3 class="mt-2 text-lg font-bold">{confirmDelete.title}</h3>
			<p class="mt-2 text-sm">{confirmDelete.message}</p>

			<FormEnhance
				id="form-hapus-prakerin"
				action={confirmDeleteAction}
				submitStateChange={(v) => (hapusSubmitting = v)}
				onsuccess={() => {
					suksesTutupModal();
				}}
			>
				<input name="id" value={confirmDeleteId} hidden />
			</FormEnhance>

			<div class="modal-action mt-6 flex gap-2">
				<button type="button" class="btn btn-soft shadow-none" onclick={tutupConfirm}>
					<Icon name="close" />
					Batal
				</button>
				<button
					type="submit"
					form="form-hapus-prakerin"
					class="btn btn-error btn-soft shadow-none"
					disabled={hapusSubmitting}
				>
					<Icon name="del" />
					Hapus
				</button>
			</div>
		</dialog>
		<form method="dialog" class="modal-backdrop">
			<button
				type="submit"
				onclick={(event) => {
					event.preventDefault();
					tutupConfirm();
				}}
			>
				tutup
			</button>
		</form>
	</div>
{/if}
