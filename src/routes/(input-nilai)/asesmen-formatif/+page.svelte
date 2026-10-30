<script lang="ts">
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import FilterToolbar from '$lib/components/table/filter-toolbar.svelte';
	import Icon from '$lib/components/icon.svelte';
	import KelasKontenPicker from '$lib/components/kelas-konten-picker.svelte';
	import { searchQueryMarker } from '$lib/utils';
	import { countActiveFilters, resetFilters, setFilter } from '$lib/utils/url-filter';

	import SvelteURLSearchParams from '$lib/svelte-helpers/url-search-params';

	type ProgressCategory = 'sangat-baik' | 'baik' | 'perlu-pendalaman' | 'perlu-bimbingan';
	type PaginationState = {
		currentPage: number;
		totalPages: number;
		totalItems: number;
		perPage: number;
		search: string | null;
	};
	type PageData = {
		kelasKontenAktif?: { id: number; nama: string; fase: string | null } | null;
		mapelList: Array<{ value: string; nama: string }>;
		selectedMapelValue: string | null;
		daftarMurid: Array<{
			id: number;
			nama: string;
			agamaLabel?: string | null;
			no: number;
			progressText: string | null;
			progressSummaryParts: Array<{
				kategori: ProgressCategory;
				kategoriLabel: string;
				lingkupMateri: string;
				tuntas: number;
				totalTujuan: number;
			}>;
			hasPenilaian: boolean;
			nilaiHref: string | null;
			canNilai?: boolean;
		}>;
		jumlahTujuan: number;
		selectedMapel?: { id: number | null; nama: string } | null;
		search: string | null;
		page: PaginationState;
		allowedAgamaForUser?: string[];
	};

	let { data }: { data: PageData } = $props();

	const CATEGORY_TEXT_CLASS: Record<ProgressCategory, string> = {
		'sangat-baik': 'text-info',
		baik: 'text-primary',
		'perlu-pendalaman': 'text-warning',
		'perlu-bimbingan': 'text-error'
	};

	const KUNCI_FILTER = ['q', 'mapel_id'];

	// svelte-ignore state_referenced_locally
	let searchTerm = $state(data.search ?? '');
	const currentPage = $derived.by(() => data.page?.currentPage ?? 1);
	const totalPages = $derived.by(() => Math.max(1, data.page?.totalPages ?? 1));
	const pages = $derived.by(() => Array.from({ length: totalPages }, (_, index) => index + 1));

	const kelasAktifLabel = $derived.by(() => {
		const kelas = data.kelasKontenAktif ?? page.data.kelasAktif ?? null;
		if (!kelas) return null;
		return kelas.fase ? `${kelas.nama} - ${kelas.fase}` : kelas.nama;
	});

	// Restrict editing for wali_asuh
	const canEdit = $derived.by(() => {
		const u = page.data.user as { type?: string } | null | undefined;
		return u?.type !== 'wali_asuh';
	});

	$effect(() => {
		const latestSearch = data.search ?? '';
		if (searchTerm !== latestSearch) {
			searchTerm = latestSearch;
		}
	});

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

	function handlePageClick(pageNumber: number) {
		if (pageNumber === currentPage) return;
		void gotoPage(pageNumber);
	}

	function escapeHtml(value: string) {
		return value
			.replace(/&/g, '&amp;')
			.replace(/</g, '&lt;')
			.replace(/>/g, '&gt;')
			.replace(/"/g, '&quot;')
			.replace(/'/g, '&#39;');
	}

	function summaryWithHighlights(murid: (typeof data.daftarMurid)[number]) {
		if (!murid.progressSummaryParts.length || !murid.progressText) {
			return murid.progressText ?? '';
		}

		const source = escapeHtml(murid.progressText);
		let cursor = 0;
		let html = '';
		for (const part of murid.progressSummaryParts) {
			const token = `${part.tuntas}/${part.totalTujuan} TP`;
			const nextIndex = source.indexOf(token, cursor);
			if (nextIndex === -1) {
				continue;
			}
			html += source.slice(cursor, nextIndex);
			html += `<span class="${CATEGORY_TEXT_CLASS[part.kategori]} font-semibold">${token}</span>`;
			cursor = nextIndex + token.length;
		}
		html += source.slice(cursor);
		return html;
	}
</script>

<div class="card bg-base-100 rounded-lg border border-none p-4 shadow-md">
	<div class="mb-4 flex flex-wrap items-center justify-between gap-2">
		<div>
			<h2 class="text-xl font-bold">
				Daftar Nilai Formatif
				{#if data.selectedMapel}
					- {data.selectedMapel.nama}
				{/if}
			</h2>
			{#if kelasAktifLabel}
				<p class="text-base-content/70 text-sm">Kelas aktif: {kelasAktifLabel}</p>
			{:else}
				<p class="text-base-content/60 text-sm">
					Pilih kelas di navbar atau pemilih kelas untuk melihat mata pelajaran intrakurikuler.
				</p>
			{/if}
		</div>
		<KelasKontenPicker currentId={data.kelasKontenAktif?.id ?? null} />
	</div>

	<FilterToolbar
		bind:q={searchTerm}
		qPlaceholder="Cari nama murid..."
		onSearch={(value) => terapkanFilter('q', value)}
		pilih={[
			{
				name: 'mapel_id',
				label: 'Mata Pelajaran',
				value: data.selectedMapelValue ?? '',
				opsis: [
					{ value: '', label: 'Semua Mapel' },
					...data.mapelList.map((m) => ({ value: m.value, label: m.nama }))
				],
				onChange: (v) => terapkanFilter('mapel_id', v)
			}
		]}
		aktif={countActiveFilters(page.url, KUNCI_FILTER)}
		onReset={() =>
			goto(resetFilters(page.url, KUNCI_FILTER), { replaceState: true, keepFocus: true })}
	/>

	{#if data.mapelList.length === 0}
		<div class="alert alert-soft alert-info mt-6">
			<Icon name="info" />
			<span>
				Belum ada mata pelajaran intrakurikuler di kelas ini. Tambahkan terlebih dahulu di menu
				<strong>Intrakurikuler</strong>.
			</span>
		</div>
	{:else if data.daftarMurid.length === 0}
		<div class="alert alert-soft alert-warning mt-6">
			<Icon name="alert" />
			<span>
				Belum ada data murid untuk kelas ini. Silakan tambah murid di menu <strong>Murid</strong>.
			</span>
		</div>
	{:else}
		<div
			class="bg-base-100 dark:bg-base-200 mt-4 overflow-x-auto rounded-md shadow-md dark:shadow-none"
		>
			<table class="border-base-200 table min-w-150 border dark:border-none">
				<thead>
					<tr class="bg-base-200 dark:bg-base-300 text-base-content text-left font-bold">
						<th style="width: 50px; min-width: 40px;">No</th>
						<th class="min-w-40">Nama</th>
						<th>Aksi</th>
						<th class="w-full" style="min-width: 220px;">Progres</th>
					</tr>
				</thead>
				<tbody>
					{#each data.daftarMurid as murid (murid.id)}
						<tr>
							<td class="align-top">{murid.no}</td>
							<td class="align-top">
								{@html searchQueryMarker(data.search, murid.nama)}
								{#if murid.agamaLabel}
									<div class="text-[11px] font-normal opacity-70">{murid.agamaLabel}</div>
								{/if}
							</td>
							<td class="align-top">
								{#if murid.nilaiHref && canEdit}
									<a class="btn btn-sm btn-soft shadow-none" href={murid.nilaiHref}>
										<Icon name="edit" />
										Nilai
									</a>
								{:else}
									<button
										type="button"
										class="btn btn-sm btn-disabled"
										disabled
										title={!canEdit
											? 'Anda tidak memiliki izin untuk menilai'
											: data.allowedAgamaForUser
												? `Hanya untuk murid beragama ${data.allowedAgamaForUser.join(' / ')}`
												: 'Pilih mata pelajaran'}
									>
										<Icon name="edit" />
										Nilai
									</button>
								{/if}
							</td>
							<td class="align-top">
								{#if murid.progressText}
									<p
										class={murid.progressSummaryParts.length
											? 'text-base-content text-sm'
											: 'text-base-content/70 text-sm italic'}
									>
										{@html summaryWithHighlights(murid)}
									</p>
								{:else}
									<span class="text-base-content/70 text-sm italic"
										>Pilih mata pelajaran untuk melihat progres</span
									>
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
