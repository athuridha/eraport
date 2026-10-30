<script lang="ts">
	import { goto, invalidate } from '$app/navigation';
	import { page } from '$app/state';
	import BulkFillModal from '$lib/components/catatan-wali/bulk-fill-modal.svelte';
	import FormEnhance from '$lib/components/form-enhance.svelte';
	import Icon from '$lib/components/icon.svelte';
	import { hideModal, showModal } from '$lib/components/global-modal.svelte';
	import { toast } from '$lib/components/toast.svelte';
	import { searchQueryMarker } from '$lib/utils';
	import { buildPageNumbers, OPSI_BARIS_PER_HALAMAN } from '$lib/utils/pagination';
	import { tick } from 'svelte';
	import FilterToolbar from '$lib/components/table/filter-toolbar.svelte';
	import { setFilter, resetFilters, countActiveFilters } from '$lib/utils/url-filter';

	let { data } = $props();
	const KUNCI_FILTER = ['q'];
	// svelte-ignore state_referenced_locally
	let searchTerm = $state(data.page.search ?? '');
	let editingRowId = $state<number | null>(null);
	let editingTextarea = $state<HTMLTextAreaElement | null>(null);
	let editingCatatan = $state('');
	let editingOriginal = $state('');
	let editingSubmitting = $state(false);
	let bulkCatatan = $state('');
	const bulkFormId = 'bulk-catatan-form';

	const currentPage = $derived.by(() => data.page.currentPage ?? 1);
	const totalPages = $derived.by(() => Math.max(1, data.page.totalPages ?? 1));
	const nomorHalaman = $derived(buildPageNumbers(currentPage, totalPages));

	const kelasAktif = $derived(page.data.kelasAktif ?? null);
	const kelasAktifLabel = $derived.by(() => {
		if (!kelasAktif) return null;
		return kelasAktif.fase ? `${kelasAktif.nama} - ${kelasAktif.fase}` : kelasAktif.nama;
	});

	// Restrict editing for wali_asuh
	const canEdit = $derived.by(() => {
		const u = page.data.user as { type?: string } | null | undefined;
		return u?.type !== 'wali_asuh';
	});

	const editingSaveDisabled = $derived.by(
		() =>
			editingRowId === null || editingSubmitting || editingCatatan.trim() === editingOriginal.trim()
	);
	const muridIds = $derived.by(() => data.daftarCatatan.map((item) => item.id));
	const bulkTargetCount = $derived.by(() => muridIds.length);
	const muridIdsPayload = $derived.by(() => JSON.stringify(muridIds));

	$effect(() => {
		const latestSearchTerm = data.page.search ?? '';
		if (searchTerm !== latestSearchTerm) {
			searchTerm = latestSearchTerm;
		}
	});

	$effect(() => {
		if (editingRowId === null) return;
		const row = data.daftarCatatan.find((item) => item.id === editingRowId);
		if (!row) {
			cancelEdit();
		}
	});

	$effect(() => {
		if (editingRowId !== null) {
			void tick().then(() => editingTextarea?.focus());
		}
	});

	import SvelteURLSearchParams from '$lib/svelte-helpers/url-search-params';

	async function terapkanFilter(key: string, value: string) {
		await goto(setFilter(page.url, key, value), { replaceState: true, keepFocus: true });
	}

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

	async function setStatusFilter(statusKey: string) {
		const params = new SvelteURLSearchParams(page.url.search);
		if (statusKey === 'all') {
			params.delete('status');
		} else {
			params.set('status', statusKey);
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

	function startEdit(row: { id: number; catatan: string | null }) {
		if (editingRowId === row.id) return;
		editingRowId = row.id;
		editingOriginal = row.catatan ?? '';
		editingCatatan = editingOriginal;
		editingSubmitting = false;
	}

	function cancelEdit() {
		editingRowId = null;
		editingOriginal = '';
		editingCatatan = '';
		editingSubmitting = false;
	}

	async function handleSaveSuccess() {
		cancelEdit();
		await invalidate('app:catatan-wali-kelas');
	}

	function openBulkDialog() {
		if (!bulkTargetCount) {
			toast('Tidak ada murid pada daftar ini.', 'warning');
			return;
		}
		bulkCatatan = '';
		let actions: { submit: () => void };
		showModal({
			title: 'Isi Catatan Sekaligus',
			body: BulkFillModal,
			bodyProps: {
				formId: bulkFormId,
				muridIdsPayload,
				targetCount: bulkTargetCount,
				catatan: bulkCatatan,
				onCatatanChange: (value: string) => {
					bulkCatatan = value;
				},
				onSuccess: async () => {
					await handleBulkSuccess();
				},
				onAction: (a: { submit: () => void }) => {
					actions = a;
				}
			},
			onPositive: {
				label: 'Terapkan',
				action: () => actions.submit()
			},
			onNeutral: {
				label: 'Batal'
			},
			spreadActions: true,
			dismissible: true,
			onClose: handleBulkDialogClose
		});
	}

	function handleBulkDialogClose() {
		bulkCatatan = '';
	}

	async function handleBulkSuccess() {
		hideModal();
		await invalidate('app:catatan-wali-kelas');
	}
</script>

<div class="card bg-base-100 rounded-lg border border-none p-4 shadow-md">
	<div class="mb-6 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
		<div>
			<h2 class="text-xl font-bold">Rekapitulasi Catatan Wali Kelas</h2>
			{#if kelasAktifLabel}
				<p class="text-base-content/80 block text-sm">{kelasAktifLabel}</p>
			{/if}
		</div>
		<button
			type="button"
			class="btn btn-primary btn-soft gap-2 self-start shadow-none max-sm:w-full sm:self-center"
			onclick={openBulkDialog}
			disabled={!bulkTargetCount || editingRowId !== null || !canEdit}
			title={!canEdit
				? 'Anda tidak memiliki izin untuk mengedit'
				: 'Isi catatan yang sama untuk seluruh murid pada halaman ini'}
		>
			<Icon name="copy" />
			<span>Isi Sekaligus</span>
		</button>
	</div>

	<!-- Filter Status Catatan -->
	<div class="tabs tabs-box bg-base-200/50 mb-4 flex flex-wrap gap-1 p-1">
		{#each [{ key: 'all', label: 'Semua Murid', count: data.statusCounts?.all ?? 0, badge: 'badge-ghost' }, { key: 'filled', label: 'Sudah Diisi', count: data.statusCounts?.filled ?? 0, badge: 'badge-success' }, { key: 'empty', label: 'Belum Diisi', count: data.statusCounts?.empty ?? 0, badge: 'badge-warning' }] as tab (tab.key)}
			<button
				type="button"
				class="tab text-xs font-medium"
				class:tab-active={(data.page.status ?? 'all') === tab.key}
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
			aktif={countActiveFilters(page.url, KUNCI_FILTER)}
			onReset={() =>
				goto(resetFilters(page.url, KUNCI_FILTER), { replaceState: true, keepFocus: true })}
		>
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

	<div
		class="bg-base-100 dark:bg-base-200 mt-4 overflow-x-auto rounded-md shadow-md dark:shadow-none"
	>
		<table class="border-base-200 table min-w-[720px] border dark:border-none">
			<thead>
				<tr class="bg-base-200 dark:bg-base-300 text-left font-bold">
					<th style="width: 60px;">No</th>
					<th style="width: 30%;">Nama</th>
					<th class="w-full">Catatan</th>
					<th style="width: 160px; min-width: 120px;">Aksi</th>
				</tr>
			</thead>
			<tbody>
				{#each data.daftarCatatan as item (item.id)}
					{@const formId = `edit-catatan-form-${item.id}`}
					<tr class={editingRowId === item.id ? 'bg-base-200/40' : undefined}>
						<td class="align-top">{item.no}</td>
						<td class="align-top">{@html searchQueryMarker(data.page.search, item.nama)}</td>
						<td class="align-top">
							{#if editingRowId === item.id}
								<FormEnhance
									id={formId}
									action="?/save"
									submitStateChange={(value) => (editingSubmitting = value)}
									onsuccess={() => {
										void handleSaveSuccess();
									}}
								>
									{#snippet children({ submitting, invalid })}
										<input name="muridId" value={item.id} hidden />
										<label class="flex flex-col gap-2" aria-busy={submitting}>
											<textarea
												bind:this={editingTextarea}
												class="textarea textarea-bordered bg-base-200 dark:bg-base-300 w-full dark:border-none"
												name="catatan"
												rows="4"
												bind:value={editingCatatan}
												placeholder={`Tuliskan catatan untuk ${item.nama}`}
												spellcheck="false"
												aria-invalid={invalid}></textarea>
											<small class="text-base-content/60 text-xs">
												Kosongkan catatan dan simpan untuk menghapus.
											</small>
										</label>
									{/snippet}
								</FormEnhance>
							{:else if item.catatan}
								<p class="whitespace-pre-line">{item.catatan}</p>
							{:else}
								<span class="italic opacity-60">Belum ada catatan</span>
							{/if}
						</td>
						<td class="align-top">
							{#if editingRowId === item.id}
								<div class="flex justify-end gap-2">
									<button
										type="button"
										class="btn btn-soft btn-sm btn-error shadow-none"
										onclick={cancelEdit}
										disabled={editingSubmitting}
										title="Batalkan edit catatan"
									>
										<Icon name="close" />
									</button>
									<button
										class="btn btn-sm btn-primary shadow-none"
										form={formId}
										type="submit"
										disabled={editingSaveDisabled}
										title="Simpan catatan"
									>
										{#if editingSubmitting}
											<span class="loading loading-spinner loading-xs" aria-hidden="true"></span>
										{/if}
										<Icon name="save" />
									</button>
								</div>
							{:else}
								<div class="flex justify-end">
									<button
										type="button"
										class="btn btn-sm btn-soft shadow-none"
										onclick={() => startEdit(item)}
										disabled={editingRowId !== null || !canEdit}
										title={!canEdit ? 'Anda tidak memiliki izin untuk mengedit' : ''}
									>
										<Icon name="edit" />
										Edit
									</button>
								</div>
							{/if}
						</td>
					</tr>
				{:else}
					<tr>
						<td class="p-7 text-center italic opacity-60" colspan="4"
							>Belum ada murid pada kelas ini</td
						>
					</tr>
				{/each}
			</tbody>
		</table>
	</div>

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
		Menampilkan {data.daftarCatatan.length} dari {data.page.totalItems ?? 0} data
	</p>
</div>
