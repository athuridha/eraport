<script lang="ts">
	import { goto, invalidate } from '$app/navigation';
	import { page } from '$app/state';
	import Icon from '$lib/components/icon.svelte';
	import { searchQueryMarker, signatureDisplaySrc } from '$lib/utils';
	import { showModal } from '$lib/components/global-modal.svelte';
	import BukuTamuDetailBody from '$lib/components/buku-tamu/buku-tamu-detail-body.svelte';
	import SvelteURLSearchParams from '$lib/svelte-helpers/url-search-params';
	import FilterToolbar from '$lib/components/table/filter-toolbar.svelte';
	import { setFilter, resetFilters, countActiveFilters } from '$lib/utils/url-filter';

	type BukuTamuRow = {
		id: number;
		no: number;
		nama: string;
		asalInstansi: string;
		nip: string | null;
		keperluan: string;
		pesanKesan: string | null;
		tandaTangan: string | null;
		createdAt: string;
	};

	type PageState = {
		search: string | null;
		currentPage: number;
		totalPages: number;
		totalItems: number;
	};

	type PageData = {
		daftarTamu: BukuTamuRow[];
		page: PageState;
		tamuCount: number;
	};

	let { data }: { data: PageData } = $props();

	const KUNCI_FILTER = ['q', 'dari', 'sampai'];

	const currentPage = $derived.by(() => data.page?.currentPage ?? 1);
	const totalPages = $derived.by(() => Math.max(1, data.page?.totalPages ?? 1));
	const pages = $derived.by(() => Array.from({ length: totalPages }, (_, index) => index + 1));

	// svelte-ignore state_referenced_locally
	let searchTerm = $state(data.page.search ?? '');

	async function terapkanFilter(key: string, value: string) {
		await goto(setFilter(page.url, key, value), { replaceState: true, keepFocus: true });
	}

	async function terapkanTanggal(dari: string, sampai: string) {
		const next = new URL(page.url);
		if (dari) {
			next.searchParams.set('dari', dari);
		} else {
			next.searchParams.delete('dari');
		}
		if (sampai) {
			next.searchParams.set('sampai', sampai);
		} else {
			next.searchParams.delete('sampai');
		}
		next.searchParams.delete('page');
		await goto(next, { replaceState: true, keepFocus: true });
	}

	$effect(() => {
		const latestSearchTerm = data.page.search ?? '';
		if (searchTerm !== latestSearchTerm) {
			searchTerm = latestSearchTerm;
		}
	});

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

	function viewDetail(tamu: BukuTamuRow) {
		showModal({
			title: `Detail Tamu - ${tamu.nama}`,
			body: BukuTamuDetailBody,
			bodyProps: {
				nama: tamu.nama,
				asalInstansi: tamu.asalInstansi,
				nip: tamu.nip,
				keperluan: tamu.keperluan,
				pesanKesan: tamu.pesanKesan,
				tandaTangan: signatureDisplaySrc(tamu.tandaTangan),
				createdAt: tamu.createdAt
			},
			dismissible: true,
			onNeutral: { label: 'Tutup' }
		});
	}

	async function handleDelete(tamu: BukuTamuRow) {
		showModal({
			title: 'Hapus Data Tamu',
			body: `Hapus data tamu <strong>${tamu.nama}</strong>? Tindakan ini tidak dapat dibatalkan.`,
			dismissible: false,
			onPositive: {
				label: 'Hapus',
				class: 'btn-error',
				action: async ({ close }) => {
					try {
						const res = await fetch(`/api/buku-tamu?id=${tamu.id}`, { method: 'DELETE' });
						if (res.ok) {
							const toast = (await import('$lib/components/toast.svelte')).toast;
							toast('Data tamu berhasil dihapus', 'success');
							await invalidate('app:buku-tamu');
						} else {
							const toast = (await import('$lib/components/toast.svelte')).toast;
							toast('Gagal menghapus data', 'error');
						}
					} catch {
						const toast = (await import('$lib/components/toast.svelte')).toast;
						toast('Terjadi kesalahan', 'error');
					}
					close();
				}
			},
			onNegative: { label: 'Batal' }
		});
	}

	const hasTamu = $derived(data.tamuCount > 0);
	const hasFilteredTamu = $derived(data.page.totalItems > 0);
