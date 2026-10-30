<script lang="ts">
	import { goto, invalidate } from '$app/navigation';
	import { page } from '$app/state';
	import Icon from '$lib/components/icon.svelte';
	import NilaiModal from '$lib/components/asesmen-kokurikuler/nilai-modal.svelte';
	import FilterToolbar from '$lib/components/table/filter-toolbar.svelte';
	import { setFilter, resetFilters, countActiveFilters } from '$lib/utils/url-filter';
	import { searchQueryMarker } from '$lib/utils';
	import type { DimensiProfilLulusanKey } from '$lib/statics';
	import type { NilaiKategori } from '$lib/kokurikuler';
	import { toast } from '$lib/components/toast.svelte';
	import { showModal } from '$lib/components/global-modal.svelte';
	import ActionButtons from '$lib/components/asesmen-kokurikuler/action-buttons.svelte';
	import ImportModalBody from '$lib/components/asesmen-kokurikuler/import-modal-body.svelte';
	import { downloadTemplate, importNilai } from '$lib/components/asesmen-kokurikuler/api';

	type DimensiDetail = {
		key: DimensiProfilLulusanKey;
		label: string;
	};

	type KokurikulerDetail = {
		id: number;
		kode: string;
		tujuan: string;
		dimensi: DimensiDetail[];
	};

	type MuridRow = {
		id: number;
		nama: string;
		no: number;
		deskripsi: string | null;
		nilaiByDimensi: Record<DimensiProfilLulusanKey, NilaiKategori | null>;
		hasNilai: boolean;
		lastUpdated: string | null;
	};

	type PaginationState = {
		currentPage: number;
		totalPages: number;
		// totalItems, perPage and search are omitted when not used by this view
	};

	type PageData = {
		kokurikulerList: KokurikulerDetail[];
		selectedKokurikulerId: number | null;
		selectedKokurikuler: KokurikulerDetail | null;
		kategoriOptions: Array<{ value: NilaiKategori; label: string }>;
		daftarMurid: MuridRow[];
		search: string | null;
		totalMurid: number;
		muridCount: number;
		// summary not used in this view; omitted to avoid unused prop lint
		page: PaginationState;
	};

	let { data }: { data: PageData } = $props();

	const hasKokurikuler = $derived.by(() => data.kokurikulerList.length > 0);
	const selectedKokurikuler = $derived.by(() => data.selectedKokurikuler);
	const selectedKokurikulerHasDimensi = $derived.by(() =>
		selectedKokurikuler ? selectedKokurikuler.dimensi.length > 0 : false
	);
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
	const currentPage = $derived.by(() => data.page?.currentPage ?? 1);
	const totalPages = $derived.by(() => Math.max(1, data.page?.totalPages ?? 1));
	const pages = $derived.by(() => Array.from({ length: totalPages }, (_, index) => index + 1));

	const KUNCI_FILTER = ['q', 'kokurikuler_id'];

	// svelte-ignore state_referenced_locally
	let selectedKokurikulerValue = $state(
		data.selectedKokurikulerId ? String(data.selectedKokurikulerId) : ''
	);
	// svelte-ignore state_referenced_locally
	let searchTerm = $state(data.search ?? '');

	let modalOpen = $state(false);
	let activeMurid = $state<MuridRow | null>(null);
	let isDownloadingTemplate = $state(false);
	let isImportingFile = $state(false);

	$effect(() => {
		selectedKokurikulerValue = data.selectedKokurikulerId ? String(data.selectedKokurikulerId) : '';
		searchTerm = data.search ?? '';
	});

	async function terapkanFilter(key: string, value: string) {
		await goto(setFilter(page.url, key, value), { replaceState: true, keepFocus: true });
	}

	$effect(() => {
		if (!hasKokurikuler) return;
		if (data.kokurikulerList.length !== 1) return;
		const onlyId = String(data.kokurikulerList[0].id);
		if (selectedKokurikulerValue === onlyId) return;
		selectedKokurikulerValue = onlyId;
		void terapkanFilter('kokurikuler_id', onlyId);
	});

	function openModalFor(murid: MuridRow) {
		activeMurid = murid;
		modalOpen = true;
	}

	function closeModal() {
		modalOpen = false;
		activeMurid = null;
	}

	async function handleModalSuccess() {
		closeModal();
		await invalidate('app:asesmen-kokurikuler');
	}

	async function handleDownloadTemplate() {
		if (!selectedKokurikulerValue || !selectedKokurikulerHasDimensi || !kelasAktif?.id) {
			toast('Pilih kokurikuler terlebih dahulu', 'error');
			return;
		}

		isDownloadingTemplate = true;
		try {
			const success = await downloadTemplate(selectedKokurikulerValue, kelasAktif.id);
			if (success) {
				toast('Template berhasil diunduh', 'success');
			} else {
				toast('Gagal mengunduh template', 'error');
			}
		} catch (err) {
			console.error(err);
			toast('Terjadi kesalahan saat mengunduh template', 'error');
		} finally {
			isDownloadingTemplate = false;
		}
	}

	function openImportModal() {
		if (!selectedKokurikulerValue || !selectedKokurikulerHasDimensi || !kelasAktif?.id) {
			toast('Pilih kokurikuler terlebih dahulu', 'error');
			return;
		}

		let uploader: () => File | null = () => null;

		showModal({
			title: 'Import Nilai dari Excel',
			body: ImportModalBody,
			bodyProps: {
				setUploader: (fn: () => File | null) => (uploader = fn)
			},
			onPositive: {
				label: 'Import',
				icon: 'import',
				action: async ({ close }: { close: () => void }) => {
					const file = uploader();
					if (!file) {
						toast('Pilih file terlebih dahulu.', 'error');
						return;
					}

					isImportingFile = true;

					try {
						const result = await importNilai(file, selectedKokurikulerValue, kelasAktif?.id ?? 0);

						if (result.success) {
							toast(result.message || 'Nilai berhasil diimport', 'success');
							close();
							await invalidate('app:asesmen-kokurikuler');

							await goto(`?kokurikuler_id=${selectedKokurikulerValue}`);
						} else {
							toast(result.message || 'Gagal import nilai', 'error');
						}
					} catch (err) {
						console.error(err);
						toast(
							'Terjadi kesalahan saat import: ' + String((err as Error)?.message ?? err),
							'error'
						);
					} finally {
						isImportingFile = false;
					}
				}
			},
			onNeutral: { label: 'Batal', icon: 'close' },
			spreadActions: true,
			dismissible: true
		});
	}

	function gotoPage(pageNumber: number) {
		const sanitized = pageNumber < 1 ? 1 : pageNumber;
		void goto(setFilter(page.url, 'page', sanitized <= 1 ? '' : String(sanitized)), {
			replaceState: true,
			keepFocus: true
		});
	}

	function handlePageClick(pageNumber: number) {
		if (pageNumber === currentPage) return;
		gotoPage(pageNumber);
	}

	function capitalizeSentence(value: string | null | undefined) {
		if (!value) return '';
		const trimmed = value.trimStart();
		if (!trimmed) return '';
		return trimmed.charAt(0).toUpperCase() + trimmed.slice(1);
	}
