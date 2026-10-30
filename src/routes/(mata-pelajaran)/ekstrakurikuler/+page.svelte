<script lang="ts">
	import { goto, invalidate } from '$app/navigation';
	import { page } from '$app/state';
	import { tick } from 'svelte';
	import FormEnhance from '$lib/components/form-enhance.svelte';
	import Icon from '$lib/components/icon.svelte';
	import EkstrakurikulerDeleteModal from '$lib/components/ekstrakurikuler/delete-modal.svelte';
	import ImportEkstraDialog from '$lib/components/ekstrakurikuler/import-ekstra-dialog.svelte';
	import FilterToolbar from '$lib/components/table/filter-toolbar.svelte';
	import { showModal } from '$lib/components/global-modal.svelte';
	import { toast } from '$lib/components/toast.svelte';
	import { setFilter, resetFilters, countActiveFilters } from '$lib/utils/url-filter';

	let {
		data
	}: {
		data: {
			kelasId: number | null;
			tableReady: boolean;
			lingkupUmum: boolean;
			ekstrakurikuler: Ekstrakurikuler[];
			q?: string;
			kosongKarenaFilter?: boolean;
		};
	} = $props();

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

	let selectedIds = $state<number[]>([]);
	let selectAllCheckbox: HTMLInputElement | null = null;
	let lastTableReady = $state<boolean | null>(null);
	let deleteDialogState = $state<
		| { source: 'bulk'; ids: number[] }
		| { source: 'single'; ids: number[]; item: Ekstrakurikuler }
		| null
	>(null);
	let addRowVisible = $state(false);
	let addNamaInput = $state('');
	let addInputRef = $state<HTMLInputElement | null>(null);
	let addSubmitting = $state(false);
	let editingRowId = $state<number | null>(null);
	let editingNamaInput = $state('');
	let editingInputRef = $state<HTMLInputElement | null>(null);
	let editingSubmitting = $state(false);
	let addLingkup = $state<'kelas' | 'umum'>('kelas');

	const totalData = $derived.by(() => data.ekstrakurikuler.length);

	const kelasAktifLabel = $derived.by(() => {
		const kelas = page.data.kelasAktif ?? null;
		if (!kelas) return null;
		return kelas.fase ? `${kelas.nama} - ${kelas.fase}` : kelas.nama;
	});
	const anySelected = $derived.by(() => selectedIds.length > 0);
	const allSelected = $derived.by(() => totalData > 0 && selectedIds.length === totalData);
	// Admin/kepala sekolah boleh mengelola ekstrakurikuler umum tanpa kelas aktif.
	const bolehUmum = $derived.by(() => {
		const t = (page.data.user as { type?: string } | null)?.type;
		return t === 'admin' || t === 'kepala_sekolah';
	});
	const canManage = $derived.by(
		() => data.tableReady && (!!data.kelasId || (data.lingkupUmum && bolehUmum))
	);
	// Restrict editing for wali_asuh dan guru mapel murni; guru merangkap wali
	// kelas boleh mengelola di kelas yang diwalikan.
	const canEdit = $derived.by(() => {
		const u = page.data.user as
			{ type?: string; kelasId?: number | null; ownKelasIds?: number[] | null } | null | undefined;
		// Mode Semua Kelas: hanya admin/kepala sekolah yang boleh mengubah data umum.
		if (data.lingkupUmum) return bolehUmum;
		if (u?.type === 'wali_asuh') return false;
		if (u?.type === 'user') {
			return data.kelasId != null && (u.ownKelasIds ?? []).includes(data.kelasId);
		}
		// Wali kelas di kelas bukan miliknya: turun ke level guru (tidak bisa menambah).
		if (u?.type === 'wali_kelas' && data.kelasId != null) {
			const ownIds = u.ownKelasIds?.length ? u.ownKelasIds : u.kelasId != null ? [u.kelasId] : [];
			if (ownIds.length > 0 && !ownIds.includes(data.kelasId)) return false;
		}
		return true;
	});
	const addSaveDisabled = $derived.by(
		() =>
			addSubmitting ||
			!addNamaInput.trim() ||
			!canManage ||
			!canEdit ||
			(addLingkup === 'kelas' && !data.kelasId)
	);
	const editingSaveDisabled = $derived.by(
		() =>
			editingRowId === null ||
			editingSubmitting ||
			!editingNamaInput.trim() ||
			!canManage ||
			!canEdit
	);
	const bulkDeleteDisabled = $derived.by(() => !anySelected || !canManage);
	const isDeleteModalOpen = $derived.by(() => deleteDialogState !== null);
	const deleteModalTitle = $derived.by(() => {
		if (!deleteDialogState) return 'Hapus Ekstrakurikuler';
		return deleteDialogState.source === 'bulk'
			? `Hapus ${deleteDialogState.ids.length} Ekstrakurikuler`
			: 'Hapus Ekstrakurikuler';
	});
	const deleteModalItem = $derived.by(() =>
		deleteDialogState?.source === 'single' ? deleteDialogState.item : null
	);
	const deleteModalIds = $derived.by(() => deleteDialogState?.ids ?? []);
	const deleteModalDisabled = $derived.by(() => deleteModalIds.length === 0 || !canManage);
	const deleteModalMode = $derived.by(() =>
		deleteDialogState?.source === 'single' ? 'single' : 'bulk'
	);

	$effect(() => {
		if (selectAllCheckbox) {
			selectAllCheckbox.indeterminate = selectedIds.length > 0 && selectedIds.length < totalData;
		}
	});

	$effect(() => {
		if (selectedIds.length === 0) return;
		const existingIds = new Set(data.ekstrakurikuler.map((item) => item.id));
		const filtered = selectedIds.filter((id) => existingIds.has(id));
		if (filtered.length !== selectedIds.length) {
			selectedIds = filtered;
		}
	});

	$effect(() => {
		const tableReady = data.tableReady ?? false;
		if (lastTableReady === tableReady) return;
		lastTableReady = tableReady;

		if (!tableReady) {
			if (selectedIds.length) selectedIds = [];
			if (deleteDialogState) deleteDialogState = null;
			if (addNamaInput) addNamaInput = '';
			if (addRowVisible) addRowVisible = false;
			addSubmitting = false;
			editingRowId = null;
			editingNamaInput = '';
			editingSubmitting = false;
		}
	});

	$effect(() => {
		if (!canManage && addRowVisible) {
			addRowVisible = false;
			addNamaInput = '';
			addSubmitting = false;
		}
	});

	$effect(() => {
		if (!canManage && editingRowId !== null) {
			editingRowId = null;
			editingNamaInput = '';
			editingSubmitting = false;
		}
	});

	$effect(() => {
		if (addRowVisible) {
			void tick().then(() => addInputRef?.focus());
		}
	});

	$effect(() => {
		if (editingRowId !== null) {
			void tick().then(() => editingInputRef?.focus());
		}
	});

	$effect(() => {
		if (editingRowId === null) return;
		const exists = data.ekstrakurikuler.some((item) => item.id === editingRowId);
		if (!exists) {
			editingRowId = null;
			editingNamaInput = '';
			editingSubmitting = false;
		}
	});

	function toggleRowSelection(id: number, checked: boolean) {
		selectedIds = checked
			? [...new Set([...selectedIds, id])]
			: selectedIds.filter((selectedId) => selectedId !== id);
	}

	function handleSelectAll(checked: boolean) {
		selectedIds = checked ? data.ekstrakurikuler.map((item) => item.id) : [];
	}

	function startEditRow(item: Ekstrakurikuler) {
		if (!canManage) return;
		addRowVisible = false;
		addNamaInput = '';
		addSubmitting = false;
		editingRowId = item.id;
		editingNamaInput = item.nama;
		editingSubmitting = false;
	}

	function openBulkDeleteModal() {
		if (!canManage) return;
		if (!selectedIds.length) return;
		deleteDialogState = { source: 'bulk', ids: [...selectedIds] };
	}

	function openSingleDeleteModal(item: Ekstrakurikuler) {
		if (!canManage) return;
		deleteDialogState = { source: 'single', ids: [item.id], item };
	}

	function closeDeleteModal() {
		if (!deleteDialogState) return;
		deleteDialogState = null;
	}

	function toggleAddRow() {
		if (!canManage) return;
		if (addRowVisible) {
			cancelAddRow();
			return;
		}
		cancelEditRow();
		addNamaInput = '';
		addLingkup = data.lingkupUmum ? 'umum' : 'kelas';
		addRowVisible = true;
	}

	function cancelAddRow() {
		addRowVisible = false;
		addNamaInput = '';
		addSubmitting = false;
		addLingkup = data.lingkupUmum ? 'umum' : 'kelas';
	}

	function cancelEditRow() {
		if (editingRowId === null && !editingNamaInput) return;
		editingRowId = null;
		editingNamaInput = '';
		editingSubmitting = false;
	}
