<script lang="ts">
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { showModal, updateModal } from '$lib/components/global-modal.svelte';
	import { toast } from '$lib/components/toast.svelte';
	import AlertWarning from '$lib/components/alert-warning.svelte';
	import Icon from '$lib/components/icon.svelte';
	import UsersHeader from '$lib/components/pengguna/UsersHeader.svelte';
	import ExistingUserRow from '$lib/components/pengguna/ExistingUserRow.svelte';
	import FilterToolbar from '$lib/components/table/filter-toolbar.svelte';
	import { setFilter, resetFilters, countActiveFilters } from '$lib/utils/url-filter';

	let { data } = $props();

	const KUNCI_FILTER = ['q', 'type'];

	// svelte-ignore state_referenced_locally
	let searchTerm = $state(data.filter?.q ?? '');

	async function terapkanFilter(key: string, value: string) {
		await goto(setFilter(page.url, key, value), { replaceState: true, keepFocus: true });
	}

	// local reactive users copy so UI updates instantly without full reload
	// base shape mirrors load's users (never hardcode) + local-only fields
	type LocalUser = (typeof data.users)[number] & {
		roles: string[];
		isNew?: boolean;
		mataPelajaranIds?: number[];
		kelasIds?: number[];
		waliKelasIds?: number[];
	};
	// svelte-ignore state_referenced_locally
	let users = $state<LocalUser[]>(data.users ?? []);

	// (use global `ModalAction` from `src/lib/components/types.d.ts`)

	// selected ids for bulk actions
	let selectedIds = $state<number[]>([]);

	// selectable ids derived once per render (positive existing user ids, excluding root Admin id 1)
	let selectableIds = $derived(
		users.map((u) => Number(u.id)).filter((n) => Number.isFinite(n) && n > 1)
	);

	function toggleSelect(id: number) {
		const idx = selectedIds.indexOf(id);
		if (idx === -1) selectedIds = [...selectedIds, id];
		else selectedIds = selectedIds.filter((x) => x !== id);
	}

	async function handleDelete() {
		// reuse the shared delete modal logic for the currently selected ids
		openDeleteModalForIds(selectedIds);
	}
	// open delete modal for given ids (reused by bulk and single-user delete)
	function openDeleteModalForIds(ids: number[]) {
		const selectedUsers = users.filter((u) => ids.indexOf(u.id as number) !== -1);
		const hasWali = selectedUsers.some((u) => {
			const type = (u as { type?: string }).type;
			return type === 'wali_kelas';
		});

		if (hasWali) {
			showModal({
				title: 'Hapus pengguna',
				body: AlertWarning,
				bodyProps: {
					message:
						'Tidak dapat menghapus karena satu atau lebih pengguna terpilih berperan sebagai Wali Kelas. Untuk menggantinya, klik tombol <strong>Atur Data Kelas</strong>'
				},
				onPositive: {
					label: 'Atur Data Kelas',
					icon: 'edit',
					action: ({ close }: { close: () => void }) => {
						close();
						window.location.href = '/kelas';
					}
				},
				onNegative: { label: 'Batal', icon: 'close' },
				dismissible: true
			});
			return;
		}

		showModal({
			title: 'Hapus pengguna',
			body: `Yakin ingin menghapus ${ids.length} pengguna yang dipilih?`,
			onPositive: {
				label: 'Hapus',
				icon: 'del',
				action: async ({ close }: { close: () => void }) => {
					const idsToDelete = ids.filter((n) => n > 0);
					if (!idsToDelete.length) {
						toast({ message: 'Tidak ada pengguna valid untuk dihapus', type: 'error' });
						return;
					}
					const form = new FormData();
					form.set('ids', idsToDelete.join(','));
					const res = await fetch('?/delete_users', { method: 'POST', body: form });
					if (res.ok) {
						await res.json().catch(() => ({}));
						users = users.filter((x) => !idsToDelete.includes(x.id as number));
						selectedIds = selectedIds.filter((n) => !idsToDelete.includes(n));
						users = [...users];
						toast({
							message: `Berhasil menghapus ${idsToDelete.length} pengguna`,
							type: 'success'
						});
						close();
					} else {
						let msg: string;
						let parsedBody: unknown = null;
						try {
							parsedBody = await res.json().catch(() => null);
							if (parsedBody && typeof parsedBody === 'object') {
								const pb = parsedBody as Record<string, unknown>;
								if (typeof pb.message === 'string' && pb.message.trim()) msg = pb.message;
								else if (
									pb.error &&
									typeof (pb.error as Record<string, unknown>).message === 'string'
								)
									msg = (pb.error as Record<string, unknown>).message as string;
								else msg = JSON.stringify(pb);
							} else {
								const text = await res.text().catch(() => 'Gagal');
								msg = text;
							}
						} catch {
							const text = await res.text().catch(() => 'Gagal');
							msg = text;
						}
						if (!msg.trim()) msg = 'Gagal menghapus';
						try {
							if (
								parsedBody &&
								typeof parsedBody === 'object' &&
								(parsedBody as Record<string, unknown>).type === 'warning' &&
								typeof (parsedBody as Record<string, unknown>).message === 'string'
							) {
								const pb = parsedBody as Record<string, unknown>;
								const escapeHtml = (s: string) =>
									s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
								const safe = escapeHtml(pb.message as string);
								updateModal({
									title: 'Hapus pengguna',
									body: AlertWarning,
									bodyProps: { message: safe },
									onPositive: {
										label: 'Atur Wali Kelas',
										icon: 'key',
										action: ({ close: c }: { close: () => void }) => {
											c();
											window.location.href = '/kelas';
										}
									},
									onNegative: { label: 'Tutup', icon: 'close' },
									dismissible: true
								});
								return;
							}
						} catch {
							// ignore
						}
						toast({ message: msg, type: 'warning' });
					}
				}
			},
			onNegative: { label: 'Batal', icon: 'close' },
			dismissible: true
		});
	}
	function toggleSelectAll() {
		if (selectableIds.length === 0) {
			selectedIds = [];
			return;
		}
		const allSelected = selectableIds.every((id) => selectedIds.indexOf(id) !== -1);
		if (allSelected) selectedIds = [];
		else selectedIds = [...selectableIds];
	}

	// handle add/new row
	function handleAdd() {
		goto('/pengguna/form');
	}

	function handleEdit(user: LocalUser) {
		goto(`/pengguna/form/${user.id}`);
	}

	async function handleSwitch(user: LocalUser) {
		try {
			const res = await fetch('/api/auth/switch-user', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ userId: user.id })
			});
			const json = await res.json();
			if (res.ok && json.success) {
				toast(json.message || `Berhasil beralih ke akun ${user.username}`, 'success');
				window.location.href = '/';
			} else {
				toast(json.message || 'Gagal beralih akun', 'error');
			}
		} catch {
			toast('Terjadi kesalahan saat beralih akun', 'error');
		}
	}
