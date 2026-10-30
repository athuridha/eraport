<script lang="ts">
	import { goto, invalidate, pushState } from '$app/navigation';
	import { page } from '$app/state';
	import FormEnhance from '$lib/components/form-enhance.svelte';
	import Icon from '$lib/components/icon.svelte';
	import { toast } from '$lib/components/toast.svelte';
	import { modalRoute, searchQueryMarker } from '$lib/utils';
	import MuridModals from '$lib/components/murid/modals.svelte';
	import PindahMuridModal from '$lib/components/murid/pindah-murid-modal.svelte';
	import { buildPageNumbers, OPSI_BARIS_PER_HALAMAN } from '$lib/utils/pagination';
	import FilterToolbar from '$lib/components/table/filter-toolbar.svelte';
	import { setFilter, resetFilters, countActiveFilters } from '$lib/utils/url-filter';

	type BulkModalData = {
		type: 'bulk';
		selectedMurids: {
			id: number;
			nama: string;
			nis: string;
			nisn: string;
		}[];
	};

	let { data } = $props();

	// Restrict editing for wali_asuh and user (guru mapel)
	const canEdit = $derived.by(() => {
		const u = page.data.user as { type?: string } | null | undefined;
		return u?.type !== 'wali_asuh' && u?.type !== 'user';
	});
	// svelte-ignore state_referenced_locally
	let searchTerm = $state(data.page.search ?? '');
	const currentPage = $derived.by(() => data.page.currentPage ?? 1);
	const totalPages = $derived.by(() => Math.max(1, data.page.totalPages ?? 1));
	const nomorHalaman = $derived(buildPageNumbers(currentPage, totalPages));

	let selectedIds = $state<Set<number>>(new Set());
	const hasSelection = $derived.by(() => selectedIds.size > 0);
	const semuaDipilih = $derived.by(
		() => data.daftarMurid.length > 0 && selectedIds.size === data.daftarMurid.length
	);
	const selectedMurids = $derived.by(() =>
		data.daftarMurid.filter((murid) => selectedIds.has(murid.id))
	);

	$effect(() => {
		const latestSearchTerm = data.page.search ?? '';
		if (searchTerm !== latestSearchTerm) {
			searchTerm = latestSearchTerm;
		}
	});

	let selectAllCheckbox: HTMLInputElement | null = null;
	let formSubmitting = $state(false);
	let isBulkPhotoUploadOpen = $state(false);
	let isMoveOpen = $state(false);
	let dropdownToggle: HTMLButtonElement | null = $state(null);

	type TargetMuridKeluarkan = {
		id: number;
		nama: string;
		nis?: string | null;
		nisn?: string | null;
	};

	let targetMuridKeluarkan = $state<TargetMuridKeluarkan | null>(null);
	let isKeluarkanBulkOpen = $state(false);
	let formTanggalKeluar = $state(new Date().toISOString().split('T')[0]);
	let formAlasanKeluar = $state('Dikeluarkan oleh pihak sekolah (Pelanggaran Tata Tertib)');
	let formAlasanKustom = $state('');

	function bukaKeluarkanModal(murid: {
		id: number;
		nama: string;
		nis?: string | null;
		nisn?: string | null;
	}) {
		targetMuridKeluarkan = murid;
		formTanggalKeluar = new Date().toISOString().split('T')[0];
		formAlasanKeluar = 'Dikeluarkan oleh pihak sekolah (Pelanggaran Tata Tertib)';
		formAlasanKustom = '';
	}

	async function terapkanFilter(key: string, value: string) {
		await goto(setFilter(page.url, key, value), { replaceState: true, keepFocus: true });
	}

	async function setStatusFilter(statusKey: string) {
		await terapkanFilter('status', statusKey === 'aktif' ? '' : statusKey);
	}

	function handleSubmittingChange(value: boolean) {
		formSubmitting = value;
	}

	function openBulkPhotoUploadModal() {
		// Close dropdown first with small delay
		if (dropdownToggle) {
			dropdownToggle.blur();
		}
		// Open modal after dropdown closes
		setTimeout(() => {
			isBulkPhotoUploadOpen = true;
		}, 100);
	}

	function toggleSelect(id: number, checked: boolean) {
		const next = new Set(selectedIds);
		if (checked) {
			next.add(id);
		} else {
			next.delete(id);
		}
		selectedIds = next;
	}

	function toggleSelectAll(checked: boolean) {
		if (!data.daftarMurid.length) {
			selectedIds = new Set();
			return;
		}
		selectedIds = checked ? new Set(data.daftarMurid.map((murid) => murid.id)) : new Set<number>();
	}

	function openBulkDeleteModal() {
		if (!hasSelection) return;
		const modalData: BulkModalData = {
			type: 'bulk',
			selectedMurids: selectedMurids.map((murid) => ({
				id: murid.id,
				nama: murid.nama,
				nis: murid.nis,
				nisn: murid.nisn
			}))
		};
		pushState(`${page.url.pathname}${page.url.search}`, {
			modal: {
				name: 'delete-murid',
				data: modalData
			}
		});
	}

	function openBulkMoveModal() {
		if (!hasSelection) return;
		isMoveOpen = true;
	}

	function handleBulkMoveSuccess() {
		selectedIds = new Set();
	}

	import SvelteURLSearchParams from '$lib/svelte-helpers/url-search-params';

	function buildPageUrl(pageNumber: number) {
		const params = new SvelteURLSearchParams(page.url.search);
		const sanitized = pageNumber < 1 ? 1 : pageNumber;
		if (sanitized <= 1) {
			params.delete('page');
		} else {
			params.set('page', String(sanitized));
		}
		const nextQuery = params.toString();
		const nextUrl = `${page.url.pathname}${nextQuery ? `?${nextQuery}` : ''}`;
		const currentUrl = `${page.url.pathname}${page.url.search}`;
		if (nextUrl === currentUrl) {
			return null;
		}
		return nextUrl;
	}

	async function gotoPage(pageNumber: number) {
		const target = buildPageUrl(pageNumber);
		if (!target) return;
		await goto(target, { replaceState: true, keepFocus: true });
	}

	async function gotoPerHalaman(jumlah: number) {
		const params = new SvelteURLSearchParams(page.url.search);
		params.set('per_page', String(jumlah));
		params.delete('page');
		const nextQuery = params.toString();
		await goto(`${page.url.pathname}${nextQuery ? `?${nextQuery}` : ''}`, {
			replaceState: true,
			keepFocus: true
		});
	}

	async function gotoKelasFilter(kId: string) {
		const params = new SvelteURLSearchParams(page.url.search);
		if (!kId) {
			params.delete('kelas_id');
		} else {
			params.set('kelas_id', kId);
		}
		params.delete('page');
		const nextQuery = params.toString();
		await goto(`${page.url.pathname}${nextQuery ? `?${nextQuery}` : ''}`, {
			replaceState: true,
			keepFocus: true
		});
	}

	function handlePageClick(pageNumber: number) {
		if (pageNumber === currentPage) return;
		void gotoPage(pageNumber);
	}

	function submitBulkDelete(event: Event) {
		event.preventDefault();
		const form = document.getElementById('form-bulk-delete') as HTMLFormElement | null;
		if (!form || formSubmitting) return;
		form.requestSubmit();
	}

	async function handleBulkDeleteSuccess({ data }: { data?: Record<string, unknown> }) {
		const countBefore = selectedIds.size;
		await invalidate('app:murid');
		selectedIds = new Set();
		const message =
			typeof data?.message === 'string'
				? data.message
				: `${countBefore || 1} murid berhasil dihapus`;
		toast({ message, type: 'success', persist: true });
		if (page.state.modal?.name === 'delete-murid') {
			history.back();
		}
	}

	$effect(() => {
		const validIds = new Set(data.daftarMurid.map((murid) => murid.id));
		if (!validIds.size && selectedIds.size) {
			selectedIds = new Set();
			return;
		}
		let changed = false;
		for (const id of selectedIds) {
			if (!validIds.has(id)) {
				changed = true;
				break;
			}
		}
		if (changed) {
			selectedIds = new Set([...selectedIds].filter((id) => validIds.has(id)));
		}
	});

	$effect(() => {
		if (selectAllCheckbox) {
			selectAllCheckbox.indeterminate =
				selectedIds.size > 0 && selectedIds.size < data.daftarMurid.length;
		}
	});

	const academicContext = $derived(data.academicContext ?? null);
	const activeSemester = $derived.by(() => {
		const context = academicContext;
		if (!context?.activeSemesterId) return null;
		for (const tahun of context.tahunAjaranList ?? []) {
			const match = tahun.semester.find((item) => item.id === context.activeSemesterId);
			if (match) {
				return {
					...match,
					tahunAjaranNama: tahun.nama
				};
			}
		}
		return null;
	});

	const kelasAktif = $derived(page.data.kelasAktif ?? null);
	const kelasAktifLabel = $derived.by(() => {
		if (!kelasAktif) return null;
		return kelasAktif.fase ? `${kelasAktif.nama} - ${kelasAktif.fase}` : kelasAktif.nama;
	});

	// Calculate offset for pagination numbering
	const offset = $derived((currentPage - 1) * data.page.perPage);