</script>

<div class="card bg-base-100 rounded-lg border border-none p-4 shadow-md">
	<div class="mb-4 flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
		<div>
			<h2 class="text-xl font-bold">
				Daftar Nilai Kokurikuler
				{#if selectedKokurikuler}
					- {capitalizeSentence(selectedKokurikuler.tujuan)}
				{/if}
			</h2>

			{#if kelasAktifLabel}
				<p class="text-base-content/80 block text-sm">{kelasAktifLabel}</p>
			{/if}
		</div>
	</div>

	<ActionButtons
		isDownloading={isDownloadingTemplate}
		isImporting={isImportingFile}
		disabled={!selectedKokurikulerHasDimensi || !canEdit}
		onDownload={handleDownloadTemplate}
		onImport={openImportModal}
	/>

	<div class="mb-4 flex flex-col gap-2 sm:flex-row">
		<FilterToolbar
			bind:q={searchTerm}
			qPlaceholder="Cari nama murid..."
			onSearch={(value) => terapkanFilter('q', value)}
			pilih={[
				{
					name: 'kokurikuler_id',
					label: 'Kegiatan',
					value: data.selectedKokurikulerId ? String(data.selectedKokurikulerId) : '',
					opsis: [
						{ value: '', label: 'Semua Kegiatan' },
						...data.kokurikulerList.map((item) => ({
							value: String(item.id),
							label: capitalizeSentence(item.tujuan)
						}))
					],
					onChange: (v) => terapkanFilter('kokurikuler_id', v)
				}
			]}
			aktif={countActiveFilters(page.url, KUNCI_FILTER)}
			onReset={() =>
				goto(resetFilters(page.url, KUNCI_FILTER), { replaceState: true, keepFocus: true })}
		/>
	</div>

	{#if !hasKokurikuler}
		<div class="alert alert-soft alert-info mt-6">
			<Icon name="info" />
			<span>
				Belum ada data kokurikuler untuk kelas ini. Tambahkan terlebih dahulu di menu
				<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -->
				<strong><a class="link" href="/kokurikuler">Kokurikuler</a></strong>.
			</span>
		</div>
	{:else if !selectedKokurikuler}
		<div class="alert alert-soft alert-warning mt-6">
			<Icon name="alert" />
			<span>Pilih kokurikuler untuk mulai menilai.</span>
		</div>
	{:else if data.muridCount === 0}
		<div class="alert alert-soft alert-warning mt-6">
			<Icon name="alert" />
			<span>
				Belum ada data murid di kelas ini. Tambahkan murid terlebih dahulu melalui menu
				<strong>Murid</strong>.
			</span>
		</div>
	{:else if data.totalMurid === 0}
		<div class="alert alert-soft alert-info mt-6">
			<Icon name="info" />
			<span>Tidak ada murid yang cocok dengan pencarian.</span>
		</div>
	{:else}
		<div
			class="bg-base-100 dark:bg-base-200 mt-4 overflow-x-auto rounded-md shadow-md dark:shadow-none"
		>
			<table class="border-base-200 table min-w-150 border dark:border-none">
				<thead>
					<tr class="bg-base-200 dark:bg-base-300 text-base-content text-left font-bold">
						<th style="width: 50px; min-width: 40px;">No</th>
						<th class="min-w-44">Nama</th>
						<th>Aksi</th>
						<th class="w-full" style="min-width: 240px;">Deskripsi</th>
					</tr>
				</thead>
				<tbody>
					{#each data.daftarMurid as murid (murid.id)}
						<tr>
							<td class="align-top">{murid.no}</td>
							<td class="align-top">
								{@html searchQueryMarker(data.search, murid.nama)}
							</td>
							<td class="align-top">
								<button
									type="button"
									class="btn btn-sm btn-soft shadow-none"
									onclick={() => openModalFor(murid)}
									disabled={!canEdit}
									title={!canEdit ? 'Anda tidak memiliki izin untuk menilai' : ''}
								>
									<Icon name="edit" />
									Nilai
								</button>
							</td>
							<td class="align-top">
								{#if murid.deskripsi}
									<p class="text-base-content text-sm">{murid.deskripsi}</p>
								{:else}
									<span class="text-base-content/70 text-sm italic"> Belum ada nilai </span>
								{/if}
							</td>
						</tr>
					{/each}
				</tbody>
			</table>
		</div>
		<div class="join mt-4 sm:mx-auto">
			{#each pages as pageNumber (pageNumber)}
				<button
					type="button"
					class="join-item btn"
					class:btn-active={pageNumber === currentPage}
					onclick={() => handlePageClick(pageNumber)}
					aria-current={pageNumber === currentPage ? 'page' : undefined}
				>
					{pageNumber}
				</button>
			{/each}
		</div>
	{/if}
</div>

<NilaiModal
	open={modalOpen}
	murid={activeMurid}
	kokurikuler={selectedKokurikuler}
	kategoriOptions={data.kategoriOptions}
	action="?/nilai"
	onClose={closeModal}
	onSuccess={handleModalSuccess}
/>