</script>

<section class="card bg-base-100 rounded-lg border border-none p-6 shadow-md">
	<div class="space-y-4">
		<header class="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
			<div class="space-y-2">
				<h1 class="text-2xl font-bold">Daftar pengguna</h1>
			</div>
			<UsersHeader {selectedIds} onDelete={handleDelete} onAdd={handleAdd} />
		</header>

		<div>
			<FilterToolbar
				bind:q={searchTerm}
				qPlaceholder="Cari nama/NIP/NIK..."
				onSearch={(value) => terapkanFilter('q', value)}
				pilih={[
					{
						name: 'type',
						label: 'Peran',
						value: page.url.searchParams.get('type') ?? '',
						opsis: [{ value: '', label: 'Semua Peran' }, ...(data.opsiTipe ?? [])],
						onChange: (v) => terapkanFilter('type', v)
					}
				]}
				aktif={countActiveFilters(page.url, KUNCI_FILTER)}
				onReset={() =>
					goto(resetFilters(page.url, KUNCI_FILTER), { replaceState: true, keepFocus: true })}
			/>
		</div>

		{#if (data.counts?.totalSemua ?? 0) === 0}
			<div class="alert alert-soft alert-warning">
				<Icon name="alert" />
				<span>Belum ada pengguna.</span>
			</div>
		{:else if users.length === 0}
			<div class="alert alert-soft alert-info">
				<Icon name="info" />
				<span>Tidak ada yang cocok dengan filter.</span>
			</div>
		{:else}
			<div class="overflow-x-auto">
				<table class="table">
					<thead>
						<tr>
							<th>
								<input
									type="checkbox"
									class="checkbox"
									checked={selectableIds.length > 0 &&
										selectableIds.every((id) => selectedIds.indexOf(id) !== -1)}
									onclick={() => toggleSelectAll()}
								/>
							</th>
							<th>Nama</th>
							<th>Role</th>
							<th>NIK / Username</th>
							<th>Aksi</th>
							<th>Hak Akses</th>
						</tr>
					</thead>
					<tbody>
						{#each users as u (u.id)}
							<tr>
								<td>
									{#if u.id !== 1 && u.username?.toLowerCase() !== 'admin'}
										<input
											type="checkbox"
											class="checkbox"
											checked={selectedIds.indexOf(u.id) !== -1}
											onclick={() => toggleSelect(u.id)}
										/>
									{/if}
								</td>

								<ExistingUserRow
									{u}
									onEdit={handleEdit}
									onOpenUser={(user: LocalUser) => {
										window.location.href = '/pengguna/' + user.id;
									}}
									onDelete={(user: LocalUser) => openDeleteModalForIds([Number(user.id)])}
									onSwitch={handleSwitch}
								/>
							</tr>
						{/each}
					</tbody>
				</table>
			</div>
		{/if}
	</div>
</section>