</script>

{#if academicContext}
	{#if academicContext.activeSemesterId}
		<div class="alert alert-info alert-soft mb-4 flex items-center gap-3">
			<Icon name="info" />
			<span>
				Menampilkan data murid untuk
				{#if activeSemester}
					<strong>{activeSemester.nama}</strong>
					({activeSemester.tahunAjaranNama})
				{:else}
					semester aktif
				{/if}.
			</span>
		</div>
	{:else}
		<div class="alert alert-warning mb-6 flex items-center gap-3">
			<Icon name="warning" />
			<span>Setel semester aktif di menu Rapor untuk mulai mengelola data kelas per periode.</span>
		</div>
	{/if}
{/if}

<div class="card bg-base-100 rounded-lg border border-none p-4 shadow-md">
	<div class="mb-6">
		<div class="flex flex-col sm:flex-row sm:justify-between">
			<div>
				<h2 class="text-xl font-bold">Formulir Dan Tabel Isian Data Murid</h2>
				{#if kelasAktifLabel}
					<p class="text-base-content/80 block text-sm">{kelasAktifLabel}</p>
				{/if}
			</div>
			<!-- Tombol Tambah Manual (dipindahkan ke kanan judul) -->
			{#if hasSelection}
				<div class="mt-4 flex gap-2 sm:mt-0">
					<button
						class="btn btn-soft btn-primary shadow-none"
						type="button"
						disabled={formSubmitting || !canEdit}
						onclick={openBulkMoveModal}
						title={!canEdit
							? 'Anda tidak memiliki izin untuk memindahkan murid'
							: 'Pindahkan murid terpilih ke kelas lain'}
					>
						<Icon name="move" />
						Pindahkan
					</button>
					<button
						class="btn btn-soft btn-warning shadow-none"
						type="button"
						disabled={formSubmitting || !canEdit}
						onclick={() => {
							formTanggalKeluar = new Date().toISOString().split('T')[0];
							formAlasanKeluar = 'Dikeluarkan oleh pihak sekolah (Pelanggaran Tata Tertib)';
							formAlasanKustom = '';
							isKeluarkanBulkOpen = true;
						}}
						title={!canEdit ? 'Anda tidak memiliki izin' : 'Keluarkan murid terpilih dari sekolah'}
					>
						<Icon name="close" />
						Keluarkan
					</button>
					<button
						class="btn btn-soft btn-error shadow-none"
						type="button"
						disabled={formSubmitting || !canEdit}
						onclick={openBulkDeleteModal}
						title={!canEdit ? 'Anda tidak memiliki izin untuk menghapus' : 'Hapus murid terpilih'}
					>
						<Icon name="del" />
						Hapus
					</button>
				</div>
			{:else}
				<div class="mt-2 flex max-sm:w-full sm:mt-0">
					{#if canEdit}
						<a
							class="btn btn-soft rounded-r-none shadow-none max-sm:flex-1"
							href="/murid/form"
							use:modalRoute={'add-murid'}
						>
							<Icon name="plus" />
							Tambah Murid
						</a>
					{:else}
						<button
							type="button"
							class="btn btn-disabled rounded-r-none shadow-none max-sm:flex-1"
							disabled
							title="Anda tidak memiliki izin untuk menambah murid"
						>
							<Icon name="plus" />
							Tambah Murid
						</button>
					{/if}
					<div class="dropdown dropdown-end">
						<button
							bind:this={dropdownToggle}
							type="button"
							tabindex="0"
							class="btn btn-soft rounded-l-none shadow-none"
						>
							<Icon name="down" />
						</button>
						<ul
							tabindex="-1"
							class="dropdown-content menu bg-base-100 rounded-box border-base-300 z-1 mt-2 w-50 border p-2 shadow-lg"
						>
							<li><a href="/murid/photos">Lihat Semua Foto</a></li>
							{#if canEdit}
								<li>
									<button type="button" onclick={openBulkPhotoUploadModal} class="text-left">
										Unggah Semua Foto
									</button>
								</li>
							{/if}
							<li>
								<a href="/api/murid/download-excel" class="text-left"> Unduh Murid </a>
							</li>
						</ul>
					</div>
				</div>
			{/if}
		</div>
	</div>

	<!-- Filter Status Murid -->
	<div class="tabs tabs-box bg-base-200/50 mb-4 flex flex-wrap gap-1 p-1">
		{#each [{ key: 'aktif', label: 'Aktif', count: data.statusCounts?.aktif ?? 0, badge: 'badge-success' }, { key: 'keluar', label: 'Dikeluarkan / Keluar', count: data.statusCounts?.keluar ?? 0, badge: 'badge-error' }, { key: 'pindah', label: 'Pindah', count: data.statusCounts?.pindah ?? 0, badge: 'badge-warning' }, { key: 'lulus', label: 'Lulus', count: data.statusCounts?.lulus ?? 0, badge: 'badge-info' }, { key: 'semua', label: 'Semua Status', count: data.statusCounts?.semua ?? 0, badge: 'badge-ghost' }] as tab (tab.key)}
			<button
				type="button"
				class="tab text-xs font-medium"
				class:tab-active={(data.page.status ?? 'aktif') === tab.key}
				onclick={() => setStatusFilter(tab.key)}
			>
				{tab.label}
				<span class="badge {tab.badge} badge-sm ml-1.5">{tab.count}</span>
			</button>
		{/each}
	</div>

	<div class="mb-4 flex flex-col gap-2 sm:flex-row">
		<FilterToolbar
			bind:q={searchTerm}
			qPlaceholder="Cari nama murid..."
			onSearch={(value) => terapkanFilter('q', value)}
			pilih={[
				{
					name: 'status',
					label: 'Status',
					value: data.page.status === 'aktif' ? '' : (data.page.status ?? ''),
					opsis: [
						{ value: '', label: 'Semua Status' },
						{ value: 'aktif', label: 'Aktif' },
						{ value: 'lulus', label: 'Lulus' },
						{ value: 'pindah', label: 'Pindah' },
						{ value: 'keluar', label: 'Keluar' }
					],
					onChange: (v) => terapkanFilter('status', v)
				}
			]}
			aktif={countActiveFilters(page.url, ['q', 'status'])}
			onReset={() =>
				goto(resetFilters(page.url, ['q', 'status']), { replaceState: true, keepFocus: true })}
		>
			{#if data.kelasTujuan && data.kelasTujuan.length > 0}
				<select
					class="select bg-base-200 dark:bg-base-300 w-auto shrink font-medium dark:border-none"
					value={data.page.kelasId ?? ''}
					title="Filter Kelas"
					onchange={(event) => gotoKelasFilter((event.currentTarget as HTMLSelectElement).value)}
				>
					<option value="">Semua Kelas</option>
					{#each data.kelasTujuan as k (k.id)}
						<option value={String(k.id)}>{k.nama}</option>
					{/each}
				</select>
			{/if}
			<select
				class="select bg-base-200 dark:bg-base-300 w-auto shrink dark:border-none"
				value={data.page.perPage}
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

	<FormEnhance
		id="form-bulk-delete"
		action="?/deleteSelected"
		submitStateChange={handleSubmittingChange}
		onsuccess={handleBulkDeleteSuccess}
		showToast={false}
	>
		{#snippet children({ submitting })}
			<div
				class="bg-base-100 dark:bg-base-200 mt-4 overflow-x-auto rounded-md shadow-md dark:shadow-none"
			>
				<table class="border-base-200 table border dark:border-none">
					<!-- head -->
					<thead>
						<tr class="bg-base-200 dark:bg-base-300 text-base-content text-left font-bold">
							<th>
								<input
									type="checkbox"
									class="checkbox"
									bind:this={selectAllCheckbox}
									checked={semuaDipilih}
									onchange={(event) => toggleSelectAll(event.currentTarget.checked)}
									aria-label="Pilih semua murid"
									disabled={submitting}
								/>
							</th>
							<th style="width: 50px; min-width: 40px;">No</th>
							<th style="width: 45%;">Nama</th>
							<th>Agama</th>
							<th>Tempat Lahir</th>
							<th>Tanggal Lahir</th>
							<th>Aksi</th>
						</tr>
					</thead>
					<tbody>
						{#each data.daftarMurid as murid, index (murid)}
							<tr>
								<td>
									<input
										type="checkbox"
										class="checkbox"
										name="muridIds"
										value={murid.id}
										checked={selectedIds.has(murid.id)}
										onchange={(event) => toggleSelect(murid.id, event.currentTarget.checked)}
										aria-label={`Pilih ${murid.nama}`}
										disabled={submitting}
									/>
								</td>
								<td>{offset + index + 1}</td>
								<td>
									<div class="flex flex-wrap items-center gap-1.5">
										<span class="font-medium"
											>{@html searchQueryMarker(data.page.search, murid.nama)}</span
										>
										{#if murid.status === 'keluar'}
											<span
												class="badge badge-error badge-xs font-semibold"
												title={`Dikeluarkan: ${murid.alasanKeluar ?? '-'} (${murid.tanggalKeluar ?? '-'})`}
											>
												Keluar
											</span>
										{:else if murid.status === 'pindah'}
											<span class="badge badge-warning badge-xs font-semibold">Pindah</span>
										{:else if murid.status === 'lulus'}
											<span class="badge badge-info badge-xs font-semibold">Lulus</span>
										{/if}
									</div>
									{#if murid.status === 'keluar' && murid.alasanKeluar}
										<p class="text-error mt-0.5 text-xs opacity-80">
											Alasan: {murid.alasanKeluar}
											{murid.tanggalKeluar ? `(${murid.tanggalKeluar})` : ''}
										</p>
									{/if}
								</td>
								<td>{murid.agama}</td>
								<td>{murid.tempatLahir}</td>
								<td>{murid.tanggalLahir}</td>
								<td>
									<div class="flex flex-row">
										<a
											class="btn btn-sm btn-soft pointer-events-auto rounded-r-none shadow-none"
											href="/murid/{murid.id}"
											use:modalRoute={'detail-murid'}
											title="Lihat detail murid"
										>
											<Icon name="eye" />
										</a>

										{#if canEdit}
											{#if murid.status === 'keluar'}
												<!-- Tombol Aktifkan Kembali -->
												<FormEnhance
													action="?/aktifkanMurid"
													onsuccess={() => {
														toast('Status murid berhasil diaktifkan kembali.', 'success');
													}}
												>
													{#snippet children({ submitting: subAktif })}
														<input type="hidden" name="muridId" value={murid.id} />
														<button
															type="submit"
															class="btn btn-sm btn-success btn-soft rounded-none shadow-none"
															disabled={subAktif}
															title="Aktifkan kembali murid ini"
														>
															<Icon name="check" />
														</button>
													{/snippet}
												</FormEnhance>
											{:else}
												<!-- Tombol Keluarkan Murid -->
												<button
													type="button"
													class="btn btn-sm btn-warning btn-soft rounded-none shadow-none"
													onclick={() => bukaKeluarkanModal(murid)}
													title="Keluarkan murid dari sekolah"
												>
													<Icon name="close" />
												</button>
											{/if}

											<a
												class="btn btn-sm btn-error btn-soft rounded-l-none shadow-none"
												href="/murid/{murid.id}/delete"
												use:modalRoute={'delete-murid'}
												title="Hapus data murid permanen"
											>
												<Icon name="del" />
											</a>
										{:else}
											<button
												type="button"
												class="btn btn-sm btn-disabled rounded-l-none shadow-none"
												disabled
												title="Anda tidak memiliki izin mengelola murid"
											>
												<Icon name="del" />
											</button>
										{/if}
									</div>
								</td>
							</tr>
						{:else}
							<tr>
								<td class="text-center p-7" colspan="7">
									<em class="opacity-50">Belum ada data murid</em>
								</td>
							</tr>
						{/each}
					</tbody>
				</table>
			</div>
		{/snippet}
	</FormEnhance>
	<!-- pagination -->
	{#if totalPages > 1}
		<div class="mt-4 flex justify-center">
			<div class="join">
				<button
					type="button"
					class="join-item btn"
					disabled={currentPage <= 1}
					onclick={() => handlePageClick(currentPage - 1)}
				>
					«
				</button>
				{#each nomorHalaman as nomor, index (index)}
					{#if nomor === '…'}
						<button type="button" class="join-item btn" disabled>…</button>
					{:else}
						<button
							type="button"
							class="join-item btn pointer-events-auto"
							class:btn-active={nomor === currentPage}
							onclick={() => handlePageClick(nomor)}
							aria-current={nomor === currentPage ? 'page' : undefined}
						>
							{nomor}
						</button>
					{/if}
				{/each}
				<button
					type="button"
					class="join-item btn"
					disabled={currentPage >= totalPages}
					onclick={() => handlePageClick(currentPage + 1)}
				>
					»
				</button>
			</div>
		</div>
	{/if}

	<p class="mt-3 text-center text-sm opacity-70">
		Menampilkan {data.daftarMurid.length} dari {data.page.totalItems ?? 0} data
	</p>
</div>

<MuridModals {formSubmitting} {submitBulkDelete} bind:isBulkPhotoUploadOpen />

<PindahMuridModal
	bind:isOpen={isMoveOpen}
	muridTerpilih={selectedMurids.map((murid) => ({
		id: murid.id,
		nama: murid.nama,
		nis: murid.nis
	}))}
	kelasTujuan={data.kelasTujuan ?? []}
	action="?/pindahMurid"
	onSuccess={handleBulkMoveSuccess}
/>

<!-- Modal Keluarkan Satuan -->
{#if targetMuridKeluarkan}
	<dialog class="modal modal-open">
		<div class="modal-box max-w-md">
			<h3 class="text-error flex items-center gap-2 text-lg font-bold">
				<Icon name="warning" />
				Keluarkan Murid
			</h3>
			<p class="py-2 text-sm">
				Anda akan mengeluarkan murid <strong>{targetMuridKeluarkan.nama}</strong>
				{targetMuridKeluarkan.nis ? `(NIS: ${targetMuridKeluarkan.nis})` : ''}. Status murid akan
				diubah menjadi <em>Keluar</em> dan tidak tampil di daftar murid aktif.
			</p>

			<FormEnhance
				action="?/keluarkanMurid"
				onsuccess={() => {
					targetMuridKeluarkan = null;
					toast('Murid berhasil dikeluarkan.', 'success');
				}}
			>
				{#snippet children({ submitting })}
					<input type="hidden" name="muridId" value={targetMuridKeluarkan?.id} />

					<fieldset class="fieldset mt-3">
						<legend class="fieldset-legend font-medium">Tanggal Keluar</legend>
						<input
							type="date"
							name="tanggalKeluar"
							class="input bg-base-200 dark:bg-base-300 w-full"
							bind:value={formTanggalKeluar}
							required
						/>
					</fieldset>

					<fieldset class="fieldset mt-3">
						<legend class="fieldset-legend font-medium">Alasan Keluar</legend>
						<select
							class="select bg-base-200 dark:bg-base-300 w-full"
							bind:value={formAlasanKeluar}
							onchange={(e) => {
								const val = (e.currentTarget as HTMLSelectElement).value;
								if (val !== 'Lainnya') formAlasanKustom = '';
							}}
						>
							<option value="Dikeluarkan oleh pihak sekolah (Pelanggaran Tata Tertib)">
								Dikeluarkan oleh pihak sekolah (Pelanggaran Tata Tertib)
							</option>
							<option value="Drop Out (DO) / Putus Sekolah">Drop Out (DO) / Putus Sekolah</option>
							<option value="Mengundurkan Diri">Mengundurkan Diri</option>
							<option value="Pindah Sekolah">Pindah Sekolah</option>
							<option value="Bekerja">Bekerja</option>
							<option value="Lainnya">Lainnya...</option>
						</select>
						{#if formAlasanKeluar === 'Lainnya'}
							<input
								type="text"
								class="input bg-base-200 dark:bg-base-300 mt-2 w-full"
								placeholder="Tuliskan alasan keluar..."
								bind:value={formAlasanKustom}
								required
							/>
						{/if}
						<input
							type="hidden"
							name="alasanKeluar"
							value={formAlasanKeluar === 'Lainnya' ? formAlasanKustom : formAlasanKeluar}
						/>
					</fieldset>

					<div class="modal-action mt-6">
						<button
							type="button"
							class="btn btn-ghost shadow-none"
							onclick={() => (targetMuridKeluarkan = null)}
							disabled={submitting}
						>
							Batal
						</button>
						<button
							type="submit"
							class="btn btn-error shadow-none"
							disabled={submitting || (formAlasanKeluar === 'Lainnya' && !formAlasanKustom.trim())}
						>
							{#if submitting}
								<span class="loading loading-spinner loading-sm"></span>
							{/if}
							Keluarkan Murid
						</button>
					</div>
				{/snippet}
			</FormEnhance>
		</div>
		<button
			type="button"
			class="modal-backdrop"
			onclick={() => (targetMuridKeluarkan = null)}
			aria-label="Tutup"
		></button>
	</dialog>
{/if}

<!-- Modal Keluarkan Massal -->
{#if isKeluarkanBulkOpen}
	<dialog class="modal modal-open">
		<div class="modal-box max-w-md">
			<h3 class="text-error flex items-center gap-2 text-lg font-bold">
				<Icon name="warning" />
				Keluarkan {selectedIds.size} Murid Terpilih
			</h3>
			<p class="py-2 text-sm">
				Semua murid yang dipilih akan diubah statusnya menjadi <em>Keluar</em> dan dipindahkan ke arsip
				murid non-aktif.
			</p>

			<FormEnhance
				action="?/keluarkanBulk"
				onsuccess={() => {
					isKeluarkanBulkOpen = false;
					selectedIds = new Set();
					toast('Murid terpilih berhasil dikeluarkan.', 'success');
				}}
			>
				{#snippet children({ submitting })}
					{#each Array.from(selectedIds) as id (id)}
						<input type="hidden" name="muridIds" value={id} />
					{/each}

					<fieldset class="fieldset mt-3">
						<legend class="fieldset-legend font-medium">Tanggal Keluar</legend>
						<input
							type="date"
							name="tanggalKeluar"
							class="input bg-base-200 dark:bg-base-300 w-full"
							bind:value={formTanggalKeluar}
							required
						/>
					</fieldset>

					<fieldset class="fieldset mt-3">
						<legend class="fieldset-legend font-medium">Alasan Keluar</legend>
						<select
							class="select bg-base-200 dark:bg-base-300 w-full"
							bind:value={formAlasanKeluar}
							onchange={(e) => {
								const val = (e.currentTarget as HTMLSelectElement).value;
								if (val !== 'Lainnya') formAlasanKustom = '';
							}}
						>
							<option value="Dikeluarkan oleh pihak sekolah (Pelanggaran Tata Tertib)">
								Dikeluarkan oleh pihak sekolah (Pelanggaran Tata Tertib)
							</option>
							<option value="Drop Out (DO) / Putus Sekolah">Drop Out (DO) / Putus Sekolah</option>
							<option value="Mengundurkan Diri">Mengundurkan Diri</option>
							<option value="Pindah Sekolah">Pindah Sekolah</option>
							<option value="Bekerja">Bekerja</option>
							<option value="Lainnya">Lainnya...</option>
						</select>
						{#if formAlasanKeluar === 'Lainnya'}
							<input
								type="text"
								class="input bg-base-200 dark:bg-base-300 mt-2 w-full"
								placeholder="Tuliskan alasan keluar..."
								bind:value={formAlasanKustom}
								required
							/>
						{/if}
						<input
							type="hidden"
							name="alasanKeluar"
							value={formAlasanKeluar === 'Lainnya' ? formAlasanKustom : formAlasanKeluar}
						/>
					</fieldset>

					<div class="modal-action mt-6">
						<button
							type="button"
							class="btn btn-ghost shadow-none"
							onclick={() => (isKeluarkanBulkOpen = false)}
							disabled={submitting}
						>
							Batal
						</button>
						<button
							type="submit"
							class="btn btn-error shadow-none"
							disabled={submitting || (formAlasanKeluar === 'Lainnya' && !formAlasanKustom.trim())}
						>
							{#if submitting}
								<span class="loading loading-spinner loading-sm"></span>
							{/if}
							Keluarkan {selectedIds.size} Murid
						</button>
					</div>
				{/snippet}
			</FormEnhance>
		</div>
		<button
			type="button"
			class="modal-backdrop"
			onclick={() => (isKeluarkanBulkOpen = false)}
			aria-label="Tutup"
		></button>
	</dialog>
{/if}