</script>

<EkstrakurikulerDeleteModal
	open={isDeleteModalOpen}
	title={deleteModalTitle}
	action="?/delete"
	ids={deleteModalIds}
	mode={deleteModalMode}
	item={deleteModalItem}
	{canManage}
	disabled={deleteModalDisabled}
	onClose={closeDeleteModal}
	onSuccess={() => {
		const ids = deleteDialogState?.ids ?? [];
		if (ids.length) {
			selectedIds = selectedIds.filter((selectedId) => !ids.includes(selectedId));
		}
		closeDeleteModal();
		invalidate('app:ekstrakurikuler');
	}}
/>

<div class="card bg-base-100 rounded-lg border border-none p-4 shadow-md">
	<div class="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
		<div>
			<h2 class="text-xl font-bold">Daftar Ekstrakurikuler</h2>
			{#if data.lingkupUmum}
				<p class="text-base-content/70 text-sm">
					Mode Semua Kelas — kelola ekstrakurikuler umum yang berlaku untuk semua kelas.
				</p>
			{:else if kelasAktifLabel}
				<p class="text-base-content/70 text-sm">Kelas aktif: {kelasAktifLabel}</p>
			{:else}
				<p class="text-base-content/60 text-sm">
					Pilih kelas di navbar untuk melihat mata pelajaran intrakurikuler.
				</p>
			{/if}
		</div>
		<div class="flex flex-row max-sm:w-full">
			{#if anySelected}
				<button
					type="button"
					class={`btn w-full shadow-none sm:w-fit ${bulkDeleteDisabled || !canEdit ? '' : 'btn-soft btn-error'}`}
					disabled={bulkDeleteDisabled || !canEdit}
					onclick={openBulkDeleteModal}
					title={!canEdit ? 'Anda tidak memiliki izin untuk menghapus' : ''}
				>
					<Icon name="del" />
					Hapus
				</button>
			{:else}
				<button
					class="btn btn-soft rounded-r-none shadow-none max-sm:flex-1"
					disabled={!canManage || !canEdit}
					onclick={toggleAddRow}
					title={!canEdit ? 'Anda tidak memiliki izin untuk menambah' : ''}
				>
					<Icon name="plus" />
					Tambah
				</button>

				<!-- dropdown untuk import dan export -->
				<div class="dropdown dropdown-end">
					<button
						title={!canEdit ? 'Anda tidak memiliki izin' : 'Export dan Import ekstrakurikuler'}
						type="button"
						tabindex="0"
						class={`btn btn-soft rounded-l-none shadow-none ${!canManage || !canEdit ? 'opacity-50' : ''}`}
						disabled={!canManage || !canEdit}
						aria-disabled={!canManage || !canEdit}
					>
						<Icon name="down" />
					</button>

					<!-- menu dropdown -->
					<ul
						tabindex="-1"
						class="border-base-300 dropdown-content menu bg-base-100 z-50 mt-2 w-52 rounded-md border p-2 shadow-lg"
					>
						<li>
							<button
								type="button"
								class={`w-full text-left ${!canManage ? 'pointer-events-none opacity-50' : ''}`}
								disabled={!canManage}
								aria-disabled={!canManage}
								onclick={() =>
									showModal({
										title: 'Impor Ekstrakurikuler',
										body: ImportEkstraDialog,
										bodyProps: { lingkupUmum: data.lingkupUmum },
										dismissible: true
									})}
							>
								<Icon name="import" />
								Impor Ekstrakurikuler
							</button>
						</li>
						<li>
							<button
								type="button"
								class={`w-full text-left ${!canManage ? 'pointer-events-none opacity-50' : ''}`}
								disabled={!canManage}
								aria-disabled={!canManage}
								onclick={async () => {
									try {
										const resp = await fetch('/ekstrakurikuler/export_ekstra', { method: 'GET' });
										if (!resp.ok) {
											const body = await resp.json().catch(() => ({}));
											return toast({
												message: body?.fail || 'Gagal mengekspor data.',
												type: 'error'
											});
										}
										const blob = await resp.blob();
										const url = URL.createObjectURL(blob);
										// prefer filename from Content-Disposition header set by server
										let filename = `ekstrakurikuler-${new Date().toISOString().slice(0, 10)}.xlsx`;
										try {
											const cd =
												resp.headers.get('content-disposition') ||
												resp.headers.get('Content-Disposition');
											if (cd) {
												// match filename*=UTF-8''encoded or filename="name"
												const mStar = cd.match(/filename\*=UTF-8''([^;\n\r]+)/i);
												const mBasic = cd.match(/filename="?([^";]+)"?/i);
												if (mStar && mStar[1]) filename = decodeURIComponent(mStar[1]);
												else if (mBasic && mBasic[1]) filename = mBasic[1];
											}
										} catch {
											/* ignore and fallback */
										}
										const a = document.createElement('a');
										a.href = url;
										a.download = filename;
										document.body.appendChild(a);
										a.click();
										document.body.removeChild(a);
										URL.revokeObjectURL(url);
										toast({ message: 'Ekspor berhasil.', type: 'success' });
									} catch (err) {
										console.error(err);
										toast({ message: 'Terjadi kesalahan saat mengekspor.', type: 'error' });
									}
								}}
							>
								<Icon name="export" />
								Ekspor Ekstrakurikuler
							</button>
						</li>
					</ul>
				</div>
			{/if}
		</div>
	</div>

	{#if !data.kelasId && !data.lingkupUmum}
		<div
			class="alert border-warning/60 bg-warning/10 text-warning-content mt-6 border border-dashed"
		>
			<Icon name="info" />
			<span>Silakan pilih kelas di navbar sebelum menambah ekstrakurikuler.</span>
		</div>
	{/if}

	{#if !data.tableReady}
		<div class="alert border-error/60 bg-error/10 text-error-content mt-4 border border-dashed">
			<Icon name="warning" />
			<span>
				Database ekstrakurikuler belum siap. Jalankan <code>pnpm db:push</code> untuk menerapkan migrasi
				terbaru.
			</span>
		</div>
	{/if}

	<div class="mt-4">
		<FilterToolbar
			bind:q={searchTerm}
			qPlaceholder="Cari nama/pembina ekstrakurikuler..."
			onSearch={(value) => terapkanFilter('q', value)}
			aktif={countActiveFilters(page.url, KUNCI_FILTER)}
			onReset={() =>
				goto(resetFilters(page.url, KUNCI_FILTER), { replaceState: true, keepFocus: true })}
		/>
	</div>

	<div
		class="bg-base-100 dark:bg-base-200 mt-4 overflow-x-auto rounded-md shadow-md dark:shadow-none"
	>
		<table class="border-base-200 table min-w-[560px] border dark:border-none">
			<thead>
				<tr class="bg-base-200 dark:bg-base-300 text-left font-bold">
					<th style="width: 50px; min-width: 40px;">
						<input
							type="checkbox"
							class="checkbox"
							bind:this={selectAllCheckbox}
							disabled={!data.ekstrakurikuler.length || !data.tableReady}
							checked={allSelected}
							onchange={(event) => handleSelectAll(event.currentTarget.checked)}
						/>
					</th>
					<th style="width: 60px;">No</th>
					<th class="w-full" style="min-width: 260px;">Ekstrakurikuler</th>
					<th>Tujuan Pembelajaran</th>
					<th style="width: 140px; min-width: 120px;">Aksi</th>
				</tr>
			</thead>
			<tbody>
				{#if addRowVisible}
					<tr class="bg-base-200/40">
						<td></td>
						<td>
							<span>1</span>
						</td>
						<td class="p-3" colspan="2">
							<FormEnhance
								id="add-ekstrakurikuler-form"
								action="?/add"
								submitStateChange={(value) => (addSubmitting = value)}
								onsuccess={({ form }) => {
									form.reset();
									addNamaInput = '';
									addRowVisible = false;
									invalidate('app:ekstrakurikuler');
								}}
							>
								{#snippet children({ submitting, invalid })}
									{#if !data.lingkupUmum}
										<input name="kelasId" value={data.kelasId ?? ''} hidden />
									{/if}
									{#if bolehUmum}
										<label
											class="mb-2 flex w-fit items-center gap-2 text-sm"
											title="Ekstrakurikuler umum berlaku untuk semua kelas"
										>
											{#if data.lingkupUmum}
												<!-- Checkbox terkunci: kirim nilainya lewat hidden input
												karena input disabled tidak ikut terkirim. -->
												<input type="hidden" name="lingkup" value="umum" />
											{/if}
											<input
												type="checkbox"
												class="checkbox checkbox-sm"
												name={data.lingkupUmum ? undefined : 'lingkup'}
												value="umum"
												checked={data.lingkupUmum || addLingkup === 'umum'}
												onchange={(event) => {
													const el = event.currentTarget as HTMLInputElement;
													if (data.lingkupUmum) {
														el.checked = true;
														return;
													}
													addLingkup = el.checked ? 'umum' : 'kelas';
												}}
											/>
											<span>
												Berlaku untuk semua kelas
												{#if data.lingkupUmum}
													<span class="text-base-content/60">(mode Semua Kelas)</span>{/if}
											</span>
										</label>
									{/if}
									<label class="flex flex-col gap-2" aria-busy={submitting}>
										<input
											bind:this={addInputRef}
											class="input input-sm bg-base-200 dark:bg-base-300 w-full dark:border-none"
											placeholder="Masukkan nama ekstrakurikuler"
											name="nama"
											value={addNamaInput}
											oninput={(event) =>
												(addNamaInput = (event.currentTarget as HTMLInputElement).value)}
											autocomplete="off"
											required
											aria-invalid={invalid}
										/>
									</label>
								{/snippet}
							</FormEnhance>
						</td>
						<td class="flex items-center justify-end">
							<button
								type="button"
								class="btn btn-soft btn-sm rounded-r-none shadow-none"
								onclick={cancelAddRow}
								disabled={addSubmitting}
								title="Batal"
							>
								<Icon name="close" />
							</button>
							<button
								class="btn btn-sm btn-primary rounded-l-none shadow-none"
								form="add-ekstrakurikuler-form"
								type="submit"
								disabled={addSaveDisabled}
								title="Simpan"
							>
								{#if addSubmitting}
									<span class="loading loading-spinner loading-xs" aria-hidden="true"></span>
								{/if}
								<Icon name="save" />
							</button>
						</td>
					</tr>
				{/if}
				{#each data.ekstrakurikuler as item, index (item.id)}
					{@const baseNumber = addRowVisible ? index + 2 : index + 1}
					{@const formId = `edit-ekstrakurikuler-form-${item.id}`}
					<tr class={editingRowId === item.id ? 'bg-base-200/30' : undefined}>
						<td>
							<input
								type="checkbox"
								class="checkbox"
								checked={selectedIds.includes(item.id)}
								disabled={!data.tableReady || editingRowId === item.id || item.semuaKelas === 1}
								onchange={(event) => toggleRowSelection(item.id, event.currentTarget.checked)}
							/>
						</td>
						<td>
							{#if editingRowId === item.id}
								<span class="badge badge-primary badge-soft">1</span>
							{:else}
								{baseNumber}
							{/if}
						</td>
						<td>
							{#if editingRowId === item.id}
								<FormEnhance
									id={formId}
									action="?/update"
									submitStateChange={(value) => (editingSubmitting = value)}
									onsuccess={({ form }) => {
										form.reset();
										editingNamaInput = '';
										cancelEditRow();
										invalidate('app:ekstrakurikuler');
									}}
								>
									{#snippet children({ submitting, invalid })}
										{#if !item.semuaKelas && !data.lingkupUmum}
											<input name="kelasId" value={data.kelasId ?? ''} hidden />
										{/if}
										<input name="id" value={item.id} hidden />
										<label class="flex flex-col gap-2" aria-busy={submitting}>
											<input
												bind:this={editingInputRef}
												class="input input-sm bg-base-200 dark:bg-base-300 w-full dark:border-none"
												placeholder="Masukkan nama ekstrakurikuler"
												name="nama"
												value={editingNamaInput}
												oninput={(event) =>
													(editingNamaInput = (event.currentTarget as HTMLInputElement).value)}
												autocomplete="off"
												required
												aria-invalid={invalid}
											/>
										</label>
									{/snippet}
								</FormEnhance>
							{:else}
								{item.nama}
								{#if item.semuaKelas}
									<span class="badge badge-info badge-soft badge-sm ml-1">Umum</span>
								{/if}
							{/if}
						</td>
						<td>
							<a
								href={`ekstrakurikuler/tp-ekstra?ekstrakurikulerId=${item.id}`}
								class={`btn btn-sm btn-soft shadow-none ${!canManage || !canEdit ? 'btn-disabled pointer-events-none opacity-60' : ''}`}
								title={!canEdit
									? 'Anda tidak memiliki izin untuk mengedit'
									: 'Atur tujuan ekstrakurikuler'}
								aria-disabled={!canManage || !canEdit}
								tabindex={canManage && canEdit ? undefined : -1}
							>
								<Icon name="book" />
								Edit TP
							</a>
						</td>
						<td class="flex items-center justify-end">
							{#if editingRowId === item.id}
								<button
									class="btn btn-soft btn-sm rounded-r-none shadow-none"
									type="button"
									title="Batalkan edit"
									onclick={cancelEditRow}
									disabled={editingSubmitting}
								>
									<Icon name="close" />
								</button>
								<button
									class="btn btn-sm btn-primary rounded-l-none shadow-none"
									form={formId}
									type="submit"
									disabled={editingSaveDisabled}
									title="Simpan"
								>
									{#if editingSubmitting}
										<span class="loading loading-spinner loading-xs" aria-hidden="true"></span>
									{/if}
									<Icon name="save" />
								</button>
							{:else}
								<button
									class="btn btn-sm btn-soft rounded-r-none shadow-none"
									type="button"
									title={!canEdit
										? 'Anda tidak memiliki izin untuk mengedit'
										: 'Edit ekstrakurikuler'}
									aria-label="Edit ekstrakurikuler"
									disabled={!canManage || !canEdit}
									onclick={() => startEditRow(item)}
								>
									<Icon name="edit" />
								</button>
								<button
									class="btn btn-sm btn-soft btn-error rounded-l-none shadow-none"
									type="button"
									title={!canEdit
										? 'Anda tidak memiliki izin untuk menghapus'
										: item.semuaKelas
											? 'Ekstrakurikuler umum dihapus lewat Master Data'
											: 'Hapus ekstrakurikuler'}
									aria-label="Hapus ekstrakurikuler"
									disabled={!canManage || !canEdit || item.semuaKelas === 1}
									onclick={() => openSingleDeleteModal(item)}
								>
									<Icon name="del" />
								</button>
							{/if}
						</td>
					</tr>
				{:else}
					{#if !addRowVisible}
						<tr>
							<td class="py-6 text-center italic opacity-60" colspan="5">
								{data.kosongKarenaFilter
									? 'Tidak ada yang cocok dengan filter'
									: 'Belum ada data ekstrakurikuler'}
							</td>
						</tr>
					{/if}
				{/each}
			</tbody>
		</table>
	</div>
</div>