</script>

<div class="card bg-base-100 rounded-lg border border-none p-4 shadow-md">
	<div class="mb-4 flex items-start justify-between">
		<div>
			<h2 class="text-xl font-bold">Buku Tamu</h2>
			<p class="text-base-content/80 block text-sm">{data.tamuCount} data kunjungan</p>
		</div>
	</div>

	<div class="mb-4 flex flex-col gap-2 sm:flex-row">
		<FilterToolbar
			bind:q={searchTerm}
			qPlaceholder="Cari nama tamu..."
			onSearch={(value) => terapkanFilter('q', value)}
			tanggal={{
				dari: page.url.searchParams.get('dari') ?? '',
				sampai: page.url.searchParams.get('sampai') ?? '',
				onChange: (value) => terapkanTanggal(value.dari, value.sampai)
			}}
			aktif={countActiveFilters(page.url, KUNCI_FILTER)}
			onReset={() =>
				goto(resetFilters(page.url, KUNCI_FILTER), { replaceState: true, keepFocus: true })}
		/>
	</div>

	{#if !hasTamu}
		<div class="alert alert-soft alert-warning mt-6">
			<Icon name="alert" />
			<span
				>Belum ada data tamu. Arahkan tamu untuk membuka halaman <code
					class="bg-warning p-1 rounded-sm text-base-content">ip:3000/tamu</code
				>
				atau
				<code class="bg-warning p-1 rounded-sm text-base-content">domain-sekolah.sch.id/tamu</code> untuk
				mengisi buku tamu.</span
			>
		</div>
	{:else if !hasFilteredTamu}
		<div class="alert alert-soft alert-info mt-6">
			<Icon name="info" />
			<span>Tidak ada tamu yang cocok dengan pencarian atau filter tanggal.</span>
		</div>
	{:else}
		<div
			class="bg-base-100 dark:bg-base-200 mt-4 overflow-x-auto rounded-md shadow-md dark:shadow-none"
		>
			<table class="border-base-200 table border dark:border-none">
				<thead>
					<tr class="bg-base-200 dark:bg-base-300 text-base-content text-left font-bold">
						<th style="width: 50px; min-width: 40px;">No</th>
						<th style="min-width: 140px;">Nama</th>
						<th style="min-width: 140px;">Asal/Instansi</th>
						<th style="min-width: 120px;">Keperluan</th>
						<th style="min-width: 100px;">Tanggal</th>
						<th class="text-center" style="min-width: 100px;">Aksi</th>
					</tr>
				</thead>
				<tbody>
					{#each data.daftarTamu as tamu (tamu.id)}
						<tr>
							<td>{tamu.no}</td>
							<td>{@html searchQueryMarker(data.page.search, tamu.nama)}</td>
							<td>{tamu.asalInstansi}</td>
							<td class="max-w-48 truncate">{tamu.keperluan}</td>
							<td class="whitespace-nowrap">
								{new Date(tamu.createdAt).toLocaleDateString('id-ID', {
									day: 'numeric',
									month: 'short',
									year: 'numeric'
								})}
							</td>
							<td class="text-center">
								<div class="flex items-center justify-center gap-1">
									<button
										type="button"
										class="btn btn-primary btn-soft btn-sm shadow-none"
										onclick={() => viewDetail(tamu)}
										title="Lihat detail"
									>
										<Icon name="eye" />
									</button>
									<button
										type="button"
										class="btn btn-error btn-soft btn-sm shadow-none"
										onclick={() => handleDelete(tamu)}
										title="Hapus"
									>
										<Icon name="del" />
									</button>
								</div>
							</td>
						</tr>
					{/each}
				</tbody>
			</table>
		</div>

		<div class="join mx-auto mt-4">
			{#each pages as pageNumber (pageNumber)}
				<button
					type="button"
					class="join-item btn pointer-events-auto"
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
